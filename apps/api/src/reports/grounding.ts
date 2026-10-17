import {
  reportSchemaForMode,
  type Category,
  type EvidenceKind,
  type EvidenceStrength,
  type InvestigationMode,
  type InvestigationReport,
  type ReportValidationError,
} from "@campaign-sentinel/contracts";

export interface GroundingEvidence {
  ref: string;
  kind: EvidenceKind;
  strength: EvidenceStrength;
  /** the tool whose execution produced it */
  tool: string;
  data: unknown;
}

/** What the server knows about the investigation when a report arrives. */
export interface GroundingContext {
  mode: InvestigationMode;
  evidence: GroundingEvidence[];
  /** every tool execution that ran (status SUCCEEDED / FAILED) */
  toolRuns: { tool: string; status: string }[];
  /** latest successful compare_periods (demo); null when none */
  comparison: { isSignificant: boolean; relativeChange: number | null } | null;
}

export type GroundingResult =
  | { ok: true; report: InvestigationReport; warnings: string[] }
  | { ok: false; errors: ReportValidationError[]; warnings: string[] };

/** Rule 7: categories a tool informs. */
const INFORMED_BY: Partial<Record<Category, string[]>> = {
  tracking: ["inspect_tracking_health"],
  landing_page: ["check_landing_page"],
  traffic_source: ["breakdown_by_segment"],
  site_availability: ["fetch_page", "measure_availability"],
  site_performance: ["fetch_page", "measure_availability"],
  site_content: ["fetch_page", "measure_availability"],
};

// control characters (keeping \n and \t) and zero-width / bidi characters
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff-\ufeff]/g;
const HTML = /<\/?[a-z!][^>]*>/i;
const TOOLING_ACTION = /\b(install|enable|set ?up|add)\b[^.]{0,60}\b(chromium|playwright|headless browser|browser binaries|api server)\b/i;
const CITATION = /\[([^\]]*)\]/g;

function clean(value: unknown, path: string[], errors: ReportValidationError[]): unknown {
  if (typeof value === "string") {
    const text = value.replace(CONTROL, "");
    if (HTML.test(text)) errors.push({ path: path.join("."), rule: "no_html", message: "Plain text only: remove HTML tags." });
    return text;
  }
  if (Array.isArray(value)) return value.map((v, i) => clean(v, [...path, String(i)], errors));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, [...path, k], errors)]));
  }
  return value;
}

