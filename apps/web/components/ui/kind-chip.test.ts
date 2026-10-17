import { ToolNameSchema } from "@campaign-sentinel/contracts";
import { describe, expect, it } from "vitest";
import { stratumOfTool } from "./kind-chip";

// Expected strata come from ui-pack.md: ochre metrics/comparison/trend/segment, umber tracking, slate-blue landing/HTTP/links/browser, sage change log, sand report.
const expected = {
  get_campaign_overview: "metrics",
  compare_periods: "metrics",
  get_daily_trend: "metrics",
  breakdown_by_segment: "metrics",
  inspect_tracking_health: "tracking",
  check_landing_page: "http",
  get_change_log: "context",
  fetch_page: "http",
  measure_availability: "http",
  check_links: "http",
  browser_check: "http",
  submit_report: "report",
} as const;

describe("stratumOfTool", () => {
  it("maps every contract tool to its stratum", () => {
    for (const name of ToolNameSchema.options) expect(stratumOfTool(name), name).toBe(expected[name]);
  });

  it("gives an unknown tool name the metrics stratum instead of throwing", () => {
    expect(stratumOfTool("tool_from_the_future")).toBe("metrics");
  });
});
