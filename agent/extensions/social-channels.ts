import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { listBufferChannels } from "../lib/buffer.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "social_list_channels",
    label: "List Connected Social Channels",
    description:
      "List all connected social media channels (X/Twitter, TikTok, Instagram) and their handles/status.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const channels = await listBufferChannels(true);
      return {
        content: [{ type: "text", text: JSON.stringify(channels, null, 2) }],
        details: {},
      };
    },
  });
}
