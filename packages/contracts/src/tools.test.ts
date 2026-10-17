import { describe, expect, it } from "vitest";
import { ToolNameSchema, toolInputJsonSchema, toolSpecs, toolsForMode } from "./index";

const reason = "Check whether the drop is real.";

// [tool, valid input, invalid input] — hand-written from spec §5.3
const cases: [string, unknown, unknown][] = [
  ["get_campaign_overview", { reason }, {}],
  [
    "compare_periods",
    { reason, baseline: { start: "2026-09-19", end: "2026-10-02" } },
    { reason, baseline: { start: "2026-10-02", end: "2026-09-19" } },
  ],
  ["get_daily_trend", { reason, metric: "conversion_rate", from: "2026-09-05" }, { reason, metric: "revenue" }],
  ["breakdown_by_segment", { reason, dimension: "device" }, { reason, dimension: "country" }],
  ["inspect_tracking_health", { reason }, { reason: "no" }],
  ["check_landing_page", { reason }, { reason, url: "https://example.com" }],
  ["get_change_log", { reason, category: "tracking" }, { reason, from: "05/09/2026" }],
  ["fetch_page", { reason, url: "https://example.com/a" }, { reason, url: "not a url" }],
  ["measure_availability", { reason }, { reason, attempts: 6 }],
  ["check_links", { reason, limit: 5, scope: "cta" }, { reason, limit: 11 }],
  ["browser_check", { reason }, { reason: "x".repeat(301) }],
  ["submit_report", { reason, report: { schemaVersion: "1" } }, { reason }],
];

describe("tool specs", () => {
  it("covers every tool name exactly once", () => {
    expect(toolSpecs.map((s) => s.name).sort()).toEqual([...ToolNameSchema.options].sort());
    expect(cases.map((c) => c[0]).sort()).toEqual([...ToolNameSchema.options].sort());
  });

  it.each(cases)("%s accepts a valid input and rejects an invalid one", (name, valid, invalid) => {
    const spec = toolSpecs.find((s) => s.name === name)!;
    expect(spec.inputSchema.safeParse(valid).success).toBe(true);
    expect(spec.inputSchema.safeParse(invalid).success).toBe(false);
  });

  it("applies documented defaults", () => {
    const spec = toolSpecs.find((s) => s.name === "measure_availability")!;
    expect(spec.inputSchema.parse({ reason })).toEqual({ reason, attempts: 3 });
  });

  it("splits tools by mode and marks only submit_report as writing", () => {
    expect(toolsForMode("demo").map((s) => s.name)).toEqual([
      "get_campaign_overview",
      "compare_periods",
      "get_daily_trend",
      "breakdown_by_segment",
      "inspect_tracking_health",
      "check_landing_page",
      "get_change_log",
      "submit_report",
    ]);
    expect(toolsForMode("url").map((s) => s.name)).toEqual([
      "fetch_page",
      "measure_availability",
      "check_links",
      "browser_check",
      "submit_report",
    ]);
    expect(toolSpecs.filter((s) => !s.readOnly).map((s) => s.name)).toEqual(["submit_report"]);
  });

  it("exports a strict JSON Schema with a required reason", () => {
    const schema = toolInputJsonSchema("breakdown_by_segment") as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["reason", "dimension"]));
  });
});
