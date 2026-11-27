/**
 * Deterministic, zero-LLM, zero-local-API-key YouTube channel metrics sync.
 * Uses Composio v3 Sprites Connector (YOUTUBE_GET_CHANNEL_STATISTICS, YOUTUBE_VIDEO_DETAILS)
 * + keyless yt-dlp (--flat-playlist) for latest stream/video pulse, persisting daily snapshots
 * into `channel_metrics` in studio.db as the single source of truth.
 */

import fs from "node:fs";
import path from "node:path";
import {
  deleteStudioMeta,
  getStudioMeta,
  listChannelMetrics,
  setStudioMeta,
  upsertDailyChannelMetric,
  type ChannelMetric,
} from "./studio-db.ts";
import {
  buildMidnightCronForTimezone,
  extractIanaTimezone,
  resolveQStashGatewayUrl,
} from "./qstash-cron.ts";

interface ComposioContext {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

export interface LatestVideoPulse {
  id: string;
  title: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null;
  durationSec: number | null;
  liveStatus: string | null;
  vsAvgPct: number | null;
}

export interface YouTubeWidgetCache {
  channelId: string;
  channelTitle: string;
  subscribers: number | null;
  totalViews: number | null;
  videoCount: number | null;
  avgViewsRecent: number | null;
  liveState: "live" | "upcoming" | "offline";
  daysSinceLast: number | null;
  latestVideo: LatestVideoPulse | null;
  syncedAt: string;
}

export interface YouTubeMetricsWidgetState {
  connected: boolean;
  lastSyncedAt: string | null;
  channelId: string | null;
  channelTitle: string;
  subscribers: number | null;
  totalViews: number | null;
  videoCount: number | null;
  deltaSubs: number | null;
  deltaViews: number | null;
  avgViewsRecent: number | null;
  liveState: "live" | "upcoming" | "offline";
  daysSinceLast: number | null;
  latestVideo: LatestVideoPulse | null;
  sparkline: Array<{ date: string; subscribers: number | null; totalViews: number | null }>;
  dailySync: {
    enabled: boolean;
    timezone: string;
    cron: string | null;
    scheduleId: string | null;
  };
}

let cachedComposio: ComposioContext | null = null;
let syncInFlight: Promise<{ ok: boolean; state: YouTubeMetricsWidgetState; metric?: ChannelMetric; error?: string }> | null = null;

function findYtDlpBin(): string {
  const home = process.env.HOME || "/home/sprite";
  const local = path.join(home, ".local", "bin", "yt-dlp");
  if (fs.existsSync(local)) return local;
  return "yt-dlp";
}

async function getComposioYouTubeContext(): Promise<ComposioContext> {
  if (cachedComposio) return cachedComposio;

  let baseUrl = process.env.SPRITES_COMPOSIO_GATEWAY_URL?.trim().replace(/\/$/, "") || "";
  if (!baseUrl) {
    const gwRes = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(8000),
    });
    if (!gwRes.ok) {
      throw new Error(`Sprites gateway/list failed (${gwRes.status})`);
    }
    const gwData = (await gwRes.json()) as {
      connections?: Array<{
        provider: string;
        display_name?: string;
        gateway_base_url: string;
      }>;
    };
    const conn = gwData.connections?.find(
      (c) =>
        c.provider === "composio" ||
        (c.provider === "custom_api" && /composio/i.test(c.display_name ?? ""))
    );
    if (!conn) {
      throw new Error("Composio Sprites Connector not connected.");
    }
    baseUrl = conn.gateway_base_url.replace(/\/$/, "");
  }

  const accRes = await fetch(`${baseUrl}/api/v3/connected_accounts?limit=50`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!accRes.ok) {
    throw new Error(`Composio connected_accounts failed (${accRes.status})`);
  }
  const accData = (await accRes.json()) as {
    items?: Array<{
      id: string;
      status: string;
      user_id: string;
      toolkit?: { slug?: string };
    }>;
  };
  const yt = accData.items?.find(
    (a) => a.toolkit?.slug?.toLowerCase() === "youtube" && a.status === "ACTIVE"
  );
  if (!yt) {
    throw new Error("No active YouTube account connected in Composio.");
  }

  cachedComposio = {
    baseUrl,
    connectedAccountId: yt.id,
    userId: yt.user_id,
  };
  return cachedComposio;
}

