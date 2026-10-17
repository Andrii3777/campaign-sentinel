# ADR-0004: Agent API boundary and a stdio MCP adapter

Status: accepted (2026-10-17)

## Context

IDE agents (Claude Code, Codex, Cursor, Antigravity) and OpenClaw should be able to run the same investigation, and every run must land in the same ledger and the same UI with its source shown. External agents must not be able to reach the database.

## Options considered

| Option | Verdict |
|---|---|
| MCP server with direct database access | Rejected: an agent runtime would hold database credentials. |
| MCP server embedded in the Nest process over Streamable HTTP | Works (checked at the start of the build), but IDEs launch stdio servers more simply, and it would expose the tools on the public port. |
| IDE agents calling REST with a skill telling them how | Rejected: no tool schemas, no annotations, every client reinvents the calls. |
| **Token-protected Agent API plus a thin stdio MCP server that holds no database credentials** | **Chosen.** |

## Decision

`/api/agent/*` (bearer `SENTINEL_AGENT_TOKEN`, compared in constant time on SHA-256 digests; 401 when the token is missing, wrong or not configured; 403 for a non-local `Host` or an `Origin` that is not localhost) exposes: list campaigns, start an investigation, run one tool for one investigation, submit the report, read the status. `apps/mcp` maps these to 15 MCP tools with JSON Schemas generated from the contracts package (`readOnlyHint` is true for every tool except `start_investigation` and `submit_report`). The MCP server forwards the `clientInfo` it received at `initialize` as the declared client, so the UI can show `claude-code` or `codex-mcp-client`. A single generated playbook feeds both the built-in system prompt and the `investigate-campaign` skill (`pnpm skills:sync`, with a drift test).

Safety limits on this boundary: tools are scoped to one investigation id; an external run can use only the tools of its mode; after 20 rejected calls per investigation the API stops recording more (a runaway agent cannot fill the ledger); the report endpoint always validates.

## Trade-offs

- Two processes to run (the API and the MCP child). The MCP server must be built (`pnpm build`) before a client can start it.
- The token authorises every agent endpoint; there are no per-client scopes or per-user identities. A production version needs both.
- The MCP server finds `.env` relative to its own file so no config file needs a secret; that is convenient on one machine and wrong for a remote deployment (use environment variables there).

## How verified

Integration tests cover the guard, the full agent flow, the rejected-call cap and an OpenClaw-style run, and spawn the real built MCP server with the SDK client. Claude Code and Codex each completed a real headless investigation through it on 2026-10-17 ([verification.md](../verification.md)). Cursor and Antigravity have committed configs only.