/** Spec §5.5: schema + the ten grounding rules. Pure; every error is `{path, rule, message}` so a model can fix it. */
export function validateReport(raw: unknown, ctx: GroundingContext): GroundingResult {
  const errors: ReportValidationError[] = [];
  const warnings: string[] = [];
  const err = (path: string, rule: string, message: string) => errors.push({ path, rule, message });

  // 1. schema, control characters, no HTML
  const cleaned = clean(raw, [], errors);
  const parsed = reportSchemaForMode(ctx.mode).safeParse(cleaned);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      // 3. every observation cites ≥ 1 evidence id (enforced by the schema's min(1))
      const rule = /^observations\.\d+\.evidenceIds$/.test(path) && issue.code === "too_small" ? "observation_evidence" : "schema";
      err(path, rule, issue.message);
    }
  }
  if (!parsed.success || errors.length > 0) return { ok: false, errors, warnings };
  const report = parsed.data as InvestigationReport;

  const evidence = new Map(ctx.evidence.map((e) => [e.ref, e]));
  const significant = ctx.comparison?.isSignificant === true;
  const rel = ctx.comparison?.relativeChange ?? 0;

  // 2. every cited evidence id exists
  const cite = (path: string, id: string) => {
    if (!evidence.has(id)) err(path, "evidence_exists", `Evidence ${id} does not exist in this investigation.`);
  };
  report.observations.forEach((o, i) => o.evidenceIds.forEach((id, j) => cite(`observations.${i}.evidenceIds.${j}`, id)));
  report.hypotheses.forEach((h, i) => {
    h.supportingEvidenceIds.forEach((id, j) => cite(`hypotheses.${i}.supportingEvidenceIds.${j}`, id));
    h.contradictingEvidenceIds.forEach((id, j) => cite(`hypotheses.${i}.contradictingEvidenceIds.${j}`, id));
  });
  // ids cited in the text of ANY string of the report (spec: "cited anywhere")
  const walk = (value: unknown, path: string[]) => {
    if (typeof value === "string") {
      for (const m of value.matchAll(CITATION)) for (const id of m[1]!.match(/\bE\d+\b/g) ?? []) cite(path.join("."), id);
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)]));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
  };
  walk(report, []);

  // 4. high confidence needs supported + ≥ 2 supporting ids with ≥ 1 direct + nothing contradicting
  report.hypotheses.forEach((h, i) => {
    if (h.confidence !== "high") return;
    const supporting = new Set(h.supportingEvidenceIds);
    const direct = [...supporting].some((id) => evidence.get(id)?.strength === "direct");
    if (h.status !== "supported" || supporting.size < 2 || !direct || h.contradictingEvidenceIds.length > 0) {
      err(
        `hypotheses.${i}.confidence`,
        "high_confidence",
        "high confidence needs status supported, at least 2 distinct supporting evidence ids with at least one direct item, and no contradicting evidence.",
      );
    }
  });

  // 5. cause_identified needs a supported/high hypothesis (+ a significant comparison in demo mode)
  if (report.verdict === "cause_identified") {
    if (!report.hypotheses.some((h) => h.status === "supported" && h.confidence === "high")) {
      err("verdict", "cause_identified", "cause_identified needs a hypothesis that is supported with high confidence.");
    } else if (ctx.mode === "demo" && !significant) {
      err("verdict", "cause_identified", "cause_identified needs a significant compare_periods result.");
    }
  }

  // 6. significance (demo)
  if (ctx.mode === "demo") {
    if (significant && rel <= -0.1) {
      if (report.verdict === "no_issue_found") err("verdict", "significance", "The conversion rate fell significantly (p < 0.05, ≥ 10%); no_issue_found is not allowed.");
      if (report.severity === "none") err("severity", "significance", "The conversion rate fell significantly (p < 0.05, ≥ 10%); severity none is not allowed.");
    } else if (!significant && report.verdict !== "inconclusive" && report.verdict !== "no_issue_found") {
      err("verdict", "significance", "Without a significant compare_periods result only inconclusive or no_issue_found are allowed.");
    }
  }

  // 7. a tool that never succeeded caps the confidence of the categories it informs
  const succeeded = new Set(ctx.toolRuns.filter((t) => t.status === "SUCCEEDED").map((t) => t.tool));
  const failed = new Set(ctx.toolRuns.filter((t) => t.status === "FAILED" && !succeeded.has(t.tool)).map((t) => t.tool));
  report.hypotheses.forEach((h, i) => {
    const tools = (INFORMED_BY[h.category] ?? []).filter((t) => failed.has(t));
    if (h.confidence === "high" && tools.length > 0) {
      err(`hypotheses.${i}.confidence`, "tool_failure_cap", `${tools.join(", ")} failed, so ${h.category} cannot have high confidence.`);
    }
  });

  // 8. URL mode: no outcome data
  if (ctx.mode === "url") {
    if (report.verdict === "cause_identified") err("verdict", "url_scope", "URL investigations have no outcome data; cause_identified is not allowed.");
    if (!report.limitations.some((l) => /does not reveal/i.test(l))) {
      err("limitations", "url_scope", "limitations must include the URL scope statement (what a URL does not reveal).");
    }
    report.hypotheses.forEach((h, i) => {
      if (h.category !== "site_availability" || h.status !== "supported" || h.confidence !== "high") return;
      const failedAttempts = h.supportingEvidenceIds
        .map((id) => evidence.get(id))
        .filter((e) => e?.kind === "availability")
        .reduce((max, e) => Math.max(max, Number((e!.data as { failed?: number })?.failed ?? 0)), 0);
      if (failedAttempts < 2) err(`hypotheses.${i}.confidence`, "url_scope", "supported/high site_availability needs evidence of at least 2 failed attempts.");
    });
  }

  // 9. ids unique and consistent
  const ids = new Set<string>();
  report.hypotheses.forEach((h, i) => {
    if (ids.has(h.id)) err(`hypotheses.${i}.id`, "ids_consistent", `Hypothesis id ${h.id} is used twice.`);
    ids.add(h.id);
  });
  report.recommendedActions.forEach((a, i) =>
    a.hypothesisIds.forEach((id, j) => {
      if (!ids.has(id)) err(`recommendedActions.${i}.hypothesisIds.${j}`, "ids_consistent", `Hypothesis ${id} does not exist.`);
    }),
  );

  // 10. severity
  if (report.severity === "none" && report.verdict !== "no_issue_found") {
    err("severity", "severity", "severity none is only allowed with verdict no_issue_found.");
  }
  if (report.severity === "critical") {
    const ok =
      ctx.mode === "demo"
        ? significant && rel <= -0.3
        : ctx.evidence.some((e) => e.kind === "availability" && Number((e.data as { successRate?: number })?.successRate ?? 1) < 0.5);
    if (!ok) {
      err(
        "severity",
        "severity",
        ctx.mode === "demo" ? "critical needs a significant drop of at least 30%." : "critical needs measured availability below 50%.",
      );
    }
  }

  // U2: tooling limits of this product belong in limitations/unknowns, not in advice to the site owner
  if (ctx.mode === "url") {
    report.recommendedActions.forEach((a, i) => {
      if (TOOLING_ACTION.test(`${a.action} ${a.rationale}`)) {
        warnings.push(`recommendedActions.${i} mentions installing a browser, Playwright or the API server; tooling limits belong in limitations or unknowns, not in recommended actions.`);
      }
    });
  }

  if (ctx.evidence.some((e) => e.kind === "data_quality") && report.unknowns.length === 0) {
    warnings.push("Data-quality evidence exists but unknowns is empty; list what could not be checked in unknowns.");
  }
  return errors.length ? { ok: false, errors, warnings } : { ok: true, report, warnings };
}
