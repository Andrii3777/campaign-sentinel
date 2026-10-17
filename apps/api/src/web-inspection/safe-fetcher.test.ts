import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureSite, type FixtureSite } from "../../test/fixtures/sites/server";
import { USER_AGENT, fetchPage, type FetchOptions } from "./safe-fetcher";

let site: FixtureSite;
const opts: FetchOptions = { allowLoopback: true };

beforeAll(async () => {
  process.env.URL_FETCH_ALLOW_PRIVATE = "1";
  site = await startFixtureSite();
});
afterAll(() => site?.close());

describe("fetchPage", () => {
  it("fetches an HTML page with status, timings, headers and body", async () => {
    const r = await fetchPage(`${site.origin}/ok`, opts);
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: `${site.origin}/ok`, redirects: [] });
    if (!r.ok) return;
    expect(r.body).toContain("GTM-K9F2Q7P");
    expect(r.bytes).toBe(Buffer.byteLength(r.body!));
    expect(r.headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(r.timings.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.ttfbMs);
  });

  it("sends the spec user agent and no cookies or auth, even after a Set-Cookie", async () => {
    const r = await fetchPage(`${site.origin}/set-cookie`, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sent = JSON.parse(r.body!) as Record<string, string>;
    expect(sent["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^CampaignSentinel\/1\.0 \(\+https:\/\/github\.com\/.+\/campaign-sentinel\)$/);
    expect(sent.cookie).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
  });

  it("follows a redirect chain manually and records every hop", async () => {
    const r = await fetchPage(`${site.origin}/redirect-chain`, opts);
    expect(r).toMatchObject({ ok: true, status: 200, finalUrl: `${site.origin}/ok` });
    if (r.ok) expect(r.redirects.map((h) => h.status)).toEqual([301, 302, 307]);
  });

  it("returns 4xx/5xx as results, not failures", async () => {
    expect(await fetchPage(`${site.origin}/error`, opts)).toMatchObject({ ok: true, status: 500 });
    expect(await fetchPage(`${site.origin}/missing`, opts)).toMatchObject({ ok: true, status: 404 });
  });

  it("detects a redirect loop", async () => {
    expect(await fetchPage(`${site.origin}/redirect-loop`, opts)).toMatchObject({ ok: false, code: "REDIRECT_LOOP" });
  });

  it("stops after 5 redirects", async () => {
    expect(await fetchPage(`${site.origin}/redirect-many/4`, opts)).toMatchObject({ ok: true, status: 200 });
    const r = await fetchPage(`${site.origin}/redirect-many/6`, opts);
    expect(r).toMatchObject({ ok: false, code: "TOO_MANY_REDIRECTS" });
    if (!r.ok) expect(r.redirects).toHaveLength(5);
  });

  it("re-validates every redirect hop and refuses one to the metadata address", async () => {
    const r = await fetchPage(`${site.origin}/redirect-to-private`, opts);
    expect(r).toMatchObject({ ok: false, code: "BLOCKED_ADDRESS", blocked: true, failedUrl: "http://169.254.169.254/latest/meta-data/" });
  });

  it("times out", async () => {
    const r = await fetchPage(`${site.origin}/slow?ms=2000`, { ...opts, timeoutMs: 200 });
    expect(r).toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("aborts a body over the cap", async () => {
    const before = Date.now();
    const r = await fetchPage(`${site.origin}/huge`, opts);
    expect(r).toMatchObject({ ok: false, code: "BODY_TOO_LARGE" });
    expect(Date.now() - before).toBeLessThan(5000);
  });

  it.each(["gzip", "deflate", "br"])("a %s body that stalls mid-stream ends as TIMEOUT within timeoutMs", async (enc) => {
    const before = Date.now();
    const r = await fetchPage(`${site.origin}/compressed-stall?enc=${enc}`, { ...opts, timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(Date.now() - before).toBeLessThan(1500);
  }, 5_000);

  it.each(["gzip", "deflate", "br"])("a %s body cut by a reset ends as CONNECTION_RESET", async (enc) => {
    const before = Date.now();
    const r = await fetchPage(`${site.origin}/compressed-reset?enc=${enc}`, { ...opts, timeoutMs: 2_000 });
    expect(r).toMatchObject({ ok: false, code: "CONNECTION_RESET" });
    expect(Date.now() - before).toBeLessThan(1500);
  }, 5_000);

  it("does not read or return non-HTML bodies", async () => {
    const r = await fetchPage(`${site.origin}/download`, opts);
    expect(r).toMatchObject({ ok: true, status: 200, contentType: "application/pdf", body: null });
  });

  it("reports a refused connection", async () => {
    const closed = await startFixtureSite();
    const origin = closed.origin;
    await closed.close();
    expect(await fetchPage(`${origin}/ok`, opts)).toMatchObject({ ok: false, code: "CONNECTION_REFUSED" });
  });

  it("pins the connection to the validated address (DNS rebinding)", async () => {
    const port = new URL(site.origin).port;
    const answers = [["127.0.0.1"], ["10.0.0.1"]];
    let calls = 0;
    const r = await fetchPage(`http://rebind.test:${port}/ok`, {
      ...opts,
      resolve: async () => answers[Math.min(calls++, 1)]!,
    });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(calls).toBe(1);
  });

  it("refuses the initial URL before any request when it is private", async () => {
    const seen = site.requests.length;
    const r = await fetchPage(`${site.origin}/ok`, {});
    expect(r).toMatchObject({ ok: false, blocked: true });
    expect(site.requests.length).toBe(seen);
  });

  it("asks beforeRequest for every hop and stops when it refuses", async () => {
    let allowed = 2;
    const r = await fetchPage(`${site.origin}/redirect-chain`, { ...opts, beforeRequest: async () => allowed-- > 0 });
    expect(r).toMatchObject({ ok: false, code: "REQUEST_CAP_REACHED" });
  });
});
