import fs from "node:fs";
import path from "node:path";
import { exportWorkspaceEntryToBox } from "../../agent/lib/box.ts";
import { transcribeClipToSrt } from "../../agent/lib/elevenlabs-stt.ts";
import {
  deleteClipJob,
  deleteClipRecord,
  listClipRecords,
  updateClipBoxUrl,
  upsertClipRecord,
} from "../../agent/lib/studio-db.ts";
import { listClipEcosystem, listLegacyClips, resumeClipJob, startClipJob } from "../lib/clip-service.ts";
import { cancelBackgroundClipJob } from "../lib/clip-worker.ts";
import { buildAgentChildEnv } from "../lib/child-env.ts";
import { OMP_BIN, WORK_DIR } from "../lib/config.ts";
import { serveFileWithRange } from "../lib/http.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { broadcast } from "../lib/sse.ts";
import {
  resolveSafeWorkspacePath,
  WORKSPACE_CLIPS_DIR,
  WORKSPACE_ROOT,
} from "../lib/workspace.ts";

export async function handleClipsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/clips/ecosystem") {
    return Response.json(await listClipEcosystem());
  }

  if (req.method === "POST" && url.pathname === "/api/clips/jobs") {
    try {
      const body = (await req.json()) as {
        vodUrl?: string;
        title?: string;
        maxClips?: number;
        focusNotes?: string;
      };
      if (!body.vodUrl || !String(body.vodUrl).trim()) {
        return Response.json({ error: "YouTube VOD URL is required" }, { status: 400 });
      }
      const job = await startClipJob(
        {
          vodUrl: String(body.vodUrl),
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

  if (req.method === "POST" && url.pathname.startsWith("/api/clips/jobs/") && url.pathname.endsWith("/resume")) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/clips/jobs/".length, -"/resume".length)
      );
      const job = await resumeClipJob(id, rpc);
      return Response.json({ ok: true, job });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/clips/jobs/") && url.pathname.endsWith("/cancel")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/clips/jobs/".length, -"/cancel".length)
    );
    const job = await cancelBackgroundClipJob(id, broadcast, (busy) => {
      if (!busy) rpc.releaseSpriteHold();
    });
    if (!job) return Response.json({ error: "Clip job not found" }, { status: 404 });
    return Response.json({ ok: true, job });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/clips/jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/clips/jobs/".length));
    const ok = await deleteClipJob(id);
    if (ok) broadcast({ type: "clips_changed" });
    return Response.json({ ok });
  }

  // Redo transcription pipeline (ElevenLabs Scribe v3 + Gemini 3.5 Flash-Lite typo fix, zero omp)
  if (req.method === "POST" && url.pathname.startsWith("/api/clips/records/") && url.pathname.endsWith("/retranscribe")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/clips/records/".length, -"/retranscribe".length)
    );
    const all = await listClipRecords({ limit: 200 });
    const rec = all.find((c) => c.id === id);
    if (!rec) return Response.json({ error: "Clip record not found" }, { status: 404 });
    try {
      const resolvedMp4 = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
      const base = path.basename(resolvedMp4.absPath, path.extname(resolvedMp4.absPath));
      const targetSrtAbs = rec.srtPath
        ? resolveSafeWorkspacePath(rec.srtPath, { allowMissing: true }).absPath
        : path.join(path.dirname(resolvedMp4.absPath), `${base}.srt`);
      const targetSrtRel = path
        .relative(WORKSPACE_ROOT, targetSrtAbs)
        .split(path.sep)
        .join("/");

      const stt = await transcribeClipToSrt(resolvedMp4.absPath, targetSrtAbs);
      if (!stt.ok) {
        return Response.json({ error: stt.error || "Transcription failed" }, { status: 500 });
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
        geminiWarning: stt.geminiWarning,
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  // Retry / finish remaining steps on an un-prepped raw clip (vod_prep_clip -> watch_clip -> vod_save_clip)
  if (req.method === "POST" && url.pathname === "/api/clips/finish-file") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        relPath?: string;
        videoId?: string;
      };
      const relPath = String(body.relPath || "").trim();
      if (!relPath) {
        return Response.json({ error: "relPath is required" }, { status: 400 });
      }
      const resolved = resolveSafeWorkspacePath(relPath, { allowMissing: false });
      const videoId =
        String(body.videoId || "").trim() ||
        path.basename(path.dirname(resolved.absPath));
      const alreadyPrepped = resolved.absPath.endsWith("_prepped.mp4");
      const rawBase = path.basename(resolved.absPath, ".mp4").replace(/_prepped$/, "");

      const prompt = [
        `ISOLATED CLIP COMPLETION TASK (finish the remaining steps for an already-cut clip without re-scanning or re-cutting the VOD).`,
        `Target file: ${resolved.absPath} (workspace-relative: ${resolved.relPath})`,
        `Video ID: ${videoId}`,
        ``,
        `Execute strictly in order:`,
        alreadyPrepped
          ? `1. The file is already normalized (*_prepped.mp4). Skip vod_prep_clip unless no .srt exists alongside it.`
          : `1. Call vod_prep_clip(inputPath="${resolved.absPath}") to normalize to CFR 30fps + -14 LUFS and generate ElevenLabs Scribe v3 + Gemini typo-fixed .srt subtitles.`,
        `2. Call watch_clip(target=<output_path from step 1, or "${resolved.absPath}">) to watch the clip and evaluate the 3-second hook, framing, audio, and punchline.`,
        `3. Call vod_save_clip(videoId="${videoId}", title=<punchy human-friendly clip title based on what happens in the clip, NOT raw filename "${rawBase}">, filePath=<prepped workspace-relative path>, srtPath=<srt_path from step 1 if present>, hookScore=<1-10>, editorNotes=<concise actionable notes for human editor>, youtubeUrl="https://www.youtube.com/watch?v=${videoId}").`,
        `4. Reply concisely in one line confirming the clip was finished and saved.`,
      ].join("\n");

      rpc.backgroundBusy = true;
      void rpc.holdSpriteActive();
      void (async () => {
        try {
          const proc = Bun.spawn(
            [
              OMP_BIN,
              "--no-session",
              "--tools",
              "vod_prep_clip,watch_clip,vod_save_clip",
              "-p",
              prompt,
            ],
            {
              cwd: WORK_DIR,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env: buildAgentChildEnv(),
            }
          );
          await proc.exited;
        } finally {
          rpc.backgroundBusy = false;
          rpc.releaseSpriteHold();
          broadcast({ type: "clips_changed" });
          broadcast({ type: "workspace_changed" });
        }
      })();

      return Response.json({ ok: true, started: true, relPath: resolved.relPath });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/clips/records/") && url.pathname.endsWith("/box")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/clips/records/".length, -"/box".length)
    );
    const all = await listClipRecords({ limit: 200 });
    const rec = all.find((c) => c.id === id);
    if (!rec) return Response.json({ error: "Clip record not found" }, { status: 404 });
    try {
      const resolved = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
      const uploaded = await exportWorkspaceEntryToBox(resolved.absPath, resolved.relPath);
      const updated = await updateClipBoxUrl(rec.id, uploaded.url);
      broadcast({ type: "clips_changed" });
      return Response.json({ ok: true, clip: updated, boxUrl: uploaded.url });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/clips/records/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/clips/records/".length));
    const ok = await deleteClipRecord(id);
    if (ok) broadcast({ type: "clips_changed" });
    return Response.json({ ok });
  }

  if (req.method === "GET" && url.pathname === "/api/clips") {
    return Response.json(listLegacyClips());
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/api/clips/file/")) {
    const relParts = url.pathname.slice("/api/clips/file/".length).split("/").filter(Boolean);
    if (relParts.length !== 2) {
      return Response.json({ error: "Invalid clip path" }, { status: 400 });
    }
    let vidRaw: string;
    let fileRaw: string;
    try {
      [vidRaw, fileRaw] = relParts.map((p) => decodeURIComponent(p));
    } catch {
      return Response.json({ error: "Malformed clip path encoding" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(vidRaw) || !/^[A-Za-z0-9_.-]+\.(mp4|srt)$/.test(fileRaw)) {
      return Response.json({ error: "Invalid clip filename" }, { status: 400 });
    }
    const clipsRoot = path.resolve(WORKSPACE_CLIPS_DIR);
    const candidate = path.resolve(clipsRoot, vidRaw, fileRaw);
    if (!candidate.startsWith(clipsRoot + path.sep) || !fs.existsSync(candidate)) {
      return Response.json({ error: "Clip not found" }, { status: 404 });
    }
    const isDownload = url.searchParams.get("download") === "1";
    const contentType = fileRaw.endsWith(".mp4") ? "video/mp4" : "text/plain; charset=utf-8";
    return await serveFileWithRange(candidate, req, {
      contentType,
      download: isDownload,
      filename: fileRaw,
    });
  }

  return null;
}
