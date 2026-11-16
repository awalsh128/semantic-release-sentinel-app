# Release setup

`main` is protected by a ruleset, and `release.yml` releases from it with a short-lived token from
[Octo STS](https://github.com/octo-sts/app), so no secret is stored. Do this once per repository.
`GITHUB_TOKEN` can't bypass the ruleset, so without this the release can't push its tag.

## What is enforced

`.github/rulesets/main.json`:

- changes reach `main` only through a pull request, merged with **squash** (the PR title becomes the
  commit semantic-release reads);
- the `test`, `commits` and `pr-title` checks must pass;
- `main` can't be force-pushed or deleted;
- the Octo STS App may bypass the ruleset, to push release tags.

No approvals are required, so a single maintainer can merge their own pull requests.

## How the release gets its token

1. `release.yml` asks GitHub for an OIDC identity token for the run.
2. `octo-sts/action` sends it to Octo STS (`octo-sts.dev`) and names the trust policy `release`.
3. Octo STS reads `.github/chainguard/release.sts.yaml` from the default branch. It matches only
   `release.yml` running on `main`, and grants `contents: write`.
4. If the identity matches, Octo STS returns a token that lasts a few minutes. semantic-release
   pushes the tag with it, and the ruleset lets the Octo STS App bypass.

The policy is read from `main`, so a pull request can't change it, and a workflow on another branch
can't get a token.

Octo STS is a hosted service run by Chainguard, who say they don't offer support for it. If that's
not acceptable, it can be self-hosted; set the action's `domain` input to your instance.

## 1. Install the Octo STS App

Open <https://github.com/apps/octo-sts>, select **Install**, choose your account, then **Only select
repositories** and pick this repository.

## 2. Merge the trust policy

Octo STS reads the policy from the default branch, so `.github/chainguard/release.sts.yaml` must be
on `main` before the release can get a token.

## 3. Apply the ruleset

Apply it after the Octo STS App is installed, with the App allowed to bypass. Its App ID is `801323`
(`gh api /apps/octo-sts --jq .id`):

```bash
scripts/apply_rulesets.sh -a 801323
```

It creates the ruleset, or updates it if it already exists.

## 4. Check it

Run **Release** from the Actions tab on `main` with **dry-run** ticked. A passing run proves the
Octo STS token can push to `main`. Then merge a `fix:` or `feat:` pull request to cut a real
release.

If the token exchange fails, the Octo STS App's checks and the action's log say why; a typo in the
policy's `subject` or `claim_pattern` is the usual cause.
