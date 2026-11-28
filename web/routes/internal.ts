import path from "node:path";
import { BOX_MAX_UPLOAD_BYTES, exportWorkspaceEntryToBox } from "../../agent/lib/box.ts";
import { getBoxSyncStatus, syncWorkspaceWithBox } from "../../agent/lib/box-sync.ts";
import { transcribeClipToSrt } from "../../agent/lib/elevenlabs-stt.ts";
import {
  getSocialMetricsOverview,
  syncAllSocialMetrics,
  syncSocialPlatform,
  type SocialPlatform,
} from "../../agent/lib/social-metrics.ts";
import {
  deleteClipRecord,
  listClipRecords,
  updateClipBoxUrl,
  upsertClipRecord,
  type StudioJobKind,
  type StudioJobStatus,
} from "../../agent/lib/studio-db.ts";
import {
  getYouTubeMetricsWidgetState,
  syncDailyMetricsQStashSchedule,
  syncYouTubeMetrics,
} from "../../agent/lib/youtube-metrics.ts";
import {
  configureAutoSnapshotSchedule,
  createSpriteCheckpoint,
  getAutoSnapshotConfig,
  listSpriteCheckpoints,
} from "../lib/checkpoints.ts";
import { fetchGatewayList } from "../lib/gateway.ts";
import { readSetupIdentity } from "../lib/identity.ts";
import { requireInternalSecret } from "../lib/internal-auth.ts";
import {
  cancelStudioJobById,
  dispatchStudioJob,
  inspectStudioJobById,
  listEnrichedStudioJobs,
  nudgeStudioJobById,
  resumeStudioJobById,
  type DispatchStudioJobInput,
} from "../lib/job-control.ts";
import { getLlmRouterStatus, handleHybridChatCompletions, probeOllamaNow } from "../lib/llm-router.ts";
import { computeGuardrailStatus } from "../lib/qstash.ts";
import { broadcast } from "../lib/sse.ts";
import { resolveSafeWorkspacePath, WORKSPACE_ROOT } from "../lib/workspace.ts";

