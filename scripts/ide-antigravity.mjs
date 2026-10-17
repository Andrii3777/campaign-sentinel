// Opt-in: adds the campaign-sentinel MCP server to the user's GLOBAL Antigravity file (~/.gemini/config/mcp_config.json).
// The tested Antigravity build did not auto-load the workspace .agents/mcp_config.json. No token is written: the server finds it in the repo .env.
//   pnpm ide:antigravity [--dry-run] [--force]
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAME = "campaign-sentinel";
const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const defaultServerPath = path.join(repo, "apps", "mcp", "dist", "index.js");

// C:/x and C:\x are the same file; Windows paths are case-insensitive
const samePath = (a, b) => (process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/**
 * Pure apart from the file it edits. Returns `{status, file, backup?, dryRun, summary}`;
 * status: added | replaced | already-present | conflict | invalid. Other servers and the file's indent / line endings / final newline are kept.
 * shortcut: formatting is preserved by re-serialising with the detected indent, not by patching text; a hand-aligned file would be reformatted.
 */
export function addToAntigravity({ home = os.homedir(), serverPath = defaultServerPath, dryRun = false, force = false, now = new Date() } = {}) {
  const file = path.join(home, ".gemini", "config", "mcp_config.json");
  const entry = { command: "node", args: [serverPath] };
  const result = (status, extra = {}) => ({ status, file, dryRun, ...extra });

  const existed = existsSync(file);
  const text = existed ? readFileSync(file, "utf8") : "";
  let config = {};
  if (existed) {
    try {
      config = JSON.parse(text);
    } catch {
      return result("invalid", { summary: `${file} is not valid JSON; nothing was changed. Fix or remove it first.` });
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      return result("invalid", { summary: `${file} does not hold a JSON object; nothing was changed.` });
    }
  }
  if (config.mcpServers !== undefined && (config.mcpServers === null || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    return result("invalid", { summary: `${file} has an "mcpServers" that is not an object; nothing was changed.` });
  }
  const servers = config.mcpServers ?? {};
  const current = servers[NAME];
  if (current && current.command === entry.command && Array.isArray(current.args) && current.args.length === 1 && samePath(current.args[0], serverPath)) {
    return result("already-present", { summary: `${NAME} is already present in ${file} with this server path; nothing changed.` });
  }
  if (current && !force) {
    return result("conflict", { summary: `${file} already has a different "${NAME}" entry (command ${JSON.stringify(current.command)}). Left as is; re-run with --force to replace it (a backup is made first).` });
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  let out = JSON.stringify({ ...config, mcpServers: { ...servers, [NAME]: entry } }, null, indent);
  if (eol === "\r\n") out = out.replace(/\n/g, eol);
  if (text.endsWith("\n")) out += eol;

  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  let backup = existed ? `${file}.bak-${NAME}-${stamp}` : undefined;
  // never overwrite an earlier backup: take the first free suffix
  for (let n = 2; backup && existsSync(backup); n++) backup = `${file}.bak-${NAME}-${stamp}-${n}`;
  const verb = current ? "replaced" : "added";
  const summary = [
    `${dryRun ? "Would have " + verb : verb[0].toUpperCase() + verb.slice(1)} "${NAME}" in ${file}:`,
    JSON.stringify(entry, null, 2),
    backup ? `Backup ${dryRun ? "would be" : "written"}: ${backup}` : "The file did not exist; it is created.",
    "Other servers in the file are untouched. Restart Antigravity to load it.",
  ].join("\n");

  if (!dryRun) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (backup) copyFileSync(file, backup, constants.COPYFILE_EXCL);
    writeFileSync(file, out);
  }
  return result(verb, { backup, summary });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(defaultServerPath)) console.error(`warning: ${defaultServerPath} is not built yet: run \`pnpm build\`.`);
  const res = addToAntigravity({ dryRun: args.has("--dry-run"), force: args.has("--force") });
  console.log(res.summary);
  process.exit(res.status === "conflict" || res.status === "invalid" ? 1 : 0);
}
