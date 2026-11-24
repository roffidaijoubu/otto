import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

let cachedBaseUrl: string | null = null;

async function getExaGatewayUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  if (process.env.SPRITES_EXA_CONNECTOR_ID) {
    cachedBaseUrl = `https://api.sprites.dev/v1/gateway/exa/${process.env.SPRITES_EXA_CONNECTOR_ID}`;
    return cachedBaseUrl;
  }
  const res = await fetch("https://api.sprites.dev/v1/gateway/list");
  if (!res.ok) {
    throw new Error(`Failed to query Sprites gateway/list (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{ provider: string; gateway_base_url: string }>;
  };
  const conn = data.connections?.find((c) => c.provider === "exa");
  if (!conn) {
    throw new Error(
      "No authorized Exa Sprites Connector found. Enable Exa in your Fly.io Sprites dashboard and grant access to this Sprite."
    );
  }
  cachedBaseUrl = conn.gateway_base_url;
  return cachedBaseUrl;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "exa_search",
    label: "Exa Search",
    description: "Search the web using Exa via Fly.io Sprites Connector Gateway (no local API key required).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results (default 5)" },
        type: { type: "string", enum: ["auto", "neural", "keyword"], description: "Search type" },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params: { query: string; numResults?: number; type?: string }) {
      const baseUrl = await getExaGatewayUrl();
      const res = await fetch(`${baseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: params.query,
          numResults: params.numResults ?? 5,
          type: params.type ?? "auto",
          contents: { text: { maxCharacters: 1500 } },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Exa gateway error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: {} };
    },
  });

  pi.registerTool({
    name: "exa_get_contents",
    label: "Exa Get Contents",
    description: "Fetch clean page contents for URLs using Exa via Fly.io Sprites Connector Gateway.",
    parameters: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to fetch" },
      },
      required: ["urls"],
    },
    async execute(_toolCallId, params: { urls: string[] }) {
      const baseUrl = await getExaGatewayUrl();
      const res = await fetch(`${baseUrl}/contents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: params.urls, text: true }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Exa gateway error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: {} };
    },
  });
}
