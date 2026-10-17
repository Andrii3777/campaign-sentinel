import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureSite, type FixtureSite } from "../../test/fixtures/sites/server";
import { checkLinks } from "./link-checker";
import { measureAvailability } from "./availability";

let site: FixtureSite;
const opts = { allowLoopback: true };

beforeAll(async () => {
  process.env.URL_FETCH_ALLOW_PRIVATE = "1";
  site = await startFixtureSite();
});
afterAll(() => site?.close());

describe("checkLinks", () => {
  it("HEADs each link, falls back to GET on 405, and marks broken ones", async () => {
    const urls = ["/ok", "/missing", "/error", "/head-not-allowed"].map((p) => site.origin + p);
    urls.push("http://169.254.169.254/latest/meta-data/");
    const results = await checkLinks(urls, opts);
    expect(results.map((r) => [r.status ?? r.code, r.method, r.broken])).toEqual([
      [200, "HEAD", false],
      [404, "HEAD", true],
      [500, "HEAD", true],
      [200, "GET", false],
      ["BLOCKED_ADDRESS", "HEAD", true],
    ]);
    expect(results[4]).toMatchObject({ blocked: true });
    expect(site.requests).toContain("GET /head-not-allowed");
  });
});

describe("measureAvailability", () => {
  it("makes N GETs a fixed delay apart and summarises them", async () => {
    const before = Date.now();
    const r = await measureAvailability(`${site.origin}/ok`, 3, { ...opts, delayMs: 100 });
    expect(Date.now() - before).toBeGreaterThanOrEqual(200);
    expect(r.attempts.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(r.successRate).toBe(1);
    expect(r.timings.minMs).toBeLessThanOrEqual(r.timings.medianMs);
    expect(r.timings.medianMs).toBeLessThanOrEqual(r.timings.maxMs);
  });

  it("counts 5xx and failures as unsuccessful", async () => {
    const r = await measureAvailability(`${site.origin}/error`, 2, { ...opts, delayMs: 0 });
    expect(r).toMatchObject({ successRate: 0, attempts: [{ status: 500, ok: false }, { status: 500, ok: false }] });
    const t = await measureAvailability(`${site.origin}/slow?ms=1000`, 1, { ...opts, delayMs: 0, timeoutMs: 100 });
    expect(t.attempts[0]).toMatchObject({ ok: false, code: "TIMEOUT" });
  });
});
