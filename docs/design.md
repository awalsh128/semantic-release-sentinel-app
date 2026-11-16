# Design

semantic-release-sentinel is a GitHub App that tells a pull request's author and reviewers what
merging it will release, before it merges. It is advisory: it never blocks a merge.

## Principles

- **Deterministic core.** The bump comes from the same Conventional Commits rules semantic-release
  uses. Any LLM use stays advisory and is never the source of a version.
- **Stateless.** Every event recomputes from git data and the pull request. No database, no
  stored results. A replayed webhook gives the same output, so redelivery is harmless.
- **Neutral by default.** Output is a check run with a `neutral` conclusion. A false positive that
  shows red gets the app uninstalled.
- **Checks API, not commit statuses.** Check runs carry a title, summary and annotations.
- **Never run untrusted PR code.** The app only reads git data and API responses. Heavy analyzers
  (v0.2) run in a companion GitHub Action under the repository's own permissions.
- **Config is read from the base branch**, never the PR head, so a pull request can't change the
  rules it is judged by.

## What it posts

Per pull request, kept current on every event:

1. One **check run**, `Release preview`, conclusion `neutral`. Title: `Releases 0.4.0 (minor)` or
   `Releases nothing`. The summary lists the commits that decided the bump.
2. One **sticky comment**, found by a hidden marker (`<!-- semantic-release-sentinel -->`) and
   updated in place, never duplicated: "merging this releases 0.4.0 (minor)".

## Computing the bump

Input depends on the merge strategy (config `merge-strategy`, default `squash`):

| Strategy | Input |
| --- | --- |
| `squash` | The PR title, which becomes the squash commit message. |
| `merge`, `rebase` | Every commit in the PR, excluding merge commits from the base branch. |

Rules follow semantic-release's commit-analyzer defaults with the `conventionalcommits` preset:
`!` or a `BREAKING CHANGE:` footer is major, `feat` is minor, `fix` and `perf` are patch, and
anything else is none. The highest bump across the input wins.

Edge cases:

| Case | Behavior |
| --- | --- |
| Revert | Patch only when the body says `This reverts commit <sha>.` (GitHub's revert button writes it). A bare `Revert "feat: x"` header, such as a PR title, releases nothing, as in semantic-release. |
| `fix(deps)` | Patch, as commit-analyzer does. Config `deps-bump` can set it to `none`. |
| Bot release commits (`chore(release): …`) | Release nothing, because `chore` does. `[skip ci]` has no effect on the bump, as in semantic-release. |
| Not a Conventional Commit | Counts as none; the summary says so. |
| Pre-1.0 breaking change | See [Pre-1.0](#pre-10). |
| Maintenance branch (`1.x`, `1.2.x`) | The next version is capped to the branch's range, as semantic-release does. |
| Target branch is not a release branch | No check, no comment. |

### Pre-1.0

Plain semantic-release releases `1.0.0` for a breaking change on `0.x`. The preview must match
what the repository's release will do, so the default is `major`. A repository that maps breaking
changes to minor below 1.0 in its own release rules sets `pre-1-0-breaking: minor`.

## Next version

The latest `v*` tag reachable from the base branch (tag format from config, default `v${version}`),
plus the bump. No tag means no release history, and the preview says so instead of guessing.

## Configuration

`.github/semantic-release-sentinel.yml` on the base branch. A missing file means defaults; an
invalid one produces a neutral check explaining the error, not a crash.

```yaml
merge-strategy: squash        # squash | merge | rebase
release-branches: [main]      # exact names or * wildcards, e.g. [main, "1.x", "release/*"]
tag-format: "v${version}"     # semantic-release's tagFormat
pre-1-0-breaking: major       # major | minor
deps-bump: patch              # patch | none: what fix(deps) releases
```

Unknown options are errors, so a typo is never silently ignored. Monorepo path scopes are planned
but not supported yet, and `paths` is rejected until they are.

## Events and security

- Subscribed: `pull_request` (`opened`, `edited`, `synchronize`, `reopened`), plus `merge_group`
  and `push` for later versions. v0.1 acts on `pull_request` only.
- Probot verifies the webhook signature. Requests that fail it are rejected.
- Deduplication: results are idempotent (check run and comment are upserted), so a replayed
  `X-GitHub-Delivery` is harmless and no delivery store is kept.
- Permissions are minimal: Metadata, Contents and Pull requests read, Checks write, and Issues
  write for the comment. See `app.yml`.

## Roadmap

| Version | Adds |
| --- | --- |
| v0.1 | Bump preview: check run and sticky comment. |
| v0.2 | Pluggable analyzers run in a companion Action; flags a mismatch between the declared bump and the real change. |
| v0.3 | Release-time verification: compare what was released with what was previewed. |
