import {
  addChannelMetric,
  deleteChannelMetric,
  deleteContact,
  deletePipelineItem,
  getStudioDbOverview,
  listChannelMetrics,
  listContacts,
  listPipelineItems,
  upsertContact,
  upsertPipelineItem,
  type ContactRole,
  type ContactStatus,
  type PipelineFormat,
  type PipelineStatus,
} from "../../agent/lib/studio-db.ts";
import { errorMessage } from "../lib/http.ts";
import { readSetupIdentity } from "../lib/identity.ts";
import {
  getSocialMetricsOverview,
  shouldAutoSyncSocialMetrics,
  syncAllSocialMetrics,
  syncSocialPlatform,
  type SocialPlatform,
} from "../../agent/lib/social-metrics.ts";
import {
  getYouTubeMetricsWidgetState,
  shouldAutoSyncYouTubeMetrics,
  syncDailyMetricsQStashSchedule,
  syncYouTubeMetrics,
} from "../../agent/lib/youtube-metrics.ts";
import { broadcast } from "../lib/sse.ts";

export async function handleDbRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/db/overview") {
    return Response.json(getStudioDbOverview());
  }

  if (req.method === "GET" && url.pathname === "/api/db/pipeline") {
    const status = url.searchParams.get("status") || undefined;
    const format = url.searchParams.get("format") || undefined;
    return Response.json({ items: listPipelineItems({ status, format }) });
  }

  if (req.method === "POST" && url.pathname === "/api/db/pipeline") {
    try {
      const body = (await req.json()) as {
        id?: string;
        title?: string;
        format?: PipelineFormat;
        status?: PipelineStatus;
        hook?: string;
        thumbnailPath?: string;
        scriptPath?: string;
        scheduledFor?: string | null;
        notes?: string;
      };
      const item = upsertPipelineItem(body || {});
      broadcast({ type: "db_changed" });
      return Response.json({ ok: true, item });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/db/pipeline/")) {
    try {
      const id = decodeURIComponent(url.pathname.slice("/api/db/pipeline/".length)).trim();
      const body = (await req.json()) as Record<string, unknown>;
      const item = upsertPipelineItem({ ...(body as Record<string, never>), id });
      broadcast({ type: "db_changed" });
      return Response.json({ ok: true, item });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/db/pipeline/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/db/pipeline/".length)).trim();
    const deleted = deletePipelineItem(id);
    if (deleted) broadcast({ type: "db_changed" });
    return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
  }

  if (req.method === "GET" && url.pathname === "/api/db/contacts") {
    const role = url.searchParams.get("role") || undefined;
    const status = url.searchParams.get("status") || undefined;
    return Response.json({ contacts: listContacts({ role, status }) });
  }

  if (req.method === "POST" && url.pathname === "/api/db/contacts") {
    try {
      const body = (await req.json()) as {
        id?: string;
        name?: string;
        role?: ContactRole;
        handle?: string;
        platform?: string;
        status?: ContactStatus;
        notes?: string;
      };
      const contact = upsertContact(body || {});
      broadcast({ type: "db_changed" });
      return Response.json({ ok: true, contact });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/db/contacts/")) {
    try {
      const id = decodeURIComponent(url.pathname.slice("/api/db/contacts/".length)).trim();
      const body = (await req.json()) as Record<string, unknown>;
      const contact = upsertContact({ ...(body as Record<string, never>), id });
      broadcast({ type: "db_changed" });
      return Response.json({ ok: true, contact });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/db/contacts/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/db/contacts/".length)).trim();
    const deleted = deleteContact(id);
    if (deleted) broadcast({ type: "db_changed" });
    return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
  }

  if (req.method === "GET" && url.pathname === "/api/db/metrics") {
    const limit = Number(url.searchParams.get("limit") || 50);
    return Response.json({ metrics: listChannelMetrics(Number.isFinite(limit) ? limit : 50) });
  }

  if (req.method === "GET" && url.pathname === "/api/db/metrics/widget") {
    const identity = readSetupIdentity();
    const tz = identity.timezone || "UTC";
    const state = getYouTubeMetricsWidgetState(tz);
    let autoSyncStarted = false;
    if (url.searchParams.get("auto") === "1") {
      if (shouldAutoSyncYouTubeMetrics()) {
        autoSyncStarted = true;
        void syncYouTubeMetrics({ timezone: tz }).then((res: { ok: boolean }) => {
          if (res.ok) broadcast({ type: "db_changed" });
        });
      }
      if (shouldAutoSyncSocialMetrics()) {
        autoSyncStarted = true;
        void syncAllSocialMetrics()
          .then((results: Array<{ ok: boolean }>) => {
            if (results.some((r: { ok: boolean }) => r.ok)) broadcast({ type: "db_changed" });
          })
          .catch(() => {});
      }
    }
    return Response.json({ state, autoSyncStarted });
  }

  if (req.method === "GET" && url.pathname === "/api/db/metrics/platforms") {
    return Response.json({ socials: getSocialMetricsOverview() });
  }

  if (req.method === "POST" && url.pathname === "/api/db/metrics/sync") {
    const identity = readSetupIdentity();
    const tz = identity.timezone || "UTC";
    const body = (await req.json().catch(() => ({}))) as { platform?: string };
    const target = String(body.platform || "youtube").toLowerCase();

    if (target === "all") {
      const [ytRes, socialRes] = await Promise.all([
        syncYouTubeMetrics({ timezone: tz }),
        syncAllSocialMetrics(),
      ]);
      const anyOk = ytRes.ok || socialRes.some((r: { ok: boolean }) => r.ok);
      if (anyOk) broadcast({ type: "db_changed" });
      return Response.json(
        {
          ok: anyOk,
          state: ytRes.state,
          socials: getSocialMetricsOverview(),
          results: {
            youtube: { ok: ytRes.ok, error: ytRes.error },
            ...Object.fromEntries(socialRes.map((r: { platform: string; ok: boolean; error?: string }) => [r.platform, { ok: r.ok, error: r.error }])),
          },
        },
        { status: anyOk ? 200 : 502 }
      );
    }

    if (target === "tiktok" || target === "instagram" || target === "x") {
      const sRes = await syncSocialPlatform(target as SocialPlatform);
      if (sRes.ok) broadcast({ type: "db_changed" });
      return Response.json(
        {
          ok: sRes.ok,
          result: sRes,
          socials: getSocialMetricsOverview(),
          error: sRes.error,
        },
        { status: sRes.ok ? 200 : 502 }
      );
    }

    const res = await syncYouTubeMetrics({ timezone: tz });
    if (res.ok) broadcast({ type: "db_changed" });
    return Response.json(res, { status: res.ok ? 200 : 502 });
  }

  if (req.method === "POST" && url.pathname === "/api/db/metrics/daily-config") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        enabled?: boolean;
        timezone?: string;
      };
      const identity = readSetupIdentity();
      const tz =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : identity.timezone || "UTC";
      const enabled = Boolean(body.enabled);
      const result = await syncDailyMetricsQStashSchedule({ enabled, timezone: tz });
      broadcast({ type: "db_changed" });
      return Response.json({
        ...result,
        state: getYouTubeMetricsWidgetState(tz),
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/db/metrics") {
    try {
      const body = (await req.json()) as {
        recordedAt?: string;
        platform?: string;
        subscribers?: number | null;
        totalViews?: number | null;
        avgCcv?: number | null;
        avgCtr?: number | null;
        notes?: string;
      };
      const metric = addChannelMetric(body || {});
      broadcast({ type: "db_changed" });
      return Response.json({ ok: true, metric });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/db/metrics/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/db/metrics/".length)).trim();
    const deleted = deleteChannelMetric(id);
    if (deleted) broadcast({ type: "db_changed" });
    return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
  }

  return null;
}
