# Campaign Sentinel

An AI agent that investigates conversion-rate anomalies in digital marketing campaigns and produces an evidence-based report — a demonstration project for the Bulls Media AI Developer assignment.

Monorepo (pnpm 10, Node ≥ 22.18, TypeScript ~5.9): NestJS 11 API + Prisma 7/Postgres 17, Next.js 16 web, stdio MCP server, shared zod contracts. Agent runs (deterministic policy, Anthropic/OpenAI/Gemini, OpenClaw, or an external MCP client) investigate a demo campaign or a public URL and must end with one grounded `submit_report`.

## Commands

Run from the repo root (path has a space — quote it). Bash or PowerShell, same syntax.

```
pnpm install                          # postinstall builds contracts + prisma generate
pnpm run setup                        # creates .env from .env.example with a random SENTINEL_AGENT_TOKEN (idempotent)
docker compose up -d db               # Postgres on 127.0.0.1:5433 (dbs campaign_sentinel, campaign_sentinel_test)
pnpm db:migrate && pnpm db:seed       # migrations, then idempotent demo seed (builds the API first)
pnpm dev                              # API :4000 (tsc watch + node --watch dist) and web :3000
pnpm build                            # all packages; apps/mcp/dist/index.js is the MCP entry
pnpm check                            # typecheck + eslint + unit tests, whole repo — the one check command
pnpm test:int                         # integration + e2e, needs the db up and DATABASE_URL_TEST
pnpm --filter @campaign-sentinel/api exec vitest run src/analysis/stats.test.ts     # one unit file
pnpm --filter @campaign-sentinel/api exec vitest run --config vitest.int.config.mts src/ledger/ledger.int.test.ts   # one int file
pnpm run doctor                       # is the checkout review-ready (one ✓/✗ per check)
pnpm skills:sync [--check]            # re-render the investigate-campaign skill copies from the playbook
node scripts/examples.mjs             # regenerate docs/examples from real deterministic runs (API :4200, fixture site :4210)
pnpm test:ui                          # web browser smoke, needs the running stack + Chromium (see Tests)
pnpm ide:antigravity --dry-run        # preview only; without the flag it writes ~/.gemini/config/mcp_config.json
```

## Pitfalls

- Bare `pnpm setup` edits the user's PATH and bare `pnpm doctor` is a pnpm builtin no-op: always `pnpm run setup` / `pnpm run doctor`.
- `pnpm db:reset` (`prisma migrate reset --force`) wipes the dev db and Prisma refuses it from AI agents: a human runs it. Do not run it.
- `packages/contracts` is consumed from its built CJS `dist/`. After editing it rebuild: `pnpm --filter @campaign-sentinel/contracts build` (`pnpm typecheck` does it). Stale dist = confusing type/runtime errors in api/mcp/web.
- Prisma client is generated into `apps/api/src/generated/prisma/client` (gitignored, eslint-ignored); `pnpm install` or `pnpm --filter @campaign-sentinel/api db:generate` recreates it. Do not run `prisma init`; config is hand-written `apps/api/prisma.config.ts`.
- Playbook has one source: `packages/contracts/src/prompts/playbook.ts`. `.agents/skills/…/SKILL.md` and `.claude/skills/…/SKILL.md` are generated; hand edits fail `apps/mcp/src/skill.test.ts`. Edit the playbook, then `pnpm skills:sync`.
- `docs/examples/*` are generated output (`scripts/examples.mjs`), not hand-written; the script starts and stops its own API/fixture site.
- Int tests run serially (`fileParallelism: false`) and pin provider keys/gateway/`SENTINEL_AGENT_TOKEN` to empty in `vitest.int.config.mts`; they never read a developer's keys. `mcp.int.test.ts` rebuilds `apps/mcp` first. Tests that use the local fixture site need `URL_FETCH_ALLOW_PRIVATE=1` (loopback only, refused when `NODE_ENV=production`).
- No network in tests; the only live-internet script is `scripts/verify/url-live.mjs` (manual, needs `pnpm --filter @campaign-sentinel/api build`). `pnpm verify:claude-code` / `verify:codex` call real CLIs — do not run casually.
- Public API (`/api/*`) has no login: API binds `API_HOST` (default 127.0.0.1). Agent API (`/api/agent/*`) needs bearer `SENTINEL_AGENT_TOKEN` (≥ 32 chars) and a local Host/Origin.
- `apps/web/AGENTS.md` (written by `next dev`) says Next 16 differs from training data: read `node_modules/next/dist/docs/` before touching web routing/APIs.
- Scenario keys/ground truth must never reach the agent: campaign ids are not scenario keys; `groundTruth` appears only in the completed-demo-run DTO for the UI.
- MCP `start_investigation` must keep `openWorldHint: false` (Codex refuses true). `resolveConfig` refuses non-loopback API URLs unless `SENTINEL_ALLOW_REMOTE_API=1`.
- `.env`, `.env.*` are gitignored (only `.env.example` is tracked); never commit or print `.env`.

