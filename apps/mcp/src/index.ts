import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { httpApiClient } from "./api-client";
import { resolveConfig } from "./env";
import { createSentinelServer } from "./server";

// stdout belongs to the MCP protocol: everything human-readable goes to stderr, and never a token.
async function main(): Promise<void> {
  const config = resolveConfig();
  await createSentinelServer(httpApiClient(config)).connect(new StdioServerTransport());
  console.error(`campaign-sentinel MCP server ready (API ${config.baseUrl})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
