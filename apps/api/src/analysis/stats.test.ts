import { describe, expect, it } from "vitest";
import {
  crStats,
  detectChangePoint,
  formatPValue,
  twoSidedPValue,
  findMissingDates,
  mixRateDecomposition,
  reconcileConversions,
  requiredSampleSize,
  twoProportionZTest,
} from "./index";

// Expected values below are worked by hand (and against standard normal tables), not by this code.

describe("crStats", () => {
  it("computes the rate and its standard error", () => {
    const s = crStats({ sessions: 1000, conversions: 42 });
    expect(s.cr).toBeCloseTo(0.042, 12);
    // sqrt(0.042 * 0.958 / 1000) = 0.0063432
    expect(s.standardError).toBeCloseTo(0.0063432, 6);
  });

  it("returns cr 0 for zero sessions instead of NaN", () => {
    expect(crStats({ sessions: 0, conversions: 0 }).cr).toBe(0);
  });
});

describe("twoProportionZTest", () => {
  it("matches a hand-worked example (50/1000 vs 35/1000)", () => {
    const t = twoProportionZTest({ sessions: 1000, conversions: 50 }, { sessions: 1000, conversions: 35 });
    // pooled p = 0.0425, se = sqrt(0.0425*0.9575*0.002) = 0.0090215, z = -0.015 / se = -1.6627
    expect(t.difference).toBeCloseTo(-0.015, 12);
    expect(t.z).toBeCloseTo(-1.6627, 3);
    // Φ(1.6627) ≈ 0.95181 from tables → two-sided p ≈ 0.0964
    expect(t.pValue).toBeCloseTo(0.0964, 3);
    // unpooled se = sqrt(0.0000475 + 0.000033775) = 0.0090153; ±1.96·se = ±0.017670
    expect(t.ci95[0]).toBeCloseTo(-0.03267, 4);
    expect(t.ci95[1]).toBeCloseTo(0.00267, 4);
    expect(t.isSignificant).toBe(false);
  });

  it("flags a large drop as significant", () => {
    const t = twoProportionZTest({ sessions: 10000, conversions: 420 }, { sessions: 10000, conversions: 180 });
    // z = -0.024 / sqrt(0.03*0.97*0.0002) = -9.948
    expect(t.z).toBeCloseTo(-9.948, 2);
    expect(t.pValue).toBeLessThan(1e-6);
    expect(t.isSignificant).toBe(true);
  });
});

describe("mixRateDecomposition", () => {
  // A: 800 s / 32 conv → 500 s / 20 conv; B: 200 s / 6 conv → 500 s / 3 conv
  // total 3.8% → 2.3% (ΔCR -0.015); mix = -0.3·0.04 + 0.3·0.03 = -0.003; rate = 0.5·0 + 0.5·(-0.024) = -0.012
  const segments = [
    { key: "A", baseline: { sessions: 800, conversions: 32 }, current: { sessions: 500, conversions: 20 } },
    { key: "B", baseline: { sessions: 200, conversions: 6 }, current: { sessions: 500, conversions: 3 } },
  ];

  it("splits the change into mix and rate effects that sum to the total", () => {
    const d = mixRateDecomposition(segments);
    expect(d.totalChange).toBeCloseTo(-0.015, 12);
    expect(d.mixEffect).toBeCloseTo(-0.003, 12);
    expect(d.rateEffect).toBeCloseTo(-0.012, 12);
    expect(Math.abs(d.mixEffect + d.rateEffect - d.totalChange)).toBeLessThan(1e-9);
    const sum = d.segments.reduce((acc, s) => acc + s.contribution, 0);
    expect(Math.abs(sum - d.totalChange)).toBeLessThan(1e-9);
  });

  it("names the segment explaining most of the change", () => {
    const d = mixRateDecomposition(segments);
    // B: mix 0.3·(0.03-0.038) = -0.0024, rate -0.012 → -0.0144 = 96% of the change
    expect(d.top?.key).toBe("B");
    expect(d.top?.contribution).toBeCloseTo(-0.0144, 12);
    expect(d.top?.shareOfChange).toBeCloseTo(0.96, 9);
  });

  it("handles a segment that is absent in one period", () => {
    const d = mixRateDecomposition([
      { key: "A", baseline: { sessions: 100, conversions: 5 }, current: { sessions: 100, conversions: 5 } },
      { key: "N", baseline: { sessions: 0, conversions: 0 }, current: { sessions: 100, conversions: 1 } },
    ]);
    expect(Math.abs(d.mixEffect + d.rateEffect - d.totalChange)).toBeLessThan(1e-9);
    expect(d.totalChange).toBeCloseTo(0.03 - 0.05, 12);
  });
});

