import { Controller, Get, Inject } from "@nestjs/common";
import type { HealthResponse } from "@campaign-sentinel/contracts";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { PrismaService } from "../db/prisma.service";
import { aiRuntimeStatus, openclawStatus } from "../runtime/providers/provider-config";
import { isBrowserInstalled } from "../web-inspection/browser-check";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async get(): Promise<HealthResponse> {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(
      () => "up" as const,
      () => "down" as const,
    );
    return {
      status: db === "up" ? "ok" : "degraded",
      db,
      runtimes: {
        deterministic: "available",
        claude: this.config.ANTHROPIC_API_KEY ? "available" : "missing_key",
        openclaw: openclawStatus(this.config),
        browser: this.config.BROWSER_CHECKS !== "off" && (await isBrowserInstalled()) ? "available" : "unavailable",
        ai: aiRuntimeStatus(this.config),
      },
    };
  }
}