## Structure

```
packages/contracts/src   zod schemas + types: tools.ts (toolSpecs), report.ts, events.ts, api.ts (DTOs), campaigns.ts, scenarios.ts, tool-result.ts, prompts/ (system prompt, playbook)
apps/api/src
  ledger/        LedgerService: investigations, events, tool executions, evidence, reports, state machine (only place that touches those Prisma tables)
  tools/         ToolExecutor + ToolRegistry; demo/ (campaign tools), url/ (URL-mode tools); untrusted-content sanitizing
  analysis/      pure stats (z-test, mix decomposition, change point, reconcile)
  demo-data/     CampaignDataRepository (Prisma + in-memory), seeded synthetic generator
  web-inspection/ URL guard (SSRF), pinned SafeFetcher, HTML analyzer, link checker, Playwright browser check
  reports/       grounding rules + ReportService.submit
  runtime/       Runner, SessionFactory, DeterministicPolicy (demo-policy/url-policy), providers/, openclaw/
  http/public/   web-facing REST;  http/agent/ bearer-token API used by MCP/OpenClaw
  config/ common/ db/ health/   env validation (zod), filters, PrismaService
apps/api/prisma  schema.prisma, migrations/, seed.mjs, init/ (creates the test db)
apps/api/test    boot.ts (bootApp), global-setup.ts, e2e/, fixtures/sites/ (fixture HTML server)
apps/mcp/src     server.ts (tools), api-client.ts, env.ts, index.ts (stdio entry)
apps/web         app/ (routes), components/, lib/ (api-client.ts, api.ts, timeline.ts, …), e2e/smoke.mjs, scripts/shots.mjs
scripts/         setup, doctor, skills-sync, examples, ide-antigravity, verify/
docs/            adr/ (decisions), setup-keys.md, openclaw.md, integrations.md, verification.md, walkthrough.md, examples/
.mcp.json .codex/ .cursor/ .agents/   committed IDE/agent configs for the MCP server (no secrets)
```

## Key files

- `apps/api/src/app.ts` — `createApp({env?, logger?})`; `app.module.ts` wires all modules; `main.ts` loads root `.env`.
- `apps/api/src/tools/tool-executor.ts` — every tool call goes through `ToolExecutor.execute` (validation, mode permission, budgets, dedupe, timeout, retry, evidence).
- `apps/api/src/reports/grounding.ts` — pure report-validation rules; `report.service.ts` — submit, 3 rejections → FAILED.
- `apps/api/src/runtime/runner.ts` — queue, state transitions, recovery sweep; `session-factory.ts` picks the runtime.
- `apps/api/src/ledger/ledger.service.ts` — all persistence of a run.
- `apps/api/src/config/config.ts` — the full env schema (single source of variable names).
- `apps/api/src/web-inspection/url-guard.ts`, `safe-fetcher.ts` — SSRF boundary.
- `packages/contracts/src/tools.ts`, `report.ts` — contracts shared by API, MCP, web.
- `apps/mcp/src/server.ts` — MCP tool mapping to `/api/agent`.
- `apps/web/lib/api-client.ts` — the one web HTTP client; `apps/web/lib/runtime-options.ts`.

