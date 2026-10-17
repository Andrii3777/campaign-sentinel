import type { PrismaClient } from "../generated/prisma/client";
import { generateDemoDataset } from "./generator";

const date = (d: string) => new Date(`${d}T00:00:00.000Z`);

/**
 * Writes the demo dataset. Idempotent: campaigns are upserted and their synthetic rows replaced,
 * so existing investigations keep their campaign link. Returns row counts.
 */
export async function seedDemoData(prisma: PrismaClient): Promise<Record<string, number>> {
  const data = generateDemoDataset();
  const ids = data.campaigns.map((c) => c.id);
  await prisma.$transaction(
    async (tx) => {
      for (const c of data.campaigns) {
        const fields = {
          name: c.name,
          channels: c.channels,
          conversionEvent: c.conversionEvent,
          scenarioKey: c.scenarioKey,
          dataStart: date(c.dataStart),
          dataEnd: date(c.dataEnd),
          defaultBaselineStart: date(c.defaultPeriods.baseline.start),
          defaultBaselineEnd: date(c.defaultPeriods.baseline.end),
          defaultCurrentStart: date(c.defaultPeriods.current.start),
          defaultCurrentEnd: date(c.defaultPeriods.current.end),
          simulatedFaults: c.simulatedFaults,
        };
        await tx.campaign.upsert({ where: { id: c.id }, create: { id: c.id, ...fields }, update: fields });
      }
      const where = { campaignId: { in: ids } };
      await tx.dailyMetric.deleteMany({ where });
      await tx.funnelEventDaily.deleteMany({ where });
      await tx.landingPageCheck.deleteMany({ where });
      await tx.landingPageSnapshot.deleteMany({ where });
      await tx.changeLogEntry.deleteMany({ where });
      await tx.dailyMetric.createMany({ data: data.daily.map((r) => ({ ...r, date: date(r.date) })) });
      await tx.funnelEventDaily.createMany({ data: data.funnel.map((r) => ({ ...r, date: date(r.date) })) });
      await tx.landingPageCheck.createMany({ data: data.monitor.map((r) => ({ ...r, checkedAt: new Date(r.checkedAt) })) });
      await tx.landingPageSnapshot.createMany({
        data: data.snapshots.map((r) => ({ ...r, capturedAt: new Date(r.capturedAt) })),
      });
      await tx.changeLogEntry.createMany({ data: data.changeLog.map((r) => ({ ...r, at: new Date(r.at) })) });
    },
    { timeout: 60_000 },
  );
  return {
    campaigns: data.campaigns.length,
    dailyMetrics: data.daily.length,
    funnelEvents: data.funnel.length,
    monitorSamples: data.monitor.length,
    snapshots: data.snapshots.length,
    changeLog: data.changeLog.length,
  };
}
