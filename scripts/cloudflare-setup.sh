#!/usr/bin/env bash
# Deploy the app to Cloudflare Containers and set its secrets.
# See docs/cloudflare-deploy.md.
#
# Secrets are read with hidden input (or from a file), passed to wrangler on stdin, and never
# printed, logged, put in argv or written to disk. A generated webhook secret goes to the
# clipboard, not the screen.
#
# Usage: scripts/cloudflare-setup.sh

set -euo pipefail
set +x # a trace would print the secrets

cd "$(dirname "$0")/../cloudflare"
CONFIG="wrangler.jsonc"

die() { printf 'error: %s\n' "$1" >&2; exit 1; }
wrangler() { npx --yes wrangler "$@"; }

copy_to_clipboard() {
  if command -v wl-copy >/dev/null 2>&1; then wl-copy
  elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard
  elif command -v pbcopy >/dev/null 2>&1; then pbcopy
  elif command -v clip.exe >/dev/null 2>&1; then clip.exe
  else return 1; fi
}

# put_secret NAME: reads the value from stdin; sends it to wrangler without echoing.
put_secret() {
  wrangler secret put "$1" --config "$CONFIG" >/dev/null || die "could not set $1"
  printf '  set %s\n' "$1"
}

# already_set NAME: succeeds if the Worker has a secret by that name.
already_set() { printf '%s' "$SECRETS" | grep -q "\"name\": *\"$1\""; }

# keep_existing NAME: true if the secret exists and the user doesn't want to replace it.
keep_existing() {
  already_set "$1" || return 1
  read -r -p "  $1 is already set. Replace it? [y/N] " reply
  [[ ! "$reply" =~ ^[Yy] ]]
}

[[ -t 0 ]] || die "run this in an interactive terminal: it prompts for secrets and a browser login, and there is no terminal attached here"
command -v npx >/dev/null 2>&1 || die "node and npm are required"
docker info >/dev/null 2>&1 || die "Docker isn't running; wrangler needs it to build the image"
docker buildx version >/dev/null 2>&1 || die "the Docker buildx plugin is missing; wrangler needs it to build the image"

echo "1/4 Cloudflare login"
if ! wrangler whoami >/dev/null 2>&1; then
  wrangler login || die "Cloudflare login failed"
  wrangler whoami >/dev/null 2>&1 || die "still not logged in to Cloudflare"
fi

echo "2/4 Deploy (builds the image; this takes a few minutes)"
DEPLOY_LOG=$(mktemp)
trap 'rm -f "$DEPLOY_LOG"' EXIT
wrangler deploy --config "$CONFIG" 2>&1 | tee "$DEPLOY_LOG"
WORKER_URL=$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$DEPLOY_LOG" | head -n1 || true)

echo "3/4 Secrets"
SECRETS=$(wrangler secret list --config "$CONFIG" 2>/dev/null || true)

if ! keep_existing APP_ID; then
  read -r -p "  GitHub App ID (not secret): " app_id
  [[ "$app_id" =~ ^[0-9]+$ ]] || die "the App ID is a number"
  printf '%s' "$app_id" | put_secret APP_ID
fi

if ! keep_existing WEBHOOK_SECRET; then
  generated=""
  if command -v openssl >/dev/null 2>&1 && read -r -p "  Generate a webhook secret and copy it to the clipboard? [Y/n] " g && [[ ! "$g" =~ ^[Nn] ]]; then
    generated=$(openssl rand -hex 32)
    if printf '%s' "$generated" | copy_to_clipboard; then
      printf '  Copied. Paste it into the GitHub App'\''s "Webhook secret" field now, then press Enter.\n'
      read -r _
      printf '%s' "$generated" | put_secret WEBHOOK_SECRET
    else
      generated=""
      echo "  No clipboard tool found, so enter your own secret instead."
    fi
  fi
  if [[ -z "$generated" ]]; then
    read -rs -p "  Webhook secret (hidden; must match the GitHub App): " webhook_secret
    printf '\n'
    [[ -n "$webhook_secret" ]] || die "the webhook secret can't be empty"
    printf '%s' "$webhook_secret" | put_secret WEBHOOK_SECRET
    unset webhook_secret
  fi
  unset generated
fi

if ! keep_existing PRIVATE_KEY; then
  read -r -e -p "  Path to the GitHub App private key (.pem): " key_path
  key_path="${key_path/#\~/$HOME}"
  [[ -f "$key_path" ]] || die "no such file: $key_path"
  head -n1 "$key_path" | grep -q -- '-----BEGIN' || die "that doesn't look like a PEM private key"
  put_secret PRIVATE_KEY < "$key_path"
fi

echo "4/4 Finish in GitHub"
if [[ -n "$WORKER_URL" ]]; then
  echo "  Set the App's Webhook URL to: $WORKER_URL/api/github/webhooks"
else
  echo "  Set the App's Webhook URL to: https://<your-worker-url>/api/github/webhooks"
fi
echo "  Then check Recent Deliveries on the App's Advanced tab, and run: npx wrangler tail"
echo "  A running container keeps the secrets it started with; the first request after a"
echo "  restart picks up new values."
