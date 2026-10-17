# Verification record

What was actually run, when, with which command and result. Everything below happened on 2026-10-17 on the developer's machine (Windows 11, Node 26.1, pnpm 10.13.1, Docker 29.1). Nothing is estimated; where something was not run it says so. The machine-readable form of the table is [verification.json](./verification.json); the UI page `/integrations` and the README read from it.

## Summary

| Component | Status | Evidence |
|---|---|---|
| Deterministic runtime (tools, ledger, validation, API, UI) | **verified** | `pnpm check`, `pnpm test:int`, `pnpm test:ui`; no AI |
| Claude Code | **verified** | real headless run through the MCP server (details below) |
| Codex | **verified** | real run through the MCP server (details below) |
| AI agent (built in) | **Gemini verified**; Anthropic and OpenAI **not verified** | one real Gemini run (details below); Anthropic and OpenAI have no keys and were tested only against fake transports |
| OpenClaw | **verified once** | one real run from the UI/API runtime on Windows; chat and URL mode not run (details below) |
| Antigravity | **verified** | one manual demo run and two manual URL-mode runs in the Antigravity desktop app (details below) |
| Cursor | **verified** | one manual demo run in the Cursor desktop app (details below) |
| Docker one-command run | **verified once** | below |
| GitHub Actions CI | **verified** | `.github/workflows/ci.yml` (`pnpm check`, `pnpm test:int`) green on GitHub on 2026-10-17, run 39077152365. The first run failed: two doctor handshake tests needed a local `apps/mcp` build, fixed in 2131a43 |

## Automated checks (the deterministic runtime; no AI)

| Command | Result |
|---|---|
| `pnpm check` | passed: typecheck and lint clean; 310 tests (contracts 46, api 222, web 27, mcp 15) |
| `pnpm test:int` (Postgres from `docker compose up -d db`, test database) | passed: 12 files, 108 tests, 84.8 s |
| `pnpm test:ui` (Chromium; API on :4000 and `next dev` on :3000, test database) | passed: the run page showed 8 tool calls and the verdict "Cause identified"; a private URL was refused with `BLOCKED_ADDRESS` |
| `node scripts/examples.mjs` (API started by the script on :4200, fixture site on :4210, test database) | all five scenarios and the URL run completed and matched the dataset's known cause and severity; the script stopped both servers (no listener on 4200 or 4210 afterwards) |

The five demo scenarios as produced by the script (full table with tool sequences: [examples/expected-outcomes.md](./examples/expected-outcomes.md)):

| Scenario | Verdict | Severity | Top category | Matches the hidden cause |
|---|---|---|---|---|
| `tracking-break` | cause_identified | high | tracking | yes |
| `traffic-source-decline` | likely_cause | high | traffic_source | yes |
| `landing-page-mobile` | cause_identified | critical | landing_page | yes |
| `insufficient-data` | inconclusive | low | data_quality | yes (expected: no cause) |
| `tool-failure` | likely_cause | high | conversion_flow | yes, with one failed tool call shown |

The five runs use five distinct tool sequences. The URL run against the local fixture page (`http://127.0.0.1:4210/ok`) completed with `fetch_page`, `measure_availability`, `check_links` and one finding: the fixture's form posts to `/submit`, which the fixture does not serve (404). That is a property of the fixture page, not a bug.

## Real agents through MCP

The Claude Code and Codex runs used the repository's own scripts against the running app; the prompt names only the campaign id and never the hidden cause. The stored run was checked through the public API.

**Claude Code** (`pnpm verify:claude-code`)

- Claude Code 2.1.296, `--model claude-sonnet-5-5`, headless (`claude -p`), MCP server from `.mcp.json`.
- Run `cmvccanab000090xfatyf1td7`: `COMPLETED`, `likely_cause` / high, 3 tool calls, 1 report attempt, source `mcp`, runtime `external`, client name `claude-code`.

**Codex** (`pnpm verify:codex`)

