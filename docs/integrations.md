# Integrations: which client drives Campaign Sentinel, and what is verified

Every external agent works through the same boundary: the stdio MCP server `apps/mcp` (no database access) calls the token-protected **Agent API** (`/api/agent/*`), which runs every tool through the same `ToolExecutor` and every report through the same `ReportService` as the built-in runtimes. The run appears in the UI with source `mcp`, runtime `external` and the client's declared name (taken from the MCP `initialize` handshake). Design: [ADR-0004](./adr/0004-agent-api-and-mcp-adapter.md).

Status words used everywhere in this repository: **verified** = a real run was made and recorded; **configured** = the files are committed and follow the client's documentation, but no run through that client was recorded; **experimental** = documented from the vendor docs, never run. The same table drives the UI page `/integrations` through [verification.json](./verification.json).

| Client | Status | Config files (committed, contain no secret) | Skill | MCP client name seen by the API |
|---|---|---|---|---|
| Claude Code | **verified** 2026-10-17 | `.mcp.json` | `.claude/skills/investigate-campaign/SKILL.md` | `claude-code` |
| Codex CLI | **verified** 2026-10-17 | `.codex/config.toml` (loads only when the project is trusted in your `~/.codex/config.toml`) | `.agents/skills/investigate-campaign/SKILL.md` | `codex-mcp-client` |
| Cursor | verified (one manual demo run) | `.cursor/mcp.json`, `.cursor/rules/campaign-sentinel.mdc` | reads `.agents/skills/` | not seen |
| Antigravity | **verified** 2026-10-17 (manual) | `.agents/mcp_config.json` (not auto-loaded by the tested version; use the global config, see below), `.agents/rules/campaign-sentinel.md` | `.agents/skills/investigate-campaign/SKILL.md` (discovered) | `antigravity-client` (v1.0.0) |
| OpenClaw | **verified once** (one runtime run) | `integrations/openclaw/openclaw.sentinel.json5` (merge into `~/.openclaw/openclaw.json`) | `.agents/skills/` in the agent workspace | not seen |

