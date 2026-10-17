import type { Browser, Route } from "playwright-core";
import { sanitizeUntrustedText } from "../tools/untrusted-content";
import { FetchError, MAX_BODY_BYTES, MAX_REDIRECTS, USER_AGENT, pinnedRequest, readCapped } from "./safe-fetcher";
import { validateTargetUrl, type GuardOptions, type UrlCheck } from "./url-guard";

export const BROWSER_TIMEOUT_MS = 20_000;
/** sub-requests one browser session may make; the session itself counts as one request against the investigation cap */
export const MAX_BROWSER_SUBREQUESTS = 60;
/** Operator note, not for the report: how to turn browser checks on. */
export const BROWSER_HOW_TO_ENABLE =
  "Install Chromium for playwright-core with `pnpm --filter @campaign-sentinel/api exec playwright-core install chromium-headless-shell` and keep BROWSER_CHECKS=auto (BROWSER_CHECKS=off turns browser checks off).";

const TRACKER_HOSTS: [name: string, pattern: RegExp][] = [
  ["GA4", /(^|\.)google-analytics\.com$|(^|\.)googletagmanager\.com$/],
  ["Meta Pixel", /(^|\.)facebook\.(net|com)$/],
  ["TikTok Pixel", /(^|\.)tiktok\.com$/],
  ["LinkedIn Insight", /(^|\.)licdn\.com$|^px\.ads\.linkedin\.com$/],
  ["Hotjar", /(^|\.)hotjar\.(com|io)$/],
];
// response headers the browser must not get: cookies (no state), encodings (the body is already decoded)
const DROP_RESPONSE = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"]);
const DROP_REQUEST = new Set(["cookie", "authorization", "proxy-authorization", "host", "accept-encoding", "user-agent"]);

export interface BrowserCheckOptions extends GuardOptions {
  /** false when BROWSER_CHECKS=off */
  enabled?: boolean;
  timeoutMs?: number;
  /** aborting it ends the check and closes the browser */
  signal?: AbortSignal;
  /** test hook: a Chromium binary to use instead of the installed one */
  executablePath?: string;
}

interface Session {
  blockedRequests: { url: string; code: string }[];
  failedRequests: { url: string; reason: string }[];
  trackingHits: { name: string; url: string }[];
  consoleErrors: string[];
  requestCount: number;
}

export type BrowserCheckResult =
  | { available: false; reason: string; operatorNote: string }
  | ({ available: true; ok: false; url: string; code: string; message: string; blocked: boolean } & Partial<Session>)
  | ({
      available: true;
      ok: true;
      url: string;
      finalUrl: string;
      status: number | null;
      title: string | null;
      timings: { domContentLoadedMs: number; loadMs: number } | null;
    } & Session);

