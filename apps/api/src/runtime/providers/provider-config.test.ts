import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config/config";
import { aiRuntimeStatus, createProviderSession, openclawStatus } from "./provider-config";

const env = (extra: Record<string, string>) => loadConfig({ DATABASE_URL: "postgresql://postgres@localhost:5433/x", ...extra });

describe("aiRuntimeStatus", () => {
  it("reports missing_key until the chosen provider's own key is set", () => {
    expect(aiRuntimeStatus(env({ LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" }))).toEqual({ provider: "openai", model: "gpt-6-astra", status: "missing_key" });
    expect(aiRuntimeStatus(env({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }))).toEqual({ provider: "gemini", model: "gemini-3.5-flash", status: "available" });
    expect(aiRuntimeStatus(env({ ANTHROPIC_API_KEY: "k" }))).toEqual({ provider: "anthropic", model: "claude-opus-5-5", status: "available" });
  });

  it("lets the model id be overridden per provider", () => {
    expect(aiRuntimeStatus(env({ LLM_PROVIDER: "openai", OPENAI_MODEL: "custom-model" })).model).toBe("custom-model");
  });

  it("flags a provider outside the three supported ones", () => {
    const config = { ...env({}), LLM_PROVIDER: "mistral" } as unknown as Parameters<typeof aiRuntimeStatus>[0];
    expect(aiRuntimeStatus(config).status).toBe("unknown_provider");
  });
});

describe("createProviderSession", () => {
  it("builds the session for the chosen provider, labelled provider:model", () => {
    expect(createProviderSession(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" })).model).toBe("openai:gpt-6-astra");
    expect(createProviderSession(env({ ANTHROPIC_API_KEY: "k" })).model).toBe("anthropic:claude-opus-5-5");
  });

  it("refuses with MODEL_CONFIG_ERROR naming the variable when the key is missing", () => {
    expect(() => createProviderSession(env({ LLM_PROVIDER: "gemini" }))).toThrow(/GEMINI_API_KEY/);
  });
});

describe("openclawStatus", () => {
  it("needs both the gateway URL and the token", () => {
    expect(openclawStatus(env({ OPENCLAW_GATEWAY_URL: "http://127.0.0.1:18789" }))).toBe("not_configured");
    expect(openclawStatus(env({ OPENCLAW_GATEWAY_URL: "http://127.0.0.1:18789", OPENCLAW_GATEWAY_TOKEN: "t" }))).toBe("configured");
  });
});
