import { requireInternalSecret } from "../lib/internal-auth.ts";
import { startClipJob } from "../lib/clip-service.ts";
import { broadcast } from "../lib/sse.ts";
import { rpc } from "../lib/rpc-bridge.ts";

export async function handleInternalRoutes(req: Request, url: URL): Promise<Response | null> {
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
      const job = startClipJob(
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

  return null;
}
