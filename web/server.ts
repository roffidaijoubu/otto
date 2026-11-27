import fs from "node:fs";
import { PORT, loadPrivateEnv } from "./lib/config.ts";
import { initWebPassword, isAuthenticated } from "./lib/auth.ts";
import { LOGIN_HTML } from "./lib/login-html.ts";
import { broadcast } from "./lib/sse.ts";
import { rpc } from "./lib/rpc-bridge.ts";
import { reconcileOrphanedClipJobs } from "./lib/clip-worker.ts";
import { WORKSPACE_ROOT, ensureWorkspaceScaffold } from "./lib/workspace.ts";
import { serveFavicon, serveSpa } from "./lib/static.ts";
import { handlePublicRoutes } from "./routes/public.ts";
import { handleWakeupRoutes } from "./routes/wakeup.ts";
import { handleInternalRoutes } from "./routes/internal.ts";
import { handleChatRoutes } from "./routes/chat.ts";
import { handleSetupRoutes } from "./routes/setup.ts";
import { handleCalendarRoutes } from "./routes/calendar.ts";
import { handleConnectorsRoutes } from "./routes/connectors.ts";
import { handleWorkspaceRoutes } from "./routes/workspace.ts";
import { handleStudioAppsRoutes } from "./routes/studio-apps.ts";
import { handleObsOverlaysRoutes } from "./routes/obs-overlays.ts";
import { handleThumbnailsRoutes } from "./routes/thumbnails.ts";
import { handleDbRoutes } from "./routes/db.ts";
import { handleClipsRoutes } from "./routes/clips.ts";

loadPrivateEnv();
initWebPassword();

void rpc;
reconcileOrphanedClipJobs();

// Initialize Unified Workspace scaffold & debounced live watcher for SSE auto-refresh
ensureWorkspaceScaffold();
let workspaceWatchTimer: NodeJS.Timeout | null = null;
try {
  fs.watch(WORKSPACE_ROOT, { recursive: true }, () => {
    clearTimeout(workspaceWatchTimer ?? undefined);
    workspaceWatchTimer = setTimeout(() => {
      broadcast({ type: "workspace_changed" });
    }, 350);
  });
} catch {
  // Recursive fs.watch may be unsupported on some kernels; tool_execution_end + API mutations still broadcast live
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req, server) {
    const url = new URL(req.url);

    const publicRes = await handlePublicRoutes(req, url, server);
    if (publicRes) return publicRes;

    const wakeupRes = await handleWakeupRoutes(req, url);
    if (wakeupRes) return wakeupRes;

    const internalRes = await handleInternalRoutes(req, url);
    if (internalRes) return internalRes;

    const faviconRes = serveFavicon(req, url);
    if (faviconRes) return faviconRes;

    // Everything below requires valid passcode session when LMA_WEB_PASSWORD is set
    if (!isAuthenticated(req)) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return new Response(LOGIN_HTML, {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const chatRes = await handleChatRoutes(req, url);
    if (chatRes) return chatRes;

    const setupRes = await handleSetupRoutes(req, url);
    if (setupRes) return setupRes;

    const calendarRes = await handleCalendarRoutes(req, url);
    if (calendarRes) return calendarRes;

    const connectorsRes = await handleConnectorsRoutes(req, url);
    if (connectorsRes) return connectorsRes;

    const workspaceRes = await handleWorkspaceRoutes(req, url);
    if (workspaceRes) return workspaceRes;

    const studioAppsRes = await handleStudioAppsRoutes(req, url);
    if (studioAppsRes) return studioAppsRes;

    const obsOverlaysRes = await handleObsOverlaysRoutes(req, url);
    if (obsOverlaysRes) return obsOverlaysRes;

    const thumbnailsRes = await handleThumbnailsRoutes(req, url);
    if (thumbnailsRes) return thumbnailsRes;

    const dbRes = await handleDbRoutes(req, url);
    if (dbRes) return dbRes;

    const clipsRes = await handleClipsRoutes(req, url);
    if (clipsRes) return clipsRes;

    const spaRes = serveSpa(req, url);
    if (spaRes) return spaRes;

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[lma-web] Otto Studio Web UI listening on http://0.0.0.0:${PORT}`);
