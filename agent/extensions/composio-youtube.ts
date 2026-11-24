import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface ComposioContext {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

let cachedCtx: ComposioContext | null = null;

async function getComposioContext(): Promise<ComposioContext> {
  if (cachedCtx) return cachedCtx;

  let baseUrl: string | undefined;
  if (process.env.SPRITES_COMPOSIO_GATEWAY_URL) {
    baseUrl = process.env.SPRITES_COMPOSIO_GATEWAY_URL.replace(/\/$/, "");
  } else {
    const gwRes = await fetch("https://api.sprites.dev/v1/gateway/list");
    if (!gwRes.ok) {
      throw new Error(`Failed to query Sprites gateway/list (${gwRes.status})`);
    }
    const gwData = (await gwRes.json()) as {
      connections?: Array<{
        provider: string;
        display_name?: string;
        gateway_base_url: string;
      }>;
    };
    const conn = gwData.connections?.find(
      (c) =>
        c.provider === "composio" ||
        (c.provider === "custom_api" && /composio/i.test(c.display_name ?? ""))
    );
    if (!conn) {
      throw new Error(
        "No authorized Composio Sprites Connector found. Add a Custom API connector named 'Composio v3' pointing to https://backend.composio.dev with header x-api-key (see docs/composio-youtube-setup.md)."
      );
    }
    baseUrl = conn.gateway_base_url.replace(/\/$/, "");
  }

  const accRes = await fetch(`${baseUrl}/api/v3/connected_accounts?limit=50`);
  if (!accRes.ok) {
    const err = await accRes.text();
    throw new Error(`Failed to list Composio connected accounts (${accRes.status}): ${err}`);
  }
  const accData = (await accRes.json()) as {
    items?: Array<{
      id: string;
      status: string;
      user_id: string;
      toolkit?: { slug?: string };
    }>;
  };
  const yt = accData.items?.find(
    (a) => a.toolkit?.slug?.toLowerCase() === "youtube" && a.status === "ACTIVE"
  );
  if (!yt) {
    throw new Error(
      "No ACTIVE YouTube connected account found in Composio project. Connect YouTube under Auth Configs in dashboard.composio.dev."
    );
  }

  cachedCtx = {
    baseUrl,
    connectedAccountId: yt.id,
    userId: yt.user_id,
  };
  return cachedCtx;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "youtube_list_tools",
    label: "YouTube List Tools",
    description:
      "Discover available YouTube tool slugs and their input schemas via the Composio v3 Sprites Connector (zero local API keys).",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Optional exact tool slug (e.g. YOUTUBE_LIST_CHANNEL_VIDEOS) to inspect its full parameter schema.",
        },
      },
    },
    async execute(_toolCallId, params: { slug?: string }) {
      const ctx = await getComposioContext();
      const res = await fetch(`${ctx.baseUrl}/api/v3/tools?toolkit_slug=youtube&limit=50`);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Composio tools list error (${res.status}): ${err}`);
      }
      const data = (await res.json()) as {
        items?: Array<{ slug: string; name?: string; description?: string; input_parameters?: unknown }>;
      };
      const items = data.items ?? [];
      if (params.slug) {
        const match = items.find((t) => t.slug === params.slug);
        if (!match) {
          throw new Error(`Tool slug '${params.slug}' not found in YouTube toolkit.`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(match, null, 2) }],
          details: {},
        };
      }
      const summary = items.map((t) => ({ slug: t.slug, description: t.description }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "youtube_tool",
    label: "YouTube Tool (Composio)",
    description:
      "Execute a YouTube action via the Composio v3 Sprites Connector (auto-discovers gateway & connected account). Use youtube_list_tools first if unsure about argument names. NEVER call mutating actions (YOUTUBE_UPDATE_VIDEO, YOUTUBE_UPDATE_THUMBNAIL, YOUTUBE_UPLOAD_VIDEO) without explicit user approval.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Composio YouTube tool slug (e.g. YOUTUBE_GET_CHANNEL_ID_BY_HANDLE, YOUTUBE_GET_CHANNEL_STATISTICS, YOUTUBE_LIST_CHANNEL_VIDEOS, YOUTUBE_VIDEO_DETAILS, YOUTUBE_LOAD_CAPTIONS, YOUTUBE_SEARCH_YOU_TUBE).",
        },
        arguments: {
          type: "object",
          description: "Tool arguments object matching the slug's input_parameters schema.",
        },
      },
      required: ["slug"],
    },
    async execute(_toolCallId, params: { slug: string; arguments?: Record<string, unknown> }) {
      const ctx = await getComposioContext();
      const res = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/${encodeURIComponent(params.slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connected_account_id: ctx.connectedAccountId,
          user_id: ctx.userId,
          arguments: params.arguments ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Composio execute ${params.slug} error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });
}
