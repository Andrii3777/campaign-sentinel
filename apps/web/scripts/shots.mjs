// Screenshots of a running web app in a clean Chromium (playwright-core).
// Usage: node scripts/shots.mjs [baseUrl] [outDir] [path...]   (defaults: http://localhost:3000, ../../docs/screenshots, /)
// SHOT_PREFIX (default 02) names the files; SHOT_FULL=1 captures the full page instead of the first viewport.
// Needs a browser once: pnpm --filter @campaign-sentinel/web exec playwright-core install chromium
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const [baseUrl = "http://localhost:3000", outDir = "../../docs/screenshots", ...paths] = process.argv.slice(2);
const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];
const prefix = process.env.SHOT_PREFIX ?? "02";
const fullPage = process.env.SHOT_FULL === "1";
const out = resolve(outDir);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const path of paths.length ? paths : ["/"]) {
    const slug = path === "/" ? "overview" : path.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-");
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(new URL(path, baseUrl).href, { waitUntil: "networkidle" });
      const file = resolve(out, `${prefix}-${slug}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage });
      console.log(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
