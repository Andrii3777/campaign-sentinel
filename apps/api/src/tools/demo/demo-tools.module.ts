import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { CampaignDataRepository } from "../../demo-data/campaign-data.repository";
import { DemoDataModule } from "../../demo-data/demo-data.module";
import { ToolRegistry } from "../tool-registry";
import { ToolsModule } from "../tools.module";
import { createDemoToolHandlers } from "./demo-tools";

/** Registers the seven demo-mode tools with the shared ToolRegistry. */
@Module({ imports: [ToolsModule, DemoDataModule] })
export class DemoToolsModule implements OnModuleInit {
  constructor(
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(CampaignDataRepository) private readonly repo: CampaignDataRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register("demo", createDemoToolHandlers(this.repo));
  }
}
