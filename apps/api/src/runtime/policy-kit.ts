import type { EvidenceStrength, InvestigationReport, Severity, ToolName, ToolResult } from "@campaign-sentinel/contracts";

/** Shared helpers of the deterministic policy (spec §5.8): calls as generator steps, evidence picking, report assembly. */
export interface PolicyStep {
  tool: ToolName;
  input: Record<string, unknown>;
}
/** A policy yields tool calls, receives their results and returns the final report. */
export type Policy = Generator<PolicyStep, InvestigationReport, ToolResult>;

export type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Ev = { ref: string; statement: string; strength: EvidenceStrength };
type Draft = Omit<InvestigationReport, "schemaVersion" | "securityNotes">;

export const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
export const relPct = (x: number | null) => (x === null ? "n/a" : `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(1)}%`);
export const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
export const dataOf = (r: ToolResult | undefined): Data | null => (r?.ok ? (r.data as Data) : null);
export const evidenceOf = (r: ToolResult | undefined): Ev[] => (r?.ok ? r.evidence : []);
export const refs = (...items: (Ev | undefined)[]) => [...new Set(items.filter((e): e is Ev => !!e).map((e) => e.ref))];
export const cite = (...items: (Ev | undefined)[]) => {
  const ids = refs(...items);
  return ids.length ? ` [${ids.join(", ")}]` : "";
};

/** Severity rubric §5.7 from the relative CR change; `realLoss` = backend-confirmed conversions fell too. */
export function severityOf(rel: number | null, realLoss: boolean): Severity {
  const drop = -(rel ?? 0);
  if (realLoss && drop >= 0.3) return "critical";
  if (drop >= 0.3) return "high";
  if (drop >= 0.1) return "medium";
  return "low";
}

export const POLICY_LIMITATION = "Produced by the deterministic policy (no AI): fixed rules and report templates applied to the tool results.";

/** Records what the policy saw while it calls tools: failures and prompt-injection signals. */
export class Notebook {
  readonly failures: { tool: string; code: string }[] = [];
  readonly security: string[] = [];
  readonly all: Ev[] = [];

  *call(tool: ToolName, input: Record<string, unknown>, reason: string): Generator<PolicyStep, ToolResult, ToolResult> {
    const result = yield { tool, input: { ...input, reason } };
    if (!result.ok) {
      this.failures.push({ tool, code: result.error.code });
    } else {
      this.all.push(...result.evidence);
      const u = result.untrustedContent;
      if (u && u.injectionSignals.length > 0) {
        this.security.push(
          `Possible prompt injection in ${u.source} (signals: ${u.injectionSignals.join(", ")}); the text was treated as data and its instructions were ignored.`,
        );
      }
    }
    return result;
  }

  /** Evidence items whose statement starts like data-quality findings (missing dates, low sample). */
  dataQuality(): Ev[] {
    const items = this.all.filter((e) => /^(No data for|Low sample)/.test(e.statement));
    return [...new Map(items.map((e) => [e.statement, e])).values()];
  }

  /** Completes a draft: unknowns for failed tools, security notes, the policy limitation, schema limits. */
  finish(draft: Draft): InvestigationReport {
    const failed = [...new Map(this.failures.map((f) => [f.tool, f])).values()].map((f) => ({
      question: `What would ${f.tool} have shown?`,
      whyItMatters: `The tool failed (${f.code}), so the findings it informs remain unconfirmed.`,
      howToResolve: `Rerun the investigation when ${f.tool} is available.`,
    }));
    return {
      schemaVersion: "1",
      ...draft,
      observations: draft.observations.filter((o) => o.evidenceIds.length > 0).slice(0, 12),
      hypotheses: draft.hypotheses.slice(0, 8),
      unknowns: [...failed, ...draft.unknowns].slice(0, 8),
      recommendedActions: draft.recommendedActions.slice(0, 8),
      limitations: [...draft.limitations, POLICY_LIMITATION].slice(0, 8),
      securityNotes: [...new Set(this.security)].slice(0, 5),
    };
  }
}
