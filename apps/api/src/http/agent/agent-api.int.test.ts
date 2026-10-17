import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { AgentCreateInvestigationResponseSchema, AgentInvestigationStatusSchema, scenarioCatalogue } from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { PrismaService } from "../../db/prisma.service";
import { seedDemoData } from "../../demo-data/seed";
import { LedgerService } from "../../ledger/ledger.service";
import { AGENT_REJECTED_CALL_CAP } from "./agent.service";

const token = randomBytes(24).toString("hex");
const campaignId = scenarioCatalogue.find((s) => s.key === "tracking-break")!.campaignId;
const reason = "Collect evidence for the agent API test.";
let app: INestApplication;
let prisma: PrismaService;
let ledger: LedgerService;
const http = () => request(app.getHttpServer());
const authed = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

const start = async (body: Record<string, unknown> = {}) =>
  AgentCreateInvestigationResponseSchema.parse(
    (
      await authed(http().post("/api/agent/investigations"))
        .set("User-Agent", "agent-test/1.0")
        .send({ mode: "demo", campaignId, client: { name: "test-client", version: "9.9" }, ...body })
        .expect(201)
    ).body,
  );
const call = (id: string, tool: string, input: Record<string, unknown> = {}, callId?: string) =>
  authed(http().post(`/api/agent/investigations/${id}/tools/${tool}`)).send({ input: { reason, ...input }, callId });

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
  ({ app } = await createApp({ logger: false, env: { ...process.env, SENTINEL_AGENT_TOKEN: token } }));
  await app.init();
  prisma = app.get(PrismaService);
  ledger = app.get(LedgerService);
  await seedDemoData(prisma);
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("access boundary", () => {
  it("401 without a token and with a wrong token, on every route", async () => {
    await http().get("/api/agent/campaigns").expect(401);
    await http().get("/api/agent/campaigns").set("Authorization", "Bearer nope").expect(401);
    await http().get("/api/agent/campaigns").set("Authorization", `Basic ${token}`).expect(401);
    await http().post("/api/agent/investigations").send({}).expect(401);
    await http().post("/api/agent/investigations/x/tools/compare_periods").send({}).expect(401);
    await http().post("/api/agent/investigations/x/report").send({}).expect(401);
    const res = await http().get("/api/agent/investigations/x").expect(401);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("403 for a non-local Origin or Host even with the right token", async () => {
    await authed(http().get("/api/agent/campaigns")).set("Origin", "https://evil.example").expect(403);
    await authed(http().get("/api/agent/campaigns")).set("Host", "rebind.example:4000").expect(403);
    await authed(http().get("/api/agent/campaigns")).set("Origin", "http://localhost:3000").expect(200);
  });

  it("A11: Host is parsed strictly as host[:port]; lookalikes and userinfo tricks are refused", async () => {
    for (const host of ["localhost.evil.com", "evil.com@localhost", "localhost@evil.com", "localhost:4000@evil.com", "localhost#x", "localhost/x", "localhost\\x","localhost?x", "localhost%2f", "evil.com:4000"]) {
      await authed(http().get("/api/agent/campaigns")).set("Host", host).expect(403);
    }
    for (const host of ["localhost", "LOCALHOST:4000", "127.0.0.1:4000", "[::1]:4000"]) {
      await authed(http().get("/api/agent/campaigns")).set("Host", host).expect(200);
    }
    await authed(http().get("/api/agent/campaigns")).set("Origin", "http://evil.com@localhost").expect(403);
    await authed(http().get("/api/agent/campaigns")).set("Origin", "http://localhost.evil.com").expect(403);
  });

  it("A11: an unset server token answers exactly like a wrong token", async () => {
    const { app: bare } = await createApp({ logger: false, env: { ...process.env, SENTINEL_AGENT_TOKEN: "" } });
    await bare.init();
    try {
      const unset = await request(bare.getHttpServer()).get("/api/agent/campaigns").set("Authorization", `Bearer ${token}`).expect(401);
      const wrong = await http().get("/api/agent/campaigns").set("Authorization", "Bearer nope").expect(401);
      expect(unset.body).toEqual(wrong.body);
    } finally {
      await bare.close();
    }
  });

  it("lists campaigns without any scenario information", async () => {
    const res = await authed(http().get("/api/agent/campaigns")).expect(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toContain(campaignId);
    expect(JSON.stringify(res.body)).not.toMatch(/tracking-break|simulated|expectedCategory/);
  });
});

describe("an external investigation", () => {
  it("is recorded with source mcp, the client and the User-Agent, and runs through tools and report", async () => {
    const started = await start();
    expect(started).toMatchObject({ mode: "demo", budgets: { toolCalls: 24, reportAttempts: 3 } });
    expect(started.tools.map((t) => t.name)).toContain("compare_periods");
    expect(started.tools.map((t) => t.name)).not.toContain("fetch_page");
    expect(started.periods).not.toBeNull();

    const pub = (await http().get(`/api/investigations/${started.investigationId}`).expect(200)).body;
    expect(pub).toMatchObject({ source: "mcp", runtime: "external", status: "RUNNING", clientName: "test-client", clientVersion: "9.9", clientUserAgent: "agent-test/1.0" });

    const first = await call(started.investigationId, "compare_periods", {}, "c-1").expect(200);
    expect(first.body).toMatchObject({ ok: true, evidence: [{ ref: "E1" }] });
    const again = await call(started.investigationId, "compare_periods", {}, "c-1").expect(200);
    expect(again.body).toEqual(first.body);
    const status = AgentInvestigationStatusSchema.parse((await authed(http().get(`/api/agent/investigations/${started.investigationId}`)).expect(200)).body);
    expect(status).toMatchObject({ status: "RUNNING", evidence: [{ ref: "E1" }], budgetsLeft: { toolCalls: 23, reportAttempts: 3 } });

    const bad = await authed(http().post(`/api/agent/investigations/${started.investigationId}/report`))
      .send({ report: report({ observations: [{ statement: "Made up.", evidenceIds: ["E42"] }] }) })
      .expect(422);
    expect(bad.body).toMatchObject({ accepted: false, errors: [expect.objectContaining({ rule: "evidence_exists" })] });
    const good = await authed(http().post(`/api/agent/investigations/${started.investigationId}/report`)).send({ report: report() }).expect(200);
    expect(good.body).toEqual({ accepted: true, url: expect.stringContaining(`/investigations/${started.investigationId}`) });
    expect((await http().get(`/api/investigations/${started.investigationId}`).expect(200)).body).toMatchObject({ status: "COMPLETED", source: "mcp" });
  });

  it("answers 400 for an unknown campaign, 404 for an unknown run and 400 for a malformed body", async () => {
    await authed(http().post("/api/agent/investigations")).send({ mode: "demo", campaignId: "nope", client: { name: "x" } }).expect(400);
    await authed(http().post("/api/agent/investigations")).send({ mode: "demo", campaignId }).expect(400);
    await call("missing", "compare_periods").expect(404);
    await authed(http().get("/api/agent/investigations/missing")).expect(404);
  });

  it("D02: the 21st rejected call is refused with BUDGET_EXCEEDED and closes the tool endpoint without writing more rows", async () => {
    const { investigationId } = await start();
    for (let i = 0; i < AGENT_REJECTED_CALL_CAP; i++) {
      const res = await call(investigationId, "no_such_tool").expect(200);
      expect(res.body).toMatchObject({ ok: false, error: { code: "UNKNOWN_TOOL" } });
    }
    const over = await call(investigationId, "no_such_tool").expect(200);
    expect(over.body).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
    expect(await prisma.toolExecution.count({ where: { investigationId, status: "REJECTED" } })).toBe(AGENT_REJECTED_CALL_CAP);
    // the cap closes the tool endpoint for this run; the report endpoint stays open
    expect((await call(investigationId, "compare_periods").expect(200)).body).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
    await authed(http().post(`/api/agent/investigations/${investigationId}/report`)).send({ report: report() }).expect(422);
  });
});

describe("runs driven by other runtimes", () => {
  const make = async (runtime: "openclaw" | "deterministic") => {
    const { investigation } = await ledger.create({ mode: "DEMO", campaignId, question: "Why?", source: "web", runtime });
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    return investigation.id;
  };

  it("accepts tool calls and a report for an existing RUNNING openclaw run", async () => {
    const id = await make("openclaw");
    expect((await call(id, "compare_periods").expect(200)).body).toMatchObject({ ok: true });
    await authed(http().post(`/api/agent/investigations/${id}/report`)).send({ report: report() }).expect(200);
    expect((await http().get(`/api/investigations/${id}`).expect(200)).body).toMatchObject({ status: "COMPLETED", runtime: "openclaw" });
  });

  it("refuses to drive a built-in (deterministic) run", async () => {
    const id = await make("deterministic");
    await call(id, "compare_periods").expect(409);
    await authed(http().post(`/api/agent/investigations/${id}/report`)).send({ report: report() }).expect(409);
  });
});
