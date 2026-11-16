import type { Bump } from "./bump.js";
import type { NextVersion } from "./version.js";

/** Hidden marker that identifies the app's sticky comment. */
export const COMMENT_MARKER = "<!-- semantic-release-sentinel -->";

/** A null comment means the check run alone is posted. */
export type Report = { title: string; summary: string; comment: string | null };

/** What the check run and the sticky comment say for a computed bump and next version. */
export function renderReport(version: NextVersion, bump: Bump): Report {
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

/** The check run for a config file that failed validation. */
export function renderConfigError(errors: string[]): Report {
  return {
    title: "Invalid configuration",
    summary: `.github/semantic-release-sentinel.yml on the base branch is invalid:\n\n${errors.map((e) => `- ${e}`).join("\n")}`,
    comment: null,
  };
}

function report(title: string, sentence: string): Report {
  const summary = `Merging ${sentence.replace(/^merging /, "")}`;
  return { title, summary, comment: `${COMMENT_MARKER}\n${sentence}` };
}
