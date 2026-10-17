import type { INestApplication } from "@nestjs/common";
import { scenarioCatalogue, type ScenarioKey } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "../../test/boot";
import { PrismaService } from "../db/prisma.service";
import { seedDemoData } from "../demo-data/seed";
import { LedgerService } from "../ledger/ledger.service";
import { ToolExecutor } from "../tools/tool-executor";
import { ReportService } from "./report.service";

let app: INestApplication;
let ledger: LedgerService;
let executor: ToolExecutor;
let reports: ReportService;
let prisma: PrismaService;
const reason = "Collect evidence for the report test.";

async function running(key: ScenarioKey): Promise<string> {
  const { investigation } = await ledger.create({
    mode: "DEMO",
    campaignId: scenarioCatalogue.find((s) => s.key === key)!.campaignId,
    question: "Why did the conversion rate change?",
    source: "api",
    runtime: "deterministic",
    model: "scripted",
  });
  await ledger.transition(investigation.id, "QUEUED", "RUNNING");
  return investigation.id;
}

const report = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  summary: "Tracked conversion rate changed between the periods; this test report cites the comparison evidence only.",
  verdict: "likely_cause",
  severity: "high",
  severityRationale: "Tracked conversions are down by more than 30%.",
  whatChanged: "Tracked CR fell [E1].",
  observations: [{ statement: "Tracked CR fell.", evidenceIds: ["E1"] }],
  hypotheses: [
    {
      id: "H1",
      category: "conversion_flow",
      statement: "Something in the conversion flow changed.",
      status: "plausible",
      confidence: "medium",
      confidenceRationale: "Only the comparison supports it.",
      supportingEvidenceIds: ["E1"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [{ question: "Is tracking healthy?", whyItMatters: "Rules out a pixel issue.", howToResolve: "Rerun the tracking check." }],
  recommendedActions: [{ action: "Verify checkout events.", priority: "now", rationale: "Most likely cause.", hypothesisIds: ["H1"] }],
  limitations: [],
  securityNotes: [],
  ...over,
});

beforeAll(async () => {
  app = await bootApp();
  ledger = app.get(LedgerService);
  executor = app.get(ToolExecutor);
  reports = app.get(ReportService);
  prisma = app.get(PrismaService);
  await seedDemoData(prisma);
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("ReportService.submit", () => {
  it("stores an accepted report with server attachments and completes the run", async () => {
    const id = await running("tool-failure");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    await executor.execute(id, { tool: "inspect_tracking_health", input: { reason } });
    const result = await reports.submit(id, report());
    expect(result.accepted).toBe(true);

    const stored = await prisma.report.findUniqueOrThrow({ where: { investigationId: id } });
    const payload = stored.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(stored).toMatchObject({ verdict: "likely_cause", severity: "high", schemaVersion: "1" });
    expect(payload.keyMetrics).toMatchObject({ isSignificant: true, baseline: { conversionRate: expect.any(Number) } });
    expect(payload).toMatchObject({ provenance: "synthetic-demo", runtime: "deterministic", model: "scripted", validationWarnings: [] });
    expect(payload.evidenceIndex.E1).toMatch(/Tracked CR changed/);
    // D03: the failed tool is a data_quality evidence item and a toolFailures entry
    expect(payload.toolFailures).toEqual([{ tool: "inspect_tracking_health", code: "UPSTREAM_UNAVAILABLE", message: expect.any(String) }]);
    const dq = await prisma.evidence.findMany({ where: { investigationId: id, kind: "data_quality" } });
    expect(dq.map((e) => e.statement)).toContain("inspect_tracking_health unavailable: UPSTREAM_UNAVAILABLE");

    const inv = await prisma.investigation.findUniqueOrThrow({ where: { id } });
    expect(inv).toMatchObject({ status: "COMPLETED", reportAttempts: 1 });
    const types = (await ledger.getEventsAfter(id, 0)).map((e) => e.type);
    expect(types.slice(-3)).toEqual(["report.submitted", "report.accepted", "investigation.completed"]);
  }, 30_000);

  it("rejects with {path, rule, message}, keeps the payload only in report.rejected, fails after 3 attempts", async () => {
    const id = await running("tracking-break");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    const bad = report({ observations: [{ statement: "Made up.", evidenceIds: ["E42"] }] });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await reports.submit(id, bad);
      expect(r).toEqual({ accepted: false, errors: [expect.objectContaining({ path: "observations.0.evidenceIds.0", rule: "evidence_exists" })] });
    }
    expect(await prisma.report.findUnique({ where: { investigationId: id } })).toBeNull();
    const inv = await prisma.investigation.findUniqueOrThrow({ where: { id } });
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "REPORT_INVALID", reportAttempts: 3 });
    const events = await ledger.getEventsAfter(id, 0);
    expect(events.filter((e) => e.type === "report.rejected").map((e) => (e.payload as { attempt: number }).attempt)).toEqual([1, 2, 3]);
    expect((await reports.submit(id, report())).accepted).toBe(false);
  });

  it("significance and keyMetrics come only from a comparison over the run's own periods", async () => {
    const id = await running("tracking-break");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    const flat = { baseline: { start: "2026-09-19", end: "2026-09-25" }, current: { start: "2026-09-26", end: "2026-10-02" } };
    const second = await executor.execute(id, { tool: "compare_periods", input: { reason, ...flat } });
    expect(second.ok && second.evidence.length).toBeGreaterThan(0);
    const healthy = report({
      verdict: "no_issue_found",
      severity: "none",
      whatChanged: "Nothing changed [E2].",
      observations: [{ statement: "Flat window.", evidenceIds: ["E2"] }],
      hypotheses: [{ ...report().hypotheses[0], category: "other", status: "weakened", confidence: "low", supportingEvidenceIds: ["E2"] }],
    });
    const r = await reports.submit(id, healthy);
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.errors.map((e) => e.rule)).toContain("significance");
  }, 30_000);

  it("keyMetrics are taken from the own-period comparison even when a later one exists", async () => {
    const id = await running("tracking-break");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    await executor.execute(id, {
      tool: "compare_periods",
      input: { reason, baseline: { start: "2026-09-19", end: "2026-09-25" }, current: { start: "2026-09-26", end: "2026-10-02" } },
    });
    const r = await reports.submit(id, report());
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.report.keyMetrics).toMatchObject({ isSignificant: true, current: { period: { start: "2026-10-03" } } });
  }, 30_000);
  it("A1: a run cancelled during submit keeps no report and answers with a state error", async () => {
    const id = await running("tracking-break");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    // cancel lands after the status check, before the report is stored
    const original = (reports as any).context.bind(reports); // eslint-disable-line @typescript-eslint/no-explicit-any
    (reports as any).context = async (...args: unknown[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await ledger.transition(id, "RUNNING", "CANCELLED", { failureMessage: "Cancelled by the user." });
      return original(...args);
    };
    let result;
    try {
      result = await reports.submit(id, report());
    } finally {
      delete (reports as any).context; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    expect(result).toEqual({ accepted: false, errors: [expect.objectContaining({ rule: "state" })] });
    expect(await prisma.report.findUnique({ where: { investigationId: id } })).toBeNull();
    expect((await ledger.getEventsAfter(id, 0)).map((e) => e.type)).not.toContain("report.accepted");
  }, 30_000);

  it("A1: a double submit gives one accepted report and one clean rejection", async () => {
    const id = await running("tracking-break");
    await executor.execute(id, { tool: "compare_periods", input: { reason } });
    const results = await Promise.all([reports.submit(id, report()), reports.submit(id, report())]);
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    const rejected = results.find((r) => !r.accepted);
    expect(rejected).toEqual({ accepted: false, errors: [expect.objectContaining({ rule: "state" })] });
    expect(await prisma.report.count({ where: { investigationId: id } })).toBe(1);
    const accepted = (await ledger.getEventsAfter(id, 0)).filter((e) => e.type === "report.accepted");
    expect(accepted).toHaveLength(1);
  }, 30_000);
});
