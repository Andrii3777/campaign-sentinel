import { URL_SCOPE_STATEMENT, type Severity, type ToolResult, type UrlCategory } from "@campaign-sentinel/contracts";
import { Notebook, dataOf, evidenceOf, refs, type Data, type Ev, type Policy } from "./policy-kit";

/** Fetch errors that are URL-guard refusals (the target or a redirect hop was not allowed), not site failures. */
const REFUSALS = new Set(["BLOCKED_ADDRESS", "PORT_NOT_ALLOWED", "UNSUPPORTED_SCHEME", "CREDENTIALS_IN_URL", "INVALID_URL", "URL_TOO_LONG"]);
const SLOW_TTFB_MS = 1_500;
const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

interface Flag {
  category: UrlCategory;
  severity: Severity;
  statement: string;
  action: string;
  evidence: (Ev | undefined)[];
  /** setup hygiene (no tag, no viewport, no HSTS, console noise): a recommendation, never a likely cause on its own */
  hygiene?: true;
}

/** URL-mode rule tree (spec §5.8): fetch → (failure → availability) → availability → links → browser if no tag → flags. */
export function* urlPolicy(): Policy {
  const n = new Notebook();
  const page = yield* n.call("fetch_page", {}, "Fetch the target page: status, timing, redirects and content.");
  const p = dataOf(page);
  const pageEvs = evidenceOf(page);
  const httpEv = pageEvs[0];
  const failed = !p || !!p.error || (typeof p.status === "number" && p.status >= 400);
  if (failed) {
    const availability = yield* n.call("measure_availability", { attempts: 3 }, "The page did not load; check whether it fails repeatedly.");
    return unavailable(n, page, availability);
  }
  const availability = yield* n.call("measure_availability", { attempts: 3 }, "Check that the page answers reliably.");
  const links = yield* n.call("check_links", { limit: 10, scope: "all" }, "Check that same-site links and form actions work.");
  const trackers: Data[] = p.analysis?.trackers ?? [];
  let browser: ToolResult | undefined;
  if (p.analysis && trackers.length === 0) {
    browser = yield* n.call("browser_check", {}, "No tracking tag in the HTML; render the page to see whether tags load dynamically.");
  }

  const a: Data = p.analysis ?? {};
  const av = dataOf(availability);
  const avEv = evidenceOf(availability)[0];
  const linkEvs = evidenceOf(links);
  const br = dataOf(browser);
  const brEv = evidenceOf(browser)[0];
  const contentEv = pageEvs.find((e) => e.statement.startsWith("Page analysis"));
  const trackingEv = pageEvs.find((e) => /tracking tags/i.test(e.statement));
  const https = String(p.finalUrl ?? "").startsWith("https:");
  const flags: Flag[] = [];
  const flag = (f: Flag) => flags.push(f);

  if (av && av.successRate < 1) {
    flag({ category: "site_availability", severity: av.successRate < 0.5 ? "critical" : "high", statement: `The page failed ${Math.round((1 - av.successRate) * 100)}% of repeated requests.`, action: "Find and fix the intermittent server errors.", evidence: [avEv] });
  }
  if (p.timings?.ttfbMs > SLOW_TTFB_MS) {
    flag({ category: "site_performance", severity: "medium", statement: `The server is slow: time to first byte ${p.timings.ttfbMs} ms (> ${SLOW_TTFB_MS} ms).`, action: "Reduce server response time (caching, CDN, backend latency).", evidence: [httpEv] });
  }
  if (dataOf(links)?.broken > 0) {
    flag({ category: "site_content", severity: "medium", statement: `${dataOf(links)!.broken} same-site link(s) or form action(s) are broken.`, action: "Fix or remove the broken links and form actions.", evidence: linkEvs });
  }
  if (a.indexable === false) {
    flag({ category: "seo_indexing", severity: "medium", statement: "The page is marked noindex.", action: "Remove noindex if the page should appear in search.", evidence: [pageEvs.find((e) => e.statement.includes("noindex"))] });
  }
  const dynamicTags = (br?.trackingHits ?? []).length > 0;
  if (p.analysis && trackers.length === 0 && !dynamicTags) {
    flag({ category: "tracking_setup", severity: "medium", statement: `No known tracking tag was found${br?.available ? " in the HTML or the rendered page" : " in the HTML"}.`, action: "Install or fix the analytics and conversion tags.", evidence: [trackingEv, br?.available ? brEv : undefined], hygiene: true });
  }
  if (br?.available && (br.consoleErrors?.length ?? 0) > 0) {
    flag({ category: "site_content", severity: "low", statement: `The rendered page logs ${br.consoleErrors.length} console error(s).`, action: "Fix the JavaScript errors shown in the console.", evidence: [brEv], hygiene: true });
  }
  if (p.analysis && !a.viewport) {
    flag({ category: "site_content", severity: "low", statement: "The page has no viewport meta tag, so it may render badly on mobile.", action: "Add a responsive viewport meta tag.", evidence: [contentEv], hygiene: true });
  }
  if ((a.mixedContent ?? []).length > 0) {
    flag({ category: "security_headers", severity: "low", statement: "The https page loads insecure http:// resources (mixed content).", action: "Serve every resource over https.", evidence: [pageEvs.find((e) => e.statement.includes("mixed content"))] });
  }
  if (https && a.security && !a.security.hsts) {
    flag({ category: "security_headers", severity: "low", statement: "The site sends no HSTS header.", action: "Send Strict-Transport-Security.", evidence: [contentEv], hygiene: true });
  }

  const limitations = [URL_SCOPE_STATEMENT];
  if (browser && !br?.available) limitations.push("The browser check was unavailable, so tags loaded by JavaScript could not be detected.");
  const observations = [httpEv, contentEv, trackingEv, avEv, linkEvs[0], brEv]
    .filter((e): e is Ev => !!e)
    .map((e) => ({ statement: e.statement, evidenceIds: [e.ref] }));

  if (flags.length === 0) {
    return n.finish({
      summary: `The page answered ${p.status} in ${p.timings?.totalMs} ms, loaded reliably on repeated requests, its links work and tracking tags are present. Nothing in what the URL publicly serves points to a problem.`,
      verdict: "no_issue_found",
      severity: "none",
      severityRationale: "No availability, speed, content, indexing, tracking or security-header problem was found.",
      whatChanged: `Nothing abnormal was observed${refs(httpEv, avEv).length ? ` [${refs(httpEv, avEv).join(", ")}]` : ""}.`,
      observations,
      hypotheses: [{ id: "H1", category: "other", statement: "A problem outside what a URL can reveal (analytics, conversions, the ad platform) cannot be ruled out.", status: "plausible", confidence: "low", confidenceRationale: "Every check on the public page passed, but a URL does not show conversions or analytics.", supportingEvidenceIds: [], contradictingEvidenceIds: refs(httpEv, avEv) }],
      unknowns: [],
      recommendedActions: [{ action: "Check conversions and analytics in the ad and analytics platforms; a URL cannot show them.", priority: "later", rationale: "Out of scope for a URL check.", hypothesisIds: ["H1"] }],
      limitations,
    });
  }

  // evidenced defects first, hygiene after; each group by severity
  flags.sort((x, y) => Number(!!x.hygiene) - Number(!!y.hygiene) || RANK[y.severity] - RANK[x.severity]);
  const ranked = flags.slice(0, 8);
  const top = flags[0]!;
  const hypotheses = ranked.map((f, i) => ({
    id: `H${i + 1}`,
    category: f.category,
    statement: f.statement,
    status: "supported" as const,
    confidence: "medium" as const,
    confidenceRationale: "Measured directly on the live page; impact on conversions cannot be seen from a URL.",
    supportingEvidenceIds: refs(...f.evidence),
    contradictingEvidenceIds: [],
  }));
  const recommendedActions = ranked.map((f, i) => ({
    action: f.action,
    priority: !f.hygiene && RANK[f.severity] >= 2 ? ("now" as const) : ("later" as const),
    rationale: f.statement,
    hypothesisIds: [`H${i + 1}`],
  }));

  if (top.hygiene) {
    // no evidenced defect: the page works; the setup items are recommendations (verdict no_issue_found, severity low)
    return n.finish({
      summary: `The page answered ${p.status} in ${p.timings?.totalMs} ms and nothing on it is broken. ${flags.length} setup item(s) are worth tidying: ${flags.slice(0, 3).map((f) => f.statement).join(" ")}`.trim(),
      verdict: "no_issue_found",
      severity: "low",
      severityRationale: "No availability, speed, link, indexing or mixed-content defect was found; only low-impact setup items.",
      whatChanged: `No defect was observed${refs(httpEv, avEv).length ? ` [${refs(httpEv, avEv).join(", ")}]` : ""}; ${flags.length} setup item(s) are listed as recommendations.`,
      observations,
      hypotheses,
      unknowns: [],
      recommendedActions,
      limitations,
    });
  }

  return n.finish({
    summary: `The page answered ${p.status} in ${p.timings?.totalMs} ms. ${flags.length} problem(s) were found; the most important: ${top.statement} ${flags.length > 1 ? `Also: ${flags.slice(1, 4).map((f) => f.statement).join(" ")}` : ""}`.trim(),
    verdict: "likely_cause",
    severity: top.severity,
    severityRationale: `The most severe finding is a ${top.category.replace(/_/g, " ")} problem.`,
    whatChanged: `${top.statement}${refs(...top.evidence).length ? ` [${refs(...top.evidence).join(", ")}]` : ""}`,
    observations,
    hypotheses,
    unknowns: [],
    recommendedActions,
    limitations,
  });
}

