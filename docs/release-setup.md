# Release setup

Pull requests go into `staging`, and `main` only ever fast-forwards to a `staging` commit that
passed CI. Releases use short-lived tokens from [Octo STS](https://github.com/octo-sts/app), so no
secret is stored. Do this once per repository. `GITHUB_TOKEN` can't bypass the rulesets, so without
this the workflows can't push tags or update `main`.

## Flow

1. A pull request into `staging` is squash-merged (the PR title becomes the commit semantic-release
   reads), after `test`, `commits` and `pr-title` pass.
2. CI runs on the `staging` push. When every job passes, `ci.yml` calls `release.yml`, which tags a
   release candidate (e.g. `v0.2.0-rc.1`), creates a GitHub prerelease and pushes the image to
   GHCR tagged with that version only.
3. **Promote staging to main** (Actions tab, manual) requires CI to have passed on the latest
   `staging` commit, fast-forwards `main` to it, and starts `release.yml` on `main`. That tags the
   official version (e.g. `v0.2.0`) and pushes the image tagged with it and `latest`.

`main` never gets commits of its own, so it is always an ancestor of `staging`.

## What is enforced

`.github/rulesets/`:

- `staging.json`: changes arrive only through a pull request, merged with **squash**; the `test`,
  `commits` and `pr-title` checks must pass; no force-push or deletion. No approvals are required,
  so a single maintainer can merge their own pull requests.
- `main.json`: no direct updates, force-pushes or deletion. Only the Octo STS App may bypass, to
  fast-forward `main` in `promote.yml`.
- `release-tags.json`: `v*` tags can't be created, moved or deleted, except by the Octo STS App,
  which pushes them in `release.yml`.

## How the release gets its token

1. The workflow asks GitHub for an OIDC identity token for the run.
2. `octo-sts/action` sends it to Octo STS (`octo-sts.dev`) and names a trust policy.
3. Octo STS reads the policy from the default branch. `release.sts.yaml` matches only `release.yml`
   running on `main` or `staging`; `promote.sts.yaml` matches only `promote.yml` running on
   `staging`. Both grant `contents: write`.
4. If the identity matches, Octo STS returns a token that lasts a few minutes. `release.yml` pushes
   the tag with it and `promote.yml` fast-forwards `main`; the rulesets let the Octo STS App bypass.

The policies are read from the default branch, so a pull request can't change them, and a workflow
on another branch can't get a token.

Octo STS is a hosted service run by Chainguard, who say they don't offer support for it. If that's
not acceptable, it can be self-hosted; set the action's `domain` input to your instance.

## 1. Install the Octo STS App

Open <https://github.com/apps/octo-sts>, select **Install**, choose your account, then **Only select
repositories** and pick this repository.

## 2. Merge the trust policies

Octo STS reads policies from the default branch, so `.github/chainguard/release.sts.yaml` and
`promote.sts.yaml` must be on `main` before the workflows can get a token.

## 3. Create `staging` and apply the rulesets

Create `staging` from `main` and push it. Apply the rulesets after the Octo STS App is installed,
because they name it as the bypass actor (App ID `801323`, from `gh api /apps/octo-sts --jq .id`):

```bash
git push origin main:refs/heads/staging
scripts/apply_rulesets.sh
```

It creates each ruleset, or updates it if it already exists. Then make `staging` the default branch
for pull requests (Settings > General > Default branch), so Dependabot and `gh pr create` target it.

## 4. Check it

Run **Release** from the Actions tab on `staging` with **dry-run** ticked. A passing run proves the
Octo STS token works. Then merge a `fix:` or `feat:` pull request into `staging` to cut a
candidate, and run **Promote staging to main** to cut the release.

If the token exchange fails with `token does not match trust policy`, compare the policy with the
claims the action prints in its log (`OIDC Token Claims`). This repository's `subject` carries the
immutable owner and repository ids (`repo:<owner>@<id>/<repo>@<id>:ref:refs/heads/<branch>`), so a
policy written with plain names doesn't match.
