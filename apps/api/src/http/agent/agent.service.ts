import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  AgentCreateInvestigationDtoSchema,
  AgentReportDtoSchema,
  AgentToolCallDtoSchema,
  DEFAULT_QUESTION,
  DEFAULT_URL_QUESTION,
  DEMO_DATASET_VERSION,
  URL_SCOPE_STATEMENT,
  toolInputJsonSchema,
  toolsForMode,
  type AgentCreateInvestigationResponse,
  type AgentInvestigationStatus,
  type AgentReportResponse,
  type Period,
  type ToolResult,
} from "@campaign-sentinel/contracts";
import { APP_CONFIG, type AppConfig } from "../../config/config";
import { PrismaService } from "../../db/prisma.service";
import { CampaignDataRepository } from "../../demo-data/campaign-data.repository";
import { InvestigationNotFoundError } from "../../ledger/ledger.errors";
import { LedgerService, type CreateInvestigationInput } from "../../ledger/ledger.service";
import { REPORT_ATTEMPT_BUDGET, ReportService } from "../../reports/report.service";
import { TOOL_CALL_BUDGET, ToolExecutor } from "../../tools/tool-executor";
import { HTTP_REQUEST_CAP } from "../../tools/url/url-tools";
import { validateTargetUrl } from "../../web-inspection/url-guard";
import { parseOr400, validationError } from "../public/investigations.service";

/** D02: rejected tool calls write ledger rows; an external agent may produce only this many per investigation, after which tool calls are refused (the report endpoint stays open). */
export const AGENT_REJECTED_CALL_CAP = 20;
/** Runtimes whose runs an outside agent may drive: its own (`external`) and OpenClaw's (the dispatcher tells it the id). */
const DRIVEABLE = ["external", "openclaw"];
const date = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** Use cases of the Agent API (spec 5.10). Tools and reports go through the same ToolExecutor/ReportService as every runtime. */
@Injectable()
export class AgentService {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CampaignDataRepository) private readonly campaigns: CampaignDataRepository,
    @Inject(ToolExecutor) private readonly executor: ToolExecutor,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** What an agent needs to choose a campaign: no fault flags, no scenario information. */
  async listCampaigns() {
    const all = await this.campaigns.listCampaigns();
    return {
      items: all.map((c) => ({
        id: c.id,
        name: c.name,
        channels: c.channels,
        conversionEvent: c.conversionEvent,
        dataRange: { start: c.dataStart, end: c.dataEnd },
        defaultPeriods: c.defaultPeriods,
      })),
    };
  }

  async create(body: unknown, userAgent?: string): Promise<AgentCreateInvestigationResponse> {
    const dto = parseOr400(AgentCreateInvestigationDtoSchema, body);
    const common = {
      source: "mcp",
      runtime: "external",
      clientName: dto.client.name,
      clientVersion: dto.client.version,
      clientUserAgent: userAgent?.slice(0, 300),
      model: dto.model,
    } as const;
    let input: CreateInvestigationInput;
    let scope: string;
    let periods: { baseline: Period; current: Period } | null = null;
    if (dto.mode === "demo") {
      const campaign = await this.campaigns.getCampaign(dto.campaignId);
      if (!campaign) throw validationError([{ field: "campaignId", message: "Unknown demo campaign; list_demo_campaigns shows the available ids." }]);
      periods = campaign.defaultPeriods;
      input = {
        ...common,
        mode: "DEMO",
        campaignId: campaign.id,
        question: dto.question ?? DEFAULT_QUESTION,
        baselineStart: date(periods.baseline.start),
        baselineEnd: date(periods.baseline.end),
        currentStart: date(periods.current.start),
        currentEnd: date(periods.current.end),
        provenance: { kind: "synthetic-demo", dataset: DEMO_DATASET_VERSION },
      };
      scope = `Synthetic demo data (${DEMO_DATASET_VERSION}), not real campaign data. Campaign: ${campaign.name}.`;
    } else {
      const check = await validateTargetUrl(dto.url, { allowLoopback: this.config.URL_FETCH_ALLOW_PRIVATE });
      if (!check.ok) throw new BadRequestException({ code: check.code, message: check.message });
      input = { ...common, mode: "URL", targetUrl: check.url.href, question: dto.question ?? DEFAULT_URL_QUESTION, provenance: { kind: "live-http" } };
      scope = URL_SCOPE_STATEMENT;
    }
    const { investigation } = await this.ledger.create(input);
    // nobody queues an external run: it is RUNNING as soon as the agent has its id
    await this.ledger.transition(investigation.id, "QUEUED", "RUNNING", { model: dto.model });
    return {
      investigationId: investigation.id,
      mode: dto.mode,
      scope,
      tools: toolsForMode(dto.mode).map((s) => ({ name: s.name, description: s.description, inputSchema: toolInputJsonSchema(s.name) })),
      budgets: { toolCalls: TOOL_CALL_BUDGET, reportAttempts: REPORT_ATTEMPT_BUDGET, httpRequests: HTTP_REQUEST_CAP },
      periods,
    };
  }

  async callTool(id: string, tool: string, body: unknown): Promise<ToolResult> {
    const dto = parseOr400(AgentToolCallDtoSchema, body);
    await this.assertDriveable(id);
    const rejected = await this.prisma.toolExecution.count({ where: { investigationId: id, status: "REJECTED" } });
    if (rejected >= AGENT_REJECTED_CALL_CAP) {
      return {
        ok: false,
        error: {
          code: "BUDGET_EXCEEDED",
          message: `${AGENT_REJECTED_CALL_CAP} tool calls were already rejected in this investigation, so no more tool calls are accepted. Submit the report with the evidence you have.`,
          retryable: false,
        },
      };
    }
    return this.executor.execute(id, { tool, input: dto.input, callerRef: dto.callId });
  }

  async submitReport(id: string, body: unknown): Promise<AgentReportResponse> {
    const dto = parseOr400(AgentReportDtoSchema, body);
    await this.assertDriveable(id);
    const result = await this.reports.submit(id, dto.report);
    return result.accepted
      ? { accepted: true, url: `${this.config.WEB_ORIGIN.replace(/\/$/, "")}/investigations/${id}` }
      : { accepted: false, errors: result.errors };
  }

  async status(id: string): Promise<AgentInvestigationStatus> {
    const inv = await this.ledger.getInvestigation(id);
    if (!inv) throw new InvestigationNotFoundError(id);
    return {
      investigationId: inv.id,
      mode: inv.mode === "DEMO" ? "demo" : "url",
      status: inv.status,
      evidence: inv.evidence.map((e) => ({ ref: e.ref, statement: e.statement, strength: e.strength })),
      budgetsLeft: {
        toolCalls: Math.max(0, TOOL_CALL_BUDGET - inv.toolCalls),
        reportAttempts: Math.max(0, REPORT_ATTEMPT_BUDGET - inv.reportAttempts),
        httpRequests: Math.max(0, HTTP_REQUEST_CAP - inv.httpRequests),
      },
    };
  }

  private async assertDriveable(id: string): Promise<void> {
    const inv = await this.prisma.investigation.findUnique({ where: { id }, select: { runtime: true } });
    if (!inv) throw new InvestigationNotFoundError(id);
    if (!DRIVEABLE.includes(inv.runtime)) {
      throw new ConflictException({ code: "NOT_EXTERNAL_RUN", message: `A ${inv.runtime} run is driven by the application itself, not through the Agent API.` });
    }
  }
}
