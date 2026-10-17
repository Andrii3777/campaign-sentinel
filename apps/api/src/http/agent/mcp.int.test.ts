import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { INestApplication } from "@nestjs/common";
import { InvestigationDetailSchema, scenarioCatalogue } from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { PrismaService } from "../../db/prisma.service";
import { seedDemoData } from "../../demo-data/seed";

/** The real MCP SDK client spawns the built stdio server against the real app (spec story 67). */
const repo = path.resolve(__dirname, "../../../../..");
const token = randomBytes(24).toString("hex");
const campaignId = scenarioCatalogue.find((s) => s.key === "tracking-break")!.campaignId;
let app: INestApplication;
let client: Client;
let transport: StdioClientTransport;

const report = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  summary: "Tracked conversion rate changed between the periods; this test report cites the comparison evidence only.",
  verdict: "likely_cause",
  severity: "high",
  severityRationale: "Tracked conversions are down by more than 30%.",
  whatChanged: "Tracked CR fell [E1].",
  observations: [{ statement: "Tracked CR fell.", evidenceIds: ["E1"] }],
  hypotheses: [
    {
      id: "H1",
      category: "conversion_flow",
      statement: "Something in the conversion flow changed.",
      status: "plausible",
      confidence: "medium",
      confidenceRationale: "Only the comparison supports it.",
      supportingEvidenceIds: ["E1"],
      contradictingEvidenceIds: [],
    },
  ],
  unknowns: [{ question: "Is tracking healthy?", whyItMatters: "Rules out a pixel issue.", howToResolve: "Rerun the tracking check." }],
  recommendedActions: [{ action: "Verify checkout events.", priority: "now", rationale: "Most likely cause.", hypothesisIds: ["H1"] }],
  limitations: [],
  securityNotes: [],
  ...over,
});
const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

beforeAll(async () => {
  execSync("pnpm --filter @campaign-sentinel/mcp build", { cwd: repo, stdio: "pipe" });
  ({ app } = await createApp({ logger: false, env: { ...process.env, SENTINEL_AGENT_TOKEN: token } }));
  await app.listen(0, "127.0.0.1");
  await seedDemoData(app.get(PrismaService));
  const url = await app.getUrl();
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repo, "apps/mcp/dist/index.js")],
    env: { PATH: process.env.PATH ?? "", SENTINEL_API_URL: url.replace("[::1]", "127.0.0.1"), SENTINEL_AGENT_TOKEN: token },
    stderr: "pipe",
  });
  client = new Client({ name: "int-test-client", version: "0.3.1" });
  await client.connect(transport);
}, 120_000);
afterAll(async () => {
  await client?.close();
  await app?.close();
});

describe("MCP stdio server against the real app", () => {
  it("runs start_investigation, a tool, a rejected report and an accepted report; the run is COMPLETED with source mcp and the client", async () => {
    const campaigns = json(await client.callTool({ name: "list_demo_campaigns", arguments: {} }));
    expect(campaigns.items.map((c: { id: string }) => c.id)).toContain(campaignId);

    const started = await client.callTool({ name: "start_investigation", arguments: { mode: "demo", campaign_id: campaignId } });
    expect(started.isError).toBeFalsy();
    const { investigationId } = json(started);

    const compared = json(await client.callTool({ name: "compare_periods", arguments: { investigation_id: investigationId, reason: "Compare the periods." } }));
    expect(compared).toMatchObject({ ok: true, evidence: [{ ref: "E1" }] });
    const status = json(await client.callTool({ name: "get_investigation", arguments: { investigation_id: investigationId } }));
    expect(status).toMatchObject({ status: "RUNNING", evidence: [{ ref: "E1" }] });

    const rejected = await client.callTool({
      name: "submit_report",
      arguments: { investigation_id: investigationId, report: report({ observations: [{ statement: "Made up.", evidenceIds: ["E42"] }] }) },
    });
    expect(rejected.isError).toBe(true);
    expect(json(rejected)).toMatchObject({ accepted: false, errors: [expect.objectContaining({ rule: "evidence_exists" })] });

    const accepted = await client.callTool({ name: "submit_report", arguments: { investigation_id: investigationId, report: report() } });
    expect(accepted.isError).toBeFalsy();
    expect(json(accepted)).toMatchObject({ accepted: true });

    const run = InvestigationDetailSchema.parse((await request(app.getHttpServer()).get(`/api/investigations/${investigationId}`).expect(200)).body);
    expect(run).toMatchObject({ status: "COMPLETED", source: "mcp", runtime: "external", clientName: "int-test-client", clientVersion: "0.3.1" });
    expect(run.clientUserAgent).toBe("campaign-sentinel-mcp");
  });

  it("returns an error result (not a crash) for a refused call", async () => {
    const bad = await client.callTool({ name: "start_investigation", arguments: { mode: "demo", campaign_id: "nope" } });
    expect(bad.isError).toBe(true);
    expect(json(bad)).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
