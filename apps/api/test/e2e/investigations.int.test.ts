import type { INestApplication } from "@nestjs/common";
import {
  EventsResponseSchema,
  HealthResponseSchema,
  InvestigationDetailSchema,
  InvestigationListItemSchema,
  InvestigationListResponseSchema,
  TERMINAL_STATUSES,
  URL_SCOPE_STATEMENT,
  scenarioCatalogue,
  type InvestigationDetail,
} from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/db/prisma.service";
import { seedDemoData } from "../../src/demo-data/seed";
import { CreationThrottle } from "../../src/http/public/creation-throttle";
import { LedgerService } from "../../src/ledger/ledger.service";
import { Runner } from "../../src/runtime/runner";
import { bootApp } from "../boot";
import { startFixtureSite, type FixtureSite } from "../fixtures/sites/server";

/**
 * The complete workflow through the real application (spec stories 73, 77): Nest app + test database +
 * local fixture site, deterministic policy, everything over HTTP. No network, no keys.
 */
let app: INestApplication;
let site: FixtureSite;
let prisma: PrismaService;
const http = () => request(app.getHttpServer());

async function waitForTerminal(id: string): Promise<InvestigationDetail> {
  const until = Date.now() + 90_000;
  let after = 0;
  for (;;) {
    const res = await http().get(`/api/investigations/${id}/events?after=${after}`).expect(200);
    const page = EventsResponseSchema.parse(res.body);
    after = page.items.at(-1)?.seq ?? after;
    if (TERMINAL_STATUSES.includes(page.status)) break;
    if (Date.now() > until) throw new Error(`investigation ${id} did not finish`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await http().get(`/api/investigations/${id}`).expect(200);
  return InvestigationDetailSchema.parse(res.body);
}

const create = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  http().post("/api/investigations").set(headers).send(body);
const events = async (id: string) =>
  EventsResponseSchema.parse((await http().get(`/api/investigations/${id}/events?after=0`).expect(200)).body).items;

beforeAll(async () => {
  process.env.URL_FETCH_ALLOW_PRIVATE = "1";
  site = await startFixtureSite();
  app = await bootApp();
  prisma = app.get(PrismaService);
  await seedDemoData(prisma);
}, 120_000);
beforeEach(() => app.get(CreationThrottle).reset());
afterAll(async () => {
  await app?.get(Runner).whenIdle();
  await app?.close();
  await site?.close();
});

describe("demo scenarios with the deterministic policy (spec §8)", () => {
  const sequences = new Map<string, string>();
  const runs = new Map<string, InvestigationDetail>();

  beforeAll(async () => {
    const created = await Promise.all(
      scenarioCatalogue.map(async (s) => {
        const res = await create({ mode: "demo", campaignId: s.campaignId, runtime: "deterministic" }).expect(201);
        return [s.key, InvestigationListItemSchema.parse(res.body)] as const;
      }),
    );
    for (const [key, item] of created) {
      expect(item).toMatchObject({ mode: "demo", provenance: "synthetic-demo", runtime: "deterministic" });
      runs.set(key, await waitForTerminal(item.id));
    }
  }, 180_000);

  for (const scenario of scenarioCatalogue) {
    it(`${scenario.key}: ${scenario.expectedCategory ?? "inconclusive"}, ${scenario.expectedVerdicts.join("/")}, ${scenario.expectedSeverity}`, () => {
      const run = runs.get(scenario.key)!;
      expect(run.failureMessage).toBeNull();
      expect(run).toMatchObject({ status: "COMPLETED", model: "deterministic-policy-v1", question: expect.stringMatching(/conversion rate/) });
      const report = run.report!.payload;
      if (scenario.expectedCategory) expect(report.hypotheses[0]!.category).toBe(scenario.expectedCategory);
      expect(scenario.expectedVerdicts).toContain(report.verdict);
      expect(report.severity).toBe(scenario.expectedSeverity);
      // story 17: computed server-side after completion
      expect(run.groundTruth).toEqual({
        expectedCategory: scenario.expectedCategory,
        expectedVerdict: scenario.expectedVerdicts.join(" / "),
        agentTopCategory: report.hypotheses[0]!.category,
        agentVerdict: report.verdict,
        match: true,
      });
      expect(report).toMatchObject({ provenance: "synthetic-demo", runtime: "deterministic", model: "deterministic-policy-v1" });
      expect(report.keyMetrics).toMatchObject({ isSignificant: expect.any(Boolean) });
      // A13: a rounded-away p-value must never read "p = 0" (or a six-decimal "p = 0.000123")
      expect(JSON.stringify(report)).not.toMatch(/p = 0(?![.\d])|p = 0\.\d{4,}/);
      for (const id of report.observations.flatMap((o) => o.evidenceIds)) expect(report.evidenceIndex[id]).toBeDefined();
      // story 16: no tool output carries the hidden scenario key
      expect(JSON.stringify(run.toolExecutions.map((t) => t.output))).not.toContain(scenario.key);
      expect(run.evidence.map((e) => e.ref)).toEqual(run.evidence.map((_, i) => `E${i + 1}`));
      sequences.set(scenario.key, run.toolExecutions.map((t) => `${t.tool}${t.tool === "breakdown_by_segment" ? `:${(t.input as { dimension: string }).dimension}` : ""}`).join(">"));
    });
  }

  it("the policy chose at least four distinct tool sequences (story 5)", () => {
    expect(new Set(sequences.values()).size).toBeGreaterThanOrEqual(4);
  });

  it("landing-page-mobile: the hidden injection is flagged and no budget increase is recommended", async () => {
    const run = runs.get("landing-page-mobile")!;
    expect(run.report!.payload.securityNotes.join(" ")).toMatch(/prompt injection/i);
    expect(run.report!.payload.recommendedActions.map((a) => a.action).join(" ")).not.toMatch(/(raise|increase|tripl).{0,20}budget/i);
    expect((await events(run.id)).some((e) => e.type === "guardrail.triggered")).toBe(true);
  });

  it("tool-failure: retry and failure events, a data_quality evidence item and toolFailures", async () => {
    const run = runs.get("tool-failure")!;
    const types = (await events(run.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["tool.call_retry_scheduled", "tool.call_failed"]));
    expect(run.report!.payload.toolFailures).toEqual([expect.objectContaining({ tool: "inspect_tracking_health", code: "UPSTREAM_UNAVAILABLE" })]);
    expect(run.evidence.map((e) => e.statement)).toContain("inspect_tracking_health unavailable: UPSTREAM_UNAVAILABLE");
    expect(run.report!.payload.unknowns.map((u) => u.question).join(" ")).toMatch(/tracking/i);
    expect(run.report!.payload.hypotheses[0]!.confidence).not.toBe("high");
  });

  it("insufficient-data: unknowns name the sample size and the data gap", () => {
    const text = JSON.stringify(runs.get("insufficient-data")!.report!.payload.unknowns);
    expect(text).toMatch(/sample/i);
    expect(text).toMatch(/2026-10-10/);
  });
});

describe("URL investigations against the fixture site", () => {
  const runUrl = async (path: string) => {
    const res = await create({ mode: "url", url: `${site.origin}${path}`, runtime: "deterministic" }).expect(201);
    return waitForTerminal(res.body.id);
  };

  it("/ok completes with an honest report and the scope limitation", async () => {
    const run = await runUrl("/ok");
    expect(run).toMatchObject({ status: "COMPLETED", mode: "url", provenance: "live-http" });
    const report = run.report!.payload;
    expect(report.limitations).toContain(URL_SCOPE_STATEMENT);
    expect(run.groundTruth).toBeUndefined();
    expect(report.verdict).not.toBe("cause_identified");
    expect(report.keyMetrics).toMatchObject({ status: 200 });
    expect(run.toolExecutions.map((t) => t.tool).slice(0, 3)).toEqual(["fetch_page", "measure_availability", "check_links"]);
  }, 60_000);

  it("/error: site availability is the top finding", async () => {
    const run = await runUrl("/error");
    const report = run.report!.payload;
    expect(run.status).toBe("COMPLETED");
    expect(report.hypotheses[0]!.category).toBe("site_availability");
    expect(report).toMatchObject({ verdict: "likely_cause", severity: "critical" });
    expect(report.limitations).toContain(URL_SCOPE_STATEMENT);
  }, 60_000);

  it("U3: a page with only hygiene issues (no tracking tag, no viewport) is no_issue_found / low, the issues are recommendations", async () => {
    const run = await runUrl("/no-tracking");
    expect(run.status).toBe("COMPLETED");
    const report = run.report!.payload;
    expect(report).toMatchObject({ verdict: "no_issue_found", severity: "low" });
    const actions = report.recommendedActions.map((x) => x.action).join(" | ");
    expect(actions).toMatch(/analytics and conversion tags/i);
    expect(actions).toMatch(/viewport/i);
    // hypotheses are problems or causes, not positive facts
    expect(report.hypotheses.map((h) => h.statement).join(" ")).not.toMatch(/healthy|is fast|reliably/i);
    expect(report.limitations).toContain(URL_SCOPE_STATEMENT);
  }, 60_000);

  it("U3: an evidenced defect (noindex) stays likely_cause", async () => {
    const run = await runUrl("/noindex");
    const report = run.report!.payload;
    expect(report).toMatchObject({ verdict: "likely_cause", severity: "medium" });
    expect(report.hypotheses[0]!.category).toBe("seo_indexing");
  }, 60_000);

  it("/redirect-to-private: the hop is blocked, logged, and the report says what could not be checked", async () => {
    const run = await runUrl("/redirect-to-private");
    expect(run.status).toBe("COMPLETED");
    const guard = (await events(run.id)).filter((e) => e.type === "guardrail.triggered").map((e) => e.payload);
    expect(guard).toContainEqual(expect.objectContaining({ kind: "ssrf_blocked" }));
    const report = run.report!.payload;
    expect(report.verdict).toBe("inconclusive");
    expect(report.limitations.join(" ")).toMatch(/blocked/i);
    expect(report.limitations).toContain(URL_SCOPE_STATEMENT);
  }, 60_000);

  it("refuses a private target with 400 and creates nothing", async () => {
    const before = await prisma.investigation.count();
    const res = await create({ mode: "url", url: "http://169.254.169.254/latest/meta-data/", runtime: "deterministic" }).expect(400);
    expect(res.body).toMatchObject({ code: "BLOCKED_ADDRESS", message: expect.any(String) });
    expect(await prisma.investigation.count()).toBe(before);
  });
});

describe("public API", () => {
  const demo = scenarioCatalogue[0]!.campaignId;

  it("validates periods field by field (story 2)", async () => {
    const res = await create({
      mode: "demo",
      campaignId: demo,
      runtime: "deterministic",
      baseline: { start: "2026-08-01", end: "2026-09-20" },
      current: { start: "2026-09-15", end: "2026-10-30" },
    }).expect(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const fields = (res.body.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["baseline.start", "baseline.end", "current.start", "current.end"]));
    expect((await create({ mode: "demo", campaignId: "no-such-campaign", runtime: "deterministic" }).expect(400)).body.details).toEqual([
      { field: "campaignId", message: expect.any(String) },
    ]);
    const bad = await create({ mode: "demo", campaignId: demo, runtime: "deterministic", baseline: { start: "2026-10-02", end: "2026-09-19" } }).expect(400);
    expect(bad.body.details).toContainEqual({ field: "baseline.end", message: expect.any(String) });
  });

  it("an AI or OpenClaw runtime is refused until it is available", async () => {
    const res = await create({ mode: "demo", campaignId: demo, runtime: "ai" }).expect(400);
    expect(res.body.code).toBe("RUNTIME_UNAVAILABLE");
  });

  it("Idempotency-Key: a repeat returns the same run (story 3)", async () => {
    const key = `e2e-${Date.now()}`;
    const first = await create({ mode: "demo", campaignId: demo, runtime: "deterministic" }, { "Idempotency-Key": key }).expect(201);
    const second = await create({ mode: "demo", campaignId: demo, runtime: "deterministic" }, { "Idempotency-Key": key }).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.investigation.count({ where: { idempotencyKey: key } })).toBe(1);
    await waitForTerminal(first.body.id);
  }, 60_000);

  it("groundTruth is absent while the run is not finished, and for failed runs", async () => {
    const ledger = app.get(LedgerService);
    const { investigation } = await ledger.create({ mode: "DEMO", campaignId: demo, question: "q", source: "web", runtime: "deterministic" });
    const queued = (await http().get(`/api/investigations/${investigation.id}`).expect(200)).body;
    expect(queued.status).toBe("QUEUED");
    expect("groundTruth" in queued).toBe(false);
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    expect("groundTruth" in (await http().get(`/api/investigations/${investigation.id}`).expect(200)).body).toBe(false);
    await ledger.transition(investigation.id, "RUNNING", "FAILED", { failureCode: "NO_REPORT", failureMessage: "x" });
    expect("groundTruth" in (await http().get(`/api/investigations/${investigation.id}`).expect(200)).body).toBe(false);
  });

  it("cancel: a queued run is cancelled; a terminal one answers 409", async () => {
    const { investigation } = await app.get(LedgerService).create({ mode: "DEMO", campaignId: demo, question: "q", source: "web", runtime: "deterministic" });
    const res = await http().post(`/api/investigations/${investigation.id}/cancel`).expect(200);
    expect(InvestigationListItemSchema.parse(res.body).status).toBe("CANCELLED");
    expect((await http().post(`/api/investigations/${investigation.id}/cancel`).expect(409)).body.code).toBe("ILLEGAL_TRANSITION");
    await http().post("/api/investigations/nope/cancel").expect(404);
  });

  it("interrupted recovery and retry: a linked new run completes", async () => {
    const ledger = app.get(LedgerService);
    const { investigation } = await ledger.create({ mode: "DEMO", campaignId: demo, question: "Why did the conversion rate change?", source: "web", runtime: "deterministic" });
    await ledger.transition(investigation.id, "QUEUED", "RUNNING");
    await prisma.investigation.update({ where: { id: investigation.id }, data: { lastActivityAt: new Date(Date.now() - 120_000) } });
    await app.get(Runner).recoverStale();
    const interrupted = InvestigationDetailSchema.parse((await http().get(`/api/investigations/${investigation.id}`).expect(200)).body);
    expect(interrupted).toMatchObject({ status: "INTERRUPTED", failureCode: "INTERRUPTED" });

    const retry = await http().post(`/api/investigations/${investigation.id}/retry`).expect(201);
    expect(retry.body).toMatchObject({ retryOfId: investigation.id, campaignId: demo });
    expect((await waitForTerminal(retry.body.id)).status).toBe("COMPLETED");
    const original = InvestigationDetailSchema.parse((await http().get(`/api/investigations/${investigation.id}`).expect(200)).body);
    expect(original.retryIds).toEqual([retry.body.id]);
    await http().post(`/api/investigations/${retry.body.id}/cancel`).expect(409);
  }, 60_000);

  it("lists newest first with a cursor, contract-cased", async () => {
    const page1 = InvestigationListResponseSchema.parse((await http().get("/api/investigations?limit=2").expect(200)).body);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.items[1]!.id);
    const page2 = InvestigationListResponseSchema.parse((await http().get(`/api/investigations?limit=2&cursor=${page1.nextCursor}`).expect(200)).body);
    expect(page2.items[0]!.createdAt <= page1.items[1]!.createdAt).toBe(true);
    const urls = InvestigationListResponseSchema.parse((await http().get("/api/investigations?mode=url&status=COMPLETED").expect(200)).body);
    expect(urls.items.every((i) => i.mode === "url" && i.status === "COMPLETED")).toBe(true);
    expect((await http().get("/api/investigations?limit=500").expect(400)).body.code).toBe("VALIDATION_ERROR");
    await http().get("/api/investigations/nope").expect(404);
  });

  it("throttles creations per IP (10 per minute)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await create({ mode: "demo", campaignId: demo, runtime: "deterministic" }).expect(201)).body.id);
    expect((await create({ mode: "demo", campaignId: demo, runtime: "deterministic" }).expect(429)).body.code).toBe("RATE_LIMITED");
    for (const id of ids) await waitForTerminal(id);
  }, 120_000);

  it("A10: a POST body must be application/json (415 otherwise), so a cross-site form cannot create runs", async () => {
    const before = await prisma.investigation.count();
    for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"]) {
      const res = await http().post("/api/investigations").set("Content-Type", type).send("mode=demo&campaignId=x").expect(415);
      expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
    await http().post("/api/investigations").send("mode=demo").expect(415); // a body with no content type
    expect(await prisma.investigation.count()).toBe(before);
    await create({ mode: "demo", campaignId: "no-such-campaign", runtime: "deterministic" }).expect(400); // JSON still reaches validation
    await http().post("/api/investigations/nope/cancel").expect(404); // body-less POST is fine
  });

  it("A5: retry is throttled like create (10 per minute) and honours Idempotency-Key", async () => {
    const ledger = app.get(LedgerService);
    const { investigation } = await ledger.create({ mode: "DEMO", campaignId: demo, question: "q", source: "web", runtime: "deterministic" });
    await ledger.transition(investigation.id, "QUEUED", "CANCELLED");
    const key = `retry-${Date.now()}`;
    const first = await http().post(`/api/investigations/${investigation.id}/retry`).set("Idempotency-Key", key).expect(201);
    const again = await http().post(`/api/investigations/${investigation.id}/retry`).set("Idempotency-Key", key).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.investigation.count({ where: { retryOfId: investigation.id } })).toBe(1);
    const ids = [first.body.id as string];
    for (let i = 1; i < 10; i++) ids.push((await http().post(`/api/investigations/${investigation.id}/retry`).expect(201)).body.id);
    expect((await http().post(`/api/investigations/${investigation.id}/retry`).expect(429)).body.code).toBe("RATE_LIMITED");
    expect((await create({ mode: "demo", campaignId: demo, runtime: "deterministic" }).expect(429)).body.code).toBe("RATE_LIMITED");
    for (const id of ids) await waitForTerminal(id);
  }, 120_000);

  it("health reports the runtimes; CORS allows only the web origin", async () => {
    const res = await http().get("/api/health").set("Origin", "http://localhost:3000").expect(200);
    const health = HealthResponseSchema.parse(res.body);
    expect(health.runtimes).toMatchObject({ deterministic: "available", ai: { provider: "anthropic", status: "missing_key" }, openclaw: "not_configured" });
    expect(["available", "unavailable"]).toContain(health.runtimes.browser);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });
});
