import type { ChangeLogCategory, Period } from "@campaign-sentinel/contracts";

/** What tools may see of a demo campaign. Deliberately has no scenario key. */
export interface DemoCampaign {
  id: string;
  name: string;
  channels: string;
  conversionEvent: "lead_submitted" | "purchase";
  dataStart: string;
  dataEnd: string;
  defaultPeriods: { baseline: Period; current: Period };
  /** e.g. {"inspect_tracking_health": "timeout"} */
  simulatedFaults: Record<string, string>;
}

/** Dates are YYYY-MM-DD (UTC); timestamps are ISO-8601 UTC. */
export interface DailyRow {
  date: string;
  source: string;
  device: string;
  clicks: number;
  sessions: number;
  trackedConversions: number;
  backendConversions: number;
  spend: number;
}

export interface FunnelRow {
  date: string;
  device: string;
  eventName: string;
  count: number;
}

export interface MonitorSample {
  checkedAt: string;
  device: string;
  statusCode: number;
  responseMs: number;
  deployVersion: string;
}

export interface PageSnapshot {
  capturedAt: string;
  deployVersion: string;
  url: string;
  /** third-party content: untrusted */
  html: string;
}

export interface ChangeLogRow {
  at: string;
  category: ChangeLogCategory;
  /** untrusted */
  title: string;
  /** untrusted */
  description: string;
  author: string | null;
}

type WithCampaign<T> = T & { campaignId: string };

export interface DemoDataset {
  campaigns: (DemoCampaign & { scenarioKey: string })[];
  daily: WithCampaign<DailyRow>[];
  funnel: WithCampaign<FunnelRow>[];
  monitor: WithCampaign<MonitorSample>[];
  snapshots: WithCampaign<PageSnapshot>[];
  changeLog: WithCampaign<ChangeLogRow>[];
}
