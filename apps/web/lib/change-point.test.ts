import { describe, expect, it } from "vitest";
import { findContact } from "./change-point";

const day = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;
const rows = (rates: (number | null)[]) => rates.map((r, i) => ({ date: day(i), trackedConversionRate: r }));

describe("findContact", () => {
  it("finds the day a step change starts (hand-worked: 6 days at 4%, then 6 days at 1.6%)", () => {
    const contact = findContact(rows([0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.016, 0.016, 0.016, 0.016, 0.016, 0.016]));
    expect(contact?.date).toBe("2026-10-07");
    expect(contact?.relativeChange).toBeCloseTo(-0.6, 5);
  });

  it("returns null for a flat series: no clear change, no line", () => {
    expect(findContact(rows([0.04, 0.041, 0.039, 0.04, 0.04, 0.041, 0.04, 0.039, 0.04, 0.04]))).toBeNull();
  });

  it("returns null with too few days and ignores days without a rate", () => {
    expect(findContact(rows([0.04, 0.01, 0.04, 0.01]))).toBeNull();
    expect(findContact(rows([null, null, null, null, null, null]))).toBeNull();
  });
});
