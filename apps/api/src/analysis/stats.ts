/** Deterministic statistics for the demo tools. Pure functions; rates are fractions (0.042 = 4.2%). */

export interface Counts {
  sessions: number;
  conversions: number;
}

export interface CrStats extends Counts {
  cr: number;
  standardError: number;
}

export function crStats({ sessions, conversions }: Counts): CrStats {
  const cr = sessions > 0 ? conversions / sessions : 0;
  const standardError = sessions > 0 ? Math.sqrt((cr * (1 - cr)) / sessions) : 0;
  return { sessions, conversions, cr, standardError };
}

// Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** erfc(x) for x ≥ 0 with a relative error below 1.2e-7 everywhere, tails included (Numerical Recipes erfcc). */
function erfc(x: number): number {
  const t = 1 / (1 + 0.5 * x);
  const poly = -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  return t * Math.exp(poly);
}

const MIN_P_VALUE = 1e-16;

/** Two-sided tail probability of a standard normal z, floored at 1e-16 (never 0). */
export function twoSidedPValue(z: number): number {
  return Math.min(1, Math.max(MIN_P_VALUE, erfc(Math.abs(z) / Math.SQRT2)));
}

/** "p < 0.001" below 0.001, otherwise "p = 0.012": a report must never read "p = 0". */
export function formatPValue(p: number): string {
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

const Z_975 = 1.959963984540054;
const Z_80 = 0.8416212335729143;

export interface ZTestResult {
  baseline: CrStats;
  current: CrStats;
  /** current CR − baseline CR */
  difference: number;
  relativeChange: number | null;
  z: number;
  pValue: number;
  /** 95% CI of the difference (unpooled standard error) */
  ci95: [number, number];
  isSignificant: boolean;
}

/** Two-sided two-proportion z-test (pooled SE for z, unpooled SE for the CI). */
export function twoProportionZTest(baseline: Counts, current: Counts): ZTestResult {
  const a = crStats(baseline);
  const b = crStats(current);
  const difference = b.cr - a.cr;
  const pooled = (a.conversions + b.conversions) / (a.sessions + b.sessions || 1);
  const sePooled =
    a.sessions > 0 && b.sessions > 0 ? Math.sqrt(pooled * (1 - pooled) * (1 / a.sessions + 1 / b.sessions)) : 0;
  const z = sePooled > 0 ? difference / sePooled : 0;
  const pValue = sePooled > 0 ? twoSidedPValue(z) : 1;
  const se = Math.sqrt(a.standardError ** 2 + b.standardError ** 2);
  return {
    baseline: a,
    current: b,
    difference,
    relativeChange: a.cr > 0 ? difference / a.cr : null,
    z,
    pValue,
    ci95: [difference - Z_975 * se, difference + Z_975 * se],
    isSignificant: pValue < 0.05,
  };
}

export interface SegmentCounts {
  key: string;
  baseline: Counts;
  current: Counts;
}

export interface SegmentEffect {
  key: string;
  shareBaseline: number;
  shareCurrent: number;
  crBaseline: number;
  crCurrent: number;
  mixEffect: number;
  rateEffect: number;
  /** mixEffect + rateEffect; segment contributions sum to the total change */
  contribution: number;
  /** contribution / totalChange (null when the total change is 0) */
  shareOfChange: number | null;
}

export interface Decomposition {
  crBaseline: number;
  crCurrent: number;
  totalChange: number;
  /** Σ Δshareᵢ·CRᵢ,base */
  mixEffect: number;
  /** Σ shareᵢ,cur·ΔCRᵢ */
  rateEffect: number;
  segments: SegmentEffect[];
  /** segment with the largest contribution in the direction of the total change */
  top: SegmentEffect | null;
}

/**
 * ΔCR = Σ Δshareᵢ·CRᵢ,base + Σ shareᵢ,cur·ΔCRᵢ (exact). Per segment the mix term is centred on the
 * baseline total CR, which leaves the sum unchanged (Σ Δshare = 0) but stops a big segment that merely
 * shrank from looking responsible.
 */
export function mixRateDecomposition(segments: SegmentCounts[]): Decomposition {
  const totB = segments.reduce((s, x) => s + x.baseline.sessions, 0);
  const totC = segments.reduce((s, x) => s + x.current.sessions, 0);
  const crBaseline = totB > 0 ? segments.reduce((s, x) => s + x.baseline.conversions, 0) / totB : 0;
  const crCurrent = totC > 0 ? segments.reduce((s, x) => s + x.current.conversions, 0) / totC : 0;
  const totalChange = crCurrent - crBaseline;

  let mixEffect = 0;
  let rateEffect = 0;
  const effects: SegmentEffect[] = segments.map((x) => {
    const shareBaseline = totB > 0 ? x.baseline.sessions / totB : 0;
    const shareCurrent = totC > 0 ? x.current.sessions / totC : 0;
    const crB = crStats(x.baseline).cr;
    const crC = crStats(x.current).cr;
    const dShare = shareCurrent - shareBaseline;
    mixEffect += dShare * crB;
    // a segment with no baseline traffic has no baseline rate: its whole rate counts as rate effect
    const rate = shareCurrent * (crC - crB);
    rateEffect += rate;
    const mix = dShare * (crB - crBaseline);
    const contribution = mix + rate;
    return {
      key: x.key,
      shareBaseline,
      shareCurrent,
      crBaseline: crB,
      crCurrent: crC,
      mixEffect: mix,
      rateEffect: rate,
      contribution,
      shareOfChange: totalChange !== 0 ? contribution / totalChange : null,
    };
  });

  const sign = Math.sign(totalChange);
  const top =
    sign === 0
      ? null
      : effects.reduce<SegmentEffect | null>(
          (best, e) => (best === null || e.contribution * sign > best.contribution * sign ? e : best),
          null,
        );
  return { crBaseline, crCurrent, totalChange, mixEffect, rateEffect, segments: effects, top };
}

export interface ChangePoint {
  /** index of the first point of the second segment */
  index: number;
  meanBefore: number;
  meanAfter: number;
  /** between-segment sum of squares n₁n₂/n·(m₁−m₂)² */
  score: number;
}

/** Single change point: the split maximising the between-segment difference, ≥ minSegment points per side. */
export function detectChangePoint(values: number[], minSegment = 3): ChangePoint | null {
  const n = values.length;
  if (n < 2 * minSegment) return null;
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1]! + v);
  let best: ChangePoint | null = null;
  for (let i = minSegment; i <= n - minSegment; i++) {
    const meanBefore = prefix[i]! / i;
    const meanAfter = (prefix[n]! - prefix[i]!) / (n - i);
    const score = ((i * (n - i)) / n) * (meanBefore - meanAfter) ** 2;
    if (best === null || score > best.score) best = { index: i, meanBefore, meanAfter, score };
  }
  return best;
}

export interface Reconciliation {
  tracked: number;
  backend: number;
  /** tracked / backend, null without backend conversions */
  ratio: number | null;
  /** backend − tracked */
  gap: number;
}

export function reconcileConversions(tracked: number, backend: number): Reconciliation {
  return { tracked, backend, ratio: backend > 0 ? tracked / backend : null, gap: backend - tracked };
}

const DAY_MS = 86_400_000;

/** Calendar days (YYYY-MM-DD, UTC) from start to end inclusive. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function findMissingDates(start: string, end: string, present: Iterable<string>): string[] {
  const seen = new Set(present);
  return eachDate(start, end).filter((d) => !seen.has(d));
}

/** Sessions per group to detect p1 vs p2 (two-sided α = 0.05, power 0.8). */
export function requiredSampleSize(p1: number, p2: number): number {
  if (p1 === p2) return Infinity;
  const pBar = (p1 + p2) / 2;
  const numerator = Z_975 * Math.sqrt(2 * pBar * (1 - pBar)) + Z_80 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil(numerator ** 2 / (p1 - p2) ** 2);
}
