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

1. One **check run**, `Release preview`, conclusion `neutral`, updated in place on the same head
   commit and recreated for a new one. Title: `Releases 0.4.0 (minor)` or
   `Releases nothing`. Only this app's own check run is touched: it is matched by name and app id.
2. One **sticky comment**, found by a hidden marker (`<!-- semantic-release-sentinel -->`) and
   updated in place: "merging this releases 0.4.0 (minor)". Only a comment this app posted is
   touched, matched by the marker and the app id.

When there is nothing to preview, output that already exists is updated and none is created: a pull
request retargeted to a non-release branch gets "Not a release branch", and a base config that
turns invalid gets an "Invalid configuration" check and a paused comment, so a stale "releases X"
never stays up. A repository with an invalid config gets the check on every pull request.

## Computing the bump

Input depends on the merge strategy (config `merge-strategy`, default `squash`):

| Strategy | Input |
| --- | --- |
| `squash` | The PR title, which becomes the squash commit message. |
| `merge` | Every commit in the PR, including merge commits, which reach the base branch. |
| `rebase` | Every commit in the PR except merge commits; GitHub replays only the PR's own commits. |

Commits are analyzed newest first, like `git log`, and a commit is dropped together with the
revert that undoes it, as in commit-analyzer. GitHub lists at most 250 commits per pull request;
past that, going by the commit count in the webhook payload, the preview says the bump may be
inaccurate (cut-off commits can also hide a revert, so it can be overstated).

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
| Target branch is not a release branch | Nothing is created. An existing check and comment are updated to "Not a release branch". |

### Pre-1.0

Plain semantic-release releases `1.0.0` for a breaking change on `0.x`. The preview must match
what the repository's release will do, so the default is `major`. A repository that maps breaking
changes to minor below 1.0 in its own release rules sets `pre-1-0-breaking: minor`.

## Next version

The highest release tag in the repository that matches the tag format (config `tag-format`, default
`v${version}`), plus the bump. Prerelease tags are ignored. Tags are not checked for reachability
from the base branch yet, so a tag that exists only on another branch can be picked up. No tag means no release history, and the preview says so instead of guessing.

## Known limitations

- **Squash uses the PR title only.** By default GitHub builds the squash commit from the commits:
  a one-commit PR merges with that commit's title, and a multi-commit PR's message lists the
  commits. So the PR title can differ from what semantic-release sees. Reading the repository's
  `squash_merge_commit_title` and `squash_merge_commit_message` settings would fix it; for now,
  set the repository to use the PR title and body for squash merges.
- **Concurrent deliveries can duplicate the comment.** Two events handled at the same moment can
  each see no comment and create one. The second then goes stale. It is rare and harmless, and a
  fix (re-list and delete the newer duplicate) is not worth the extra calls yet.
- **Tags are not checked for reachability** from the base branch.
- **API calls per event are bounded.** Only tags that start with the `tag-format` prefix are
  listed, and only the first 1,000 of them. GitHub lists tags alphabetically, so in a repository
  with more, the highest version can be missed; the preview then says the next version may be
  inaccurate. Only the first 500 comments on a pull request are scanned for the app's own, which is
  created with the first preview. In a thread that long a missing comment is created again. Without
  the caps, a repository with many tags or comments would cost many calls on every event.

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
