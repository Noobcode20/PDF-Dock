#!/bin/zsh
set -euo pipefail

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  read -r 'CLOUDFLARE_ACCOUNT_ID?Cloudflare account ID: '
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  print -u2 'No Cloudflare account ID was provided.'
  exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  read -r -s 'CLOUDFLARE_API_TOKEN?Paste a Cloudflare API token scoped to this Worker: '
  print
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  print -u2 'No Cloudflare API token was provided.'
  exit 1
fi

export CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_API_TOKEN
trap 'unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID' EXIT
node ./check-deploy-access.mjs
npx --yes wrangler@4 deploy
