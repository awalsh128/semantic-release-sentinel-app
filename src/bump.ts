import createPreset from "conventional-changelog-conventionalcommits";
import { CommitParser } from "conventional-commits-parser";

export type Bump = "major" | "minor" | "patch" | "none";

const BY_TYPE: Record<string, Bump> = { feat: "minor", fix: "patch", perf: "patch" };
const ORDER: Bump[] = ["none", "patch", "minor", "major"];

/** The highest release type implied by the given commit messages, as semantic-release computes it. */
export async function computeBump(
  messages: string[],
  options: { depsBump?: "patch" | "none" } = {},
): Promise<Bump> {
  const preset = await createPreset();
  const parser = new CommitParser(preset.parser);
  let result: Bump = "none";
  for (const message of messages) {
    const bump = bumpOf(parser.parse(message), options);
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
