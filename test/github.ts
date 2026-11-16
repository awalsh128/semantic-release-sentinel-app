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
    reply: unknown | ((query: URLSearchParams) => unknown),
    status = 200,
    query: (query: Record<string, string>) => boolean = () => true,
  ) =>
    scope
      .get(url)
      .query(query)
      .optionally()
      .reply(function () {
        requested.push(this.req.path);
        const params = new URL(this.req.path, API).searchParams;
        return [status, typeof reply === "function" ? reply(params) : reply];
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
  reads(
    /^\/repos\/acme\/demo\/git\/matching-refs\/tags(%2F|\/)$/,
    (state.tags ?? []).map((tag) => ({ ref: `refs/tags/${tag}` })),
  );
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
  reads(
    `${REPO}/issues/7/comments`,
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
