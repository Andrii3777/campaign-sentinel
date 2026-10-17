import { z } from "zod";
import { InvestigationModeSchema, PeriodSchema } from "./common";
import { GroundTruthSchema } from "./campaigns";
import { InvestigationEventSchema } from "./events";
import {
  EvidenceKindSchema,
  EvidenceProvenanceSchema,
  EvidenceStrengthSchema,
  FailureCodeSchema,
  InvestigationSourceSchema,
  InvestigationStatusSchema,
  LedgerRuntimeSchema,
  ToolExecutionStatusSchema,
} from "./investigation";
import {
  InvestigationReportSchema,
  ReportAttachmentsSchema,
  ReportValidationErrorSchema,
  SeveritySchema,
  VerdictSchema,
} from "./report";
import { ToolNameSchema } from "./tools";

export const ApiErrorSchema = z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Runtime picked in the UI / public API; "ai" means the configured LLM provider. */
export const RuntimeChoiceSchema = z.enum(["deterministic", "ai", "openclaw"]);
export type RuntimeChoice = z.infer<typeof RuntimeChoiceSchema>;

const QuestionSchema = z.string().trim().min(1).max(500);
const TargetUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const CampaignIdSchema = z.string().min(1).max(100);

// ---- Public API (spec §5.9) ----
export const CreateInvestigationDtoSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("demo"),
    campaignId: CampaignIdSchema,
    question: QuestionSchema.optional(),
    baseline: PeriodSchema.optional(),
    current: PeriodSchema.optional(),
    runtime: RuntimeChoiceSchema,
  }),
  z.strictObject({
    mode: z.literal("url"),
    url: TargetUrlSchema,
    question: QuestionSchema.optional(),
    runtime: RuntimeChoiceSchema,
  }),
]);
export type CreateInvestigationDto = z.infer<typeof CreateInvestigationDtoSchema>;

export const ListInvestigationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  mode: InvestigationModeSchema.optional(),
  status: InvestigationStatusSchema.optional(),
});
export type ListInvestigationsQuery = z.infer<typeof ListInvestigationsQuerySchema>;

export const EventsQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0) });
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["up", "down"]),
  runtimes: z.object({
    deterministic: z.literal("available"),
    claude: z.enum(["available", "missing_key"]),
    openclaw: z.enum(["configured", "not_configured"]),
    browser: z.enum(["available", "unavailable"]),
    /** the configured LLM provider (spec G27): `LLM_PROVIDER`, its model id and whether its key is present */
    ai: z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
      status: z.enum(["available", "missing_key", "unknown_provider", "not_configured"]),
    }),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---- Public API responses (contract-cased: lower-case mode, provenance included) ----
const iso = z.string();
const nullableString = z.string().nullable();

/** One row of `GET /api/investigations` and the body of `POST /api/investigations` (201). */
export const InvestigationListItemSchema = z.object({
  id: z.string(),
  mode: InvestigationModeSchema,
  campaignId: nullableString,
  campaignName: nullableString,
  targetUrl: nullableString,
  question: z.string(),
  status: InvestigationStatusSchema,
  failureCode: FailureCodeSchema.nullable(),
  failureMessage: nullableString,
  source: InvestigationSourceSchema,
  runtime: LedgerRuntimeSchema,
  model: nullableString,
  clientName: nullableString,
  clientVersion: nullableString,
  provenance: EvidenceProvenanceSchema,
  verdict: VerdictSchema.nullable(),
  severity: SeveritySchema.nullable(),
  retryOfId: nullableString,
  createdAt: iso,
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
  durationMs: z.number().int().nullable(),
});
export type InvestigationListItem = z.infer<typeof InvestigationListItemSchema>;

export const InvestigationListResponseSchema = z.object({
  items: z.array(InvestigationListItemSchema),
  nextCursor: z.string().nullable(),
});
export type InvestigationListResponse = z.infer<typeof InvestigationListResponseSchema>;

/** The stored report payload: validated report v1 + server attachments (spec §5.4). */
export const StoredReportPayloadSchema = InvestigationReportSchema.extend(ReportAttachmentsSchema.shape);

export const EvidenceDtoSchema = z.object({
  ref: z.string(),
  kind: EvidenceKindSchema,
  strength: EvidenceStrengthSchema,
  statement: z.string(),
  data: z.unknown(),
  provenance: EvidenceProvenanceSchema,
  toolExecutionId: z.string(),
  createdAt: iso,
});
export type EvidenceDto = z.infer<typeof EvidenceDtoSchema>;

