import { URL_SCOPE_STATEMENT } from "@campaign-sentinel/contracts";
import { describe, expect, it } from "vitest";
import { validateReport, type GroundingContext, type GroundingResult } from "./grounding";

type Report = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const demoCtx = (over: Partial<GroundingContext> = {}): GroundingContext => ({
  mode: "demo",
  evidence: [
    { ref: "E1", kind: "comparison", strength: "indirect", tool: "compare_periods", data: {} },
    { ref: "E2", kind: "tracking", strength: "direct", tool: "inspect_tracking_health", data: {} },
    { ref: "E3", kind: "trend", strength: "indirect", tool: "get_daily_trend", data: {} },
    { ref: "E4", kind: "data_quality", strength: "indirect", tool: "compare_periods", data: {} },
  ],
  toolRuns: [
    { tool: "compare_periods", status: "SUCCEEDED" },
    { tool: "inspect_tracking_health", status: "SUCCEEDED" },
    { tool: "get_daily_trend", status: "SUCCEEDED" },
  ],
  comparison: { isSignificant: true, relativeChange: -0.57 },
  ...over,
});

const demoReport = (over: Report = {}): Report => ({
  schemaVersion: "1",
  summary:
    "Tracked conversions fell by 57% while backend-confirmed conversions stayed flat, which points to a broken pixel on the new thank-you page.",
  verdict: "cause_identified",
  severity: "high",
  severityRationale: "Tracked conversions down more than 30%; bidding runs on wrong data.",
  whatChanged: "Tracked CR fell from 4.2% to 1.8% [E1]; the pixel lost most conversions [E2].",
  observations: [{ statement: "Tracked CR fell from 4.2% to 1.8%.", evidenceIds: ["E1"] }],
  hypotheses: [
    {
      id: "H1",
      category: "tracking",
      statement: "The pixel stopped firing on the new thank-you page.",
      status: "supported",
      confidence: "high",
      confidenceRationale: "A direct pixel/backend divergence and the trend agree.",
      supportingEvidenceIds: ["E2", "E3"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [{ question: "Which page lost the tag?", whyItMatters: "Fix target.", howToResolve: "Inspect the template." }],
  recommendedActions: [{ action: "Restore the conversion tag.", priority: "now", rationale: "Bidding uses pixel data.", hypothesisIds: ["H1"] }],
  limitations: [],
  securityNotes: [],
  ...over,
});
const hyp = (over: Report) => [{ ...demoReport().hypotheses[0], ...over }];

const urlCtx = (failed: number, successRate: number): GroundingContext => ({
  mode: "url",
  evidence: [
    { ref: "E1", kind: "http", strength: "indirect", tool: "fetch_page", data: { status: 500 } },
    { ref: "E2", kind: "availability", strength: failed >= 2 ? "direct" : "indirect", tool: "measure_availability", data: { attempts: 3, failed, successRate } },
  ],
  toolRuns: [
    { tool: "fetch_page", status: "SUCCEEDED" },
    { tool: "measure_availability", status: "SUCCEEDED" },
  ],
  comparison: null,
});
const urlReport = (over: Report = {}): Report =>
  demoReport({
    verdict: "likely_cause",
    severity: "high",
    whatChanged: "The page answered 500 [E1] in repeated attempts [E2].",
    hypotheses: [
      {
        id: "H1",
        category: "site_availability",
        statement: "The server returns 5xx errors.",
        status: "supported",
        confidence: "high",
        confidenceRationale: "Repeated failures.",
        supportingEvidenceIds: ["E1", "E2"],
        contradictingEvidenceIds: [],
      },
    ],
    limitations: [URL_SCOPE_STATEMENT],
    ...over,
  });

const rules = (r: GroundingResult) => (r.ok ? [] : r.errors.map((e) => e.rule));
const expectAccepted = (r: GroundingResult) => expect(r.ok ? [] : r.errors).toEqual([]);

describe("validateReport — grounding rules (spec §5.5)", () => {
  it("accepts a grounded demo report", () => {
    expectAccepted(validateReport(demoReport(), demoCtx()));
  });

  describe("1. schema, control characters, no HTML", () => {
    it("rejects a schema violation with its path", () => {
      const r = validateReport(demoReport({ summary: "too short" }), demoCtx());
      expect(r.ok ? [] : r.errors).toContainEqual(expect.objectContaining({ path: "summary", rule: "schema" }));
    });
    it("rejects HTML in a string", () => {
      const r = validateReport(demoReport({ severityRationale: "Down <script>alert(1)</script> a lot." }), demoCtx());
      expect(r.ok ? [] : r.errors).toContainEqual(expect.objectContaining({ path: "severityRationale", rule: "no_html" }));
    });
    it("strips control characters and accepts", () => {
      const r = validateReport(demoReport({ severityRationale: "Down\u0007 a lot\u200b." }), demoCtx());
      expectAccepted(r);
      if (r.ok) expect(r.report.severityRationale).toBe("Down a lot.");
    });
  });

  describe("2. cited evidence exists", () => {
    it("rejects an unknown id in a list", () => {
      const r = validateReport(demoReport({ observations: [{ statement: "x", evidenceIds: ["E99"] }] }), demoCtx());
      expect(r.ok ? [] : r.errors).toContainEqual(expect.objectContaining({ path: "observations.0.evidenceIds.0", rule: "evidence_exists" }));
    });
    it("rejects an unknown id cited in text", () => {
      const r = validateReport(demoReport({ whatChanged: "It fell [E98]." }), demoCtx());
      expect(rules(r)).toEqual(["evidence_exists"]);
    });
  });

  describe("2b. evidence ids cited anywhere in the report (A4)", () => {
    it.each([
      ["recommendedActions.0.action", { recommendedActions: [{ action: "Restore the tag [E99].", priority: "now", rationale: "y", hypothesisIds: ["H1"] }] }],
      ["recommendedActions.0.rationale", { recommendedActions: [{ action: "x", priority: "now", rationale: "see [E99]", hypothesisIds: ["H1"] }] }],
      ["unknowns.0.whyItMatters", { unknowns: [{ question: "q", whyItMatters: "see [E99]", howToResolve: "r" }] }],
      ["limitations.0", { limitations: ["Based on [E99] only."] }],
      ["securityNotes.0", { securityNotes: ["Page told us to ignore rules [E99]."] }],
    ])("rejects an unknown id cited in %s", (path, over) => {
      const r = validateReport(demoReport(over), demoCtx());
      expect(r.ok ? [] : r.errors).toContainEqual(expect.objectContaining({ path, rule: "evidence_exists" }));
    });
  });

  describe("3. every observation cites evidence", () => {
    it("rejects an observation without ids", () => {
      const r = validateReport(demoReport({ observations: [{ statement: "x", evidenceIds: [] }] }), demoCtx());
      expect(rules(r)).toEqual(["observation_evidence"]);
    });
  });

  describe("4. high confidence", () => {
    it.each([
      ["one supporting item", { supportingEvidenceIds: ["E2"] }],
      ["no direct item", { supportingEvidenceIds: ["E1", "E3"] }],
      ["a contradicting item", { contradictingEvidenceIds: ["E1"] }],
      ["status not supported", { status: "plausible" }],
    ])("rejects %s", (_label, over) => {
      expect(rules(validateReport(demoReport({ verdict: "likely_cause", hypotheses: hyp(over) }), demoCtx()))).toContain("high_confidence");
    });
    it("rejects the same supporting id listed twice", () => {
      const over = { supportingEvidenceIds: ["E2", "E2"] };
      expect(rules(validateReport(demoReport({ verdict: "likely_cause", hypotheses: hyp(over) }), demoCtx()))).toContain("high_confidence");
    });
    it("accepts medium confidence with a single item", () => {
      expectAccepted(validateReport(demoReport({ verdict: "likely_cause", hypotheses: hyp({ confidence: "medium", supportingEvidenceIds: ["E1"] }) }), demoCtx()));
    });
  });

  describe("5. cause_identified", () => {
    it("rejects it without a supported/high hypothesis", () => {
      expect(rules(validateReport(demoReport({ hypotheses: hyp({ confidence: "medium" }) }), demoCtx()))).toEqual(["cause_identified"]);
    });
    it("rejects it in demo mode without a significant comparison", () => {
      expect(rules(validateReport(demoReport(), demoCtx({ comparison: null })))).toContain("cause_identified");
    });
  });

  describe("6. significance", () => {
    it("rejects no_issue_found and severity none after a significant drop", () => {
      const r = validateReport(demoReport({ verdict: "no_issue_found", severity: "none", hypotheses: hyp({ confidence: "low", status: "weakened" }) }), demoCtx());
      expect(r.ok ? [] : r.errors.filter((e) => e.rule === "significance").map((e) => e.path)).toEqual(["verdict", "severity"]);
    });
    it("A9: a significant RISE of 10% or more may still be no_issue_found with severity none", () => {
      const rise = demoCtx({ comparison: { isSignificant: true, relativeChange: 0.25 } });
      const r = validateReport(demoReport({ verdict: "no_issue_found", severity: "none", hypotheses: hyp({ confidence: "low", status: "weakened" }) }), rise);
      expect(rules(r)).toEqual([]);
    });
    it("allows only inconclusive/no_issue_found without a significant result", () => {
      const ctx = demoCtx({ comparison: { isSignificant: false, relativeChange: -0.55 } });
      const medium = hyp({ confidence: "medium" });
      expect(rules(validateReport(demoReport({ verdict: "likely_cause", hypotheses: medium }), ctx))).toEqual(["significance"]);
      expectAccepted(validateReport(demoReport({ verdict: "inconclusive", severity: "low", hypotheses: medium }), ctx));
    });
  });

  describe("7. a failed tool caps the categories it informs", () => {
    const failed = demoCtx({
      toolRuns: [
        { tool: "compare_periods", status: "SUCCEEDED" },
        { tool: "inspect_tracking_health", status: "FAILED" },
      ],
    });
    it("rejects high confidence in tracking when inspect_tracking_health never succeeded", () => {
      expect(rules(validateReport(demoReport({ verdict: "likely_cause" }), failed))).toEqual(["tool_failure_cap"]);
    });
    it("accepts it once the tool succeeded on a later call", () => {
      const ctx = { ...failed, toolRuns: [...failed.toolRuns, { tool: "inspect_tracking_health", status: "SUCCEEDED" }] };
      expectAccepted(validateReport(demoReport({ verdict: "likely_cause" }), ctx));
    });
  });

  describe("8. URL mode", () => {
    it("accepts a grounded URL report", () => {
      expectAccepted(validateReport(urlReport(), urlCtx(3, 0.67)));
    });
    it("rejects cause_identified, a missing scope statement and demo categories", () => {
      expect(rules(validateReport(urlReport({ verdict: "cause_identified" }), urlCtx(3, 0.67)))).toEqual(["url_scope"]);
      expect(rules(validateReport(urlReport({ limitations: [] }), urlCtx(3, 0.67)))).toEqual(["url_scope"]);
      expect(rules(validateReport(urlReport({ hypotheses: hyp({ category: "tracking" }) }), urlCtx(3, 0.67)))).toEqual(["schema"]);
    });
    it("rejects supported/high site_availability with fewer than 2 failed attempts", () => {
      expect(rules(validateReport(urlReport(), urlCtx(1, 0.67)))).toContain("url_scope");
    });
  });

  describe("9. ids consistent", () => {
    it("rejects duplicate hypothesis ids and actions pointing to unknown hypotheses", () => {
      const dup = demoReport({ hypotheses: [...hyp({}), ...hyp({ confidence: "low" })] });
      expect(rules(validateReport(dup, demoCtx()))).toEqual(["ids_consistent"]);
      const dangling = demoReport({ recommendedActions: [{ action: "x", priority: "now", rationale: "y", hypothesisIds: ["H9"] }] });
      expect(rules(validateReport(dangling, demoCtx()))).toEqual(["ids_consistent"]);
    });
  });

  describe("10. severity", () => {
    it("allows none only with no_issue_found", () => {
      expect(rules(validateReport(demoReport({ severity: "none" }), demoCtx()))).toContain("severity");
    });
    it("demo critical needs a significant drop of at least 30%", () => {
      expect(rules(validateReport(demoReport({ severity: "critical" }), demoCtx({ comparison: { isSignificant: true, relativeChange: -0.2 } })))).toEqual(["severity"]);
      expectAccepted(validateReport(demoReport({ severity: "critical" }), demoCtx({ comparison: { isSignificant: true, relativeChange: -0.4 } })));
    });
    it("URL critical needs availability below 50%", () => {
      expect(rules(validateReport(urlReport({ severity: "critical" }), urlCtx(2, 0.67)))).toEqual(["severity"]);
      expectAccepted(validateReport(urlReport({ severity: "critical" }), urlCtx(3, 0)));
    });
  });

  it("U2: warns when a URL-mode action tells the reader to install a browser or Playwright", () => {
    const action = { action: "Install Chromium on the API server so browser_check can run.", priority: "now", rationale: "Enables the browser check.", hypothesisIds: ["H1"] };
    const r = validateReport(urlReport({ recommendedActions: [action] }), urlCtx(3, 0.67));
    expect(r.ok).toBe(true);
    expect(r.warnings).toContainEqual(expect.stringMatching(/recommendedActions\.0.*browser/i));
  });

  it("warns (does not reject) when data-quality evidence exists and unknowns is empty", () => {
    const r = validateReport(demoReport({ unknowns: [] }), demoCtx());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([expect.stringMatching(/unknowns/)]);
  });
});
