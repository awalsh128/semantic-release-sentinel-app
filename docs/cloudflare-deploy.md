# Deploy to Cloudflare

Probot is a long-running Node server, so it doesn't run as a plain Worker. Run the existing
[`Dockerfile`](../Dockerfile) on [Cloudflare Containers](https://developers.cloudflare.com/containers/),
fronted by a small Worker that forwards GitHub's webhooks to it. The Worker and the container are
deployed together with one `wrangler deploy`.

Check Cloudflare's current docs for plan requirements, pricing and the beta status of Containers
before you start; they change faster than this page.

## Prerequisites

- A Cloudflare account with Containers available on its plan.
- Docker running locally (`docker info`). Wrangler builds and pushes the image on deploy. The image
  must run on `linux/amd64`.
- Docker with the buildx plugin (`docker buildx version`). The script checks for it and prints the
  install command if it is missing.
- Wrangler needs no install: the script runs a pinned version through `npx`, and logs you in.
- A GitHub App registered from [`app.yml`](../app.yml), with its App ID and a generated private key
  (`.pem`). See the Quick Start in the [README](../README.md).

## Quick path: the setup script

```sh
scripts/cloudflare-setup.sh
```

It logs in to Cloudflare, deploys, sets the three secrets and prints the webhook URL. Secrets are
read with hidden input (or from the `.pem` file), passed to Wrangler on stdin, and never printed,
logged or written to disk. A webhook secret it generates goes to your clipboard, not the screen.
Re-running it asks before replacing a secret that is already set. The sections below are the same
steps by hand.

## 1. The Worker

The Worker lives in [`cloudflare/`](../cloudflare): `wrangler.jsonc` declares the container (built
from the root `Dockerfile`) and its Durable Object, and `worker.ts` starts the container with the
secrets as environment variables and forwards `POST /api/github/webhooks` to it. Everything else
returns 404. It sits outside `src/`, so `npm run build` doesn't compile it; type-check it with
`npx tsc -p cloudflare`.

It uses libraries instead of hand-written code: `@octokit/webhooks-methods` verifies the signature,
`@octokit/request` reads GitHub's IP ranges, and `ipaddr.js` matches them. Wrangler bundles them
from `devDependencies`, so the container image is unchanged. Probot already depends on the two
Octokit packages.

It is modelled on Cloudflare's
[Containers environment variables and secrets example](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/);
if your Wrangler version names a field differently, follow that page. Update `compatibility_date`
in `wrangler.jsonc` when you deploy.

### What the Worker rejects

It checks each request in this order, cheapest first, and only a request that passes all of them
wakes the container:

| Check | Rejects with |
| --- | --- |
| Not `POST /api/github/webhooks` | 404 |
| Missing `X-GitHub-Event` or `X-GitHub-Delivery` | 400 |
| No `Content-Length`, or over 25 MB (GitHub's cap) | 411, 413 |
| `X-Hub-Signature-256` isn't the valid HMAC of the body under `WEBHOOK_SECRET` (constant-time) | 401 |
| Caller's IP isn't in the `hooks` ranges of [`api.github.com/meta`](https://api.github.com/meta) | 403 |
| Event isn't `ping` or `pull_request` | 202, acknowledged and dropped |

The signature is the real control. The IP allowlist covers a leaked secret. The ranges are cached
for an hour in the Durable Object and the last known list is used if a refresh fails; with no list
at all it answers 503 and GitHub can redeliver. The container still verifies the signature itself.

When the app starts handling another event, add it to `FORWARDED_EVENTS` in `cloudflare/worker.ts`.

Optional extras in the Cloudflare dashboard, which also stop abusive traffic before it runs the
Worker: a [rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) on the
webhook path, and a custom domain with `workers_dev` turned off.

## 2. Set the secrets

Secrets are encrypted, never go in `wrangler.jsonc`, and are never committed. Run these from
`cloudflare/`. Each prompts for the value, except the key, which is read from the file:

```sh
cd cloudflare
npx wrangler secret put APP_ID
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put PRIVATE_KEY < /path/to/your-app.private-key.pem
```

- `WEBHOOK_SECRET` is the secret you entered when registering the GitHub App. Generate a strong one
  with `openssl rand -hex 32` and set the same value in the App's settings.
- `PRIVATE_KEY` is the whole PEM including the `BEGIN` and `END` lines. Delete the local `.pem` or
  keep it out of the repository (`*.pem` is ignored).

List what is set (names only) with `npx wrangler secret list`.

A running container keeps the environment it started with. After changing a secret, redeploy or let
the container sleep and restart, or it keeps using the old value.

For local testing, put the same names in `cloudflare/.dev.vars` (gitignored; never commit it) and run
`npx wrangler dev`.

## 3. Deploy

```sh
cd cloudflare
npx wrangler deploy
```

Wrangler uploads the Worker, builds and pushes the image from the root `Dockerfile`, and creates the
container. Wait a few minutes after the first deploy before it serves requests. Wrangler prints the
Worker URL, for example `https://semantic-release-sentinel.<account>.workers.dev`.

## 4. Point the GitHub App at it

1. In the App's settings (`github.com/settings/apps/<app-name>`), set **Webhook URL** to
   `https://<worker-url>/api/github/webhooks`.
2. Make sure **Webhook secret** matches the `WEBHOOK_SECRET` you set above.
3. Install the App on your repositories.

## 5. Check it

- Open **Advanced** in the App's settings and look at **Recent Deliveries**. A redelivered
  `pull_request` event should return `200`. A first delivery can fail or be slow while the container
  starts.
- Stream logs with `npx wrangler tail`.
- Open a pull request into a release branch; the `Release preview` check and comment should appear.

## Wrangler and `cf`

This uses Wrangler. Cloudflare's newer unified CLI, [`cf`](https://developers.cloudflare.com/cf/), is
the successor, but it is still a release candidate. It doesn't read `wrangler.jsonc` (it needs a
`cloudflare.config.ts`), and its secret commands differ. Wrangler stays supported, so switch when
`cf` is stable.

## Updating

Merging to `staging` or `main` releases through semantic-release as usual; that doesn't deploy to
Cloudflare. Redeploy by hand with `npx wrangler deploy`, or add a workflow that runs it with a
`CLOUDFLARE_API_TOKEN` repository secret. Prefer a token scoped to this Worker, and a runner with
Docker.
