// Creates or completes .env from .env.example. Idempotent: never overwrites a non-empty value.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = `${root}.env.example`;
const envPath = `${root}.env`;

const parse = (text) =>
  new Map(
    text
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );

const example = parse(readFileSync(examplePath, "utf8"));
const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const current = parse(original);
let text = original;
const added = [];

for (const [key, value] of example) {
  const generated = key === "SENTINEL_AGENT_TOKEN" ? randomBytes(32).toString("hex") : value;
  if (!current.has(key)) {
    text += `${text && !text.endsWith("\n") ? "\n" : ""}${key}=${generated}\n`;
    added.push(key);
  } else if (key === "SENTINEL_AGENT_TOKEN" && current.get(key) === "") {
    text = text.replace(/^(\s*SENTINEL_AGENT_TOKEN\s*=)\s*$/m, `$1${generated}`);
    added.push(key);
  }
}

if (text !== original) writeFileSync(envPath, text);
// names only, never values
console.log(added.length ? `.env: set ${added.join(", ")}` : ".env: already complete, nothing changed");
