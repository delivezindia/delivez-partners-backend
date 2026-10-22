# Delivez Partners — Backend

Core API for Delivez Partners: auth (OTP), onboarding, catalog, orders, lab bookings, notifications (push / SMS), admin. NestJS + Prisma + PostgreSQL + Socket.IO.
The web apps live in [delivez-partners-frontend](https://github.com/delivezindia/delivez-partners-frontend).

| Part | Path |
|---|---|
| API (NestJS) | `apps/core-api` — `/v1`, Swagger at `/docs` |
| Database (Prisma schema + migrations + seed) | `packages/db` |
| Translations | `packages/i18n` |
| Server scripts | `deploy/backend` |

## Server setup (once)
Needs **Node.js 20+**, **pnpm 9** (`npm i -g pnpm@9`), **PM2** (`npm i -g pm2`), **PostgreSQL 14+**, **Redis** (recommended), **git** and **nginx**.
```bash
# Database
sudo -u postgres psql -c "CREATE USER delivez WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE delivez_core OWNER delivez;"

cd /var/www && git clone https://github.com/delivezindia/delivez-partners-backend.git && cd delivez-partners-backend
cp .env.example .env
pnpm install && pnpm secrets        # prints secrets → paste into .env
#   edit .env: DATABASE_URL, REDIS_URL, PUBLIC_API_URL, CORS_ORIGINS, PARTNERS_WEB_URL, FIREBASE_*, MSG91_*
mkdir -p secrets && cp /path/to/firebase-service-account.json secrets/   # from the project owner, not in git

chmod +x deploy/backend/update.sh deploy/backend/hooks/*
git config core.hooksPath deploy/backend/hooks    # every future git pull updates + restarts automatically
./deploy/backend/update.sh                        # first install: migrate, build, start with PM2
pnpm db:seed                                      # first install only: city, zones, PIN codes, admins, demo store
pm2 startup                                       # follow the printed command so the API starts after reboots
```
Then nginx: copy `deploy/backend/nginx-api.conf`, set `server_name partners.api.delivez.com`, enable, reload, and `sudo certbot --nginx -d partners.api.delivez.com`. Check: `https://partners.api.delivez.com/v1/health`.

## Updating
```bash
cd /var/www/delivez-partners-backend && git pull
```
That's it — the hook installs packages, applies database migrations, rebuilds and restarts the API.

| Task | Command |
|---|---|
| Logs (login codes appear here while `SMS_PROVIDER=DEV`) | `pm2 logs delivez-api` |
| Restart after editing `.env` | `pm2 restart delivez-api` |
| Status | `pm2 status` |
| Database backup | `pg_dump -U delivez delivez_core > backup-$(date +%F).sql` |

Before real partners: MSG91 + DLT templates for login SMS, real admin accounts (the seed creates test ones), a fresh Firebase key, scheduled backups of the database and the uploads folder (`UPLOAD_DIR`, default `apps/core-api/uploads`).

## Local development
1. Node 20+, pnpm 9, PostgreSQL.
2. `cp .env.example .env` (set `DATABASE_URL`; leave the server sections empty) · `pnpm install` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm dev`
3. API on http://localhost:4000/v1 (Swagger `/docs`). Tests: `pnpm test`.
