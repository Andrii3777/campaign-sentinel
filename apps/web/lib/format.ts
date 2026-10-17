/** Verbatim from spec story 38: shown with every URL form and in URL reports. */
export const URL_SCOPE_STATEMENT =
  "A URL gives access only to what the site publicly serves — status, timing, content, links, tags. It does not reveal ad spend, clicks, conversions or private analytics.";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

const integer = new Intl.NumberFormat("en-US");
export function formatInt(value: number): string {
  return integer.format(value);
}

/** Conversion rates are fractions in the API: 0.0419 → "4.19%". */
export function formatRate(rate: number | null | undefined, digits = 2): string {
  return rate === null || rate === undefined ? "—" : `${(rate * 100).toFixed(digits)}%`;
}

/** Relative change as a signed percentage with a real minus sign: −56.0%. */
export function formatChange(change: number | null | undefined, digits = 1): string {
  if (change === null || change === undefined) return "—";
  const pct = (change * 100).toFixed(digits);
  return change > 0 ? `+${pct}%` : `${pct.replace("-", "−")}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Offset of an event from the start of the run: "+0.071 s". */
export function formatOffset(fromIso: string, atIso: string): string {
  const ms = Math.max(0, new Date(atIso).getTime() - new Date(fromIso).getTime());
  return Number.isNaN(ms) ? "—" : `+${(ms / 1000).toFixed(3)} s`;
}

/** "2026-10-03" → "3 Oct". Dates in the API are calendar days (UTC), never shifted by the browser's zone. */
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

export function formatPeriod(period: { start: string; end: string }): string {
  return `${period.start} → ${period.end}`;
}

export function humanize(code: string): string {
  const text = code.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
