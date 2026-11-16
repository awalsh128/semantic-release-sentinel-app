import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import nock from "nock";
import { createNodeMiddleware } from "probot";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import app from "../src/index.js";
import { createProbot, mockGitHub, pullRequestEvent } from "./github.js";

describe("pull_request events", () => {
  beforeEach(() => nock.disableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("an opened feat PR gets a neutral check run and a sticky comment with the next version", async () => {
    const github = mockGitHub({ tags: ["v0.2.0", "v0.3.0"] });

    await createProbot().receive({ name: "pull_request", payload: pullRequestEvent() as any });

    expect(github.written.created.checkRuns).toHaveLength(1);
    expect(github.written.created.checkRuns[0]).toMatchObject({
      name: "Release preview",
      head_sha: "headsha1",
      status: "completed",
      conclusion: "neutral",
      output: { title: "Releases 0.4.0 (minor)" },
    });
    expect(github.written.created.comments).toHaveLength(1);
    expect(github.written.created.comments[0].body).toContain("<!-- semantic-release-sentinel -->");
    expect(github.written.created.comments[0].body).toContain(
      "merging this releases 0.4.0 (minor)",
    );
  });

  test("an edit updates the existing check run and the app's own comment instead of adding new ones", async () => {
    const github = mockGitHub({
      tags: ["v1.0.0"],
      checkRuns: [{ id: 55 }, { id: 56, app: { id: 999 } }],
      comments: [
        { id: 97, body: "<!-- semantic-release-sentinel -->\nquoted by a person", performed_via_github_app: null, user: { type: "User" } },
        { id: 98, body: "<!-- semantic-release-sentinel -->\nfrom another app", performed_via_github_app: { id: 999 } },
        { id: 99, body: "<!-- semantic-release-sentinel -->\nold" },
      ],
    });

    await createProbot().receive({
      name: "pull_request",
      payload: pullRequestEvent({ title: "fix: handle empty input" }, { action: "edited" }) as any,
    });

    expect(github.written.created).toEqual({ checkRuns: [], comments: [] });
    expect(github.written.updated.checkRuns).toHaveLength(1);
    expect(github.written.updated.checkRuns[0].path).toBe("/repos/acme/demo/check-runs/55");
    expect(github.written.updated.checkRuns[0].body.output.title).toBe("Releases 1.0.1 (patch)");
    expect(github.written.updated.comments).toHaveLength(1);
    expect(github.written.updated.comments[0].path).toBe("/repos/acme/demo/issues/comments/99");
    expect(github.written.updated.comments[0].body.body).toContain(
      "merging this releases 1.0.1 (patch)",
    );
  });

  describe("outcomes other than a release", () => {
    const run = async (state: Parameters<typeof mockGitHub>[0], pullRequest = {}) => {
      const github = mockGitHub(state);
      await createProbot().receive({
        name: "pull_request",
        payload: pullRequestEvent(pullRequest) as any,
      });
      return {
        check: github.written.created.checkRuns[0],
        comment: github.written.created.comments[0].body as string,
      };
    };

    test("a PR that releases nothing says so", async () => {
      const { check, comment } = await run({ tags: ["v1.0.0"] }, { title: "docs: fix typo" });
      expect(check).toMatchObject({ conclusion: "neutral", output: { title: "Releases nothing" } });
      expect(comment).toContain("merging this releases nothing");
    });

    test("with no release tag it says the next version can't be previewed", async () => {
      const { check, comment } = await run({ tags: [] });
      expect(check).toMatchObject({
        conclusion: "neutral",
        output: { title: "No release history" },
      });
      expect(comment).toContain("would release a minor");
      expect(comment).toContain("no release tag");
    });

    test("a bump outside a maintenance branch's range is flagged", async () => {
      const { check, comment } = await run(
        { tags: ["v1.5.0", "v2.0.0"], config: "release-branches: ['1.x']", base: "1.x" },
        { title: "feat!: drop v1", base: { ref: "1.x", sha: "basesha1" } },
      );
      expect(check).toMatchObject({
        conclusion: "neutral",
        output: { title: "Version out of range" },
      });
      expect(comment).toContain("2.0.0");
      expect(comment).toContain("1.x");
    });
  });

  describe("release branches", () => {
    const receive = (base: string, config?: string) => {
      const github = mockGitHub({ tags: ["v1.0.0"], config, base });
      return createProbot()
        .receive({
          name: "pull_request",
          payload: pullRequestEvent({ base: { ref: base, sha: "basesha1" } }) as any,
        })
        .then(() => github);
    };

    test("a PR into a branch that is not a release branch gets nothing", async () => {
      const github = await receive("develop");
      expect(github.written.created).toEqual({ checkRuns: [], comments: [] });
      expect(github.requested.filter((path) => /matching-refs|\/pulls\//.test(path))).toEqual([]);
    });

    test("release-branches accepts exact names and * wildcards", async () => {
      const config = "release-branches: [main, 'release/*']";
      expect((await receive("release/2.0", config)).written.created.checkRuns).toHaveLength(1);
      expect((await receive("main", config)).written.created.checkRuns).toHaveLength(1);
      expect((await receive("releases", config)).written.created.checkRuns).toHaveLength(0);
    });
  });

  describe("merge strategies other than squash", () => {
    const inPrMerge = { message: "feat!: from a merged branch", parents: 2 };
    const run = async (strategy: string, commits: { message: string; sha?: string; parents?: number }[], title = "feat!: title is ignored here") => {
      const github = mockGitHub({ tags: ["v1.0.0"], config: `merge-strategy: ${strategy}`, commits });
      await createProbot().receive({ name: "pull_request", payload: pullRequestEvent({ title }) as any });
      return github.written.created;
    };

    test("merge uses the PR's commits, not its title, and keeps merge commits, which reach the base branch", async () => {
      const created = await run("merge", [{ message: "fix: a" }, { message: "feat: b" }, inPrMerge]);
      expect(created.checkRuns[0].output.title).toBe("Releases 2.0.0 (major)");
    });

    test("rebase uses the PR's commits, not its title, and skips merge commits", async () => {
      const created = await run("rebase", [{ message: "fix: a" }, { message: "feat: b" }, inPrMerge]);
      expect(created.checkRuns[0].output.title).toBe("Releases 1.1.0 (minor)");
    });

    test("a commit and the later commit that reverts it cancel out", async () => {
      // GitHub lists a PR's commits oldest first.
      const created = await run("rebase", [
        { sha: "abc123", message: "feat: x" },
        { sha: "def456", message: 'Revert "feat: x"\n\nThis reverts commit abc123.' },
      ]);
      expect(created.checkRuns[0].output.title).toBe("Releases nothing");
    });

    // `commits` in the payload is the PR's real commit count; GitHub lists at most 250 of them.
    const listedAtLimit = Array.from({ length: 250 }, (_, i) => ({ message: `docs: note ${i}` }));
    const runWithCount = async (count: number) => {
      const github = mockGitHub({ tags: ["v1.0.0"], config: "merge-strategy: rebase", commits: listedAtLimit });
      await createProbot().receive({
        name: "pull_request",
        payload: pullRequestEvent({ commits: count }) as any,
      });
      return github.written.created;
    };

    test("a PR with more commits than GitHub lists says the bump may be inaccurate", async () => {
      const created = await runWithCount(300);
      expect(created.comments[0].body).toContain("first 250 commits");
      expect(created.comments[0].body).toContain("inaccurate");
      expect(created.checkRuns[0].output.summary).toContain("first 250 commits");
    });

    test("a PR with exactly 250 commits is fully analyzed and gets no note", async () => {
      const created = await runWithCount(250);
      expect(created.comments[0].body).not.toContain("first 250 commits");
    });
  });

  describe("output that is no longer true is updated, not left behind", () => {
    const existing = {
      checkRuns: [{ id: 55 }],
      comments: [{ id: 99, body: "<!-- semantic-release-sentinel -->\nmerging this releases 0.4.0 (minor)" }],
    };

    test("retargeting a PR to a branch that does not release says so", async () => {
      const github = mockGitHub({ tags: ["v0.3.0"], base: "develop", ...existing });
      await createProbot().receive({
        name: "pull_request",
        payload: pullRequestEvent({ base: { ref: "develop", sha: "basesha1" } }, { action: "edited" }) as any,
      });

      expect(github.written.created).toEqual({ checkRuns: [], comments: [] });
      expect(github.written.updated.checkRuns[0].body.output.title).toBe("Not a release branch");
      expect(github.written.updated.comments[0].body.body).toContain("not a release branch");
    });

    test("a config that turns invalid pauses the existing comment", async () => {
      const github = mockGitHub({ config: "merge-strategy: yolo", ...existing });
      await createProbot().receive({ name: "pull_request", payload: pullRequestEvent({}, { action: "edited" }) as any });

      expect(github.written.created).toEqual({ checkRuns: [], comments: [] });
      expect(github.written.updated.checkRuns[0].body.output.title).toBe("Invalid configuration");
      expect(github.written.updated.comments[0].body.body).toContain("paused");
    });
  });

  test("an invalid config gives a neutral check listing the errors and no comment", async () => {
    const github = mockGitHub({ config: "merge-strategy: yolo\npaths: {}" });

    await createProbot().receive({ name: "pull_request", payload: pullRequestEvent() as any });

    expect(github.written.created.comments).toEqual([]);
    expect(github.written.created.checkRuns).toHaveLength(1);
    const check = github.written.created.checkRuns[0];
    expect(check).toMatchObject({
      conclusion: "neutral",
      output: { title: "Invalid configuration" },
    });
    expect(check.output.summary).toContain("'merge-strategy' must be one of: squash, merge, rebase.");
    expect(check.output.summary).toContain("Unknown option 'paths'.");
    expect(check.output.summary).toContain(".github/semantic-release-sentinel.yml");
  });

  describe("webhook signatures", () => {
    const SECRET = "test-secret";
    const body = JSON.stringify(pullRequestEvent());

    /** Sends a delivery to the app's real HTTP endpoint and returns the status code. */
    async function deliver(signature: string): Promise<number> {
      const probot = createProbot(SECRET, false);
      const middleware = await createNodeMiddleware(app, { probot, webhooksPath: "/webhooks" });
      const server = http.createServer(middleware);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        nock.enableNetConnect("127.0.0.1");
        const { port } = server.address() as AddressInfo;
        const status = await new Promise<number>((resolve, reject) => {
          const request = http.request(
            {
              host: "127.0.0.1",
              port,
              path: "/webhooks",
              method: "POST",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
                "x-github-event": "pull_request",
                "x-github-delivery": "delivery-1",
                "x-hub-signature-256": signature,
              },
            },
            (response) => {
              response.resume();
              response.on("end", () => resolve(response.statusCode ?? 0));
            },
          );
          request.on("error", reject);
          request.end(body);
        });
        return status;
      } finally {
        server.close();
      }
    }

    test("a delivery with a bad signature is rejected and nothing is written", async () => {
      const github = mockGitHub({ tags: ["v1.0.0"] });
      expect(await deliver("sha256=" + "0".repeat(64))).toBe(400);
      expect(github.written.created).toEqual({ checkRuns: [], comments: [] });
    });

    test("a correctly signed delivery is processed", async () => {
      const github = mockGitHub({ tags: ["v1.0.0"] });
      const signature = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
      expect(await deliver(signature)).toBe(200);
      await vi.waitFor(() => expect(github.written.created.checkRuns).toHaveLength(1));
    });
  });

  test("a failed lookup of the app's own id is retried on the next event, not cached", async () => {
    const probot = createProbot();
    nock("https://api.github.com").get("/app").reply(500, { message: "Server Error" });
    await expect(
      probot.receive({ name: "pull_request", payload: pullRequestEvent() as any }),
    ).rejects.toThrow();

    const github = mockGitHub({ tags: ["v1.0.0"] });
    await probot.receive({ name: "pull_request", payload: pullRequestEvent() as any });

    expect(github.written.created.checkRuns).toHaveLength(1);
  });
});
