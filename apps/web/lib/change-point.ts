/**
 * The dashed "contact" line of the trend chart: the single split of the daily series that maximises the between-segment
 * difference, drawn only when the means differ by at least 15 % (same rule as the agent's get_daily_trend tool).
 * shortcut: mirrors apps/api analysis `detectChangePoint` because the campaign DTO carries no change point; move it into contracts if a third caller appears.
 */
export type DailyRate = { date: string; trackedConversionRate: number | null };
export type Contact = { date: string; meanBefore: number; meanAfter: number; relativeChange: number };

const MIN_SEGMENT = 3;
const CLEAR_CHANGE = 0.15;

export function findContact(daily: readonly DailyRate[]): Contact | null {
  const points = daily.filter((d): d is { date: string; trackedConversionRate: number } => d.trackedConversionRate !== null);
  const n = points.length;
  if (n < 2 * MIN_SEGMENT) return null;
  const prefix = [0];
  for (const p of points) prefix.push(prefix[prefix.length - 1]! + p.trackedConversionRate);
  let best: { index: number; meanBefore: number; meanAfter: number; score: number } | null = null;
  for (let i = MIN_SEGMENT; i <= n - MIN_SEGMENT; i++) {
    const meanBefore = prefix[i]! / i;
    const meanAfter = (prefix[n]! - prefix[i]!) / (n - i);
    const score = ((i * (n - i)) / n) * (meanBefore - meanAfter) ** 2;
    if (best === null || score > best.score) best = { index: i, meanBefore, meanAfter, score };
  }
  if (!best || best.meanBefore === 0) return null;
  const relativeChange = (best.meanAfter - best.meanBefore) / best.meanBefore;
  if (Math.abs(relativeChange) < CLEAR_CHANGE) return null;
  return { date: points[best.index]!.date, meanBefore: best.meanBefore, meanAfter: best.meanAfter, relativeChange };
}
