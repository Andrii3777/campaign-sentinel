import type { InvestigationDetail } from "@campaign-sentinel/contracts";
import type { ReactNode } from "react";
import { Laptop, Link2, Terminal } from "lucide-react";
import Link from "next/link";
import { Badge, ModeBadge, ProvenanceBadge, RuntimeBadge, StatusBadge } from "@/components/ui/badge";
import { formatDateTime, formatDuration, formatInt, formatPeriod } from "@/lib/format";
import { RunActions } from "./run-actions";

const sources = { web: ["Web UI", Laptop], api: ["REST API", Link2], mcp: ["MCP client", Terminal] } as const;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function Budget({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const over = limit !== null && used >= limit;
  return (
    <Fact label={label}>
      <span className={over ? "font-semibold text-degraded" : ""}>{formatInt(used)}</span>
      <span className="text-ink-2"> / {limit === null ? "no limit" : formatInt(limit)}</span>
    </Fact>
  );
}

/** What this run is, where it came from, how long it took and how much of each budget it used. All values are the ledger's. */
export function InvestigationHeader({ detail, onChanged }: { detail: InvestigationDetail; onChanged: () => void }) {
  const [sourceLabel, SourceIcon] = sources[detail.source];
  const client = [detail.clientName, detail.clientVersion].filter(Boolean).join(" ");
  const title = detail.campaignName ?? detail.targetUrl ?? detail.id;
  return (
    <header className="flex flex-col gap-4 border-b border-hairline pt-8 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold break-words">{title}</h1>
          <p className="max-w-[72ch] text-sm text-ink-2">{detail.question}</p>
        </div>
        <RunActions detail={detail} onChanged={onChanged} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={detail.status} />
        <ModeBadge mode={detail.mode} />
        <ProvenanceBadge provenance={detail.provenance} />
        <RuntimeBadge runtime={detail.runtime} model={detail.model} />
        <Badge icon={SourceIcon}>{sourceLabel}</Badge>
        {client ? <Badge title="Client name and version">{client}</Badge> : null}
        {detail.model ? (
          <Badge title="Model that ran this investigation">
            <span className="font-mono">{detail.model}</span>
          </Badge>
        ) : null}
        {detail.retryOfId ? (
          <Link href={`/investigations/${detail.retryOfId}`} className="text-xs text-ink-2 underline decoration-hairline hover:text-ink hover:decoration-ink">
            Retry of an earlier run
          </Link>
        ) : null}
        {detail.retryIds.map((id) => (
          <Link key={id} href={`/investigations/${id}`} className="text-xs text-ink-2 underline decoration-hairline hover:text-ink hover:decoration-ink">
            Retried as <span className="font-mono">{id.slice(-6)}</span>
          </Link>
        ))}
      </div>

      {detail.status === "FAILED" || detail.status === "INTERRUPTED" ? (
        <p role="note" className="max-w-[72ch] text-sm text-failed">
          <span className="font-semibold">{detail.status === "FAILED" ? "Run failed" : "Run interrupted"}</span>
          {detail.failureCode ? <span className="font-mono text-xs"> {detail.failureCode}</span> : null}
          {detail.failureMessage ? <span className="text-ink"> — {detail.failureMessage}</span> : null}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Created">
          <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
        </Fact>
        <Fact label="Started">{detail.startedAt ? <time dateTime={detail.startedAt}>{formatDateTime(detail.startedAt)}</time> : "not yet"}</Fact>
        <Fact label="Finished">{detail.finishedAt ? <time dateTime={detail.finishedAt}>{formatDateTime(detail.finishedAt)}</time> : "in progress"}</Fact>
        <Fact label="Duration">{formatDuration(detail.durationMs)}</Fact>
        {detail.periods ? (
          <>
            <Fact label="Baseline period">
              <span className="font-mono text-xs">{formatPeriod(detail.periods.baseline)}</span>
            </Fact>
            <Fact label="Current period">
              <span className="font-mono text-xs">{formatPeriod(detail.periods.current)}</span>
            </Fact>
          </>
        ) : null}
        <Budget label="Tool calls" used={detail.counters.toolCalls} limit={detail.budgets.toolCalls} />
        <Budget label="Model turns" used={detail.counters.modelTurns} limit={detail.budgets.modelTurns} />
        <Budget label="Report attempts" used={detail.counters.reportAttempts} limit={detail.budgets.reportAttempts} />
        {detail.mode === "url" ? <Budget label="HTTP requests" used={detail.counters.httpRequests} limit={detail.budgets.httpRequests} /> : null}
        {detail.counters.inputTokens + detail.counters.outputTokens > 0 ? (
          <Fact label="Tokens in / out">
            {formatInt(detail.counters.inputTokens)} / {formatInt(detail.counters.outputTokens)}
          </Fact>
        ) : null}
      </dl>
    </header>
  );
}
