import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ProvenanceBadge, ModeBadge, RuntimeBadge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getHealth, listRecentInvestigations, type InvestigationListItem } from "@/lib/api";
import { URL_SCOPE_STATEMENT, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 8;

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Start an investigation into a conversion drop, or reopen a recent run." />
      <Suspense fallback={<Skeleton className="mt-3 h-4 w-80" />}>
        <HealthLine />
      </Suspense>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="entry-demo" className="flex flex-col">
          <div className="h-1.5 bg-stratum-metrics" aria-hidden />
          <div className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="entry-demo" className="text-lg font-semibold">
                Demo investigation
              </h2>
              <ProvenanceBadge provenance="synthetic-demo" />
            </div>
            <p className="max-w-[60ch] text-sm text-ink-2">
              Pick a campaign whose conversion rate dropped. The agent compares periods, checks tracking, the landing page and the change log,
              and reports what changed with every claim tied to evidence.
            </p>
            <p className="max-w-[60ch] text-xs text-pretty text-ink-2">
              Campaigns, numbers and faults are generated (dataset <code className="font-mono">synthetic-demo-v1</code>). Nothing comes from a real ad account.
            </p>
            <div className="mt-auto pt-2">
              <ButtonLink href="/campaigns" variant="primary">
                Choose a demo campaign
                <ArrowRight aria-hidden />
              </ButtonLink>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="entry-url" className="flex flex-col">
          <div className="h-1.5 bg-stratum-http" aria-hidden />
          <form action="/investigate/url" method="get" className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="entry-url" className="text-lg font-semibold">
                URL investigation
              </h2>
              <ProvenanceBadge provenance="live-http" />
            </div>
            <p className="max-w-[60ch] text-sm text-ink-2">{URL_SCOPE_STATEMENT}</p>
            <div className="mt-auto flex flex-col gap-1.5 pt-2">
              <label htmlFor="entry-url-input" className="text-xs font-semibold">
                Public page URL
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="entry-url-input"
                  name="url"
                  type="url"
                  inputMode="url"
                  required
                  placeholder="https://example.com/landing"
                  className="h-9 w-full min-w-0 rounded-sm border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-ink-3 hover:border-ink-2 sm:flex-1"
                />
                <button type="submit" className={buttonClass("secondary")}>
                  <Search aria-hidden />
                  Check this URL
                </button>
              </div>
            </div>
          </form>
        </Card>
      </div>

      <Card aria-labelledby="recent-runs" className="mt-8">
        <CardHeader
          id="recent-runs"
          title="Recent investigations"
          actions={
            <Link href="/investigations" className="text-sm font-semibold text-ink underline decoration-hairline hover:decoration-ink">
              All investigations
            </Link>
          }
        />
        <Suspense fallback={<SkeletonRows rows={4} label="Loading recent investigations" />}>
          <RecentInvestigations />
        </Suspense>
      </Card>
    </>
  );
}

async function RecentInvestigations() {
  const result = await listRecentInvestigations(RECENT_LIMIT);
  if (!result.ok) return <ErrorState code={result.error.code} message={result.error.message} />;
  if (result.data.items.length === 0) {
    return (
      <EmptyState
        message="No investigations yet — start one from a demo campaign or a URL."
        action={
          <>
            <ButtonLink href="/campaigns">Demo campaigns</ButtonLink>
            <ButtonLink href="/investigate/url">URL check</ButtonLink>
          </>
        }
      />
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Target</Th>
          <Th>Mode</Th>
          <Th>Data</Th>
          <Th>Runtime</Th>
          <Th>Status</Th>
          <Th>Verdict</Th>
          <Th className="text-right">Created</Th>
        </tr>
      </thead>
      <tbody>
        {result.data.items.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </tbody>
    </Table>
  );
}

function RunRow({ run }: { run: InvestigationListItem }) {
  const target = run.campaignName ?? run.targetUrl ?? run.campaignId ?? run.id;
  return (
    <Tr>
      <Td className="max-w-80">
        <Link href={`/investigations/${run.id}`} className="block truncate font-medium text-ink underline decoration-hairline hover:decoration-ink">
          {target}
        </Link>
      </Td>
      <Td>
        <ModeBadge mode={run.mode} />
      </Td>
      <Td>
        <ProvenanceBadge provenance={run.provenance} />
      </Td>
      <Td>
        <RuntimeBadge runtime={run.runtime} model={run.model} />
      </Td>
      <Td>
        <StatusBadge status={run.status} />
      </Td>
      <Td className="text-ink-2">{run.verdict ?? "—"}</Td>
      <Td className="text-right whitespace-nowrap text-ink-2">
        <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
      </Td>
    </Tr>
  );
}

const runtimeText = {
  claude: { available: "Claude available", missing_key: "Claude: no API key" },
  openclaw: { configured: "OpenClaw configured", not_configured: "OpenClaw not configured" },
  browser: { available: "browser checks available", unavailable: "browser checks unavailable" },
} as const;

async function HealthLine() {
  const result = await getHealth();
  if (!result.ok) {
    return (
      <p className="mt-3 text-sm text-failed" role="status">
        API unavailable · <code className="font-mono text-xs">{result.error.code}</code>
      </p>
    );
  }
  const h = result.data;
  return (
    <p className={`mt-3 text-sm ${h.status === "ok" ? "text-ink-2" : "text-degraded"}`} role="status">
      <span className="font-semibold">API {h.status === "ok" ? "healthy" : "degraded"}</span> · database {h.db} · deterministic runtime available ·{" "}
      {runtimeText.claude[h.runtimes.claude]} · {runtimeText.openclaw[h.runtimes.openclaw]} · {runtimeText.browser[h.runtimes.browser]}
    </p>
  );
}