async function launch(executablePath?: string): Promise<Browser | Error> {
  try {
    const { chromium } = await import("playwright-core");
    return await chromium.launch({
      headless: true,
      executablePath,
      // a dead proxy: anything that escaped request routing fails instead of reaching the network
      proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
      args: ["--dns-prefetch-disable", "--disable-background-networking", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const NEGATIVE_TTL_MS = 60_000;

/** A probe whether Chromium can start: a success is kept, a failure is re-probed after 60 s, a throw is never cached. */
export function createBrowserProbe(launcher: () => Promise<Browser | Error> = launch, now: () => number = Date.now): () => Promise<boolean> {
  let ok: boolean | undefined;
  let failedAt = 0;
  let pending: Promise<boolean> | undefined;
  return () => {
    if (ok === true) return Promise.resolve(true);
    if (ok === false && now() - failedAt < NEGATIVE_TTL_MS) return Promise.resolve(false);
    pending ??= launcher()
      .then(async (b) => (b instanceof Error ? false : (await b.close().catch(() => {}), true)))
      .catch(() => undefined)
      .then((result) => {
        pending = undefined;
        if (result === undefined) return false; // launcher threw: answer false, remember nothing
        ok = result;
        failedAt = now();
        return result;
      });
    return pending;
  };
}
/** Whether Chromium for playwright-core can be launched on this machine. */
export const isBrowserInstalled = createBrowserProbe();

/**
 * Optional browser check (spec story 42, §7.3). Chromium never touches the network itself: every request is
 * intercepted, validated by the URL guard and performed by a pinned request, then fulfilled. Redirects come
 * back to the browser as 3xx and are routed (and validated) again. No downloads, no cookies, 20 s budget.
 */
export async function browserCheck(url: string, options: BrowserCheckOptions = {}): Promise<BrowserCheckResult> {
  if (options.enabled === false)
    return { available: false, reason: "Browser checks are turned off (BROWSER_CHECKS=off).", operatorNote: BROWSER_HOW_TO_ENABLE };
  const target = await validateTargetUrl(url, options);
  if (!target.ok) return { available: true, ok: false, url, code: target.code, message: target.message, blocked: target.blocked };

  if (options.signal?.aborted) return { available: true, ok: false, url, code: "ABORTED", message: "The browser check was cancelled.", blocked: false };
  const browser = await launch(options.executablePath);
  if (browser instanceof Error)
    return { available: false, reason: "Chromium for playwright-core is not installed or cannot start.", operatorNote: BROWSER_HOW_TO_ENABLE };

  const timeoutMs = options.timeoutMs ?? BROWSER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) onAbort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const s: Session = { blockedRequests: [], failedRequests: [], trackingHits: [], consoleErrors: [], requestCount: 0 };
  const checks = new Map<string, Promise<UrlCheck>>();
  const blockedUrls = new Set<string>();
  // every route handler still running; browserCheck does not return before they have all ended
  const inflight = new Set<Promise<unknown>>();

  /** Guard decision for one URL; one per origin and session, so DNS is asked once and the answer pinned. */
  const guard = async (u: string): Promise<UrlCheck> => {
    let key = u;
    try {
      key = new URL(u).origin;
    } catch {
      // unparsable: the guard refuses it
    }
    if (!checks.has(key)) checks.set(key, validateTargetUrl(u, { ...options, signal: controller.signal }));
    const check = await checks.get(key)!;
    // the cached decision is per origin; the URL itself (path, query) is the one requested
    return check.ok ? { ...check, url: new URL(u) } : check;
  };

  // Playwright does not route redirect hops, so redirects are followed here, each hop guarded.
  // shortcut: the page keeps the first URL as its base after a cross-host redirect; fine for one-page checks
  const handle = async (route: Route) => {
    const request = route.request();
    let current = request.url();
    let method = request.method();
    let body = request.postDataBuffer();
    const headers = Object.fromEntries(
      Object.entries(await request.allHeaders()).filter(([k]) => !DROP_REQUEST.has(k.toLowerCase()) && !k.startsWith(":")),
    );
    try {
      for (let hop = 0; ; hop++) {
        const tracker = TRACKER_HOSTS.find(([, p]) => p.test(URL.canParse(current) ? new URL(current).hostname : ""));
        if (tracker) s.trackingHits.push({ name: tracker[0], url: current.slice(0, 300) });
        if (++s.requestCount > MAX_BROWSER_SUBREQUESTS || hop > MAX_REDIRECTS) throw new FetchError("REQUEST_CAP_REACHED", "too many requests");
        const check = await guard(current);
        if (!check.ok) {
          if (check.blocked) s.blockedRequests.push({ url: current.slice(0, 300), code: check.code });
          else s.failedRequests.push({ url: current.slice(0, 300), reason: check.code });
          blockedUrls.add(request.url());
          return await route.abort("blockedbyclient");
        }
        const res = await pinnedRequest(check.url, check.address, { method, headers, body }, controller.signal);
        const status = res.statusCode ?? 502;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && URL.canParse(location, current)) {
          res.destroy();
          current = new URL(location, current).href;
          if (status !== 307 && status !== 308) [method, body] = ["GET", null];
          continue;
        }
        const payload = method === "HEAD" ? Buffer.alloc(0) : await readCapped(res, MAX_BODY_BYTES, controller.signal);
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers))
          if (v !== undefined && !DROP_RESPONSE.has(k)) resHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
        return await route.fulfill({ status, headers: resHeaders, body: payload });
      }
    } catch (error) {
      const reason = controller.signal.aborted ? "TIMEOUT" : error instanceof FetchError ? error.code : "NETWORK_ERROR";
      s.failedRequests.push({ url: current.slice(0, 300), reason });
      blockedUrls.add(request.url());
      await route.abort("failed").catch(() => {});
    }
  };

  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", userAgent: USER_AGENT });
    await context.route("**/*", (route) => {
      const p = handle(route);
      inflight.add(p);
      return p.finally(() => inflight.delete(p));
    });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && s.consoleErrors.length < 20) s.consoleErrors.push(sanitizeUntrustedText(m.text()).slice(0, 300));
    });
    page.on("pageerror", (e) => {
      if (s.consoleErrors.length < 20) s.consoleErrors.push(sanitizeUntrustedText(e.message).slice(0, 300));
    });
    page.on("requestfailed", (r) => {
      if (!blockedUrls.has(r.url())) s.failedRequests.push({ url: r.url().slice(0, 300), reason: r.failure()?.errorText ?? "failed" });
    });

    let response;
    try {
      response = await page.goto(target.url.href, { waitUntil: "load", timeout: timeoutMs });
    } catch (error) {
      if (options.signal?.aborted) {
        return { available: true, ok: false, url, code: "ABORTED", message: "The browser check was cancelled.", blocked: false, ...s };
      }
      const timedOut = controller.signal.aborted || /timeout/i.test(String((error as Error)?.message));
      return {
        available: true,
        ok: false,
        url,
        code: timedOut ? "TIMEOUT" : "NAVIGATION_FAILED",
        message: timedOut ? `The page did not load within ${timeoutMs} ms.` : "The browser could not load the page.",
        blocked: false,
        ...s,
      };
    }
    const timings = await page.evaluate(() => {
      // runs in the page; typed loosely because the API is compiled without DOM types
      const perf = performance as unknown as { getEntriesByType(t: string): { domContentLoadedEventEnd: number; loadEventEnd: number }[] };
      const n = perf.getEntriesByType("navigation")[0];
      return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : null;
    });
    return {
      available: true,
      ok: true,
      url,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      title: sanitizeUntrustedText(await page.title()).slice(0, 200) || null,
      timings,
      ...s,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    controller.abort(); // ends any body still being read, so the handlers below settle
    await browser.close().catch(() => {});
    await Promise.allSettled([...inflight]);
  }
}