- Run through `npx -y @openai/codex@latest` (Codex 0.163.0). The installed Codex 0.132.0 was too old for the current default model, so the newer one was used (`CODEX_BIN`), with `-s read-only -c windows.sandbox="unelevated"`.
- Run `cmvcd843e0000q0xf7ty9d0sa`: `COMPLETED`, `cause_identified` / high, 2 tool calls, 1 report attempt, client `codex-mcp-client`.
- A first Codex attempt blocked on `submit_report` because of a wrong MCP annotation (`openWorldHint`); it was fixed and the run above is the result after the fix.
- `codex debug prompt-input` lists the `investigate-campaign` skill.
- Branch review (ticket F2), 2026-10-17: `start_investigation` was set to `openWorldHint: true` (URL mode reaches the open web). Codex 0.163.0 under `approval_policy="never"` then refused to call it ("MCP approval is unavailable"; no run was recorded), so the annotation is back to `false` and `pnpm verify:codex` passed again afterwards (`COMPLETED`, `cause_identified` / high, 3 tool calls, 1 report attempt). Read-only analysis tools keep `readOnlyHint: true`; `submit_report` stays `openWorldHint: false`.
- `docs/examples/` were generated before the URL-report wording change (ticket F1); regenerate with `node scripts/examples.mjs`.

**Antigravity** (manual, in the Antigravity desktop app)

- Made by hand by the developer on 2026-10-17 and checked against the stored record through the API. Not automated: one run, one campaign.
- Run `cmvcftoot0001bgxfraof359i`: mode demo, campaign `home-insurance-search`, `COMPLETED`, source `mcp`, runtime `external`, client name `antigravity-client` version `v1.0.0` (what Antigravity sends in the MCP `initialize` handshake).
- 8 tool calls: `get_campaign_overview`, `compare_periods`, `get_daily_trend`, `breakdown_by_segment` (twice), `inspect_tracking_health`, `check_landing_page`, `get_change_log`. Verdict `cause_identified`, severity high, top hypothesis tracking (supported, high), ground-truth check matched.
- Report attempts: 2. The server-side validator rejected attempt 1 (rule `high_confidence`: the agent had set `high` confidence on hypotheses that were not supported or had no direct evidence) and accepted the repaired attempt 2.
- Duration about 6.5 minutes, mostly waiting for the developer's tool-permission clicks.
- Setup findings in the tested Antigravity version: the project skill `investigate-campaign` from `.agents/skills/` was discovered (Customizations → Skills); the workspace file `.agents/mcp_config.json` was not picked up, so the server was added to the global file `~/.gemini/config/mcp_config.json` (the app showed it with 15 tools after a restart); every MCP tool call asked for permission; the skill was invoked implicitly by the prompt "Investigate the demo campaign home-insurance-search" (explicit mention syntax was not verified).

Antigravity URL mode (two more manual runs on 2026-10-17, same desktop app, source `mcp`, client `antigravity-client` v1.0.0, target `https://example.com`, provenance `live-http`; checked against the stored records):

- Run `cmvcgtbfu0017kkxf27ewfzvb`: tools `fetch_page`, `measure_availability`, `browser_check`, `check_links`; 6 HTTP requests, 1 report attempt, verdict `likely_cause` / medium. `browser_check` returned "unavailable" because the API process had cached a failed Chromium probe (a bug recorded for the review; restarting the API fixed it). The agent recorded this as a limitation in its report.
- Run `cmvchdj2j0000c4xf9nok6t0m`: `fetch_page`, `measure_availability`, `check_links`, `browser_check`; 6 HTTP requests, 1 report attempt, same verdict and severity. Chromium loaded the page: status 200, DOMContentLoaded 260 ms, 0 console errors, 0 failed requests, 0 blocked requests, no tracking requests.
- A deterministic URL run on the same URL gave the same verdict and severity. All numbers in the agent's chat summaries matched the stored evidence.

Limits: one short run per client, one campaign each, using the developer's own subscriptions. This proves that the integration path works (tools discovered, adaptive calls, a report accepted by the server, the run stored with the right source and client). It does not measure reasoning quality or repeatability.

## Gemini (built-in AI agent)

