import type { Bump } from "./bump.js";
import type { NextVersion } from "./version.js";

/** Hidden marker that identifies the app's sticky comment. */
export const COMMENT_MARKER = "<!-- semantic-release-sentinel -->";

export type Report = { title: string; summary: string; comment: string | null };

/** What the check run and the sticky comment say for a computed bump and next version. */
export function renderReport(version: NextVersion, bump: Bump, notes: string[] = []): Report {
  const result = renderOutcome(version, bump);
  if (notes.length === 0) return result;
  const extra = notes.map((note) => `\n\n> ${note}`).join("");
  return {
    ...result,
    summary: result.summary + extra,
    comment: result.comment === null ? null : result.comment + extra,
  };
}

function renderOutcome(version: NextVersion, bump: Bump): Report {
  switch (version.kind) {
    case "release": {
      const text = `${version.next} (${bump}), up from ${version.current}`;
      return report(`Releases ${version.next} (${bump})`, `merging this releases ${text}.`);
    }
    case "none":
      return report(
        "Releases nothing",
        `merging this releases nothing. No commit is a feat, fix, perf or breaking change; the latest release stays ${version.current}.`,
      );
    case "no-history":
      return report(
        "No release history",
        bump === "none"
          ? "merging this releases nothing, and no release tag was found."
          : `merging this would release a ${bump}, but no release tag was found, so the next version can't be previewed.`,
      );
    case "out-of-range":
      return report(
        "Version out of range",
        `merging this would release ${version.next} (${bump}), which is outside this branch's range ${version.range}. semantic-release rejects that on a maintenance branch.`,
      );
  }
}

/** For a pull request whose base branch does not release; only ever updates existing output. */
export function renderNotReleaseBranch(branch: string): Report {
  return report(
    "Not a release branch",
    `this pull request targets \`${branch}\`, which is not a release branch, so merging it releases nothing from there.`,
  );
}

/** The check run for a config file that failed validation. */
export function renderConfigError(errors: string[]): Report {
  return {
    title: "Invalid configuration",
    summary: `.github/semantic-release-sentinel.yml on the base branch is invalid:\n\n${errors.map((e) => `- ${e}`).join("\n")}`,
    comment: `${COMMENT_MARKER}\nthe release preview is paused: .github/semantic-release-sentinel.yml on the base branch is invalid. See the Release preview check for details.`,
  };
}

function report(title: string, sentence: string): Report {
  const summary = `Merging ${sentence.replace(/^merging /, "")}`;
  return { title, summary, comment: `${COMMENT_MARKER}\n${sentence}` };
}
