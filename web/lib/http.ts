import fs from "node:fs";
import path from "node:path";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

export function jsonError(err: unknown, defaultStatus = 400): Response {
  const msg = errorMessage(err);
  return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : defaultStatus });
}

export async function serveFileWithRange(
  absPath: string,
  req: Request,
  opts?: { contentType?: string; download?: boolean; filename?: string }
): Promise<Response> {
  const st = fs.statSync(absPath);
  if (!st.isFile()) {
    return Response.json({ error: "Path is not a file" }, { status: 400 });
  }
  const fileName = opts?.filename || path.basename(absPath);
  const forceDownload = opts?.download === true;
  const contentType = opts?.contentType || "application/octet-stream";
  const size = st.size;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Length": String(size),
    "Cache-Control": "no-store",
  };
  if (forceDownload) {
    const safeAscii = fileName.replace(/["\\\r\n]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const rangeHeader = req.headers.get("range");
  if (rangeHeader && rangeHeader.startsWith("bytes=")) {
    const [startStr, endStr] = rangeHeader.slice(6).split("-");
    const start = startStr ? Number.parseInt(startStr, 10) : 0;
    const end = endStr ? Math.min(size - 1, Number.parseInt(endStr, 10)) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(Bun.file(absPath).slice(start, end + 1), { status: 206, headers });
  }
  return new Response(Bun.file(absPath), { headers });
}
