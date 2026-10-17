import { InvestigationListResponseSchema, InvestigationModeSchema, InvestigationStatusSchema } from "@campaign-sentinel/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HistoryTable } from "@/components/history/history-table";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiGetParsed } from "@/lib/api";
import { historyQuery, type HistoryFilters } from "@/lib/api-client";
import { humanize } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Investigations" };

type SearchParams = Promise<{ mode?: string | string[]; status?: string | string[] }>;

const selectClass = "h-9 min-w-36 rounded-sm border border-hairline bg-surface px-2.5 text-sm text-ink hover:border-ink-2";
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Only values the API knows reach the query; anything else in the URL is ignored. */
function readFilters(params: Awaited<SearchParams>): HistoryFilters {
  const mode = InvestigationModeSchema.safeParse(first(params.mode));
  const status = InvestigationStatusSchema.safeParse(first(params.status));
  return { mode: mode.success ? mode.data : undefined, status: status.success ? status.data : undefined };
}

export default async function InvestigationsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = readFilters(await searchParams);
  const filtered = Boolean(filters.mode || filters.status);
  return (
    <>
      <PageHeader title="Investigations" description="Every run, newest first: target, runtime and source, status, verdict, severity and duration." />
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3" aria-label="Filter investigations">
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-mode" className="text-xs font-semibold">
            Mode
          </label>
          <select id="filter-mode" name="mode" defaultValue={filters.mode ?? ""} className={selectClass}>
            <option value="">All modes</option>
            <option value="demo">Demo campaign</option>
            <option value="url">URL</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-status" className="text-xs font-semibold">
            Status
          </label>
          <select id="filter-status" name="status" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">All statuses</option>
            {InvestigationStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {humanize(status.toLowerCase())}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass("secondary")}>
          Apply filters
        </button>
        {filtered ? (
          <Link href="/investigations" className="inline-flex h-9 items-center text-sm font-semibold underline decoration-hairline hover:decoration-ink">
            Clear filters
          </Link>
        ) : null}
      </form>

      <Card className="mt-4" aria-label="Investigation history">
        <Suspense key={`${filters.mode}-${filters.status}`} fallback={<SkeletonRows rows={6} label="Loading investigations" />}>
          <Rows filters={filters} />
        </Suspense>
      </Card>
    </>
  );
}

async function Rows({ filters }: { filters: HistoryFilters }) {
  const result = await apiGetParsed(historyQuery(filters), InvestigationListResponseSchema, "investigations");
  if (!result.ok) return <ErrorState code={result.error.code} message={result.error.message} />;
  if (result.data.items.length === 0) {
    return filters.mode || filters.status ? (
      <EmptyState
        message="No investigations match these filters."
        action={<ButtonLink href="/investigations">Clear filters</ButtonLink>}
      />
    ) : (
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
  return <HistoryTable initialItems={result.data.items} initialCursor={result.data.nextCursor} filters={filters} />;
}
