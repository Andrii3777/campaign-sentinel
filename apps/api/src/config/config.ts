import { z } from "zod";

/** Thrown at startup when the environment is invalid; the message names the variables, never their values. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// .env lines like `ANTHROPIC_API_KEY=` mean "not set"
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.output<T>) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.default(value as never));

const ConfigSchema = z
  .object({
    NODE_ENV: withDefault(z.enum(["development", "test", "production"]), "development"),
    DATABASE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgresql:// URL" }),
    ),
    API_PORT: withDefault(z.coerce.number().int().min(1).max(65535), 4000),
    // the public API is unauthenticated: listen on loopback unless the operator opts in (docker-compose sets 0.0.0.0)
    API_HOST: withDefault(z.string().min(1), "127.0.0.1"),
    WEB_ORIGIN: withDefault(z.url(), "http://localhost:3000"),
    SENTINEL_AGENT_TOKEN: optional(z.string().min(32, "SENTINEL_AGENT_TOKEN must be at least 32 characters")),
    LLM_PROVIDER: withDefault(z.enum(["anthropic", "openai", "gemini"]), "anthropic"),
    ANTHROPIC_API_KEY: optional(z.string()),
    ANTHROPIC_MODEL: withDefault(z.string(), "claude-opus-5-5"),
    ANTHROPIC_EFFORT: withDefault(z.string(), "medium"),
    OPENAI_API_KEY: optional(z.string()),
    OPENAI_MODEL: optional(z.string()),
    GEMINI_API_KEY: optional(z.string()),
    GEMINI_MODEL: optional(z.string()),
    OPENCLAW_GATEWAY_URL: optional(z.url()),
    OPENCLAW_GATEWAY_TOKEN: optional(z.string()),
    OPENCLAW_AGENT_ID: withDefault(z.string(), "sentinel"),
    BROWSER_CHECKS: withDefault(z.enum(["auto", "off"]), "auto"),
    URL_FETCH_ALLOW_PRIVATE: withDefault(z.stringbool(), false),
  })
  .refine((c) => !(c.NODE_ENV === "production" && c.URL_FETCH_ALLOW_PRIVATE), {
    message: "URL_FETCH_ALLOW_PRIVATE is test-only and refused when NODE_ENV=production",
    path: ["URL_FETCH_ALLOW_PRIVATE"],
  });

export type AppConfig = z.infer<typeof ConfigSchema>;
export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => {
    const name = i.path.join(".") || "(root)";
    return i.code === "invalid_type" && i.input === undefined ? `${name} is required` : `${name}: ${i.message}`;
  });
  throw new ConfigError(`Invalid configuration:\n  - ${lines.join("\n  - ")}`);
}
