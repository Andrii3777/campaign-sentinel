import type { INestApplication } from "@nestjs/common";
import type { ToolResult } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "../../../test/boot";
import { startFixtureSite, type FixtureSite } from "../../../test/fixtures/sites/server";
import { PrismaService } from "../../db/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { ToolExecutor } from "../tool-executor";
import { HTTP_REQUEST_CAP } from "./url-tools";

let app: INestApplication;
let ledger: LedgerService;
let executor: ToolExecutor;
let prisma: PrismaService;
let site: FixtureSite;
const reason = "Inspect the landing page.";

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function urlRun(target: string): Promise<string> {
  const { investigation } = await ledger.create({
    mode: "URL",
    targetUrl: target.startsWith("/") ? site.origin + target : target,
    question: "Is the landing page healthy?",
    source: "api",
    runtime: "deterministic",
  });
  await ledger.transition(investigation.id, "QUEUED", "RUNNING");
  return investigation.id;
}
const run = async (id: string, tool: string, input: Record<string, unknown> = {}) => {
  const r = await executor.execute(id, { tool, input: { reason, ...input } });
  return r as ToolResult & { data: Data };
};
const guardrails = async (id: string) =>
  (await ledger.getEventsAfter(id, 0)).filter((e) => e.type === "guardrail.triggered").map((e) => e.payload as Data);

beforeAll(async () => {
  process.env.URL_FETCH_ALLOW_PRIVATE = "1";
  site = await startFixtureSite();
  app = await bootApp();
  ledger = app.get(LedgerService);
  executor = app.get(ToolExecutor);
  prisma = app.get(PrismaService);
}, 120_000);
afterAll(async () => {
  await app?.close();
  await site?.close();
});

