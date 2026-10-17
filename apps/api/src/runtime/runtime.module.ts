import { Module } from "@nestjs/common";
import { LedgerModule } from "../ledger/ledger.module";
import { ReportsModule } from "../reports/reports.module";
import { ToolsModule } from "../tools/tools.module";
import { OpenClawDispatcher } from "./openclaw/openclaw-dispatcher";
import { Runner } from "./runner";
import { SessionFactory } from "./session-factory";

/** The built-in agent loop: Runner (queue, budgets, recovery) + SessionFactory (`createSession`). */
@Module({ imports: [LedgerModule, ToolsModule, ReportsModule], providers: [Runner, SessionFactory, OpenClawDispatcher], exports: [Runner, SessionFactory] })
export class RuntimeModule {}
