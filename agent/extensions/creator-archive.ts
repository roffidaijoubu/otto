import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  getCombinedArchiveOverview,
  indexSingleVideo,
  resolveCreatorChannelUrl,
  searchCreatorArchive,
} from "../lib/pinecone-archive.ts";
import { listArchiveVideos } from "../lib/studio-db.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "archive_search",
    label: "Search Creator Video Archive",
    description:
      "Semantically search across ALL indexed YouTube videos, livestreams, and shorts in the creator's permanent video memory (multilingual Indonesian + English with reranking). Returns exact timestamps, video titles, excerpts, and clickable youtu.be/<id>?t=<sec> links. Use this whenever the creator asks if they covered a topic before, wants to find a specific moment across past VODs for clipping/compilation, or wants authentic quotes/callbacks from past streams.",
    parameters: Type.Object({
      query: Type.String({
        description: "Natural-language search query in Indonesian or English (topic, quote, story, question, or moment)",
      }),
      topK: Type.Optional(
        Type.Number({ description: "Number of top timestamped matches to return (default: 6, max: 15)" })
      ),
      contentType: Type.Optional(
        Type.Union([
          Type.Literal("all"),
          Type.Literal("live"),
          Type.Literal("video"),
          Type.Literal("short"),
        ], { description: "Optional filter by content type (default: all)" })
      ),
      videoId: Type.Optional(
        Type.String({ description: "Optional 11-char YouTube video ID or URL to search within a single video" })
      ),
    }),
    async execute(_id, params) {
      const matches = await searchCreatorArchive({
        query: params.query,
        topK: Math.min(15, Math.max(1, params.topK ?? 6)),
        contentType: params.contentType ?? "all",
        videoId: params.videoId,
        useRerank: true,
      });

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matching moments found in the creator video archive for "${params.query}".`,
            },
          ],
          details: { count: 0, matches: [] },
        };
      }

      const formatted = matches
        .map(
          (m, idx) =>
            `${idx + 1}. **${m.title}** (${m.contentType}${m.publishedAt ? `, ${m.publishedAt}` : ""})\n` +
            `   Timestamp: ${m.startStr} – ${m.endStr} (${m.startSec}s) · Match: ${Math.round(m.score * 100)}%\n` +
            `   Link: ${m.youtubeUrl}\n` +
            `   Excerpt: "${m.text.slice(0, 360)}${m.text.length > 360 ? "..." : ""}"`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} matching moment(s) in Creator Archive:\n\n${formatted}`,
          },
        ],
        details: { count: matches.length, matches },
      };
    },
  });

  pi.registerTool({
    name: "archive_status",
    label: "Creator Archive Status",
    description:
      "Check how many videos and searchable timestamped moments are currently indexed in the Creator Archive.",
    parameters: Type.Object({}),
    async execute() {
      const overview = await getCombinedArchiveOverview();
      const recent = listArchiveVideos({ limit: 8 });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connected: overview.pinecone.connected,
                ready: overview.pinecone.ready,
                searchableMoments: overview.pinecone.namespaceVectorCount,
                localTracked: overview.local,
                channelUrl: overview.channelUrl,
                recentVideos: recent.map((v) => ({
                  videoId: v.videoId,
                  title: v.title,
                  contentType: v.contentType,
                  status: v.status,
                  chunks: v.chunkCount,
                })),
              },
              null,
              2
            ),
          },
        ],
        details: overview,
      };
    },
  });

  pi.registerTool({
    name: "archive_index_video",
    label: "Index Single YouTube Video into Archive",
    description:
      "Fetch captions and index a single YouTube video or livestream VOD into the permanent Creator Archive so it becomes immediately searchable with timestamps.",
    parameters: Type.Object({
      urlOrId: Type.String({ description: "YouTube video/VOD URL or 11-character video ID" }),
    }),
    async execute(_id, params) {
      const result = await indexSingleVideo(params.urlOrId);
      return {
        content: [
          {
            type: "text",
            text:
              result.status === "indexed"
                ? `Indexed "${result.title || result.videoId}" (${result.chunkCount} searchable moments, lang: ${result.lang}).`
                : `Skipped "${result.title || result.videoId}" — no YouTube captions/auto-captions available.`,
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "archive_sync_channel",
    label: "Sync Channel Videos to Archive",
    description:
      "Trigger the isolated background worker to discover and index any new YouTube videos, livestreams, and shorts into the Creator Archive without blocking chat. Already-indexed videos are skipped automatically.",
    parameters: Type.Object({
      channelUrl: Type.Optional(
        Type.String({ description: "Optional YouTube channel URL (auto-detected from creator profile if omitted)" })
      ),
      includeShorts: Type.Optional(
        Type.Boolean({ description: "Include Shorts tab in sync (default: true)" })
      ),
    }),
    async execute(_id, params) {
      const port = process.env.LMA_WEB_PORT || "8080";
      const secret = process.env.LMA_INTERNAL_SECRET || "";
      const channelUrl = params.channelUrl?.trim() || resolveCreatorChannelUrl() || undefined;

      const res = await fetch(`http://127.0.0.1:${port}/api/internal/archive/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LMA-Internal-Secret": secret,
        },
        body: JSON.stringify({
          channelUrl,
          includeShorts: params.includeShorts !== false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Failed to start archive sync (${res.status})`);
      }
      return {
        content: [
          {
            type: "text",
            text: data.message || "Background archive sync started — already-indexed videos will be skipped automatically.",
          },
        ],
        details: data,
      };
    },
  });
}
