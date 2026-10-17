// Real headless run of Claude Code against the running app (spec story 70): `pnpm verify:claude-code`.
// Needs: docker compose up -d db; pnpm run setup; pnpm build; pnpm db:migrate; pnpm db:seed; pnpm dev (API on :4000);
// `claude` logged in. Uses your subscription: one short run (sonnet, 14 turns). Exit 0 only when the stored run is COMPLETED
// and was recorded with the client name "claude-code".
import { PROMPT, main, apiBase, checkStoredRun, requireReadyApp, runCli } from "./_lib.mjs";

await main(async () => {
const base = apiBase();
await requireReadyApp(base);

const args = [
  "-p",
  "--model", "claude-sonnet-5-5",
  "--max-turns", "14",
  "--mcp-config", ".mcp.json",
  "--strict-mcp-config",
  "--allowedTools", "mcp__campaign-sentinel__*",
  "--permission-mode", "dontAsk",
  "--output-format", "json",
];
console.log(`$ claude ${args.join(" ")}   (prompt on stdin)`);
const since = Date.now();
const res = await runCli("claude", args, PROMPT);
console.log(`claude exit code: ${res.status}`);
if (res.error) console.error(`claude could not run: ${res.error.message}`);
try {
  const out = JSON.parse(res.stdout);
  console.log(`claude result: is_error=${out.is_error} turns=${out.num_turns} subtype=${out.subtype}\n${String(out.result ?? "").slice(0, 400)}`);
} catch {
  console.log(`claude output (not JSON): ${res.stdout.slice(0, 400)}\n${res.stderr.slice(0, 400)}`);
}
const stored = await checkStoredRun(base, "claude-code", since);
return stored;
});
