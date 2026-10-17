import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { HealthResponseSchema, scenarioCatalogue } from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { PrismaService } from "../db/prisma.service";
import { seedDemoData } from "../demo-data/seed";
import { LedgerService } from "../ledger/ledger.service";
import { ToolExecutor } from "../tools/tool-executor";
import { Runner } from "./runner";

/**
 * The `ai` and `openclaw` runtimes through the real app and Runner, against loopback fakes: a fake Anthropic
 * API (picked up through ANTHROPIC_BASE_URL) and a fake OpenClaw gateway. No network, made-up keys only.
 */
const KEY = "fake-key-for-tests-0000";
const TOKEN = "fake-gateway-token-0000";
const reason = "Scripted step for the runtime test.";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const report: Json = {
  schemaVersion: "1",
  summary: "Tracked conversion rate fell significantly between the periods; this scripted report cites the comparison only.",
  verdict: "likely_cause",
  severity: "high",
  severityRationale: "Tracked conversions are down by more than 30%.",
  whatChanged: "Tracked CR fell [E1].",
  observations: [{ statement: "CR fell.", evidenceIds: ["E1"] }],
  hypotheses: [
    {
      id: "H1",
      category: "tracking",
      statement: "The pixel may have stopped firing.",
      status: "plausible",
      confidence: "medium",
      confidenceRationale: "Only the comparison supports it so far.",
      supportingEvidenceIds: ["E1"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [],
  recommendedActions: [{ action: "Check the conversion tag.", priority: "now", rationale: "Most likely cause.", hypothesisIds: ["H1"] }],
  limitations: [],
  securityNotes: [],
};

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });

let app: INestApplication;
let prisma: PrismaService;
let ledger: LedgerService;
let runner: Runner;
let executor: ToolExecutor;
let anthropic: http.Server;
let gateway: http.Server;
/** what the fake gateway does for the next request */
let gatewayBehaviour: (investigationId: string) => Promise<string> = async () => "";
let anthropicReplies: Json[] = [];
let anthropicStatus = 200;
const anthropicBodies: Json[] = [];

beforeAll(async () => {
  const a = await listen(async (req, res) => {
    anthropicBodies.push(JSON.parse(await readBody(req)));
    res.writeHead(anthropicStatus, { "content-type": "application/json" });
    res.end(JSON.stringify(anthropicReplies.shift()));
  });
  anthropic = a.server;
  const g = await listen(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    const text = await gatewayBehaviour(String(body.user).replace(/^inv:/, ""));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "resp_1", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }));
  });
  gateway = g.server;
  process.env.ANTHROPIC_BASE_URL = a.url;
  ({ app } = await createApp({
    logger: false,
    env: { ...process.env, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY, OPENCLAW_GATEWAY_URL: g.url, OPENCLAW_GATEWAY_TOKEN: TOKEN },
  }));
  await app.init();
  prisma = app.get(PrismaService);
  ledger = app.get(LedgerService);
  runner = app.get(Runner);
  executor = app.get(ToolExecutor, { strict: false });
  await seedDemoData(prisma);
}, 120_000);
afterAll(async () => {
  await app?.close();
  anthropic?.close();
  gateway?.close();
  delete process.env.ANTHROPIC_BASE_URL;
});

