# ADR-0009: Test strategy, and what doubles can and cannot prove

Status: accepted (2026-10-17)

## Context

The assignment asks for unit tests and at least one integration or end-to-end test. This project also depends on things a test cannot honestly cover offline: three LLM providers, two IDE agents, OpenClaw, a real browser. Mocks that pass can be mistaken for proof that an integration works.

## Options considered

| Option | Verdict |
|---|---|
| Tests that call real models and sites | Rejected for the suite: slow, paid, flaky, need secrets. |
| Mock everything and report "integrations tested" | Rejected: it would overstate what is known. |
| **Offline, deterministic tests with explicit doubles, plus separate, manual, recorded verification of real integrations** | **Chosen.** |

## Decision

1. **Unit tests** (`pnpm check`: typecheck, lint, unit tests of every package): pure maths (z-test, mix/rate decomposition, change point), the URL guard and sanitiser, grounding rules one by one, prompts, contracts, MCP server mapping, the web's data helpers.
2. **Integration and end-to-end tests** (`pnpm test:int`, PostgreSQL required): ledger repository (transitions, idempotency, sequence uniqueness), `ToolExecutor`, `ReportService`, public and Agent APIs, the MCP server spawned for real, a restart test that boots a second Nest instance on the same database, and the complete workflow through HTTP for each of the five demo scenarios and a URL scenario against a local fixture site. They assert persisted events, evidence and the report, and that no tool output contains the scenario's hidden cause.
3. **UI smoke test** (`pnpm test:ui`, Chromium and a running stack): start a run from a campaign page, watch the timeline fill and the verdict appear, see a private URL refused.
4. **Doubles, named as such:** a fake HTTP transport for the three provider SDKs (one conformance suite), a fake OpenClaw gateway, a scripted session for loop edge cases, a local fixture web server. The model is replaced by the deterministic policy or a scripted session; the network by the fixture site. No suite needs a key or the internet.
5. **Real-integration verification is separate and recorded** in [docs/verification.md](../verification.md): `pnpm verify:claude-code` and `pnpm verify:codex` run the real CLIs headless against the running app and check the stored result. A double never turns an integration into "verified".

The continuous-integration workflow (`.github/workflows/ci.yml`) runs steps 1 and 2 with a PostgreSQL service. It has **not yet been run on GitHub**.

## Trade-offs

- The three provider sessions are exercised only through fake transports, so a changed provider API would not be caught by the suite.
- The deterministic policy passing the ground-truth checks says nothing about how an LLM would perform; that needs an evaluation suite with real models (a production next step).
- Integration tests need Docker or a PostgreSQL instance; they take about 85 seconds.

## How verified

Counts and results of 2026-10-17 are in [verification.md](../verification.md). The strategy itself is reviewed by reading the test files next to the modules they cover.
