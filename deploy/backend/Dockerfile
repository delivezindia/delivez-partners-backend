# Delivez Core API (NestJS). Build context = repo root (see docker-compose.yml next to this file).
FROM node:20-bookworm-slim

# Prisma needs OpenSSL at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @delivez/core-api build

ENV NODE_ENV=production \
    API_PORT=4000 \
    UPLOAD_DIR=/data/uploads
EXPOSE 4000

# Apply any new database migrations, then start the API.
CMD ["sh", "-c", "cd /app/packages/db && npx prisma migrate deploy && cd /app && node apps/core-api/dist/main.js"]
