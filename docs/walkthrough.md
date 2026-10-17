# Walkthrough: explaining the design in ten minutes

A guided tour for an interview or a code review. Everything here points at real files; line counts are the sizes on 2026-10-17. The agent path has no framework magic: Nest providers are plain classes with constructor injection, and the loop is ordinary `async` code.

## Part 1. One investigation, file by file (14 stops)

Scenario: a marketer clicks **Start investigation** on the Home Insurance campaign with the deterministic runtime.

| # | File | What happens there |
|---|---|---|
| 1 | `apps/web/components/campaign/start-form.tsx`, `apps/web/lib/api-client.ts` | The form sends `POST /api/investigations` with an `Idempotency-Key` (a double click returns the same run) and the header `X-Sentinel-Client: web`. Runtime options that cannot be used are disabled with a reason, taken from `/api/health`. |
| 2 | `apps/api/src/http/public/investigations.controller.ts` (91 lines) | Thin controller: parse, call the service, return JSON. Errors leave as `{code, message, details?}` through `common/http-error.filter.ts`; no stack traces. |
| 3 | `apps/api/src/http/public/investigations.service.ts` (185) | The use case: validate the body with the zod DTO from `packages/contracts`, check periods (`periodErrors`), idempotency, runtime availability, throttle (10 per minute per IP, URL runs 5), and for URL mode the SSRF guard. Then `ledger.create(...)` and `runner.enqueue(id)`. |
| 4 | `apps/api/src/ledger/ledger.service.ts` (486, the largest file after the demo tools) | The only writer of investigation state. `transition(id, from, to)` is `UPDATE ... WHERE status = from`, so two writers cannot both win; `appendEvent` allocates the next `seq` inside the same transaction; evidence refs `E1...` are numbered here. |
| 5 | `apps/api/src/runtime/runner.ts` (310) | The agent loop. A two-slot in-process queue picks the run up, asks `SessionFactory` for a session, moves `QUEUED -> RUNNING`, then loops (see Part 2). Budgets, cancel and the wall-clock deadline live here. |
| 6 | `apps/api/src/runtime/session-factory.ts`, `deterministic-policy.ts`, `providers/*` | `deterministic` returns the rule-tree session; `ai` returns the Anthropic, OpenAI or Gemini session chosen by `LLM_PROVIDER`. All implement `AgentSession.start / continue`. |
| 7 | `apps/api/src/runtime/demo-policy.ts` (329), `url-policy.ts` (174), `policy-kit.ts` | The no-AI policy: a generator of tool calls whose next step depends on the previous result (for example "if one source explains at least 60% of the change, check the change log; otherwise break down by device"). It reads tool outputs only, never scenario metadata. |
| 8 | `apps/api/src/tools/tool-executor.ts` (183) | Every tool call of every runtime passes here: schema validation, mode permission, budget, de-duplication by `callerRef`, timeout, one retry for transient errors, evidence creation, guardrail events. Rejections are recorded, not thrown. |
| 9 | `apps/api/src/tools/demo/demo-tools.ts` (566) and `apps/api/src/analysis/stats.ts` (214) | The seven demo tools read a `CampaignDataRepository` and compute facts: two-proportion z-test, mix/rate decomposition, change point, pixel versus backend reconciliation. Evidence statements are generated here, with numbers. |
| 10 | `apps/api/src/tools/url/url-tools.ts` and `apps/api/src/web-inspection/` (`url-guard.ts`, `safe-fetcher.ts`) | The four URL tools. `safe-fetcher.ts` connects to the already validated, pinned address and re-checks every redirect hop. |
| 11 | `apps/api/src/tools/untrusted-content.ts` | Third-party text is stripped of markup and control characters, truncated to 2000 characters, wrapped with a fixed notice and scanned for injection phrases; a hit becomes a `guardrail.triggered` event. |
| 12 | `apps/api/src/reports/report.service.ts` (213) and `grounding.ts` (200) | `submit_report` is just another tool. The service validates the report against the schema and the grounding rules for this investigation's evidence; accepted -> report row and `COMPLETED`; rejected -> errors back to the agent (3 attempts, then `FAILED / REPORT_INVALID`). |
| 13 | `apps/api/src/http/public/investigations.controller.ts` (`events`), `apps/web/components/investigation/live-investigation.tsx`, `apps/web/lib/timeline.ts` | The page polls `GET /events?after=<seq>` every second until the status is terminal and renders only persisted events; evidence chips link back to the tool call that produced them. |
| 14 | `apps/api/src/http/agent/agent.guard.ts`, `agent.service.ts`, `apps/mcp/src/server.ts` | The other door: an IDE agent starts a run through MCP, the MCP server calls the Agent API with the bearer token, and the same executor and report service answer. |

For contracts, read `packages/contracts/src/tools.ts` (tool specs and zod inputs), `report.ts` (report schema v1) and `prompts/` (the versioned system prompt and the playbook that also becomes the skill).

