/**
 * Isolated Background Creator Archive Sync Worker (`web/lib/archive-worker.ts`).
 *
 * Discovers channel videos via keyless yt-dlp, deduplicates against Pinecone
 * (`<videoId>#0` sentinel check) so Sprite resets never duplicate work, holds
 * the Sprite awake via Tasks API while indexing, and broadcasts `archive_changed`.
 */

import {
  discoverChannelVideos,
  ensureArchiveIndex,
  fetchExistingVideoIdsFromPinecone,
  indexSingleVideo,
  resolveCreatorChannelUrl,
} from "../../agent/lib/pinecone-archive.ts";
import { createStudioJob, updateStudioJob, upsertArchiveVideo } from "../../agent/lib/studio-db.ts";
import { broadcast } from "./sse.ts";

export interface ArchiveSyncState {
  running: boolean;
  stage: string;
  channelUrl: string;
  discovered: number;
  alreadyIndexed: number;
  processed: number;
  totalToIndex: number;
  indexedThisRun: number;
  noCaptionsThisRun: number;
  failedThisRun: number;
  currentTitle: string;
  error: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const syncState: ArchiveSyncState = {
  running: false,
  stage: "Idle",
  channelUrl: "",
  discovered: 0,
  alreadyIndexed: 0,
  processed: 0,
  totalToIndex: 0,
  indexedThisRun: 0,
  noCaptionsThisRun: 0,
  failedThisRun: 0,
  currentTitle: "",
  error: "",
  startedAt: null,
  finishedAt: null,
};

let cancelRequested = false;

async function holdSpriteAwake(enable: boolean): Promise<void> {
  try {
    await fetch("http://sprite/v1/tasks/lma-archive-sync", {
      unix: "/.sprite/api.sock",
      method: enable ? "PUT" : "DELETE",
      headers: enable ? { "Content-Type": "application/json" } : undefined,
      body: enable ? JSON.stringify({ expire: "30m" }) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Running outside Sprite or socket unavailable — safe to ignore
  }
}

export function getArchiveSyncState(): ArchiveSyncState {
  return { ...syncState };
}

export function cancelArchiveSync(): boolean {
  if (!syncState.running) return false;
  cancelRequested = true;
  syncState.stage = "Cancelling...";
  broadcast({ type: "archive_changed", sync: getArchiveSyncState() });
  return true;
}

export async function startBackgroundArchiveSync(opts: {
  channelUrl?: string;
  includeShorts?: boolean;
  limit?: number;
} = {}): Promise<{ ok: boolean; message: string; state: ArchiveSyncState }> {
  if (syncState.running) {
    return {
      ok: true,
      message: "Archive sync is already running in the background.",
      state: getArchiveSyncState(),
    };
  }

  const channelUrl = opts.channelUrl?.trim() || (await resolveCreatorChannelUrl()) || "";
  if (!channelUrl) {
    throw new Error("Could not detect YouTube channel URL. Connect YouTube or pass channelUrl.");
  }

  cancelRequested = false;
  syncState.running = true;
  syncState.stage = "Checking Pinecone index...";
  syncState.channelUrl = channelUrl;
  syncState.discovered = 0;
  syncState.alreadyIndexed = 0;
  syncState.processed = 0;
  syncState.totalToIndex = 0;
  syncState.indexedThisRun = 0;
  syncState.noCaptionsThisRun = 0;
  syncState.failedThisRun = 0;
  syncState.currentTitle = "";
  syncState.error = "";
  syncState.startedAt = new Date().toISOString();
  syncState.finishedAt = null;

  const jobId = `arch_${Date.now().toString(36)}`;
  void createStudioJob({
    id: jobId,
    kind: "archive_sync",
    targetSlug: channelUrl,
    title: "Creator Archive Sync",
    stage: "Discovering channel videos...",
    status: "running",
    payload: { channelUrl, includeShorts: opts.includeShorts !== false, limit: opts.limit },
    logMessage: `Syncing ${channelUrl} to Pinecone`,
  })
    .then(() => broadcast({ type: "jobs_changed", jobId }))
    .catch(() => {});

  broadcast({ type: "archive_changed", sync: getArchiveSyncState() });

  void (async () => {
    await holdSpriteAwake(true);
    try {
      await ensureArchiveIndex();

      syncState.stage = "Discovering channel videos...";
      broadcast({ type: "archive_changed", sync: getArchiveSyncState() });

      const discovered = await discoverChannelVideos(channelUrl, opts.includeShorts !== false);
      syncState.discovered = discovered.length;

      syncState.stage = "Checking existing videos in Pinecone...";
      broadcast({ type: "archive_changed", sync: getArchiveSyncState() });

      const existingIds = await fetchExistingVideoIdsFromPinecone(
        discovered.map((v) => v.videoId)
      );
      syncState.alreadyIndexed = existingIds.size;

      // Hydrate local SQLite cache for videos already living in Pinecone
      for (const v of discovered) {
        if (existingIds.has(v.videoId)) {
          await upsertArchiveVideo({
            videoId: v.videoId,
            title: v.title,
            publishedAt: v.publishedAt,
            durationSec: v.durationSec,
            contentType: v.contentType,
            status: "indexed",
          });
        }
      }

      let todo = discovered.filter((v) => !existingIds.has(v.videoId));
      if (opts.limit && opts.limit > 0) {
        todo = todo.slice(0, opts.limit);
      }
      syncState.totalToIndex = todo.length;

      if (todo.length === 0) {
        syncState.stage = "Up to date";
        return;
      }

      for (const video of todo) {
        if (cancelRequested) {
          syncState.stage = "Cancelled";
          break;
        }
        syncState.currentTitle = video.title || video.videoId;
        syncState.stage = `Indexing ${syncState.processed + 1}/${todo.length}`;
        broadcast({ type: "archive_changed", sync: getArchiveSyncState() });

        try {
          const res = await indexSingleVideo(video);
          if (res.status === "indexed") {
            syncState.indexedThisRun += 1;
          } else {
            syncState.noCaptionsThisRun += 1;
          }
        } catch {
          syncState.failedThisRun += 1;
        }

        syncState.processed += 1;
        broadcast({ type: "archive_changed", sync: getArchiveSyncState() });
        await new Promise((r) => setTimeout(r, 800));
      }

      if (!cancelRequested) {
        syncState.stage = "Completed";
      }
    } catch (err) {
      syncState.error = err instanceof Error ? err.message : String(err);
      syncState.stage = "Failed";
    } finally {
      syncState.running = false;
      syncState.currentTitle = "";
      syncState.finishedAt = new Date().toISOString();
      await updateStudioJob(jobId, {
        status: syncState.error ? "failed" : cancelRequested ? "cancelled" : "done",
        stage: syncState.stage,
        error: syncState.error,
        checkpoint: {
          discovered: syncState.discovered,
          alreadyIndexed: syncState.alreadyIndexed,
          indexedThisRun: syncState.indexedThisRun,
        },
        logMessage: `${syncState.stage} (${syncState.indexedThisRun} newly indexed, ${syncState.alreadyIndexed} already in Pinecone).`,
      }).catch(() => {});
      await holdSpriteAwake(false);
      broadcast({ type: "archive_changed", sync: getArchiveSyncState() });
      broadcast({ type: "jobs_changed", jobId });
    }
  })();

  return {
    ok: true,
    message: `Started background archive sync for ${channelUrl}. Already-indexed videos in Pinecone will be skipped automatically.`,
    state: getArchiveSyncState(),
  };
}