function unavailable(n: Notebook, page: ToolResult, availability: ToolResult) {
  const p = dataOf(page);
  const httpEv = evidenceOf(page)[0];
  const av = dataOf(availability);
  const avEv = evidenceOf(availability)[0];
  const code: string | undefined = p?.error?.code;
  if (code && REFUSALS.has(code)) {
    return n.finish({
      summary: `The page could not be inspected: the request was refused by the URL guard (${code}) after ${p?.redirects?.length ?? 0} redirect(s), because it leads to an address that may not be fetched (private, internal or otherwise disallowed). Nothing behind that hop was checked.`,
      verdict: "inconclusive",
      severity: "low",
      severityRationale: "Nothing could be measured beyond the blocked hop.",
      whatChanged: `The fetch was refused${httpEv ? ` [${httpEv.ref}]` : ""}.`,
      observations: [httpEv, avEv].filter((e): e is Ev => !!e).map((e) => ({ statement: e.statement, evidenceIds: [e.ref] })),
      hypotheses: [{ id: "H1", category: "other", statement: "The page redirects to an address that is not publicly reachable.", status: "plausible", confidence: "low", confidenceRationale: "Only the refused hop is known.", supportingEvidenceIds: refs(httpEv), contradictingEvidenceIds: [] }],
      unknowns: [{ question: "Where should this URL send visitors?", whyItMatters: "A redirect to a private address would break the page for every visitor.", howToResolve: "Check the redirect configuration of the site." }],
      recommendedActions: [{ action: "Check the redirect target of this URL.", priority: "now", rationale: "It points to a blocked address.", hypothesisIds: ["H1"] }],
      limitations: [URL_SCOPE_STATEMENT, `The request was blocked (${code}); the content behind that hop was not fetched.`],
    });
  }
  const failedAttempts = av ? av.attempts.filter((x: Data) => !x.ok).length : 0;
  const high = avEv?.strength === "direct" && failedAttempts >= 2;
  const what = p?.status ? `status ${p.status}` : (code ?? "an error");
  return n.finish({
    summary: `The page did not load: it answered with ${what}${av ? `, and ${failedAttempts} of ${av.attempts.length} repeated requests failed (success rate ${Math.round(av.successRate * 100)}%)` : ""}. Visitors sent to this URL cannot see the page.`,
    verdict: "likely_cause",
    severity: av && av.successRate < 0.5 ? "critical" : "high",
    severityRationale: av && av.successRate < 0.5 ? "The page is unavailable to most visitors." : "The page failed to load.",
    whatChanged: `The page answered with ${what}${httpEv ? ` [${httpEv.ref}]` : ""}${avEv ? ` and failed repeated requests [${avEv.ref}]` : ""}.`,
    observations: [httpEv, avEv].filter((e): e is Ev => !!e).map((e) => ({ statement: e.statement, evidenceIds: [e.ref] })),
    hypotheses: [
      {
        id: "H1",
        category: "site_availability",
        statement: `The site fails to serve the page (${what}).`,
        status: "supported",
        confidence: high ? "high" : "medium",
        confidenceRationale: high ? "The first fetch and repeated attempts failed." : "The failure was not confirmed by repeated attempts.",
        supportingEvidenceIds: refs(httpEv, avEv),
        contradictingEvidenceIds: [],
      },
    ],
    unknowns: [],
    recommendedActions: [
      { action: "Fix the server error and confirm the page loads.", priority: "now", rationale: "Paid traffic lands on a broken page.", hypothesisIds: ["H1"] },
      { action: "Pause ads that point to this URL until it loads.", priority: "now", rationale: "Clicks to a broken page are wasted.", hypothesisIds: ["H1"] },
      { action: "Add uptime monitoring with alerts for this URL.", priority: "next", rationale: "Catches the next outage early.", hypothesisIds: ["H1"] },
    ],
    limitations: [URL_SCOPE_STATEMENT],
  });
}
