import { randomUUID } from "crypto";
import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "uuid",
    description: "Generate a random UUID (v4)",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of UUIDs to generate (default: 1, max: 10)",
        },
      },
      required: [],
    },
  },

  handler: async (args) => {
    const count = Math.min(Math.max((args.count as number) || 1, 1), 10);
    const uuids = Array.from({ length: count }, () => randomUUID());
    return { content: [{ type: "text", text: uuids.join("\n") }] };
  },
};
