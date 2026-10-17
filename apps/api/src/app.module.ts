import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./config/config";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { DemoDataModule } from "./demo-data/demo-data.module";
import { HealthModule } from "./health/health.module";
import { AgentApiModule } from "./http/agent/agent-api.module";
import { PublicApiModule } from "./http/public/public-api.module";
import { LedgerModule } from "./ledger/ledger.module";
import { ReportsModule } from "./reports/reports.module";
import { RuntimeModule } from "./runtime/runtime.module";
import { DemoToolsModule } from "./tools/demo/demo-tools.module";
import { ToolsModule } from "./tools/tools.module";
import { UrlToolsModule } from "./tools/url/url-tools.module";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), DbModule, LedgerModule, DemoDataModule, ToolsModule, DemoToolsModule, UrlToolsModule, ReportsModule, RuntimeModule, PublicApiModule, AgentApiModule, HealthModule],
    };
  }
}
