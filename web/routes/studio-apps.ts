import { errorMessage } from "../lib/http.ts";
import { broadcast } from "../lib/sse.ts";
import {
  deleteCustomStudioApp,
  getCustomStudioApp,
  getCustomStudioAppState,
  listCustomStudioApps,
  saveCustomStudioAppState,
  updateCustomStudioAppCode,
} from "../../agent/lib/studio-apps.ts";

export async function handleStudioAppsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/studio-apps") {
    return Response.json({ apps: listCustomStudioApps() });
  }

  const studioAppMatch = url.pathname.match(/^\/api\/studio-apps\/([^/]+)(?:\/(code|state))?$/);
  if (studioAppMatch) {
    const slug = decodeURIComponent(studioAppMatch[1]).trim();
    const sub = studioAppMatch[2] || "";
    try {
      if (!sub && req.method === "GET") {
        const app = getCustomStudioApp(slug);
        if (!app) return Response.json({ error: "App not found" }, { status: 404 });
        return Response.json(app);
      }
      if (!sub && req.method === "DELETE") {
        const ok = deleteCustomStudioApp(slug);
        if (!ok) return Response.json({ error: "App not found" }, { status: 404 });
        broadcast({ type: "studio_apps_changed", slug, deleted: true });
        return Response.json({ ok: true, deleted: slug });
      }
      if (sub === "code" && req.method === "PUT") {
        const body = (await req.json().catch(() => ({}))) as { code?: string };
        if (typeof body.code !== "string") {
          return Response.json({ error: "Missing code" }, { status: 400 });
        }
        const meta = updateCustomStudioAppCode(slug, body.code);
        broadcast({ type: "studio_apps_changed", slug });
        return Response.json({ ok: true, meta });
      }
      if (sub === "state" && req.method === "GET") {
        const state = getCustomStudioAppState(slug);
        return Response.json({ ok: true, state });
      }
      if (sub === "state" && req.method === "PUT") {
        const body = (await req.json().catch(() => ({}))) as { state?: Record<string, unknown> };
        const saved = saveCustomStudioAppState(slug, (body.state || {}) as Record<string, unknown>);
        return Response.json({ ok: true, state: saved });
      }
    } catch (err: unknown) {
      const msg = errorMessage(err);
      return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
    }
  }

  return null;
}