export const ToolExecutionDtoSchema = z.object({
  id: z.string(),
  tool: z.string(),
  callerRef: nullableString,
  input: z.unknown(),
  reason: z.string(),
  status: ToolExecutionStatusSchema,
  attempt: z.number().int(),
  errorCode: nullableString,
  errorMessage: nullableString,
  output: z.unknown(),
  outputTruncated: z.boolean(),
  createdAt: iso,
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
  durationMs: z.number().int().nullable(),
});
export type ToolExecutionDto = z.infer<typeof ToolExecutionDtoSchema>;

/** `GET /api/investigations/:id`: the run, its budgets, report, evidence (by number) and tool executions (in call order). */
export const InvestigationDetailSchema = InvestigationListItemSchema.extend({
  clientUserAgent: nullableString,
  periods: z.object({ baseline: PeriodSchema, current: PeriodSchema }).nullable(),
  counters: z.object({
    modelTurns: z.number().int(),
    toolCalls: z.number().int(),
    reportAttempts: z.number().int(),
    httpRequests: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
  budgets: z.object({
    modelTurns: z.number().int(),
    toolCalls: z.number().int(),
    reportAttempts: z.number().int(),
    httpRequests: z.number().int().nullable(),
    wallClockMs: z.number().int(),
  }),
  retryIds: z.array(z.string()),
  /** present only for COMPLETED demo runs (story 17) */
  groundTruth: GroundTruthSchema.optional(),
  report: z
    .object({ schemaVersion: z.string(), verdict: VerdictSchema, severity: SeveritySchema, summary: z.string(), createdAt: iso, payload: StoredReportPayloadSchema })
    .nullable(),
  evidence: z.array(EvidenceDtoSchema),
  toolExecutions: z.array(ToolExecutionDtoSchema),
});
export type InvestigationDetail = z.infer<typeof InvestigationDetailSchema>;

/** `GET /api/investigations/:id/events?after=<seq>`; `status` lets the poller stop on a terminal state. */
export const EventsResponseSchema = z.object({
  items: z.array(InvestigationEventSchema),
  status: InvestigationStatusSchema,
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// ---- Agent API (spec §5.10) ----
export const AgentClientSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().max(50).optional(),
});

const agentCommon = {
  question: QuestionSchema.optional(),
  client: AgentClientSchema,
  model: z.string().max(100).optional(),
};

export const AgentCreateInvestigationDtoSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("demo"), campaignId: CampaignIdSchema, ...agentCommon }),
  z.strictObject({ mode: z.literal("url"), url: TargetUrlSchema, ...agentCommon }),
]);
export type AgentCreateInvestigationDto = z.infer<typeof AgentCreateInvestigationDtoSchema>;

export const BudgetsSchema = z.object({
  toolCalls: z.number().int(),
  reportAttempts: z.number().int(),
  httpRequests: z.number().int(),
});
export type Budgets = z.infer<typeof BudgetsSchema>;

export const AgentCreateInvestigationResponseSchema = z.object({
  investigationId: z.string(),
  mode: InvestigationModeSchema,
  scope: z.string(),
  tools: z.array(z.object({ name: ToolNameSchema, description: z.string(), inputSchema: z.unknown() })),
  budgets: BudgetsSchema,
  periods: z.object({ baseline: PeriodSchema, current: PeriodSchema }).nullable(),
});
export type AgentCreateInvestigationResponse = z.infer<typeof AgentCreateInvestigationResponseSchema>;

export const AgentToolCallDtoSchema = z.strictObject({
  input: z.unknown(),
  callId: z.string().min(1).max(200).optional(),
});
export type AgentToolCallDto = z.infer<typeof AgentToolCallDtoSchema>;

export const AgentReportDtoSchema = z.strictObject({ report: z.unknown() });
export type AgentReportDto = z.infer<typeof AgentReportDtoSchema>;

export const AgentReportResponseSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true), url: z.string() }),
  z.object({ accepted: z.literal(false), errors: z.array(ReportValidationErrorSchema) }),
]);
export type AgentReportResponse = z.infer<typeof AgentReportResponseSchema>;

export const AgentInvestigationStatusSchema = z.object({
  investigationId: z.string(),
  mode: InvestigationModeSchema,
  status: InvestigationStatusSchema,
  evidence: z.array(z.object({ ref: z.string(), statement: z.string(), strength: z.string() })),
  budgetsLeft: BudgetsSchema,
});
export type AgentInvestigationStatus = z.infer<typeof AgentInvestigationStatusSchema>;
