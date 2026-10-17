import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DEMO_DATASET_VERSION,
  type CampaignDetail,
  type CampaignListItem,
  type Period,
} from "@campaign-sentinel/contracts";
import { crStats } from "../../analysis";
import { CampaignDataRepository, type DailyRow, type DemoCampaign } from "../../demo-data/campaign-data.repository";

const sum = (rows: DailyRow[], k: "sessions" | "trackedConversions" | "backendConversions") => rows.reduce((a, r) => a + r[k], 0);
const rate = (conversions: number, sessions: number) => (sessions > 0 ? conversions / sessions : null);

/** Read-only campaign views for the UI (spec §5.9); data comes through CampaignDataRepository, which never exposes the scenario. */
@Injectable()
export class CampaignsService {
  constructor(@Inject(CampaignDataRepository) private readonly repo: CampaignDataRepository) {}

  async list(): Promise<CampaignListItem[]> {
    const campaigns = await this.repo.listCampaigns();
    return Promise.all(campaigns.map((c) => this.listItem(c)));
  }

  async detail(id: string): Promise<CampaignDetail> {
    const c = await this.repo.getCampaign(id);
    if (!c) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND", message: `Campaign ${id} does not exist.` });
    const { baseline, current } = c.defaultPeriods;
    const all = await this.repo.getDailyRows(c.id, c.dataStart, c.dataEnd);
    const byDate = new Map<string, DailyRow[]>();
    for (const r of all) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    const inPeriod = (p: Period) => all.filter((r) => r.date >= p.start && r.date <= p.end);
    const table = (key: "source" | "device") => {
      const b = inPeriod(baseline);
      const cur = inPeriod(current);
      const totalB = sum(b, "sessions");
      const totalC = sum(cur, "sessions");
      const side = (rows: DailyRow[], total: number, segment: string) => {
        const part = rows.filter((r) => r[key] === segment);
        const sessions = sum(part, "sessions");
        return { sessions, share: total > 0 ? sessions / total : 0, conversionRate: crStats({ sessions, conversions: sum(part, "trackedConversions") }).cr };
      };
      return [...new Set(all.map((r) => r[key]))].sort().map((segment) => ({ segment, baseline: side(b, totalB, segment), current: side(cur, totalC, segment) }));
    };
    const log = await this.repo.getChangeLog(c.id, c.dataStart, c.dataEnd);
    return {
      ...(await this.listItem(c)),
      conversionEvent: c.conversionEvent,
      dataRange: { start: c.dataStart, end: c.dataEnd },
      defaultPeriods: c.defaultPeriods,
      daily: [...byDate.keys()].sort().map((date) => {
        const rows = byDate.get(date)!;
        const sessions = sum(rows, "sessions");
        const tracked = sum(rows, "trackedConversions");
        const backend = sum(rows, "backendConversions");
        return { date, sessions, trackedConversions: tracked, backendConversions: backend, trackedConversionRate: rate(tracked, sessions), backendConversionRate: rate(backend, sessions) };
      }),
      sources: table("source"),
      devices: table("device"),
      changeLog: log.map(({ at, category, title, description, author }) => ({ at, category, title, description, author })),
      simulatedFaults: Object.keys(c.simulatedFaults).map((tool) => ({ tool, message: faultMessage(tool) })),
    };
  }

  private async listItem(c: DemoCampaign): Promise<CampaignListItem> {
    const kpi = async (period: Period) => {
      const rows = await this.repo.getDailyRows(c.id, period.start, period.end);
      const sessions = sum(rows, "sessions");
      const trackedConversions = sum(rows, "trackedConversions");
      return { period, sessions, trackedConversions, conversionRate: crStats({ sessions, conversions: trackedConversions }).cr };
    };
    const baseline = await kpi(c.defaultPeriods.baseline);
    const current = await kpi(c.defaultPeriods.current);
    return {
      id: c.id,
      name: c.name,
      channels: c.channels,
      provenance: "synthetic-demo",
      dataset: DEMO_DATASET_VERSION,
      kpis: { baseline, current, relativeChange: baseline.conversionRate > 0 ? (current.conversionRate - baseline.conversionRate) / baseline.conversionRate : null },
      hasSimulatedFault: Object.keys(c.simulatedFaults).length > 0,
    };
  }
}

function faultMessage(tool: string): string {
  return tool === "inspect_tracking_health" ? "Demo fault injected: tracking API unavailable" : `Demo fault injected: ${tool} unavailable`;
}
