// Generates docs/examples/ from REAL deterministic runs: the five demo scenarios plus one URL run against a local fixture page.
// Nothing here is hand-written output: each folder holds the request body sent to the API, the stored report as the API returns it,
// and a markdown rendering of that report; expected-outcomes.md compares spec §8 with what happened.
//
//   node scripts/examples.mjs                      (needs Postgres: docker compose up -d db; builds the API first)
//   DATABASE_URL_EXAMPLES=postgresql://… node scripts/examples.mjs   use another database (runs are stored there like any run)
//
// The script starts the API itself on port 4200 and a fixture site on 4210, and stops both when it ends (also on Ctrl+C or an error).
// No network, no keys: BROWSER_CHECKS=off, provider keys blanked, runtime "deterministic".
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = path.join(repo, "docs", "examples");
const API_PORT = 4200;
const SITE_PORT = 4210;
const api = `http://127.0.0.1:${API_PORT}`;
const win = process.platform === "win32";
const { scenarioCatalogue } = createRequire(import.meta.url)(path.join(repo, "packages/contracts/dist/index.js"));

function dotenv() {
  try {
    return parseEnv(readFileSync(path.join(repo, ".env"), "utf8"));
  } catch {
    return {};
  }
}
const fileEnv = dotenv();
const databaseUrl = process.env.DATABASE_URL_EXAMPLES || process.env.DATABASE_URL || fileEnv.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set: run `pnpm run setup` and start the database (docker compose up -d db).");

// Everything the API needs comes from here; secrets stay blank so the output never depends on the developer's keys.
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  API_PORT: String(API_PORT),
  URL_FETCH_ALLOW_PRIVATE: "1",
  BROWSER_CHECKS: "off",
  LLM_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  OPENCLAW_GATEWAY_URL: "",
  OPENCLAW_GATEWAY_TOKEN: "",
};