export async function handleInternalRoutes(req: Request, url: URL): Promise<Response | null> {
  // Internal OpenAI-compatible Hybrid LLM Router (Ollama primary -> Gemini circuit-breaker fallback)
  if (req.method === "POST" && url.pathname === "/api/internal/llm/v1/chat/completions") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    return handleHybridChatCompletions(req);
  }

  // Internal-only Studio App, OBS Overlay & Thumbnail presentation endpoints for omp subprocess
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

  // ==================== UNIFIED STUDIO JOBS ====================
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

  // ==================== SYSTEM DIAGNOSTICS & CHECKPOINTS ====================
  if (req.method === "GET" && url.pathname === "/api/internal/system/status") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const guardrails = computeGuardrailStatus();
    const [gwResult, router] = await Promise.all([
      fetchGatewayList(8000).catch(() => ({ ok: false as const, status: 0, connections: [] })),
      getLlmRouterStatus(url.searchParams.get("refresh") === "1"),
    ]);
    const connectors = gwResult.ok
      ? gwResult.connections.map((c) => ({
          provider: c.provider || "custom_api",
          displayName: c.display_name || c.provider || "Connector",
          connectionType: c.connection_type || "api_key",
          status: "connected",
        }))
      : [];
    return Response.json({ ok: true, guardrails, connectors, router });
  }

  if (req.method === "POST" && url.pathname === "/api/internal/system/probe-ollama") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const result = await probeOllamaNow();
    return Response.json({ ok: true, ollamaHealthy: result.ok, router: result.status });
  }

  if (req.method === "GET" && url.pathname === "/api/internal/checkpoints") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const tz = readSetupIdentity().timezone || "UTC";
    const [listed, autoSnapshot] = await Promise.all([
      listSpriteCheckpoints(),
      getAutoSnapshotConfig(tz),
    ]);
    return Response.json({
      ok: true,
      available: listed.available,
      checkpoints: listed.checkpoints,
      autoSnapshot,
      error: listed.error,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/internal/checkpoints") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as { comment?: string };
    const created = await createSpriteCheckpoint(String(body.comment ?? ""));
    if (!created.ok) {
      return Response.json({ ok: false, error: created.error || "Failed to create checkpoint" }, { status: 500 });
    }
    return Response.json({ ok: true, id: created.id, comment: created.comment });
  }

  if (req.method === "POST" && url.pathname === "/api/internal/checkpoints/auto-config") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; timezone?: string };
    const tz =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : readSetupIdentity().timezone || "UTC";
    const result = await configureAutoSnapshotSchedule({
      enabled: Boolean(body.enabled),
      timezone: tz,
    });
    const autoSnapshot = await getAutoSnapshotConfig(tz);
    return Response.json({ ...result, autoSnapshot });
  }

  // ==================== METRICS SYNC & DAILY CONFIG ====================
  if (req.method === "POST" && url.pathname === "/api/internal/metrics/sync") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const tz = readSetupIdentity().timezone || "UTC";
    const body = (await req.json().catch(() => ({}))) as { platform?: string };
    const target = String(body.platform || "all").toLowerCase();

    if (target === "all") {
      const [ytRes, socialRes] = await Promise.all([
        syncYouTubeMetrics({ timezone: tz }),
        syncAllSocialMetrics(),
      ]);
      const anyOk = ytRes.ok || socialRes.some((r: { ok: boolean }) => r.ok);
      if (anyOk) broadcast({ type: "db_changed" });
      return Response.json({
        ok: anyOk,
        results: {
          youtube: { ok: ytRes.ok, error: ytRes.error },
          ...Object.fromEntries(
            socialRes.map((r: { platform: string; ok: boolean; error?: string }) => [
              r.platform,
              { ok: r.ok, error: r.error },
            ])
          ),
        },
        socials: await getSocialMetricsOverview(),
      });
    }

    if (target === "tiktok" || target === "instagram" || target === "x") {
      const sRes = await syncSocialPlatform(target as SocialPlatform);
      if (sRes.ok) broadcast({ type: "db_changed" });
      return Response.json({ ok: sRes.ok, result: sRes, error: sRes.error });
    }

    const res = await syncYouTubeMetrics({ timezone: tz });
    if (res.ok) broadcast({ type: "db_changed" });
    return Response.json(res);
  }

  if (req.method === "POST" && url.pathname === "/api/internal/metrics/daily-config") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; timezone?: string };
    const tz =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : readSetupIdentity().timezone || "UTC";
    const result = await syncDailyMetricsQStashSchedule({
      enabled: Boolean(body.enabled),
      timezone: tz,
    });
    broadcast({ type: "db_changed" });
    return Response.json({ ...result, state: await getYouTubeMetricsWidgetState(tz) });
  }

  // ==================== CLIPS POST-PROCESSING & RECORDS ====================
  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/internal/clips/records/") &&
    url.pathname.endsWith("/retranscribe")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const id = decodeURIComponent(
      url.pathname.slice("/api/internal/clips/records/".length, -"/retranscribe".length)
    );
    const all = await listClipRecords({ limit: 200 });
    const rec = all.find((c) => c.id === id);
    if (!rec) return Response.json({ ok: false, error: "Clip record not found" }, { status: 404 });
    try {
      const resolvedMp4 = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
      const base = path.basename(resolvedMp4.absPath, path.extname(resolvedMp4.absPath));
      const targetSrtAbs = rec.srtPath
        ? resolveSafeWorkspacePath(rec.srtPath, { allowMissing: true }).absPath
        : path.join(path.dirname(resolvedMp4.absPath), `${base}.srt`);
      const targetSrtRel = path.relative(WORKSPACE_ROOT, targetSrtAbs).split(path.sep).join("/");
      const stt = await transcribeClipToSrt(resolvedMp4.absPath, targetSrtAbs);
      if (!stt.ok) {
        return Response.json({ ok: false, error: stt.error || "Transcription failed" }, { status: 500 });
      }
      if (!rec.srtPath || rec.srtPath !== targetSrtRel) {
        await upsertClipRecord({
          id: rec.id,
          jobId: rec.jobId,
          videoId: rec.videoId,
          title: rec.title,
          filePath: rec.filePath,
          srtPath: targetSrtRel,
          startSec: rec.startSec,
          endSec: rec.endSec,
          durationSec: rec.durationSec,
          hookScore: rec.hookScore,
          editorNotes: rec.editorNotes,
          youtubeUrl: rec.youtubeUrl,
          boxUrl: rec.boxUrl,
          status: rec.status,
        });
      }
      broadcast({ type: "clips_changed" });
      return Response.json({
        ok: true,
        srtPath: targetSrtRel,
        cueCount: stt.cueCount ?? 0,
        provider: stt.provider ?? "elevenlabs-scribe-v3",
        geminiPolished: stt.geminiPolished ?? false,
      });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/internal/clips/records/") &&
    url.pathname.endsWith("/box")
  ) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const id = decodeURIComponent(
      url.pathname.slice("/api/internal/clips/records/".length, -"/box".length)
    );
    const all = await listClipRecords({ limit: 200 });
    const rec = all.find((c) => c.id === id);
    if (!rec) return Response.json({ ok: false, error: "Clip record not found" }, { status: 404 });
    try {
      const resolved = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
      const uploaded = await exportWorkspaceEntryToBox(resolved.absPath, resolved.relPath);
      const updated = await updateClipBoxUrl(rec.id, uploaded.url);
      broadcast({ type: "clips_changed" });
      return Response.json({ ok: true, clip: updated, boxUrl: uploaded.url });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/internal/clips/records/")) {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const id = decodeURIComponent(url.pathname.slice("/api/internal/clips/records/".length));
    const ok = await deleteClipRecord(id);
    if (ok) broadcast({ type: "clips_changed" });
    return Response.json({ ok, id });
  }

  // ==================== WORKSPACE BOX INCREMENTAL SYNC ====================
  if (req.method === "GET" && url.pathname === "/api/internal/box-sync/status") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const status = await getBoxSyncStatus();
    return Response.json({ ok: true, maxUploadBytes: BOX_MAX_UPLOAD_BYTES, sync: status });
  }

  if (req.method === "POST" && url.pathname === "/api/internal/box-sync") {
    const denied = requireInternalSecret(req);
    if (denied) return denied;
    const summary = await syncWorkspaceWithBox();
    if (summary.pulledCount > 0 || summary.pushedCount > 0) {
      broadcast({ type: "workspace_changed" });
    }
    return Response.json({
      ok: !summary.lastError,
      maxUploadBytes: BOX_MAX_UPLOAD_BYTES,
      sync: summary,
      error: summary.lastError || undefined,
    });
  }

  return null;
}
