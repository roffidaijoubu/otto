import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CURATED_APIFY_ACTORS, clampApifyLimit, runCuratedApifyActor } from "../lib/apify.ts";
import { createBufferDraftOrPost } from "../lib/buffer.ts";

interface RawInstagramItem {
  id?: string;
  type?: string;
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  firstComment?: string;
  latestComments?: Array<{ ownerUsername?: string; text?: string }>;
}

function cleanIgHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0] ?? "";
}

function cleanHashtag(raw: string): string {
  return raw.trim().replace(/^#/, "").replace(/\s+/g, "");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "instagram_read",
    label: "Read Instagram Posts, Profile, or Hashtag",
    description:
      "Read public Instagram data: recent posts/Reels for a handle (mode='posts'), profile stats/bio (mode='profile'), or hashtag posts (mode='hashtag'). Defaults to 8 items (max 25).",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["posts", "profile", "hashtag"],
          description: "What to read on Instagram: 'posts', 'profile', or 'hashtag'.",
        },
        target: {
          type: "string",
          description: "Instagram handle (e.g. 'roffi_daijoubu') or hashtag name (for mode='hashtag').",
        },
        limit: {
          type: "number",
          description: "Maximum posts to return (default: 8, max: 25).",
        },
      },
      required: ["mode", "target"],
    },
    async execute(
      _toolCallId,
      params: { mode: "posts" | "profile" | "hashtag"; target: string; limit?: number }
    ) {
      const limit = clampApifyLimit(params.limit, 8, 25);
      let input: Record<string, unknown>;

      if (params.mode === "hashtag") {
        const tag = cleanHashtag(params.target);
        if (!tag) throw new Error("A valid hashtag is required for mode='hashtag'.");
        input = {
          directUrls: [`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`],
          resultsType: "posts",
          resultsLimit: limit,
        };
      } else {
        const handle = cleanIgHandle(params.target);
        if (!handle) throw new Error("A valid Instagram handle is required.");
        input = {
          directUrls: [`https://www.instagram.com/${encodeURIComponent(handle)}/`],
          resultsType: params.mode === "profile" ? "details" : "posts",
          resultsLimit: params.mode === "profile" ? 1 : limit,
        };
      }

      const run = await runCuratedApifyActor<RawInstagramItem>(
        CURATED_APIFY_ACTORS.instagram,
        input,
        { limit }
      );

      if (params.mode === "profile") {
        const p = run.items[0];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  platform: "instagram",
                  mode: "profile",
                  elapsedSec: run.elapsedSec,
                  profile: p
                    ? {
                        username: p.username ?? "",
                        fullName: p.fullName ?? "",
                        biography: p.biography ?? "",
                        followers: p.followersCount ?? null,
                        following: p.followsCount ?? null,
                        postsCount: p.postsCount ?? null,
                      }
                    : null,
                },
                null,
                2
              ),
            },
          ],
          details: {},
        };
      }

      const posts = run.items.map((item) => ({
        id: item.id ?? "",
        type: item.type ?? "",
        url: item.url ?? (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : ""),
        author: item.ownerUsername ?? "",
        timestamp: item.timestamp ?? "",
        caption: (item.caption ?? "").slice(0, 360),
        hashtags: (item.hashtags ?? []).slice(0, 10),
        likes: item.likesCount ?? null,
        comments: item.commentsCount ?? 0,
        views: item.videoPlayCount ?? item.videoViewCount ?? null,
        topComments: (item.latestComments ?? []).slice(0, 3).map((c) => ({
          author: c.ownerUsername ?? "",
          text: (c.text ?? "").slice(0, 140),
        })),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                platform: "instagram",
                mode: params.mode,
                target: params.target,
                count: posts.length,
                elapsedSec: run.elapsedSec,
                posts,
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
    name: "instagram_draft_post",
    label: "Draft Instagram Post",
    description:
      "Save an Instagram caption as a draft (or scheduled post) on the creator's connected Instagram channel. Defaults to saveToDraft=true for safety. NEVER set saveToDraft=false or mode='shareNow' without explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Instagram caption with takeaway and hashtag block.",
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
        service: "instagram",
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