const campaignId = scenarioCatalogue.find((s) => s.key === "tracking-break")!.campaignId;
async function queued(runtime: "ai" | "openclaw"): Promise<string> {
  const { investigation } = await ledger.create({
    mode: "DEMO",
    campaignId,
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
const finished = async (id: string) => ({
  inv: await prisma.investigation.findUniqueOrThrow({ where: { id }, include: { report: true } }),
  events: await ledger.getEventsAfter(id, 0),
});
const toolUse = (id: string, name: string, input: Json): Json => ({
  id: `msg_${id}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "tool_use", stop_sequence: null,
  content: [{ type: "tool_use", id, name, input }],
  usage: { input_tokens: 100, output_tokens: 20 },
});

describe("ai runtime", () => {
  it("runs an investigation with the provider's session: tool call, report, COMPLETED, model labelled provider:model", async () => {
    anthropicReplies = [toolUse("toolu_1", "compare_periods", { reason }), toolUse("toolu_2", "submit_report", { reason, report })];
    anthropicBodies.length = 0;
    const id = await queued("ai");
    await runner.run(id);
    const { inv, events } = await finished(id);
    expect(inv).toMatchObject({ status: "COMPLETED", runtime: "ai", model: "anthropic:claude-opus-5-5", modelTurns: 2, inputTokens: 200 });
    expect(inv.report?.verdict).toBe("likely_cause");
    expect(anthropicBodies).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it("a rejected key fails the run MODEL_CONFIG_ERROR without echoing it", async () => {
    anthropicReplies = [{ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } }];
    anthropicStatus = 401;
    const id = await queued("ai");
    await runner.run(id);
    const { inv, events } = await finished(id);
    anthropicStatus = 200;
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "MODEL_CONFIG_ERROR" });
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it("the public API reports the provider and refuses ai without a key", async () => {
    const health = HealthResponseSchema.parse((await request(app.getHttpServer()).get("/api/health").expect(200)).body);
    expect(health.runtimes.ai).toEqual({ provider: "anthropic", model: "claude-opus-5-5", status: "available" });
    expect(health.runtimes.openclaw).toBe("configured");

    const { app: bare } = await createApp({ logger: false, env: { ...process.env, ANTHROPIC_API_KEY: "", OPENCLAW_GATEWAY_URL: "", OPENCLAW_GATEWAY_TOKEN: "" } });
    await bare.init();
    try {
      const res = await request(bare.getHttpServer()).post("/api/investigations").send({ mode: "demo", campaignId, runtime: "ai" }).expect(400);
      expect(res.body).toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
      expect(res.body.message).toContain("ANTHROPIC_API_KEY");
      const claw = await request(bare.getHttpServer()).post("/api/investigations").send({ mode: "demo", campaignId, runtime: "openclaw" }).expect(400);
      expect(claw.body.message).toContain("OPENCLAW_GATEWAY_URL");
      const h = HealthResponseSchema.parse((await request(bare.getHttpServer()).get("/api/health").expect(200)).body);
      expect(h.runtimes.ai.status).toBe("missing_key");
      expect(h.runtimes.openclaw).toBe("not_configured");
    } finally {
      await bare.close();
    }
  });
});

describe("A5: retry by runtime", () => {
  const finishedRun = async (runtime: "ai" | "openclaw" | "external") => {
    const id = await queued(runtime as "ai");
    await ledger.transition(id, "QUEUED", "CANCELLED");
    return id;
  };
  const retry = (id: string) => request(app.getHttpServer()).post(`/api/investigations/${id}/retry`);

  it("retries an ai run with the same runtime and an openclaw run likewise", async () => {
    for (const runtime of ["ai", "openclaw"] as const) {
      const original = await finishedRun(runtime);
      const res = await retry(original).expect(201);
      expect(res.body).toMatchObject({ runtime, retryOfId: original, status: expect.stringMatching(/QUEUED|RUNNING|COMPLETED|FAILED/) });
      await runner.cancel(res.body.id).catch(() => undefined);
      await runner.whenIdle();
    }
  });

  it("refuses to retry an external run (409) and a run whose runtime is no longer configured (400)", async () => {
    const external = await finishedRun("external");
    expect((await retry(external).expect(409)).body.code).toBe("NOT_RETRYABLE");
    const { app: bare } = await createApp({ logger: false, env: { ...process.env, ANTHROPIC_API_KEY: "", OPENCLAW_GATEWAY_URL: "", OPENCLAW_GATEWAY_TOKEN: "" } });
    await bare.init();
    try {
      const ai = await finishedRun("ai");
      expect((await request(bare.getHttpServer()).post(`/api/investigations/${ai}/retry`).expect(400)).body.code).toBe("RUNTIME_UNAVAILABLE");
    } finally {
      await bare.close();
    }
  });
});

describe("openclaw runtime", () => {
  it("completes when the gateway's agent submits an accepted report through the shared executor", async () => {
    gatewayBehaviour = async (id) => {
      await executor.execute(id, { tool: "compare_periods", input: { reason } });
      await executor.execute(id, { tool: "submit_report", input: { reason, report } });
      return "Report submitted.";
    };
    const id = await queued("openclaw");
    await runner.run(id);
    const { inv } = await finished(id);
    expect(inv).toMatchObject({ status: "COMPLETED", runtime: "openclaw", model: "openclaw:sentinel" });
  });

  it("ended without an accepted report: FAILED / NO_REPORT with the truncated final text in the failure event", async () => {
    gatewayBehaviour = async () => `I got lost. ${"x".repeat(900)}`;
    const id = await queued("openclaw");
    await runner.run(id);
    const { inv, events } = await finished(id);
    expect(inv).toMatchObject({ status: "FAILED", failureCode: "NO_REPORT" });
    const failed = events.find((e) => e.type === "investigation.failed")!.payload as { code: string; message: string };
    expect(failed.code).toBe("NO_REPORT");
    expect(failed.message).toContain("I got lost.");
    expect(failed.message.length).toBeLessThan(700);
  });

  it("an unreachable gateway fails FAILED / RUNTIME_UNAVAILABLE", async () => {
    const dead = await listen(() => undefined);
    const { app: other } = await createApp({ logger: false, env: { ...process.env, OPENCLAW_GATEWAY_URL: dead.url, OPENCLAW_GATEWAY_TOKEN: TOKEN } });
    await other.init();
    dead.server.closeAllConnections();
    await new Promise<void>((r) => dead.server.close(() => r()));
    try {
      const { investigation } = await other.get(LedgerService).create({
        mode: "DEMO", campaignId, question: "Why?", source: "api", runtime: "openclaw",
        baselineStart: new Date("2026-09-19T00:00:00Z"), baselineEnd: new Date("2026-10-02T00:00:00Z"),
        currentStart: new Date("2026-10-03T00:00:00Z"), currentEnd: new Date("2026-10-16T00:00:00Z"),
      });
      await other.get(Runner).run(investigation.id);
      const run = await prisma.investigation.findUniqueOrThrow({ where: { id: investigation.id } });
      expect(run).toMatchObject({ status: "FAILED", failureCode: "RUNTIME_UNAVAILABLE" });
      expect(run.failureMessage).not.toContain(TOKEN);
    } finally {
      await other.close();
    }
  });
});
