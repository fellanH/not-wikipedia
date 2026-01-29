/**
 * Hello World Tool
 *
 * This is the simplest possible MCP tool - a great starting point
 * for understanding the tool structure.
 *
 * Every tool needs:
 * 1. A definition (name, description, inputSchema)
 * 2. A handler function that does the work
 */

import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  // The definition tells clients about this tool
  definition: {
    // Tool name - use snake_case, this is how clients call it
    name: "hello_world",

    // Description - be clear about what the tool does
    // This helps the AI decide when to use it
    description: "A simple hello world tool that greets you",

    // Input schema - JSON Schema defining valid inputs
    // The client validates inputs before sending them
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name to greet (optional)",
        },
      },
      required: [], // Empty = all properties are optional
    },
  },

  // The handler runs when the tool is called
  // It receives validated arguments and returns a result
  handler: async (args) => {
    // Get the name argument, defaulting to "World"
    const name = (args.name as string) || "World";

    // Return the result
    // content is an array of content blocks (usually just one text block)
    return {
      content: [{ type: "text", text: `Hello, ${name}!` }],
    };
  },
};
