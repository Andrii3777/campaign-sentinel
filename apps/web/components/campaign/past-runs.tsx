import type { InvestigationListItem } from "@campaign-sentinel/contracts";
import Link from "next/link";
import { RuntimeBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, formatDuration, humanize } from "@/lib/format";

/** Earlier investigations of this campaign, newest first. */
export function PastRuns({ runs }: { runs: readonly InvestigationListItem[] }) {
  return (
    <Card aria-labelledby="past-runs-heading">
      <CardHeader id="past-runs-heading" title="Past investigations" />
      {runs.length === 0 ? (
        <EmptyState message="No investigations for this campaign yet. Start one with the form." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Started</Th>
              <Th>Status</Th>
              <Th>Verdict</Th>
              <Th>Runtime</Th>
              <Th className="text-right">Duration</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Tr key={run.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/investigations/${run.id}`} className="font-medium underline decoration-hairline hover:decoration-ink">
                    <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={run.status} />
                </Td>
                <Td className="text-ink-2">{run.verdict ? `${humanize(run.verdict)}${run.severity ? ` · ${run.severity}` : ""}` : "—"}</Td>
                <Td>
                  <RuntimeBadge runtime={run.runtime} model={run.model} />
                </Td>
                <Td className="text-right whitespace-nowrap text-ink-2">{formatDuration(run.durationMs)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
