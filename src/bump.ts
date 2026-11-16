import createPreset from "conventional-changelog-conventionalcommits";
import { filterRevertedCommitsSync } from "conventional-commits-filter";
import { CommitParser } from "conventional-commits-parser";

export type Bump = "major" | "minor" | "patch" | "none";

/** A commit message, with its hash when known so a revert can be paired with its target. */
export type CommitInput = string | { message: string; hash?: string };

const BY_TYPE: Record<string, Bump> = { feat: "minor", fix: "patch", perf: "patch" };
const ORDER: Bump[] = ["none", "patch", "minor", "major"];

/**
 * The highest release type implied by the given commits, as semantic-release computes it.
 * Commits are newest first, like `git log`, so a revert comes before the commit it undoes.
 */
export async function computeBump(
  commits: CommitInput[],
  options: { depsBump?: "patch" | "none" } = {},
): Promise<Bump> {
  const preset = await createPreset();
  const parser = new CommitParser(preset.parser);
  const parsed = commits.map((input) => {
    const { message, hash } = typeof input === "string" ? { message: input, hash: undefined } : input;
    return Object.assign(parser.parse(message), { hash: hash ?? null });
  });

  let result: Bump = "none";
  // Like commit-analyzer, drop a commit together with the revert that undoes it.
  // The filter's Commit type is a loose index signature that the parser's output doesn't satisfy.
  const kept = filterRevertedCommitsSync(parsed as never) as Iterable<(typeof parsed)[number]>;
  for (const commit of kept) {
    const bump = bumpOf(commit, options);
    if (ORDER.indexOf(bump) > ORDER.indexOf(result)) result = bump;
  }
  return result;
}

function bumpOf(commit: ReturnType<CommitParser["parse"]>, options: { depsBump?: string }): Bump {
  if (commit.notes.length > 0) return "major";
  if (commit.revert) return "patch";
  if (commit.type === "fix" && commit.scope === "deps" && options.depsBump === "none") return "none";
  return BY_TYPE[commit.type ?? ""] ?? "none";
}
