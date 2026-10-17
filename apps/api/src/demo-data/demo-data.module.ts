import { Module } from "@nestjs/common";
import { CampaignDataRepository, PrismaCampaignDataRepository } from "./campaign-data.repository";

@Module({
  providers: [{ provide: CampaignDataRepository, useClass: PrismaCampaignDataRepository }],
  exports: [CampaignDataRepository],
})
export class DemoDataModule {}
