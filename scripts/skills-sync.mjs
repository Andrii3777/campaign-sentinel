// Renders the `investigate-campaign` skill from the one playbook source (packages/contracts/src/prompts/playbook.ts)
// into the two committed copies. `--check` writes nothing and exits 1 when a copy differs (used by tests and CI).
// Usage: pnpm skills:sync [--check] [--root=<dir>]   (--root: where the copies live; default: the repository)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(repo, "packages/contracts/dist/index.js");
if (!existsSync(dist)) {
  console.error("Build the contracts first: pnpm --filter @campaign-sentinel/contracts build");
  process.exit(1);
}
const { playbookMarkdown, CONFIDENCE_RUBRIC, SEVERITY_RUBRIC, URL_SCOPE_STATEMENT } = createRequire(import.meta.url)(dist);

export const SKILL_COPIES = [".agents/skills/investigate-campaign/SKILL.md", ".claude/skills/investigate-campaign/SKILL.md"];

export function renderSkill() {
  const playbook = playbookMarkdown.trim().replace(/^# .*\n+/, "");
  return `---
name: investigate-campaign
description: >-
  Investigate why a marketing campaign's conversion rate changed, or whether a landing page is healthy,
  with the campaign-sentinel MCP server and an evidence-based report. Use when the user asks to investigate
  a demo campaign, a conversion-rate drop or tracking break, or the health of a public URL.
---

# Investigate a campaign

You are investigating with Campaign Sentinel. The run is stored in the application's database and shown in its web UI;
you reach it only through the \`campaign-sentinel\` MCP server, never directly.

## When to use

- The user asks why a demo campaign's conversion rate changed (for example "investigate the tracking-break demo campaign").
- The user asks whether a public URL is healthy and set up for paid traffic.

## Prerequisites

- The Sentinel API is running (\`pnpm dev\`, port 4000) and the MCP server is built (\`pnpm build\`).
- The MCP server \`campaign-sentinel\` is connected in your client. If its tools are missing, tell the user which of the two is missing; do not try to read the database or call the API yourself.

## Procedure

1. Demo campaign: call \`list_demo_campaigns\`, pick the campaign the user means, then \`start_investigation\` with \`mode: "demo"\` and its \`campaign_id\`.
   URL: call \`start_investigation\` with \`mode: "url"\` and the \`url\`.
2. Keep the returned \`investigation_id\` and pass it to every later call. If you were given an investigation id by the caller, use it and do not start another run.
3. Investigate adaptively with the analysis tools; give every call a one-sentence \`reason\`.
4. Submit one report with \`submit_report\`. If it is rejected, fix every listed error and resubmit (3 attempts in total).
5. Tell the user the verdict, the severity and the link to the investigation in the web UI (the \`url\` in the accepted answer).

${playbook}

## Scope of a URL investigation

${URL_SCOPE_STATEMENT}

## Rubrics

${CONFIDENCE_RUBRIC}

${SEVERITY_RUBRIC}
`;
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg("root") ?? repo);
const check = process.argv.includes("--check");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = renderSkill();
  const drifted = [];
  for (const rel of SKILL_COPIES) {
    const file = path.join(root, rel);
    const current = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === text) continue;
    if (check) drifted.push(rel);
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
      console.log(`wrote ${rel}`);
    }
  }
  if (drifted.length) {
    console.error(`Out of date: ${drifted.join(", ")}. Run: pnpm skills:sync`);
    process.exit(1);
  }
  if (check) console.log("skills are in sync with the playbook");
}