- Configuration: `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, a free-tier key. Run started from the API with runtime `ai` and checked against the stored record on 2026-10-17.
- Run `cmvcipil00000dsxfnzevlau5` on demo campaign `home-insurance-search`: `COMPLETED` in about 16 s, 10 model turns, 8 tool calls, 60,494 input and 2,523 output tokens. Verdict `cause_identified`, severity high, top hypothesis tracking (supported, high), ground-truth check matched.
- Report attempts: 2. The server-side validator rejected the first report (wrong format: `schemaVersion` and the hypothesis id format) and the model repaired it.
- The agent chose its own tool order (change log before tracking health), different from the deterministic policy.
- Limits: one run, one campaign, free-tier quota. It shows the Gemini session works end to end, not reasoning quality or repeatability.

## Not verified

- **Anthropic and OpenAI sessions.** Not verified against the real APIs: no keys were available. They are tested only against fake HTTP transports (one shared conformance suite). Default model ids were taken from the providers' documentation and have not been exercised.
- **OpenClaw.** Verified once: run `cmvctmr180005ngxfwoeanzp2` through the OpenClaw runtime (OpenClaw 2026.10.4, native local gateway on Windows, agent `sentinel` on the `claude-cli` backend), COMPLETED, `likely_cause` / high, ground truth matched, 10 tool calls (3 retried), first report rejected by the validator, second accepted. Two earlier attempts did not count: one was interrupted by an API restart; one failed `NO_REPORT` because the agent's `ToolSearch` was denied by the hardened exec policy, which led to the per-agent exec override in [openclaw.md](./openclaw.md). A follow-up probe showed the `sentinel` agent can still use Claude Code's native `Read` tool (it read a file outside the workspace; no shell tool was exposed), so the runtime is only safe for demo campaigns on a trusted machine. Not verified: the OpenClaw chat path, URL mode through OpenClaw, `Write`/`Edit` access, other versions or backends.
- **Cursor.** Verified once by hand: run `cmvco8d9x0000osxflqw9ktnm` (Meal Kit Subscription), COMPLETED, client `cursor-vscode`, `likely_cause` / high, ground truth matched. The server must be enabled by hand under Settings -> MCP. In that run one tool (tracking health) failed twice and the report said so. No URL-mode run through Cursor; nothing drives Cursor headlessly.
- **GitHub Actions.** The workflow has not run on GitHub.

## Docker one-command run

Command: `docker compose -p campaign-sentinel-demo up --build -d` with `SENTINEL_DB_PORT=5434 SENTINEL_API_PORT=4300 SENTINEL_WEB_PORT=3300`, so the developer's own database container (port 5433) and its volume were not touched (they stayed up and healthy throughout). Services: `db`, `api`, `web`.

- First build and start: all three images built and started, `db` and `api` healthy, `web` answering. (Builds download the base image, the npm packages and, for the web image, two Google fonts.) Second run after the docs were added: 62 seconds with warm layer cache.
- `GET http://127.0.0.1:4300/api/health` → `{"status":"ok","db":"up","runtimes":{"deterministic":"available","claude":"missing_key","openclaw":"not_configured","browser":"unavailable","ai":{"provider":"anthropic","model":"claude-opus-5-5","status":"missing_key"}}}`. `browser` is "unavailable" because the image has no Chromium, as documented.
- The API log showed the migration applied and `synthetic-demo-v1` seeded (5 campaigns) on start.
- `GET http://127.0.0.1:3300/` → 200; `/campaigns` rendered the campaign names fetched from the API over the internal network; `/integrations` rendered the records of `docs/verification.json`.
- One deterministic investigation through the container API (`home-insurance-search`): `COMPLETED`, `cause_identified`, severity high, 7 analysis tool calls, ground truth match.
- `docker compose -p campaign-sentinel-demo down -v` removed the demo containers, network and volume.

Not covered: Docker on Linux or macOS; the Agent API and MCP server against the container (no token was set in that run); browser checks (unavailable by design); image size (about 1.4 to 1.5 GB each, single-stage).

## Other checks and their limits

- **GA4 public dataset:** evaluated, not integrated, from the documentation only (nothing was queried). Facts and reasons: [ADR-0008](./adr/0008-public-ga4-dataset-not-integrated.md).
- **Live URL tool:** `scripts/verify/url-live.mjs` was run once against `https://example.com` (HTTP 200 in about 79 ms; Chromium also loaded the page). One manual check of one simple site: it says nothing about redirects, large pages or sites that block automated clients. All automated tests use a local fixture site.
- **Secrets:** a grep of the tracked files for key-shaped strings and `.env` values found none. `.env` is git-ignored and excluded from the Docker build context.

## How to repeat

```bash
pnpm install && pnpm run setup && docker compose up -d db
pnpm check && pnpm test:int
node scripts/examples.mjs                       # regenerates docs/examples
docker compose up --build                        # one-command stack
pnpm build && pnpm dev                           # then, in another terminal, with the CLIs logged in:
pnpm verify:claude-code
CODEX_BIN="npx -y @openai/codex@latest" pnpm verify:codex
```
