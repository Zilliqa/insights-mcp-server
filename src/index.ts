import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from './tools/registration.js';
import pkg from '../package.json' with { type: 'json' };

// Create server instance
const getServer = (): McpServer => {
  const server = new McpServer({
    name: 'validator-mcp',
    version: pkg.version,
    title: 'Zilliqa Validator MCP',
    description: 'MCP Server for interacting with the Zilliqa validators metrics and APIs',
  });
  registerTools(server);
  return server;
};

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  const server = getServer();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});