describe("detectChangePoint", () => {
  it("finds the planted shift", () => {
    const series = [4.1, 4.3, 4.2, 4.0, 4.2, 4.1, 4.3, 1.8, 1.7, 1.9, 1.8, 1.6];
    expect(detectChangePoint(series)?.index).toBe(7);
  });

  it("keeps at least three points per side and returns null for short series", () => {
    expect(detectChangePoint([1, 1, 1, 1, 1])).toBeNull();
    expect(detectChangePoint([9, 1, 1, 1, 1, 1, 1])?.index).toBe(3);
  });
});

describe("reconcileConversions", () => {
  it("reports the pixel capture ratio and the gap", () => {
    expect(reconcileConversions(230, 560)).toEqual({ tracked: 230, backend: 560, ratio: 230 / 560, gap: 330 });
    expect(reconcileConversions(0, 0).ratio).toBeNull();
  });
});

describe("findMissingDates", () => {
  it("lists calendar days without data", () => {
    expect(
      findMissingDates("2026-10-08", "2026-10-14", ["2026-10-08", "2026-10-09", "2026-10-13", "2026-10-14"]),
    ).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
  });
});

describe("requiredSampleSize", () => {
  it("matches the textbook value for 4% vs 2% (α 0.05 two-sided, power 0.8)", () => {
    // (1.959964·√(2·0.03·0.97) + 0.841621·√(0.0384+0.0196))² / 0.02² = 1140.8 → 1141
    expect(requiredSampleSize(0.04, 0.02)).toBe(1141);
  });
});

describe("tail p-values (A13)", () => {
  // two-sided normal tails from standard tables: z=5 → 5.733031e-7, z=6 → 1.973175e-9, z=7 → 2.559625e-12, z=8 → 1.244192e-15
  it.each([
    [1.96, 0.04999579],
    [3, 0.002699796],
    [5, 5.733031e-7],
    [6, 1.973175e-9],
    [7, 2.559625e-12],
    [8, 1.244192e-15],
  ])("twoSidedPValue(%f) is accurate in the far tail", (z, expected) => {
    expect(Math.abs(twoSidedPValue(z) - expected) / expected).toBeLessThan(1e-5);
    expect(twoSidedPValue(-z)).toBe(twoSidedPValue(z));
  });

  it("floors absurdly small p-values at 1e-16 instead of returning 0", () => {
    expect(twoSidedPValue(40)).toBe(1e-16);
  });

  it("a huge difference gives a tiny but non-zero p-value", () => {
    const t = twoProportionZTest({ sessions: 200000, conversions: 8400 }, { sessions: 200000, conversions: 3600 });
    expect(t.pValue).toBeGreaterThan(0);
    expect(t.pValue).toBeLessThanOrEqual(1e-16);
    expect(t.isSignificant).toBe(true);
  });

  it("formatPValue never prints p = 0", () => {
    expect(formatPValue(0)).toBe("p < 0.001");
    expect(formatPValue(2e-9)).toBe("p < 0.001");
    expect(formatPValue(0.0004)).toBe("p < 0.001");
    expect(formatPValue(0.0123)).toBe("p = 0.012");
    expect(formatPValue(0.5)).toBe("p = 0.500");
  });
});
