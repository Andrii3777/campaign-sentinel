import type { ToolName } from "@campaign-sentinel/contracts";
import { analyzeHtml, cleanHeaders } from "../../web-inspection/html-analyzer";
import { measureAvailability } from "../../web-inspection/availability";
import { browserCheck } from "../../web-inspection/browser-check";
import { checkLinks } from "../../web-inspection/link-checker";
import { FETCH_TIMEOUT_MS, fetchPage, type FetchFailure, type FetchOptions, type FetchedPage } from "../../web-inspection/safe-fetcher";
import type { GuardOptions } from "../../web-inspection/url-guard";
import type { Investigation } from "../../ledger/ledger.service";
import { ToolFailure, type EvidenceDraft, type ToolContext, type ToolHandler, type ToolOutput } from "../tool.types";

/** Spec story 46: outbound HTTP requests per URL investigation (a browser session counts as one). */
export const HTTP_REQUEST_CAP = 25;

export interface UrlToolDeps {
  guard: GuardOptions;
  /** false when BROWSER_CHECKS=off */
  browserEnabled: boolean;
  /** Reserves one outbound request for the investigation; false when the cap is reached. */
  reserveRequest(investigationId: string): Promise<boolean>;
  /** Records a guard refusal (`guardrail.triggered: ssrf_blocked`). */
  reportBlocked(investigationId: string, details: { tool: ToolName; url: string; code: string }): Promise<void>;
  /** URLs of links and form actions seen on pages fetched earlier in the investigation. */
  seenUrls(investigationId: string): Promise<Set<string>>;
  /** test hook; spec: 1 s */
  availabilityDelayMs?: number;
}

