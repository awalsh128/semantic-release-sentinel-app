import type { Context } from "probot";
import { computeBump } from "./bump.js";
import { parseConfig } from "./config.js";
import { COMMENT_MARKER, renderReport, type Report } from "./report.js";
import { nextVersion } from "./version.js";

const CONFIG_PATH = ".github/semantic-release-sentinel.yml";
const CHECK_NAME = "Release preview";

export async function handlePullRequest(context: Context<"pull_request">): Promise<void> {
  const { octokit } = context;
  const { owner, repo } = context.repo();
  const pr = context.payload.pull_request;

  const parsed = parseConfig(await readConfig(context, pr.base.ref));
  if (!parsed.ok) return;
  const config = parsed.config;

  const bump = await computeBump([pr.title], { depsBump: config.depsBump });
  const refs = await octokit.paginate(octokit.rest.git.listMatchingRefs, {
    owner,
    repo,
    ref: "tags/",
    per_page: 100,
  });
  const tags = refs.map((ref) => ref.ref.replace(/^refs\/tags\//, ""));
  const version = nextVersion({
    tags,
    bump,
    tagFormat: config.tagFormat,
    branch: pr.base.ref,
    pre1Breaking: config.pre1Breaking,
  });
  const report = renderReport(version, bump);

  await upsertCheck(context, report);
  await upsertComment(context, report.comment);
}

/** Updates this head commit's check run if it exists, so edits never stack up duplicates. */
async function upsertCheck(context: Context<"pull_request">, report: Report): Promise<void> {
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
  });
  const existing = data.check_runs[0];
  if (existing) await octokit.rest.checks.update({ ...fields, check_run_id: Number(existing.id) });
  else await octokit.rest.checks.create({ ...fields, name: CHECK_NAME, head_sha });
}

/** Updates the app's single comment on the pull request, found by its marker, or creates it. */
async function upsertComment(context: Context<"pull_request">, body: string): Promise<void> {
  const { owner, repo } = context.repo();
  const { octokit } = context;
  const issue_number = context.payload.pull_request.number;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.body?.includes(COMMENT_MARKER),
  );
  if (existing) await octokit.rest.issues.updateComment({ owner, repo, comment_id: Number(existing.id), body });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
}

async function readConfig(context: Context<"pull_request">, ref: string) {
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
