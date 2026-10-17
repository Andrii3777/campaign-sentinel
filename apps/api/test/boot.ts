import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";

/** Boots the real app against DATABASE_URL (set to DATABASE_URL_TEST by vitest.int.config.ts), without logs. */
export async function bootApp(): Promise<INestApplication> {
  const { app } = await createApp({ logger: false });
  await app.init();
  return app;
}
