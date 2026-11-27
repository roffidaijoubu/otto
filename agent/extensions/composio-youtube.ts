import fs from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { renderThumbnailHeadless } from "../lib/thumbnails.ts";

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
        "No authorized Composio Sprites Connector found. Add a Custom API connector named 'Composio v3' pointing to https://backend.composio.dev with header x-api-key (see docs/setup/composio-youtube.md)."
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
      "Execute a YouTube action via the Composio v3 Sprites Connector (auto-discovers gateway & connected account). Required top-level parameter is `slug` (NOT `action`). Key schema rules: (1) To discover the authenticated user's own channelId without knowing their handle, call `YOUTUBE_LIST_USER_PLAYLISTS` with `arguments: {}`; (2) `YOUTUBE_GET_CHANNEL_ID_BY_HANDLE` requires `channel_handle` WITH a leading `@` (e.g. `@handle`); (3) `YOUTUBE_GET_CHANNEL_STATISTICS` requires `id` (the UC... channelId), NOT `mine: true`. Use youtube_list_tools if unsure about other slugs. NEVER call mutating actions (YOUTUBE_UPDATE_VIDEO, YOUTUBE_UPDATE_THUMBNAIL, YOUTUBE_UPLOAD_VIDEO) without explicit user approval.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Composio YouTube tool slug (e.g. YOUTUBE_LIST_USER_PLAYLISTS, YOUTUBE_GET_CHANNEL_ID_BY_HANDLE, YOUTUBE_GET_CHANNEL_STATISTICS, YOUTUBE_LIST_CHANNEL_VIDEOS, YOUTUBE_VIDEO_DETAILS, YOUTUBE_LOAD_CAPTIONS, YOUTUBE_SEARCH_YOU_TUBE).",
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

  pi.registerTool({
    name: "youtube_schedule_live_broadcast",
    label: "Schedule YouTube Live Broadcast (with Optional Auto-Rendered Thumbnail)",
    description:
      "Create a scheduled YouTube Live Broadcast (waiting room) via Composio v3 Proxy using the creator's connected YouTube account. Defaults safely to privacyStatus='unlisted'. Optionally pass `thumbnailSlug` (a Thumbnail Studio project slug) to autonomously render the 1280x720 JPG via headless Chrome and attach it to the scheduled broadcast. ALWAYS confirm title, scheduledStartTime, and privacyStatus with the creator before calling.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "YouTube Live stream title (max 100 chars)." },
        description: { type: "string", description: "YouTube Live stream description." },
        scheduledStartTime: {
          type: "string",
          description: "ISO-8601 start timestamp with timezone offset (e.g. '2026-12-20T19:30:00+07:00').",
        },
        privacyStatus: {
          type: "string",
          enum: ["unlisted", "private", "public"],
          description: "Broadcast visibility (default 'unlisted' for safe review).",
        },
        thumbnailSlug: {
          type: "string",
          description:
            "Optional Thumbnail Studio slug — Otto will autonomously render it to 1280x720 JPG via headless Chrome and upload it as the broadcast thumbnail.",
        },
      },
      required: ["title", "scheduledStartTime"],
    },
    async execute(
      _toolCallId,
      params: {
        title: string;
        description?: string;
        scheduledStartTime: string;
        privacyStatus?: "unlisted" | "private" | "public";
        thumbnailSlug?: string;
      }
    ) {
      const ctx = await getComposioContext();
      const privacyStatus = params.privacyStatus || "unlisted";

      // 1. Create the scheduled YouTube Live Broadcast via Composio v3 Proxy
      const createRes = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connected_account_id: ctx.connectedAccountId,
          user_id: ctx.userId,
          endpoint: "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
          method: "POST",
          body: {
            snippet: {
              title: params.title.trim().slice(0, 100),
              description: (params.description || "").trim(),
              scheduledStartTime: params.scheduledStartTime.trim(),
            },
            status: {
              privacyStatus,
              selfDeclaredMadeForKids: false,
            },
            contentDetails: {
              enableAutoStart: false,
              enableAutoStop: true,
              enableDvr: true,
              recordFromStart: true,
            },
          },
        }),
      });
      const createData = (await createRes.json().catch(() => ({}))) as {
        data?: { id?: string; snippet?: { title?: string; scheduledStartTime?: string } };
        error?: { message?: string };
      };
      if (!createRes.ok || !createData.data?.id) {
        throw new Error(
          `Failed to schedule YouTube Live Broadcast (HTTP ${createRes.status}): ${JSON.stringify(createData).slice(0, 260)}`
        );
      }

      const broadcastId = createData.data.id;
      let renderedThumbnailPath: string | null = null;
      let thumbnailAttached = false;
      let thumbnailNote: string | null = null;

      // 2. Optionally auto-render Thumbnail Studio project via headless Chrome & attach to broadcast
      if (params.thumbnailSlug?.trim()) {
        try {
          const rendered = renderThumbnailHeadless(params.thumbnailSlug.trim(), "jpg");
          renderedThumbnailPath = rendered.workspacePath;
          const bytes = fs.readFileSync(rendered.filePath);

          const thumbRes = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/YOUTUBE_UPDATE_THUMBNAIL`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              connected_account_id: ctx.connectedAccountId,
              user_id: ctx.userId,
              arguments: {
                video_id: broadcastId,
                thumbnail: {
                  name: `${params.thumbnailSlug.trim()}.jpg`,
                  mimetype: "image/jpeg",
                  s3key: undefined,
                  content: bytes.toString("base64"),
                },
              },
            }),
          });
          if (thumbRes.ok) {
            thumbnailAttached = true;
          } else {
            const errTxt = await thumbRes.text().catch(() => "");
            thumbnailNote = `Thumbnail rendered cleanly to ${rendered.workspacePath}, but YouTube thumbnail upload returned HTTP ${thumbRes.status}: ${errTxt.slice(0, 140)}`;
          }
        } catch (err) {
          thumbnailNote = `Thumbnail step note: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                broadcastId,
                title: createData.data.snippet?.title || params.title,
                scheduledStartTime: createData.data.snippet?.scheduledStartTime || params.scheduledStartTime,
                privacyStatus,
                watchUrl: `https://youtube.com/watch?v=${broadcastId}`,
                studioUrl: `https://studio.youtube.com/video/${broadcastId}/livestreaming`,
                renderedThumbnailPath,
                thumbnailAttached,
                thumbnailNote,
              },
              null,
              2
            ),
          },
        ],
        details: { broadcastId, thumbnailAttached },
      };
    },
  });
}
