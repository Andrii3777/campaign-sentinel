import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/config";
import { PrismaService } from "../../db/prisma.service";
import { LedgerModule } from "../../ledger/ledger.module";
import { LedgerService } from "../../ledger/ledger.service";
import { ToolRegistry } from "../tool-registry";
import { ToolsModule } from "../tools.module";
import { HTTP_REQUEST_CAP, createUrlToolHandlers } from "./url-tools";

/** Registers the four URL-mode tools (live HTTP through SafeFetcher) with the shared ToolRegistry. */
@Module({ imports: [ToolsModule, LedgerModule] })
export class UrlToolsModule implements OnModuleInit {
  constructor(
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const { ledger, prisma, config } = this;
    this.registry.register(
      "url",
      createUrlToolHandlers({
        // config already refuses URL_FETCH_ALLOW_PRIVATE under NODE_ENV=production
        guard: { allowLoopback: config.URL_FETCH_ALLOW_PRIVATE },
        browserEnabled: config.BROWSER_CHECKS !== "off",
        async reserveRequest(id) {
          const { httpRequests } = await ledger.incrementCounters(id, { httpRequests: 1 });
          if (httpRequests <= HTTP_REQUEST_CAP) return true;
          await ledger.incrementCounters(id, { httpRequests: -1 });
          // once per investigation, however many calls hit the cap afterwards
          const seen = (await prisma.investigationEvent.count({ where: { investigationId: id, type: "guardrail.triggered", payload: { path: ["kind"], equals: "budget_limit" } } })) > 0;
          if (!seen) {
            await ledger.appendEvent(id, "guardrail.triggered", {
              kind: "budget_limit",
              details: { budget: "httpRequests", limit: HTTP_REQUEST_CAP },
            });
          }
          return false;
        },
        async reportBlocked(id, details) {
          await ledger.appendEvent(id, "guardrail.triggered", { kind: "ssrf_blocked", details });
        },
        async seenUrls(id) {
          const done = await prisma.toolExecution.findMany({
            where: { investigationId: id, tool: "fetch_page", status: "SUCCEEDED" },
            select: { output: true },
          });
          const urls = new Set<string>();
          for (const { output } of done) {
            const analysis = (output as { data?: { analysis?: { links?: { url: string }[]; forms?: { action: string | null }[] } } })
              ?.data?.analysis;
            for (const l of analysis?.links ?? []) urls.add(l.url);
            for (const f of analysis?.forms ?? []) if (f.action) urls.add(f.action);
          }
          return urls;
        },
      }),
    );
  }
}
