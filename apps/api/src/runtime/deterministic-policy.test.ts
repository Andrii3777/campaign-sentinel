import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DeterministicPolicy is generic (spec §5.8, story 16)", () => {
  it("no runtime source reads the scenario catalogue or scenario keys", () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources).toEqual(expect.arrayContaining(["demo-policy.ts", "url-policy.ts", "deterministic-policy.ts"]));
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/scenarioCatalogue|scenarioForCampaign|scenarioKey|tracking-break|landing-page-mobile/);
    }
  });
});
