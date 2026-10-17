import type { Category, InvestigationReport, ToolResult } from "@campaign-sentinel/contracts";
import { formatPValue } from "../analysis";
import { Notebook, cite, dataOf, evidenceOf, pct, refs, relPct, severityOf, stamp, type Data, type Ev, type Policy } from "./policy-kit";

/**
 * Demo-mode rule tree (spec §5.8). Generic: it reads only tool results — never the scenario catalogue,
 * the campaign id's meaning or untrusted text (change-log entries are used by category and time only).
 */
export function* demoPolicy(): Policy {
  const n = new Notebook();
  const overview = yield* n.call("get_campaign_overview", {}, "Get the campaign, its periods and headline KPIs.");
  const cmp = yield* n.call("compare_periods", {}, "Measure the conversion-rate change and test whether it is significant.");
  const c = dataOf(cmp);
  if (!c) return noComparison(n, overview);
  const facts: Facts = { n, c, cmp: evidenceOf(cmp)[0]!, rel: c.relativeChange ?? null };

  const trend = yield* n.call("get_daily_trend", { metric: "conversion_rate" }, "Find the day the conversion rate changed.");
  facts.trend = evidenceOf(trend)[0];
  facts.changeDate = dataOf(trend)?.changePoint?.date ?? dataOf(trend)?.bestSplit?.date ?? null;

  if (!c.isSignificant) {
    const tracking = yield* n.call("inspect_tracking_health", {}, "Check tracking health before calling the change noise.");
    return insufficient(facts, tracking);
  }

  const bySource = yield* n.call("breakdown_by_segment", { dimension: "source" }, "Check whether one traffic source explains the change.");
  if (explains(bySource)) {
    const log = yield* n.call("get_change_log", {}, "Look for recorded changes around the change point.");
    return trafficSource(facts, bySource, log);
  }
  const byDevice = yield* n.call("breakdown_by_segment", { dimension: "device" }, "Check whether one device explains the change.");
  if (explains(byDevice)) {
    const page = yield* n.call("check_landing_page", {}, "Check landing-page errors and speed for the affected device.");
    const tracking = yield* n.call("inspect_tracking_health", {}, "Confirm whether the loss is real (backend-confirmed) or a tracking artefact.");
    const log = yield* n.call("get_change_log", {}, "Look for releases around the change point.");
    return landingPage(facts, byDevice, page, tracking, log);
  }
  const tracking = yield* n.call("inspect_tracking_health", {}, "The drop is uniform across sources and devices; check tracking health.");
  if (pixelLost(tracking)) {
    const log = yield* n.call("get_change_log", {}, "Look for the change that broke tracking.");
    return trackingLoss(facts, tracking, bySource, byDevice, log);
  }
  const page = yield* n.call("check_landing_page", {}, "Check the landing page before attributing the drop to a recorded change.");
  const log = yield* n.call("get_change_log", {}, "Look for a recorded change aligned with the change point.");
  return alignedChange(facts, tracking, bySource, byDevice, page, log);
}

interface Facts {
  n: Notebook;
  c: Data;
  cmp: Ev;
  rel: number | null;
  trend?: Ev;
  changeDate?: string | null;
}

