import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// the reviewer-facing scripts are plain .mjs under scripts/; tested here because this is the package that owns their subject (the MCP server)
const repo = path.resolve(__dirname, "../../..");
const load = (name: string) => import(pathToFileURL(path.join(repo, "scripts", name)).href);

describe("pnpm doctor report", () => {
  it("prints ✓/✗ with one fix hint per failed line, and fails when anything is missing", async () => {
    const { runDoctor, formatReport } = await load("doctor.mjs");
    const checks = [
      { name: "MCP server built", run: async () => ({ ok: true, detail: "apps/mcp/dist/index.js" }) },
      { name: ".env has a token", run: async () => ({ ok: false, detail: "no .env", fix: "pnpm run setup" }) },
      { name: "API answers", run: async () => { throw new Error("connect ECONNREFUSED"); } },
    ];
    const report = await runDoctor(checks);
    expect(report.ok).toBe(false);
    expect(report.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false, false]);
    const text = formatReport(report);
    expect(text).toContain("✓ MCP server built");
    expect(text).toContain("✗ .env has a token");
    expect(text).toMatch(/fix: pnpm run setup/);
    expect(text).toContain("ECONNREFUSED");
    expect(text.match(/fix:/g)).toHaveLength(1);
  });

  it("is ok when every check passes", async () => {
    const { runDoctor, formatReport } = await load("doctor.mjs");
    const report = await runDoctor([{ name: "a", run: async () => ({ ok: true }) }]);
    expect(report.ok).toBe(true);
    expect(formatReport(report)).not.toContain("✗");
  });

  it("an environment check reports presence of the token, never its value", async () => {
    const { envCheck } = await load("doctor.mjs");
    const dir = mkdtempSync(path.join(os.tmpdir(), "doctor-env-"));
    try {
      writeFileSync(path.join(dir, ".env"), "SENTINEL_AGENT_TOKEN=super-secret-value\n");
      const ok = await envCheck(dir).run();
      expect(ok.ok).toBe(true);
      expect(JSON.stringify(ok)).not.toContain("super-secret-value");
      writeFileSync(path.join(dir, ".env"), "SENTINEL_AGENT_TOKEN=\n");
      expect((await envCheck(dir).run()).ok).toBe(false);
      rmSync(path.join(dir, ".env"));
      expect((await envCheck(dir).run()).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pnpm ide:antigravity", () => {
  let home: string;
  const file = () => path.join(home, ".gemini", "config", "mcp_config.json");
  const serverPath = path.join(repo, "apps", "mcp", "dist", "index.js");
  const original = JSON.stringify({ mcpServers: { other: { command: "npx", args: ["-y", "other"], env: { KEY: "keep-me" } } } }, null, 2);

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "antigravity-home-"));
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), original);
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const backups = () => readdirSync(path.dirname(file())).filter((n) => n.startsWith("mcp_config.json.bak"));

  it("adds the server with an absolute path and no token, backs up first, and keeps other servers and the formatting", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    const res = addToAntigravity({ home, serverPath });
    expect(res.status).toBe("added");
    const after = JSON.parse(readFileSync(file(), "utf8"));
    expect(after.mcpServers.other).toEqual({ command: "npx", args: ["-y", "other"], env: { KEY: "keep-me" } });
    expect(after.mcpServers["campaign-sentinel"]).toEqual({ command: "node", args: [serverPath] });
    expect(path.isAbsolute(after.mcpServers["campaign-sentinel"].args[0])).toBe(true);
    expect(readFileSync(file(), "utf8")).toBe(JSON.stringify(after, null, 2)); // same indent, no trailing newline added
    expect(backups()).toHaveLength(1);
    expect(readFileSync(path.join(path.dirname(file()), backups()[0]!), "utf8")).toBe(original);
    expect(res.summary).toContain("campaign-sentinel");
    expect(res.summary).not.toContain("keep-me");
  });

  it("is idempotent: a second run reports already present and writes nothing new", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    addToAntigravity({ home, serverPath });
    const before = readFileSync(file(), "utf8");
    const res = addToAntigravity({ home, serverPath });
    expect(res.status).toBe("already-present");
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(backups()).toHaveLength(1);
  });

  it("refuses a different existing entry unless forced", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    writeFileSync(file(), JSON.stringify({ mcpServers: { "campaign-sentinel": { command: "node", args: ["/elsewhere/index.js"] } } }, null, 2));
    const refused = addToAntigravity({ home, serverPath });
    expect(refused.status).toBe("conflict");
    expect(JSON.parse(readFileSync(file(), "utf8")).mcpServers["campaign-sentinel"].args).toEqual(["/elsewhere/index.js"]);
    expect(addToAntigravity({ home, serverPath, force: true }).status).toBe("replaced");
    expect(JSON.parse(readFileSync(file(), "utf8")).mcpServers["campaign-sentinel"].args).toEqual([serverPath]);
  });

  it("--dry-run changes nothing and creates no backup", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    const res = addToAntigravity({ home, serverPath, dryRun: true });
    expect(res.status).toBe("added");
    expect(res.dryRun).toBe(true);
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(backups()).toHaveLength(0);
  });

  it("creates the file when it does not exist, and refuses a file that is not valid JSON", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    rmSync(file());
    expect(addToAntigravity({ home, serverPath }).status).toBe("added");
    expect(JSON.parse(readFileSync(file(), "utf8")).mcpServers["campaign-sentinel"].command).toBe("node");
    writeFileSync(file(), "{ not json");
    expect(addToAntigravity({ home, serverPath }).status).toBe("invalid");
    expect(readFileSync(file(), "utf8")).toBe("{ not json");
    expect(existsSync(file())).toBe(true);
  });
});

