#!/usr/bin/env bash
# Delivez backend: install → database client → migrate → build → restart → check it's really running.
# Runs automatically after every `git pull` (post-merge hook), or by hand: ./deploy/backend/update.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

STEP="start"
trap 'echo "✘ Update stopped at: $STEP. The API is still running the previous code — fix the error above, then run ./deploy/backend/update.sh again." >&2' ERR

COMMIT=$(git rev-parse --short HEAD)
echo "▶ Delivez backend: updating to $COMMIT (node $(node -v), pnpm $(pnpm -v))"
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "✘ Node.js 20 or newer is needed (this server has $(node -v))." >&2
  exit 1
fi

STEP="install (pnpm install)"
pnpm install --frozen-lockfile
STEP="database client (prisma generate)"
pnpm db:generate
STEP="database migrations (prisma migrate deploy)"
pnpm db:deploy
STEP="build (pnpm build)"
pnpm build

if ! command -v pm2 >/dev/null 2>&1; then
  echo "✔ Backend built ($COMMIT). pm2 is not installed — start the API with: node apps/core-api/dist/main.js"
  exit 0
fi
STEP="restart (pm2)"
pm2 startOrReload deploy/backend/ecosystem.config.cjs --update-env
pm2 save >/dev/null

# The API must now answer with the commit just built (a pm2 copy running from another folder would not).
if ! command -v curl >/dev/null 2>&1; then
  echo "✔ Backend updated and restarted ($COMMIT). Check it with: pm2 logs delivez-api"
  exit 0
fi
PORT=$(grep -E '^API_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"'"'"' ' || true)
PORT=${PORT:-4000}
HEALTH=""
for _ in $(seq 1 40); do
  HEALTH=$(curl -s --max-time 2 "http://127.0.0.1:$PORT/v1/health" || true)
  case "$HEALTH" in
    *"\"commit\":\"$COMMIT\""*)
      echo "✔ Backend updated: the API is running $COMMIT (pm2 logs delivez-api)"
      exit 0
      ;;
  esac
  sleep 1
done
echo "✘ Restarted, but the API on port $PORT isn't answering with $COMMIT. It said: ${HEALTH:-nothing}" >&2
echo "  Check where pm2 runs it from:  pm2 describe delivez-api | grep 'exec cwd'   (should be $(pwd)/apps/core-api)" >&2
echo "  And its startup errors:        pm2 logs delivez-api --lines 50" >&2
exit 1
