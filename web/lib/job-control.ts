/**
 * Shared Studio Job Control Service (`web/lib/job-control.ts`).
 *
 * Used by both user-authenticated `/api/jobs/*` routes and internal Otto `/api/internal/jobs/*`
 * routes so Otto and the Web UI share the exact same inspect, nudge, resume, and cancel logic.
 */

import {
  getClipJob,
  getStudioJob,
  listStudioJobs,
  updateStudioJob,
  type StudioJobKind,
  type StudioJob,
  type StudioJobStatus,
} from "../../agent/lib/studio-db.ts";
import { cancelArchiveSync, startBackgroundArchiveSync } from "./archive-worker.ts";
import { resumeClipJob, startClipJob } from "./clip-service.ts";
import { cancelBackgroundClipJob } from "./clip-worker.ts";
import { rpc } from "./rpc-bridge.ts";
import {
  cancelManagedWorker,
  getLiveWorkerSnapshot,
  nudgeManagedWorker,
  type LiveWorkerSnapshot,
} from "./rpc-worker.ts";
import { broadcast } from "./sse.ts";
import { dispatchObsOverlayBackgroundJob } from "../routes/obs-overlays.ts";
import { dispatchThumbnailBackgroundJob } from "../routes/thumbnails.ts";

export interface EnrichedStudioJob extends StudioJob {
  liveWorker: LiveWorkerSnapshot | null;
}

export async function listEnrichedStudioJobs(opts?: {
  kind?: StudioJobKind;
  status?: StudioJobStatus;
  limit?: number;
}): Promise<EnrichedStudioJob[]> {
  const jobs = await listStudioJobs({
    kind: opts?.kind,
    limit: opts?.limit ?? 30,
  });
  const filtered = opts?.status ? jobs.filter((j) => j.status === opts.status) : jobs;
  return filtered.map((job) => ({
    ...job,
    liveWorker: getLiveWorkerSnapshot(job.id),
  }));
}

export async function inspectStudioJobById(id: string): Promise<{
  job: EnrichedStudioJob;
  clipJob: Awaited<ReturnType<typeof getClipJob>> | null;
} | null> {
  const job = await getStudioJob(id);
  if (!job) return null;
  const clipJob = job.kind === "clip" ? await getClipJob(job.id).catch(() => null) : null;
  return {
    job: {
      ...job,
      liveWorker: getLiveWorkerSnapshot(job.id),
    },
    clipJob,
  };
}

export async function nudgeStudioJobById(
  id: string,
  message: string,
  mode: "steer" | "follow_up" = "steer"
): Promise<{
  ok: boolean;
  jobId: string;
  kind: StudioJobKind;
  modeUsed: string;
  snapshot: LiveWorkerSnapshot;
}> {
  const job = await getStudioJob(id);
  if (!job) throw new Error(`Job "${id}" not found.`);
  if (job.kind === "archive_sync") {
    throw new Error("Archive sync runs deterministically via yt-dlp/Pinecone and cannot be nudged via RPC.");
  }
  const res = await nudgeManagedWorker(job.id, message, mode);
  return {
    ok: true,
    jobId: job.id,
    kind: job.kind,
    modeUsed: res.modeUsed,
    snapshot: res.snapshot,
  };
}

export interface DispatchStudioJobInput {
  kind: StudioJobKind;
  // Shared / thumbnail / obs_overlay
  prompt?: string;
  slug?: string;
  attachedImages?: string[];
  label?: string;
  // Clip
  vodUrl?: string;
  videoId?: string;
  title?: string;
  maxClips?: number;
  focusNotes?: string;
  // Archive sync
  channelUrl?: string;
  includeShorts?: boolean;
  limit?: number;
}

