import {
  deleteClipJob,
  deleteStudioJob,
  getStudioJob,
  listStudioJobs,
  updateStudioJob,
  type StudioJobKind,
} from "../../agent/lib/studio-db.ts";
import { cancelArchiveSync, startBackgroundArchiveSync } from "../lib/archive-worker.ts";
import { resumeClipJob } from "../lib/clip-service.ts";
import { cancelBackgroundClipJob } from "../lib/clip-worker.ts";
import { errorMessage } from "../lib/http.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { broadcast } from "../lib/sse.ts";
import { dispatchObsOverlayBackgroundJob } from "./obs-overlays.ts";
import { dispatchThumbnailBackgroundJob } from "./thumbnails.ts";

export async function handleJobsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const kind = url.searchParams.get("kind") as StudioJobKind | null;
    const limit = Number(url.searchParams.get("limit") || 30);
    const jobs = await listStudioJobs({
      kind: kind || undefined,
      limit: Number.isFinite(limit) ? limit : 30,
    });
    return Response.json({ ok: true, jobs });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/resume")) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/jobs/".length, -"/resume".length)
      ).trim();
      const job = await getStudioJob(id);
      if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });

      if (job.kind === "clip") {
        const resumed = await resumeClipJob(job.id, rpc);
        return Response.json({ ok: true, kind: "clip", job: resumed });
      }

      if (job.kind === "thumbnail") {
        const payload = job.payload || {};
        const prompt = String(payload.prompt || "").trim();
        if (!prompt) return Response.json({ ok: false, error: "Original prompt missing" }, { status: 400 });
        const { jobId } = dispatchThumbnailBackgroundJob({
          existingJobId: job.id,
          prompt,
          slug: String(payload.slug || job.targetSlug || ""),
          attachedImages: Array.isArray(payload.attachedImages) ? payload.attachedImages.map(String) : [],
          label: String(payload.label || job.title || "Retrying thumbnail..."),
        });
        return Response.json({ ok: true, kind: "thumbnail", jobId });
      }

      if (job.kind === "obs_overlay") {
        const payload = job.payload || {};
        const prompt = String(payload.prompt || "").trim();
        if (!prompt) return Response.json({ ok: false, error: "Original prompt missing" }, { status: 400 });
        const { jobId } = dispatchObsOverlayBackgroundJob({
          existingJobId: job.id,
          prompt,
          slug: String(payload.slug || job.targetSlug || ""),
          attachedImages: Array.isArray(payload.attachedImages) ? payload.attachedImages.map(String) : [],
          label: String(payload.label || job.title || "Retrying OBS overlay..."),
        });
        return Response.json({ ok: true, kind: "obs_overlay", jobId });
      }

      if (job.kind === "archive_sync") {
        const payload = job.payload || {};
        const res = await startBackgroundArchiveSync({
          channelUrl: typeof payload.channelUrl === "string" ? payload.channelUrl : undefined,
          includeShorts: payload.includeShorts !== false,
          limit: typeof payload.limit === "number" ? payload.limit : undefined,
        });
        return Response.json({ ok: true, kind: "archive_sync", result: res });
      }

      return Response.json({ ok: false, error: `Unsupported job kind: ${job.kind}` }, { status: 400 });
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/jobs/".length, -"/cancel".length)
    ).trim();
    const job = await getStudioJob(id);
    if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });

    if (job.kind === "clip") {
      await cancelBackgroundClipJob(id, broadcast, (busy) => {
        if (!busy) rpc.releaseSpriteHold();
      });
    } else if (job.kind === "archive_sync") {
      cancelArchiveSync();
    } else {
      await updateStudioJob(id, {
        status: "cancelled",
        stage: "Cancelled",
        logMessage: "Cancelled by creator.",
      });
      broadcast({ type: "jobs_changed", jobId: id });
    }
    return Response.json({ ok: true, id });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/jobs/".length)).trim();
    const job = await getStudioJob(id);
    const ok = await deleteStudioJob(id);
    if (job?.kind === "clip") {
      await deleteClipJob(id).catch(() => {});
      broadcast({ type: "clips_changed" });
    }
    if (ok) broadcast({ type: "jobs_changed" });
    return Response.json({ ok });
  }

  return null;
}
