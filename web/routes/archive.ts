import {
  getCombinedArchiveOverview,
  indexSingleVideo,
  searchCreatorArchive,
} from "../../agent/lib/pinecone-archive.ts";
import { listArchiveVideos, type ArchiveContentType } from "../../agent/lib/studio-db.ts";
import {
  cancelArchiveSync,
  getArchiveSyncState,
  startBackgroundArchiveSync,
} from "../lib/archive-worker.ts";
import { broadcast } from "../lib/sse.ts";

export async function handleArchiveRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/archive/status") {
    try {
      const [overview, videos] = await Promise.all([
        getCombinedArchiveOverview(),
        listArchiveVideos({ limit: 150 }),
      ]);
      return Response.json({
        ok: true,
        pinecone: overview.pinecone,
        local: overview.local,
        channelUrl: overview.channelUrl,
        sync: getArchiveSyncState(),
        videos,
      });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (req.method === "POST" && url.pathname === "/api/archive/search") {
    try {
      const body = (await req.json()) as {
        query?: string;
        topK?: number;
        contentType?: ArchiveContentType | "all";
        videoId?: string;
        useRerank?: boolean;
      };
      const query = String(body.query ?? "").trim();
      if (!query) {
        return Response.json({ ok: true, matches: [] });
      }
      const matches = await searchCreatorArchive({
        query,
        topK: typeof body.topK === "number" ? body.topK : 10,
        contentType: body.contentType ?? "all",
        videoId: body.videoId,
        useRerank: body.useRerank !== false,
      });
      return Response.json({ ok: true, query, matches });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (req.method === "POST" && url.pathname === "/api/archive/sync") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        channelUrl?: string;
        includeShorts?: boolean;
        limit?: number;
      };
      const result = await startBackgroundArchiveSync({
        channelUrl: body.channelUrl,
        includeShorts: body.includeShorts !== false,
        limit: typeof body.limit === "number" ? body.limit : undefined,
      });
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (req.method === "POST" && url.pathname === "/api/archive/sync/cancel") {
    const cancelled = cancelArchiveSync();
    return Response.json({ ok: true, cancelled, sync: getArchiveSyncState() });
  }

  if (req.method === "POST" && url.pathname === "/api/archive/index-video") {
    try {
      const body = (await req.json()) as { urlOrId?: string };
      const urlOrId = String(body.urlOrId ?? "").trim();
      if (!urlOrId) {
        return Response.json({ ok: false, error: "urlOrId is required" }, { status: 400 });
      }
      const result = await indexSingleVideo(urlOrId);
      broadcast({ type: "archive_changed" });
      return Response.json({ ok: true, result });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  return null;
}