describe("pnpm ide:antigravity formatting and safety", () => {
  const serverPath = path.join(repo, "apps", "mcp", "dist", "index.js");
  const now = new Date("2026-10-17T12:00:00Z");
  let home: string;
  const file = () => path.join(home, ".gemini", "config", "mcp_config.json");
  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "antigravity-fmt-"));
    mkdirSync(path.dirname(file()), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const base = { mcpServers: { other: { command: "x" } } };

  it("keeps CRLF line endings, tab indent and the trailing newline", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    writeFileSync(file(), JSON.stringify(base, null, "\t").replace(/\n/g, "\r\n") + "\r\n");
    addToAntigravity({ home, serverPath });
    const text = readFileSync(file(), "utf8");
    expect(text).toContain('\r\n\t"mcpServers"');
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text.endsWith("}\r\n")).toBe(true);
    expect(text).toContain('\t\t"other"');
  });

  it("does not add a trailing newline that was not there", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    writeFileSync(file(), JSON.stringify(base, null, 4));
    addToAntigravity({ home, serverPath });
    const text = readFileSync(file(), "utf8");
    expect(text.endsWith("}")).toBe(true);
    expect(text).toContain('\n    "mcpServers"');
  });

  it("never overwrites an existing backup", async () => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    writeFileSync(file(), JSON.stringify(base));
    const first = addToAntigravity({ home, serverPath, now });
    const firstBackup = readFileSync(first.backup, "utf8");
    const second = addToAntigravity({ home, serverPath, now, force: true });
    // force with the same entry is "already-present"; change the entry so a second write happens
    writeFileSync(file(), JSON.stringify({ mcpServers: { "campaign-sentinel": { command: "node", args: ["/old.js"] } } }));
    const third = addToAntigravity({ home, serverPath, now, force: true });
    expect(second.status).toBe("already-present");
    expect(third.backup).not.toBe(first.backup);
    expect(readFileSync(first.backup, "utf8")).toBe(firstBackup);
  });

  it.each([[{ mcpServers: [] }], [{ mcpServers: "x" }], [{ mcpServers: null }]])("is invalid and untouched when mcpServers is %j", async (content) => {
    const { addToAntigravity } = await load("ide-antigravity.mjs");
    const text = JSON.stringify(content);
    writeFileSync(file(), text);
    expect(addToAntigravity({ home, serverPath }).status).toBe("invalid");
    expect(readFileSync(file(), "utf8")).toBe(text);
  });
});

describe("pnpm doctor handshake and API lines", () => {
  // a fake built server, so the result does not depend on whether `pnpm build` ran (CI checks a clean clone)
  let built: string;
  beforeEach(() => {
    built = mkdtempSync(path.join(os.tmpdir(), "doctor-built-"));
    mkdirSync(path.join(built, "apps/mcp/dist"), { recursive: true });
    writeFileSync(path.join(built, "apps/mcp/dist/index.js"), "");
  });
  afterEach(() => rmSync(built, { recursive: true, force: true }));

  it("handshakeCheck fails when the server lists 14 tools", async () => {
    const { handshakeCheck } = await load("doctor.mjs");
    const result = await handshakeCheck(built, async () => ({ tools: 14, campaigns: 5 })).run();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("14 tools");
  });

  it("handshakeCheck passes with 15 tools and a campaign", async () => {
    const { handshakeCheck } = await load("doctor.mjs");
    expect((await handshakeCheck(built, async () => ({ tools: 15, campaigns: 5 })).run()).ok).toBe(true);
  });

  it("handshakeCheck reports an unbuilt server instead of running it", async () => {
    const { handshakeCheck } = await load("doctor.mjs");
    const result = await handshakeCheck(path.join(built, "missing"), async () => ({ tools: 15, campaigns: 5 })).run();
    expect(result).toMatchObject({ ok: false, detail: "skipped: server not built" });
  });

  it("the API line shows host:port only, never userinfo", async () => {
    const { hostOf } = await load("doctor.mjs");
    expect(hostOf("http://user:pw-secret@127.0.0.1:4000/x")).toBe("127.0.0.1:4000");
    expect(hostOf("not a url")).not.toContain("not a url");
  });
});
