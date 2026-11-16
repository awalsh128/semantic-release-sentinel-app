import type { Context, Probot } from "probot";
import { computeBump, type CommitInput } from "./bump.js";
import { parseConfig, type Config } from "./config.js";
import {
  COMMENT_MARKER,
  renderConfigError,
  renderNotReleaseBranch,
  renderReport,
  type Report,
} from "./report.js";
import { nextVersion } from "./version.js";

const CONFIG_PATH = ".github/semantic-release-sentinel.yml";
const CHECK_NAME = "Release preview";
/** GitHub's pulls.listCommits returns at most this many commits. */
const COMMIT_LIST_LIMIT = 250;

type PullRequestContext = Context<"pull_request">;

/**
 * "upsert" creates the output if it is missing. "update-only" only refreshes output that already
 * exists, so a pull request that has nothing to preview never gets new noise, but an earlier
 * "releases X" is not left standing once it stops being true.
 */
type Mode = "upsert" | "update-only";

export function createHandler(app: Probot) {
  // This app's own id, used to ignore check runs and comments from anyone else. Looked up once.
  let appId: Promise<number> | undefined;
  const ownAppId = () =>
    (appId ??= app
      .auth()
      .then((octokit) => octokit.rest.apps.getAuthenticated())
      .then(({ data }) => data!.id));

  return async function handlePullRequest(context: PullRequestContext): Promise<void> {
    const { octokit } = context;
    const { owner, repo } = context.repo();
    const pr = context.payload.pull_request;
    const id = await ownAppId();

    // Read from the base branch, never the head, so a pull request can't change its own rules.
    const parsed = parseConfig(await readConfig(context, pr.base.ref));
    if (!parsed.ok) {
      await publish(context, id, renderConfigError(parsed.errors), {
        check: "upsert",
        comment: "update-only",
      });
      return;
    }
    const config = parsed.config;
    if (!isReleaseBranch(pr.base.ref, config.releaseBranches)) {
      await publish(context, id, renderNotReleaseBranch(pr.base.ref), {
        check: "update-only",
        comment: "update-only",
      });
      return;
    }

    const { commits, truncated } = await pullRequestCommits(context, config.mergeStrategy);
    const bump = await computeBump(commits, { depsBump: config.depsBump });
    const refs = await octokit.paginate(octokit.rest.git.listMatchingRefs, {
      owner,
      repo,
      ref: "tags/",
      per_page: 100,
    });
    const version = nextVersion({
      tags: refs.map((ref) => ref.ref.replace(/^refs\/tags\//, "")),
      bump,
      tagFormat: config.tagFormat,
      branch: pr.base.ref,
      pre1Breaking: config.pre1Breaking,
    });
    const notes = truncated
      ? [
          `Only the first ${COMMIT_LIST_LIMIT} commits of this pull request were analyzed (GitHub's listing limit), so the bump may be understated.`,
        ]
      : [];
    await publish(context, id, renderReport(version, bump, notes), {
      check: "upsert",
      comment: "upsert",
    });
  };
}

async function publish(
  context: PullRequestContext,
  appId: number,
  report: Report,
  modes: { check: Mode; comment: Mode },
): Promise<void> {
  await writeCheck(context, appId, report, modes.check);
  if (report.comment !== null) await writeComment(context, appId, report.comment, modes.comment);
}

/** Writes this app's check run for the head commit, found by name and app so edits never stack up. */
async function writeCheck(
  context: PullRequestContext,
  appId: number,
  report: Report,
  mode: Mode,
): Promise<void> {
  const { owner, repo } = context.repo();
  const { octokit } = context;
  const head_sha = context.payload.pull_request.head.sha;
  const fields = {
    owner,
    repo,
    status: "completed" as const,
    conclusion: "neutral" as const,
    output: { title: report.title, summary: report.summary },
  };
  const { data } = await octokit.rest.checks.listForRef({
    owner,
    repo,
    ref: head_sha,
    check_name: CHECK_NAME,
    app_id: appId,
  });
  const existing = data.check_runs[0];
  if (existing) await octokit.rest.checks.update({ ...fields, check_run_id: Number(existing.id) });
  else if (mode === "upsert") {
    await octokit.rest.checks.create({ ...fields, name: CHECK_NAME, head_sha });
  }
}

/** Writes the app's single comment on the pull request, found by its marker and by being ours. */
async function writeComment(
  context: PullRequestContext,
  appId: number,
  body: string,
  mode: Mode,
): Promise<void> {
  const { owner, repo } = context.repo();
  const { octokit } = context;
  const issue_number = context.payload.pull_request.number;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  // Another bot (or a person quoting us) can carry the marker; only touch what this app posted.
  const existing = comments.find(
    (comment) =>
      comment.performed_via_github_app?.id === appId && comment.body?.includes(COMMENT_MARKER),
  );
  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: Number(existing.id), body });
  } else if (mode === "upsert") {
    await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
  }
}

/**
 * What semantic-release will analyze after the merge, newest first like `git log`: the PR title
 * if squashed, else the PR's commits. Merge commits count for `merge`, where they reach the base
 * branch, and not for `rebase`, where GitHub replays only the PR's own commits.
 */
async function pullRequestCommits(
  context: PullRequestContext,
  strategy: Config["mergeStrategy"],
): Promise<{ commits: CommitInput[]; truncated: boolean }> {
  const pr = context.payload.pull_request;
  if (strategy === "squash") return { commits: [pr.title], truncated: false };
  const { owner, repo } = context.repo();
  const listed = await context.octokit.paginate(context.octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const commits = listed
    .filter((commit) => strategy === "merge" || commit.parents.length <= 1)
    .map((commit) => ({ hash: commit.sha, message: commit.commit.message }))
    .reverse();
  return { commits, truncated: listed.length >= COMMIT_LIST_LIMIT };
}

/** True when the branch equals a configured name or matches a pattern, where * matches any characters. */
function isReleaseBranch(branch: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const source = pattern.split("*").map(escapeRegExp).join(".*");
    return new RegExp(`^${source}$`).test(branch);
  });
}

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

async function readConfig(context: PullRequestContext, ref: string) {
  const { owner, repo } = context.repo();
  try {
    const { data } = await context.octokit.rest.repos.getContent({
      owner,
      repo,
      path: CONFIG_PATH,
      ref,
    });
    if (Array.isArray(data) || data.type !== "file") return undefined;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}
