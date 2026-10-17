import "reflect-metadata";
import type { INestApplication, LoggerService } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpErrorFilter } from "./common/http-error.filter";
import { jsonBodiesOnly } from "./common/json-only";
import { loadConfig, type AppConfig } from "./config/config";
import { RedactingLogger } from "./config/redacting-logger";

export interface CreateAppOptions {
  env?: Record<string, string | undefined>;
  logger?: LoggerService | false;
}

/** Builds the configured Nest app (used by main.ts and by integration/e2e tests). Throws ConfigError on bad env. */
export async function createApp(options: CreateAppOptions = {}): Promise<{ app: INestApplication; config: AppConfig }> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: options.logger ?? new RedactingLogger(env),
  });
  app.use(jsonBodiesOnly); // registered before the body parsers
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableCors({ origin: config.WEB_ORIGIN });
  app.enableShutdownHooks();
  return { app, config };
}
