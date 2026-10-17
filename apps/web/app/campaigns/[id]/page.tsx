import { DEFAULT_QUESTION } from "@campaign-sentinel/contracts";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { ChangeLog } from "@/components/campaign/change-log";
import { KpiStrip } from "@/components/campaign/kpi-strip";
import { PastRuns } from "@/components/campaign/past-runs";
import { SegmentTable } from "@/components/campaign/segment-table";
import { StartForm } from "@/components/campaign/start-form";
import { TrendChart } from "@/components/campaign/trend-chart-loader";
import { Badge, ProvenanceBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { getCampaign, getHealth, listCampaignInvestigations } from "@/lib/api";
import { formatPeriod } from "@/lib/format";
import { runtimeOptions } from "@/lib/runtime-options";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Campaign ${id}` };
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, health, runs] = await Promise.all([getCampaign(id), getHealth(), listCampaignInvestigations(id)]);

  if (!campaign.ok) {
    return (
      <div className="pt-8">
        <Card>
          <ErrorState code={campaign.error.code} message={campaign.error.message} />
          <div className="px-4 pb-6">
            <ButtonLink href="/campaigns">Back to campaigns</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  const c = campaign.data;
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.channels} · conversion event: ${c.conversionEvent} · data ${formatPeriod(c.dataRange)}`}
        actions={
          <ButtonLink href="#investigate" variant="primary">
            Investigate this campaign
          </ButtonLink>
        }
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ProvenanceBadge provenance={c.provenance} />
        {c.simulatedFaults.map((fault) => (
          <Badge key={fault.tool} icon={TriangleAlert} tone="degraded" title={fault.message}>
            Simulated fault: <span className="font-mono">{fault.tool}</span>
          </Badge>
        ))}
      </div>
      {c.simulatedFaults.length > 0 ? (
        <ul className="mt-2 max-w-[72ch] list-none text-xs text-ink-2">
          {c.simulatedFaults.map((fault) => (
            <li key={fault.tool}>{fault.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <KpiStrip kpis={c.kpis} />
          <Card aria-labelledby="trend-heading">
            <CardHeader id="trend-heading" title="Daily trend" actions={<span className="text-xs text-ink-2">{c.daily.length} days with data</span>} />
            <div className="p-4">
              <TrendChart daily={c.daily} baseline={c.defaultPeriods.baseline} current={c.defaultPeriods.current} />
            </div>
          </Card>
          <div className="grid gap-6">
            <SegmentTable id="sources-heading" title="Traffic sources" dimension="Source" segments={c.sources} />
            <SegmentTable id="devices-heading" title="Devices" dimension="Device" segments={c.devices} />
          </div>
          <ChangeLog entries={c.changeLog} />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-4">
          <StartForm campaignId={c.id} defaultQuestion={DEFAULT_QUESTION} defaultPeriods={c.defaultPeriods} dataRange={c.dataRange} runtimes={runtimeOptions(health)} />
          {runs.ok ? (
            <PastRuns runs={runs.data} />
          ) : (
            <Card>
              <ErrorState code={runs.error.code} message={runs.error.message} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
