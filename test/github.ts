import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { Probot, ProbotOctokit } from "probot";
import app from "../src/index.js";
import opened from "./fixtures/pull_request.opened.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const privateKey = fs.readFileSync(path.join(here, "fixtures/mock-cert.pem"), "utf-8");
const API = "https://api.github.com";
const REPO = "/repos/acme/demo";
const PAGE_SIZE = 100;

/** `load: false` leaves the app unloaded, for createNodeMiddleware, which loads it itself. */
export function createProbot(secret?: string, load = true): Probot {
  const probot = new Probot({
    appId: APP_ID,
    secret,
    privateKey,
    // No throttling or retries, so failures show up at once.
    Octokit: ProbotOctokit.defaults((options: {}) => ({
      ...options,
      retry: { enabled: false },
      throttle: { enabled: false },
    })),
  });
  if (load) probot.load(app);
  return probot;
}

/** The opened fixture, with the given pull request fields and top-level fields replaced. */
export function pullRequestEvent(
  pullRequest: Record<string, unknown> = {},
  top: Record<string, unknown> = {},
) {
  return {
    ...opened,
    ...top,
    pull_request: { ...opened.pull_request, ...pullRequest },
  };
}

/** The id of the app under test; matches the appId given to Probot. */
export const APP_ID = 123;

export type RepoState = {
  /** The pull request's base branch. Config must be read from it, never from the head. */
  base?: string;
  /** Text of .github/semantic-release-sentinel.yml on the base branch; absent means 404. */
  config?: string;
  tags?: string[];
  /** Commits of the pull request, for the merge and rebase strategies. */
  commits?: { message: string; sha?: string; parents?: number }[];
  /** Existing check runs named "Release preview"; app defaults to the app under test. */
  checkRuns?: { id: number; app?: { id: number } }[];
  comments?: {
    id: number;
    body: string;
    performed_via_github_app?: { id: number } | null;
    user?: { type: string };
  }[];
};

/** Mocks the GitHub API for one event and records what the app wrote. */
export function mockGitHub(state: RepoState = {}) {
  const written = {
    created: { checkRuns: [] as any[], comments: [] as any[] },
    updated: {
      checkRuns: [] as { path: string; body: any }[],
      comments: [] as { path: string; body: any }[],
    },
  };
  const requested: string[] = [];
  const scope = nock(API);

  scope
    .post("/app/installations/2/access_tokens")
    .reply(200, { token: "test", permissions: { checks: "write", issues: "write" } });
  scope.get("/app").optionally().reply(200, { id: APP_ID, slug: "sentinel" });

  const reads = (
    url: string | RegExp,
    reply: unknown | ((query: URLSearchParams, path: string) => unknown),
    status = 200,
    query: (query: Record<string, string>) => boolean = () => true,
  ) =>
    scope
      .get(url)
      .query(query)
      .times(30) // a paged list is requested once per page
      .optionally()
      .reply(function () {
        requested.push(this.req.path);
        const params = new URL(this.req.path, API).searchParams;
        return [status, typeof reply === "function" ? reply(params, this.req.path) : reply];
      });

  /** Like GitHub: 100 items per page, and a Link header with rel="next" while more remain. */
  const pagedReads = (
    url: string | RegExp,
    items: (params: URLSearchParams, path: string) => unknown[],
  ) =>
    scope
      .get(url)
      .query(true)
      .times(30)
      .optionally()
      .reply(function () {
        requested.push(this.req.path);
        const params = new URL(this.req.path, API).searchParams;
        const all = items(params, this.req.path);
        const page = Number(params.get("page") ?? 1);
        const next = new URL(this.req.path, API);
        next.searchParams.set("page", String(page + 1));
        const more = page * PAGE_SIZE < all.length;
        return [
          200,
          all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
          more ? { link: `<${next}>; rel="next"` } : {},
        ];
      });

  reads(
    // Octokit encodes the slash in the path; GitHub accepts both forms.
    /^\/repos\/acme\/demo\/contents\/\.github(%2F|\/)semantic-release-sentinel\.yml/,
    state.config === undefined
      ? { message: "Not Found" }
      : { type: "file", encoding: "base64", content: Buffer.from(state.config).toString("base64") },
    state.config === undefined ? 404 : 200,
    // The config must come from the base branch, so a pull request can't change its own rules.
    (query) => query.ref === (state.base ?? "main"),
  );
  // The tag prefix is part of the path, as with GitHub, which only returns the refs that match it.
  pagedReads(/^\/repos\/acme\/demo\/git\/matching-refs\/tags(%2F|\/)[^/?]*/, (_params, path) => {
    const prefix = decodeURIComponent(path.split("?")[0].replace(/^.*\/matching-refs\/tags(%2F|\/)/, ""));
    return (state.tags ?? [])
      .filter((tag) => tag.startsWith(prefix))
      .map((tag) => ({ ref: `refs/tags/${tag}` }));
  });
  reads(
    `${REPO}/pulls/7/commits`,
    (state.commits ?? []).map((c, index) => ({
      sha: c.sha ?? `sha${index}`,
      commit: { message: c.message },
      parents: Array.from({ length: c.parents ?? 1 }, () => ({ sha: "p" })),
    })),
  );
  // Like GitHub, only return the check runs that match the requested app_id.
  reads(
    `${REPO}/commits/headsha1/check-runs`,
    (params) => {
      const runs = (state.checkRuns ?? []).filter(
        (run) => String(run.app?.id ?? APP_ID) === params.get("app_id"),
      );
      return { total_count: runs.length, check_runs: runs };
    },
    200,
    (query) => query.check_name === "Release preview" && query.app_id === String(APP_ID),
  );
  pagedReads(`${REPO}/issues/7/comments`, () =>
    (state.comments ?? []).map((comment) => ({
      user: { type: "Bot" },
      performed_via_github_app: { id: APP_ID },
      ...comment,
    })),
  );

  scope
    .post(`${REPO}/check-runs`, (body) => written.created.checkRuns.push(body) > 0)
    .optionally()
    .reply(201, { id: 1 });
  scope
    .post(`${REPO}/issues/7/comments`, (body) => written.created.comments.push(body) > 0)
    .optionally()
    .reply(201, { id: 1 });
  const patches = (pattern: RegExp, into: { path: string; body: any }[]) =>
    scope
      .patch(pattern)
      .optionally()
      .reply(200, function (_uri, body) {
        into.push({ path: this.req.path, body });
        return {};
      });
  patches(/\/check-runs\/\d+$/, written.updated.checkRuns);
  patches(/\/issues\/comments\/\d+$/, written.updated.comments);

  return { written, requested };
}
