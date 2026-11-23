<p align="center">
  <img src="assets/icon.png" alt="Semantic Release Sentinel logo" width="128" height="128">
</p>

<h1 align="center">Semantic Release Sentinel</h1>

<p align="center">
  A <a href="https://github.com/probot/probot">Probot</a> GitHub App that previews the version each pull request will release under <a href="https://semantic-release.gitbook.io">semantic-release</a>.
</p>

<p align="center">
  <a href="https://github.com/awalsh128/semantic-release-sentinel-app/releases"><img src="https://img.shields.io/github/v/release/awalsh128/semantic-release-sentinel-app?label=release" alt="GitHub release"></a>
  <a href="https://github.com/awalsh128/semantic-release-sentinel-app/actions/workflows/ci.yml?query=branch%3Astaging"><img src="https://img.shields.io/github/actions/workflow/status/awalsh128/semantic-release-sentinel-app/ci.yml?label=staging&branch=staging" alt="staging CI"></a>
  <a href="https://github.com/awalsh128/semantic-release-sentinel-app/blob/main/LICENSE"><img src="https://img.shields.io/github/license/awalsh128/semantic-release-sentinel-app" alt="License"></a>
</p>

A [Probot](https://github.com/probot/probot) GitHub App that shows, on every pull request, what merging it
will release under [semantic-release](https://semantic-release.gitbook.io).

- 🔮 **Release preview**: see the next version and bump (major, minor, patch or none) before you merge.
- 💬 **Check run and sticky comment**: one neutral check and one comment per pull request, updated in place.
- 🔀 **Merge strategies**: analyzes the PR title for squash, or the commits for merge and rebase.
- 🌿 **Branch-aware**: release branches, wildcards and maintenance ranges like `1.x`.
- 🔒 **Safe by design**: stateless, read-only, advisory, and never runs code from a pull request.

<!-- prettier-ignore -->
<p align="center">
  <a href="https://github.com/sponsors/awalsh128"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor awalsh128"></a>
</p>

<p align="center">
  Free and open source, and kept up by one person.<br />
  If it saves you time, <a href="https://github.com/sponsors/awalsh128">sponsor it monthly</a> or
  <a href="https://github.com/sponsors/awalsh128?frequency=one-time">leave a small one-time tip</a>. Every bit
  helps.
</p>

## Quick Start

1. Register a GitHub App from [`app.yml`](app.yml): permissions Metadata, Contents and Pull
   requests (read), Checks and Issues (write); events `pull_request`, `merge_group` and `push`.
   Only `pull_request` is acted on for now. The manifest doesn't update an existing App, so mirror
   changes in the App's settings.
2. Run the app with `APP_ID`, `PRIVATE_KEY` and `WEBHOOK_SECRET` set (see [`.env.example`](.env.example)),
   and install the App on your repositories.
3. Optionally add `.github/semantic-release-sentinel.yml` to the repository's base branch.

## What it posts

On every pull request into a release branch it works out the version bump from the
[Conventional Commits](https://www.conventionalcommits.org) semantic-release will see, and posts:

- a **check run**, `Release preview`, always neutral, titled for example `Releases 0.4.0 (minor)`
  or `Releases nothing`;
- one **comment**, updated in place: "merging this releases 0.4.0 (minor), up from 0.3.0."

It is advisory and never blocks a merge. It is stateless (it recomputes from git data on every
event), reads only git data and API responses, and never runs code from a pull request. See the
[design](docs/design.md) for the rules and edge cases.

## Configuration

Every option is optional. The file is read from the **base branch**, never the pull request, so a
pull request can't change the rules it is judged by.

```yaml
merge-strategy: squash # squash | merge | rebase
release-branches: [main] # exact names or * wildcards, e.g. [main, "1.x", "release/*"]
tag-format: "v${version}" # semantic-release's tagFormat
pre-1-0-breaking: major # major | minor
deps-bump: patch # patch | none: what fix(deps) releases
```

- `merge-strategy` decides what is analyzed: the PR title for `squash`, the PR's commits for
  `merge` and `rebase`. Set it to how your repository merges.
- `pre-1-0-breaking` is what a breaking change releases below 1.0.0. Plain semantic-release
  releases `1.0.0`, so that is the default; use `minor` only if your own release rules map it so.
- Unknown options are errors, shown in the check run, so a typo is never silently ignored.

## Limitations

- **Squash uses the PR title only.** GitHub's default squash message is built from the commits, so
  set the repository's squash merge default to the PR title and description, or the preview can
  differ from the real release.
- Tags aren't checked for reachability from the base branch, and prerelease tags are ignored. Only
  the first 1,000 matching tags are read; beyond that the preview says it may be inaccurate.
- GitHub lists at most 250 commits per pull request; beyond that the preview says it may be
  inaccurate.
- Monorepo path scopes aren't supported yet.

## Development

```sh
npm install
npx vitest run        # tests (plain `npm test` starts watch mode)
npx tsc --noEmit      # type-check
npm run build         # compile to lib/
npm start             # run the bot
```

## Docker

A published image is at `ghcr.io/awalsh128/semantic-release-sentinel-app` (tags `latest` and the
release version). It runs as the unprivileged `node` user.

```sh
# 1. Build the container (or pull the published image)
docker build -t semantic-release-sentinel-app .

# 2. Start it. Probot listens on localhost by default, which isn't reachable from outside the
#    container, so set HOST. GitHub sends webhooks to /api/github/webhooks.
docker run -d -p 3000:3000 -e HOST=0.0.0.0 \
  -e APP_ID=<app-id> -e WEBHOOK_SECRET=<secret> -e PRIVATE_KEY="$(cat <key>.pem)" \
  semantic-release-sentinel-app
```

Put it behind HTTPS, and expose only the webhook path. `PRIVATE_KEY_PATH` with a mounted file works
instead of `PRIVATE_KEY`.

## Cloudflare

To host it on Cloudflare Containers, including setting up the secrets, see
[docs/cloudflare-deploy.md](docs/cloudflare-deploy.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
