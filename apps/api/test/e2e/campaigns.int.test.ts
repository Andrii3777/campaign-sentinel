import type { INestApplication } from "@nestjs/common";
import { CampaignDetailSchema, CampaignListResponseSchema, scenarioCatalogue } from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/db/prisma.service";
import { seedDemoData } from "../../src/demo-data/seed";
import { bootApp } from "../boot";

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await bootApp();
  await seedDemoData(app.get(PrismaService));
}, 120_000);
afterAll(async () => {
  await app?.close();
});

describe("GET /api/campaigns", () => {
  it("lists the five campaigns with headline KPIs and the fault flag, and no scenario information", async () => {
    const res = await http().get("/api/campaigns").expect(200);
    const { items } = CampaignListResponseSchema.parse(res.body);
    expect(items.map((c) => c.id).sort()).toEqual(scenarioCatalogue.map((s) => s.campaignId).sort());
    const tracking = items.find((c) => c.id === "home-insurance-search")!;
    expect(tracking).toMatchObject({ provenance: "synthetic-demo", dataset: "synthetic-demo-v1", hasSimulatedFault: false });
    expect(tracking.kpis.baseline.conversionRate).toBeCloseTo(0.042, 2);
    expect(tracking.kpis.current.conversionRate).toBeCloseTo(0.018, 2);
    expect(tracking.kpis.relativeChange).toBeLessThan(-0.5);
    expect(items.find((c) => c.id === "meal-kit-search-social")!.hasSimulatedFault).toBe(true);
    const text = JSON.stringify(res.body);
    for (const s of scenarioCatalogue) {
      expect(text).not.toContain(s.key);
      expect(text).not.toContain(s.title);
      expect(text).not.toContain(s.description);
    }
    expect(text).not.toMatch(/expectedCategory|scenario/i);
  });
});

describe("GET /api/campaigns/:id", () => {
  it("returns metadata, periods, KPIs, daily series, source/device tables, change log and fault info", async () => {
    const res = await http().get("/api/campaigns/home-insurance-search").expect(200);
    const c = CampaignDetailSchema.parse(res.body);
    expect(c).toMatchObject({
      id: "home-insurance-search",
      provenance: "synthetic-demo",
      defaultPeriods: { baseline: { start: "2026-09-19" }, current: { end: "2026-10-16" } },
      dataRange: { start: "2026-09-05", end: "2026-10-16" },
    });
    expect(c.daily).toHaveLength(42);
    expect(c.daily[0]).toMatchObject({ date: "2026-09-05", trackedConversionRate: expect.any(Number), backendConversionRate: expect.any(Number), sessions: expect.any(Number) });
    const day = (d: string) => c.daily.find((x) => x.date === d)!;
    // the pixel lost conversions, the backend did not
    expect(day("2026-10-10").trackedConversionRate).toBeLessThan(day("2026-10-10").backendConversionRate! * 0.6);
    expect(c.sources.length).toBeGreaterThan(1);
    expect(c.devices.length).toBeGreaterThan(1);
    expect(c.sources[0]).toMatchObject({ segment: expect.any(String), baseline: { sessions: expect.any(Number) }, current: { conversionRate: expect.any(Number) } });
    expect(c.changeLog.some((e) => e.title === "Thank-you page template v2")).toBe(true);
    expect(c.simulatedFaults).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/tracking-break|expectedCategory/);
  });

  it("flags the injected fault and answers 404 for an unknown campaign", async () => {
    const c = CampaignDetailSchema.parse((await http().get("/api/campaigns/meal-kit-search-social").expect(200)).body);
    expect(c.simulatedFaults).toEqual([{ tool: "inspect_tracking_health", message: "Demo fault injected: tracking API unavailable" }]);
    const res = await http().get("/api/campaigns/nope").expect(404);
    expect(res.body).toEqual({ code: "CAMPAIGN_NOT_FOUND", message: expect.any(String) });
  });
});
