import type { INestApplication } from "@nestjs/common";
import { HealthResponseSchema } from "@campaign-sentinel/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp } from "./boot";

let app: INestApplication;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app?.close();
});

describe("HTTP shell", () => {
  it("GET /api/health reports db up and runtime placeholders", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);
    expect(HealthResponseSchema.parse(res.body)).toMatchObject({ status: "ok", db: "up" });
    expect(res.body.runtimes.deterministic).toBe("available");
  });

  it("returns {code, message} without a stack for unknown routes", async () => {
    const res = await request(app.getHttpServer()).get("/api/nope").expect(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", message: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(js|ts):\d+/);
  });
});