async function execComposioYouTube(
  ctx: ComposioContext,
  slug: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connected_account_id: ctx.connectedAccountId,
      user_id: ctx.userId,
      arguments: args,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Composio ${slug} failed (${res.status}): ${err.slice(0, 140)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function parseIsoDurationSec(iso: string | undefined): number | null {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return null;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

function toFiniteInt(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function todayDateInTimezone(timezone?: string): string {
  try {
    const tz = timezone ? extractIanaTimezone(timezone) : "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback to UTC ISO date
  }
  return new Date().toISOString().slice(0, 10);
}

interface FlatYtDlpEntry {
  id?: string;
  title?: string;
  view_count?: number;
  duration?: number;
  live_status?: string;
}

async function fetchRecentEntriesViaYtDlp(channelId: string): Promise<FlatYtDlpEntry[]> {
  const bin = findYtDlpBin();
  const tryTab = async (tab: "streams" | "videos"): Promise<FlatYtDlpEntry[]> => {
    try {
      const proc = Bun.spawn(
        [
          bin,
          "--flat-playlist",
          "--playlist-end",
          "5",
          "--dump-json",
          `https://www.youtube.com/channel/${channelId}/${tab}`,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      }, 12_000);
      const [exitCode, stdout] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text().catch(() => ""),
      ]);
      clearTimeout(timer);
      if (exitCode !== 0 || !stdout.trim()) return [];
      const entries: FlatYtDlpEntry[] = [];
      for (const line of stdout.trim().split("\n")) {
        try {
          const parsed = JSON.parse(line) as FlatYtDlpEntry;
          if (parsed && parsed.id) entries.push(parsed);
        } catch {
          // ignore malformed line
        }
      }
      return entries;
    } catch {
      return [];
    }
  };

  const streams = await tryTab("streams");
  if (streams.length > 0) return streams;
  return await tryTab("videos");
}

async function resolveChannelId(ctx: ComposioContext): Promise<{ channelId: string; channelTitle: string }> {
  const cachedId = getStudioMeta("yt_channel_id");
  const cachedTitle = getStudioMeta("yt_channel_title") || "";
  if (cachedId) {
    return { channelId: cachedId, channelTitle: cachedTitle };
  }

  const pls = await execComposioYouTube(ctx, "YOUTUBE_LIST_USER_PLAYLISTS", {});
  const data = (pls.data || {}) as Record<string, unknown>;
  const respData = (data.response_data || data) as Record<string, unknown>;
  const items = Array.isArray(respData.items) ? respData.items : [];
  const first = items[0] as { snippet?: { channelId?: string; channelTitle?: string } } | undefined;
  const channelId = first?.snippet?.channelId?.trim() || "";
  const channelTitle = first?.snippet?.channelTitle?.trim() || "";
  if (!channelId) {
    throw new Error("Could not resolve YouTube channel ID from connected account playlists.");
  }
  setStudioMeta("yt_channel_id", channelId);
  if (channelTitle) setStudioMeta("yt_channel_title", channelTitle);
  return { channelId, channelTitle };
}

export function getYouTubeDailyConfig(fallbackTimezone = "UTC") {
  return {
    enabled: getStudioMeta("yt_daily_enabled") === "1",
    timezone: getStudioMeta("yt_daily_timezone") || fallbackTimezone || "UTC",
    cron: getStudioMeta("yt_daily_cron"),
    scheduleId: getStudioMeta("yt_daily_qstash_schedule_id"),
  };
}

export function getYouTubeMetricsWidgetState(fallbackTimezone = "UTC"): YouTubeMetricsWidgetState {
  const metrics = listChannelMetrics(30).filter((m) => m.platform === "youtube");
  const latestRow = metrics[0] ?? null;
  const prevRow = metrics[1] ?? null;

  let cache: YouTubeWidgetCache | null = null;
  const rawCache = getStudioMeta("yt_widget_cache");
  if (rawCache) {
    try {
      cache = JSON.parse(rawCache) as YouTubeWidgetCache;
    } catch {
      cache = null;
    }
  }

  const subscribers = latestRow?.subscribers ?? cache?.subscribers ?? null;
  const totalViews = latestRow?.totalViews ?? cache?.totalViews ?? null;
  const deltaSubs =
    latestRow?.subscribers !== null &&
    latestRow?.subscribers !== undefined &&
    prevRow?.subscribers !== null &&
    prevRow?.subscribers !== undefined
      ? latestRow.subscribers - prevRow.subscribers
      : null;
  const deltaViews =
    latestRow?.totalViews !== null &&
    latestRow?.totalViews !== undefined &&
    prevRow?.totalViews !== null &&
    prevRow?.totalViews !== undefined
      ? latestRow.totalViews - prevRow.totalViews
      : null;

  const sparkline = [...metrics]
    .slice(0, 14)
    .reverse()
    .map((m) => ({
      date: m.recordedAt,
      subscribers: m.subscribers,
      totalViews: m.totalViews,
    }));

  const lastSyncedAt = getStudioMeta("yt_metrics_last_sync_at") || cache?.syncedAt || latestRow?.createdAt || null;

  return {
    connected: Boolean(cache?.channelId || getStudioMeta("yt_channel_id") || latestRow),
    lastSyncedAt,
    channelId: cache?.channelId || getStudioMeta("yt_channel_id") || null,
    channelTitle: cache?.channelTitle || getStudioMeta("yt_channel_title") || "",
    subscribers,
    totalViews,
    videoCount: cache?.videoCount ?? null,
    deltaSubs,
    deltaViews,
    avgViewsRecent: cache?.avgViewsRecent ?? null,
    liveState: cache?.liveState ?? "offline",
    daysSinceLast: cache?.daysSinceLast ?? null,
    latestVideo: cache?.latestVideo ?? null,
    sparkline,
    dailySync: getYouTubeDailyConfig(fallbackTimezone),
  };
}

export function shouldAutoSyncYouTubeMetrics(maxAgeMs = 6 * 60 * 60 * 1000): boolean {
  const last = getStudioMeta("yt_metrics_last_sync_at");
  if (!last) return true;
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts >= maxAgeMs;
}

export async function syncYouTubeMetrics(opts?: {
  timezone?: string;
}): Promise<{ ok: boolean; state: YouTubeMetricsWidgetState; metric?: ChannelMetric; error?: string }> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const ctx = await getComposioYouTubeContext();
      const { channelId, channelTitle: resolvedTitle } = await resolveChannelId(ctx);
      let channelTitle = resolvedTitle;

      const statsResp = await execComposioYouTube(ctx, "YOUTUBE_GET_CHANNEL_STATISTICS", {
        id: channelId,
      });
      const statsData = (statsResp.data || {}) as Record<string, unknown>;
      const channels = Array.isArray(statsData.channels)
        ? statsData.channels
        : Array.isArray(statsData.items)
          ? statsData.items
          : [];
      const ch = (channels[0] || {}) as {
        statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
        snippet?: { title?: string };
      };
      if (ch.snippet?.title) {
        channelTitle = ch.snippet.title;
        setStudioMeta("yt_channel_title", channelTitle);
      }

      const subscribers = toFiniteInt(ch.statistics?.subscriberCount);
      const totalViews = toFiniteInt(ch.statistics?.viewCount);
      const videoCount = toFiniteInt(ch.statistics?.videoCount);

      // Pull recent streams/videos via keyless yt-dlp + enrich with YOUTUBE_VIDEO_DETAILS
      const flatEntries = await fetchRecentEntriesViaYtDlp(channelId);
      let liveState: "live" | "upcoming" | "offline" = "offline";
      let latestVideo: LatestVideoPulse | null = null;
      let avgViewsRecent: number | null = null;
      let daysSinceLast: number | null = null;

      if (flatEntries.length > 0) {
        const topStatus = String(flatEntries[0].live_status || "").toLowerCase();
        if (topStatus === "is_live") liveState = "live";
        else if (topStatus === "is_upcoming") liveState = "upcoming";

        const ids = flatEntries.map((e) => e.id).filter((id): id is string => Boolean(id)).slice(0, 5);
        const detailsById = new Map<
          string,
          {
            title?: string;
            views: number | null;
            likes: number | null;
            comments: number | null;
            publishedAt: string | null;
            durationSec: number | null;
          }
        >();

        if (ids.length > 0) {
          try {
            const detResp = await execComposioYouTube(ctx, "YOUTUBE_VIDEO_DETAILS", {
              id: ids.join(","),
            });
            const detData = (detResp.data || {}) as Record<string, unknown>;
            const detRespData = (detData.response_data || detData) as Record<string, unknown>;
            const detItems = Array.isArray(detRespData.items) ? detRespData.items : [];
            for (const rawItem of detItems) {
              const item = rawItem as {
                id?: string;
                snippet?: { title?: string; publishedAt?: string; channelTitle?: string };
                statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
                contentDetails?: { duration?: string };
              };
              if (!item.id) continue;
              if (item.snippet?.channelTitle && !channelTitle) {
                channelTitle = item.snippet.channelTitle;
                setStudioMeta("yt_channel_title", channelTitle);
              }
              detailsById.set(item.id, {
                title: item.snippet?.title,
                views: toFiniteInt(item.statistics?.viewCount),
                likes: toFiniteInt(item.statistics?.likeCount),
                comments: toFiniteInt(item.statistics?.commentCount),
                publishedAt: item.snippet?.publishedAt || null,
                durationSec: parseIsoDurationSec(item.contentDetails?.duration),
              });
            }
          } catch {
            // Fall back to yt-dlp flat-playlist fields cleanly
          }
        }

        const viewNums: number[] = [];
        for (const e of flatEntries) {
          const det = e.id ? detailsById.get(e.id) : undefined;
          const v = det?.views ?? toFiniteInt(e.view_count);
          if (v !== null) viewNums.push(v);
        }
        if (viewNums.length > 0) {
          avgViewsRecent = Math.round(viewNums.reduce((a, b) => a + b, 0) / viewNums.length);
        }

        const first = flatEntries[0];
        const firstDet = first.id ? detailsById.get(first.id) : undefined;
        const firstViews = firstDet?.views ?? toFiniteInt(first.view_count);
        const vsAvgPct =
          firstViews !== null && avgViewsRecent && avgViewsRecent > 0
            ? Math.round(((firstViews - avgViewsRecent) / avgViewsRecent) * 100)
            : null;
        const publishedAt = firstDet?.publishedAt ?? null;
        if (publishedAt) {
          const pubMs = Date.parse(publishedAt);
          if (!Number.isNaN(pubMs)) {
            daysSinceLast = Math.max(0, Math.floor((Date.now() - pubMs) / (24 * 60 * 60 * 1000)));
          }
        }

        latestVideo = {
          id: first.id || "",
          title: firstDet?.title || first.title || "Untitled",
          views: firstViews,
          likes: firstDet?.likes ?? null,
          comments: firstDet?.comments ?? null,
          publishedAt,
          durationSec: firstDet?.durationSec ?? toFiniteInt(first.duration),
          liveStatus: first.live_status || null,
          vsAvgPct,
        };
      }

      const syncedAt = new Date().toISOString();
      const recordedAt = todayDateInTimezone(opts?.timezone);
      const noteParts: string[] = ["Auto-synced (YouTube)"];
      if (videoCount !== null) noteParts.push(`${videoCount} videos`);
      if (avgViewsRecent !== null) noteParts.push(`avg5: ${avgViewsRecent.toLocaleString()}`);

      // Single source of truth: upsert today's snapshot into `channel_metrics`
      const metric = upsertDailyChannelMetric({
        recordedAt,
        platform: "youtube",
        subscribers,
        totalViews,
        notes: noteParts.join(" · "),
      });

      const cache: YouTubeWidgetCache = {
        channelId,
        channelTitle,
        subscribers,
        totalViews,
        videoCount,
        avgViewsRecent,
        liveState,
        daysSinceLast,
        latestVideo,
        syncedAt,
      };
      setStudioMeta("yt_widget_cache", JSON.stringify(cache));
      setStudioMeta("yt_metrics_last_sync_at", syncedAt);

      return {
        ok: true,
        metric,
        state: getYouTubeMetricsWidgetState(opts?.timezone),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: msg,
        state: getYouTubeMetricsWidgetState(opts?.timezone),
      };
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export async function syncDailyMetricsQStashSchedule(opts: {
  enabled: boolean;
  timezone: string;
}): Promise<{
  ok: boolean;
  armed: boolean;
  cron: string | null;
  scheduleId: string | null;
  note?: string;
}> {
  const tz = extractIanaTimezone(opts.timezone || "UTC");
  const cron = buildMidnightCronForTimezone(tz);
  const existingId = getStudioMeta("yt_daily_qstash_schedule_id");
  const existingCron = getStudioMeta("yt_daily_cron");

  setStudioMeta("yt_daily_enabled", opts.enabled ? "1" : "0");
  setStudioMeta("yt_daily_timezone", tz);
  setStudioMeta("yt_daily_cron", cron);

  const gw = await resolveQStashGatewayUrl();
  const publicBase = process.env.LMA_PUBLIC_URL?.trim();

  if (!opts.enabled) {
    if (existingId && gw) {
      await fetch(`${gw}/v2/schedules/${encodeURIComponent(existingId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    deleteStudioMeta("yt_daily_qstash_schedule_id");
    return { ok: true, armed: false, cron, scheduleId: null, note: "Daily metrics snapshot paused." };
  }

  if (existingId && existingCron === cron) {
    return { ok: true, armed: true, cron, scheduleId: existingId, note: `Already armed (${cron}).` };
  }

  if (!gw || !publicBase) {
    return {
      ok: true,
      armed: false,
      cron,
      scheduleId: null,
      note: !gw
        ? "QStash connector not connected yet; preference saved locally."
        : "LMA_PUBLIC_URL not set; preference saved locally.",
    };
  }

  if (existingId) {
    await fetch(`${gw}/v2/schedules/${encodeURIComponent(existingId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
    deleteStudioMeta("yt_daily_qstash_schedule_id");
  }

  const targetUrl = `${publicBase.replace(/\/$/, "")}/api/wakeup`;
  const res = await fetch(`${gw}/v2/schedules/${encodeURIComponent(targetUrl)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Upstash-Cron": cron,
      "Upstash-Retries": "3",
    },
    body: JSON.stringify({
      label: "Daily YouTube Metrics Snapshot",
      mode: "metrics_sync",
      silent: true,
      scheduledAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      armed: false,
      cron,
      scheduleId: null,
      note: `QStash schedule failed (${res.status}): ${errText.slice(0, 160)}`,
    };
  }

  const raw = (await res.json().catch(() => ({}))) as { scheduleId?: string };
  const scheduleId = typeof raw.scheduleId === "string" ? raw.scheduleId : null;
  if (scheduleId) {
    setStudioMeta("yt_daily_qstash_schedule_id", scheduleId);
  }
  return {
    ok: true,
    armed: Boolean(scheduleId),
    cron,
    scheduleId,
    note: `Armed daily YouTube metrics snapshot (${cron}).`,
  };
}
