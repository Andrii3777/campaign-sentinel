import { describe, expect, it } from "vitest";
import { ScenarioKeySchema, scenarioCatalogue, scenarioForCampaign, toolInputSchemas } from "./index";

describe("scenario catalogue", () => {
  it("lists the five scenarios of spec §8 with their expected outcome", () => {
    expect(scenarioCatalogue.map((s) => s.key)).toEqual([
      "tracking-break",
      "traffic-source-decline",
      "landing-page-mobile",
      "insufficient-data",
      "tool-failure",
    ]);
    expect(scenarioCatalogue.find((s) => s.key === "tracking-break")).toMatchObject({
      expectedCategory: "tracking",
      expectedSeverity: "high",
    });
    expect(scenarioCatalogue.find((s) => s.key === "insufficient-data")).toMatchObject({
      expectedCategory: null,
      expectedVerdicts: ["inconclusive"],
    });
    expect(ScenarioKeySchema.options).toHaveLength(5);
  });

  it("maps campaign ids to scenarios and never uses the key as the campaign id", () => {
    for (const s of scenarioCatalogue) {
      expect(scenarioForCampaign(s.campaignId)?.key).toBe(s.key);
      expect(s.campaignId).not.toContain(s.key);
    }
    expect(scenarioForCampaign("nope")).toBeNull();
  });
});

describe("get_change_log category", () => {
  it("accepts change-log categories, not report categories", () => {
    const schema = toolInputSchemas.get_change_log;
    expect(schema.safeParse({ reason: "Check deploys.", category: "deploy" }).success).toBe(true);
    expect(schema.safeParse({ reason: "Check deploys.", category: "landing_page" }).success).toBe(false);
  });
});
