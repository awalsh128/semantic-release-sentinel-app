import { describe, expect, test } from "vitest";
import { computeBump } from "../src/bump.js";

// Expected values come from running @semantic-release/commit-analyzer (conventionalcommits
// preset) on the same messages, so they are an independent source of truth.
describe("computeBump", () => {
  test("feat releases a minor", async () => {
    expect(await computeBump(["feat: add thing"])).toBe("minor");
  });

  test.each(["fix: a", "perf: a", "fix(deps): bump x"])("%s releases a patch", async (message) => {
    expect(await computeBump([message])).toBe("patch");
  });

  test.each(["docs: a", "chore(release): 1.2.0 [skip ci]", "wip stuff", "feat : bad header"])(
    "%s releases nothing",
    async (message) => {
      expect(await computeBump([message])).toBe("none");
    },
  );

  test.each([
    "feat(api)!: drop v1",
    "fix!: z",
    "fix: a\n\nBREAKING CHANGE: x",
    "feat: a\n\nBREAKING-CHANGE: x",
    "fix: a\n\nbreaking change: x",
  ])("%j releases a major", async (message) => {
    expect(await computeBump([message])).toBe("major");
  });

  // GitHub's revert button writes this body; the header alone is not a revert to semantic-release.
  test("a revert with the 'This reverts commit' body releases a patch", async () => {
    expect(await computeBump(['Revert "feat: a"\n\nThis reverts commit abc123.'])).toBe("patch");
  });

  test("a revert header without that body releases nothing", async () => {
    expect(await computeBump(['Revert "feat: a"'])).toBe("none");
  });

  test("the highest bump across all messages wins", async () => {
    expect(await computeBump(["docs: a", "fix: b", "feat: c"])).toBe("minor");
    expect(await computeBump(["feat: a", "fix!: b", "fix: c"])).toBe("major");
  });

  test("no messages release nothing", async () => {
    expect(await computeBump([])).toBe("none");
  });

  test("fix(deps) releases nothing when deps-bump is none, other fixes still patch", async () => {
    expect(await computeBump(["fix(deps): bump x"], { depsBump: "none" })).toBe("none");
    expect(await computeBump(["fix(deps): bump x", "fix: real"], { depsBump: "none" })).toBe(
      "patch",
    );
  });

  // Commits are newest first, like `git log`, which is the order semantic-release analyzes them in.
  describe("a commit and its revert cancel out, as in commit-analyzer", () => {
    const feat = { hash: "abc123", message: "feat: x" };
    const revert = { hash: "def456", message: 'Revert "feat: x"\n\nThis reverts commit abc123.' };

    test("both in the set release nothing", async () => {
      expect(await computeBump([revert, feat])).toBe("none");
    });

    test("other commits still count", async () => {
      expect(await computeBump([{ hash: "999", message: "fix: y" }, revert, feat])).toBe("patch");
    });

    test("a revert of a commit outside the set still releases a patch", async () => {
      expect(await computeBump([{ hash: "zzz", message: "docs: a" }, revert])).toBe("patch");
    });
  });
});
