import type { InvestigationDetail, Severity } from "@campaign-sentinel/contracts";
import { CircleCheck, CircleX, FileText, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { JsonView } from "@/components/ui/json-view";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatChange, formatInt, formatPeriod, formatRate, humanize } from "@/lib/format";
import { DownloadJson } from "./download-json";
import { EvidenceChip } from "./status-marks";

type Report = NonNullable<InvestigationDetail["report"]>;
type Props = { detail: InvestigationDetail; onEvidenceActive?: (ref: string | null) => void };

const severities: Severity[] = ["critical", "high", "medium", "low", "none"];

/** Verdict and severity, first thing above the column once a report is accepted. Severity is a labelled five-step strip: position and word, not colour. */
export function VerdictBand({ report }: { report: Report }) {
  return (
    <section aria-labelledby="verdict-heading" className="rounded-sm border border-hairline bg-surface">
      <div className="flex h-1.5 bg-stratum-report" aria-hidden />
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="verdict-heading" className="text-lg font-semibold">
            {humanize(report.verdict)}
          </h2>
          <p className="max-w-[72ch] text-sm text-pretty text-ink-2">{report.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <span id="severity-label" className="text-xs font-semibold text-ink-2">
            Severity
          </span>
          <ol aria-labelledby="severity-label" className="flex list-none overflow-hidden rounded-sm border border-hairline text-xs">
            {severities.map((level) => {
              const current = level === report.severity;
              return (
                <li
                  key={level}
                  aria-current={current ? "true" : undefined}
                  className={`px-2.5 py-1 ${current ? "bg-ink font-semibold text-white" : "border-l border-hairline text-ink-2 first:border-l-0"}`}
                >
                  {level}
                  {current ? <span className="sr-only"> (this report)</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Chips({ ids, onActive }: { ids: readonly string[]; onActive?: (ref: string | null) => void }) {
  if (ids.length === 0) return <span className="text-ink-2">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <EvidenceChip key={id} id={id} onActive={onActive} />
      ))}
    </span>
  );
}

function Block({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="pt-2 text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Key metrics come from the server (the latest compare_periods), never from model text. Known demo shape as a table, anything else as JSON. */
function KeyMetrics({ metrics }: { metrics: Record<string, unknown> }) {
  const baseline = metrics.baseline as { period?: { start: string; end: string }; sessions?: number; conversions?: number; conversionRate?: number } | undefined;
  const current = metrics.current as typeof baseline;
  if (!baseline || !current || typeof baseline.conversionRate !== "number" || typeof current.conversionRate !== "number") {
    return Object.keys(metrics).length === 0 ? <p className="text-sm text-ink-2">No key metrics were attached to this report.</p> : <JsonView value={metrics} label="Key metrics" open />;
  }
  const ci = Array.isArray(metrics.ci95) ? (metrics.ci95 as number[]) : null;
  const pValue = typeof metrics.pValue === "number" ? metrics.pValue : null;
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <thead>
          <tr>
            <Th>Period</Th>
            <Th>Dates</Th>
            <Th className="text-right">Sessions</Th>
            <Th className="text-right">Conversions</Th>
            <Th className="text-right">Conversion rate</Th>
          </tr>
        </thead>
        <tbody>
          {([["Baseline", baseline], ["Current", current]] as const).map(([label, p]) => (
            <Tr key={label}>
              <Td className="font-medium">{label}</Td>
              <Td className="font-mono text-xs text-ink-2">{p.period ? formatPeriod(p.period) : "—"}</Td>
              <Td className="text-right">{p.sessions !== undefined ? formatInt(p.sessions) : "—"}</Td>
              <Td className="text-right">{p.conversions !== undefined ? formatInt(p.conversions) : "—"}</Td>
              <Td className="text-right font-semibold">{formatRate(p.conversionRate)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="px-1 text-sm text-ink-2">
        Change {typeof metrics.relativeChange === "number" ? <span className="font-semibold text-ink">{formatChange(metrics.relativeChange)}</span> : "—"}
        {typeof metrics.absoluteChange === "number" ? ` (${(metrics.absoluteChange * 100).toFixed(2).replace("-", "−")} pp)` : ""}
        {pValue !== null ? ` · p ${pValue < 0.001 ? "< 0.001" : `= ${pValue.toFixed(3)}`}` : ""}
        {ci ? ` · 95% CI [${(ci[0]! * 100).toFixed(2).replace("-", "−")} pp, ${(ci[1]! * 100).toFixed(2).replace("-", "−")} pp]` : ""}
        {typeof metrics.isSignificant === "boolean" ? ` · ${metrics.isSignificant ? "significant" : "not significant"}` : ""}
      </p>
    </div>
  );
}

export function ReportSection({ detail, onEvidenceActive }: Props) {
  const report = detail.report;
  if (!report) {
    const failed = detail.status === "FAILED" || detail.status === "CANCELLED" || detail.status === "INTERRUPTED";
    return (
      <Card aria-labelledby="report-heading">
        <CardHeader id="report-heading" title="Report" />
        <div className="flex items-start gap-3 px-4 py-6 text-sm">
          {failed ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-degraded" /> : <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />}
          <p className="max-w-[65ch] text-ink-2">
            {failed ? (
              <>
                No report was produced: the run ended {detail.status.toLowerCase()}
                {detail.failureCode ? (
                  <>
                    {" "}
                    with <code className="font-mono text-xs text-ink">{detail.failureCode}</code>
                  </>
                ) : null}
                {detail.failureMessage ? `. ${detail.failureMessage}` : "."} The tool calls above are kept as the record of what was tried.
              </>
            ) : (
              "The report appears here when the agent submits it and it passes the grounding checks. Nothing is shown until then."
            )}
          </p>
        </div>
      </Card>
    );
  }

  const p = report.payload;
  return (
    <Card aria-labelledby="report-heading">
      <CardHeader id="report-heading" title="Report" actions={<span className="text-xs text-ink-2">Schema v{report.schemaVersion} · {p.provenance === "synthetic-demo" ? "Synthetic demo data" : p.provenance}</span>} />
      <div className="flex flex-col gap-4 p-4">
        <Block id="r-changed" title="What changed">
          <p className="max-w-[72ch] text-sm text-pretty">{p.whatChanged}</p>
          <p className="max-w-[72ch] text-sm text-pretty text-ink-2">
            <span className="font-semibold text-ink">Severity rationale.</span> {p.severityRationale}
          </p>
        </Block>

        <Block id="r-metrics" title="Key metrics">
          <KeyMetrics metrics={p.keyMetrics} />
        </Block>

        <Block id="r-observations" title="Observations">
          <ol className="flex list-none flex-col divide-y divide-hairline rounded-sm border border-hairline">
            {p.observations.map((o, i) => (
              <li key={i} className="flex flex-col gap-1.5 px-3 py-2.5">
                <p className="max-w-[72ch] text-sm text-pretty">{o.statement}</p>
                <Chips ids={o.evidenceIds} onActive={onEvidenceActive} />
              </li>
            ))}
          </ol>
        </Block>

        <Block id="r-hypotheses" title="Hypotheses">
          <p className="text-sm text-ink-2">
            <span className="font-semibold text-ink">Confidence is a rubric label, not a probability.</span> It follows the evidence rubric, not a calculated chance.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Hypothesis</Th>
                <Th>Status</Th>
                <Th>Confidence</Th>
                <Th>Supporting</Th>
                <Th>Contradicting</Th>
              </tr>
            </thead>
            <tbody>
              {p.hypotheses.map((h) => (
                <Tr key={h.id} className="align-top">
                  <Td className="min-w-72 align-top">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold">{h.id}</span>
                      <span className="text-xs text-ink-2">{humanize(h.category)}</span>
                    </div>
                    <p className="mt-1 max-w-[60ch] text-sm text-pretty">{h.statement}</p>
                    <p className="mt-1 max-w-[60ch] text-xs text-pretty text-ink-2">{h.confidenceRationale}</p>
                  </Td>
                  <Td className="align-top whitespace-nowrap">
                    <HypothesisStatus status={h.status} />
                  </Td>
                  <Td className="align-top font-semibold whitespace-nowrap">{h.confidence}</Td>
                  <Td className="align-top">
                    <Chips ids={h.supportingEvidenceIds} onActive={onEvidenceActive} />
                  </Td>
                  <Td className="align-top">
                    <Chips ids={h.contradictingEvidenceIds} onActive={onEvidenceActive} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Block>

        <Block id="r-unknowns" title="Unknowns">
          {p.unknowns.length === 0 ? (
            <p className="text-sm text-ink-2">The agent listed no open questions.</p>
          ) : (
            <ul className="flex list-none flex-col divide-y divide-hairline rounded-sm border border-hairline">
              {p.unknowns.map((u, i) => (
                <li key={i} className="px-3 py-2.5 text-sm">
                  <p className="font-medium">{u.question}</p>
                  <p className="text-ink-2">Why it matters: {u.whyItMatters}</p>
                  <p className="text-ink-2">To resolve: {u.howToResolve}</p>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block id="r-actions" title="Recommended actions">
          <ol className="flex list-none flex-col divide-y divide-hairline rounded-sm border border-hairline">
            {p.recommendedActions.map((a, i) => (
              <li key={i} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[64px_1fr] sm:gap-3">
                <span className="text-xs font-semibold text-ink-2 uppercase">{a.priority}</span>
                <div>
                  <p className="font-medium">{a.action}</p>
                  <p className="text-ink-2">{a.rationale}</p>
                  {a.hypothesisIds.length > 0 ? <p className="mt-1 font-mono text-xs text-ink-2">{a.hypothesisIds.join(", ")}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Block>

        {p.limitations.length > 0 ? (
          <Block id="r-limits" title="Limitations">
            <ul className="ml-4 list-disc text-sm text-ink-2">
              {p.limitations.map((text, i) => (
                <li key={i} className="max-w-[72ch] pl-1">
                  {text}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {p.securityNotes.length > 0 ? (
          <Block id="r-security" title="Security notes">
            <ul className="ml-4 list-disc text-sm text-ink-2">
              {p.securityNotes.map((text, i) => (
                <li key={i} className="max-w-[72ch] pl-1">
                  {text}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {p.toolFailures.length > 0 || p.validationWarnings.length > 0 ? (
          <Block id="r-quality" title="Data quality notes">
            <ul className="ml-4 list-disc text-sm text-ink-2">
              {p.toolFailures.map((f, i) => (
                <li key={`f${i}`} className="pl-1">
                  Tool <span className="font-mono text-xs">{f.tool}</span> failed with <span className="font-mono text-xs">{f.code}</span>: {f.message}
                </li>
              ))}
              {p.validationWarnings.map((w, i) => (
                <li key={`w${i}`} className="pl-1">
                  {w}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
      </div>
    </Card>
  );
}

const statusIcons = { supported: CircleCheck, plausible: TriangleAlert, weakened: TriangleAlert, ruled_out: CircleX } as const;

function HypothesisStatus({ status }: { status: keyof typeof statusIcons }) {
  const Icon = statusIcons[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
      <Icon aria-hidden className={`size-3.5 ${status === "supported" ? "text-ok" : status === "ruled_out" ? "text-ink-2" : "text-degraded"}`} />
      {humanize(status)}
    </span>
  );
}

/** Story 17: shown for completed demo runs only. The server computes it after completion; the agent never sees it. */
export function GroundTruth({ truth }: { truth: NonNullable<InvestigationDetail["groundTruth"]> }) {
  const Icon = truth.match ? CircleCheck : CircleX;
  return (
    <Card aria-labelledby="truth-heading">
      <CardHeader id="truth-heading" title="Ground truth check" />
      <div className="flex flex-col gap-2 px-4 py-4 text-sm">
        <p className={`inline-flex flex-wrap items-center gap-2 text-base font-semibold ${truth.match ? "text-ok" : "text-failed"}`}>
          <Icon aria-hidden className="size-5 shrink-0" />
          <span className="text-ink">
            Ground truth: {truth.expectedCategory ? humanize(truth.expectedCategory) : "no single cause"} — agent: {truth.agentTopCategory ? humanize(truth.agentTopCategory) : "none"}
          </span>
          <span>{truth.match ? "Match" : "No match"}</span>
        </p>
        <p className="max-w-[72ch] text-ink-2">
          The dataset knows the cause it was built with. Accepted verdicts: {truth.expectedVerdict.replace(/_/g, " ")}; the agent reported {truth.agentVerdict.replace(/_/g, " ")}. Computed after the run finished; the agent never receives it.
        </p>
      </div>
    </Card>
  );
}

export function RawJson({ detail }: { detail: InvestigationDetail }) {
  return (
    <Card aria-labelledby="raw-heading">
      <CardHeader id="raw-heading" title="Raw JSON" actions={<DownloadJson value={detail} filename={`investigation-${detail.id}.json`} />} />
      <div className="p-3">
        <JsonView value={detail} label="Show the full investigation record (run, budgets, tool executions, evidence, report)" />
      </div>
    </Card>
  );
}
