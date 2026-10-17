// Manual check, not in CI: runs the four URL-mode tools once against a real public site and prints the evidence.
// Usage: pnpm --filter @campaign-sentinel/api build && node scripts/verify/url-live.mjs [url]   (default https://example.com)
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../apps/api/dist/tools/url/url-tools.js", import.meta.url));
if (!existsSync(dist)) {
  console.error("Build the API first: pnpm --filter @campaign-sentinel/api build");
  process.exit(1);
}
const { createUrlToolHandlers, HTTP_REQUEST_CAP } = createRequire(import.meta.url)(dist);

const target = process.argv[2] ?? "https://example.com";
let requests = 0;
const handlers = createUrlToolHandlers({
  guard: {}, // the real guard: public addresses only, ports 80/443
  browserEnabled: process.env.BROWSER_CHECKS !== "off",
  reserveRequest: async () => ++requests <= HTTP_REQUEST_CAP,
  reportBlocked: async (_id, d) => console.log(`  guardrail.triggered ssrf_blocked ${JSON.stringify(d)}`),
  seenUrls: async () => new Set(),
});
const investigation = { id: "verify-url-live", mode: "URL", targetUrl: target };
const inputs = { fetch_page: {}, measure_availability: { attempts: 3 }, check_links: { limit: 10, scope: "all" }, browser_check: {} };

for (const handler of handlers) {
  console.log(`\n== ${handler.name}`);
  try {
    const out = await handler.run({ reason: "manual live check", ...inputs[handler.name] }, { investigation, signal: globalThis.AbortSignal.timeout(handler.timeoutMs) });
    for (const e of out.evidence ?? []) console.log(`  [${e.kind}/${e.strength}] ${e.statement}`);
    for (const w of out.warnings ?? []) console.log(`  warning: ${w}`);
    if (out.untrustedContent) console.log(`  untrusted excerpt (${out.untrustedContent.text.length} chars, signals: ${out.untrustedContent.injectionSignals.join(", ") || "none"}): ${out.untrustedContent.text.slice(0, 120)}…`);
  } catch (error) {
    console.log(`  tool error ${error.code ?? ""}: ${error.message}`);
  }
}
console.log(`\nOutbound HTTP requests counted: ${requests} (cap ${HTTP_REQUEST_CAP})`);
