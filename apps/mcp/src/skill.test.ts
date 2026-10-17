import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { playbookMarkdown } from "@campaign-sentinel/contracts";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(repo, file), "utf8").replace(/\r\n/g, "\n");
const AGENTS = ".agents/skills/investigate-campaign/SKILL.md";
const CLAUDE = ".claude/skills/investigate-campaign/SKILL.md";

describe("investigate-campaign skill (spec 5.12)", () => {
  it("both copies are identical, carry the playbook and start with name + a >- description", () => {
    const text = read(AGENTS);
    expect(read(CLAUDE)).toBe(text);
    expect(text).toMatch(/^---\nname: investigate-campaign\ndescription: >-\n {2}\S/);
    for (const line of playbookMarkdown.split("\n").filter((l) => l.startsWith("- ") || /^\d\. /.test(l))) expect(text).toContain(line);
  });

  it("`skills-sync --check` fails when a copy drifts from the source", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(repo, "scripts/skills-sync.mjs"), ...args], { encoding: "utf8" });
    expect(run("--check").status).toBe(0);
    const drifted = run("--check", `--root=${path.join(repo, "apps/mcp/src")}`);
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toMatch(/skills:sync/);
  });
});

describe("committed client configuration (spec 5.12)", () => {
  const files = [".mcp.json", ".codex/config.toml", ".cursor/mcp.json", ".cursor/rules/campaign-sentinel.mdc", ".agents/mcp_config.json", ".agents/rules/campaign-sentinel.md"];
  it.each(files)("%s exists and holds no secret", (file) => {
    const text = read(file);
    expect(text).toMatch(/campaign-sentinel/);
    expect(text).not.toMatch(/Bearer|[0-9a-f]{32,}|SENTINEL_AGENT_TOKEN\s*[=:]\s*\S/i);
  });

  it("the three JSON configs and the TOML point at the built server", () => {
    expect(JSON.parse(read(".mcp.json")).mcpServers["campaign-sentinel"]).toEqual({ command: "node", args: ["apps/mcp/dist/index.js"] });
    expect(JSON.parse(read(".cursor/mcp.json")).mcpServers["campaign-sentinel"]).toMatchObject({ type: "stdio", args: ["${workspaceFolder}/apps/mcp/dist/index.js"] });
    expect(JSON.parse(read(".agents/mcp_config.json")).mcpServers["campaign-sentinel"]).toMatchObject({ args: ["apps/mcp/dist/index.js"], cwd: "." });
    expect(read(".codex/config.toml")).toMatch(/\[mcp_servers\.campaign-sentinel\]\ncommand = "node"\nargs = \["apps\/mcp\/dist\/index\.js"\]\nstartup_timeout_sec = 20\ntool_timeout_sec = 60/);
  });
});