The two skill files are generated from one playbook (`packages/contracts/src/prompts/playbook.ts`, the same text the built-in agent's system prompt uses) by `pnpm skills:sync`; a test fails when a copy drifts.

## Prerequisites for every client

1. `pnpm install`, `pnpm run setup` (creates `.env` with `SENTINEL_AGENT_TOKEN`), `docker compose up -d db`, `pnpm db:migrate`, `pnpm db:seed`.
2. `pnpm build` (creates `apps/mcp/dist/index.js`; the configs run `node apps/mcp/dist/index.js`).
3. `pnpm dev` (API on `:4000`; web on `:3000` to see the run).
4. In the client, ask: *"Investigate the demo campaign `home-insurance-search`."* (The prompt names only the campaign id, never the hidden cause.) The client should use the `investigate-campaign` skill and the `campaign-sentinel` MCP tools, then give you the verdict and the run's URL.

The MCP server finds the API address and token itself: the process environment first, then the repository `.env` located relative to the server file (not the working directory). That is why no config file carries a token.

## Per client

### Claude Code (verified)

- Config: `.mcp.json` at the repository root: `{"mcpServers":{"campaign-sentinel":{"command":"node","args":["apps/mcp/dist/index.js"]}}}`. Claude Code asks once whether to trust the project MCP server.
- Skill: `.claude/skills/investigate-campaign/`.
- Repeatable check: `pnpm verify:claude-code` runs `claude -p` headless (`--model claude-sonnet-5-5 --max-turns 14 --mcp-config .mcp.json --strict-mcp-config --allowedTools "mcp__campaign-sentinel__*" --permission-mode dontAsk --output-format json`), then checks through the public API that a run from client `claude-code` on the campaign is `COMPLETED` with a stored report. It uses your Claude subscription (one short run).

### Codex CLI (verified)

- Config: `.codex/config.toml` with `[mcp_servers.campaign-sentinel]` (`command = "node"`, `args = ["apps/mcp/dist/index.js"]`, `startup_timeout_sec = 20`, `tool_timeout_sec = 60`). Codex loads project config only for a project you have marked trusted in `~/.codex/config.toml`; a `-c` override on the command line does not grant that trust.
- Skill: `.agents/skills/investigate-campaign/`. `codex debug prompt-input` lists `investigate-campaign` among the available skills.
- Repeatable check: `pnpm verify:codex` passes the MCP server inline with `-c` so it works without trusting the project; it uses `-s read-only -c windows.sandbox="unelevated"` and `-c approval_policy="never"` for that one invocation (nothing is written to a file). Set `CODEX_BIN="npx -y @openai/codex@latest"` if your installed Codex is too old for its current default model (the developer's 0.132.0 was; 0.163.0 worked).
- Read-only tools carry the MCP annotation `readOnlyHint: true`, which lets Codex run them without approval prompts; `submit_report` and `start_investigation` are not read-only. A first Codex attempt blocked on `submit_report` because of a wrong `openWorldHint` annotation; that was fixed in `apps/mcp/src/server.ts` before the verified run. `start_investigation` also stays `openWorldHint: false`: setting it to `true` (URL mode does reach the web) made Codex refuse the call under `approval_policy="never"` (see [verification.md](./verification.md)). MCP arguments are checked too: `investigation_id` must have the cuid shape, and the server refuses a non-loopback `SENTINEL_API_URL` unless `SENTINEL_ALLOW_REMOTE_API=1`.

### Cursor (verified once, by hand)

- `.cursor/mcp.json`: `"type": "stdio"`, `command "node"`, `args ["${workspaceFolder}/apps/mcp/dist/index.js"]`. `.cursor/rules/campaign-sentinel.mdc` points the agent to the skill and forbids calling the API or database directly.
- Manual steps: open the folder in Cursor, enable the `campaign-sentinel` server under Settings → MCP (it should list its tools), then give the prompt above in Agent mode.
- Verified: one manual demo run in the Cursor desktop app, client `cursor-vscode`, run `cmvco8d9x0000osxflqw9ktnm`, COMPLETED, ground truth matched. Cursor does not start project MCP servers by itself: enable the server under Settings -> MCP first. Not verified: URL mode through Cursor; nothing in the repository drives Cursor headlessly.

### Antigravity (verified, manual run)

- Committed files: `.agents/mcp_config.json` (`command`, `args`, `cwd: "."`) and the rule `.agents/rules/campaign-sentinel.md` (`trigger: model_decision`). The skill is read from `.agents/skills/`.
- What worked in the tested Antigravity desktop app: the project skill `investigate-campaign` was discovered (Customizations → Skills), but the workspace file `.agents/mcp_config.json` was **not** picked up by that version. Add the server to the global file `~/.gemini/config/mcp_config.json` instead, with an entry `campaign-sentinel`: `"command": "node"`, `"args": ["<absolute path>/apps/mcp/dist/index.js"]`. After a restart the app showed the server with 15 tools. `pnpm ide:antigravity` does exactly this edit for you: it writes the entry with the absolute path and no token, makes a timestamped `.bak-campaign-sentinel-…` copy of the file first, leaves every other server and the file's formatting alone, refuses to overwrite a different existing `campaign-sentinel` entry unless you pass `--force`, and prints what it changed. Preview with `pnpm ide:antigravity --dry-run`. It is opt-in and never runs as part of `setup`, `build` or the tests. Before asking an IDE to use the server, `pnpm run doctor` checks the build, `.env`, Postgres, the API and a real MCP handshake.
- Then open the folder as the workspace and give the prompt above (for example "Investigate the demo campaign home-insurance-search"). The skill and the MCP tools were used from that prompt; explicit mention syntax for the skill was not verified.
- Permission prompts: every MCP tool call asked "Allow using this MCP tool?" (this time / this conversation / this project / always). To avoid repeated prompts, add the server name to the allow list under Customizations → MCP Tools, or choose "always allow in this project".
- Client name seen by the API: `antigravity-client` version `v1.0.0` (from the MCP `initialize` handshake).
- Verified: one manual run on 2026-10-17, run `cmvcftoot0001bgxfraof359i` (campaign `home-insurance-search`), `COMPLETED`, 8 tool calls, `cause_identified` / high, source `mcp`, runtime `external`. The server-side validator rejected report attempt 1 (rule `high_confidence`) and accepted the repaired attempt 2. Not automated; one run, one campaign. Details: [verification.md](./verification.md).
- URL mode, checked the same day with two more manual runs against `https://example.com` (`cmvcgtbfu0017kkxf27ewfzvb`, `cmvchdj2j0000c4xf9nok6t0m`): both `likely_cause` / medium, 6 HTTP requests, 1 report attempt, same result as a deterministic URL run. In the first, `browser_check` was "unavailable" because the API process had cached a failed Chromium probe (restart fixed it); in the second Chromium loaded the page (200, DOMContentLoaded 260 ms, no console errors or failed requests).

### OpenClaw (verified once)

- Config fragment: `integrations/openclaw/openclaw.sentinel.json5` (MCP server, a locked-down `sentinel` agent with `tools.allow: ["campaign-sentinel__*"]`, the gateway's `/v1/responses` endpoint). Install, onboarding and the verification commands: [openclaw.md](./openclaw.md); where the keys go: [setup-keys.md](./setup-keys.md).
- Two ways to use it: chat with the `sentinel` agent inside OpenClaw (it calls the MCP tools like any other client), or start an investigation with the **OpenClaw** runtime in the UI (the app posts the task to the gateway and judges the run by what was stored).
- Verified: one real run from the UI/API OpenClaw runtime on Windows (see [verification.md](./verification.md)). Not verified: chatting with `sentinel` from OpenClaw's own UI, URL mode, other OpenClaw versions or backends. The `sentinel` agent needs a per-agent exec override and, on the `claude-cli` backend, can still read local files through Claude Code's native `Read` tool: use OpenClaw for demo campaigns only (details in [openclaw.md](./openclaw.md)).

## What "verified" does and does not prove

A verified run proves that the real client started the MCP server, discovered the tools and the skill, made adaptive tool calls, submitted a report that passed server-side validation, and that the run was stored and shown with the right source. It does not prove the quality of that client's reasoning in general: each was one short run with one campaign. Details and dates: [verification.md](./verification.md).
