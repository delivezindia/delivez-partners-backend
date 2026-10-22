# Delivez Partners — Backend

Core API for Delivez Partners: auth (OTP), onboarding, catalog, orders, lab bookings, notifications (push / SMS), admin. NestJS + Prisma + PostgreSQL + Socket.IO.
The web apps live in [delivez-partners-frontend](https://github.com/delivezindia/delivez-partners-frontend).

| Part | Path |
|---|---|
| API (NestJS) | `apps/core-api` — `/v1`, Swagger at `/docs` |
| Database (Prisma schema + migrations + seed) | `packages/db` |
| Translations | `packages/i18n` |
| Docker deploy | `deploy/backend` |

## Deploy (Docker)
Needs Docker + Docker Compose v2.
```bash
git clone https://github.com/delivezindia/delivez-partners-backend.git && cd delivez-partners-backend/deploy/backend
cp .env.example .env
docker run --rm -v "$PWD/../..":/app -w /app node:20-alpine node scripts/generate-secrets.mjs
#   → paste the printed lines into .env; set PUBLIC_API_URL, CORS_ORIGINS, PARTNERS_WEB_URL, FIREBASE_*, MSG91_*
mkdir -p secrets && cp /path/to/firebase-service-account.json secrets/   # from the project owner, not in git
docker compose up -d --build
docker compose exec api sh -c "cd packages/db && npx tsx prisma/seed.ts"  # first install only
```
Expose port 4000 as `https://api.<domain>` (allow WebSockets for `/socket.io`). Health: `/v1/health`.

**Update:** `git pull && docker compose up -d --build` — database migrations run automatically on start.

| Task | Command (in `deploy/backend`) |
|---|---|
| Logs (login codes appear here while `SMS_PROVIDER=DEV`) | `docker compose logs -f api` |
| Apply .env changes | `docker compose up -d api` |
| Backup | `docker compose exec db pg_dump -U delivez delivez_core > backup.sql` |

Before real partners: MSG91 + DLT templates for login SMS, real admin accounts (seed creates test ones), fresh Firebase key, scheduled backups of the database and the `uploads` volume.

## Local development
1. Node 20+, `npm i -g pnpm@9`, PostgreSQL.
2. `cp .env.example .env` (set `DATABASE_URL`) · `pnpm install` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm dev`
3. API on http://localhost:4000/v1 (Swagger `/docs`). Tests: `pnpm test`.
