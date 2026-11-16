# semantic-release-sentinel-app

> A [Probot](https://github.com/probot/probot) GitHub App that shows, on every pull request, what
> merging it will release under [semantic-release](https://semantic-release.gitbook.io).

## What it does

On every pull request into a release branch it works out the version bump from the
[Conventional Commits](https://www.conventionalcommits.org) semantic-release will see, and posts:

- a **check run**, `Release preview`, always neutral, titled for example `Releases 0.4.0 (minor)`
  or `Releases nothing`;
- one **comment**, updated in place: "merging this releases 0.4.0 (minor), up from 0.3.0."

It is advisory and never blocks a merge. It is stateless (it recomputes from git data on every
event), reads only git data and API responses, and never runs code from a pull request. See the
[design](docs/design.md) for the rules and edge cases.

## Use it

1. Register a GitHub App from [`app.yml`](app.yml): permissions Metadata, Contents and Pull
   requests (read), Checks and Issues (write); events `pull_request`, `merge_group` and `push`.
   Only `pull_request` is acted on for now. The manifest doesn't update an existing App, so mirror
   changes in the App's settings.
2. Run the app with `APP_ID`, `PRIVATE_KEY` and `WEBHOOK_SECRET` set (see [`.env.example`](.env.example)),
   and install the App on your repositories.
3. Optionally add `.github/semantic-release-sentinel.yml` to the repository's base branch.

## Configuration

Every option is optional. The file is read from the **base branch**, never the pull request, so a
pull request can't change the rules it is judged by.

```yaml
merge-strategy: squash        # squash | merge | rebase
release-branches: [main]      # exact names or * wildcards, e.g. [main, "1.x", "release/*"]
tag-format: "v${version}"     # semantic-release's tagFormat
pre-1-0-breaking: major       # major | minor
deps-bump: patch              # patch | none: what fix(deps) releases
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
- Tags aren't checked for reachability from the base branch, and prerelease tags are ignored.
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

```sh
# 1. Build container
docker build -t semantic-release-sentinel-app .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> -e WEBHOOK_SECRET=<secret> semantic-release-sentinel-app
```

## Contributing

If you have suggestions for how semantic-release-sentinel-app could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2026 awalsh128
