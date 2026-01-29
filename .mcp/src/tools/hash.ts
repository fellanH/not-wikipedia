import { createHash } from "crypto";
import { ToolModule } from "../types.js";

export const tool: ToolModule = {
  definition: {
    name: "hash",
    description: "Generate a hash of the input text",
    inputSchema: {
      type: "object",
      properties: {
        algorithm: {
          type: "string",
          enum: ["md5", "sha1", "sha256", "sha512"],
          description: "Hash algorithm to use",
        },
        text: {
          type: "string",
          description: "The text to hash",
        },
      },
      required: ["algorithm", "text"],
    },
  },

  handler: async (args) => {
    const algorithm = args.algorithm as string;
    const text = args.text as string;
    const hash = createHash(algorithm).update(text).digest("hex");
    return { content: [{ type: "text", text: hash }] };
  },
};
