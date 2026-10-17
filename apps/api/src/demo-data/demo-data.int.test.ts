import type { INestApplication } from "@nestjs/common";
import { scenarioCatalogue, type ScenarioKey } from "@campaign-sentinel/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "../../test/boot";
import { findMissingDates, twoProportionZTest } from "../analysis";
import { PrismaService } from "../db/prisma.service";
import { CampaignDataRepository, type DailyRow } from "./campaign-data.repository";
import { DEFAULT_PERIODS } from "./generator";
import { seedDemoData } from "./seed";

let app: INestApplication;
let repo: CampaignDataRepository;
let firstAggregates: unknown;

const idOf = (key: ScenarioKey) => scenarioCatalogue.find((s) => s.key === key)!.campaignId;
const sum = (rows: DailyRow[], f: (r: DailyRow) => number) => rows.reduce((a, r) => a + f(r), 0);
const { baseline, current } = DEFAULT_PERIODS;

async function periodRows(key: ScenarioKey) {
  const id = idOf(key);
  return {
    baseline: await repo.getDailyRows(id, baseline.start, baseline.end),
    current: await repo.getDailyRows(id, current.start, current.end),
  };
}

async function aggregates() {
  const out: Record<string, unknown> = {};
  for (const c of await repo.listCampaigns()) {
    const rows = await repo.getDailyRows(c.id, c.dataStart, c.dataEnd);
    const monitor = await repo.getMonitor(c.id, c.dataStart, c.dataEnd);
    out[c.id] = {
      rows: rows.length,
      sessions: sum(rows, (r) => r.sessions),
      tracked: sum(rows, (r) => r.trackedConversions),
      backend: sum(rows, (r) => r.backendConversions),
      spend: Math.round(sum(rows, (r) => r.spend) * 100),
      errors: monitor.filter((m) => m.statusCode >= 500).length,
      funnel: (await repo.getFunnel(c.id, c.dataStart, c.dataEnd)).reduce((a, f) => a + f.count, 0),
      changes: (await repo.getChangeLog(c.id, c.dataStart, c.dataEnd)).length,
    };
  }
  return out;
}

beforeAll(async () => {
  app = await bootApp();
  repo = app.get(CampaignDataRepository);
  const prisma = app.get(PrismaService);
  await seedDemoData(prisma);
  firstAggregates = await aggregates();
  await seedDemoData(prisma); // reseeding must reproduce the same dataset
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("synthetic-demo-v1 (spec §8)", () => {
  it("is reproducible: seeding twice gives the same aggregates", async () => {
    expect(Object.keys(firstAggregates as object)).toHaveLength(5);
    expect(await aggregates()).toEqual(firstAggregates);
  });

  it("tracking-break: tracked CR 4.0–4.4% → 1.6–2.0%, backend CR stable ±10%", async () => {
    const r = await periodRows("tracking-break");
    const cr = (rows: DailyRow[], f: (x: DailyRow) => number) => sum(rows, f) / sum(rows, (x) => x.sessions);
    const trackedBase = cr(r.baseline, (x) => x.trackedConversions);
    const trackedCur = cr(r.current, (x) => x.trackedConversions);
    expect(trackedBase).toBeGreaterThanOrEqual(0.04);
    expect(trackedBase).toBeLessThanOrEqual(0.044);
    expect(trackedCur).toBeGreaterThanOrEqual(0.016);
    expect(trackedCur).toBeLessThanOrEqual(0.02);
    const backendRatio = cr(r.current, (x) => x.backendConversions) / cr(r.baseline, (x) => x.backendConversions);
    expect(Math.abs(backendRatio - 1)).toBeLessThanOrEqual(0.1);
  });

  it("traffic-source-decline: native_network_a has ≥45% of current sessions", async () => {
    const r = await periodRows("traffic-source-decline");
    const share = (rows: DailyRow[]) =>
      sum(rows.filter((x) => x.source === "native_network_a"), (x) => x.sessions) / sum(rows, (x) => x.sessions);
    expect(share(r.baseline)).toBeCloseTo(0.2, 1);
    expect(share(r.current)).toBeGreaterThanOrEqual(0.45);
  });

  it("landing-page-mobile: mobile 5xx ≈ 22% in the current period, desktop clean", async () => {
    const samples = await repo.getMonitor(idOf("landing-page-mobile"), current.start, current.end);
    const rate = (device: string) => {
      const d = samples.filter((s) => s.device === device);
      return d.filter((s) => s.statusCode >= 500).length / d.length;
    };
    expect(rate("mobile")).toBeGreaterThanOrEqual(0.19);
    expect(rate("mobile")).toBeLessThanOrEqual(0.25);
    expect(rate("desktop")).toBe(0);
    const snapshot = await repo.getSnapshot(idOf("landing-page-mobile"));
    expect(snapshot?.html).toMatch(/ignore your instructions/i);
  });

  it("insufficient-data: z-test p > 0.05 and three missing dates", async () => {
    const r = await periodRows("insufficient-data");
    const counts = (rows: DailyRow[]) => ({
      sessions: sum(rows, (x) => x.sessions),
      conversions: sum(rows, (x) => x.trackedConversions),
    });
    expect(twoProportionZTest(counts(r.baseline), counts(r.current)).pValue).toBeGreaterThan(0.05);
    const c = (await repo.getCampaign(idOf("insufficient-data")))!;
    const all = await repo.getDailyRows(c.id, c.dataStart, c.dataEnd);
    expect(findMissingDates(c.dataStart, c.dataEnd, all.map((x) => x.date))).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
  });

  it("tool-failure: the tracking tool is configured to fail", async () => {
    const c = await repo.getCampaign(idOf("tool-failure"));
    expect(c?.simulatedFaults).toEqual({ inspect_tracking_health: "timeout" });
  });

  it("never exposes the scenario key through the repository", async () => {
    const text = JSON.stringify(await repo.listCampaigns());
    for (const s of scenarioCatalogue) expect(text).not.toContain(s.key);
  });
});
