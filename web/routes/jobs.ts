import {
  deleteClipJob,
  deleteStudioJob,
  getStudioJob,
  type StudioJobKind,
  type StudioJobStatus,
} from "../../agent/lib/studio-db.ts";
import { errorMessage } from "../lib/http.ts";
import {
  cancelStudioJobById,
  inspectStudioJobById,
  listEnrichedStudioJobs,
  nudgeStudioJobById,
  resumeStudioJobById,
} from "../lib/job-control.ts";
import { broadcast } from "../lib/sse.ts";

export async function handleJobsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const kind = url.searchParams.get("kind") as StudioJobKind | null;
    const status = url.searchParams.get("status") as StudioJobStatus | null;
    const limit = Number(url.searchParams.get("limit") || 30);
    const jobs = await listEnrichedStudioJobs({
      kind: kind || undefined,
      status: status || undefined,
      limit: Number.isFinite(limit) ? limit : 30,
    });
    return Response.json({ ok: true, jobs });
  }

  if (
    req.method === "GET" &&
    url.pathname.startsWith("/api/jobs/") &&
    !url.pathname.slice("/api/jobs/".length).includes("/")
  ) {
    const id = decodeURIComponent(url.pathname.slice("/api/jobs/".length)).trim();
    const detail = await inspectStudioJobById(id);
    if (!detail) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
    return Response.json({ ok: true, ...detail });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/nudge")) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/jobs/".length, -"/nudge".length)
      ).trim();
      const body = (await req.json().catch(() => ({}))) as {
        message?: string;
        mode?: "steer" | "follow_up";
      };
      const message = String(body.message || "").trim();
      if (!message) return Response.json({ ok: false, error: "message is required" }, { status: 400 });
      const mode = body.mode === "follow_up" ? "follow_up" : "steer";
      const result = await nudgeStudioJobById(id, message, mode);
      return Response.json(result);
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/resume")) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/jobs/".length, -"/resume".length)
      ).trim();
      const result = await resumeStudioJobById(id);
      return Response.json(result);
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/jobs/".length, -"/cancel".length)
      ).trim();
      const result = await cancelStudioJobById(id, "creator");
      return Response.json(result);
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 404 });
    }
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
