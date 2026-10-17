import type { CampaignListItem } from "@campaign-sentinel/contracts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatChange, formatInt, formatPeriod, formatRate } from "@/lib/format";

/** Direction as icon + signed number; a fall in conversion rate is the thing being investigated, so it reads as a warning, not as red alarm. */
export function ChangeMark({ change }: { change: number | null }) {
  if (change === null) return <span className="text-ink-2">—</span>;
  const Icon = change < -0.005 ? ArrowDownRight : change > 0.005 ? ArrowUpRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${change < -0.005 ? "text-degraded" : "text-ink"}`}>
      <Icon aria-hidden className="size-3.5" />
      {formatChange(change)}
    </span>
  );
}

/** Baseline and current period side by side: dates, sessions, tracked conversions, conversion rate, and the relative change. */
export function KpiStrip({ kpis }: { kpis: CampaignListItem["kpis"] }) {
  return (
    <Card aria-labelledby="kpi-heading">
      <CardHeader id="kpi-heading" title="Key figures by period" />
      <Table>
        <thead>
          <tr>
            <Th>Period</Th>
            <Th>Dates</Th>
            <Th className="text-right">Sessions</Th>
            <Th className="text-right">Tracked conversions</Th>
            <Th className="text-right">Conversion rate</Th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Baseline", kpis.baseline],
              ["Current", kpis.current],
            ] as const
          ).map(([label, p]) => (
            <Tr key={label}>
              <Td className="font-medium">{label}</Td>
              <Td className="font-mono text-xs whitespace-nowrap text-ink-2">{formatPeriod(p.period)}</Td>
              <Td className="text-right">{formatInt(p.sessions)}</Td>
              <Td className="text-right">{formatInt(p.trackedConversions)}</Td>
              <Td className="text-right text-base font-semibold">{formatRate(p.conversionRate)}</Td>
            </Tr>
          ))}
          <Tr>
            <Td className="font-medium">Change</Td>
            <Td />
            <Td className="text-right text-ink-2">{formatChange(kpis.baseline.sessions ? (kpis.current.sessions - kpis.baseline.sessions) / kpis.baseline.sessions : null)}</Td>
            <Td className="text-right text-ink-2">
              {formatChange(kpis.baseline.trackedConversions ? (kpis.current.trackedConversions - kpis.baseline.trackedConversions) / kpis.baseline.trackedConversions : null)}
            </Td>
            <Td className="text-right">
              <ChangeMark change={kpis.relativeChange} />
            </Td>
          </Tr>
        </tbody>
      </Table>
    </Card>
  );
}
