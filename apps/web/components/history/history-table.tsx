"use client";

import type { InvestigationListItem } from "@campaign-sentinel/contracts";
import Link from "next/link";
import { useState } from "react";
import { ModeBadge, StatusBadge, RuntimeBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { loadMoreInvestigations, type HistoryFilters } from "@/lib/api-client";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";

/** Who started the run: the source and, for MCP clients, the client's own name and version. */
function origin(run: InvestigationListItem): string {
  const client = run.clientName ? `${run.clientName}${run.clientVersion ? ` ${run.clientVersion}` : ""}` : null;
  return client ? `${run.source} · ${client}` : run.source;
}

function Row({ run }: { run: InvestigationListItem }) {
  const target = run.campaignName ?? run.targetUrl ?? run.campaignId ?? run.id;
  return (
    <Tr>
      <Td className="max-w-72 min-w-44">
        <Link href={`/investigations/${run.id}`} className="block truncate font-medium text-ink underline decoration-hairline hover:decoration-ink" title={target}>
          {target}
        </Link>
      </Td>
      <Td>
        <ModeBadge mode={run.mode} />
      </Td>
      <Td>
        <div className="flex flex-col items-start gap-1">
          <RuntimeBadge runtime={run.runtime} model={run.model} />
          <span className="text-xs text-ink-2">{origin(run)}</span>
        </div>
      </Td>
      <Td>
        <StatusBadge status={run.status} />
      </Td>
      <Td className="whitespace-nowrap text-ink-2">{run.verdict ? humanize(run.verdict) : "—"}</Td>
      <Td className="whitespace-nowrap text-ink-2">{run.severity ? humanize(run.severity) : "—"}</Td>
      <Td className="text-right whitespace-nowrap text-ink-2 tabular-nums">{formatDuration(run.durationMs)}</Td>
      <Td className="text-right whitespace-nowrap text-ink-2">
        <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
      </Td>
    </Tr>
  );
}

/** The first page comes from the server render; "Load more" appends the next page with the same filters. */
export function HistoryTable({ initialItems, initialCursor, filters }: { initialItems: InvestigationListItem[]; initialCursor: string | null; filters: HistoryFilters }) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const result = await loadMoreInvestigations(filters, cursor);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // A run created meanwhile can shift a page boundary; keep each id once.
    setItems((current) => {
      const seen = new Set(current.map((run) => run.id));
      return [...current, ...result.data.items.filter((run) => !seen.has(run.id))];
    });
    setCursor(result.data.nextCursor);
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Target</Th>
            <Th>Mode</Th>
            <Th>Runtime · source</Th>
            <Th>Status</Th>
            <Th>Verdict</Th>
            <Th>Severity</Th>
            <Th className="text-right">Duration</Th>
            <Th className="text-right">Created</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((run) => (
            <Row key={run.id} run={run} />
          ))}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p role="status" className="text-xs text-ink-2">
          {items.length} {items.length === 1 ? "run" : "runs"} shown{cursor ? "" : ", end of list"}
        </p>
        {error ? (
          <p role="alert" className="text-xs text-failed">
            <code className="font-mono">{error.code}</code> {error.message}
          </p>
        ) : null}
        {cursor ? (
          <Button onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : error ? "Retry" : "Load more"}
          </Button>
        ) : null}
      </div>
    </>
  );
}
