import { Inject, Injectable } from "@nestjs/common";
import type {
  EvidenceKind,
  EvidenceStrength,
  ReportAttachments,
  ReportValidationError,
  StoredReportPayload,
  ToolResult,
} from "@campaign-sentinel/contracts";
import { PrismaService } from "../db/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { IllegalTransitionError, InvestigationNotFoundError } from "../ledger/ledger.errors";
import { LedgerService, type Evidence, type ToolExecution } from "../ledger/ledger.service";
import { ToolFailure, type ToolHandler } from "../tools/tool.types";
import { validateReport, type GroundingContext } from "./grounding";

/** Spec story 23: report submissions per investigation; the third rejection fails the run. */
export const REPORT_ATTEMPT_BUDGET = 3;

export type SubmitResult = { accepted: true; report: StoredReportPayload } | { accepted: false; errors: ReportValidationError[] };

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const notRunning = (status: string | null): SubmitResult => ({
  accepted: false,
  errors: [{ path: "", rule: "state", message: `The investigation is ${status ?? "not running"}; no report is accepted.` }],
});
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The data of a stored successful ToolResult, or null (failed / truncated). */
const dataOf = (te: ToolExecution | undefined): Data | null =>
  te && te.status === "SUCCEEDED" && !te.outputTruncated ? (((te.output as ToolResult | null) as { data?: Data } | null)?.data ?? null) : null;
const latest = (tes: ToolExecution[], tool: string) => tes.filter((t) => t.tool === tool && t.status === "SUCCEEDED").at(-1);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The latest successful compare_periods over the run's OWN baseline/current periods (the run's, or the
 * campaign defaults when the run has none). A comparison over any other window never feeds rules 5, 6, 10 or keyMetrics.
 */
function ownComparison(
  tes: ToolExecution[],
  periods: { baseline: { start: string; end: string }; current: { start: string; end: string } } | null,
): ToolExecution | undefined {
  return tes
    .filter((t) => {
      if (t.tool !== "compare_periods" || t.status !== "SUCCEEDED") return false;
      const d = dataOf(t);
      const same = (a?: { start?: string; end?: string }, b?: { start: string; end: string }) => !!b && a?.start === b.start && a?.end === b.end;
      return !!periods && same(d?.baseline?.period, periods.baseline) && same(d?.current?.period, periods.current);
    })
    .at(-1);
}

/**
 * The only way a report becomes a result (spec §5.4–5.5, story 23): schema + grounding rules against the
 * investigation's own evidence, at most 3 attempts, rejected payloads kept only in `report.rejected` events,
 * the accepted payload stored once with server attachments, then the run is COMPLETED.
 */
@Injectable()
export class ReportService {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async submit(investigationId: string, raw: unknown): Promise<SubmitResult> {
    const inv = await this.prisma.investigation.findUnique({ where: { id: investigationId } });
    if (!inv) throw new InvestigationNotFoundError(investigationId);
    if (inv.status !== "RUNNING") return notRunning(inv.status);
    await this.recordToolFailures(investigationId);
    const { reportAttempts: attempt } = await this.ledger.incrementCounters(investigationId, { reportAttempts: 1 });
    await this.ledger.appendEvent(investigationId, "report.submitted", { attempt });

    const { ctx, evidence, toolExecutions, comparisonRun } = await this.context(investigationId);
    const result = validateReport(raw, ctx);
    if (!result.ok) {
      await this.ledger.appendEvent(investigationId, "report.rejected", { attempt, errors: result.errors });
      if (attempt >= REPORT_ATTEMPT_BUDGET) {
        await this.ledger
          .transition(investigationId, "RUNNING", "FAILED", {
            failureCode: "REPORT_INVALID",
            failureMessage: `The report was rejected ${attempt} times; the last errors: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`.slice(0, 1000),
          })
          .catch((error) => {
            if (!(error instanceof IllegalTransitionError)) throw error; // cancelled meanwhile: keep that state
          });
      }
      return { accepted: false, errors: result.errors };
    }

    const attachments: ReportAttachments = {
      keyMetrics: ctx.mode === "demo" ? demoMetrics(comparisonRun) : urlMetrics(toolExecutions),
      provenance: ctx.mode === "demo" ? "synthetic-demo" : "live-http",
      toolFailures: toolExecutions
        .filter((t) => t.status === "FAILED" && t.tool !== "submit_report")
        .map((t) => ({ tool: t.tool, code: t.errorCode ?? "UNKNOWN", message: t.errorMessage ?? "" })),
      evidenceIndex: Object.fromEntries(evidence.map((e) => [e.ref, e.statement])),
      runtime: inv.runtime,
      model: inv.model,
      validationWarnings: result.warnings,
    };
    const payload: StoredReportPayload = { ...result.report, ...attachments };
    try {
      // report row + report.accepted + RUNNING→COMPLETED commit together or not at all
      await this.ledger.completeWithReport(investigationId, attempt, {
        verdict: payload.verdict,
        severity: payload.severity,
        summary: payload.summary,
        payload,
      });
    } catch (error) {
      if (error instanceof IllegalTransitionError || isUniqueViolation(error)) return notRunning(error instanceof IllegalTransitionError ? error.actual : "COMPLETED");
      throw error;
    }
    return { accepted: true, report: payload };
  }

