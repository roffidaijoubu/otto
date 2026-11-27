import fs from "node:fs";
import path from "node:path";
import { listClipJobs, listClipRecords } from "../../agent/lib/studio-db.ts";
import {
  getActiveClipWorkerIds,
  resumeBackgroundClipJob,
  startBackgroundClipJob,
} from "./clip-worker.ts";
import { LMA_INTERNAL_SECRET, OMP_BIN, PORT, WORK_DIR } from "./config.ts";
import { broadcast } from "./sse.ts";
import { ensureWorkspaceScaffold, WORKSPACE_CLIPS_DIR } from "./workspace.ts";

export interface ClipFileEntry {
  videoId: string;
  name: string;
  filename: string;
  relPath: string;
  mp4Url: string;
  srtUrl: string | null;
  sizeBytes: number;
  updatedAt: string;
}

export interface SpriteHoldController {
  holdSpriteActive: () => Promise<void> | void;
  releaseSpriteHold: () => void;
}

export function startClipJob(
  input: {
    vodUrl: string;
    videoId?: string;
    title?: string;
    maxClips?: number;
    focusNotes?: string;
  },
  rpc: SpriteHoldController
) {
  return startBackgroundClipJob(input, {
    ompBin: OMP_BIN,
    workDir: WORK_DIR,
    port: PORT,
    internalSecret: LMA_INTERNAL_SECRET,
    onBroadcast: broadcast,
    onBusyChange: (busy) => {
      if (busy) {
        void rpc.holdSpriteActive();
      } else {
        rpc.releaseSpriteHold();
      }
    },
  });
}

export function resumeClipJob(jobId: string, rpc: SpriteHoldController) {
  return resumeBackgroundClipJob(jobId, {
    ompBin: OMP_BIN,
    workDir: WORK_DIR,
    port: PORT,
    internalSecret: LMA_INTERNAL_SECRET,
    onBroadcast: broadcast,
    onBusyChange: (busy) => {
      if (busy) {
        void rpc.holdSpriteActive();
      } else {
        rpc.releaseSpriteHold();
      }
    },
  });
}

export function matchSrt(vidDir: string, base: string): string | null {
  const exactSrt = `${base}.srt`;
  const strippedSrt = `${base.replace(/_prepped$/, "")}.srt`;
  if (fs.existsSync(path.join(vidDir, exactSrt))) return exactSrt;
  if (fs.existsSync(path.join(vidDir, strippedSrt))) return strippedSrt;
  return null;
}

export function scanClipsDir(opts?: { trackedPaths?: Set<string> }): ClipFileEntry[] {
  const clips: ClipFileEntry[] = [];
  if (!fs.existsSync(WORKSPACE_CLIPS_DIR)) return clips;

  for (const vidEntry of fs.readdirSync(WORKSPACE_CLIPS_DIR, { withFileTypes: true })) {
    if (!vidEntry.isDirectory() || !/^[A-Za-z0-9_-]{6,32}$/.test(vidEntry.name)) continue;
    const vidDir = path.join(WORKSPACE_CLIPS_DIR, vidEntry.name);
    for (const f of fs.readdirSync(vidDir)) {
      if (!f.endsWith(".mp4")) continue;
      const relPath = `clips/${vidEntry.name}/${f}`;
      if (opts?.trackedPaths?.has(relPath)) continue;
      const full = path.join(vidDir, f);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const base = f.slice(0, -4);
      const matchedSrt = matchSrt(vidDir, base);
      clips.push({
        videoId: vidEntry.name,
        name: base,
        filename: f,
        relPath,
        mp4Url: `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(f)}`,
        srtUrl: matchedSrt
          ? `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(matchedSrt)}`
          : null,
        sizeBytes: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    }
  }
  clips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return clips;
}

export async function listClipEcosystem() {
  ensureWorkspaceScaffold();
  const [jobs, records] = await Promise.all([
    listClipJobs(30),
    listClipRecords({ limit: 80 }),
  ]);
  const trackedPaths = new Set(records.map((r) => r.filePath));
  const untrackedFiles = scanClipsDir({ trackedPaths });
  return {
    jobs,
    records,
    untrackedFiles,
    activeWorkerIds: getActiveClipWorkerIds(),
  };
}

export function listLegacyClips() {
  ensureWorkspaceScaffold();
  return { clips: scanClipsDir() };
}
