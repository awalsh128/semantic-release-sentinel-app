import { parse } from "yaml";

export type Config = {
  mergeStrategy: "squash" | "merge" | "rebase";
  releaseBranches: string[];
  tagFormat: string;
  pre1Breaking: "major" | "minor";
  depsBump: "patch" | "none";
};

export type ParsedConfig = { ok: true; config: Config } | { ok: false; errors: string[] };

const DEFAULTS: Config = {
  mergeStrategy: "squash",
  releaseBranches: ["main"],
  tagFormat: "v${version}",
  pre1Breaking: "major",
  depsBump: "patch",
};

type Option = { key: keyof Config; check: (value: unknown) => string | null };

const oneOf = (name: string, allowed: string[]) => (value: unknown) =>
  typeof value === "string" && allowed.includes(value)
    ? null
    : `'${name}' must be one of: ${allowed.join(", ")}.`;

const OPTIONS: Record<string, Option> = {
  "merge-strategy": {
    key: "mergeStrategy",
    check: oneOf("merge-strategy", ["squash", "merge", "rebase"]),
  },
  "release-branches": {
    key: "releaseBranches",
    check: (value) =>
      Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
        ? null
        : "'release-branches' must be a list of branch names.",
  },
  "tag-format": {
    key: "tagFormat",
    check: (value) =>
      typeof value === "string" && value.includes("${version}")
        ? null
        : "'tag-format' must contain ${version}.",
  },
  "pre-1-0-breaking": {
    key: "pre1Breaking",
    check: oneOf("pre-1-0-breaking", ["major", "minor"]),
  },
  "deps-bump": { key: "depsBump", check: oneOf("deps-bump", ["patch", "none"]) },
};

/** Parses the text of .github/semantic-release-sentinel.yml; undefined means the file is absent. */
export function parseConfig(text: string | undefined): ParsedConfig {
  let raw: unknown;
  try {
    raw = parse(text ?? "") ?? {};
  } catch (error) {
    return { ok: false, errors: [`Invalid YAML: ${(error as Error).message}`] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["The file must be a YAML mapping of options."] };
  }

  const errors: string[] = [];
  const config: Record<string, unknown> = { ...DEFAULTS };
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const option = OPTIONS[name];
    if (option === undefined) {
      errors.push(`Unknown option '${name}'.`);
      continue;
    }
    const error = option.check(value);
    if (error === null) config[option.key] = value;
    else errors.push(error);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config: config as Config };
}
