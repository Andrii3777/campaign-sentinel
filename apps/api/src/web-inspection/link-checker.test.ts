import { describe, expect, it } from "vitest";
import { LINK_CHECK_CONCURRENCY, mapLimit } from "./link-checker";

describe("mapLimit (B5: link checks run with bounded concurrency)", () => {
  it("never runs more than the limit at once and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([...Array(12).keys()], LINK_CHECK_CONCURRENCY, async (n) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out).toEqual([...Array(12).keys()].map((n) => n * 2));
  });
});
