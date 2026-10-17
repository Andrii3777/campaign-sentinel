import type { CampaignDetail } from "@campaign-sentinel/contracts";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatInt, formatRate } from "@/lib/format";

type Segments = CampaignDetail["sources"];

const share = (v: number) => `${(v * 100).toFixed(0)}%`;

/** One dimension (traffic source or device): traffic share and conversion rate in both periods, so a mix shift is visible next to a rate drop. */
export function SegmentTable({ id, title, dimension, segments }: { id: string; title: string; dimension: string; segments: Segments }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader id={id} title={title} />
      {segments.length === 0 ? (
        <EmptyState message={`No ${dimension} data for the default periods.`} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{dimension}</Th>
              <Th className="text-right">Share</Th>
              <Th className="text-right">Conversion rate</Th>
              <Th className="text-right">Sessions</Th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <Tr key={s.segment}>
                <Td className="font-medium">{s.segment}</Td>
                <Td className="text-right whitespace-nowrap text-ink-2">
                  {share(s.baseline.share)} → {share(s.current.share)}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <span className="text-ink-2">{formatRate(s.baseline.conversionRate)}</span> → <span className="font-semibold">{formatRate(s.current.conversionRate)}</span>
                </Td>
                <Td className="text-right whitespace-nowrap text-ink-2">
                  {formatInt(s.baseline.sessions)} → {formatInt(s.current.sessions)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
