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

export function createProbot(): Probot {
  const probot = new Probot({
    appId: 123,
    privateKey,
    // No throttling or retries, so failures show up at once.
    Octokit: ProbotOctokit.defaults((options: {}) => ({
      ...options,
      retry: { enabled: false },
      throttle: { enabled: false },
    })),
  });
  probot.load(app);
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

export type RepoState = {
  /** Text of .github/semantic-release-sentinel.yml on the base branch; absent means 404. */
  config?: string;
  tags?: string[];
  /** Commits of the pull request, for the merge and rebase strategies. */
  commits?: { message: string; parents?: number }[];
  checkRuns?: { id: number }[];
  comments?: { id: number; body: string; user: { type: string } }[];
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

  const reads = (url: string | RegExp, reply: unknown, status = 200) =>
    scope
      .get(url)
      .query(true)
      .optionally()
      .reply(function () {
        requested.push(this.req.path);
        return [status, reply];
      });

  reads(
    // Octokit encodes the slash in the path; GitHub accepts both forms.
    /^\/repos\/acme\/demo\/contents\/\.github(%2F|\/)semantic-release-sentinel\.yml/,
    state.config === undefined
      ? { message: "Not Found" }
      : { type: "file", encoding: "base64", content: Buffer.from(state.config).toString("base64") },
    state.config === undefined ? 404 : 200,
  );
  reads(
    /^\/repos\/acme\/demo\/git\/matching-refs\/tags(%2F|\/)$/,
    (state.tags ?? []).map((tag) => ({ ref: `refs/tags/${tag}` })),
  );
  reads(
    `${REPO}/pulls/7/commits`,
    (state.commits ?? []).map((c) => ({
      commit: { message: c.message },
      parents: Array.from({ length: c.parents ?? 1 }, () => ({ sha: "p" })),
    })),
  );
  reads(`${REPO}/commits/headsha1/check-runs`, {
    total_count: (state.checkRuns ?? []).length,
    check_runs: state.checkRuns ?? [],
  });
  reads(`${REPO}/issues/7/comments`, state.comments ?? []);

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
