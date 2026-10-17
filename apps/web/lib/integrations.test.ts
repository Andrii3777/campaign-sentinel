import { describe, expect, it } from "vitest";
import type { HealthResponse } from "@campaign-sentinel/contracts";
import { buildIntegrationRows } from "./integrations";
import { parseVerification } from "./verification";

const health = (ai: HealthResponse["runtimes"]["ai"], openclaw: HealthResponse["runtimes"]["openclaw"]): HealthResponse => ({
  status: "ok",
  db: "up",
  runtimes: { deterministic: "available", claude: "available", openclaw, browser: "available", ai },
});

describe("parseVerification", () => {
  it("treats a missing file as no records and no problem", () => {
    expect(parseVerification(null)).toEqual({ records: [] });
  });

  it("reads records and keeps optional fields optional", () => {
    const raw = JSON.stringify([
      { id: "codex", label: "Codex", status: "verified", checkedAt: "2026-10-17T10:00:00Z", evidence: "pnpm verify:codex" },
      { id: "cursor", label: "Cursor", status: "configured" },
    ]);
    const { records, problem } = parseVerification(raw);
    expect(problem).toBeUndefined();
    expect(records.map((r) => r.id)).toEqual(["codex", "cursor"]);
    expect(records[1]?.checkedAt).toBeUndefined();
  });

  it("reports a broken file instead of throwing, and shows no records", () => {
    expect(parseVerification("{nope").problem).toMatch(/JSON/);
    const wrongStatus = parseVerification(JSON.stringify([{ id: "codex", label: "Codex", status: "great" }]));
    expect(wrongStatus.records).toEqual([]);
    expect(wrongStatus.problem).toMatch(/status/);
  });
});

describe("buildIntegrationRows", () => {
  it("lists the seven integrations in order and says not verified when there is no record", () => {
    const rows = buildIntegrationRows(health({ provider: "anthropic", model: "claude-opus-5-5", status: "available" }, "not_configured"), []);
    expect(rows.map((r) => r.id)).toEqual(["deterministic", "ai", "openclaw", "claude-code", "codex", "cursor", "antigravity"]);
    expect(rows.every((r) => r.verification === "not_verified")).toBe(true);
  });

  it("takes live state from health for runtimes and none for IDE clients", () => {
    const rows = buildIntegrationRows(health({ provider: "openai", model: "gpt-6-astra", status: "missing_key" }, "configured"), []);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.deterministic?.live).toEqual({ state: "available", detail: undefined });
    expect(by.ai?.live).toEqual({ state: "missing_key", detail: "openai · gpt-6-astra" });
    expect(by.openclaw?.live?.state).toBe("configured");
    expect(by.codex?.live).toBeNull();
  });

  it("marks live state unknown when the API did not answer", () => {
    const rows = buildIntegrationRows(null, []);
    expect(rows.find((r) => r.id === "ai")?.live?.state).toBe("unknown");
  });

  it("applies a record by id and ignores records for unknown ids", () => {
    const rows = buildIntegrationRows(null, [
      { id: "openclaw", label: "OpenClaw", status: "experimental", checkedAt: "2026-10-17T10:00:00Z", evidence: "docs/verification.md" },
      { id: "vim", label: "Vim", status: "verified" },
    ]);
    expect(rows.find((r) => r.id === "openclaw")).toMatchObject({ verification: "experimental", checkedAt: "2026-10-17T10:00:00Z", evidence: "docs/verification.md" });
    expect(rows.some((r) => r.id === "vim")).toBe(false);
  });
});
