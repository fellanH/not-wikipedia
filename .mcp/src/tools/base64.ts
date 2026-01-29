import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "base64",
    description: "Encode or decode base64 strings",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["encode", "decode"],
          description: "Whether to encode or decode",
        },
        text: {
          type: "string",
          description: "The text to encode/decode",
        },
      },
      required: ["action", "text"],
    },
  },

  handler: async (args) => {
    const action = args.action as string;
    const text = args.text as string;

    if (action === "encode") {
      return { content: [{ type: "text", text: Buffer.from(text).toString("base64") }] };
    } else {
      return { content: [{ type: "text", text: Buffer.from(text, "base64").toString("utf-8") }] };
    }
  },
};