## Architecture

- Flow: client (web / REST / MCP / OpenClaw) → create Investigation (`mode` demo|url, `runtime` deterministic|ai|external|openclaw) → Runner drives an `AgentSession` (or an external agent calls the Agent API) → each tool call → `ToolExecutor` → handler → ToolResult + Evidence (E1…) in the ledger → `submit_report` → `ReportService` grounding → COMPLETED or FAILED. Web polls investigation + events (`GET /api/investigations/:id[/events?after=]`).
- Status machine lives in `LedgerService.transition`; ledger emits lifecycle/tool/evidence events in the same transaction. Reports are saved atomically via `completeWithReport`.
- Boundaries: contracts = pure data, no I/O; analysis = pure; run state is written only via `LedgerService` (Prisma is also used by `CampaignDataRepository`, health and some http/tools services for reads; do not add new run-table writes outside the ledger); only `web-inspection` does outbound HTTP; provider SDKs stay inside `runtime/providers`; web talks to the API only via `lib/api-client.ts`; MCP talks to the API only via `api-client.ts`.
- Tools register per mode from a module's `onModuleInit` (`ToolRegistry.register(mode, handlers)`); a handler throws `ToolFailure(code, message, retryable)`. Fetched page text is untrusted: wrap with `untrustedContent(...)`.
- Budgets: 24 tool calls, 16 turns, 3 reports, 5 min per run; 25 HTTP requests in URL mode; agent API caps rejected calls at 20.

## Conventions

- Language: English for code, comments, UI copy, docs.
- API is CommonJS (Nest decorators, `experimentalDecorators`); contracts and MCP also build to CJS `dist/`. Imports in api source are extensionless.
- Every external input is parsed with zod from `@campaign-sentinel/contracts` (`parseOr400` in `http/public`); do not duplicate schemas in apps.
- New dependency not already in the package.json files — ask first; do not add silently.
- Dates `YYYY-MM-DD`; rates are fractions (not percents).
- eslint: `@typescript-eslint/no-unused-vars` errors unless prefixed `_`; `dist`, `.next`, generated Prisma are ignored.
- A shortcut with a known limit gets a `shortcut: <limit>, <when to upgrade>` comment.

## Environment

Names only (see `.env.example`; schema in `apps/api/src/config/config.ts`): `DATABASE_URL`, `DATABASE_URL_TEST`, `API_PORT`, `API_HOST`, `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`, `SENTINEL_AGENT_TOKEN`, `SENTINEL_API_URL`, `SENTINEL_ALLOW_REMOTE_API`, `LLM_PROVIDER` (anthropic|openai|gemini), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_AGENT_ID`, `BROWSER_CHECKS` (auto|off), `URL_FETCH_ALLOW_PRIVATE`; compose-only host ports `SENTINEL_DB_PORT`, `SENTINEL_API_PORT`, `SENTINEL_WEB_PORT`; smoke test `UI_BASE_URL`, `UI_API_URL`; examples `DATABASE_URL_EXAMPLES`. Without LLM keys everything but the `ai` runtime works.

## Tests

- Unit: colocated `*.test.ts` (Vitest 5; run by `pnpm check` via each package's `test`). Integration/e2e: `*.int.test.ts` in `apps/api/src` and `apps/api/test`, run only by `pnpm test:int` against `DATABASE_URL_TEST` (migrations applied by `test/global-setup.ts`).
- Seams: `ToolExecutor.execute`, `ReportService.submit`, `AgentSession` (use `ScriptedSession` + `toolTurn` from `runtime/scripted-session.ts`), whole HTTP API via `bootApp()` + supertest, `InMemoryCampaignDataRepository` for DB-free tests, `startFixtureSite()` for URL mode.
- Web: unit tests in `apps/web/lib`/`components`; `pnpm test:ui` (`apps/web/e2e/smoke.mjs`) needs `pnpm dev` + seeded db + `pnpm --filter @campaign-sentinel/web exec playwright-core install chromium`.
- CI (`.github/workflows/ci.yml`): `pnpm check` then `pnpm test:int`; not yet run on GitHub.
