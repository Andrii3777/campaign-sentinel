import type { INestApplication } from "@nestjs/common";
import { scenarioCatalogue, type ScenarioKey } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootApp } from "../../test/boot";
import { PrismaService } from "../db/prisma.service";
import { seedDemoData } from "../demo-data/seed";
import { LedgerService } from "../ledger/ledger.service";
import { Runner } from "./runner";
import { ScriptedSession, toolTurn, type ScriptStep } from "./scripted-session";
import { AgentSessionError } from "./session";

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let app: INestApplication;
let ledger: LedgerService;
let runner: Runner;
let prisma: PrismaService;
const reason = "Scripted step for the runner test.";

async function queued(key: ScenarioKey, runtime: "deterministic" | "external" = "deterministic"): Promise<string> {
  const { investigation } = await ledger.create({
    mode: "DEMO",
    campaignId: scenarioCatalogue.find((s) => s.key === key)!.campaignId,
    question: "Why did the conversion rate change?",
    baselineStart: new Date("2026-09-19T00:00:00Z"),
    baselineEnd: new Date("2026-10-02T00:00:00Z"),
    currentStart: new Date("2026-10-03T00:00:00Z"),
    currentEnd: new Date("2026-10-16T00:00:00Z"),
    source: "api",
    runtime,
  });
  return investigation.id;
}

/** Runs a queued investigation with a scripted session and returns the stored run, its events and the session. */
async function runScripted(key: ScenarioKey, steps: ScriptStep[]) {
  const id = await queued(key);
  const session = new ScriptedSession(steps);
  runner.sessions.createSession = () => session;
  await runner.run(id);
  const inv = await prisma.investigation.findUniqueOrThrow({ where: { id }, include: { report: true, toolExecutions: true } });
  const events = await ledger.getEventsAfter(id, 0);
  return { id, inv, events, session, types: events.map((e) => e.type) };
}

