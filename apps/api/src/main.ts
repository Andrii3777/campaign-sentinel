import path from "node:path";
import { createApp } from "./app";
import { ConfigError } from "./config/config";
import { RedactingLogger } from "./config/redacting-logger";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  // no .env file: use the process environment as is
}

createApp()
  .then(async ({ app, config }) => {
    await app.listen(config.API_PORT, config.API_HOST);
  })
  .catch((error: unknown) => {
    const logger = new RedactingLogger();
    // ConfigError messages name variables only, never values
    if (error instanceof ConfigError) logger.error(error.message, undefined, "Config");
    else logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error), undefined, "Startup");
    process.exit(1);
  });
