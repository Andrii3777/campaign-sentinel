import { describe, expect, it } from "vitest";
import { InvestigationReportSchema, reportSchemaForMode } from "./index";

const validReport = {
  schemaVersion: "1",
  summary:
    "Tracked conversions fell by 57% while backend-confirmed conversions stayed flat, which points to a broken pixel on the new thank-you page.",
  verdict: "cause_identified",
  severity: "high",
  severityRationale: "Tracked conversions down more than 30%; bidding runs on wrong data.",
  whatChanged: "Tracked CR fell from 4.2% to 1.8% [E1]; backend stable [E2].",
  observations: [{ statement: "Tracked CR fell from 4.2% to 1.8%.", evidenceIds: ["E1"] }],
  hypotheses: [
    {
      id: "H1",
      category: "tracking",
      statement: "The pixel stopped firing on the new thank-you page.",
      status: "supported",
      confidence: "high",
      confidenceRationale: "Two direct items agree.",
      supportingEvidenceIds: ["E1", "E2"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [],
  recommendedActions: [
    { action: "Restore the tag.", priority: "now", rationale: "Data is wrong.", hypothesisIds: ["H1"] },
  ],
  limitations: [],
  securityNotes: [],
};

describe("InvestigationReport v1", () => {
  it("accepts a valid demo report", () => {
    expect(reportSchemaForMode("demo").safeParse(validReport).success).toBe(true);
    expect(InvestigationReportSchema.safeParse(validReport).success).toBe(true);
  });

  it("rejects a demo category in a URL-mode report", () => {
    expect(reportSchemaForMode("url").safeParse(validReport).success).toBe(false);
  });

  it.each([
    ["summary shorter than 80 chars", { summary: "too short" }],
    ["unknown verdict", { verdict: "probably" }],
    ["observation without evidence", { observations: [{ statement: "x", evidenceIds: [] }] }],
    ["no hypotheses", { hypotheses: [] }],
    ["more than 5 security notes", { securityNotes: ["a", "b", "c", "d", "e", "f"] }],
    ["wrong schema version", { schemaVersion: "2" }],
    ["bad evidence id", { observations: [{ statement: "x", evidenceIds: ["e-1"] }] }],
    ["extra top-level field", { extra: true }],
  ])("rejects %s", (_label, patch) => {
    expect(reportSchemaForMode("demo").safeParse({ ...validReport, ...patch }).success).toBe(false);
  });
});
