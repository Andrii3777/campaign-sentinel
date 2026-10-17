import type { EventPayload, InvestigationEventDto, InvestigationStatus, Severity, Verdict } from "@campaign-sentinel/contracts";

/** What the page shows is only what the ledger persisted: rows are a fold over `InvestigationEvent`s, nothing is invented. */
export type ToolRowStatus = "requested" | "running" | "succeeded" | "failed" | "rejected";

type Base = { key: string; seq: number; at: string };
export type ToolRow = Base & {
  kind: "tool";
  toolExecutionId: string;
  tool: string;
  reason: string;
  input: unknown;
  callerRef: string | null;
  status: ToolRowStatus;
  attempt: number;
  durationMs: number | null;
  errorCode: string | null;
  retryable: boolean;
  evidenceRefs: string[];
  rejection: { code: string; issues: unknown[] } | null;
};
export type TimelineRow =
  | ToolRow
  | (Base & { kind: "lifecycle"; label: string })
  | (Base & { kind: "turn"; turn: number; model: string; stopReason: string; inputTokens: number | null; outputTokens: number | null })
  | (Base & { kind: "retry"; toolExecutionId: string; attempt: number; delayMs: number })
  | (Base & { kind: "dedup"; toolExecutionId: string; callerRef: string })
  | (Base & { kind: "guardrail"; guardKind: string; details: unknown })
  | (Base & { kind: "model"; outcome: "failed" | "retry"; code: string; attempt: number })
  | (Base & { kind: "report"; outcome: "rejected"; attempt: number; errors: EventPayload<"report.rejected">["errors"] })
  | (Base & { kind: "report"; outcome: "accepted"; attempt: number; verdict: Verdict; severity: Severity })
  | (Base & { kind: "terminal"; status: InvestigationStatus; message: string | null });

const terminal: Partial<Record<InvestigationEventDto["type"], InvestigationStatus>> = {
  "investigation.completed": "COMPLETED",
  "investigation.failed": "FAILED",
  "investigation.cancelled": "CANCELLED",
  "investigation.interrupted": "INTERRUPTED",
};

