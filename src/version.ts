import semver from "semver";
import type { Bump } from "./bump.js";

/** semantic-release's maintenance branch names: N.x, N.x.x and N.N.x. */
const MAINTENANCE = /^\d+\.(x|x\.x|\d+\.x)$/;

/** The literal text before ${version} in a tagFormat, which every release tag starts with. */
export function tagPrefix(tagFormat = "v${version}"): string {
  return tagFormat.split("${version}")[0];
}

export type NextVersion =
  | { kind: "release"; current: string; next: string }
  | { kind: "none"; current: string }
  | { kind: "out-of-range"; current: string; next: string; range: string }
  | { kind: "no-history" };

export function nextVersion(input: {
  tags: string[];
  bump: Bump;
  /** semantic-release's tagFormat, a template containing ${version}. Defaults to v${version}. */
  tagFormat?: string;
  /** The base branch. A maintenance branch name (1.x, 1.2.x) limits the version range. */
  branch?: string;
  /** What a breaking change releases while the current version is below 1.0.0. */
  pre1Breaking?: "major" | "minor";
}): NextVersion {
  const [prefix, suffix] = (input.tagFormat ?? "v${version}").split("${version}");
  const range = input.branch !== undefined && MAINTENANCE.test(input.branch) ? input.branch : null;
  const versions = input.tags
    .filter((tag) => tag.startsWith(prefix) && tag.endsWith(suffix))
    .map((tag) => tag.slice(prefix.length, tag.length - suffix.length))
    .filter((version) => semver.valid(version) !== null && semver.prerelease(version) === null)
    .filter((version) => range === null || semver.satisfies(version, range))
    .sort(semver.rcompare);
  const current = versions[0];
  if (current === undefined) return { kind: "no-history" };
  if (input.bump === "none") return { kind: "none", current };
  const bump = input.bump === "major" && input.pre1Breaking === "minor" && semver.major(current) === 0
    ? "minor"
    : input.bump;
  const next = semver.inc(current, bump)!;
  if (range !== null && !semver.satisfies(next, range)) {
    return { kind: "out-of-range", current, next, range };
  }
  return { kind: "release", current, next };
}
