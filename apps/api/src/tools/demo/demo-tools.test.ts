import { scenarioCatalogue, toolInputSchemas, type ScenarioKey, type ToolName } from "@campaign-sentinel/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { generateDemoDataset } from "../../demo-data/generator";
import { InMemoryCampaignDataRepository } from "../../demo-data/campaign-data.repository";
import type { Investigation } from "../../ledger/ledger.service";
import { ToolFailure, type ToolHandler, type ToolOutput } from "../tool.types";
import { createDemoToolHandlers } from "./demo-tools";

const reason = "Testing the tool.";
const DEMO_TOOLS: ToolName[] = [
  "get_campaign_overview",
  "compare_periods",
  "get_daily_trend",
  "breakdown_by_segment",
  "inspect_tracking_health",
  "check_landing_page",
  "get_change_log",
];
const INPUTS: Record<string, unknown[]> = {
  get_campaign_overview: [{}],
  compare_periods: [{}],
  get_daily_trend: [{ metric: "conversion_rate" }, { metric: "sessions" }],
  breakdown_by_segment: [{ dimension: "source" }, { dimension: "device" }],
  inspect_tracking_health: [{}],
  check_landing_page: [{}],
  get_change_log: [{}],
};

let handlers: Map<string, ToolHandler>;
beforeAll(() => {
  const list = createDemoToolHandlers(new InMemoryCampaignDataRepository(generateDemoDataset()));
  handlers = new Map(list.map((h) => [h.name, h]));
});

const campaignOf = (key: ScenarioKey) => scenarioCatalogue.find((s) => s.key === key)!.campaignId;
const investigation = (campaignId: string) =>
  ({
    id: "inv-test",
    mode: "DEMO",
    campaignId,
    baselineStart: new Date("2026-09-19T00:00:00Z"),
    baselineEnd: new Date("2026-10-02T00:00:00Z"),
    currentStart: new Date("2026-10-03T00:00:00Z"),
    currentEnd: new Date("2026-10-16T00:00:00Z"),
  }) as Investigation;

async function run(key: ScenarioKey, tool: ToolName, input: unknown = INPUTS[tool]![0]): Promise<ToolOutput> {
  const handler = handlers.get(tool);
  if (!handler) throw new Error(`no handler for ${tool}`);
  const parsed = toolInputSchemas[tool].parse({ reason, ...(input as object) });
  return handler.run(parsed as never, { investigation: investigation(campaignOf(key)), signal: new AbortController().signal });
}

describe("demo tools", () => {
  it("registers the seven demo tools", () => {
    expect([...handlers.keys()].sort()).toEqual([...DEMO_TOOLS].sort());
  });

  it("compare_periods reports the tracked CR drop with a significant z-test and numbers in the statement", async () => {
    const out = await run("tracking-break", "compare_periods");
    expect(out.data).toMatchObject({ isSignificant: true });
    const statement = out.evidence![0]!.statement;
    expect(statement).toMatch(/4\.\d\d%/);
    expect(statement).toMatch(/1\.\d\d%/);
    expect(statement).toMatch(/p < 0\.001/);
  });

  it("inspect_tracking_health marks pixel/backend divergence as direct evidence", async () => {
    const out = await run("tracking-break", "inspect_tracking_health");
    const direct = out.evidence!.filter((e) => e.strength === "direct");
    expect(direct).toHaveLength(1);
    expect(direct[0]!.kind).toBe("tracking");
    expect(direct[0]!.statement).toMatch(/\d+% of backend-confirmed conversions/);
  });

  it("inspect_tracking_health finds no divergence where tracking is healthy", async () => {
    const out = await run("traffic-source-decline", "inspect_tracking_health");
    expect(out.evidence!.some((e) => e.strength === "direct")).toBe(false);
  });

  it("breakdown_by_segment names the source that explains most of the change as direct evidence", async () => {
    const out = await run("traffic-source-decline", "breakdown_by_segment", { dimension: "source" });
    const direct = out.evidence!.filter((e) => e.strength === "direct");
    expect(direct).toHaveLength(1);
    expect(direct[0]!.statement).toMatch(/^native_network_a explains \d+% /);
  });

  it("breakdown_by_segment does not single out a segment when the drop is proportional to traffic", async () => {
    const out = await run("tracking-break", "breakdown_by_segment", { dimension: "source" });
    expect(out.evidence!.some((e) => e.strength === "direct")).toBe(false);
  });

  it("check_landing_page flags the mobile 5xx rate as direct evidence and the hidden injection", async () => {
    const out = await run("landing-page-mobile", "check_landing_page");
    const direct = out.evidence!.filter((e) => e.strength === "direct");
    expect(direct).toHaveLength(1);
    expect(direct[0]!.statement).toMatch(/^mobile: 5xx rate 0\.0% → 2\d\.\d%/);
    expect(out.untrustedContent?.injectionSignals.length).toBeGreaterThan(0);
    expect(out.untrustedContent?.text).not.toMatch(/<div/);
  });

  it("get_change_log returns entries as context evidence and their text only as untrusted content", async () => {
    const out = await run("tracking-break", "get_change_log");
    expect(out.evidence!.length).toBeGreaterThan(0);
    expect(out.evidence!.every((e) => e.strength === "context" && e.kind === "change_log")).toBe(true);
    expect(out.untrustedContent?.text).toMatch(/Thank-you page template v2/);
    expect(JSON.stringify(out.data)).not.toMatch(/Thank-you page template v2/);
  });

  it("filters the change log by change-log category", async () => {
    const out = await run("tracking-break", "get_change_log", { category: "deploy" });
    expect(out.evidence).toHaveLength(1);
  });

  it("get_daily_trend finds the change point within a day of the planted date", async () => {
    const out = await run("tracking-break", "get_daily_trend");
    const date = (out.data as { changePoint: { date: string } | null }).changePoint?.date;
    expect(["2026-10-03", "2026-10-04", "2026-10-05"]).toContain(date);
  });

  it("reports low sample size and missing dates as data-quality warnings and evidence", async () => {
    const out = await run("insufficient-data", "compare_periods");
    expect(out.data).toMatchObject({ isSignificant: false });
    expect(out.warnings!.join(" ")).toMatch(/low sample/i);
    expect(out.warnings!.join(" ")).toMatch(/2026-10-10/);
    expect(out.evidence!.some((e) => e.kind === "data_quality")).toBe(true);
  });

  it("fails the tracking tool with UPSTREAM_UNAVAILABLE when a demo fault is injected", async () => {
    await expect(run("tool-failure", "inspect_tracking_health")).rejects.toMatchObject({
      constructor: ToolFailure,
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("never leaks the scenario key or ground truth in any output of any tool for any campaign", async () => {
    const forbidden = [
      ...scenarioCatalogue.flatMap((s) => [s.key, s.title, s.description]),
      "scenario",
      "expectedCategory",
      "ground truth",
    ];
    let succeeded = 0;
    for (const s of scenarioCatalogue) {
      for (const tool of DEMO_TOOLS) {
        for (const input of INPUTS[tool]!) {
          let text: string;
          try {
            text = JSON.stringify(await run(s.key, tool, input));
            succeeded++;
          } catch (e) {
            text = JSON.stringify({ message: (e as Error).message });
          }
          for (const f of forbidden) expect(text.toLowerCase(), `${s.key}/${tool}`).not.toContain(f.toLowerCase());
        }
      }
    }
    // 5 campaigns × 9 calls, minus the injected tracking fault
    expect(succeeded).toBe(5 * 9 - 1);
  });
});