/** Folds persisted events into display rows. A tool call is one row whose status follows its events; `evidence.recorded` and `report.submitted` add no row (evidence has its own register; the submit_report call is already a row). */
export function buildTimeline(events: readonly InvestigationEventDto[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const tools = new Map<string, ToolRow>();
  const payload = <T extends InvestigationEventDto["type"]>(e: InvestigationEventDto) => e.payload as EventPayload<T>;

  for (const e of events) {
    const base = { key: `e${e.seq}`, seq: e.seq, at: e.at };
    switch (e.type) {
      case "investigation.created":
        rows.push({ ...base, kind: "lifecycle", label: "Investigation queued" });
        break;
      case "investigation.started":
        rows.push({ ...base, kind: "lifecycle", label: "Investigation started" });
        break;
      case "agent.turn": {
        const p = payload<"agent.turn">(e);
        rows.push({ ...base, kind: "turn", turn: p.turn, model: p.model, stopReason: p.stopReason, inputTokens: p.inputTokens, outputTokens: p.outputTokens });
        break;
      }
      case "tool.call_requested": {
        const p = payload<"tool.call_requested">(e);
        const row: ToolRow = {
          ...base,
          key: `tool-${p.toolExecutionId}`,
          kind: "tool",
          toolExecutionId: p.toolExecutionId,
          tool: p.tool,
          reason: p.reason,
          input: p.input,
          callerRef: p.callerRef,
          status: "requested",
          attempt: 0,
          durationMs: null,
          errorCode: null,
          retryable: false,
          evidenceRefs: [],
          rejection: null,
        };
        tools.set(p.toolExecutionId, row);
        rows.push(row);
        break;
      }
      case "tool.call_rejected": {
        const p = payload<"tool.call_rejected">(e);
        const row = tools.get(p.toolExecutionId);
        if (row) {
          row.status = "rejected";
          row.rejection = { code: p.code, issues: p.issues };
        }
        break;
      }
      case "tool.call_started": {
        const p = payload<"tool.call_started">(e);
        const row = tools.get(p.toolExecutionId);
        if (row) {
          row.status = "running";
          row.attempt = p.attempt;
        }
        break;
      }
      case "tool.call_succeeded": {
        const p = payload<"tool.call_succeeded">(e);
        const row = tools.get(p.toolExecutionId);
        if (row) {
          row.status = "succeeded";
          row.attempt = p.attempt;
          row.durationMs = p.durationMs;
          row.evidenceRefs = p.evidenceIds;
        }
        break;
      }
      case "tool.call_failed": {
        const p = payload<"tool.call_failed">(e);
        const row = tools.get(p.toolExecutionId);
        if (row) {
          row.status = "failed";
          row.attempt = p.attempt;
          row.durationMs = p.durationMs;
          row.errorCode = p.code;
          row.retryable = p.retryable;
        }
        break;
      }
      case "tool.call_retry_scheduled": {
        const p = payload<"tool.call_retry_scheduled">(e);
        rows.push({ ...base, kind: "retry", toolExecutionId: p.toolExecutionId, attempt: p.attempt, delayMs: p.delayMs });
        break;
      }
      case "tool.call_deduplicated": {
        const p = payload<"tool.call_deduplicated">(e);
        rows.push({ ...base, kind: "dedup", toolExecutionId: p.toolExecutionId, callerRef: p.callerRef });
        break;
      }
      case "guardrail.triggered": {
        const p = payload<"guardrail.triggered">(e);
        rows.push({ ...base, kind: "guardrail", guardKind: p.kind, details: p.details });
        break;
      }
      case "model.call_failed":
      case "model.call_retry": {
        const p = payload<"model.call_failed">(e);
        rows.push({ ...base, kind: "model", outcome: e.type === "model.call_failed" ? "failed" : "retry", code: p.code, attempt: p.attempt });
        break;
      }
      case "report.rejected": {
        const p = payload<"report.rejected">(e);
        rows.push({ ...base, kind: "report", outcome: "rejected", attempt: p.attempt, errors: p.errors });
        break;
      }
      case "report.accepted": {
        const p = payload<"report.accepted">(e);
        rows.push({ ...base, kind: "report", outcome: "accepted", attempt: p.attempt, verdict: p.verdict, severity: p.severity });
        break;
      }
      case "investigation.completed":
      case "investigation.failed":
      case "investigation.cancelled":
      case "investigation.interrupted": {
        const status = terminal[e.type]!;
        const message = (e.payload as { message?: string }).message ?? null;
        rows.push({ ...base, kind: "terminal", status, message });
        break;
      }
      default:
        break; // evidence.recorded, report.submitted
    }
  }
  return rows;
}

export type Layer = {
  key: string;
  kind: "tool" | "guardrail";
  tool: string | null;
  status: ToolRowStatus | "guardrail";
  durationMs: number | null;
  label: string;
};

/** Core strip layers: one per tool call, one wedge per guardrail. */
export function layersOf(rows: readonly TimelineRow[]): Layer[] {
  const layers: Layer[] = [];
  for (const row of rows) {
    if (row.kind === "tool") layers.push({ key: row.key, kind: "tool", tool: row.tool, status: row.status, durationMs: row.durationMs, label: row.tool });
    else if (row.kind === "guardrail") layers.push({ key: row.key, kind: "guardrail", tool: null, status: "guardrail", durationMs: null, label: `guardrail: ${row.guardKind}` });
  }
  return layers;
}

export const MIN_LAYER_PX = 6;
export const MAX_LAYER_PX = 48;

/** Layer height: log-scaled duration, 10 ms → 6 px, 10 s → 48 px. */
export function layerHeight(durationMs: number | null): number {
  if (durationMs === null || durationMs <= 10) return MIN_LAYER_PX;
  if (durationMs >= 10_000) return MAX_LAYER_PX;
  const t = (Math.log10(durationMs) - 1) / 3;
  return Math.round((MIN_LAYER_PX + (MAX_LAYER_PX - MIN_LAYER_PX) * t) * 100) / 100;
}
