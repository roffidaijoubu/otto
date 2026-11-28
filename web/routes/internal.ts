import { requireInternalSecret } from "../lib/internal-auth.ts";
import { handleHybridChatCompletions } from "../lib/llm-router.ts";
import { startClipJob } from "../lib/clip-service.ts";
import { startBackgroundArchiveSync } from "../lib/archive-worker.ts";
import {
  cancelStudioJobById,
  dispatchStudioJob,
  inspectStudioJobById,
  listEnrichedStudioJobs,
  nudgeStudioJobById,
  resumeStudioJobById,
  type DispatchStudioJobInput,
} from "../lib/job-control.ts";
import { dispatchObsOverlayBackgroundJob } from "./obs-overlays.ts";
import { dispatchThumbnailBackgroundJob } from "./thumbnails.ts";
import { broadcast } from "../lib/sse.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import type { StudioJobKind, StudioJobStatus } from "../../agent/lib/studio-db.ts";

export async function handleInternalRoutes(req: Request, url: URL): Promise<Response | null> {
  // Internal OpenAI-compatible Hybrid LLM Router (Ollama primary -> Gemini circuit-breaker fallback)
  if (req.method === "POST" && url.pathname === "/api/internal/llm/v1/chat/completions") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    return handleHybridChatCompletions(req);
  }

  // Internal-only Studio App & OBS Overlay presentation endpoints for omp subprocess
  if (
    req.method === "POST" &&
    (url.pathname === "/api/internal/studio-app/open" ||
      url.pathname === "/api/internal/studio-app/changed" ||
      url.pathname === "/api/internal/obs-overlay/open" ||
      url.pathname === "/api/internal/obs-overlay/changed" ||
      url.pathname === "/api/internal/thumbnail/open" ||
      url.pathname === "/api/internal/thumbnail/changed")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      slug?: string;
      title?: string;
      autoFocus?: boolean;
      deleted?: boolean;
    };
    const slug = String(body.slug || "").trim();
    if (url.pathname === "/api/internal/studio-app/open") {
      broadcast({ type: "studio_apps_changed", slug });
      broadcast({
        type: "studio_app_open",
        slug,
        title: body.title || slug,
        autoFocus: body.autoFocus !== false,
      });
    } else if (url.pathname === "/api/internal/studio-app/changed") {
      broadcast({ type: "studio_apps_changed", slug, deleted: body.deleted === true });
    } else if (url.pathname === "/api/internal/obs-overlay/open") {
      broadcast({ type: "obs_overlays_changed", slug });
      broadcast({
        type: "obs_overlay_open",
        slug,
        title: body.title || slug,
        autoFocus: body.autoFocus !== false,
      });
    } else if (url.pathname === "/api/internal/obs-overlay/changed") {
      broadcast({ type: "obs_overlays_changed", slug, deleted: body.deleted === true });
    } else if (url.pathname === "/api/internal/thumbnail/open") {
      broadcast({ type: "thumbnails_changed", slug });
      broadcast({
        type: "thumbnail_open",
        slug,
        title: body.title || slug,
        autoFocus: body.autoFocus !== false,
      });
    } else {
      broadcast({ type: "thumbnails_changed", slug, deleted: body.deleted === true });
    }
    return Response.json({ ok: true, slug });
  }

  // Internal-only dispatchers so main Otto Chat offloads Thumbnails & OBS Overlays to isolated OMP workers
  if (req.method === "POST" && url.pathname === "/api/internal/thumbnails/start") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      attachedImages?: string[];
      slug?: string;
      label?: string;
    };
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
    const job = dispatchThumbnailBackgroundJob({
      prompt,
      attachedImages: Array.isArray(body.attachedImages) ? body.attachedImages : [],
      slug: body.slug ? String(body.slug) : undefined,
      label: body.label ? String(body.label) : undefined,
    });
    return Response.json({ ok: true, ...job });
  }

  if (req.method === "POST" && url.pathname === "/api/internal/obs-overlays/start") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      attachedImages?: string[];
      slug?: string;
      label?: string;
    };
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
    const job = dispatchObsOverlayBackgroundJob({
      prompt,
      attachedImages: Array.isArray(body.attachedImages) ? body.attachedImages : [],
      slug: body.slug ? String(body.slug) : undefined,
      label: body.label ? String(body.label) : undefined,
    });
    return Response.json({ ok: true, ...job });
  }

  // Internal-only endpoint for Otto chat (`vod_start_clip_job`) to dispatch isolated background clip jobs
  if (req.method === "POST" && url.pathname === "/api/internal/clip-jobs/start") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    try {
      const body = (await req.json()) as {
        vodUrl?: string;
        videoId?: string;
        title?: string;
        maxClips?: number;
        focusNotes?: string;
      };
      if (!body.vodUrl) {
        return Response.json({ error: "vodUrl is required" }, { status: 400 });
      }
      const job = await startClipJob(
        {
          vodUrl: String(body.vodUrl),
          videoId: body.videoId ? String(body.videoId) : undefined,
          title: body.title ? String(body.title) : undefined,
          maxClips: typeof body.maxClips === "number" ? body.maxClips : 0,
          focusNotes: body.focusNotes ? String(body.focusNotes) : "",
        },
        rpc
      );
      return Response.json({ ok: true, job });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  // Internal-only endpoint for Otto chat (`archive_sync_channel`) to trigger background Pinecone sync
  if (req.method === "POST" && url.pathname === "/api/internal/archive/sync") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
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

  // Internal-only Studio Jobs dispatch, visibility, live RPC nudging, resume, and cancel endpoints for Otto
  if (req.method === "POST" && url.pathname === "/api/internal/jobs/dispatch") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    try {
      const body = (await req.json().catch(() => ({}))) as DispatchStudioJobInput;
      if (!body.kind) {
        return Response.json({ ok: false, error: "kind is required" }, { status: 400 });
      }
      const result = await dispatchStudioJob(body);
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (req.method === "GET" && url.pathname === "/api/internal/jobs") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const kind = url.searchParams.get("kind") as StudioJobKind | null;
    const status = url.searchParams.get("status") as StudioJobStatus | null;
    const limit = Number(url.searchParams.get("limit") || 25);
    const jobs = await listEnrichedStudioJobs({
      kind: kind || undefined,
      status: status || undefined,
      limit: Number.isFinite(limit) ? limit : 25,
    });
    return Response.json({ ok: true, jobs });
  }

  if (
    req.method === "GET" &&
    url.pathname.startsWith("/api/internal/jobs/") &&
    !url.pathname.slice("/api/internal/jobs/".length).includes("/")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const id = decodeURIComponent(url.pathname.slice("/api/internal/jobs/".length)).trim();
    const detail = await inspectStudioJobById(id);
    if (!detail) return Response.json({ ok: false, error: `Job "${id}" not found` }, { status: 404 });
    return Response.json({ ok: true, ...detail });
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/internal/jobs/") &&
    url.pathname.endsWith("/nudge")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/internal/jobs/".length, -"/nudge".length)
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
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/internal/jobs/") &&
    url.pathname.endsWith("/resume")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/internal/jobs/".length, -"/resume".length)
      ).trim();
      const result = await resumeStudioJobById(id);
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/internal/jobs/") &&
    url.pathname.endsWith("/cancel")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/internal/jobs/".length, -"/cancel".length)
      ).trim();
      const result = await cancelStudioJobById(id, "Otto");
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  return null;
}
