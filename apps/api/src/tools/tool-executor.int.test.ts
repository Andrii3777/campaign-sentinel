import type { INestApplication } from "@nestjs/common";
import { scenarioCatalogue, type ScenarioKey } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "../../test/boot";
import { PrismaService } from "../db/prisma.service";
import { seedDemoData } from "../demo-data/seed";
import { LedgerService } from "../ledger/ledger.service";
import { TOOL_CALL_BUDGET, ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";

let app: INestApplication;
let ledger: LedgerService;
let executor: ToolExecutor;
let prisma: PrismaService;
let slowToolSignal: AbortSignal | undefined;

const reason = "Check the data for this test.";
const campaignOf = (key: ScenarioKey) => scenarioCatalogue.find((s) => s.key === key)!.campaignId;

async function demoRun(key: ScenarioKey, start = true): Promise<string> {
  const { investigation } = await ledger.create({
    mode: "DEMO",
    campaignId: campaignOf(key),
    question: "Why did the conversion rate change?",
    baselineStart: new Date("2026-09-19T00:00:00Z"),
    baselineEnd: new Date("2026-10-02T00:00:00Z"),
    currentStart: new Date("2026-10-03T00:00:00Z"),
    currentEnd: new Date("2026-10-16T00:00:00Z"),
    source: "api",
    runtime: "deterministic",
  });
  if (start) await ledger.transition(investigation.id, "QUEUED", "RUNNING");
  return investigation.id;
}

const eventTypes = async (id: string) => (await ledger.getEventsAfter(id, 0)).map((e) => e.type);
const executions = (id: string) => prisma.toolExecution.findMany({ where: { investigationId: id } });

beforeAll(async () => {
  app = await bootApp();
  ledger = app.get(LedgerService);
  executor = app.get(ToolExecutor);
  prisma = app.get(PrismaService);
  await seedDemoData(prisma);
  // a URL-mode tool that never answers: exercises timeout + retry without network (replaces the real handler in this app)
  Object.assign(app.get(ToolRegistry).get("browser_check")!, {
    timeoutMs: 50,
    run: (_input: unknown, ctx: { signal: AbortSignal }) => {
      slowToolSignal = ctx.signal;
      return new Promise(() => {});
    },
  });
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("ToolExecutor.execute", () => {
  it("runs a demo tool, stores evidence with refs and records the call", async () => {
    const id = await demoRun("tracking-break");
    const result = await executor.execute(id, { tool: "compare_periods", input: { reason }, callerRef: "c1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence[0]).toMatchObject({ ref: "E1", strength: "indirect" });
    expect(result.evidence[0]!.statement).toMatch(/4\.\d\d%.*1\.\d\d%/);
    const [te] = await executions(id);
    expect(te).toMatchObject({ status: "SUCCEEDED", tool: "compare_periods", attempt: 1, reason });
    expect(await eventTypes(id)).toEqual([
      "investigation.created",
      "investigation.started",
      "tool.call_requested",
      "tool.call_started",
      "evidence.recorded",
      "tool.call_succeeded",
    ]);
    const stored = await prisma.evidence.findFirstOrThrow({ where: { investigationId: id, ref: "E1" } });
    expect(stored).toMatchObject({ kind: "comparison", provenance: "synthetic-demo" });
  });

  it("rejects an unknown tool with UNKNOWN_TOOL", async () => {
    const id = await demoRun("tracking-break");
    const result = await executor.execute(id, { tool: "run_shell", input: { reason } });
    expect(result).toMatchObject({ ok: false, error: { code: "UNKNOWN_TOOL", retryable: false } });
    expect((await executions(id))[0]).toMatchObject({ status: "REJECTED", errorCode: "UNKNOWN_TOOL" });
    expect(await eventTypes(id)).toContain("tool.call_rejected");
  });

  it("rejects invalid arguments with INVALID_ARGUMENTS and the zod issues", async () => {
    const id = await demoRun("tracking-break");
    const result = await executor.execute(id, { tool: "breakdown_by_segment", input: { reason, dimension: "country" } });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    if (!result.ok) expect(result.error.message).toMatch(/dimension/);
    const rejected = (await ledger.getEventsAfter(id, 0)).find((e) => e.type === "tool.call_rejected")!;
    expect(rejected.payload).toMatchObject({ code: "INVALID_ARGUMENTS", issues: [expect.objectContaining({ path: ["dimension"] })] });
  });

  it("rejects a tool of the other mode with NOT_PERMITTED", async () => {
    const id = await demoRun("tracking-break");
    const result = await executor.execute(id, { tool: "fetch_page", input: { reason, url: "https://example.com/" } });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect((await executions(id))[0]).toMatchObject({ status: "REJECTED", errorCode: "NOT_PERMITTED" });
  });

  it("rejects calls when the investigation is not RUNNING", async () => {
    const id = await demoRun("tracking-break", false);
    const result = await executor.execute(id, { tool: "get_campaign_overview", input: { reason } });
    expect(result).toMatchObject({ ok: false, error: { code: "INVESTIGATION_NOT_RUNNING" } });
    expect((await executions(id))[0]).toMatchObject({ status: "REJECTED", errorCode: "INVESTIGATION_NOT_RUNNING" });
  });

  it(`rejects call ${TOOL_CALL_BUDGET + 1} with BUDGET_EXCEEDED`, async () => {
    const id = await demoRun("insufficient-data");
    for (let i = 0; i < TOOL_CALL_BUDGET; i++) {
      const r = await executor.execute(id, { tool: "get_change_log", input: { reason, category: "budget" } });
      expect(r.ok).toBe(true);
    }
    const result = await executor.execute(id, { tool: "get_change_log", input: { reason } });
    expect(result).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
    const events = await ledger.getEventsAfter(id, 0);
    expect(events.find((e) => e.type === "guardrail.triggered")?.payload).toMatchObject({ kind: "budget_limit" });
    expect((await prisma.investigation.findUniqueOrThrow({ where: { id } })).toolCalls).toBe(TOOL_CALL_BUDGET);
  }, 60_000);

  it("returns the stored result for a repeated callerRef without executing again", async () => {
    const id = await demoRun("traffic-source-decline");
    const call = { tool: "breakdown_by_segment", input: { reason, dimension: "source" }, callerRef: "same" };
    const first = await executor.execute(id, call);
    const second = await executor.execute(id, call);
    expect(second).toEqual(first);
    expect(await executions(id)).toHaveLength(1);
    const types = await eventTypes(id);
    expect(types.filter((t) => t === "tool.call_started")).toHaveLength(1);
    expect(types.at(-1)).toBe("tool.call_deduplicated");
  });

  it("A8: a callerRef reused with different input answers CALL_ID_REUSED and records nothing new", async () => {
    const id = await demoRun("traffic-source-decline");
    await executor.execute(id, { tool: "breakdown_by_segment", input: { reason, dimension: "source" }, callerRef: "reused" });
    const second = await executor.execute(id, { tool: "breakdown_by_segment", input: { reason, dimension: "device" }, callerRef: "reused" });
    expect(second).toMatchObject({ ok: false, error: { code: "CALL_ID_REUSED", retryable: false } });
    expect(await executions(id)).toHaveLength(1);
  });

  it("retries a transient failure once after 500 ms, then fails (injected demo fault)", async () => {
    const id = await demoRun("tool-failure");
    const started = Date.now();
    const result = await executor.execute(id, { tool: "inspect_tracking_health", input: { reason } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(result).toMatchObject({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", retryable: true } });
    const events = (await ledger.getEventsAfter(id, 0)).filter((e) => e.type.startsWith("tool."));
    expect(events.map((e) => e.type)).toEqual([
      "tool.call_requested",
      "tool.call_started",
      "tool.call_retry_scheduled",
      "tool.call_started",
      "tool.call_failed",
    ]);
    expect(events[2]!.payload).toMatchObject({ attempt: 2, delayMs: 500 });
    expect(events[4]!.payload).toMatchObject({ attempt: 2, code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect((await executions(id))[0]).toMatchObject({ status: "FAILED", attempt: 2, errorCode: "UPSTREAM_UNAVAILABLE" });
  });

  it("times out a hanging tool, aborts it, retries once and reports TIMEOUT", async () => {
    const { investigation } = await ledger.create({
      mode: "URL",
      targetUrl: "https://example.com/",
      question: "Is the page healthy?",
      source: "api",
      runtime: "deterministic",
    });
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    const result = await executor.execute(investigation.id, { tool: "browser_check", input: { reason } });
    expect(result).toMatchObject({ ok: false, error: { code: "TIMEOUT", retryable: true } });
    expect(slowToolSignal?.aborted).toBe(true);
    const types = await eventTypes(investigation.id);
    expect(types.filter((t) => t === "tool.call_started")).toHaveLength(2);
    expect(types).toContain("tool.call_retry_scheduled");
    expect(types.at(-1)).toBe("tool.call_failed");
  });

  it("emits guardrail.triggered when tool content carries injection signals", async () => {
    const id = await demoRun("landing-page-mobile");
    const result = await executor.execute(id, { tool: "check_landing_page", input: { reason } });
    expect(result.ok && result.untrustedContent?.injectionSignals.length).toBeGreaterThan(0);
    const guardrail = (await ledger.getEventsAfter(id, 0)).find((e) => e.type === "guardrail.triggered");
    expect(guardrail?.payload).toMatchObject({ kind: "prompt_injection_suspected", details: { tool: "check_landing_page" } });
  });
});