const short = (url: string) => (url.length > 200 ? `${url.slice(0, 200)}…` : url);
const normalize = (url: string) => {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function targetOf(investigation: Investigation): string {
  if (!investigation.targetUrl) throw new ToolFailure("NO_TARGET_URL", "This investigation has no target URL.");
  return investigation.targetUrl;
}

/** Turns one fetch into a tool output: data, evidence statements built from numbers, and the page text as untrusted content. */
function fetchOutput(r: FetchedPage | FetchFailure): ToolOutput {
  if (!r.ok) {
    const redirectNote = r.redirects.length ? ` after ${plural(r.redirects.length, "redirect")}` : "";
    return {
      data: { url: r.url, failedUrl: r.failedUrl, redirects: r.redirects, timings: r.timings, error: { code: r.code, message: r.message } },
      evidence: [
        {
          kind: "http",
          strength: "indirect",
          statement: `GET ${short(r.url)} failed with ${r.code}${redirectNote} (${r.timings.totalMs} ms): ${r.message}`,
          data: { code: r.code, failedUrl: r.failedUrl, redirects: r.redirects.length, totalMs: r.timings.totalMs },
        },
      ],
    };
  }
  const { body, ...rawPage } = r;
  const page = { ...rawPage, headers: cleanHeaders(rawPage.headers) }; // response headers are attacker-controlled text
  const redirectNote = r.redirects.length ? `, ${plural(r.redirects.length, "redirect")} to ${short(r.finalUrl)}` : "";
  const evidence: EvidenceDraft[] = [
    {
      kind: "http",
      strength: r.status >= 400 ? "indirect" : "context",
      statement: `GET ${short(r.url)} returned ${r.status} in ${r.timings.totalMs} ms (TTFB ${r.timings.ttfbMs} ms), ${r.bytes} bytes${redirectNote}.`,
      data: { status: r.status, ttfbMs: r.timings.ttfbMs, totalMs: r.timings.totalMs, bytes: r.bytes, redirects: r.redirects.length },
    },
  ];
  if (body === null || r.contentType === "text/plain") {
    const error = body === null ? { code: "UNSUPPORTED_CONTENT_TYPE", message: `Content type "${r.contentType || "none"}" is not analysed.` } : undefined;
    return { data: { ...page, ...(error ? { error } : {}) }, evidence, ...(error ? { warnings: [error.message] } : {}) };
  }

  const { untrustedContent, ...analysis } = analyzeHtml(body, { url: r.finalUrl, headers: r.headers });
  const a = analysis;
  evidence.push({
    kind: "content",
    strength: "context",
    statement:
      `Page analysis: title ${a.title ? "present" : "missing"}, meta description ${a.metaDescription ? "present" : "missing"}, ` +
      `${plural(a.h1.length, "h1")}, ${a.wordCount} words, ${plural(a.forms.length, "form")}, ${plural(a.ctaCount, "CTA")}, ` +
      `${a.linkCounts.internal} internal / ${a.linkCounts.external} external links, viewport meta ${a.viewport ? "present" : "missing"}, ` +
      `lang ${a.lang ? "set" : "missing"}, HSTS ${a.security.hsts ? "yes" : "no"}, CSP ${a.security.csp ? "yes" : "no"}.`,
    data: { h1: a.h1.length, wordCount: a.wordCount, forms: a.forms.length, ctaCount: a.ctaCount, linkCounts: a.linkCounts, security: a.security },
  });
  evidence.push({
    kind: "tracking",
    strength: "context",
    statement: a.trackers.length
      ? `Tracking tags found in the HTML: ${a.trackers.map((t) => (t.ids.length ? `${t.name} (${t.ids.join(", ")})` : t.name)).join("; ")}.`
      : "No known tracking tags (GA4, GTM, Meta Pixel, TikTok, LinkedIn, Hotjar) found in the HTML.",
    data: { trackers: a.trackers },
  });
  if (!a.indexable)
    evidence.push({
      kind: "content",
      strength: "indirect",
      statement: `The page is marked noindex (robots meta: ${a.robotsMeta ?? "none"}; X-Robots-Tag: ${a.xRobotsTag ?? "none"}).`,
      data: { robotsMeta: a.robotsMeta, xRobotsTag: a.xRobotsTag },
    });
  if (a.mixedContent.length)
    evidence.push({
      kind: "content",
      strength: "indirect",
      statement: `${plural(a.mixedContent.length, "insecure http:// sub-resource")} on an https page (mixed content).`,
      data: { mixedContent: a.mixedContent.slice(0, 10) },
    });
  return { data: { ...page, analysis }, evidence, untrustedContent };
}

export function createUrlToolHandlers(deps: UrlToolDeps): ToolHandler[] {
  /** Fetch options for one tool call: guard, request cap, block reporting, executor abort signal. */
  const fetchOptions = (ctx: ToolContext): FetchOptions => ({
    ...deps.guard,
    signal: ctx.signal,
    beforeRequest: () => deps.reserveRequest(ctx.investigation.id),
  });
  const afterFetch = async (tool: ToolName, ctx: ToolContext, r: FetchedPage | FetchFailure) => {
    if (!r.ok && r.blocked) await deps.reportBlocked(ctx.investigation.id, { tool, url: r.failedUrl, code: r.code });
  };
  const capReached = () =>
    new ToolFailure("BUDGET_EXCEEDED", `The limit of ${HTTP_REQUEST_CAP} outbound HTTP requests for this investigation is used up.`);

  const fetchPageTool: ToolHandler<"fetch_page"> = {
    name: "fetch_page",
    timeoutMs: FETCH_TIMEOUT_MS + 2_000,
    async run(input, ctx) {
      const target = targetOf(ctx.investigation);
      const url = input.url ?? target;
      if (normalize(url) !== normalize(target) && !(await deps.seenUrls(ctx.investigation.id)).has(normalize(url))) {
        throw new ToolFailure(
          "URL_NOT_ALLOWED",
          "fetch_page only accepts the target URL or a link seen on a page already fetched in this investigation.",
        );
      }
      const r = await fetchPage(url, fetchOptions(ctx));
      if (!r.ok && r.code === "REQUEST_CAP_REACHED") throw capReached();
      await afterFetch("fetch_page", ctx, r);
      return fetchOutput(r);
    },
  };

  const measureAvailabilityTool: ToolHandler<"measure_availability"> = {
    name: "measure_availability",
    timeoutMs: 5 * FETCH_TIMEOUT_MS + 4 * 1_000 + 2_000,
    async run(input, ctx) {
      const target = targetOf(ctx.investigation);
      const r = await measureAvailability(target, input.attempts, { ...fetchOptions(ctx), delayMs: deps.availabilityDelayMs });
      const first = r.attempts[0]!;
      if (first.code === "REQUEST_CAP_REACHED") throw capReached();
      if (first.blocked) await deps.reportBlocked(ctx.investigation.id, { tool: "measure_availability", url: target, code: first.code! });
      const n = r.attempts.length;
      const failed = r.attempts.filter((a) => !a.ok).length;
      // spec story 44: a site problem is direct only when it repeats (e.g. 5xx in ≥ 2 of 3 attempts)
      const strength = (failed >= 2 && failed * 2 >= n) || (failed === 0 && n >= 3) ? "direct" : "indirect";
      const outcomes = r.attempts.map((a) => a.status ?? a.code).join(", ");
      return {
        data: r,
        evidence: [
          {
            kind: "availability",
            strength,
            statement:
              `${n - failed}/${n} attempts succeeded (${Math.round(r.successRate * 100)}%) for ${short(target)}; ` +
              `results ${outcomes}; time min/median/max ${r.timings.minMs}/${r.timings.medianMs}/${r.timings.maxMs} ms.`,
            data: { attempts: n, failed, successRate: r.successRate, timings: r.timings },
          },
        ],
        ...(n < input.attempts ? { warnings: [`Only ${n} of ${input.attempts} attempts were made (request limit or blocked URL).`] } : {}),
      };
    },
  };

  const checkLinksTool: ToolHandler<"check_links"> = {
    name: "check_links",
    timeoutMs: 3 * FETCH_TIMEOUT_MS + 2_000,
    async run(input, ctx) {
      const target = targetOf(ctx.investigation);
      const options = fetchOptions(ctx);
      const page = await fetchPage(target, options);
      if (!page.ok && page.code === "REQUEST_CAP_REACHED") throw capReached();
      await afterFetch("check_links", ctx, page);
      if (!page.ok || page.body === null) {
        const output = fetchOutput(page);
        return { ...output, warnings: ["The target page could not be fetched as HTML, so no links were checked."] };
      }
      const { links, forms } = analyzeHtml(page.body, { url: page.finalUrl, headers: page.headers });
      const site = new URL(page.finalUrl).hostname.replace(/^www\./, "");
      const actions = forms
        .map((f) => f.action)
        .filter((a): a is string => !!a && new URL(a).hostname.replace(/^www\./, "") === site);
      const candidates = [
        ...links.filter((l) => l.sameSite && (input.scope === "all" || l.cta)).map((l) => l.url),
        ...actions,
      ].filter((u) => normalize(u) !== normalize(page.finalUrl));
      const urls = [...new Set(candidates)].slice(0, input.limit);
      const results = await checkLinks(urls, options);
      for (const l of results) if (l.blocked) await deps.reportBlocked(ctx.investigation.id, { tool: "check_links", url: l.url, code: l.code! });
      const broken = results.filter((l) => l.broken);
      const capped = results.filter((l) => l.code === "REQUEST_CAP_REACHED").length;
      return {
        data: { page: page.finalUrl, scope: input.scope, checked: results.length, broken: broken.length, links: results },
        evidence: [
          {
            kind: "links",
            strength: "context",
            statement: `Checked ${plural(results.length, "same-site link")}: ${broken.length} broken${broken.length ? ` (${broken.map((l) => `${short(l.url)} → ${l.status ?? l.code}`).join("; ")})` : ""}.`,
            data: { checked: results.length, broken: broken.length },
          },
          ...broken.slice(0, 10).map(
            (l): EvidenceDraft => ({
              kind: "links",
              strength: l.status ? "direct" : "indirect",
              statement: `Link ${short(l.url)} is broken: ${l.method} returned ${l.status ?? l.code}.`,
              data: l,
            }),
          ),
        ],
        ...(capped ? { warnings: [`${plural(capped, "link")} not checked: the request limit was reached.`] } : {}),
      };
    },
  };

  const browserCheckTool: ToolHandler<"browser_check"> = {
    name: "browser_check",
    timeoutMs: 25_000,
    async run(_input, ctx) {
      const target = targetOf(ctx.investigation);
      if (deps.browserEnabled && !(await deps.reserveRequest(ctx.investigation.id))) throw capReached();
      const r = await browserCheck(target, { ...deps.guard, enabled: deps.browserEnabled, signal: ctx.signal });
      if (!r.available) {
        return {
          data: r,
          evidence: [{ kind: "browser", strength: "context", statement: `Browser check unavailable: ${r.reason}`, data: { available: false } }],
          warnings: [`Browser check unavailable. Report this as a limitation or unknown, never as a recommended action. Operator note (not for the report): ${r.operatorNote}`],
        };
      }
      for (const b of r.blockedRequests ?? []) await deps.reportBlocked(ctx.investigation.id, { tool: "browser_check", url: b.url, code: b.code });
      if (!r.ok && r.blocked) await deps.reportBlocked(ctx.investigation.id, { tool: "browser_check", url: target, code: r.code });
      const failed = r.failedRequests?.length ?? 0;
      const errors = r.consoleErrors?.length ?? 0;
      const hits = r.trackingHits ?? [];
      const statement = r.ok
        ? `Browser check: Chromium loaded ${short(target)} with status ${r.status ?? "unknown"}` +
          (r.timings ? `, DOMContentLoaded ${r.timings.domContentLoadedMs} ms, load ${r.timings.loadMs} ms` : "") +
          `; ${plural(errors, "console error")}, ${plural(failed, "failed request")}, ${plural(r.blockedRequests.length, "blocked request")}, ` +
          `tracking requests: ${hits.length ? [...new Set(hits.map((h) => h.name))].join(", ") : "none"}.`
        : `Browser check failed with ${r.code}: ${r.message}`;
      return {
        data: r,
        evidence: [
          { kind: "browser", strength: r.ok && errors === 0 && failed === 0 ? "context" : "indirect", statement, data: { ok: r.ok, errors, failed } },
        ],
      };
    },
  };

  return [fetchPageTool, measureAvailabilityTool, checkLinksTool, browserCheckTool] as ToolHandler[];
}