  /**
   * D03: every tool execution that failed after retries gets one `data_quality` evidence item
   * "<tool> unavailable: <code>". Idempotent; called after each agent turn and before validation.
   */
  async recordToolFailures(investigationId: string): Promise<Evidence[]> {
    const failed = await this.prisma.toolExecution.findMany({
      where: { investigationId, status: "FAILED", tool: { not: "submit_report" }, evidence: { none: { kind: "data_quality" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { investigation: { select: { mode: true } } },
    });
    const added: Evidence[] = [];
    for (const te of failed) {
      const items = await this.ledger.addEvidence(investigationId, te.id, [
        {
          kind: "data_quality",
          strength: "indirect",
          statement: `${te.tool} unavailable: ${te.errorCode ?? "UNKNOWN"}`,
          data: { tool: te.tool, code: te.errorCode, message: te.errorMessage, attempts: te.attempt },
          provenance: te.investigation.mode === "DEMO" ? "synthetic-demo" : "live-http",
        },
      ]);
      added.push(...items);
    }
    return added;
  }

  private async context(investigationId: string) {
    const inv = await this.prisma.investigation.findUniqueOrThrow({
      where: { id: investigationId },
      include: {
        evidence: { include: { toolExecution: { select: { tool: true } } } },
        toolExecutions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    const evidence = [...inv.evidence].sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
    const campaign = inv.mode === "DEMO" && inv.campaignId ? await this.prisma.campaign.findUnique({ where: { id: inv.campaignId } }) : null;
    const periods =
      inv.baselineStart && inv.baselineEnd && inv.currentStart && inv.currentEnd
        ? { baseline: { start: day(inv.baselineStart), end: day(inv.baselineEnd) }, current: { start: day(inv.currentStart), end: day(inv.currentEnd) } }
        : campaign
          ? {
              baseline: { start: day(campaign.defaultBaselineStart), end: day(campaign.defaultBaselineEnd) },
              current: { start: day(campaign.defaultCurrentStart), end: day(campaign.defaultCurrentEnd) },
            }
          : null;
    const comparisonRun = ownComparison(inv.toolExecutions, periods);
    const compare = dataOf(comparisonRun);
    const ctx: GroundingContext = {
      mode: inv.mode === "DEMO" ? "demo" : "url",
      evidence: evidence.map((e) => ({
        ref: e.ref,
        kind: e.kind as EvidenceKind,
        strength: e.strength as EvidenceStrength,
        tool: e.toolExecution.tool,
        data: e.data,
      })),
      toolRuns: inv.toolExecutions.map((t) => ({ tool: t.tool, status: t.status })),
      comparison: compare ? { isSignificant: Boolean(compare.isSignificant), relativeChange: compare.relativeChange ?? null } : null,
    };
    return { ctx, evidence, toolExecutions: inv.toolExecutions, comparisonRun };
  }
}

/** Key metrics come from tool outputs, never from model text (spec story 19). */
function demoMetrics(comparison: ToolExecution | undefined): Record<string, unknown> {
  const c = dataOf(comparison);
  if (!c) return {};
  return {
    baseline: c.baseline,
    current: c.current,
    absoluteChange: c.absoluteChange,
    relativeChange: c.relativeChange,
    pValue: c.zTest?.pValue ?? null,
    ci95: c.zTest?.ci95 ?? null,
    isSignificant: c.isSignificant,
    conversionsPerDayDifference: c.conversionsPerDayDifference,
  };
}

function urlMetrics(tes: ToolExecution[]): Record<string, unknown> {
  const page = dataOf(latest(tes, "fetch_page"));
  const availability = dataOf(latest(tes, "measure_availability"));
  return {
    ...(page
      ? {
          status: page.status ?? null,
          finalUrl: page.finalUrl ?? null,
          ttfbMs: page.timings?.ttfbMs ?? null,
          totalMs: page.timings?.totalMs ?? null,
          bytes: page.bytes ?? null,
          redirects: Array.isArray(page.redirects) ? page.redirects.length : null,
          fetchError: page.error?.code ?? null,
        }
      : {}),
    ...(availability ? { successRate: availability.successRate, attempts: availability.attempts?.length ?? null } : {}),
  };
}

/** `submit_report` as a tool: accepted → `{accepted: true}`; rejected → a REPORT_REJECTED failure listing the errors. */
export function submitReportHandler(reports: ReportService): ToolHandler<"submit_report"> {
  return {
    name: "submit_report",
    async run(input, ctx) {
      const result = await reports.submit(ctx.investigation.id, input.report);
      if (result.accepted) return { data: { accepted: true, verdict: result.report.verdict, severity: result.report.severity } };
      throw new ToolFailure("REPORT_REJECTED", `Report rejected. Fix these errors and resubmit: ${JSON.stringify(result.errors)}`);
    },
  };
}