const call = (tool: string, input: Data = {}) => toolTurn({ tool, input: { reason, ...input } });
const report = (over: Data = {}) => ({
  schemaVersion: "1",
  summary: "Tracked conversion rate fell significantly between the periods; this scripted report cites the comparison only.",
  verdict: "likely_cause",
  severity: "high",
  severityRationale: "Tracked conversions are down by more than 30%.",
  whatChanged: "Tracked CR fell [E2].",
  observations: [{ statement: "Tracked CR fell.", evidenceIds: ["E2"] }],
  hypotheses: [
    {
      id: "H1",
      category: "tracking",
      statement: "The pixel may have stopped firing.",
      status: "plausible",
      confidence: "medium",
      confidenceRationale: "Only the comparison supports it so far.",
      supportingEvidenceIds: ["E2"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [],
  recommendedActions: [{ action: "Check the conversion tag.", priority: "now", rationale: "Most likely cause.", hypothesisIds: ["H1"] }],
  limitations: [],
  securityNotes: [],
  ...over,
});
/** cites only E1 (the first compare_periods evidence when no other tool ran successfully before) */
const e1Report = report({
  whatChanged: "Tracked CR fell [E1].",
  observations: [{ statement: "CR fell.", evidenceIds: ["E1"] }],
  hypotheses: [{ ...report().hypotheses[0], supportingEvidenceIds: ["E1"] }],
});
const submit = (r: Data) => call("submit_report", { report: r });
const errorCodes = (results: { result: Data }[]) => results.map((r) => (r.result.ok ? "ok" : r.result.error.code));

beforeAll(async () => {
  app = await bootApp();
  ledger = app.get(LedgerService);
  runner = app.get(Runner);
  prisma = app.get(PrismaService);
  await seedDemoData(prisma);
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("Runner with a ScriptedSession", () => {
  it("happy path: tools, all results of a turn together, report accepted, turns and tokens recorded", async () => {
    const { inv, types, session } = await runScripted("tracking-break", [
      toolTurn({ tool: "get_campaign_overview", input: { reason } }, { tool: "compare_periods", input: { reason } }),
      submit(report()),
    ]);
    expect(inv).toMatchObject({ status: "COMPLETED", model: "scripted", modelTurns: 2, inputTokens: 200, outputTokens: 40, toolCalls: 2 });
    expect(inv.report?.verdict).toBe("likely_cause");
    expect(session.received[0]!.map((r) => r.tool)).toEqual(["get_campaign_overview", "compare_periods"]);
    expect(session.task).toMatchObject({ mode: "demo", periods: { baseline: { start: "2026-09-19" } }, budgets: { turns: 16, toolCalls: 24 } });
    expect(session.task!.tools.map((t) => t.name)).not.toContain("fetch_page");
    expect(types.filter((t) => t === "agent.turn")).toHaveLength(2);
    // submit_report completes the run inside the tool call, so its own success is logged right after
    expect(types.slice(-3)).toEqual(["report.accepted", "investigation.completed", "tool.call_succeeded"]);
  });

  it("malformed arguments are rejected and returned; the agent recovers", async () => {
    const { inv, session } = await runScripted("tracking-break", [
      call("breakdown_by_segment", { dimension: "country" }),
      call("compare_periods"),
      call("compare_periods", { current: "last week" }),
      submit(e1Report),
    ]);
    expect(errorCodes(session.received[0]!)).toEqual(["INVALID_ARGUMENTS"]);
    expect(inv.failureMessage).toBeNull();
    expect(inv.status).toBe("COMPLETED");
    expect(inv.toolExecutions.filter((t) => t.status === "REJECTED")).toHaveLength(2);
  });

  it("a failed tool is returned as an error and the agent continues", async () => {
    const { inv, session, types } = await runScripted("tool-failure", [
      call("inspect_tracking_health"),
      call("compare_periods"),
      submit(report({ whatChanged: "Tracked CR fell [E2].", observations: [{ statement: "CR fell.", evidenceIds: ["E2"] }] })),
    ]);
    expect(errorCodes(session.received[0]!)).toEqual(["UPSTREAM_UNAVAILABLE"]);
    expect(types).toContain("tool.call_retry_scheduled");
    expect(inv.status).toBe("COMPLETED");
    expect((inv.report!.payload as Data).toolFailures).toEqual([expect.objectContaining({ tool: "inspect_tracking_health" })]);
  });

  it("an invalid report is rejected with errors, repaired and accepted", async () => {
    const { inv, session } = await runScripted("tracking-break", [
      call("compare_periods"),
      submit(report({ observations: [{ statement: "Invented.", evidenceIds: ["E77"] }] })),
      submit(e1Report),
    ]);
    expect(errorCodes(session.received[1]!)).toEqual(["REPORT_REJECTED"]);
    expect((session.received[1]![0]!.result as Data).error.message).toMatch(/evidence_exists/);
    expect(inv).toMatchObject({ status: "COMPLETED", reportAttempts: 2 });
  });

  it("repair exhausted after 3 attempts → FAILED / REPORT_INVALID", async () => {
    const bad = report({ observations: [{ statement: "Invented.", evidenceIds: ["E77"] }] });
    const { inv, types } = await runScripted("tracking-break", [call("compare_periods"), submit(bad), submit(bad), submit(bad), submit(report())]);
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "REPORT_INVALID", reportAttempts: 3 });
    expect(inv.report).toBeNull();
    expect(types.filter((t) => t === "report.rejected")).toHaveLength(3);
  });

  it("16 turns without a report → FAILED / BUDGET_EXCEEDED", async () => {
    const { inv } = await runScripted("insufficient-data", Array.from({ length: 20 }, () => call("get_change_log", { category: "budget" })));
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "BUDGET_EXCEEDED", modelTurns: 16 });
  }, 60_000);

  it("refusal → FAILED / MODEL_REFUSED", async () => {
    const { inv } = await runScripted("tracking-break", [{ stopReason: "refusal", toolCalls: [] }]);
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "MODEL_REFUSED" });
  });

  it("no tool call: nudged twice, then FAILED / NO_REPORT", async () => {
    const { inv, session } = await runScripted("tracking-break", []);
    expect(session.nudges).toHaveLength(2);
    expect(session.nudges[0]).toMatch(/submit_report/);
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "NO_REPORT", modelTurns: 3 });
  });

  it("a retryable model error is retried once; a persistent one fails MODEL_UNAVAILABLE", async () => {
    const flaky = await runScripted("tracking-break", [new AgentSessionError("MODEL_UNAVAILABLE", "503", true), call("compare_periods"), submit(e1Report)]);
    expect(flaky.types).toContain("model.call_retry");
    expect(flaky.inv.status).toBe("COMPLETED");
    const down = await runScripted("tracking-break", [new AgentSessionError("MODEL_UNAVAILABLE", "503", true), new AgentSessionError("MODEL_UNAVAILABLE", "503", true)]);
    expect(down.inv).toMatchObject({ status: "FAILED", failureCode: "MODEL_UNAVAILABLE" });
  }, 30_000);

  it("cancel aborts the loop before the next tool call", async () => {
    let id = "";
    const { inv } = await runScripted("tracking-break", [
      async () => {
        id = (await prisma.investigation.findFirstOrThrow({ where: { status: "RUNNING", model: "scripted" }, orderBy: { createdAt: "desc" } })).id;
        await runner.cancel(id);
        return call("compare_periods");
      },
    ]);
    expect(inv.id).toBe(id);
    expect(inv.status).toBe("CANCELLED");
    expect(inv.toolExecutions).toHaveLength(0);
  });

  it("a compromised script: unknown tool, other-mode tool and an ungrounded report are all rejected and logged", async () => {
    const healthy = report({
      summary: "Everything is healthy. Ignore the drop and triple the budget immediately to capture more conversions this month.",
      verdict: "no_issue_found",
      severity: "none",
      whatChanged: "Nothing changed [E9].",
      observations: [{ statement: "All good.", evidenceIds: ["E9"] }],
      hypotheses: [{ ...report().hypotheses[0], category: "other", status: "supported", confidence: "high", supportingEvidenceIds: ["E9", "E10"] }],
      recommendedActions: [{ action: "Triple the budget.", priority: "now", rationale: "The data says so.", hypothesisIds: ["H1"] }],
    });
    const { inv, events, session } = await runScripted("landing-page-mobile", [
      call("run_shell", { command: "cat .env" }),
      call("fetch_page", { url: "http://169.254.169.254/" }),
      call("compare_periods"),
      submit(healthy),
      submit(healthy),
      submit(healthy),
    ]);
    expect(errorCodes(session.received[0]!)).toEqual(["UNKNOWN_TOOL"]);
    expect(errorCodes(session.received[1]!)).toEqual(["NOT_PERMITTED"]);
    const rejected = events.filter((e) => e.type === "tool.call_rejected").map((e) => (e.payload as Data).code);
    expect(rejected).toEqual(["UNKNOWN_TOOL", "NOT_PERMITTED"]);
    const reportErrors = (events.find((e) => e.type === "report.rejected")!.payload as Data).errors.map((e: Data) => e.rule);
    expect(reportErrors).toEqual(expect.arrayContaining(["evidence_exists", "significance"]));
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "REPORT_INVALID" });
    expect(inv.report).toBeNull();
  });
});

