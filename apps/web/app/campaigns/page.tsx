import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChangeMark } from "@/components/campaign/kpi-strip";
import { Badge, ProvenanceBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { listCampaigns } from "@/lib/api";
import { formatRate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Synthetic demo campaigns generated for this project. Open one to see its figures and send the agent to find out why its conversion rate moved."
      />
      <Card className="mt-6" aria-label="Demo campaigns">
        <Suspense fallback={<SkeletonRows rows={5} label="Loading campaigns" />}>
          <CampaignRows />
        </Suspense>
      </Card>
    </>
  );
}

async function CampaignRows() {
  const result = await listCampaigns();
  if (!result.ok) return <ErrorState code={result.error.code} message={result.error.message} />;
  if (result.data.length === 0) {
    return <EmptyState message="No demo campaigns are seeded. Run pnpm db:seed, then reload." />;
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Campaign</Th>
          <Th>Data</Th>
          <Th className="text-right">Conversion rate, baseline → current</Th>
          <Th className="text-right">Change</Th>
          <Th>Flags</Th>
          <Th>
            <span className="sr-only">Action</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {result.data.map((c) => (
          <Tr key={c.id}>
            <Td className="min-w-56">
              <Link href={`/campaigns/${c.id}`} className="font-medium text-ink underline decoration-hairline hover:decoration-ink">
                {c.name}
              </Link>
              <p className="text-xs text-ink-2">{c.channels}</p>
            </Td>
            <Td>
              <ProvenanceBadge provenance={c.provenance} />
            </Td>
            <Td className="text-right whitespace-nowrap">
              <span className="text-ink-2">{formatRate(c.kpis.baseline.conversionRate)}</span> → <span className="font-semibold">{formatRate(c.kpis.current.conversionRate)}</span>
            </Td>
            <Td className="text-right">
              <ChangeMark change={c.kpis.relativeChange} />
            </Td>
            <Td>
              {c.hasSimulatedFault ? (
                <Badge icon={TriangleAlert} tone="degraded" title="A tool is set to fail on this campaign so the agent's handling of tool errors can be seen.">
                  Simulated tool fault
                </Badge>
              ) : (
                <span className="text-xs text-ink-2">none</span>
              )}
            </Td>
            <Td className="text-right">
              <ButtonLink href={`/campaigns/${c.id}#investigate`} variant="secondary">
                Investigate
              </ButtonLink>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
