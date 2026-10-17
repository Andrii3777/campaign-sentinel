# Web image. Build from the repository root: docker compose build web  (context ".", this file).
FROM node:26-slim

RUN npm install -g pnpm@10.13.1

WORKDIR /app
COPY . .

# NEXT_PUBLIC_* is inlined into the browser bundle at build time: it must be the URL the BROWSER uses to reach the API.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# next/font downloads the two fonts here, so the build needs internet access.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @campaign-sentinel/contracts build \
 && pnpm --filter @campaign-sentinel/web build

ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3000
# API_INTERNAL_URL (server-side calls to the API) comes from docker-compose.yml; docs/verification.json is read from /app/docs.
CMD ["pnpm", "start"]
