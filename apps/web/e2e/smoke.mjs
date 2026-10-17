/* global fetch */
// UI smoke test: the main path in a real browser against a running stack (pnpm dev, db seeded).
//   UI_BASE_URL  web app   (default http://localhost:3000)
//   UI_API_URL   API       (default http://localhost:4000), only used for a fast "is the stack up" check
// Needs Chromium once: pnpm --filter @campaign-sentinel/web exec playwright-core install chromium
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const web = (process.env.UI_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const api = (process.env.UI_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
// Scenario tracking-break (spec §8) lives on this campaign.
const TRACKING_BREAK_CAMPAIGN = "home-insurance-search";
const RUN_TIMEOUT_MS = 60_000;

async function main() {
  const health = await fetch(`${api}/api/health`).catch(() => null);
  assert.ok(health?.ok, `The API at ${api} did not answer /api/health. Start the stack and seed it (pnpm dev, pnpm db:seed).`);

  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

    // 1. /campaigns -> campaign page -> start a deterministic run
    await page.goto(`${web}/campaigns`);
    await page.locator(`a[href="/campaigns/${TRACKING_BREAK_CAMPAIGN}#investigate"]`).click();
    await page.waitForURL(new RegExp(`/campaigns/${TRACKING_BREAK_CAMPAIGN}(#|$)`));
    const deterministic = page.getByRole("radio", { name: /Deterministic/ });
    assert.ok(await deterministic.isChecked(), "Deterministic is the default runtime");
    await page.getByRole("button", { name: "Start investigation" }).click();
    await page.waitForURL(/\/investigations\/[^/]+$/);

    // 2. the timeline grows with persisted tool calls, then the report verdict appears
    const calls = page.locator('li[id^="call-"]');
    await calls.first().waitFor({ timeout: RUN_TIMEOUT_MS });
    const firstSeen = await calls.count();
    await page.locator("#verdict-heading").waitFor({ timeout: RUN_TIMEOUT_MS });
    const finalCount = await calls.count();
    assert.ok(finalCount >= firstSeen && finalCount >= 3, `timeline should hold the run's tool calls (saw ${firstSeen}, then ${finalCount})`);
    const verdict = (await page.locator("#verdict-heading").innerText()).trim();
    assert.ok(verdict.length > 0, "the report verdict is shown");
    console.log(`run page: ${finalCount} tool calls, verdict "${verdict}"`);

    // 3. a private URL is refused, with the API's message, and nothing navigates
    await page.goto(`${web}/investigate/url`);
    await page.getByLabel("Public page URL").fill("http://127.0.0.1/");
    await page.getByRole("button", { name: /Start URL check/ }).click();
    const refusal = page.locator("#url-error");
    await refusal.waitFor();
    assert.match(await refusal.innerText(), /private|loopback|internal|reserved|not allowed|blocked/i);
    assert.match(page.url(), /\/investigate\/url$/);
    console.log(`refusal shown: ${(await refusal.innerText()).replace(/\s+/g, " ").trim()}`);
  } finally {
    await browser.close();
  }
}

main().then(
  () => console.log("UI smoke test passed"),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
