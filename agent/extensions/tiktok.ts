import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CURATED_APIFY_ACTORS, clampApifyLimit, runCuratedApifyActor } from "../lib/apify.ts";
import { createBufferDraftOrPost } from "../lib/buffer.ts";

interface RawTikTokItem {
  id?: string;
  text?: string;
  createTimeISO?: string;
  webVideoUrl?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  authorMeta?: {
    name?: string;
    nickName?: string;
    fans?: number;
    heart?: number;
    video?: number;
  };
  musicMeta?: {
    musicName?: string;
    musicAuthor?: string;
  };
  hashtags?: Array<{ name?: string }>;
}

function cleanHandle(raw: string): string {
  return raw.trim().replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@?/i, "").replace(/^@/, "").split(/[/?#]/)[0] ?? "";
}

function cleanHashtag(raw: string): string {
  return raw.trim().replace(/^#/, "").replace(/\s+/g, "");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "tiktok_read",
    label: "Read TikTok Posts, Hashtags, or Search",
    description:
      "Read public TikTok data for a creator profile, hashtag, or keyword search (views, likes, comments, shares, saves, captions, audio). Use mode='profile' for a handle (e.g. 'roffi_daijoubu'), mode='hashtag' for a tag (e.g. 'vtuberid'), or mode='search' for a topic query. Defaults to 8 items (max 25).",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["profile", "hashtag", "search"],
          description: "What to read on TikTok: 'profile', 'hashtag', or 'search'.",
        },
        query: {
          type: "string",
          description: "TikTok handle (for profile), hashtag name (for hashtag), or search phrase (for search).",
        },
        limit: {
          type: "number",
          description: "Maximum videos to return (default: 8, max: 25).",
        },
      },
      required: ["mode", "query"],
    },
    async execute(
      _toolCallId,
      params: { mode: "profile" | "hashtag" | "search"; query: string; limit?: number }
    ) {
      const limit = clampApifyLimit(params.limit, 8, 25);
      const input: Record<string, unknown> = {
        resultsPerPage: limit,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      };

      if (params.mode === "profile") {
        const handle = cleanHandle(params.query);
        if (!handle) throw new Error("A valid TikTok handle is required for mode='profile'.");
        input.profiles = [handle];
      } else if (params.mode === "hashtag") {
        const tag = cleanHashtag(params.query);
        if (!tag) throw new Error("A valid hashtag is required for mode='hashtag'.");
        input.hashtags = [tag];
      } else {
        const q = params.query.trim();
        if (!q) throw new Error("A search query is required for mode='search'.");
        input.searchQueries = [q];
      }

      const run = await runCuratedApifyActor<RawTikTokItem>(CURATED_APIFY_ACTORS.tiktok, input, {
        limit,
      });

      const videos = run.items.map((item) => ({
        id: item.id ?? "",
        url: item.webVideoUrl ?? "",
        createdAt: item.createTimeISO ?? "",
        author: item.authorMeta?.name ?? "",
        authorName: item.authorMeta?.nickName ?? "",
        authorFollowers: item.authorMeta?.fans ?? null,
        text: (item.text ?? "").slice(0, 320),
        views: item.playCount ?? 0,
        likes: item.diggCount ?? 0,
        comments: item.commentCount ?? 0,
        shares: item.shareCount ?? 0,
        saves: item.collectCount ?? 0,
        sound: item.musicMeta?.musicName
          ? `${item.musicMeta.musicName}${item.musicMeta.musicAuthor ? ` — ${item.musicMeta.musicAuthor}` : ""}`
          : "",
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                platform: "tiktok",
                mode: params.mode,
                query: params.query,
                count: videos.length,
                elapsedSec: run.elapsedSec,
                videos,
              },
              null,
              2
            ),
          },
        ],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "tiktok_post",
    label: "Create TikTok Post (Draft, Schedule, or Publish)",
    description:
      "Create a TikTok post (draft, scheduled, or publish now) on the creator's connected TikTok channel. Defaults to saveToDraft=true for safety. NEVER set saveToDraft=false or mode='shareNow' without explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "TikTok post caption with hook and hashtags.",
        },
        saveToDraft: {
          type: "boolean",
          description: "Save as a draft instead of publishing/queuing (default: true).",
        },
        mode: {
          type: "string",
          enum: ["addToQueue", "shareNext", "shareNow"],
          description: "Queue mode when saveToDraft is false (default: addToQueue).",
        },
        dueAt: {
          type: "string",
          description: "Optional ISO-8601 UTC timestamp for scheduled publishing.",
        },
        channelId: {
          type: "string",
          description: "Optional explicit channel ID override (auto-resolved if omitted).",
        },
      },
      required: ["text"],
    },
    async execute(
      _toolCallId,
      params: {
        text: string;
        saveToDraft?: boolean;
        mode?: "addToQueue" | "shareNext" | "shareNow";
        dueAt?: string;
        channelId?: string;
      }
    ) {
      const out = await createBufferDraftOrPost({
        service: "tiktok",
        text: params.text,
        saveToDraft: params.saveToDraft,
        mode: params.mode,
        dueAt: params.dueAt,
        channelId: params.channelId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        details: {},
      };
    },
  });
}
