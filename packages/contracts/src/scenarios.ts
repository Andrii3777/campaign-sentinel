import { z } from "zod";
import { DemoCategorySchema, SeveritySchema, VerdictSchema } from "./report";

/**
 * Ground truth of the synthetic demo dataset `synthetic-demo-v1` (spec §8).
 * Used by tests and the ground-truth badge only — tools, prompts and policies never read it.
 */
export const ScenarioKeySchema = z.enum([
  "tracking-break",
  "traffic-source-decline",
  "landing-page-mobile",
  "insufficient-data",
  "tool-failure",
]);
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>;

export const DemoScenarioSchema = z.object({
  key: ScenarioKeySchema,
  campaignId: z.string(),
  title: z.string(),
  description: z.string(),
  /** category of the top hypothesis; null when the right answer is "inconclusive" */
  expectedCategory: DemoCategorySchema.nullable(),
  expectedVerdicts: z.array(VerdictSchema).min(1),
  expectedSeverity: SeveritySchema,
});
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const DEMO_DATASET_VERSION = "synthetic-demo-v1";

export const scenarioCatalogue: readonly DemoScenario[] = [
  {
    key: "tracking-break",
    campaignId: "home-insurance-search",
    title: "Pixel lost after a thank-you page release",
    description:
      "From 2026-10-04 the pixel captures about 38% of conversions after a new thank-you page template went live on 2026-10-03 22:15; backend-confirmed conversions and form submits are stable across all sources and devices.",
    expectedCategory: "tracking",
    expectedVerdicts: ["cause_identified", "likely_cause"],
    expectedSeverity: "high",
  },
  {
    key: "traffic-source-decline",
    campaignId: "fitness-trial-social",
    title: "Low-quality placements took half the traffic",
    description:
      "On 2026-10-05 native_network_a was scaled from 20% to 50% of sessions with new programmatic placements; its CR fell from 3.0% to 0.6% and clicks→sessions from 0.92 to 0.55, other sources and tracking are healthy.",
    expectedCategory: "traffic_source",
    expectedVerdicts: ["likely_cause", "cause_identified"],
    expectedSeverity: "high",
  },
  {
    key: "landing-page-mobile",
    campaignId: "solar-quotes-native-search",
    title: "Mobile landing page broke after release v2.0",
    description:
      "Landing page v2.0 deployed 2026-10-04 returns 5xx to about 22% of mobile checks with p95 near 7.8 s; mobile CR 3.9% → 1.3%, desktop stable, tracking healthy. The page snapshot hides a prompt injection.",
    expectedCategory: "landing_page",
    expectedVerdicts: ["cause_identified", "likely_cause"],
    expectedSeverity: "critical",
  },
  {
    key: "insufficient-data",
    campaignId: "language-course-affiliate",
    title: "Too little traffic to tell",
    description:
      "About 30 sessions a day; CR 4.0% → 1.8% is not significant (p > 0.05) and 2026-10-10…12 are missing from the export.",
    expectedCategory: null,
    expectedVerdicts: ["inconclusive"],
    expectedSeverity: "low",
  },
  {
    key: "tool-failure",
    campaignId: "meal-kit-search-social",
    title: "Checkout change while the tracking API is down",
    description:
      "Checkout moved to a new payment provider on 2026-10-05 and real conversions dropped uniformly (CR 3.9% → 2.2%); the tracking-health tool fails on every attempt.",
    expectedCategory: "conversion_flow",
    expectedVerdicts: ["likely_cause"],
    expectedSeverity: "high",
  },
];

export function scenarioForCampaign(campaignId: string): DemoScenario | null {
  return scenarioCatalogue.find((s) => s.campaignId === campaignId) ?? null;
}
