#!/usr/bin/env node
/**
 * MCP Server Entry Point
 *
 * This file sets up the Model Context Protocol server and connects it
 * to your tools. The MCP SDK handles all the protocol details - you just
 * need to:
 *   1. Create a server with a name and capabilities
 *   2. Register handlers for listing and calling tools
 *   3. Connect via a transport (stdio for CLI usage)
 *
 * Learn more: https://modelcontextprotocol.io/
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { definitions, handlers } from "./tools/index.js";
import { getDatabase } from "./db/database.js";
import { needsMigration, runMigration } from "./db/migrations.js";
import { exportAllJson } from "./db/export.js";

// Create the MCP server instance
// - name: Identifies your server to clients
// - capabilities: Declares what features you support (tools, resources, prompts)
const server = new Server(
  {
    name: "klar-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // We expose tools - add 'resources: {}' or 'prompts: {}' if needed
    },
  }
);

// Handler: List all available tools
// Called when the client asks "what tools do you have?"
// Returns an array of tool definitions with names, descriptions, and input schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: definitions };
});

// Handler: Execute a tool
// Called when the client says "run tool X with arguments Y"
// Looks up the handler by name and invokes it with the provided arguments
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Find the handler for this tool
  const handler = handlers.get(name);
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  // Execute the handler and catch any errors
  try {
    return await handler(args ?? {});
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

// Initialize database
// This runs before the server starts to ensure the database is ready
function initializeDatabase() {
  try {
    // Initialize database connection (creates tables if needed)
    getDatabase();

    // Run migration if database is empty
    if (needsMigration()) {
      console.error("Running database migration from JSON files...");
      const stats = runMigration();
      console.error(`Migration complete: ${stats.articles} articles, ${stats.researchers} researchers, ${stats.links} links, ${stats.institutions} institutions`);

      // Export JSON files to keep dashboard working
      exportAllJson();
      console.error("JSON files exported for dashboard compatibility");
    }
  } catch (error) {
    console.error("Database initialization error:", error);
    // Continue anyway - tools will fail gracefully
  }
}

// Start the server
// StdioServerTransport communicates via stdin/stdout - the client spawns
// this process and sends/receives JSON-RPC messages through the pipes
async function main() {
  // Initialize database before starting server
  initializeDatabase();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Klar MCP server running on stdio");
}

main().catch(console.error);