export async function dispatchStudioJob(input: DispatchStudioJobInput): Promise<Record<string, unknown>> {
  if (input.kind === "clip") {
    const vodUrl = String(input.vodUrl || "").trim();
    if (!vodUrl) throw new Error("vodUrl is required for kind='clip'.");
    const job = await startClipJob(
      {
        vodUrl,
        videoId: input.videoId ? String(input.videoId) : undefined,
        title: input.title ? String(input.title) : undefined,
        maxClips: typeof input.maxClips === "number" ? input.maxClips : 0,
        focusNotes: input.focusNotes ? String(input.focusNotes) : "",
      },
      rpc
    );
    return { ok: true, kind: "clip", jobId: job.id, job };
  }

  if (input.kind === "thumbnail") {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("prompt is required for kind='thumbnail'.");
    const { jobId } = dispatchThumbnailBackgroundJob({
      prompt,
      attachedImages: Array.isArray(input.attachedImages) ? input.attachedImages.map(String) : [],
      slug: input.slug ? String(input.slug) : undefined,
      label: input.label ? String(input.label) : undefined,
    });
    return { ok: true, kind: "thumbnail", jobId };
  }

  if (input.kind === "obs_overlay") {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("prompt is required for kind='obs_overlay'.");
    const { jobId } = dispatchObsOverlayBackgroundJob({
      prompt,
      attachedImages: Array.isArray(input.attachedImages) ? input.attachedImages.map(String) : [],
      slug: input.slug ? String(input.slug) : undefined,
      label: input.label ? String(input.label) : undefined,
    });
    return { ok: true, kind: "obs_overlay", jobId };
  }

  if (input.kind === "archive_sync") {
    const result = await startBackgroundArchiveSync({
      channelUrl: input.channelUrl ? String(input.channelUrl) : undefined,
      includeShorts: input.includeShorts !== false,
      limit: typeof input.limit === "number" ? input.limit : undefined,
    });
    return { ok: true, kind: "archive_sync", result };
  }

  throw new Error(`Unsupported job kind: ${String(input.kind)}`);
}

export async function resumeStudioJobById(id: string): Promise<Record<string, unknown>> {
  const job = await getStudioJob(id);
  if (!job) throw new Error(`Job "${id}" not found.`);

  if (job.kind === "clip") {
    const resumed = await resumeClipJob(job.id, rpc);
    return { ok: true, kind: "clip", jobId: job.id, job: resumed };
  }

  if (job.kind === "thumbnail") {
    const payload = job.payload || {};
    const prompt = String(payload.prompt || "").trim();
    if (!prompt) throw new Error("Original prompt missing from thumbnail job payload.");
    const { jobId } = dispatchThumbnailBackgroundJob({
      existingJobId: job.id,
      prompt,
      slug: String(payload.slug || job.targetSlug || ""),
      attachedImages: Array.isArray(payload.attachedImages) ? payload.attachedImages.map(String) : [],
      label: String(payload.label || job.title || "Retrying thumbnail..."),
    });
    return { ok: true, kind: "thumbnail", jobId };
  }

  if (job.kind === "obs_overlay") {
    const payload = job.payload || {};
    const prompt = String(payload.prompt || "").trim();
    if (!prompt) throw new Error("Original prompt missing from OBS overlay job payload.");
    const { jobId } = dispatchObsOverlayBackgroundJob({
      existingJobId: job.id,
      prompt,
      slug: String(payload.slug || job.targetSlug || ""),
      attachedImages: Array.isArray(payload.attachedImages) ? payload.attachedImages.map(String) : [],
      label: String(payload.label || job.title || "Retrying OBS overlay..."),
    });
    return { ok: true, kind: "obs_overlay", jobId };
  }

  if (job.kind === "archive_sync") {
    const payload = job.payload || {};
    const res = await startBackgroundArchiveSync({
      channelUrl: typeof payload.channelUrl === "string" ? payload.channelUrl : undefined,
      includeShorts: payload.includeShorts !== false,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
    return { ok: true, kind: "archive_sync", jobId: job.id, result: res };
  }

  throw new Error(`Unsupported job kind: ${job.kind}`);
}

export async function cancelStudioJobById(id: string, actor = "creator"): Promise<{ ok: boolean; id: string; killedLiveWorker: boolean }> {
  const job = await getStudioJob(id);
  if (!job) throw new Error(`Job "${id}" not found.`);

  if (job.kind === "clip") {
    const killedLiveWorker = await cancelManagedWorker(id);
    await cancelBackgroundClipJob(id, broadcast, (busy) => {
      if (!busy) rpc.releaseSpriteHold();
    });
    return { ok: true, id, killedLiveWorker };
  }

  if (job.kind === "archive_sync") {
    cancelArchiveSync();
    await updateStudioJob(id, {
      status: "cancelled",
      stage: "Cancelled",
      logMessage: `Cancelled by ${actor}.`,
    }).catch(() => {});
    broadcast({ type: "jobs_changed", jobId: id });
    return { ok: true, id, killedLiveWorker: false };
  }

  const killedLiveWorker = await cancelManagedWorker(id);
  await updateStudioJob(id, {
    status: "cancelled",
    stage: "Cancelled",
    logMessage: `Cancelled by ${actor}.`,
  });
  broadcast({ type: "jobs_changed", jobId: id });
  return { ok: true, id, killedLiveWorker };
}
