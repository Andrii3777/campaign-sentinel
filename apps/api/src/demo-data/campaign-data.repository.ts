import { Inject, Injectable } from "@nestjs/common";
import type { ChangeLogCategory } from "@campaign-sentinel/contracts";
import { PrismaService } from "../db/prisma.service";
import type {
  ChangeLogRow,
  DailyRow,
  DemoCampaign,
  DemoDataset,
  FunnelRow,
  MonitorSample,
  PageSnapshot,
} from "./demo-data.types";

export type * from "./demo-data.types";

/**
 * Read access to the synthetic campaign tables. Date bounds are inclusive YYYY-MM-DD (UTC).
 * Results come back in a fixed order. Never exposes the scenario key.
 */
export abstract class CampaignDataRepository {
  abstract listCampaigns(): Promise<DemoCampaign[]>;
  abstract getCampaign(id: string): Promise<DemoCampaign | null>;
  abstract getDailyRows(campaignId: string, from: string, to: string): Promise<DailyRow[]>;
  abstract getFunnel(campaignId: string, from: string, to: string): Promise<FunnelRow[]>;
  abstract getMonitor(campaignId: string, from: string, to: string): Promise<MonitorSample[]>;
  /** Latest snapshot captured on or before the end of `onOrBefore` (default: latest). */
  abstract getSnapshot(campaignId: string, onOrBefore?: string): Promise<PageSnapshot | null>;
  abstract getChangeLog(campaignId: string, from: string, to: string, category?: ChangeLogCategory): Promise<ChangeLogRow[]>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const startOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const endOf = (date: string) => new Date(`${date}T23:59:59.999Z`);
const inRange = (value: string, from: string, to: string) => value.slice(0, 10) >= from && value.slice(0, 10) <= to;
const byString = <T>(...keys: (keyof T)[]) => (a: T, b: T) => {
  for (const k of keys) {
    const x = String(a[k]);
    const y = String(b[k]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** Serves a generated dataset from memory (unit tests of the tools; no database). */
export class InMemoryCampaignDataRepository extends CampaignDataRepository {
  constructor(private readonly data: DemoDataset) {
    super();
  }

  async listCampaigns(): Promise<DemoCampaign[]> {
    return this.data.campaigns.map(stripScenario).sort(byString("id"));
  }

  async getCampaign(id: string): Promise<DemoCampaign | null> {
    const c = this.data.campaigns.find((x) => x.id === id);
    return c ? stripScenario(c) : null;
  }

  async getDailyRows(campaignId: string, from: string, to: string): Promise<DailyRow[]> {
    return this.data.daily
      .filter((r) => r.campaignId === campaignId && inRange(r.date, from, to))
      .map(({ campaignId: _, ...r }) => r)
      .sort(byString("date", "source", "device"));
  }

  async getFunnel(campaignId: string, from: string, to: string): Promise<FunnelRow[]> {
    return this.data.funnel
      .filter((r) => r.campaignId === campaignId && inRange(r.date, from, to))
      .map(({ campaignId: _, ...r }) => r)
      .sort(byString("date", "device", "eventName"));
  }

  async getMonitor(campaignId: string, from: string, to: string): Promise<MonitorSample[]> {
    return this.data.monitor
      .filter((r) => r.campaignId === campaignId && inRange(r.checkedAt, from, to))
      .map(({ campaignId: _, ...r }) => r)
      .sort(byString("checkedAt", "device"));
  }

  async getSnapshot(campaignId: string, onOrBefore?: string): Promise<PageSnapshot | null> {
    const list = this.data.snapshots
      .filter((s) => s.campaignId === campaignId && (!onOrBefore || s.capturedAt.slice(0, 10) <= onOrBefore))
      .sort(byString("capturedAt"));
    const last = list[list.length - 1];
    if (!last) return null;
    const { campaignId: _, ...snapshot } = last;
    return snapshot;
  }

  async getChangeLog(campaignId: string, from: string, to: string, category?: ChangeLogCategory): Promise<ChangeLogRow[]> {
    return this.data.changeLog
      .filter((r) => r.campaignId === campaignId && inRange(r.at, from, to) && (!category || r.category === category))
      .map(({ campaignId: _, ...r }) => r)
      .sort(byString("at", "title"));
  }
}

function stripScenario({ scenarioKey: _, ...c }: DemoDataset["campaigns"][number]): DemoCampaign {
  return c;
}

/** Reads the seeded tables through Prisma. */
@Injectable()
export class PrismaCampaignDataRepository extends CampaignDataRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async listCampaigns(): Promise<DemoCampaign[]> {
    const rows = await this.prisma.campaign.findMany({ orderBy: { id: "asc" } });
    return rows.map(toCampaign);
  }

  async getCampaign(id: string): Promise<DemoCampaign | null> {
    const row = await this.prisma.campaign.findUnique({ where: { id } });
    return row ? toCampaign(row) : null;
  }

  async getDailyRows(campaignId: string, from: string, to: string): Promise<DailyRow[]> {
    const rows = await this.prisma.dailyMetric.findMany({
      where: { campaignId, date: { gte: startOf(from), lte: startOf(to) } },
      orderBy: [{ date: "asc" }, { source: "asc" }, { device: "asc" }],
    });
    return rows.map((r) => ({
      date: day(r.date),
      source: r.source,
      device: r.device,
      clicks: r.clicks,
      sessions: r.sessions,
      trackedConversions: r.trackedConversions,
      backendConversions: r.backendConversions,
      spend: r.spend.toNumber(),
    }));
  }

  async getFunnel(campaignId: string, from: string, to: string): Promise<FunnelRow[]> {
    const rows = await this.prisma.funnelEventDaily.findMany({
      where: { campaignId, date: { gte: startOf(from), lte: startOf(to) } },
      orderBy: [{ date: "asc" }, { device: "asc" }, { eventName: "asc" }],
    });
    return rows.map((r) => ({ date: day(r.date), device: r.device, eventName: r.eventName, count: r.count }));
  }

  async getMonitor(campaignId: string, from: string, to: string): Promise<MonitorSample[]> {
    const rows = await this.prisma.landingPageCheck.findMany({
      where: { campaignId, checkedAt: { gte: startOf(from), lte: endOf(to) } },
      orderBy: [{ checkedAt: "asc" }, { device: "asc" }],
    });
    return rows.map((r) => ({
      checkedAt: r.checkedAt.toISOString(),
      device: r.device,
      statusCode: r.statusCode,
      responseMs: r.responseMs,
      deployVersion: r.deployVersion,
    }));
  }

  async getSnapshot(campaignId: string, onOrBefore?: string): Promise<PageSnapshot | null> {
    const row = await this.prisma.landingPageSnapshot.findFirst({
      where: { campaignId, ...(onOrBefore ? { capturedAt: { lte: endOf(onOrBefore) } } : {}) },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
    return row
      ? { capturedAt: row.capturedAt.toISOString(), deployVersion: row.deployVersion, url: row.url, html: row.html }
      : null;
  }

  async getChangeLog(campaignId: string, from: string, to: string, category?: ChangeLogCategory): Promise<ChangeLogRow[]> {
    const rows = await this.prisma.changeLogEntry.findMany({
      where: { campaignId, at: { gte: startOf(from), lte: endOf(to) }, ...(category ? { category } : {}) },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      at: r.at.toISOString(),
      category: r.category as ChangeLogCategory,
      title: r.title,
      description: r.description,
      author: r.author,
    }));
  }
}

interface CampaignRow {
  id: string;
  name: string;
  channels: string;
  conversionEvent: string;
  dataStart: Date;
  dataEnd: Date;
  defaultBaselineStart: Date;
  defaultBaselineEnd: Date;
  defaultCurrentStart: Date;
  defaultCurrentEnd: Date;
  simulatedFaults: unknown;
}

function toCampaign(r: CampaignRow): DemoCampaign {
  const faults = r.simulatedFaults && typeof r.simulatedFaults === "object" ? r.simulatedFaults : {};
  return {
    id: r.id,
    name: r.name,
    channels: r.channels,
    conversionEvent: r.conversionEvent === "purchase" ? "purchase" : "lead_submitted",
    dataStart: day(r.dataStart),
    dataEnd: day(r.dataEnd),
    defaultPeriods: {
      baseline: { start: day(r.defaultBaselineStart), end: day(r.defaultBaselineEnd) },
      current: { start: day(r.defaultCurrentStart), end: day(r.defaultCurrentEnd) },
    },
    simulatedFaults: Object.fromEntries(Object.entries(faults).map(([k, v]) => [k, String(v)])),
  };
}
