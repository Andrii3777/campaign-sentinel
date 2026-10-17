# OpenClaw integration

Status: **verified once** (see [Verified on Windows](#verified-on-windows)). The steps below follow the OpenClaw
documentation; the app side (the dispatcher and its failure handling) is also tested against a fake gateway.

## How it fits

```
Sentinel UI/API --POST /v1/responses--> OpenClaw gateway --agent "sentinel"--> MCP stdio: apps/mcp/dist/index.js
                                                                                      |
                                                                                      v  Agent API (bearer token)
                                                                              ToolExecutor + ReportService
```

1. You start an investigation with the **OpenClaw** runtime. The app creates the run and posts a task naming that
   investigation id to `${OPENCLAW_GATEWAY_URL}/v1/responses` (`model: "openclaw/<OPENCLAW_AGENT_ID>"`,
   `user: "inv:<id>"`, bearer `OPENCLAW_GATEWAY_TOKEN`) and waits up to 10 minutes.
2. The `sentinel` agent calls the `campaign-sentinel` MCP tools. The task names the existing investigation id, so the
   agent passes it as `investigation_id` and does not call `start_investigation`; the Agent API accepts tool calls and
   `submit_report` for that RUNNING `openclaw` run (and refuses runs of the built-in runtimes with 409). They run through the same `ToolExecutor` and
   `ReportService` as every other runtime, so the evidence ledger and report validation are identical.
3. When the gateway answers, the run is judged by what was stored: an accepted report means `COMPLETED`; none means
   `FAILED / NO_REPORT` with the agent's last message (truncated to 500 characters) in the failure event;
   an unreachable or refusing gateway means `FAILED / RUNTIME_UNAVAILABLE`.

## Install and configure (from the docs, not run here)

1. Node 26 is what this repo is developed on. Install OpenClaw:
   `npm install -g openclaw@latest --allow-scripts=openclaw`
2. Onboard and install the background service: `openclaw onboard --install-daemon`
3. Give OpenClaw a model, either with a ChatGPT subscription login
   `openclaw models auth login --provider openai --method oauth`
   or with an API key through the onboarding wizard. (OpenClaw uses its own model credentials; they are
   independent of the Sentinel `LLM_PROVIDER` keys.)
4. Build the MCP server: `pnpm build` (creates `apps/mcp/dist/index.js`).
5. Merge `integrations/openclaw/openclaw.sentinel.json5` into `~/.openclaw/openclaw.json`: replace
   `<ABSOLUTE PATH TO REPO>` and `<OPENCLAW_GATEWAY_TOKEN>`. The fragment
   - registers the MCP server `campaign-sentinel` (stdio, `node apps/mcp/dist/index.js`); the server reads
     `SENTINEL_API_URL` and `SENTINEL_AGENT_TOKEN` from its environment, else from the repository `.env` next to
     `apps/mcp` (not the working directory), so on one machine no `env` block is needed (the fragment has an
     optional commented one),
   - adds the agent `sentinel` with `tools.allow: ["campaign-sentinel__*"]` plus the hardened-baseline denies,
   - enables `gateway.http.endpoints.responses` (off by default) and token auth on a loopback gateway.
   If your OpenClaw version names the agents block `agents.list` instead of `agents.entries`, keep the same entry.
6. Restart the gateway so the config is read: `openclaw gateway restart`.
7. Put the same values in Sentinel's `.env`: `OPENCLAW_GATEWAY_URL` (for example `http://127.0.0.1:18789`, the
   default gateway port in the docs), `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_AGENT_ID=sentinel`. Restart the API.
   `GET /api/health` then reports `openclaw: configured` and the runtime option is enabled in the UI.

## Verify

```
openclaw mcp doctor campaign-sentinel --probe     # the MCP server starts and lists its tools
openclaw security audit                            # no drift from the hardened baseline
```

Then start an investigation with the OpenClaw runtime from the UI and check that it ends `COMPLETED` with model
`openclaw:sentinel`. Record the result in `docs/verification.md`; until then the integration stays "experimental".

## Known limits

- The gateway call is one long request; there is no progress streaming, so the timeline fills as the agent's tool
  calls arrive through the Agent API, not from the gateway.
- OpenClaw chooses its own model and may be slower or less reliable than the built-in runtimes; a run that never
  submits a report ends `NO_REPORT`, it is not retried automatically.
- Tool names are prefixed by OpenClaw (`campaign-sentinel__<tool>`); the allow-list depends on that prefix. If
  `openclaw mcp doctor` shows a different prefix in your version, adjust `tools.allow`.
- If OpenClaw turns out not to fit, the same investigation can be driven by Claude Code or Codex through the same
  MCP server (see the verification scripts); nothing in the app depends on OpenClaw.

## Verified on Windows

One real run, 2026-10-17: OpenClaw 2026.10.4, native local gateway (desktop app onboarding, "Install a local native gateway"),
loopback `127.0.0.1:18789`, token auth, agent `sentinel` on the `claude-cli` backend (a Claude Code login), model Sonnet.
Starting a demo investigation with the OpenClaw runtime ended `COMPLETED` (`likely_cause` / high, ground truth matched,
model `openclaw:sentinel`); the first report was rejected by the validator and the second accepted. Not run: the OpenClaw chat
path and URL mode.

What the run taught:

- **A per-agent exec override is required on the `claude-cli` backend.** Claude Code hides MCP tool schemas behind its own
  `ToolSearch`; with the global `tools.exec.security: "deny"` that call is refused (`OpenClaw exec policy denied native tool
  use`) and the agent ends `NO_REPORT`. `agents.entries.sentinel.tools.exec = { security: "full", ask: "off" }` fixes it (it is in
  the fragment). The agent's `tools.allow` is still only `campaign-sentinel__*` and `deny` keeps `group:runtime`, `group:fs` and
  the session tools; the global hardened baseline is unchanged. **This does not make the agent safe.** A probe run on the
  same day showed that `sentinel` can still use Claude Code's native `Read` tool: it read `C:/Windows/win.ini` with no denial,
  so `deny: group:fs` does not apply to native tools on this backend. No shell tool was exposed (`ToolSearch` found no
  Bash/PowerShell and a marker file was not created). `Write` and `Edit` were not tested. Consequence: in URL mode a hostile page
  could try to make the agent read local files and put their contents into a report. Use the OpenClaw runtime for demo
  campaigns on your own machine only, or give `sentinel` an API-key model (embedded runtime, no native tools) instead of the
  Claude Code login. `openclaw security audit` does not test any of this.
- **Multi-agent configs need `agents.ownership: "explicit"`** and `agents.defaults.systemAgent.agentId` (the gateway refused to start
  without them; `openclaw doctor --fix` adds them). `openclaw config validate` reports this.
- **The gateway takes about two minutes to start** after a restart; a gateway that "exited immediately" is usually an invalid
  config (run it in a terminal to see the message).
- **Restarting the Sentinel API interrupts a RUNNING OpenClaw run** (`INTERRUPTED`); recovery on boot is by design.
- **Do not run `openclaw` commands before onboarding is finished**: on Windows the Store alias starts the first-run setup.
- The audit's warnings about file permissions on `~/.openclaw` (group-readable token files) were left as they are; the fix
  commands are printed by `openclaw security audit`.

