import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureSite, type FixtureSite } from "../../test/fixtures/sites/server";
import { browserCheck, createBrowserProbe, isBrowserInstalled } from "./browser-check";

let site: FixtureSite;
let hasBrowser = false;
// tracker scripts on the fixture pages point at the internet: the resolver refuses every name, so nothing leaves the machine
const offline = { allowLoopback: true, resolve: async () => Promise.reject(new Error("offline test")) };

beforeAll(async () => {
  process.env.URL_FETCH_ALLOW_PRIVATE = "1";
  site = await startFixtureSite();
  hasBrowser = await isBrowserInstalled();
}, 30_000);
afterAll(() => site?.close());

describe("B4: browser probe cache", () => {
  const fakeBrowser = { close: async () => {} } as never;
  it("re-probes a failure after 60 s and keeps a success", async () => {
    let clock = 1_000;
    const results = [new Error("no chromium"), fakeBrowser];
    let launches = 0;
    const probe = createBrowserProbe(async () => results[launches++]!, () => clock);
    expect(await probe()).toBe(false);
    clock += 59_000;
    expect(await probe()).toBe(false);
    expect(launches).toBe(1); // still cached
    clock += 2_000;
    expect(await probe()).toBe(true);
    expect(launches).toBe(2);
    clock += 3_600_000;
    expect(await probe()).toBe(true);
    expect(launches).toBe(2); // the positive result stays
  });
  it("never caches a rejected launch", async () => {
    let launches = 0;
    const probe = createBrowserProbe(async () => {
      if (launches++ === 0) throw new Error("boom");
      return { close: async () => {} } as never;
    });
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(true);
  });
});

describe("browserCheck", () => {
  it("returns unavailable with how to enable it when turned off or missing", async () => {
    expect(await browserCheck(`${site.origin}/ok`, { ...offline, enabled: false })).toMatchObject({
      available: false,
      operatorNote: expect.stringContaining("BROWSER_CHECKS"),
    });
    expect(await browserCheck(`${site.origin}/ok`, { ...offline, executablePath: "C:/nope/chrome.exe" })).toMatchObject({
      available: false,
      operatorNote: expect.stringContaining("playwright-core install"),
    });
  });

  it("refuses a private target before launching anything", async () => {
    expect(await browserCheck("http://169.254.169.254/", offline)).toMatchObject({
      available: true,
      ok: false,
      code: "BLOCKED_ADDRESS",
      blocked: true,
    });
  });

  describe("with Chromium installed (skipped otherwise)", () => {
    it("B5: aborting the signal closes the browser and ends the check early", async (ctx) => {
      if (!hasBrowser) ctx.skip();
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 700);
      const before = Date.now();
      const r = await browserCheck(`${site.origin}/compressed-stall?enc=gzip`, { ...offline, timeoutMs: 15_000, signal: abort.signal });
      expect(Date.now() - before).toBeLessThan(6_000);
      expect(r).toMatchObject({ available: true, ok: false, code: "ABORTED" });
    }, 20_000);

    it("renders the page, records tracking hits and routes every sub-request through the guard", async (ctx) => {
      if (!hasBrowser) ctx.skip();
      const r = await browserCheck(`${site.origin}/ok`, offline);
      expect(r).toMatchObject({ available: true, ok: true, status: 200, title: "Home Insurance Quotes in Minutes" });
      if (!("ok" in r) || !r.ok) return;
      expect(r.trackingHits).toEqual([expect.objectContaining({ name: "GA4", url: expect.stringContaining("googletagmanager.com") })]);
      // the tag request was stopped by the guard (the resolver refuses), never sent
      expect(r.failedRequests.map((f) => f.url)).toEqual([expect.stringContaining("googletagmanager.com")]);
      expect(r.timings!.loadMs).toBeGreaterThanOrEqual(r.timings!.domContentLoadedMs);
    }, 30_000);

    // browserCheck waits for every route handler before it returns, so a hung handler fails these by test timeout
    it("a compressed body that stalls ends as TIMEOUT within the budget", async (ctx) => {
      if (!hasBrowser) ctx.skip();
      const before = Date.now();
      const r = await browserCheck(`${site.origin}/compressed-stall?enc=gzip`, { ...offline, timeoutMs: 1_500 });
      expect(Date.now() - before).toBeLessThan(6_000);
      expect(r).toMatchObject({ available: true, ok: false, code: "TIMEOUT" });
      expect("failedRequests" in r && r.failedRequests).toEqual([
        { url: `${site.origin}/compressed-stall?enc=gzip`, reason: "TIMEOUT" },
      ]);
    }, 10_000);

    it("a compressed body cut by a reset ends as CONNECTION_RESET", async (ctx) => {
      if (!hasBrowser) ctx.skip();
      const r = await browserCheck(`${site.origin}/compressed-reset?enc=gzip`, { ...offline, timeoutMs: 5_000 });
      expect(r).toMatchObject({ available: true, ok: false, code: "NAVIGATION_FAILED" });
      expect("failedRequests" in r && r.failedRequests).toEqual([
        { url: `${site.origin}/compressed-reset?enc=gzip`, reason: "CONNECTION_RESET" },
      ]);
    }, 10_000);

    it("blocks a redirect to the metadata address inside the browser", async (ctx) => {
      if (!hasBrowser) ctx.skip();
      const r = await browserCheck(`${site.origin}/redirect-to-private`, offline);
      expect(r).toMatchObject({ available: true });
      expect("blockedRequests" in r && r.blockedRequests).toEqual([
        { url: "http://169.254.169.254/latest/meta-data/", code: "BLOCKED_ADDRESS" },
      ]);
    }, 30_000);
  });
});
