import type { CampaignDetail } from "@campaign-sentinel/contracts";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, humanize } from "@/lib/format";

/** Recorded changes (deploys, tracking, traffic, budget) newest first: the context an investigation correlates against. */
export function ChangeLog({ entries }: { entries: CampaignDetail["changeLog"] }) {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card aria-labelledby="changelog-heading">
      <CardHeader id="changelog-heading" title="Change log" actions={<span className="text-xs text-ink-2">{entries.length} recorded</span>} />
      {sorted.length === 0 ? (
        <EmptyState message="No changes are recorded for this campaign." />
      ) : (
        <ol className="list-none">
          {sorted.map((entry) => (
            <li key={`${entry.at}-${entry.title}`} className="grid gap-x-4 gap-y-0.5 border-b border-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[148px_88px_1fr]">
              <time dateTime={entry.at} className="font-mono text-xs text-ink-2">
                {formatDateTime(entry.at)}
              </time>
              <span className="flex items-start gap-1.5 text-xs font-semibold">
                <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-[2px] bg-stratum-context" />
                {humanize(entry.category)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{entry.title}</p>
                <p className="max-w-[65ch] text-sm text-pretty text-ink-2">
                  {entry.description}
                  {entry.author ? <span> · {entry.author}</span> : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
