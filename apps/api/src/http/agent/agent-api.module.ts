import { Module } from "@nestjs/common";
import { DemoDataModule } from "../../demo-data/demo-data.module";
import { LedgerModule } from "../../ledger/ledger.module";
import { ReportsModule } from "../../reports/reports.module";
import { ToolsModule } from "../../tools/tools.module";
import { AgentController } from "./agent.controller";
import { AgentGuard } from "./agent.guard";
import { AgentService } from "./agent.service";

/** Agent API for external agents: MCP clients and OpenClaw (spec 5.10). */
@Module({
  imports: [LedgerModule, DemoDataModule, ToolsModule, ReportsModule],
  controllers: [AgentController],
  providers: [AgentService, AgentGuard],
})
export class AgentApiModule {}
