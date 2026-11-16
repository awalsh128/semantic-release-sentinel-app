import { describe, expect, test } from "vitest";
import { nextVersion } from "../src/version.js";

describe("nextVersion", () => {
  test("applies the bump to the highest semver tag, not the last or lexically greatest", () => {
    expect(nextVersion({ tags: ["v1.2.3", "v1.10.0", "v1.9.0"], bump: "minor" })).toEqual({
      kind: "release",
      current: "1.10.0",
      next: "1.11.0",
    });
  });

  test("a none bump releases nothing and reports the current version", () => {
    expect(nextVersion({ tags: ["v1.2.3"], bump: "none" })).toEqual({
      kind: "none",
      current: "1.2.3",
    });
  });

  test("no matching tags means no release history", () => {
    expect(nextVersion({ tags: [], bump: "minor" })).toEqual({ kind: "no-history" });
    expect(nextVersion({ tags: ["nightly", "api-v1.0.0"], bump: "minor" })).toEqual({
      kind: "no-history",
    });
  });

  test("only tags matching tagFormat count", () => {
    expect(
      nextVersion({ tags: ["v9.0.0", "api-v1.2.0", "api-v1.1.0"], bump: "patch", tagFormat: "api-v${version}" }),
    ).toEqual({ kind: "release", current: "1.2.0", next: "1.2.1" });
  });

  test("a breaking change on 0.x releases 1.0.0, as semantic-release does", () => {
    expect(nextVersion({ tags: ["v0.3.1"], bump: "major" })).toEqual({
      kind: "release",
      current: "0.3.1",
      next: "1.0.0",
    });
  });

  test("pre1Breaking minor turns a breaking change on 0.x into a minor, but not on 1.x+", () => {
    expect(nextVersion({ tags: ["v0.3.1"], bump: "major", pre1Breaking: "minor" })).toEqual({
      kind: "release",
      current: "0.3.1",
      next: "0.4.0",
    });
    expect(nextVersion({ tags: ["v1.3.1"], bump: "major", pre1Breaking: "minor" })).toEqual({
      kind: "release",
      current: "1.3.1",
      next: "2.0.0",
    });
  });

  test("prerelease tags are ignored", () => {
    expect(nextVersion({ tags: ["v1.1.0-rc.1", "v1.0.0"], bump: "minor" })).toEqual({
      kind: "release",
      current: "1.0.0",
      next: "1.1.0",
    });
  });

  describe("maintenance branches", () => {
    const tags = ["v1.4.0", "v1.4.1", "v1.5.0", "v2.0.0"];

    test("1.x releases from the highest 1.x tag, ignoring 2.x", () => {
      expect(nextVersion({ tags, bump: "minor", branch: "1.x" })).toEqual({
        kind: "release",
        current: "1.5.0",
        next: "1.6.0",
      });
    });

    test("1.4.x stays within the 1.4 line", () => {
      expect(nextVersion({ tags, bump: "patch", branch: "1.4.x" })).toEqual({
        kind: "release",
        current: "1.4.1",
        next: "1.4.2",
      });
    });

    test("a bump that leaves the branch's range is invalid, as semantic-release rejects it", () => {
      expect(nextVersion({ tags, bump: "major", branch: "1.x" })).toEqual({
        kind: "out-of-range",
        current: "1.5.0",
        next: "2.0.0",
        range: "1.x",
      });
      expect(nextVersion({ tags, bump: "minor", branch: "1.4.x" })).toEqual({
        kind: "out-of-range",
        current: "1.4.1",
        next: "1.5.0",
        range: "1.4.x",
      });
    });

    test("other branch names, like main, have no range", () => {
      expect(nextVersion({ tags, bump: "major", branch: "main" })).toEqual({
        kind: "release",
        current: "2.0.0",
        next: "3.0.0",
      });
    });
  });
});
