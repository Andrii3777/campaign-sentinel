import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { LedgerModule } from "../ledger/ledger.module";
import { ToolRegistry } from "../tools/tool-registry";
import { ToolsModule } from "../tools/tools.module";
import type { ToolHandler } from "../tools/tool.types";
import { ReportService, submitReportHandler } from "./report.service";

/** ReportService + the `submit_report` tool (both modes) registered with the shared ToolRegistry. */
@Module({ imports: [LedgerModule, ToolsModule], providers: [ReportService], exports: [ReportService] })
export class ReportsModule implements OnModuleInit {
  constructor(
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  onModuleInit(): void {
    this.registry.register("both", [submitReportHandler(this.reports) as ToolHandler]);
  }
}
