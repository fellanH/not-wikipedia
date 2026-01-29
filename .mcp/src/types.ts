/**
 * Shared Type Definitions
 *
 * This file defines the structure that all tools must follow.
 * Using a consistent interface makes it easy to add new tools
 * and ensures they work correctly with the server.
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A function that handles tool execution.
 *
 * @param args - Key-value pairs passed by the client (validated against inputSchema)
 * @returns A result with content array and optional isError flag
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/**
 * A complete tool module with its definition and implementation.
 *
 * Every tool you create should export an object matching this interface:
 * - definition: The metadata (name, description, input schema) shown to clients
 * - handler: The async function that runs when the tool is called
 *
 * Example:
 * ```typescript
 * export const tool: ToolModule = {
 *   definition: {
 *     name: "my_tool",
 *     description: "Does something useful",
 *     inputSchema: { type: "object", properties: { ... } }
 *   },
 *   handler: async (args) => {
 *     return { content: [{ type: "text", text: "Result" }] };
 *   }
 * };
 * ```
 */
export interface ToolModule {
  definition: Tool;
  handler: ToolHandler;
}
