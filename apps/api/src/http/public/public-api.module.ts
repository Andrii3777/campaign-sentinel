import { Module } from "@nestjs/common";
import { DemoDataModule } from "../../demo-data/demo-data.module";
import { LedgerModule } from "../../ledger/ledger.module";
import { RuntimeModule } from "../../runtime/runtime.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { CreationThrottle } from "./creation-throttle";
import { InvestigationsController } from "./investigations.controller";
import { InvestigationsService } from "./investigations.service";

/** Public API for the UI (spec §5.9). */
@Module({
  imports: [LedgerModule, DemoDataModule, RuntimeModule],
  controllers: [InvestigationsController, CampaignsController],
  providers: [InvestigationsService, CampaignsService, CreationThrottle],
  exports: [InvestigationsService],
})
export class PublicApiModule {}