function sh(command, args, env = childEnv) {
  const result = win ? spawnSync([command, ...args].join(" "), { cwd: repo, env, shell: true, stdio: "pipe", encoding: "utf8" }) : spawnSync(command, args, { cwd: repo, env, stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${(result.stdout + result.stderr).slice(-1500)}`);
}

// ---- fixture site: the committed test page, served on loopback (the guard admits it only under URL_FETCH_ALLOW_PRIVATE) ----
const pages = path.join(repo, "apps/api/test/fixtures/sites/pages");
const okPage = readFileSync(path.join(pages, "ok.html"), "utf8");
const tiny = (title) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
const site = createServer((req, res) => {
  const p = new URL(req.url ?? "/", "http://fixture.local").pathname;
  const headers = { "content-type": "text/html; charset=utf-8" };
  if (p === "/ok") Object.assign(headers, { "strict-transport-security": "max-age=31536000", "content-security-policy": "frame-ancestors 'self'" });
  const body = p === "/ok" ? okPage : p === "/about" || p === "/pricing" ? tiny(p.slice(1)) : null;
  res.writeHead(body === null ? 404 : 200, headers);
  res.end(req.method === "HEAD" ? undefined : (body ?? tiny("Not found")));
});

let apiProcess = null;
let apiLog = "";
function stopAll() {
  if (apiProcess?.pid && apiProcess.exitCode === null) {
    if (win) spawnSync("taskkill", ["/PID", String(apiProcess.pid), "/T", "/F"], { stdio: "ignore" });
    else apiProcess.kill("SIGTERM");
  }
  site.close();
}
process.on("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const sleep = (ms) => new Promise((r) => globalThis.setTimeout(r, ms));
async function call(method, route, body) {
  const res = await globalThis.fetch(`${api}${route}`, {
    method,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function waitForHealth() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (apiProcess.exitCode !== null) throw new Error(`The API exited early:\n${apiLog.slice(-1500)}`);
    try {
      const health = await call("GET", "/api/health");
      if (health.db === "up") return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`The API did not become healthy within 60 s:\n${apiLog.slice(-1500)}`);
}

async function runToEnd(body) {
  const created = await call("POST", "/api/investigations", body);
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const detail = await call("GET", `/api/investigations/${created.id}`);
    if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(detail.status)) return detail;
    await sleep(300);
  }
  throw new Error(`investigation ${created.id} did not finish in 120 s`);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Markdown rendering of a stored report (the product has no markdown export; this one is only for these examples). */
function renderMarkdown(detail) {
  const r = detail.report.payload;
  const lines = [];
  const subject = detail.mode === "demo" ? `${detail.campaignName} (${detail.campaignId})` : detail.targetUrl;
  lines.push(`# Investigation report: ${subject}`, "");
  lines.push(`- Verdict: **${r.verdict}** · Severity: **${r.severity}** — ${r.severityRationale}`);
  lines.push(`- Run \`${detail.id}\` · mode ${detail.mode} · runtime ${r.runtime} (model ${r.model ?? "none"}) · provenance ${r.provenance}`);
  lines.push(`- Question: ${detail.question}`, "");
  lines.push("## Summary", "", r.summary, "", "## What changed", "", r.whatChanged, "");
  lines.push("## Key metrics (computed by the server from tool evidence)", "", "```json", JSON.stringify(r.keyMetrics, null, 2), "```", "");
  lines.push("## Observations", "", ...r.observations.map((o) => `- ${o.statement} [${o.evidenceIds.join(", ")}]`), "");
  lines.push("## Hypotheses", "", "| id | category | status | confidence | statement | supporting | contradicting |", "|---|---|---|---|---|---|---|");
  for (const h of r.hypotheses) {
    lines.push(`| ${h.id} | ${h.category} | ${h.status} | ${h.confidence} | ${cell(h.statement)} | ${h.supportingEvidenceIds.join(", ") || "-"} | ${h.contradictingEvidenceIds.join(", ") || "-"} |`);
  }
  lines.push("", ...r.hypotheses.map((h) => `- ${h.id} confidence rationale: ${h.confidenceRationale}`), "");
  lines.push("## Unknowns", "", ...(r.unknowns.length ? r.unknowns.map((u) => `- **${u.question}** ${u.whyItMatters} How to resolve: ${u.howToResolve}`) : ["- none"]), "");
  lines.push("## Recommended actions", "", ...r.recommendedActions.map((a) => `- (${a.priority}) ${a.action} — ${a.rationale} [${a.hypothesisIds.join(", ")}]`), "");
  lines.push("## Limitations", "", ...(r.limitations.length ? r.limitations.map((l) => `- ${l}`) : ["- none"]), "");
  lines.push("## Security notes", "", ...(r.securityNotes.length ? r.securityNotes.map((s) => `- ${s}`) : ["- none"]), "");
  if (r.toolFailures.length) lines.push("## Tool failures", "", ...r.toolFailures.map((f) => `- ${f.tool}: ${f.code} — ${f.message}`), "");
  if (r.validationWarnings.length) lines.push("## Validation warnings", "", ...r.validationWarnings.map((w) => `- ${w}`), "");
  lines.push("## Evidence", "", ...Object.entries(r.evidenceIndex).map(([ref, statement]) => `- **${ref}** ${statement}`), "");
  return lines.join("\n");
}

const toolSequence = (detail) => detail.toolExecutions.filter((t) => t.tool !== "submit_report").map((t) => (t.status === "SUCCEEDED" ? t.tool : `${t.tool}(${t.status.toLowerCase()})`));
const toolFailures = (detail) => detail.toolExecutions.filter((t) => t.status === "FAILED").length;

function save(folder, request, detail) {
  const dir = path.join(out, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "request.json"), json(request));
  writeFileSync(path.join(dir, "report.json"), json(detail.report));
  writeFileSync(path.join(dir, "report.md"), renderMarkdown(detail));
}

async function main() {
  console.log("examples: building contracts + API");
  sh("pnpm", ["--filter", "@campaign-sentinel/contracts", "build"]);
  sh("pnpm", ["--filter", "@campaign-sentinel/api", "build"]);
  console.log("examples: migrating and seeding the database");
  sh("pnpm", ["--filter", "@campaign-sentinel/api", "db:migrate"]);
  sh("node", ["apps/api/prisma/seed.mjs"]);

  await new Promise((resolve, reject) => site.once("error", reject).listen(SITE_PORT, "127.0.0.1", resolve));
  apiProcess = spawn("node", ["apps/api/dist/main.js"], { cwd: repo, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  apiProcess.stdout.on("data", (d) => (apiLog += d));
  apiProcess.stderr.on("data", (d) => (apiLog += d));
  await waitForHealth();
  console.log(`examples: API up on ${api}, fixture site on 127.0.0.1:${SITE_PORT}`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const rows = [];

  for (const scenario of scenarioCatalogue) {
    const request = { mode: "demo", campaignId: scenario.campaignId, runtime: "deterministic" };
    const detail = await runToEnd(request);
    if (!detail.report) throw new Error(`${scenario.key}: run ${detail.id} ended ${detail.status} ${detail.failureCode ?? ""} without a report`);
    save(scenario.key, request, detail);
    const gt = detail.groundTruth;
    const severityOk = detail.report.severity === scenario.expectedSeverity;
    rows.push({ scenario, detail, gt, ok: Boolean(gt?.match) && severityOk });
    console.log(`examples: ${scenario.key}: ${detail.report.verdict} / ${detail.report.severity} / ${gt?.agentTopCategory} -> ${gt?.match && severityOk ? "as expected" : "MISMATCH"}`);
  }

  const urlRequest = { mode: "url", url: `http://127.0.0.1:${SITE_PORT}/ok`, runtime: "deterministic" };
  const urlDetail = await runToEnd(urlRequest);
  if (!urlDetail.report) throw new Error(`url run ${urlDetail.id} ended ${urlDetail.status} ${urlDetail.failureCode ?? ""} without a report`);
  save("url-fixture-ok", urlRequest, urlDetail);
  const urlChecks = {
    completed: urlDetail.status === "COMPLETED",
    scopeStatement: urlDetail.report.payload.limitations.some((l) => l.includes("does not reveal")),
    noConversionClaims: urlDetail.report.verdict !== "cause_identified",
    liveProvenance: urlDetail.report.payload.provenance === "live-http",
  };
  const urlOk = Object.values(urlChecks).every(Boolean);

  const lines = [
    "# Expected outcomes vs. what happened",
    "",
    `Generated by \`node scripts/examples.mjs\` on ${new Date().toISOString().slice(0, 10)} from real runs of the deterministic runtime (no AI, no network). The expected column is the ground truth of dataset \`synthetic-demo-v1\` (spec §8, \`scenarioCatalogue\` in \`packages/contracts\`); tools and the policy never read it, the comparison is made afterwards.`,
    "",
    "## Demo scenarios",
    "",
    "| Scenario | Campaign | Expected top category | Got | Expected verdict | Got | Expected severity | Got | Tool sequence | Failed tool calls | Match |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { scenario, detail, gt, ok } of rows) {
    lines.push(
      `| \`${scenario.key}\` | ${scenario.campaignId} | ${scenario.expectedCategory ?? "none (inconclusive)"} | ${gt?.agentTopCategory ?? "-"} | ${scenario.expectedVerdicts.join(" / ")} | ${detail.report.verdict} | ${scenario.expectedSeverity} | ${detail.report.severity} | ${toolSequence(detail).join(" → ")} | ${toolFailures(detail)} | ${ok ? "yes" : "NO"} |`,
    );
  }
  const distinct = new Set(rows.map((r) => toolSequence(r.detail).map((t) => t.replace(/\(.*\)$/, "")).join(">"))).size;
  lines.push("", `Distinct tool sequences across the five scenarios: **${distinct}** (spec story 5 asks for at least four).`, "");
  lines.push("## URL run against the local fixture page", "");
  lines.push(
    "URL runs have no hidden ground truth. The checks are properties the product promises (spec stories 38 and 44): the run completes, the stored limitations carry the scope statement, no conversion cause is claimed, and the data is labelled live HTTP.",
    "",
    "| Request | Verdict | Severity | Top category | Tool sequence | completed | scope statement | no conversion claim | provenance live-http |",
    "|---|---|---|---|---|---|---|---|---|",
    `| \`${urlRequest.url}\` | ${urlDetail.report.verdict} | ${urlDetail.report.severity} | ${urlDetail.report.payload.hypotheses[0]?.category ?? "-"} | ${toolSequence(urlDetail).join(" → ")} | ${urlChecks.completed ? "yes" : "NO"} | ${urlChecks.scopeStatement ? "yes" : "NO"} | ${urlChecks.noConversionClaims ? "yes" : "NO"} | ${urlChecks.liveProvenance ? "yes" : "NO"} |`,
    "",
    "The fixture page is `apps/api/test/fixtures/sites/pages/ok.html`, served on `127.0.0.1:4210` by the script (a loopback address is reachable only because the script sets the test-only `URL_FETCH_ALLOW_PRIVATE=1`). Browser checks were off, so `browser_check` was not part of the run.",
    "",
    "## Files",
    "",
    "Each folder holds `request.json` (the body sent to `POST /api/investigations`), `report.json` (the `report` object of `GET /api/investigations/:id`: verdict, severity, summary and the validated payload with the server attachments) and `report.md` (a markdown rendering of that report made by the script).",
    "",
    ...rows.map(({ scenario, detail }) => `- [\`${scenario.key}\`](./${scenario.key}/report.md) — run \`${detail.id}\``),
    `- [\`url-fixture-ok\`](./url-fixture-ok/report.md) — run \`${urlDetail.id}\``,
    "",
    "Reproduce: `docker compose up -d db && node scripts/examples.mjs`. Ids and timestamps differ on every run; verdicts, categories and metrics do not (seeded data, deterministic policy).",
    "",
  );
  writeFileSync(path.join(out, "expected-outcomes.md"), lines.join("\n"));

  const bad = rows.filter((r) => !r.ok).map((r) => r.scenario.key);
  if (!urlOk) bad.push("url-fixture-ok");
  if (bad.length) throw new Error(`outcome differs from the expectation: ${bad.join(", ")} (see docs/examples/expected-outcomes.md)`);
  console.log(`examples: wrote ${path.relative(repo, out)} (${rows.length} demo runs + 1 URL run), all as expected`);
}

try {
  await main();
} catch (error) {
  console.error(`examples: ${error.message}`);
  process.exitCode = 1;
} finally {
  stopAll();
}
