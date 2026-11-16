import { describe, expect, test } from "vitest";
import { parseConfig } from "../src/config.js";

const DEFAULTS = {
  mergeStrategy: "squash",
  releaseBranches: ["main"],
  tagFormat: "v${version}",
  pre1Breaking: "major",
  depsBump: "patch",
};

describe("parseConfig", () => {
  test.each([undefined, "", "# only a comment\n"])("%j gives the defaults", (text) => {
    expect(parseConfig(text)).toEqual({ ok: true, config: DEFAULTS });
  });

  test("file values override defaults; omitted keys keep theirs", () => {
    const text = `
merge-strategy: rebase
release-branches: [main, "1.x"]
pre-1-0-breaking: minor
deps-bump: none
tag-format: "api-v\${version}"
`;
    expect(parseConfig(text)).toEqual({
      ok: true,
      config: {
        mergeStrategy: "rebase",
        releaseBranches: ["main", "1.x"],
        tagFormat: "api-v${version}",
        pre1Breaking: "minor",
        depsBump: "none",
      },
    });
    expect(parseConfig("merge-strategy: merge")).toEqual({
      ok: true,
      config: { ...DEFAULTS, mergeStrategy: "merge" },
    });
  });

  describe("invalid files return every problem", () => {
    const errorsOf = (text: string) => {
      const result = parseConfig(text);
      if (result.ok) throw new Error("expected errors");
      return result.errors;
    };

    test("malformed YAML", () => {
      expect(errorsOf("merge-strategy: [squash")).toHaveLength(1);
      expect(errorsOf("merge-strategy: [squash")[0]).toMatch(/^Invalid YAML: /);
    });

    test("not a mapping", () => {
      expect(errorsOf("- squash")).toEqual(["The file must be a YAML mapping of options."]);
    });

    test("unknown keys, including monorepo paths that are not supported yet", () => {
      expect(errorsOf("paths: {}\nmerge-strategyy: squash")).toEqual([
        "Unknown option 'paths'.",
        "Unknown option 'merge-strategyy'.",
      ]);
    });

    test("bad values", () => {
      expect(
        errorsOf(
          "merge-strategy: fast-forward\nrelease-branches: main\npre-1-0-breaking: patch\ndeps-bump: minor\ntag-format: v1",
        ),
      ).toEqual([
        "'merge-strategy' must be one of: squash, merge, rebase.",
        "'release-branches' must be a list of branch names.",
        "'pre-1-0-breaking' must be one of: major, minor.",
        "'deps-bump' must be one of: patch, none.",
        "'tag-format' must contain ${version}.",
      ]);
    });
  });
});
