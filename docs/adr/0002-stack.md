# ADR-0002: Stack

Status: accepted (2026-10-17)

## Context

The brief prefers Next.js and PostgreSQL and leaves the rest open. The project needs a long-running process for the agent loop, a typed contract shared by UI, API and MCP server, and a database that stores payloads as JSON next to relational data. Versions below were checked on 2026-10-17.

## Decision

| Choice | Why | Alternatives skipped |
|---|---|---|
| TypeScript 5.9 everywhere, pnpm 10 workspaces, Node 22.18 or newer (developed on 26.1) | one language across UI, API and MCP server; zod schemas shared as one package | TypeScript 7 (native): its JS API breaks the Nest CLI and Next type-check tooling at the time of writing |
| NestJS 11 (CommonJS) | dependency injection to swap sessions and runtimes, guards for the token, long-lived process for the loop | Nest 12 (ESM only, new) for maturity; Express alone (more wiring for the same result) |
| Next.js 16 App Router, React 19, Tailwind 4, Recharts, lucide-react | server components for reads, small client components for polling and forms; no component library for about a dozen primitives | a component library (more code to bend than to write) |
| PostgreSQL 17 (Docker) with Prisma 7.10 (`prisma-client` generator, CommonJS output, `@prisma/adapter-pg`, `prisma.config.ts`) | relational ledger with JSONB payloads; typed client; works with Nest 11 on Node 26 (checked before the build) | Prisma 8 (release candidate), SQLite (no concurrent runner, no parity with the integration tests) |
| zod 4 | the single source of tool inputs, report schema, API DTOs; JSON Schema for the model's tools is generated from it | hand-written JSON Schema (drifts) |
| `@anthropic-ai/sdk`, `openai`, `@google/genai` behind one `AgentSession` interface | official SDKs, typed errors | one wrapper library (hides provider behaviour) |
| `@modelcontextprotocol/sdk` 1.32, stdio server | what IDE agents and OpenClaw can spawn | none needed beyond the SDK |
| Vitest, supertest, `playwright-core` (optional Chromium) | unit, integration and e2e tests; browser checks in URL mode; one UI smoke test | Jest (slower with this TypeScript setup) |
| No agent framework, no queue, no Redis | see [ADR-0003](./0003-single-agent-custom-loop.md); a two-slot in-process queue is enough at this scale | BullMQ, LangGraph |

Two practical consequences are recorded here because they surprise people: `pnpm run setup` (never bare `pnpm setup`, which is pnpm's own command) creates `.env`, and the root `package.json` allows build scripts only for `@prisma/engines` and `prisma`.

## Trade-offs

- Several very new major versions (Next 16, Prisma 7, zod 4, Vitest 5, ESLint 10) mean less community folklore to lean on; the lockfile pins what was tested.
- The Docker images are single-stage and large (about 1.4 to 1.5 GB each) because the API needs the Prisma CLI at start and the web image runs `next start` from the full workspace. A production build would use multi-stage images and Next's standalone output.

## How verified

`pnpm check` (typecheck, lint, unit tests), `pnpm test:int` against PostgreSQL, the browser smoke test `pnpm test:ui`, and `docker compose up --build` all ran on 2026-10-17; see [verification.md](../verification.md).