/** A segment explains the change: the tool marks it direct (≥ 60% of ΔCR and well above its traffic share). */
const explains = (r: ToolResult) => evidenceOf(r)[0]?.strength === "direct";
const ratioPerDay = (count: number, p: { start: string; end: string }) =>
  count / ((Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 + 1);

/** Backend-confirmed conversions per day, current vs baseline (null without tracking data). */
function backendChange(tracking: ToolResult): number | null {
  const d = dataOf(tracking);
  if (!d) return null;
  const b = ratioPerDay(d.reconciliation.baseline.backend, d.periods.baseline);
  const c = ratioPerDay(d.reconciliation.current.backend, d.periods.current);
  return b > 0 ? (c - b) / b : null;
}

/** The pixel's share of backend conversions fell by ≥ 30% while backend conversions stayed stable (±15%). */
function pixelLost(tracking: ToolResult): boolean {
  const d = dataOf(tracking);
  const before = d?.reconciliation?.baseline?.ratio;
  const after = d?.reconciliation?.current?.ratio;
  const backend = backendChange(tracking);
  return before != null && after != null && after <= before * 0.7 && backend !== null && Math.abs(backend) <= 0.15;
}

/** The change-log entry at or up to two days before the change point (latest wins), with its evidence. */
function alignedEntry(log: ToolResult, changeDate: string | null | undefined): { entry: Data; ev: Ev } | null {
  const entries: Data[] = dataOf(log)?.entries ?? [];
  if (!changeDate) return null;
  const earliest = new Date(Date.parse(changeDate) - 2 * 86_400_000).toISOString().slice(0, 10);
  const i = entries.findLastIndex((e) => e.at.slice(0, 10) <= changeDate && e.at.slice(0, 10) >= earliest);
  return i >= 0 ? { entry: entries[i]!, ev: evidenceOf(log)[i]! } : null;
}

const changeText = (a: { entry: Data } | null) => (a ? `the ${a.entry.category} change recorded at ${stamp(a.entry.at)} (change #${a.entry.id})` : "");
const periodsText = (c: Data) => `${c.baseline.period.start}…${c.baseline.period.end} vs ${c.current.period.start}…${c.current.period.end}`;
const crText = (f: Facts) => `tracked conversion rate went from ${pct(f.c.baseline.conversionRate)} to ${pct(f.c.current.conversionRate)} (${relPct(f.rel)})`;

function baseObservations(f: Facts) {
  return [
    { statement: `Between ${periodsText(f.c)} the ${crText(f)}; the change is ${f.c.isSignificant ? "" : "not "}statistically significant (${formatPValue(f.c.zTest.pValue)}).`, evidenceIds: refs(f.cmp) },
    ...(f.trend ? [{ statement: f.trend.statement, evidenceIds: refs(f.trend) }] : []),
  ];
}

function ruledOut(id: string, category: Category, statement: string, against: (Ev | undefined)[]) {
  const ids = refs(...against);
  return ids.length
    ? [{ id, category, statement, status: "ruled_out" as const, confidence: "medium" as const, confidenceRationale: "The cited evidence contradicts it.", supportingEvidenceIds: [], contradictingEvidenceIds: ids }]
    : [];
}

function noComparison(n: Notebook, overview: ToolResult): InvestigationReport {
  const ev = evidenceOf(overview)[0];
  return n.finish({
    summary: "The period comparison could not be computed, so whether the conversion rate really changed is unknown. Only headline KPIs were collected; no cause can be named.",
    verdict: "inconclusive",
    severity: "low",
    severityRationale: "Without a comparison the size and significance of the change are unknown.",
    whatChanged: `Only headline KPIs are available${cite(ev)}.`,
    observations: ev ? [{ statement: ev.statement, evidenceIds: [ev.ref] }] : [],
    hypotheses: [{ id: "H1", category: "data_quality", statement: "The data needed for the comparison is unavailable.", status: "plausible", confidence: "low", confidenceRationale: "The comparison tool did not return a result.", supportingEvidenceIds: refs(ev), contradictingEvidenceIds: [] }],
    unknowns: [],
    recommendedActions: [{ action: "Rerun the investigation once the comparison data is available.", priority: "next", rationale: "A conclusion needs the period comparison.", hypothesisIds: ["H1"] }],
    limitations: [],
  });
}

function insufficient(f: Facts, tracking: ToolResult): InvestigationReport {
  const dq = f.n.dataQuality();
  const missing: string[] = f.c.missingDates ?? [];
  const required = f.c.requiredSessionsPerPeriod;
  const trackingEv = evidenceOf(tracking)[0];
  return f.n.finish({
    summary: `The ${crText(f)} between ${periodsText(f.c)}, but with only ${f.c.baseline.conversions} and ${f.c.current.conversions} conversions the difference is not statistically significant (${formatPValue(f.c.zTest.pValue)})${missing.length ? ` and ${missing.length} day(s) of data are missing` : ""}. The change cannot be told apart from noise yet.`,
    verdict: "inconclusive",
    severity: "low",
    severityRationale: "The change is not significant; acting on it now would be acting on noise.",
    whatChanged: `CR ${pct(f.c.baseline.conversionRate)} → ${pct(f.c.current.conversionRate)}, not significant${cite(f.cmp, ...dq)}.`,
    observations: [...baseObservations(f), ...dq.map((e) => ({ statement: e.statement, evidenceIds: [e.ref] })), ...(trackingEv ? [{ statement: trackingEv.statement, evidenceIds: [trackingEv.ref] }] : [])],
    hypotheses: [
      { id: "H1", category: "data_quality", statement: "The sample is too small (and incomplete) to show whether the conversion rate really changed.", status: "plausible", confidence: "low", confidenceRationale: "Low sample and missing days; the test is not significant.", supportingEvidenceIds: refs(f.cmp, ...dq), contradictingEvidenceIds: [] },
    ],
    unknowns: [
      {
        question: "Is the conversion-rate change real or noise?",
        whyItMatters: `The sample is too small: ${f.c.baseline.conversions} baseline and ${f.c.current.conversions} current conversions give ${formatPValue(f.c.zTest.pValue)}.`,
        howToResolve: required ? `Collect about ${required} sessions per period, or compare longer periods.` : "Compare longer periods.",
      },
      ...(missing.length
        ? [{ question: `What happened on ${missing.join(", ")}?`, whyItMatters: "Those days have no data, so the current period is incomplete.", howToResolve: "Restore the missing export days and rerun the investigation." }]
        : []),
    ],
    recommendedActions: [
      ...(missing.length ? [{ action: `Restore the missing data for ${missing.join(", ")}.`, priority: "now" as const, rationale: "The gap biases the current period.", hypothesisIds: ["H1"] }] : []),
      { action: "Keep the campaign unchanged and rerun once both periods have enough conversions.", priority: "next", rationale: "A non-significant change does not justify changes.", hypothesisIds: ["H1"] },
    ],
    limitations: [],
  });
}

function trafficSource(f: Facts, bySource: ToolResult, log: ToolResult): InvestigationReport {
  const d = dataOf(bySource)!;
  const top = d.topSegment as string;
  const s = (d.segments as Data[]).find((x) => x.segment === top)!;
  const [topEv, mixEv] = evidenceOf(bySource);
  const aligned = alignedEntry(log, f.changeDate);
  return f.n.finish({
    summary: `The ${crText(f)} between ${periodsText(f.c)}. One source explains most of it: ${top} grew from ${pct(s.baseline.share, 1)} to ${pct(s.current.share, 1)} of sessions while its conversion rate fell from ${pct(s.baseline.conversionRate)} to ${pct(s.current.conversionRate)}${aligned ? `, starting with ${changeText(aligned)}` : ""}. Lower-quality traffic from ${top} is the likely cause.`,
    verdict: "likely_cause",
    severity: severityOf(f.rel, false),
    severityRationale: `The tracked conversion rate changed by ${relPct(f.rel)}; the loss is concentrated in one source.`,
    whatChanged: `CR ${pct(f.c.baseline.conversionRate)} → ${pct(f.c.current.conversionRate)}${cite(f.cmp)}; ${top} explains most of the change${cite(topEv)}.`,
    observations: [...baseObservations(f), { statement: topEv!.statement, evidenceIds: refs(topEv) }, ...(mixEv ? [{ statement: mixEv.statement, evidenceIds: refs(mixEv) }] : []), ...(aligned ? [{ statement: aligned.ev.statement, evidenceIds: refs(aligned.ev) }] : [])],
    hypotheses: [
      {
        id: "H1",
        category: "traffic_source",
        statement: `Traffic from ${top} grew and converts far worse (clicks→sessions ${s.baseline.clicksToSessions} → ${s.current.clicksToSessions}), pulling the overall rate down.`,
        status: "supported",
        confidence: "high",
        confidenceRationale: "A direct segment decomposition plus the trend (and an aligned change) agree; nothing contradicts it.",
        supportingEvidenceIds: refs(topEv, f.trend ?? f.cmp, aligned?.ev),
        contradictingEvidenceIds: [],
      },
    ],
    unknowns: [{ question: `Is tracking healthy for ${top}?`, whyItMatters: "Tracking was not checked because the source decomposition was conclusive.", howToResolve: "Run the tracking-health check for this campaign." }],
    recommendedActions: [
      { action: `Pause or restrict the ${top} placements that grew${aligned ? ` after ${aligned.entry.at.slice(0, 10)}` : ""} and exclude low-quality placements.`, priority: "now", rationale: `${top} converts far below its baseline.`, hypothesisIds: ["H1"] },
      { action: `Review ${top} click quality (clicks→sessions) with the network.`, priority: "next", rationale: "Many clicks never become sessions.", hypothesisIds: ["H1"] },
    ],
    limitations: [],
  });
}

function landingPage(f: Facts, byDevice: ToolResult, page: ToolResult, tracking: ToolResult, log: ToolResult): InvestigationReport {
  const device = dataOf(byDevice)!.topSegment as string;
  const [devEv] = evidenceOf(byDevice);
  const monitoring: Data[] = dataOf(page)?.monitoring ?? [];
  const i = monitoring.findIndex((m) => m.device === device);
  const pageEv = i >= 0 ? evidenceOf(page)[i] : undefined;
  const m = i >= 0 ? monitoring[i]! : null;
  const deploys: Data[] = dataOf(page)?.deploys ?? [];
  const deployEv = evidenceOf(page).filter((e) => e.statement.startsWith("Deployed version changed")).at(-1);
  const aligned = alignedEntry(log, f.changeDate);
  const backend = backendChange(tracking);
  const realLoss = backend !== null && backend <= -0.3;
  const high = pageEv?.strength === "direct";
  const trackingEv = evidenceOf(tracking)[0];
  return f.n.finish({
    summary: `The ${crText(f)} between ${periodsText(f.c)}, driven by ${device} visitors${m ? `: the landing page returned 5xx to ${pct(m.current.errorRate5xx, 1)} of ${device} checks with p95 ${m.current.p95Ms} ms` : ""}${deploys.length > 1 ? ` after version ${deploys.at(-1)!.version} went live` : ""}.${realLoss ? " Backend-confirmed conversions fell too, so this is a real loss, not a tracking artefact." : ""}`,
    verdict: high ? "cause_identified" : "likely_cause",
    severity: severityOf(f.rel, realLoss),
    severityRationale: realLoss
      ? `Backend-confirmed conversions fell by ${relPct(backend)} and the tracked rate by ${relPct(f.rel)}.`
      : `The tracked conversion rate changed by ${relPct(f.rel)}, concentrated on ${device}.`,
    whatChanged: `CR ${pct(f.c.baseline.conversionRate)} → ${pct(f.c.current.conversionRate)}${cite(f.cmp)}; ${device} explains most of the change${cite(devEv)}; ${device} errors and latency rose${cite(pageEv)}.`,
    observations: [
      ...baseObservations(f),
      { statement: devEv!.statement, evidenceIds: refs(devEv) },
      ...(pageEv ? [{ statement: pageEv.statement, evidenceIds: refs(pageEv) }] : []),
      ...(deployEv ? [{ statement: deployEv.statement, evidenceIds: refs(deployEv) }] : []),
      ...(trackingEv ? [{ statement: trackingEv.statement, evidenceIds: refs(trackingEv) }] : []),
    ],
    hypotheses: [
      {
        id: "H1",
        category: "landing_page",
        statement: `The landing page${deploys.length > 1 ? ` release ${deploys.at(-1)!.version}` : ""} fails for ${device} visitors (server errors and slow responses), so they cannot convert.`,
        status: "supported",
        confidence: high ? "high" : "medium",
        confidenceRationale: high ? "Two direct items (device decomposition, device 5xx rate) agree and nothing contradicts them." : "The device decomposition points here, but page monitoring is not conclusive.",
        supportingEvidenceIds: refs(devEv, pageEv, deployEv ?? aligned?.ev),
        contradictingEvidenceIds: [],
      },
      ...(dataOf(tracking) && !pixelLost(tracking) ? ruledOut("H2", "tracking", "A tracking loss: pixel and backend conversions agree.", [trackingEv]) : []),
    ],
    unknowns: [],
    recommendedActions: [
      { action: `Roll back or fix the landing page${deploys.length > 1 ? ` version ${deploys.at(-1)!.version}` : ""} for ${device} visitors.`, priority: "now", rationale: `${device} visitors get server errors and slow pages.`, hypothesisIds: ["H1"] },
      { action: "Alert on landing-page 5xx rate and p95 latency per device.", priority: "next", rationale: "The failure went unnoticed until conversions dropped.", hypothesisIds: ["H1"] },
      { action: `Rerun this investigation after the fix to confirm the ${device} conversion rate recovers.`, priority: "later", rationale: "Confirms the cause.", hypothesisIds: ["H1"] },
    ],
    limitations: [],
  });
}

function trackingLoss(f: Facts, tracking: ToolResult, bySource: ToolResult, byDevice: ToolResult, log: ToolResult): InvestigationReport {
  const d = dataOf(tracking)!;
  const [reconEv] = evidenceOf(tracking);
  const aligned = alignedEntry(log, f.changeDate);
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;
  return f.n.finish({
    summary: `The ${crText(f)} between ${periodsText(f.c)}, but backend-confirmed conversions stayed stable: the pixel recorded ${pctOf(d.reconciliation.baseline.ratio)} of backend conversions before and only ${pctOf(d.reconciliation.current.ratio)} after${aligned ? `, starting with ${changeText(aligned)}` : ""}. This is a tracking loss, not a loss of customers.`,
    verdict: "cause_identified",
    severity: severityOf(f.rel, false),
    severityRationale: `Tracked conversions fell by ${relPct(f.rel)} while real conversions held; bidding and reporting run on wrong data.`,
    whatChanged: `Tracked CR ${pct(f.c.baseline.conversionRate)} → ${pct(f.c.current.conversionRate)}${cite(f.cmp)}; the pixel lost most backend-confirmed conversions${cite(reconEv)}.`,
    observations: [
      ...baseObservations(f),
      { statement: reconEv!.statement, evidenceIds: refs(reconEv) },
      ...(aligned ? [{ statement: aligned.ev.statement, evidenceIds: refs(aligned.ev) }] : []),
    ],
    hypotheses: [
      {
        id: "H1",
        category: "tracking",
        statement: `The conversion pixel stopped firing for most conversions${aligned ? ` after ${changeText(aligned)}` : ""}; real conversions did not drop.`,
        status: "supported",
        confidence: "high",
        confidenceRationale: "A direct pixel/backend divergence and the trend agree; nothing contradicts it.",
        supportingEvidenceIds: refs(reconEv, f.trend ?? f.cmp, aligned?.ev),
        contradictingEvidenceIds: [],
      },
      ...ruledOut("H2", "traffic_source", "One traffic source caused the drop.", evidenceOf(bySource)),
      ...ruledOut("H3", "landing_page", "One device (a broken landing page) caused the drop.", evidenceOf(byDevice)),
    ],
    unknowns: [{ question: "Which page or template stopped sending the conversion event?", whyItMatters: "It is the fix target.", howToResolve: "Test the confirmation step with a tag debugger." }],
    recommendedActions: [
      { action: `Restore the conversion tag${aligned ? ` on the page changed at ${stamp(aligned.entry.at)}` : ""} and verify that it fires.`, priority: "now", rationale: "The pixel misses most conversions.", hypothesisIds: ["H1"] },
      { action: "Do not cut bids or budgets on pixel data until tracking is fixed; judge performance on backend-confirmed conversions.", priority: "now", rationale: "Pixel data understates real conversions.", hypothesisIds: ["H1"] },
      { action: "Alert on the pixel-to-backend conversion ratio.", priority: "next", rationale: "Catches the next tracking break early.", hypothesisIds: ["H1"] },
    ],
    limitations: [],
  });
}

const CATEGORY_OF_CHANGE: Record<string, Category> = { tracking: "tracking", traffic: "traffic_source", budget: "traffic_source", other: "other" };

function alignedChange(f: Facts, tracking: ToolResult, bySource: ToolResult, byDevice: ToolResult, page: ToolResult, log: ToolResult): InvestigationReport {
  const aligned = alignedEntry(log, f.changeDate);
  const pageEvs = evidenceOf(page).filter((e) => e.statement.includes("5xx rate"));
  const pageBroken = pageEvs.some((e) => e.strength === "direct");
  // a deploy without landing-page errors changed what happens after the landing page: the conversion flow
  const category: Category = aligned ? (aligned.entry.category === "deploy" ? (pageBroken ? "landing_page" : "conversion_flow") : (CATEGORY_OF_CHANGE[aligned.entry.category] ?? "other")) : "other";
  const trackingFailed = !tracking.ok;
  return f.n.finish({
    summary: aligned
      ? `The ${crText(f)} between ${periodsText(f.c)}, evenly across sources and devices. The change point on ${f.changeDate} lines up with ${changeText(aligned)}, which makes a ${category.replace(/_/g, " ")} problem the likely cause${trackingFailed ? "; tracking health could not be checked, so confidence is capped" : ""}.`
      : `The ${crText(f)} between ${periodsText(f.c)}, evenly across sources and devices, and no recorded change lines up with it. The cause could not be identified from the available tools.`,
    verdict: aligned ? "likely_cause" : "inconclusive",
    severity: severityOf(f.rel, false),
    severityRationale: `The tracked conversion rate changed by ${relPct(f.rel)}${trackingFailed ? "; whether the loss is real could not be confirmed" : ""}.`,
    whatChanged: `CR ${pct(f.c.baseline.conversionRate)} → ${pct(f.c.current.conversionRate)}${cite(f.cmp)}${aligned ? `; ${changeText(aligned)}${cite(aligned.ev)}` : ""}.`,
    observations: [
      ...baseObservations(f),
      ...evidenceOf(bySource).slice(-1).map((e) => ({ statement: e.statement, evidenceIds: [e.ref] })),
      ...pageEvs.map((e) => ({ statement: e.statement, evidenceIds: [e.ref] })),
      ...(aligned ? [{ statement: aligned.ev.statement, evidenceIds: refs(aligned.ev) }] : []),
    ],
    hypotheses: [
      aligned
        ? {
            id: "H1",
            category,
            statement: `${changeText(aligned)[0]!.toUpperCase()}${changeText(aligned).slice(1)} changed the ${category.replace(/_/g, " ")} and conversions fell uniformly from ${f.changeDate}.`,
            status: "supported",
            confidence: "medium",
            confidenceRationale: `Timing and a uniform drop support it, but no direct evidence confirms it${trackingFailed ? " and tracking health is unknown" : ""}.`,
            supportingEvidenceIds: refs(aligned.ev, f.trend, f.cmp),
            contradictingEvidenceIds: [],
          }
        : { id: "H1", category: "other", statement: "An unrecorded change caused the drop.", status: "plausible", confidence: "low", confidenceRationale: "Nothing in the data points to a specific cause.", supportingEvidenceIds: refs(f.cmp), contradictingEvidenceIds: [] },
      ...ruledOut("H2", "traffic_source", "One traffic source caused the drop.", evidenceOf(bySource)),
      ...(pageBroken || category === "landing_page" ? [] : ruledOut("H3", "landing_page", "The landing page broke.", pageEvs)),
    ],
    unknowns: [],
    recommendedActions: [
      aligned
        ? { action: `Verify the ${category === "conversion_flow" ? "conversion flow (form, checkout and confirmation events)" : category.replace(/_/g, " ")} end to end after ${changeText(aligned)}.`, priority: "now", rationale: "It is the change aligned with the drop.", hypothesisIds: ["H1"] }
        : { action: "Ask the teams for changes around the change point that are missing from the change log.", priority: "now", rationale: "No recorded change explains the drop.", hypothesisIds: ["H1"] },
      ...(trackingFailed ? [{ action: "Rerun this investigation when the tracking-health data is available.", priority: "next" as const, rationale: "Rules a tracking loss in or out.", hypothesisIds: ["H1"] }] : []),
    ],
    limitations: trackingFailed ? ["Tracking health could not be checked, so a tracking loss is not ruled out."] : [],
  });
}
