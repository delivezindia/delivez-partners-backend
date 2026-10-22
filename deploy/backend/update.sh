#!/usr/bin/env bash
# Delivez backend: install → migrate database → build → restart.
# Runs automatically after every `git pull` (post-merge hook), or by hand: ./deploy/backend/update.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "▶ Delivez backend: updating to $(git rev-parse --short HEAD)"
pnpm install --frozen-lockfile
pnpm db:deploy        # apply any new database migrations
pnpm build

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload deploy/backend/ecosystem.config.cjs --update-env
  pm2 save >/dev/null
  echo "✔ Backend updated and restarted (pm2 logs delivez-api)"
else
  echo "✔ Backend built. pm2 is not installed — start the API with: node apps/core-api/dist/main.js"
fi
