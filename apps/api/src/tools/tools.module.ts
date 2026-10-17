import { Module } from "@nestjs/common";
import { LedgerModule } from "../ledger/ledger.module";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";

/** Executor core. Tool modules import this and register their handlers in `onModuleInit`. */
@Module({ imports: [LedgerModule], providers: [ToolRegistry, ToolExecutor], exports: [ToolRegistry, ToolExecutor] })
export class ToolsModule {}
