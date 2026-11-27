import fs from "node:fs";
import path from "node:path";
import { exportWorkspaceEntryToBox } from "../../agent/lib/box.ts";
import {
  deleteClipJob,
  deleteClipRecord,
  listClipRecords,
  updateClipBoxUrl,
} from "../../agent/lib/studio-db.ts";
import { listClipEcosystem, listLegacyClips, startClipJob } from "../lib/clip-service.ts";
import { cancelBackgroundClipJob } from "../lib/clip-worker.ts";
import { serveFileWithRange } from "../lib/http.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { broadcast } from "../lib/sse.ts";
import {
  resolveSafeWorkspacePath,
  WORKSPACE_CLIPS_DIR,
} from "../lib/workspace.ts";

export async function handleClipsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/clips/ecosystem") {
    return Response.json(listClipEcosystem());
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
      const job = startClipJob(
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

  if (req.method === "POST" && url.pathname.startsWith("/api/clips/jobs/") && url.pathname.endsWith("/cancel")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/clips/jobs/".length, -"/cancel".length)
    );
    const job = cancelBackgroundClipJob(id, broadcast, (busy) => {
      if (!busy) rpc.releaseSpriteHold();
    });
    if (!job) return Response.json({ error: "Clip job not found" }, { status: 404 });
    return Response.json({ ok: true, job });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/clips/jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/clips/jobs/".length));
    const ok = deleteClipJob(id);
    if (ok) broadcast({ type: "clips_changed" });
    return Response.json({ ok });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/clips/records/") && url.pathname.endsWith("/box")) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/clips/records/".length, -"/box".length)
    );
    const all = listClipRecords({ limit: 200 });
    const rec = all.find((c) => c.id === id);
    if (!rec) return Response.json({ error: "Clip record not found" }, { status: 404 });
    try {
      const resolved = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
      const uploaded = await exportWorkspaceEntryToBox(resolved.absPath, resolved.relPath);
      const updated = updateClipBoxUrl(rec.id, uploaded.url);
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
    const ok = deleteClipRecord(id);
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
