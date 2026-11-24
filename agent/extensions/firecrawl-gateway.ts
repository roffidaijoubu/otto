import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

let cachedBaseUrl: string | null = null;

async function getFirecrawlGatewayUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  if (process.env.SPRITES_FIRECRAWL_CONNECTOR_ID) {
    cachedBaseUrl = `https://api.sprites.dev/v1/gateway/firecrawl/${process.env.SPRITES_FIRECRAWL_CONNECTOR_ID}`;
    return cachedBaseUrl;
  }
  const res = await fetch("https://api.sprites.dev/v1/gateway/list");
  if (!res.ok) {
    throw new Error(`Failed to query Sprites gateway/list (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{ provider: string; gateway_base_url: string }>;
  };
  const conn = data.connections?.find((c) => c.provider === "firecrawl");
  if (!conn) {
    throw new Error(
      "No authorized Firecrawl Sprites Connector found. Enable Firecrawl in your Fly.io Sprites dashboard and grant access to this Sprite."
    );
  }
  cachedBaseUrl = conn.gateway_base_url;
  return cachedBaseUrl;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "firecrawl_scrape",
    label: "Firecrawl Scrape",
    description: "Scrape a single URL using Firecrawl via Fly.io Sprites Connector Gateway and return clean markdown.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
        formats: {
          type: "array",
          items: { type: "string" },
          description: "Output formats (default: ['markdown'])",
        },
      },
      required: ["url"],
    },
    async execute(_toolCallId, params: { url: string; formats?: string[] }) {
      const baseUrl = await getFirecrawlGatewayUrl();
      const res = await fetch(`${baseUrl}/v1/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: params.url,
          formats: params.formats ?? ["markdown"],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Firecrawl gateway error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: {} };
    },
  });
}
