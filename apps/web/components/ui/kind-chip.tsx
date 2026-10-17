import type { EvidenceKind, ToolName } from "@campaign-sentinel/contracts";

export type Stratum = "metrics" | "tracking" | "http" | "context" | "report";
export type Kind = EvidenceKind | "report";

const strata: Record<Kind, Stratum> = {
  metric: "metrics",
  comparison: "metrics",
  trend: "metrics",
  segment: "metrics",
  data_quality: "metrics",
  tracking: "tracking",
  landing_page: "http",
  http: "http",
  content: "http",
  links: "http",
  browser: "http",
  availability: "http",
  change_log: "context",
  report: "report",
};

/** Fill class per stratum; the core strip (ticket 08) uses the same mapping. */
export const stratumFill: Record<Stratum, string> = {
  metrics: "bg-stratum-metrics",
  tracking: "bg-stratum-tracking",
  http: "bg-stratum-http",
  context: "bg-stratum-context",
  report: "bg-stratum-report",
};

export function stratumOf(kind: Kind): Stratum {
  return strata[kind];
}

/** The one ToolName → stratum mapping: the core strip layers and tool cells use it. A tool this build does not know falls back to metrics. */
const toolStrata: Record<ToolName, Stratum> = {
  get_campaign_overview: "metrics",
  compare_periods: "metrics",
  get_daily_trend: "metrics",
  breakdown_by_segment: "metrics",
  inspect_tracking_health: "tracking",
  check_landing_page: "http",
  get_change_log: "context",
  fetch_page: "http",
  measure_availability: "http",
  check_links: "http",
  browser_check: "http",
  submit_report: "report",
};

export function stratumOfTool(tool: string): Stratum {
  return (toolStrata as Record<string, Stratum>)[tool] ?? "metrics";
}

/** Kind label with its strata swatch: the text names the kind, the swatch ties it to the core strip. */
export function KindChip({ kind }: { kind: Kind }) {
  return (
    <span className="inline-flex h-6 items-stretch gap-1.5 overflow-hidden rounded-sm border border-hairline bg-surface pr-2 text-xs text-ink">
      <span aria-hidden className={`w-2 ${stratumFill[stratumOf(kind)]}`} />
      <span className="self-center">{kind.replace("_", " ")}</span>
    </span>
  );
}