## Part 2. The agent loop in 20 lines

This is `Runner.drive` without logging and error mapping:

```
session = sessionFactory.createSession(investigation)        // deterministic | anthropic | openai | gemini
ledger.transition(QUEUED -> RUNNING, model = session.model)
turn = withRetry(session.start(task))                        // task: mode-scoped tools, system prompt, budgets
loop:
    record agent.turn event (tokens, stop reason)
    if turn.stopReason == refusal:           fail MODEL_REFUSED
    if turn.toolCalls is empty:
        nudges += 1; if nudges > 2:          fail NO_REPORT
        nudge = "call a tool or submit_report"
    else:
        for call in turn.toolCalls:
            check abort signal and wall-clock deadline
            results += toolExecutor.execute(id, call)        // validates, records, retries, creates evidence
        if investigation is no longer RUNNING: return        // report accepted (COMPLETED) or run cancelled
    if turns >= 16:                          fail BUDGET_EXCEEDED
    turn = withRetry(session.continue(results, nudge))        // all results of the turn in ONE call
```

`withRetry` retries a retryable model error once after a second (the SDKs retry on their own as well); a persistent failure ends the run `FAILED / MODEL_UNAVAILABLE`. The loop never decides what is true: only `ReportService` can complete a run.

## Part 3. The three hardest trade-offs

1. **Deterministic policy versus real model.** The demo, the tests and the examples need to be reproducible offline, so a rule tree implements the same `AgentSession` interface as a model. The price: its good results prove the tools, ledger and validation, not that an LLM would investigate well. Documents label it "No AI" everywhere, and the three provider sessions are marked unverified against real APIs.
2. **Strict grounding versus agent freedom.** Server-side rules reject unsupported certainty (high confidence needs a direct evidence item, no "cause identified" without a significant change, tool failures cap confidence). That makes reports trustworthy and sometimes costs an agent an attempt. The alternative, trusting the model's text, would let a confident wrong answer through, which is the one failure that hurts a marketer.
3. **One boundary for all runtimes versus convenience.** IDE agents cannot touch the database; they speak MCP to a thin stdio server that calls a token-protected API. That is two more moving parts than a direct call, and a single shared token with no per-client scopes. In exchange, every runtime shares one ledger, one validator and one UI, and a verified Claude Code or Codex run proves the same code path the UI uses.

## Part 4. Likely questions

**Why no LangGraph or another framework?** The task is one loop with a changing path; the loop is 150 lines behind a provider-neutral interface, which also made three providers and a deterministic twin cheap. A graph abstraction would add a dependency and hide the exact behaviour the assignment asks me to show (state, retries, budgets). ADR-0003.

**What stops the model from inventing a cause?** Evidence statements are generated by code from tool outputs; the report must cite evidence ids that exist; the grounding rules reject high confidence without direct evidence and reject "cause identified" without a significant change. Hidden scenario causes are never given to tools or prompts, and the e2e test checks tool outputs do not contain the scenario key. ADR-0006.

**What is verified and what is not?** Deterministic runtime, tools, ledger, validation, API and UI: automated tests plus a browser smoke test. Claude Code and Codex: one real headless run each; Antigravity and Cursor: manual runs in the desktop apps. Gemini session: one real run; Anthropic and OpenAI sessions: fake transports only. OpenClaw: one real runtime run. `docs/verification.md` lists dates and commands.

**How do you handle prompt injection?** Third-party text is sanitised, wrapped as untrusted data and scanned; the system prompt forbids following instructions in data; the model only has the tools of its mode and cannot write anywhere; and the report is validated. One demo scenario hides an injection in a landing-page snapshot (it asks the agent to say everything is fine and triple the budget); the deterministic run flags it in `securityNotes`. Heuristics are signals, not a defence on their own, and the permission model is what limits the damage.

**What happens if a tool or the model fails?** Transient tool errors are retried once; the agent then gets a typed error and can continue; the report must list what could not be checked and confidence in the affected category is capped (the `tool-failure` scenario shows this). Model errors: SDK retries, one loop-level retry, then `FAILED / MODEL_UNAVAILABLE`. A crashed API leaves runs `RUNNING`; on start, runs idle for more than 60 s become `INTERRUPTED` and can be retried as a new linked run.

**Is it used in a real business?** No: "Not in production today". The README lists three realistic users and what productionising needs (real connectors, SSO and tenancy, a job queue, monitoring, an evaluation suite with real models, human approval of actions, retention and compliance).

**What would you do next?** A real connector (GA4 or an ad platform) behind `CampaignDataRepository`; an evaluation suite running the five scenarios against each provider; per-client agent tokens; a queue and workers; scheduled anomaly detection with an alert that starts an investigation.

**Where is the code biggest, and is that a problem?** `demo-tools.ts` (566 lines) and `ledger.service.ts` (486) are the largest; most files are under 330 lines. The demo tools are seven small handlers in one file, and the ledger is one class with one job. Splitting either would be the first cleanup.
