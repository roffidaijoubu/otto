import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CURATED_APIFY_ACTORS, clampApifyLimit, runCuratedApifyActor } from "../lib/apify.ts";
import { createBufferDraftOrPost, listBufferChannels } from "../lib/buffer.ts";

interface RawTweetItem {
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  lang?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  isReply?: boolean;
  author?: {
    userName?: string;
    name?: string;
    followers?: number;
  };
}

function cleanXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0] ?? "";
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "x_read",
    label: "Read X (Twitter) Posts or Search",
    description:
      "Read recent public posts from an X (Twitter) handle (mode='profile') or search recent X posts by keyword/hashtag (mode='search'). Returns text, views, likes, retweets, replies, and bookmarks. Defaults to 10 tweets (max 25).",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["profile", "search"],
          description: "Whether to fetch a user's recent posts ('profile') or run a keyword/hashtag search ('search').",
        },
        query: {
          type: "string",
          description: "X handle (e.g. 'Roffi_Daijoubu') for mode='profile', or search query/hashtag for mode='search'.",
        },
        limit: {
          type: "number",
          description: "Maximum tweets to return (default: 10, max: 25).",
        },
      },
      required: ["mode", "query"],
    },
    async execute(
      _toolCallId,
      params: { mode: "profile" | "search"; query: string; limit?: number }
    ) {
      const limit = clampApifyLimit(params.limit, 10, 25);
      let searchTerm: string;
      if (params.mode === "profile") {
        const handle = cleanXHandle(params.query);
        if (!handle) throw new Error("A valid X handle is required for mode='profile'.");
        searchTerm = `from:${handle}`;
      } else {
        searchTerm = params.query.trim();
        if (!searchTerm) throw new Error("A search query is required for mode='search'.");
      }

      const run = await runCuratedApifyActor<RawTweetItem>(
        CURATED_APIFY_ACTORS.x,
        {
          searchTerms: [searchTerm],
          maxItems: limit,
        },
        { limit }
      );

      const tweets = run.items.map((item) => ({
        id: item.id ?? "",
        url: item.url ?? item.twitterUrl ?? "",
        createdAt: item.createdAt ?? "",
        author: item.author?.userName ?? "",
        text: (item.fullText ?? item.text ?? "").slice(0, 360),
        views: item.viewCount ?? null,
        likes: item.likeCount ?? 0,
        retweets: item.retweetCount ?? 0,
        replies: item.replyCount ?? 0,
        quotes: item.quoteCount ?? 0,
        bookmarks: item.bookmarkCount ?? 0,
        isReply: Boolean(item.isReply),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                platform: "x",
                mode: params.mode,
                query: params.query,
                count: tweets.length,
                elapsedSec: run.elapsedSec,
                tweets,
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
    name: "x_draft_post",
    label: "Draft X (Twitter) Post",
    description:
      "Save an X (Twitter) post as a draft (or scheduled post) on the creator's connected X channel. Defaults to saveToDraft=true for safety. NEVER set saveToDraft=false or mode='shareNow' without explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Tweet / X post copy (keep <= 280 characters unless thread).",
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
        service: "twitter",
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
