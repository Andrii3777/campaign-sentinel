// Shared helpers of the real-client verification scripts (spec story 70). Never reads or prints a token:
// the MCP server finds SENTINEL_AGENT_TOKEN in the repository .env itself.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url))); // no trailing separator: it would escape the closing quote on Windows
const { scenarioCatalogue } = createRequire(import.meta.url)(path.join(repo, "packages/contracts/dist/index.js"));

export const campaignId = scenarioCatalogue.find((s) => s.key === "tracking-break").campaignId;

/** Deliberately names the campaign id only: the scenario label is the hidden ground truth and must not reach the agent. */
export const PROMPT =
  `Use the investigate-campaign skill and the campaign-sentinel MCP tools to investigate the demo campaign "${campaignId}". ` +
  `Keep it short: a few tool calls, then submit the report. Reply with one line: the verdict and the investigation id.`;

export function apiBase() {
  if (process.env.SENTINEL_VERIFY_API_URL) return process.env.SENTINEL_VERIFY_API_URL.replace(/\/+$/, "");
  try {
    const env = parseEnv(readFileSync(path.join(repo, ".env"), "utf8"));
    return (env.API_INTERNAL_URL || `http://localhost:${env.API_PORT || 4000}`).replace(/\/+$/, "");
  } catch {
    return "http://localhost:4000";
  }
}

export async function getJson(base, route) {
  const res = await globalThis.fetch(`${base}${route}`, { signal: globalThis.AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${route} -> ${res.status}`);
  return res.json();
}

/** Stops early with a readable reason when the app is not ready for a real run. */
export async function requireReadyApp(base) {
  if (!existsSync(path.join(repo, "apps/mcp/dist/index.js"))) fail("apps/mcp/dist/index.js is missing: run `pnpm build`.");
  if (!existsSync(path.join(repo, ".env"))) fail(".env is missing: run `pnpm run setup`.");
  try {
    const health = await getJson(base, "/api/health");
    if (health.db !== "ok" && health.status !== "ok") console.warn(`warning: /api/health reports ${JSON.stringify(health).slice(0, 200)}`);
  } catch (error) {
    fail(`The API is not reachable at ${base} (${error.message}). Start it: docker compose up -d db && pnpm dev`);
  }
}

export function fail(message) {
  throw new Error(message);
}

/** Runs a script body that returns true/false; a precondition failure exits 2. Sets exitCode instead of calling process.exit()
 *  (Node 26 on Windows can abort on exit while fetch handles are still closing). */
export async function main(body) {
  try {
    process.exitCode = (await body()) ? 0 : 1;
  } catch (error) {
    console.error(`verify: ${error.message}`);
    process.exitCode = 2;
  }
}

// On Windows, npm shims (codex.cmd) need a shell; quote every argument so quotes and spaces survive.
const quote = (arg) => (process.platform === "win32" ? `"${String(arg).replace(/"/g, '\\"')}"` : String(arg));

/**
 * Runs a CLI with the prompt on stdin (no quoting problems). Resolves {status, stdout, stderr, error}.
 * On timeout the whole process tree is killed (taskkill /T on Windows): a hung helper must not outlive the script.
 */
export function runCli(command, args, input, timeoutMs = 300_000) {
  const win = process.platform === "win32";
  return new Promise((resolve) => {
    const child = spawn(command, win ? args.map(quote) : args, { cwd: repo, shell: win, detached: !win });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      if (win) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => resolve({ status: 1, stdout, stderr, error }));
    child.on("close", (code) => {
      globalThis.clearTimeout(timer);
      resolve({ status: timedOut ? 124 : (code ?? 1), stdout, stderr, error: timedOut ? new Error(`timed out after ${timeoutMs} ms; process tree killed`) : undefined });
    });
    child.stdin.end(input);
  });
}

/**
 * Checks through the public API that a run from `clientName` on the campaign was created after `since` and is COMPLETED
 * with a stored report. Prints run id, status and the client as the API recorded them. Returns true when all of it holds.
 */
export async function checkStoredRun(base, clientName, since) {
  const list = await getJson(base, "/api/investigations?limit=30");
  const candidates = list.items.filter((i) => i.source === "mcp" && i.clientName === clientName && i.campaignId === campaignId && Date.parse(i.createdAt) >= since - 2000);
  if (candidates.length === 0) {
    const seen = [...new Set(list.items.filter((i) => i.source === "mcp").map((i) => i.clientName))];
    console.error(`verify: no run from client "${clientName}" on ${campaignId} was recorded (mcp clients seen: ${seen.join(", ") || "none"}).`);
    return false;
  }
  const run = await getJson(base, `/api/investigations/${candidates[0].id}`);
  const ok = run.status === "COMPLETED" && run.report !== null && run.source === "mcp" && run.runtime === "external";
  console.log(
    JSON.stringify(
      {
        investigationId: run.id,
        status: run.status,
        source: run.source,
        runtime: run.runtime,
        clientName: run.clientName,
        clientVersion: run.clientVersion,
        clientUserAgent: run.clientUserAgent,
        toolCalls: run.counters.toolCalls,
        reportAttempts: run.counters.reportAttempts,
        verdict: run.report?.verdict ?? null,
        severity: run.report?.severity ?? null,
        failure: run.failureCode ? `${run.failureCode}: ${run.failureMessage}` : null,
        ok,
      },
      null,
      2,
    ),
  );
  return ok;
}
