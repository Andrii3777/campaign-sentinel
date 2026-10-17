// `pnpm run doctor` (bare `pnpm doctor` is pnpm's own command): is this checkout ready for a review? One ✓/✗ line per check, one fix hint per failure, non-zero exit when anything is missing.
// Never prints a secret: .env is only checked for the presence of SENTINEL_AGENT_TOKEN.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXPECTED_TOOLS = 15;

/** A check is `{name, run: async () => ({ok, detail?, fix?})}`; a thrown error counts as a failure. */
export async function runDoctor(checks) {
  const results = [];
  for (const check of checks) {
    try {
      results.push({ name: check.name, ...(await check.run()) });
    } catch (error) {
      results.push({ name: check.name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

export function formatReport({ ok, results }) {
  const lines = results.flatMap((r) => [`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`, ...(!r.ok && r.fix ? [`    fix: ${r.fix}`] : [])]);
  return [...lines, "", ok ? "All checks passed." : "Some checks failed: apply the fixes above and run `pnpm run doctor` again."].join("\n");
}

function readEnv(root) {
  try {
    return parseEnv(readFileSync(path.join(root, ".env"), "utf8"));
  } catch {
    return null;
  }
}

export const builtCheck = (root = repo) => ({
  name: "MCP server is built",
  run: async () => (existsSync(path.join(root, "apps/mcp/dist/index.js")) ? { ok: true, detail: "apps/mcp/dist/index.js" } : { ok: false, detail: "apps/mcp/dist/index.js is missing", fix: "pnpm build" }),
});

export const envCheck = (root = repo) => ({
  name: ".env has SENTINEL_AGENT_TOKEN",
  run: async () => {
    const env = readEnv(root);
    if (!env) return { ok: false, detail: ".env does not exist", fix: "pnpm run setup" };
    return env.SENTINEL_AGENT_TOKEN?.trim() ? { ok: true, detail: "set (value not shown)" } : { ok: false, detail: "SENTINEL_AGENT_TOKEN is empty", fix: "pnpm run setup" };
  },
});

function tcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

/** Host and port come from DATABASE_URL; the URL itself is never printed (it may hold a password). */
export const databaseCheck = (root = repo, connect = tcp) => ({
  name: "Postgres is reachable",
  run: async () => {
    let host = "127.0.0.1";
    let port = 5433;
    try {
      const url = new URL(readEnv(root)?.DATABASE_URL ?? "");
      host = url.hostname || host;
      port = Number(url.port) || port;
    } catch {
      // no usable DATABASE_URL: the compose default
    }
    return (await connect(host, port))
      ? { ok: true, detail: `${host}:${port}` }
      : { ok: false, detail: `nothing listens on ${host}:${port}`, fix: "docker compose up -d db   (start Docker Desktop first if it is not running)" };
  },
});

export function apiBase(root = repo) {
  const env = readEnv(root) ?? {};
  return (process.env.SENTINEL_VERIFY_API_URL || env.API_INTERNAL_URL || `http://127.0.0.1:${env.API_PORT || 4000}`).replace(/\/+$/, "");
}

/** host:port only: the base URL may carry userinfo. */
export const hostOf = (base) => {
  try {
    return new URL(base).host;
  } catch {
    return "the configured API URL";
  }
};

export const apiCheck = (root = repo, get = (url) => globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(5000) })) => ({
  name: "API answers /api/health",
  run: async () => {
    const base = apiBase(root);
    let health;
    try {
      const res = await get(`${base}/api/health`);
      if (!res.ok) return { ok: false, detail: `${hostOf(base)} answered ${res.status}`, fix: "pnpm dev   (and check the API log)" };
      health = await res.json();
    } catch {
      return { ok: false, detail: `no answer from ${hostOf(base)}`, fix: "docker compose up -d db && pnpm dev" };
    }
    const r = health.runtimes ?? {};
    const detail = `status ${health.status}, db ${health.db}; AI ${r.ai?.status ?? "?"}${r.ai?.provider ? ` (${r.ai.provider})` : ""}, OpenClaw ${r.openclaw ?? "?"}, browser checks ${r.browser ?? "?"}`;
    return health.db === "up" ? { ok: true, detail } : { ok: false, detail, fix: "docker compose up -d db, then pnpm db:migrate" };
  },
});

/** Spawns the built server and speaks newline-delimited JSON-RPC to it: initialize, tools/list, one list_demo_campaigns call. */
export function handshake(root = repo, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "apps/mcp/dist/index.js")], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    const out = { tools: 0, campaigns: 0 };
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    const done = (error) => {
      globalThis.clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(out);
    };
    const timer = globalThis.setTimeout(() => done(new Error(`no complete handshake within ${timeoutMs / 1000} s`)), timeoutMs);
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => done(e));
    child.on("exit", (code) => done(new Error(stderr.trim().split("\n")[0] || `the server exited (code ${code}) before the handshake finished`)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not protocol output
        }
        if (msg.id === 1) {
          send({ method: "notifications/initialized" });
          send({ id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          out.tools = msg.result?.tools?.length ?? 0;
          send({ id: 3, method: "tools/call", params: { name: "list_demo_campaigns", arguments: {} } });
        } else if (msg.id === 3) {
          if (msg.result?.isError) return done(new Error(`list_demo_campaigns failed: ${String(msg.result.content?.[0]?.text).slice(0, 160)}`));
          const parsed = JSON.parse(msg.result?.content?.[0]?.text ?? "{}");
          out.campaigns = (Array.isArray(parsed) ? parsed : (parsed.campaigns ?? parsed.items ?? [])).length;
          done();
        }
      }
    });
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sentinel-doctor", version: "1.0.0" } } });
  });
}

export const handshakeCheck = (root = repo, run = handshake) => ({
  name: "MCP handshake works (initialize, tools/list, list_demo_campaigns)",
  run: async () => {
    if (!existsSync(path.join(root, "apps/mcp/dist/index.js"))) return { ok: false, detail: "skipped: server not built", fix: "pnpm build" };
    const fix = "pnpm build, make sure the API is running (pnpm dev) and .env has a token, then retry";
    try {
      const { tools, campaigns } = await run(root);
      const detail = `${tools} tools, ${campaigns} demo campaigns`;
      return tools === EXPECTED_TOOLS && campaigns > 0 ? { ok: true, detail } : { ok: false, detail: `${detail} (expected ${EXPECTED_TOOLS} tools and at least one campaign)`, fix };
    } catch (error) {
      return { ok: false, detail: error.message, fix };
    }
  },
});

export const realChecks = (root = repo) => [builtCheck(root), envCheck(root), databaseCheck(root), apiCheck(root), handshakeCheck(root)];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runDoctor(realChecks());
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}