describe("fetch_page", () => {
  it("/ok: status, timings, analysis, tracking and live-http evidence", async () => {
    const id = await urlRun("/ok");
    const r = await run(id, "fetch_page");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ status: 200, finalUrl: `${site.origin}/ok`, redirects: [] });
    expect(r.data.analysis.trackers.map((t: Data) => t.name)).toEqual(["GA4", "GTM"]);
    expect(r.data.analysis.forms).toHaveLength(1);
    expect(r.data.analysis.untrustedContent).toBeUndefined();
    expect(r.untrustedContent?.source).toBe(`page:${site.origin}/ok`);
    expect(r.evidence[0]!.statement).toMatch(/^GET .*\/ok returned 200 in \d+ ms \(TTFB \d+ ms\)/);
    expect(r.evidence.some((e) => /GA4 \(G-ABC123XYZ9\)/.test(e.statement))).toBe(true);
    const stored = await prisma.evidence.findMany({ where: { investigationId: id } });
    expect(stored.every((e) => e.provenance === "live-http")).toBe(true);
    expect((await prisma.investigation.findUniqueOrThrow({ where: { id } })).httpRequests).toBe(1);
  });

  it("/redirect-chain: records every hop", async () => {
    const r = await run(await urlRun("/redirect-chain"), "fetch_page");
    expect(r.ok && r.data.redirects.map((h: Data) => h.status)).toEqual([301, 302, 307]);
    expect(r.ok && r.evidence[0]!.statement).toMatch(/3 redirects/);
  });

  it("/error and /missing: HTTP errors are results with evidence", async () => {
    const r = await run(await urlRun("/error"), "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { status: 500 } });
    expect(r.ok && r.evidence[0]).toMatchObject({ strength: "indirect" });
  });

  it.each([
    ["/redirect-loop", "REDIRECT_LOOP"],
    ["/redirect-many/7", "TOO_MANY_REDIRECTS"],
    ["/huge", "BODY_TOO_LARGE"],
  ])("%s: fails as evidence with %s", async (path, code) => {
    const r = await run(await urlRun(path), "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { error: { code } } });
    expect(r.ok && r.evidence[0]!.statement).toContain(code);
  });

  it("/slow: times out after 8 s as a result", async () => {
    const r = await run(await urlRun("/slow?ms=12000"), "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { error: { code: "TIMEOUT" } } });
  }, 20_000);

  it("/download: non-HTML content is not analysed", async () => {
    const r = await run(await urlRun("/download"), "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { status: 200, contentType: "application/pdf", error: { code: "UNSUPPORTED_CONTENT_TYPE" } } });
  });

  it("/redirect-to-private: blocks the hop and emits ssrf_blocked", async () => {
    const id = await urlRun("/redirect-to-private");
    const r = await run(id, "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { error: { code: "BLOCKED_ADDRESS" } } });
    expect(await guardrails(id)).toEqual([
      {
        kind: "ssrf_blocked",
        details: expect.objectContaining({ tool: "fetch_page", url: "http://169.254.169.254/latest/meta-data/", code: "BLOCKED_ADDRESS" }),
      },
    ]);
    expect(site.requests.filter((r) => r.includes("meta-data"))).toEqual([]);
  });

  it("a private target is refused before any request", async () => {
    const id = await urlRun("http://10.0.0.7/");
    const r = await run(id, "fetch_page");
    expect(r).toMatchObject({ ok: true, data: { error: { code: "BLOCKED_ADDRESS" } } });
    expect((await guardrails(id))[0]).toMatchObject({ kind: "ssrf_blocked" });
    expect((await prisma.investigation.findUniqueOrThrow({ where: { id } })).httpRequests).toBe(0);
  });

  it("/injection: page text comes back as untrusted content and raises the guardrail", async () => {
    const id = await urlRun("/injection");
    const r = await run(id, "fetch_page");
    expect(r.ok && r.untrustedContent?.injectionSignals).toEqual(expect.arrayContaining(["ignore_instructions"]));
    expect((await guardrails(id)).map((g) => g.kind)).toEqual(["prompt_injection_suspected"]);
  });

  it("/no-tracking: no tags is evidence too", async () => {
    const r = await run(await urlRun("/no-tracking"), "fetch_page");
    expect(r.ok && r.data.analysis.trackers).toEqual([]);
    expect(r.ok && r.evidence.some((e) => /No known tracking tags/.test(e.statement))).toBe(true);
  });

  it("/noindex: robots directives become evidence", async () => {
    const r = await run(await urlRun("/noindex"), "fetch_page");
    expect(r.ok && r.data.analysis).toMatchObject({ indexable: false, xRobotsTag: "noindex", robotsMeta: "noindex, nofollow" });
    expect(r.ok && r.evidence.find((e) => /marked noindex/.test(e.statement))).toMatchObject({ strength: "indirect" });
  });

  it("only fetches the target or links seen on fetched pages", async () => {
    const id = await urlRun("/broken-links");
    expect(await run(id, "fetch_page", { url: `${site.origin}/missing` })).toMatchObject({
      ok: false,
      error: { code: "URL_NOT_ALLOWED" },
    });
    await run(id, "fetch_page");
    expect(await run(id, "fetch_page", { url: `${site.origin}/missing` })).toMatchObject({ ok: true, data: { status: 404 } });
  });

  it(`stops at the per-investigation cap of ${HTTP_REQUEST_CAP} requests`, async () => {
    const id = await urlRun("/ok");
    await ledger.incrementCounters(id, { httpRequests: HTTP_REQUEST_CAP });
    expect(await run(id, "fetch_page")).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
    expect((await guardrails(id))[0]).toMatchObject({ kind: "budget_limit", details: { budget: "httpRequests" } });
    expect((await prisma.investigation.findUniqueOrThrow({ where: { id } })).httpRequests).toBe(HTTP_REQUEST_CAP);
  });

  it("B5: the over-cap guardrail event is emitted once per investigation", async () => {
    const id = await urlRun("/ok");
    await ledger.incrementCounters(id, { httpRequests: HTTP_REQUEST_CAP });
    for (let i = 0; i < 3; i++) await run(id, "fetch_page");
    expect((await guardrails(id)).filter((g) => g.kind === "budget_limit")).toHaveLength(1);
  });
});

describe("check_links", () => {
  it("/broken-links: checks same-site links and form actions, HEAD then GET", async () => {
    const r = await run(await urlRun("/broken-links"), "check_links");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byPath = Object.fromEntries(r.data.links.map((l: Data) => [new URL(l.url).pathname, l.broken]));
    expect(byPath).toEqual({
      "/ok": false,
      "/missing": true,
      "/error": true,
      "/head-not-allowed": false,
      "/signup-gone": true,
      "/gone": true,
    });
    expect(r.data).toMatchObject({ checked: 6, broken: 4 });
    expect(r.evidence[0]!.statement).toMatch(/^Checked 6 same-site links: 4 broken/);
  });

  it("scope cta checks CTA links and form actions only, within the limit", async () => {
    const r = await run(await urlRun("/broken-links"), "check_links", { scope: "cta", limit: 1 });
    expect(r.ok && r.data.links.map((l: Data) => new URL(l.url).pathname)).toEqual(["/signup-gone"]);
  });
});

describe("measure_availability", () => {
  it("/error: repeated 5xx is direct evidence", async () => {
    const r = await run(await urlRun("/error"), "measure_availability", { attempts: 2 });
    expect(r).toMatchObject({ ok: true, data: { successRate: 0, attempts: [{ status: 500 }, { status: 500 }] } });
    expect(r.ok && r.evidence[0]).toMatchObject({ strength: "direct" });
    expect(r.ok && r.evidence[0]!.statement).toMatch(/0\/2 attempts succeeded/);
  });
});

describe("browser_check", () => {
  it("runs Chromium when installed, otherwise reports how to enable it", async () => {
    // /noindex has no sub-resources, so the browser never asks DNS for an internet host
    const r = await run(await urlRun("/noindex"), "browser_check");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.available) expect(r.data).toMatchObject({ ok: true, status: 200, title: "Hidden from search" });
    else expect(r.warnings?.join(" ")).toMatch(/playwright-core install/);
    expect(r.evidence[0]!.statement).toMatch(/^Browser check/);
  }, 40_000);
});
