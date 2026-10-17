import { z } from "zod";

/** Ledger values (spec §5.1). Prisma stores mode/status as upper-case enums. */
export const InvestigationStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;
export const TERMINAL_STATUSES: readonly InvestigationStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"];

export const FailureCodeSchema = z.enum([
  "MODEL_UNAVAILABLE",
  "MODEL_REFUSED",
  "MODEL_CONFIG_ERROR",
  "RUNTIME_UNAVAILABLE",
  "BUDGET_EXCEEDED",
  "REPORT_INVALID",
  "NO_REPORT",
  "INTERRUPTED",
  "INTERNAL_ERROR",
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

export const InvestigationSourceSchema = z.enum(["web", "api", "mcp"]);
export type InvestigationSource = z.infer<typeof InvestigationSourceSchema>;

/** `ai` runs store provider and model in Investigation.model, e.g. "anthropic:claude-opus-5-5". */
export const LedgerRuntimeSchema = z.enum(["deterministic", "ai", "external", "openclaw"]);
export type LedgerRuntime = z.infer<typeof LedgerRuntimeSchema>;

export const ToolExecutionStatusSchema = z.enum(["REQUESTED", "REJECTED", "RUNNING", "SUCCEEDED", "FAILED"]);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;

export const EvidenceKindSchema = z.enum([
  "metric",
  "comparison",
  "trend",
  "segment",
  "tracking",
  "landing_page",
  "change_log",
  "data_quality",
  "http",
  "content",
  "links",
  "browser",
  "availability",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceStrengthSchema = z.enum(["direct", "indirect", "context"]);
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;

export const EvidenceProvenanceSchema = z.enum(["synthetic-demo", "live-http"]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const ToolRejectionCodeSchema = z.enum([
  "UNKNOWN_TOOL",
  "INVALID_ARGUMENTS",
  "NOT_PERMITTED",
  "BUDGET_EXCEEDED",
  "INVESTIGATION_NOT_RUNNING",
]);
export type ToolRejectionCode = z.infer<typeof ToolRejectionCodeSchema>;
