import { Controller, Get, Inject, Param } from "@nestjs/common";
import type { CampaignDetail, CampaignListItem } from "@campaign-sentinel/contracts";
import { CampaignsService } from "./campaigns.service";

@Controller("campaigns")
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @Get()
  async list(): Promise<{ items: CampaignListItem[] }> {
    return { items: await this.campaigns.list() };
  }

  @Get(":id")
  detail(@Param("id") id: string): Promise<CampaignDetail> {
    return this.campaigns.detail(id);
  }
}
