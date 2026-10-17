import { z } from "zod";
import { EvidenceIdSchema, HypothesisIdSchema, type InvestigationMode } from "./common";

export const DemoCategorySchema = z.enum([
  "tracking",
  "traffic_source",
  "landing_page",
  "conversion_flow",
  "data_quality",
  "seasonality_or_external",
  "other",
]);
export const UrlCategorySchema = z.enum([
  "site_availability",
  "site_performance",
  "site_content",
  "tracking_setup",
  "seo_indexing",
  "security_headers",
  "other",
]);
export const CategorySchema = z.union([DemoCategorySchema, UrlCategorySchema]);
export type DemoCategory = z.infer<typeof DemoCategorySchema>;
export type UrlCategory = z.infer<typeof UrlCategorySchema>;
export type Category = z.infer<typeof CategorySchema>;

export const VerdictSchema = z.enum(["cause_identified", "likely_cause", "inconclusive", "no_issue_found"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "none"]);
export const HypothesisStatusSchema = z.enum(["supported", "plausible", "weakened", "ruled_out"]);
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export const ActionPrioritySchema = z.enum(["now", "next", "later"]);
export type Verdict = z.infer<typeof VerdictSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);

function buildReportSchema<C extends z.ZodType<string>>(category: C) {
  return z.strictObject({
    schemaVersion: z.literal("1"),
    summary: z.string().trim().min(80).max(1500),
    verdict: VerdictSchema,
    severity: SeveritySchema,
    severityRationale: text(500),
    whatChanged: text(800),
    observations: z
      .array(z.strictObject({ statement: text(1000), evidenceIds: z.array(EvidenceIdSchema).min(1) }))
      .min(1)
      .max(12),
    hypotheses: z
      .array(
        z.strictObject({
          id: HypothesisIdSchema,
          category,
          statement: text(1000),
          status: HypothesisStatusSchema,
          confidence: ConfidenceSchema,
          confidenceRationale: text(1000),
          supportingEvidenceIds: z.array(EvidenceIdSchema),
          contradictingEvidenceIds: z.array(EvidenceIdSchema),
        }),
      )
      .min(1)
      .max(8),
    unknowns: z
      .array(z.strictObject({ question: text(500), whyItMatters: text(500), howToResolve: text(500) }))
      .max(8),
    recommendedActions: z
      .array(
        z.strictObject({
          action: text(500),
          priority: ActionPrioritySchema,
          rationale: text(1000),
          hypothesisIds: z.array(HypothesisIdSchema),
        }),
      )
      .min(1)
      .max(8),
    limitations: z.array(text(1000)).max(8),
    securityNotes: z.array(text(1000)).max(5),
  });
}

/** Report v1 accepting either mode's categories; use `reportSchemaForMode` to enforce the mode. */
export const InvestigationReportSchema = buildReportSchema(CategorySchema);
export const DemoReportSchema = buildReportSchema(DemoCategorySchema);
export const UrlReportSchema = buildReportSchema(UrlCategorySchema);
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;

export function reportSchemaForMode(mode: InvestigationMode) {
  return mode === "demo" ? DemoReportSchema : UrlReportSchema;
}

export const ReportValidationErrorSchema = z.object({ path: z.string(), rule: z.string(), message: z.string() });
export type ReportValidationError = z.infer<typeof ReportValidationErrorSchema>;

/** Server-side attachments stored next to the validated report (spec §5.4). */
export const ReportAttachmentsSchema = z.object({
  keyMetrics: z.record(z.string(), z.unknown()),
  provenance: z.string(),
  toolFailures: z.array(z.object({ tool: z.string(), code: z.string(), message: z.string() })),
  evidenceIndex: z.record(z.string(), z.string()),
  runtime: z.string(),
  model: z.string().nullable(),
  validationWarnings: z.array(z.string()),
});
export type ReportAttachments = z.infer<typeof ReportAttachmentsSchema>;
export type StoredReportPayload = InvestigationReport & ReportAttachments;
