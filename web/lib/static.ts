import fs from "node:fs";
import path from "node:path";
import { DIST_DIR } from "./config.ts";

export function serveFavicon(req: Request, url: URL): Response | null {
  if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
    const distIcon = path.join(DIST_DIR, "favicon.svg");
    const pubIcon = path.join(import.meta.dir, "..", "public", "favicon.svg");
    const iconPath = fs.existsSync(distIcon) ? distIcon : fs.existsSync(pubIcon) ? pubIcon : null;
    if (iconPath) {
      const headers = {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      };
      return req.method === "HEAD"
        ? new Response(null, { status: 200, headers })
        : new Response(Bun.file(iconPath), { status: 200, headers });
    }
  }
  return null;
}

export function serveSpa(req: Request, url: URL): Response | null {
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const resolvedDist = path.resolve(DIST_DIR);
    const candidate = path.resolve(resolvedDist, rel);
    if (
      candidate.startsWith(resolvedDist + path.sep) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return new Response(Bun.file(candidate));
    }
    const fallback = path.join(resolvedDist, "index.html");
    if (fs.existsSync(fallback)) {
      return new Response(Bun.file(fallback), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Frontend not built yet. Run: cd web && bun run build", { status: 503 });
  }
  return null;
}
