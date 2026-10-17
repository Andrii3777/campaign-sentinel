import { z } from "zod";
import { InvestigationModeSchema } from "./common";
import {
  EvidenceKindSchema,
  EvidenceStrengthSchema,
  FailureCodeSchema,
  InvestigationSourceSchema,
  LedgerRuntimeSchema,
  ToolRejectionCodeSchema,
} from "./investigation";
import { ReportValidationErrorSchema, SeveritySchema, VerdictSchema } from "./report";

const ClientSchema = z.object({
  name: z.string().nullable(),
  version: z.string().nullable(),
  userAgent: z.string().nullable(),
});
const empty = z.object({});
const failure = z.object({ code: FailureCodeSchema, message: z.string() });
const int = z.number().int();

/** Payload schema per event type (spec §5.1). Payloads never contain secrets or hidden reasoning. */
export const eventPayloadSchemas = {
  "investigation.created": z.object({
    mode: InvestigationModeSchema,
    source: InvestigationSourceSchema,
    runtime: LedgerRuntimeSchema,
    client: ClientSchema,
  }),
  "investigation.started": empty,
  "investigation.completed": empty,
  "investigation.failed": failure,
  "investigation.cancelled": z.object({ message: z.string().optional() }),
  "investigation.interrupted": failure,
  "agent.turn": z.object({
    turn: int,
    model: z.string(),
    stopReason: z.string(),
    inputTokens: int.nullable(),
    outputTokens: int.nullable(),
  }),
  "tool.call_requested": z.object({
    toolExecutionId: z.string(),
    tool: z.string(),
    input: z.unknown(),
    reason: z.string(),
    callerRef: z.string().nullable(),
  }),
  "tool.call_rejected": z.object({
    toolExecutionId: z.string(),
    code: ToolRejectionCodeSchema,
    issues: z.array(z.unknown()),
  }),
  "tool.call_started": z.object({ toolExecutionId: z.string(), attempt: int }),
  "tool.call_succeeded": z.object({
    toolExecutionId: z.string(),
    durationMs: int,
    attempt: int,
    evidenceIds: z.array(z.string()),
  }),
  "tool.call_failed": z.object({
    toolExecutionId: z.string(),
    durationMs: int,
    attempt: int,
    code: z.string(),
    retryable: z.boolean(),
  }),
  "tool.call_retry_scheduled": z.object({ toolExecutionId: z.string(), attempt: int, delayMs: int }),
  "tool.call_deduplicated": z.object({ toolExecutionId: z.string(), callerRef: z.string() }),
  "evidence.recorded": z.object({
    evidenceId: z.string(),
    kind: EvidenceKindSchema,
    strength: EvidenceStrengthSchema,
    statement: z.string(),
  }),
  "guardrail.triggered": z.object({
    kind: z.enum(["prompt_injection_suspected", "ssrf_blocked", "budget_limit", "output_truncated"]),
    details: z.unknown(),
  }),
  "model.call_failed": z.object({ code: z.string(), attempt: int }),
  "model.call_retry": z.object({ code: z.string(), attempt: int }),
  "report.submitted": z.object({ attempt: int }),
  "report.rejected": z.object({ attempt: int, errors: z.array(ReportValidationErrorSchema) }),
  "report.accepted": z.object({ attempt: int, verdict: VerdictSchema, severity: SeveritySchema }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;
export const EventTypeSchema = z.enum(Object.keys(eventPayloadSchemas) as [EventType, ...EventType[]]);
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const InvestigationEventSchema = z.object({
  id: z.string(),
  investigationId: z.string(),
  seq: int.min(1),
  type: EventTypeSchema,
  at: z.string(),
  payload: z.unknown(),
});
export type InvestigationEventDto = z.infer<typeof InvestigationEventSchema>;
