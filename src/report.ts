import type { Bump } from "./bump.js";
import type { NextVersion } from "./version.js";

/** Hidden marker that identifies the app's sticky comment. */
export const COMMENT_MARKER = "<!-- semantic-release-sentinel -->";

export type Report = { title: string; summary: string; comment: string };

export function renderReport(version: NextVersion, bump: Bump): Report {
  if (version.kind !== "release") throw new Error(`Unsupported result: ${version.kind}`);
  const title = `Releases ${version.next} (${bump})`;
  const detail = `up from ${version.current}`;
  return {
    title,
    summary: `Merging this pull request releases ${version.next} (${bump}), ${detail}.`,
    comment: `${COMMENT_MARKER}\nmerging this releases ${version.next} (${bump}), ${detail}.`,
  };
}
