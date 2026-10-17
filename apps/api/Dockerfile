# API image. Build from the repository root: docker compose build api  (context ".", this file).
# Single stage on purpose: the Prisma CLI (a dev dependency) is needed at start-up to apply migrations.
FROM node:26-slim

# openssl: Prisma's schema engine; pnpm is installed with npm because Node 25+ no longer ships corepack.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.13.1

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @campaign-sentinel/contracts build \
 && pnpm --filter @campaign-sentinel/api build

# Production mode also makes the API refuse the test-only URL_FETCH_ALLOW_PRIVATE switch.
ENV NODE_ENV=production \
    API_PORT=4000
EXPOSE 4000

# Migrate and seed on every start (both are idempotent), then run the API. DATABASE_URL comes from docker-compose.yml.
CMD ["sh", "-c", "pnpm --filter @campaign-sentinel/api db:migrate && node apps/api/prisma/seed.mjs && exec node apps/api/dist/main.js"]
