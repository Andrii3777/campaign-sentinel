// Real headless run of Codex against the running app (spec story 70): `pnpm verify:codex`.
// Same prerequisites as claude-code.mjs; `codex` logged in. Uses your subscription: one short run, low reasoning effort.
// Overrides are passed with -c for this invocation only and are never written to a file:
//  - approval_policy: Codex asks before non-read-only MCP tools (start_investigation, submit_report); exec cannot answer, so "never" asks nothing;
//  - mcp_servers.campaign-sentinel: the same server definition as .codex/config.toml, given inline because Codex loads a project
//    config only for a project trusted in your own ~/.codex/config.toml (a -c override does not grant that trust).
// Exit 0 only when the stored run is COMPLETED and was recorded with the client name "codex-mcp-client".
import { PROMPT, main, apiBase, checkStoredRun, repo, requireReadyApp, runCli } from "./_lib.mjs";

await main(async () => {
const base = apiBase();
await requireReadyApp(base);

// CODEX_BIN: launcher command with optional arguments, e.g. `npx -y @openai/codex@latest` (default `codex`)
const [bin, ...binArgs] = (process.env.CODEX_BIN || "codex").trim().split(/\s+/);
const args = [
  ...binArgs,
  "exec",
  "--json",
  "--ephemeral",
  "-C", repo,
  // CODEX_VERIFY_MODEL: only when your default model needs a newer Codex than the installed one (-m is then the escape hatch)
  ...(process.env.CODEX_VERIFY_MODEL ? ["-m", process.env.CODEX_VERIFY_MODEL] : []),
  "-c", 'model_reasoning_effort="low"',
  "-c", 'approval_policy="never"',
  // no elevated Windows sandbox setup (it waits for a UAC prompt and hangs a headless run); MCP-only run, so read-only is enough
  "-s", "read-only",
  "-c", 'windows.sandbox="unelevated"',
  "-c", 'mcp_servers.campaign-sentinel={command="node",args=["apps/mcp/dist/index.js"],startup_timeout_sec=20,tool_timeout_sec=60}',
  "-",
];
console.log(`$ ${bin} ${args.join(" ")}   (prompt on stdin)`);
const since = Date.now();
const res = await runCli(bin, args, PROMPT);
console.log(`codex exit code: ${res.status}`);
if (res.error) console.error(`codex could not run: ${res.error.message}`);
const events = res.stdout.split("\n").flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});
const mcpCalls = events.filter((e) => JSON.stringify(e).includes("campaign-sentinel")).length;
const last = events.filter((e) => e.item?.type === "agent_message").at(-1);
console.log(`codex events: ${events.length}, mentioning campaign-sentinel: ${mcpCalls}\nlast message: ${String(last?.item?.text ?? "").slice(0, 400)}`);
if (!last) {
  console.log(`events: ${events.map((e) => JSON.stringify(e).slice(0, 300)).join(" | ")}`);
  console.log(`stderr: ${res.stderr.slice(0, 600)}`);
}
const stored = await checkStoredRun(base, "codex-mcp-client", since);
return stored;
});