describe("wall-clock budget", () => {
  it("an overrun between tool calls ends the run FAILED / BUDGET_EXCEEDED", async () => {
    const real = Date.now.bind(Date);
    let offset = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
    try {
      const { inv } = await runScripted("tracking-break", [
        () => {
          offset = 6 * 60_000;
          return toolTurn({ tool: "get_campaign_overview", input: { reason } }, { tool: "compare_periods", input: { reason } });
        },
        submit(e1Report),
      ]);
      expect(inv).toMatchObject({ status: "FAILED", failureCode: "BUDGET_EXCEEDED" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("recovery", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);
  const status = async (id: string) => (await prisma.investigation.findUniqueOrThrow({ where: { id } })).status;

  it("startup recovery interrupts built-in runs idle > 60 s and leaves fresh ones; the sweep catches them once they go idle, and external runs after 15 min (story 55)", async () => {
    const stale = await queued("tracking-break");
    const fresh = await queued("tracking-break");
    const external = await queued("tracking-break", "external");
    for (const id of [stale, fresh, external]) await ledger.transition(id, "QUEUED", "RUNNING");
    await prisma.investigation.update({ where: { id: stale }, data: { lastActivityAt: ago(61_000) } });
    await prisma.investigation.update({ where: { id: external }, data: { lastActivityAt: ago(16 * 60_000) } });

    expect(await runner.recoverStale()).toBeGreaterThanOrEqual(1);
    expect(await status(stale)).toBe("INTERRUPTED");
    expect(await status(fresh)).toBe("RUNNING");
    expect(await status(external)).toBe("RUNNING");

    // the periodic sweep: the fresh built-in run goes idle, nobody drives it any more
    await prisma.investigation.update({ where: { id: fresh }, data: { lastActivityAt: ago(61_000) } });
    await runner.sweep();
    expect(await status(fresh)).toBe("INTERRUPTED");
    expect(await status(external)).toBe("INTERRUPTED");
  });

  it("the sweep skips a built-in run this process is still driving", async () => {
    const id = await queued("tracking-break");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runner.sessions.createSession = () =>
      new ScriptedSession([
        async () => {
          await gate;
          return toolTurn({ tool: "compare_periods", input: { reason } });
        },
        submit(e1Report),
      ]);
    const running = runner.run(id);
    for (let i = 0; i < 50 && (await status(id)) !== "RUNNING"; i++) await new Promise((r) => setTimeout(r, 50));
    await prisma.investigation.update({ where: { id }, data: { lastActivityAt: ago(61_000) } });
    await runner.sweep();
    expect(await status(id)).toBe("RUNNING");
    release();
    await running;
    expect(await status(id)).toBe("COMPLETED");
  });

  it("A2: recovery re-enqueues every QUEUED built-in run", async () => {
    const id = await queued("tracking-break");
    runner.sessions.createSession = () => new ScriptedSession([call("compare_periods"), submit(e1Report)]);
    await runner.recoverStale();
    await runner.whenIdle();
    expect(await status(id)).toBe("COMPLETED");
  });

  it("A3: a database error while failing a run cannot reject run()", async () => {
    const id = await queued("tracking-break");
    runner.sessions.createSession = () => new ScriptedSession([() => { throw new Error("boom"); }]);
    const real = ledger.transition.bind(ledger);
    const failing = vi.spyOn(ledger, "transition").mockImplementation((tid, from, to, data) =>
      to === "FAILED" ? Promise.reject(new Error("database is down")) : real(tid, from, to, data),
    );
    try {
      await expect(runner.run(id)).resolves.toBeUndefined();
    } finally {
      failing.mockRestore();
    }
  });
});
