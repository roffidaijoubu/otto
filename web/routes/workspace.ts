import fs from "node:fs";
import path from "node:path";
import {
  exportWorkspaceEntryToBox,
  resolveBoxGatewayUrl,
} from "../../agent/lib/box.ts";
import { errorMessage, jsonError, readJson, serveFileWithRange } from "../lib/http.ts";
import { broadcast } from "../lib/sse.ts";
import {
  classifyFile,
  createWorkspaceZip,
  listWorkspaceDirectory,
  MAX_TEXT_PREVIEW_BYTES,
  MAX_UPLOAD_BYTES,
  resolveSafeWorkspacePath,
  sanitizeSegment,
  uniqueDestinationPath,
} from "../lib/workspace.ts";

export async function handleWorkspaceRoutes(
  req: Request,
  url: URL
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/workspace/list") {
    try {
      const relDir = url.searchParams.get("path") || "";
      const q = url.searchParams.get("q") || "";
      const listing = listWorkspaceDirectory(relDir, q);
      return Response.json(listing);
    } catch (err: unknown) {
      return jsonError(err);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/upload") {
    try {
      const form = await req.formData();
      const rawDir = typeof form.get("dir") === "string" ? String(form.get("dir")) : "uploads";
      const { absPath: targetDirAbs, relPath: targetDirRel } = resolveSafeWorkspacePath(rawDir, {
        allowMissing: true,
      });
      fs.mkdirSync(targetDirAbs, { recursive: true });
      if (!fs.statSync(targetDirAbs).isDirectory()) {
        return Response.json({ error: "Upload target is not a directory" }, { status: 400 });
      }
      const rawEntries = form.getAll("files");
      const single = form.get("file");
      if (single && rawEntries.length === 0) rawEntries.push(single);
      const files = rawEntries.filter((f): f is Exclude<typeof f, string> => typeof f !== "string");
      if (files.length === 0) {
        return Response.json({ error: "No files uploaded" }, { status: 400 });
      }
      const uploaded: Array<{
        name: string;
        relPath: string;
        absPath: string;
        sizeBytes: number;
        kind: string;
      }> = [];
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          return Response.json(
            { error: `File '${file.name}' exceeds ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit` },
            { status: 413 }
          );
        }
        const { absPath: destAbs, finalName } = uniqueDestinationPath(targetDirAbs, file.name || "upload.bin");
        await Bun.write(destAbs, file);
        const relPath = targetDirRel ? `${targetDirRel}/${finalName}` : finalName;
        const cls = classifyFile(finalName);
        uploaded.push({
          name: finalName,
          relPath,
          absPath: destAbs,
          sizeBytes: file.size,
          kind: cls.kind,
        });
      }
      broadcast({ type: "workspace_changed" });
      return Response.json({ ok: true, uploaded });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/mkdir") {
    try {
      const body = await readJson<{ dir?: string; name?: string }>(req);
      const safeName = sanitizeSegment(String(body?.name || ""));
      const parentRel = typeof body?.dir === "string" ? body.dir : "";
      const combined = parentRel ? `${parentRel}/${safeName}` : safeName;
      const { absPath, relPath } = resolveSafeWorkspacePath(combined, { allowMissing: true });
      fs.mkdirSync(absPath, { recursive: true });
      broadcast({ type: "workspace_changed" });
      return Response.json({ ok: true, path: relPath });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/rename") {
    try {
      const body = await readJson<{ path?: string; newPath?: string }>(req);
      const src = resolveSafeWorkspacePath(String(body?.path || ""));
      if (!src.relPath) {
        return Response.json({ error: "Cannot rename workspace root" }, { status: 400 });
      }
      const dst = resolveSafeWorkspacePath(String(body?.newPath || ""), { allowMissing: true });
      if (!dst.relPath) {
        return Response.json({ error: "Destination path is required" }, { status: 400 });
      }
      if (dst.absPath === src.absPath) {
        return Response.json({ ok: true, path: dst.relPath });
      }
      if (dst.absPath.startsWith(src.absPath + path.sep)) {
        return Response.json({ error: "Cannot move a folder inside itself" }, { status: 400 });
      }
      if (fs.existsSync(dst.absPath)) {
        return Response.json({ error: "Destination already exists" }, { status: 409 });
      }
      fs.mkdirSync(path.dirname(dst.absPath), { recursive: true });
      fs.renameSync(src.absPath, dst.absPath);
      broadcast({ type: "workspace_changed" });
      return Response.json({ ok: true, path: dst.relPath });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "DELETE" && url.pathname === "/api/workspace/entry") {
    try {
      const rel = url.searchParams.get("path") || "";
      const target = resolveSafeWorkspacePath(rel);
      if (!target.relPath) {
        return Response.json({ error: "Cannot delete workspace root" }, { status: 400 });
      }
      fs.rmSync(target.absPath, { recursive: true, force: true });
      broadcast({ type: "workspace_changed" });
      return Response.json({ ok: true, deleted: target.relPath });
    } catch (err: unknown) {
      return jsonError(err);
    }
  }

  if (req.method === "GET" && url.pathname === "/api/workspace/text") {
    try {
      const rel = url.searchParams.get("path") || "";
      const { absPath, relPath } = resolveSafeWorkspacePath(rel);
      const st = fs.statSync(absPath);
      if (!st.isFile()) {
        return Response.json({ error: "Path is not a file" }, { status: 400 });
      }
      if (st.size > MAX_TEXT_PREVIEW_BYTES) {
        return Response.json({ error: "File exceeds 2 MB inline text preview limit" }, { status: 413 });
      }
      const cls = classifyFile(path.basename(absPath));
      if (!cls.editable) {
        return Response.json({ error: "File type is not a plain-text previewable format" }, { status: 415 });
      }
      const content = fs.readFileSync(absPath, "utf8");
      return Response.json({
        path: relPath,
        absPath,
        name: path.basename(absPath),
        kind: cls.kind,
        content,
        sizeBytes: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    } catch (err: unknown) {
      return jsonError(err);
    }
  }

  if (req.method === "PUT" && url.pathname === "/api/workspace/text") {
    try {
      const body = await readJson<{ path?: string; content?: string }>(req);
      const rawPath = String(body?.path || "");
      const content = typeof body?.content === "string" ? body.content : "";
      if (Buffer.byteLength(content, "utf8") > MAX_TEXT_PREVIEW_BYTES) {
        return Response.json({ error: "Content exceeds 2 MB inline editor limit" }, { status: 413 });
      }
      const { absPath, relPath } = resolveSafeWorkspacePath(rawPath, { allowMissing: true });
      if (!relPath) {
        return Response.json({ error: "File path is required" }, { status: 400 });
      }
      const cls = classifyFile(path.basename(absPath));
      if (!cls.editable) {
        return Response.json({ error: "Only text/markdown files can be edited inline" }, { status: 415 });
      }
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, content, "utf8");
      fs.renameSync(tmp, absPath);
      const st = fs.statSync(absPath);
      broadcast({ type: "workspace_changed" });
      return Response.json({
        ok: true,
        path: relPath,
        sizeBytes: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/workspace/file") {
    try {
      const rel = url.searchParams.get("path") || "";
      const { absPath } = resolveSafeWorkspacePath(rel);
      const fileName = path.basename(absPath);
      const cls = classifyFile(fileName);
      const forceDownload = url.searchParams.get("download") === "1" || !cls.inlineMime;
      return await serveFileWithRange(absPath, req, {
        contentType: forceDownload ? "application/octet-stream" : cls.inlineMime!,
        download: forceDownload,
        filename: fileName,
      });
    } catch (err: unknown) {
      return jsonError(err);
    }
  }

  if (req.method === "GET" && url.pathname === "/api/workspace/box-status") {
    const gw = await resolveBoxGatewayUrl();
    return Response.json({ connected: Boolean(gw) });
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/export-box") {
    try {
      const body = (await req.json().catch(() => ({}))) as { path?: string };
      const rawPath = typeof body.path === "string" ? body.path : "";
      const { absPath, relPath } = resolveSafeWorkspacePath(rawPath, { allowMissing: false });
      if (!fs.existsSync(absPath)) {
        return Response.json({ ok: false, error: "File or folder not found" }, { status: 404 });
      }
      const result = await exportWorkspaceEntryToBox(absPath, relPath);
      return Response.json({ ok: true, ...result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const status = /not connected/i.test(msg) ? 503 : /not found/i.test(msg) ? 404 : 400;
      return Response.json({ ok: false, error: msg }, { status });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/workspace/zip") {
    let zipResult: { zipPath: string; downloadName: string; cleanup: () => void } | null = null;
    try {
      const relDir = url.searchParams.get("path") || "";
      zipResult = await createWorkspaceZip(relDir);
      const bytes = fs.readFileSync(zipResult.zipPath);
      const downloadName = zipResult.downloadName;
      zipResult.cleanup();
      zipResult = null;
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/zip",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename="${downloadName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err: unknown) {
      if (zipResult) zipResult.cleanup();
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
