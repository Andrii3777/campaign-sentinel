# ADR-0005: OpenClaw as an external runtime

Status: accepted, integration experimental (2026-10-17)

## Context

The assignment names OpenClaw as one acceptable way to build the agent. The brief asks that OpenClaw be supported and that the user be told exactly where keys go and how to run it. OpenClaw was not installed on the developer's machine, and no instance was available while building.

## Options considered

| Option | Verdict |
|---|---|
| Build the whole agent inside OpenClaw | Rejected: the project could then be neither run nor tested offline, and the deterministic and IDE runtimes would not share the code. |
| Treat OpenClaw like any other MCP client only | Kept as one way to use it (chat with the `sentinel` agent). |
| **MCP client plus an app-side dispatcher** (the UI can start an OpenClaw run) | **Chosen.** |

## Decision

OpenClaw gets the same boundary as every other external agent: the MCP server `apps/mcp` and the Agent API. `integrations/openclaw/openclaw.sentinel.json5` registers the MCP server and a locked-down agent `sentinel` (`tools.allow: ["campaign-sentinel__*"]`, with the hardened-baseline denies) and enables the gateway's `/v1/responses` endpoint. In the UI, the OpenClaw runtime creates the investigation, posts a task naming that id to `${OPENCLAW_GATEWAY_URL}/v1/responses` (`model: "openclaw/<OPENCLAW_AGENT_ID>"`, bearer `OPENCLAW_GATEWAY_TOKEN`) and waits up to 10 minutes. The run is then judged by what was stored: an accepted report completes it; none ends `FAILED / NO_REPORT` with the agent's last message (truncated) in an event; an unreachable gateway ends `FAILED / RUNTIME_UNAVAILABLE`. The Agent API accepts tool calls and the report for that existing RUNNING `openclaw` run without creating another one.

Steps, config and verification commands: [docs/openclaw.md](../openclaw.md). Keys: [docs/setup-keys.md](../setup-keys.md).

## Trade-offs

- The gateway call is one long request without progress streaming; the timeline fills as the agent's tool calls arrive through the Agent API.
- OpenClaw prefixes MCP tool names (`campaign-sentinel__<tool>`); the allow-list depends on that, and the documented config shape may differ between OpenClaw versions.
- Nothing in the app depends on OpenClaw: if it does not fit, Claude Code or Codex drive the same investigation.

## How verified

**Not verified against OpenClaw.** The dispatcher and its failure handling are tested against a fake gateway; the config fragment and setup steps come from the OpenClaw documentation. Status: experimental until someone runs `openclaw mcp doctor campaign-sentinel --probe` and a full run on a real install and records it in [verification.md](../verification.md).
