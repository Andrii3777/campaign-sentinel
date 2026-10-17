import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export interface McpConfig {
  baseUrl: string;
  token: string;
}

/** `<repo>/.env`, located from this file (dist/env.js or src/env.ts), never from the working directory. */
export const REPO_ENV_FILE = path.resolve(__dirname, "../../../.env");

function readEnvFile(file: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const present = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);

/**
 * `SENTINEL_API_URL` and `SENTINEL_AGENT_TOKEN` from the environment, else from the repository `.env`.
 * Without a URL: `API_INTERNAL_URL`, else `http://127.0.0.1:<API_PORT or 4000>`.
 * Throws without a token; the message names variables only.
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env, envFile: string = REPO_ENV_FILE): McpConfig {
  const file = readEnvFile(envFile);
  const pick = (key: string) => present(env[key]) ?? present(file[key]);
  const token = pick("SENTINEL_AGENT_TOKEN");
  if (!token) {
    throw new Error("SENTINEL_AGENT_TOKEN is not set: export it, or run `pnpm run setup` in the repository to create .env.");
  }
  const urlVariable = pick("SENTINEL_API_URL") ? "SENTINEL_API_URL" : "API_INTERNAL_URL";
  const baseUrl = pick("SENTINEL_API_URL") ?? pick("API_INTERNAL_URL") ?? `http://127.0.0.1:${pick("API_PORT") ?? "4000"}`;
  assertAllowedApiUrl(baseUrl, urlVariable, pick("SENTINEL_ALLOW_REMOTE_API") === "1");
  return { baseUrl, token };
}

const isLoopbackHost = (host: string) => host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

/** The bearer token goes wherever this URL points, so only loopback is accepted unless the user opts in. Messages name variables, never values. */
function assertAllowedApiUrl(raw: string, variable: string, allowRemote: boolean): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variable} is not a valid URL: use http://127.0.0.1:<port>.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${variable} must be an http(s) URL.`);
  if (!allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error(`${variable} points to a non-loopback host, and the agent token would be sent there. Use localhost / 127.0.0.1, or set SENTINEL_ALLOW_REMOTE_API=1 to allow it.`);
  }
}
