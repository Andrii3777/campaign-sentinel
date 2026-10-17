import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { AgentCreateInvestigationResponse, AgentInvestigationStatus, AgentReportResponse, ToolResult } from "@campaign-sentinel/contracts";
import type { Request, Response } from "express";
import { AgentGuard } from "./agent.guard";
import { AgentService } from "./agent.service";

/** Agent API for external agents (spec 5.10); errors leave as `{code, message, details?}` through HttpErrorFilter. */
@Controller("agent")
@UseGuards(AgentGuard)
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Get("campaigns")
  campaigns() {
    return this.agent.listCampaigns();
  }

  @Post("investigations")
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: Request): Promise<AgentCreateInvestigationResponse> {
    return this.agent.create(body, req.get("user-agent") ?? undefined);
  }

  /** Always 200: a refused or failed call is an `{ok:false}` ToolResult the agent can read and fix. */
  @Post("investigations/:id/tools/:tool")
  @HttpCode(200)
  tool(@Param("id") id: string, @Param("tool") tool: string, @Body() body: unknown): Promise<ToolResult> {
    return this.agent.callTool(id, tool, body);
  }

  @Post("investigations/:id/report")
  async report(@Param("id") id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AgentReportResponse> {
    const result = await this.agent.submitReport(id, body);
    res.status(result.accepted ? 200 : 422);
    return result;
  }

  @Get("investigations/:id")
  status(@Param("id") id: string): Promise<AgentInvestigationStatus> {
    return this.agent.status(id);
  }
}
