import { z } from "zod";
import { PeriodSchema } from "./common";
import { EvidenceProvenanceSchema } from "./investigation";
import { ChangeLogCategorySchema } from "./tools";
import { CategorySchema, VerdictSchema } from "./report";

const rate = z.number().nullable();

const PeriodKpiSchema = z.object({
  period: PeriodSchema,
  sessions: z.number().int(),
  trackedConversions: z.number().int(),
  conversionRate: z.number(),
});

/** Headline KPIs of the default periods. Never carries scenario title, description or expected outcome (story 17). */
export const CampaignKpisSchema = z.object({
  baseline: PeriodKpiSchema,
  current: PeriodKpiSchema,
  /** (current CR − baseline CR) / baseline CR */
  relativeChange: z.number().nullable(),
});

export const CampaignListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  channels: z.string(),
  provenance: EvidenceProvenanceSchema,
  dataset: z.string(),
  kpis: CampaignKpisSchema,
  hasSimulatedFault: z.boolean(),
});
export type CampaignListItem = z.infer<typeof CampaignListItemSchema>;
export const CampaignListResponseSchema = z.object({ items: z.array(CampaignListItemSchema) });

const SegmentPeriodSchema = z.object({ sessions: z.number().int(), share: z.number(), conversionRate: z.number() });

export const CampaignDetailSchema = CampaignListItemSchema.extend({
  conversionEvent: z.string(),
  dataRange: PeriodSchema,
  defaultPeriods: z.object({ baseline: PeriodSchema, current: PeriodSchema }),
  daily: z.array(
    z.object({
      date: z.string(),
      sessions: z.number().int(),
      trackedConversions: z.number().int(),
      backendConversions: z.number().int(),
      trackedConversionRate: rate,
      backendConversionRate: rate,
    }),
  ),
  sources: z.array(z.object({ segment: z.string(), baseline: SegmentPeriodSchema, current: SegmentPeriodSchema })),
  devices: z.array(z.object({ segment: z.string(), baseline: SegmentPeriodSchema, current: SegmentPeriodSchema })),
  changeLog: z.array(
    z.object({ at: z.string(), category: ChangeLogCategorySchema, title: z.string(), description: z.string(), author: z.string().nullable() }),
  ),
  simulatedFaults: z.array(z.object({ tool: z.string(), message: z.string() })),
});
export type CampaignDetail = z.infer<typeof CampaignDetailSchema>;

/** Story 17: shown for COMPLETED demo runs only, computed after completion; never reachable by the agent or tools. */
export const GroundTruthSchema = z.object({
  expectedCategory: CategorySchema.nullable(),
  /** the accepted verdicts joined with " / " */
  expectedVerdict: z.string(),
  agentTopCategory: CategorySchema.nullable(),
  agentVerdict: VerdictSchema,
  match: z.boolean(),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
