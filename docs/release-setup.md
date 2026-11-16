# Release setup

`main` is protected by a ruleset, and `release.yml` releases from it with a release-bot GitHub App
token. Do this once per repository. The App's token can bypass the ruleset; `GITHUB_TOKEN` can't, so
without the App the release can't push its tag.

## What is enforced

`.github/rulesets/main.json`:

- changes reach `main` only through a pull request, merged with **squash** (the PR title becomes the
  commit semantic-release reads);
- the `test`, `commits` and `pr-title` checks must pass;
- `main` can't be force-pushed or deleted;
- the release-bot App may bypass the ruleset, to push release tags.

No approvals are required, so a single maintainer can merge their own pull requests.

## 1. Release-bot GitHub App

1. Open <https://github.com/settings/apps/new> (**Settings → Developer settings → GitHub Apps →
   New GitHub App**).
2. Enter a **GitHub App name** (such as `my-name-release-bot`) and a **Homepage URL** (the
   repository URL is fine).
3. Under **Webhook**, clear **Active**.
4. Under **Repository permissions**, set **Contents** to **Read and write**. Leave the rest at
   **No access**.
5. Under **Where can this GitHub App be installed?**, choose **Only on this account**, then
   **Create GitHub App**.
6. Note the **App ID**. Under **Private keys**, select **Generate a private key**; a `.pem` file
   downloads.
7. Select **Install App**, choose the account, then **Only select repositories** and pick this
   repository.

## 2. Release environment

Only `main` can use this environment, so only `main` can mint a token that bypasses its ruleset.
Put the credentials in it, not in repository secrets:

```bash
gh api -X PUT repos/<owner>/<repo>/environments/release --input - <<< \
  '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/<owner>/<repo>/environments/release/deployment-branch-policies \
  -f name=main -f type=branch

gh variable set RELEASE_BOT_APP_ID --env release --body "<app id>"
gh secret set RELEASE_BOT_PK --env release < my-release-bot.private-key.pem
```

Delete the `.pem` file afterwards.

## 3. Apply the ruleset

Apply it after the App exists, with the App allowed to bypass:

```bash
scripts/apply_rulesets.sh -a "<app id>"
```

It creates the ruleset, or updates it if it already exists.

## 4. Check it

Run **Release** from the Actions tab on `main` with **dry-run** ticked. A passing run proves the App
token can push to `main`. Then merge a `fix:` or `feat:` pull request to cut a real release.
