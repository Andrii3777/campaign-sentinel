import { scenarioForCampaign, type GroundTruth } from "@campaign-sentinel/contracts";
import type {
  EvidenceDto,
  InvestigationDetail as InvestigationDetailDto,
  InvestigationListItem,
  StoredReportPayload,
  ToolExecutionDto,
} from "@campaign-sentinel/contracts";
import type { Investigation, InvestigationDetail } from "../../ledger/ledger.service";
import { RUN_BUDGETS } from "../../runtime/runner";
import { HTTP_REQUEST_CAP } from "../../tools/url/url-tools";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);
type Row = Investigation & { campaign?: { name: string } | null; report?: { verdict: string; severity: string } | null };

/** Ledger row → contract-cased list item (lower-case mode, provenance). */
export function toListItem(inv: Row): InvestigationListItem {
  return {
    id: inv.id,
    mode: inv.mode === "DEMO" ? "demo" : "url",
    campaignId: inv.campaignId,
    campaignName: inv.campaign?.name ?? null,
    targetUrl: inv.targetUrl,
    question: inv.question,
    status: inv.status,
    failureCode: inv.failureCode as InvestigationListItem["failureCode"],
    failureMessage: inv.failureMessage,
    source: inv.source as InvestigationListItem["source"],
    runtime: inv.runtime as InvestigationListItem["runtime"],
    model: inv.model,
    clientName: inv.clientName,
    clientVersion: inv.clientVersion,
    provenance: inv.mode === "DEMO" ? "synthetic-demo" : "live-http",
    verdict: (inv.report?.verdict ?? null) as InvestigationListItem["verdict"],
    severity: (inv.report?.severity ?? null) as InvestigationListItem["severity"],
    retryOfId: inv.retryOfId,
    createdAt: inv.createdAt.toISOString(),
    startedAt: iso(inv.startedAt),
    finishedAt: iso(inv.finishedAt),
    durationMs: inv.startedAt && inv.finishedAt ? inv.finishedAt.getTime() - inv.startedAt.getTime() : null,
  };
}


/**
 * Story 17: ground truth of the demo dataset against the agent's result, for COMPLETED demo runs only.
 * Computed here, after completion, from the scenario catalogue; tools, prompts and policies never see it.
 */
function groundTruthOf(inv: InvestigationDetail): GroundTruth | undefined {
  if (inv.mode !== "DEMO" || inv.status !== "COMPLETED" || !inv.report || !inv.campaignId) return undefined;
  const scenario = scenarioForCampaign(inv.campaignId);
  if (!scenario) return undefined;
  const payload = inv.report.payload as StoredReportPayload;
  const agentTopCategory = payload.hypotheses[0]?.category ?? null;
  const agentVerdict = payload.verdict;
  const categoryOk = scenario.expectedCategory === null ? agentVerdict === "inconclusive" : agentTopCategory === scenario.expectedCategory;
  return {
    expectedCategory: scenario.expectedCategory,
    expectedVerdict: scenario.expectedVerdicts.join(" / "),
    agentTopCategory,
    agentVerdict,
    match: categoryOk && scenario.expectedVerdicts.includes(agentVerdict),
  };
}

export function toDetail(inv: InvestigationDetail): InvestigationDetailDto {
  const groundTruth = groundTruthOf(inv);
  return {
    ...(groundTruth ? { groundTruth } : {}),
    ...toListItem(inv),
    clientUserAgent: inv.clientUserAgent,
    periods:
      inv.baselineStart && inv.baselineEnd && inv.currentStart && inv.currentEnd
        ? { baseline: { start: day(inv.baselineStart), end: day(inv.baselineEnd) }, current: { start: day(inv.currentStart), end: day(inv.currentEnd) } }
        : null,
    counters: {
      modelTurns: inv.modelTurns,
      toolCalls: inv.toolCalls,
      reportAttempts: inv.reportAttempts,
      httpRequests: inv.httpRequests,
      inputTokens: inv.inputTokens,
      outputTokens: inv.outputTokens,
    },
    budgets: {
      modelTurns: RUN_BUDGETS.turns,
      toolCalls: RUN_BUDGETS.toolCalls,
      reportAttempts: RUN_BUDGETS.reportAttempts,
      httpRequests: inv.mode === "URL" ? HTTP_REQUEST_CAP : null,
      wallClockMs: RUN_BUDGETS.wallClockMs,
    },
    retryIds: inv.retries.map((r) => r.id),
    report: inv.report
      ? {
          schemaVersion: inv.report.schemaVersion,
          verdict: inv.report.verdict as StoredReportPayload["verdict"],
          severity: inv.report.severity as StoredReportPayload["severity"],
          summary: inv.report.summary,
          createdAt: inv.report.createdAt.toISOString(),
          payload: inv.report.payload as StoredReportPayload,
        }
      : null,
    evidence: inv.evidence.map(
      (e): EvidenceDto => ({
        ref: e.ref,
        kind: e.kind as EvidenceDto["kind"],
        strength: e.strength as EvidenceDto["strength"],
        statement: e.statement,
        data: e.data,
        provenance: e.provenance as EvidenceDto["provenance"],
        toolExecutionId: e.toolExecutionId,
        createdAt: e.createdAt.toISOString(),
      }),
    ),
    toolExecutions: inv.toolExecutions.map(
      (t): ToolExecutionDto => ({
        id: t.id,
        tool: t.tool,
        callerRef: t.callerRef,
        input: t.input,
        reason: t.reason,
        status: t.status,
        attempt: t.attempt,
        errorCode: t.errorCode,
        errorMessage: t.errorMessage,
        output: t.output,
        outputTruncated: t.outputTruncated,
        createdAt: t.createdAt.toISOString(),
        startedAt: iso(t.startedAt),
        finishedAt: iso(t.finishedAt),
        durationMs: t.durationMs,
      }),
    ),
  };
}
