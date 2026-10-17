import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "../../test/boot";
import { IllegalTransitionError } from "./ledger.errors";
import { LedgerService, type CreateInvestigationInput } from "./ledger.service";

let app: INestApplication;
let ledger: LedgerService;

const urlRun = (extra: Partial<CreateInvestigationInput> = {}): CreateInvestigationInput => ({
  mode: "URL",
  targetUrl: "https://example.com/",
  question: "Is the landing page healthy?",
  source: "api",
  runtime: "external",
  clientName: "test-suite",
  ...extra,
});

beforeAll(async () => {
  app = await bootApp();
  ledger = app.get(LedgerService);
});
afterAll(async () => {
  await app?.close();
});

describe("LedgerService", () => {
  it("creates a QUEUED run with an investigation.created event at seq 1", async () => {
    const { investigation, created } = await ledger.create(urlRun());
    expect(created).toBe(true);
    expect(investigation.status).toBe("QUEUED");
    const events = await ledger.getEventsAfter(investigation.id, 0);
    expect(events.map((e) => [e.seq, e.type])).toEqual([[1, "investigation.created"]]);
    expect(events[0]!.payload).toMatchObject({ mode: "url", source: "api", runtime: "external" });
  });

  it("persists an `ai` runtime run with provider:model and its created event", async () => {
    const { investigation } = await ledger.create(urlRun({ runtime: "ai", model: "anthropic:claude-opus-5-5" }));
    expect(investigation).toMatchObject({ runtime: "ai", model: "anthropic:claude-opus-5-5" });
    const events = await ledger.getEventsAfter(investigation.id, 0);
    expect(events[0]!.payload).toMatchObject({ runtime: "ai" });
  });

  it("returns the existing run for a repeated idempotency key", async () => {
    const key = randomUUID();
    const first = await ledger.create(urlRun({ idempotencyKey: key }));
    const [second, third] = await Promise.all([
      ledger.create(urlRun({ idempotencyKey: key })),
      ledger.create(urlRun({ idempotencyKey: key })),
    ]);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.investigation.id).toBe(first.investigation.id);
    expect(third.investigation.id).toBe(first.investigation.id);
  });

  it("walks QUEUED → RUNNING → FAILED, stamping times and emitting events", async () => {
    const { investigation } = await ledger.create(urlRun());
    const running = await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    expect(running.status).toBe("RUNNING");
    expect(running.startedAt).toBeInstanceOf(Date);
    const failed = await ledger.transition(investigation.id, "RUNNING", "FAILED", {
      failureCode: "NO_REPORT",
      failureMessage: "The agent ended without a report.",
    });
    expect(failed).toMatchObject({ status: "FAILED", failureCode: "NO_REPORT" });
    expect(failed.finishedAt).toBeInstanceOf(Date);
    const types = (await ledger.getEventsAfter(investigation.id, 0)).map((e) => e.type);
    expect(types).toEqual(["investigation.created", "investigation.started", "investigation.failed"]);
  });

  it("rejects an illegal transition with a typed error and writes nothing", async () => {
    const { investigation } = await ledger.create(urlRun());
    // not in the state machine
    await expect(ledger.transition(investigation.id, "QUEUED", "COMPLETED")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    // allowed edge, but the run is not in the expected state
    await expect(ledger.transition(investigation.id, "RUNNING", "COMPLETED")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    await ledger.transition(investigation.id, "QUEUED", "CANCELLED");
    // terminal states are immutable
    await expect(ledger.transition(investigation.id, "CANCELLED", "RUNNING")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    const detail = await ledger.getInvestigation(investigation.id);
    expect(detail?.status).toBe("CANCELLED");
    expect((await ledger.getEventsAfter(investigation.id, 0)).map((e) => e.type)).toEqual([
      "investigation.created",
      "investigation.cancelled",
    ]);
  });

  it("allocates gap-free event seq under 20 parallel appends", async () => {
    const { investigation } = await ledger.create(urlRun());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ledger.appendEvent(investigation.id, "model.call_retry", { code: "RATE_LIMITED", attempt: i + 1 }),
      ),
    );
    const events = await ledger.getEventsAfter(investigation.id, 1);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));
    expect((await ledger.getEventsAfter(investigation.id, 15)).map((e) => e.seq)).toEqual([16, 17, 18, 19, 20, 21]);
  });

  it("rejects an event payload that does not match its schema", async () => {
    const { investigation } = await ledger.create(urlRun());
    await expect(
      ledger.appendEvent(investigation.id, "model.call_retry", { code: "X" } as never),
    ).rejects.toThrow();
    expect(await ledger.getEventsAfter(investigation.id, 1)).toEqual([]);
  });

  it("A8: parallel requests with one callerRef return the same execution, one of them deduplicated", async () => {
    const { investigation } = await ledger.create(urlRun());
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    const call = { tool: "fetch_page", input: { reason: "Check the page", url: "https://example.com/" }, reason: "Check the page", callerRef: "race_1" };
    const results = await Promise.all(Array.from({ length: 6 }, () => ledger.requestToolExecution(investigation.id, call)));
    expect(new Set(results.map((r) => r.toolExecution.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
  });

  it("A8: a callerRef reused with another tool or other input is refused with a clear error", async () => {
    const { investigation } = await ledger.create(urlRun());
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    const first = { tool: "fetch_page", input: { reason: "r", url: "https://example.com/" }, reason: "r", callerRef: "reuse_1" };
    await ledger.requestToolExecution(investigation.id, first);
    await expect(ledger.requestToolExecution(investigation.id, { ...first, tool: "check_links" })).rejects.toMatchObject({ code: "CALLER_REF_REUSED" });
    await expect(
      ledger.requestToolExecution(investigation.id, { ...first, input: { reason: "r", url: "https://example.com/other" } }),
    ).rejects.toMatchObject({ code: "CALLER_REF_REUSED" });
    // key order does not matter
    expect((await ledger.requestToolExecution(investigation.id, { ...first, input: { url: "https://example.com/", reason: "r" } })).deduplicated).toBe(true);
  });

  it("tracks a tool execution from request to success with attempts, duration and evidence refs E1, E2…", async () => {
    const { investigation } = await ledger.create(urlRun());
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    const { toolExecution, deduplicated } = await ledger.requestToolExecution(investigation.id, {
      tool: "fetch_page",
      input: { reason: "Check the page" },
      reason: "Check the page",
      callerRef: "call_1",
    });
    expect(deduplicated).toBe(false);
    expect(toolExecution.status).toBe("REQUESTED");

    const again = await ledger.requestToolExecution(investigation.id, {
      tool: "fetch_page",
      input: { reason: "Check the page" },
      reason: "Check the page",
      callerRef: "call_1",
    });
    expect(again).toMatchObject({ deduplicated: true, toolExecution: { id: toolExecution.id } });

    expect((await ledger.startToolExecution(toolExecution.id, 1)).status).toBe("RUNNING");
    await ledger.startToolExecution(toolExecution.id, 2);
    const evidence = await ledger.addEvidence(investigation.id, toolExecution.id, [
      { kind: "http", strength: "direct", statement: "GET / returned 200 in 120 ms", data: { status: 200 }, provenance: "live-http" },
      { kind: "content", strength: "context", statement: "Title is present", data: {}, provenance: "live-http" },
    ]);
    expect(evidence.map((e) => e.ref)).toEqual(["E1", "E2"]);
    const done = await ledger.finishToolExecution(toolExecution.id, {
      ok: true,
      output: { status: 200 },
      evidenceIds: evidence.map((e) => e.ref),
    });
    expect(done).toMatchObject({ status: "SUCCEEDED", attempt: 2, outputTruncated: false });
    expect(done.durationMs).toBeGreaterThanOrEqual(0);

    const second = await ledger.requestToolExecution(investigation.id, { tool: "check_links", input: {}, reason: "Links" });
    await ledger.startToolExecution(second.toolExecution.id, 1);
    const more = await ledger.addEvidence(investigation.id, second.toolExecution.id, [
      { kind: "links", strength: "indirect", statement: "0 of 4 links broken", data: {}, provenance: "live-http" },
    ]);
    expect(more.map((e) => e.ref)).toEqual(["E3"]);

    const types = (await ledger.getEventsAfter(investigation.id, 0)).map((e) => e.type);
    expect(types).toEqual([
      "investigation.created",
      "investigation.started",
      "tool.call_requested",
      "tool.call_deduplicated",
      "tool.call_started",
      "tool.call_started",
      "evidence.recorded",
      "evidence.recorded",
      "tool.call_succeeded",
      "tool.call_requested",
      "tool.call_started",
      "evidence.recorded",
    ]);
  });

  it("keeps a rejected call distinct from an executed one, and records failures", async () => {
    const { investigation } = await ledger.create(urlRun());
    const rejected = await ledger.requestToolExecution(investigation.id, { tool: "drop_table", input: {}, reason: "?" });
    const r = await ledger.rejectToolExecution(rejected.toolExecution.id, "UNKNOWN_TOOL", [{ message: "no such tool" }]);
    expect(r).toMatchObject({ status: "REJECTED", errorCode: "UNKNOWN_TOOL", attempt: 0, startedAt: null });

    const failing = await ledger.requestToolExecution(investigation.id, { tool: "fetch_page", input: {}, reason: "Try" });
    await ledger.startToolExecution(failing.toolExecution.id, 1);
    const f = await ledger.finishToolExecution(failing.toolExecution.id, {
      ok: false,
      code: "TIMEOUT",
      message: "Timed out after 8 s",
      retryable: true,
    });
    expect(f).toMatchObject({ status: "FAILED", errorCode: "TIMEOUT", attempt: 1 });
    // a finished execution cannot be finished or started again
    await expect(ledger.startToolExecution(failing.toolExecution.id, 2)).rejects.toThrow(/FAILED/);
  });

  it("caps stored tool output at 64 KB with a truncation flag", async () => {
    const { investigation } = await ledger.create(urlRun());
    const { toolExecution } = await ledger.requestToolExecution(investigation.id, { tool: "fetch_page", input: {}, reason: "Big" });
    await ledger.startToolExecution(toolExecution.id, 1);
    const done = await ledger.finishToolExecution(toolExecution.id, { ok: true, output: { html: "x".repeat(100_000) } });
    expect(done.outputTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(done.output))).toBeLessThanOrEqual(64 * 1024);
  });

  it("saves the report and lists runs newest first with a cursor", async () => {
    const { investigation } = await ledger.create(urlRun({ question: "report test" }));
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    await ledger.completeWithReport(investigation.id, 1, {
      verdict: "inconclusive",
      severity: "low",
      summary: "Nothing conclusive.",
      payload: { schemaVersion: "1" },
    });
    const detail = await ledger.getInvestigation(investigation.id);
    expect(detail?.report).toMatchObject({ verdict: "inconclusive", schemaVersion: "1" });

    const page1 = await ledger.listInvestigations({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]!.id).toBe(investigation.id);
    const page2 = await ledger.listInvestigations({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items[0]!.id).not.toBe(page1.items[1]!.id);
    expect(page2.items[0]!.createdAt.getTime()).toBeLessThanOrEqual(page1.items[1]!.createdAt.getTime());
  });

  it("persists a run across an app restart (spec story 15)", async () => {
    const { investigation } = await ledger.create(urlRun({ question: "survives restart" }));
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    await app.close();

    app = await bootApp();
    ledger = app.get(LedgerService);
    const back = await ledger.getInvestigation(investigation.id);
    expect(back).toMatchObject({ id: investigation.id, status: "RUNNING", question: "survives restart" });
    expect((await ledger.getEventsAfter(investigation.id, 0)).map((e) => e.seq)).toEqual([1, 2]);
  });
});
