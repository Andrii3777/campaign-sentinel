import type { InvestigationEventDto } from "@campaign-sentinel/contracts";
import { describe, expect, it } from "vitest";
import { buildTimeline, layerHeight, layersOf } from "./timeline";

let seq = 0;
function ev(type: InvestigationEventDto["type"], payload: unknown, at = "2026-10-17T10:00:00.000Z"): InvestigationEventDto {
  seq += 1;
  return { id: `e${seq}`, investigationId: "i1", seq, type, at, payload };
}
const requested = (id: string, tool: string, reason = "because") => ev("tool.call_requested", { toolExecutionId: id, tool, input: {}, reason, callerRef: null });

describe("buildTimeline", () => {
  it("folds the events of one tool call into one row with its final status, attempt and duration", () => {
    seq = 0;
    const rows = buildTimeline([
      ev("investigation.started", {}),
      ev("agent.turn", { turn: 1, model: "m", stopReason: "tool_use", inputTokens: null, outputTokens: null }),
      requested("t1", "compare_periods", "Measure the change"),
      ev("tool.call_started", { toolExecutionId: "t1", attempt: 1 }),
      ev("evidence.recorded", { evidenceId: "E1", kind: "comparison", strength: "indirect", statement: "s" }),
      ev("tool.call_succeeded", { toolExecutionId: "t1", durationMs: 71, attempt: 1, evidenceIds: ["E1"] }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["lifecycle", "turn", "tool"]);
    expect(rows[2]).toMatchObject({ kind: "tool", tool: "compare_periods", reason: "Measure the change", status: "succeeded", attempt: 1, durationMs: 71, evidenceRefs: ["E1"] });
  });

  it("keeps a rejected call as a rejected row with its code and issues", () => {
    seq = 0;
    const rows = buildTimeline([requested("t1", "fetch_page"), ev("tool.call_rejected", { toolExecutionId: "t1", code: "NOT_PERMITTED", issues: ["demo mode"] })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool", status: "rejected", rejection: { code: "NOT_PERMITTED", issues: ["demo mode"] } });
  });

  it("shows a failed call, its retry row, and the second attempt running on the same tool row", () => {
    seq = 0;
    const rows = buildTimeline([
      requested("t1", "get_daily_trend"),
      ev("tool.call_started", { toolExecutionId: "t1", attempt: 1 }),
      ev("tool.call_failed", { toolExecutionId: "t1", durationMs: 5000, attempt: 1, code: "TIMEOUT", retryable: true }),
      ev("tool.call_retry_scheduled", { toolExecutionId: "t1", attempt: 2, delayMs: 500 }),
      ev("tool.call_started", { toolExecutionId: "t1", attempt: 2 }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["tool", "retry"]);
    expect(rows[0]).toMatchObject({ status: "running", attempt: 2, errorCode: "TIMEOUT" });
    expect(rows[1]).toMatchObject({ kind: "retry", attempt: 2, delayMs: 500 });
  });

  it("renders guardrails, report outcomes and the terminal status; submitted reports and evidence events add no row", () => {
    seq = 0;
    const rows = buildTimeline([
      ev("guardrail.triggered", { kind: "prompt_injection_suspected", details: { tool: "check_landing_page" } }),
      ev("report.submitted", { attempt: 1 }),
      ev("report.rejected", { attempt: 1, errors: [{ path: "summary", rule: "schema", message: "too short" }] }),
      ev("report.accepted", { attempt: 2, verdict: "cause_identified", severity: "high" }),
      ev("investigation.completed", {}),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["guardrail", "report", "report", "terminal"]);
    expect(rows[1]).toMatchObject({ outcome: "rejected", attempt: 1 });
    expect(rows[2]).toMatchObject({ outcome: "accepted", verdict: "cause_identified" });
    expect(rows[3]).toMatchObject({ status: "COMPLETED" });
  });
});

describe("layerHeight", () => {
  // log scale between 10 ms (6 px) and 10 s (48 px): 100 ms is a third of the way, 1 s two thirds.
  it("scales duration logarithmically between 6 and 48 px", () => {
    expect(layerHeight(0)).toBe(6);
    expect(layerHeight(10)).toBe(6);
    expect(layerHeight(100)).toBe(20);
    expect(layerHeight(1000)).toBe(34);
    expect(layerHeight(10_000)).toBe(48);
    expect(layerHeight(600_000)).toBe(48);
  });
});

describe("layersOf", () => {
  it("makes one layer per tool call and per guardrail, in event order", () => {
    seq = 0;
    const rows = buildTimeline([
      requested("t1", "compare_periods"),
      ev("tool.call_succeeded", { toolExecutionId: "t1", durationMs: 100, attempt: 1, evidenceIds: [] }),
      ev("guardrail.triggered", { kind: "budget_limit", details: {} }),
      ev("agent.turn", { turn: 2, model: "m", stopReason: "end_turn", inputTokens: null, outputTokens: null }),
      requested("t2", "submit_report"),
    ]);
    expect(layersOf(rows).map((l) => [l.tool ?? l.kind, l.status])).toEqual([
      ["compare_periods", "succeeded"],
      ["guardrail", "guardrail"],
      ["submit_report", "requested"],
    ]);
  });
});
