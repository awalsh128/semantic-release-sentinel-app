import nock from "nock";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
      checkRuns: [{ id: 55 }],
      comments: [
        { id: 98, body: "<!-- semantic-release-sentinel --> quoted by a person", user: { type: "User" } },
        { id: 99, body: "<!-- semantic-release-sentinel -->\nold", user: { type: "Bot" } },
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
});
