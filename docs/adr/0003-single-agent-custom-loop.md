# ADR-0003: One agent, a custom tool-use loop, no framework

Status: accepted (2026-10-17)

## Context

The assignment allows OpenClaw or any framework (LangGraph, OpenAI Agents SDK, Semantic Kernel, a custom orchestrator) and asks that the choice be justified. The investigation is one task with a changing path: each tool result decides the next call.

## Options considered

| Option | Why not (or why) |
|---|---|
| LangGraph / Semantic Kernel / OpenAI Agents SDK | They add a graph or planner abstraction for a loop of about 150 lines, tie the state to a library, and make the three-provider requirement harder (each has its own model assumptions). |
| Multi-agent (planner plus specialists) | No evidence it would be better here: one agent with eleven good tools and a rubric is enough, and sub-agents multiply cost and failure modes. |
| OpenClaw as the only runtime | A valid runtime (see [ADR-0005](./0005-openclaw-external-runtime.md)) but unverified here and not something a reviewer can run offline. |
| **Custom loop behind a provider-neutral interface** | **Chosen.** |

## Decision

`Runner` (`apps/api/src/runtime/runner.ts`) owns the loop; an `AgentSession` (`start(task)`, `continue(results)`) hides the provider. Implementations: `AnthropicSession`, `OpenAISession`, `GeminiSession` (each keeps its own provider-native history), `DeterministicPolicy` (a rule tree with the same interface and no model), and `ScriptedSession` for tests. All tool results of a turn go back in one `continue` call. Budgets: 16 model turns, 24 tool calls, 3 report attempts, 5 minutes; a model that stops without a tool call is nudged twice and then fails with `NO_REPORT`. The model never sees the hidden scenario cause; conclusions must come from tool calls.

The deterministic policy is a first-class runtime, always labelled "No AI". It makes the demo, the tests and the examples reproducible offline, and it lets every claim about tools, validation and storage be tested without a model. It is not presented as an AI result.

Prompt hygiene: the system prompt is built from versioned parts (role, playbook, rules, rubrics, mode section) with no user data; the question and tool outputs travel only in messages; tool outputs are wrapped as untrusted data.

## Trade-offs

- Owning the loop means owning its edge cases (retries, refusal, abort, budget). They are covered by tests, but a framework would have supplied some for free.
- The deterministic policy can drift from what a model would do; the e2e tests assert only that its answers match the ground truth, not that a model would agree.

## How verified

Loop behaviour (turn and call budgets, nudges, refusal, cancel, interruption recovery) is tested with scripted sessions; the three provider sessions share one conformance suite run against a fake HTTP transport. **They were never run against the real provider APIs** (no keys were available). The same tools and report validation were exercised by two real agents, Claude Code and Codex, through MCP ([verification.md](../verification.md)).
