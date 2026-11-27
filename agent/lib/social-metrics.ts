/**
 * Programmatic, zero-LLM, zero-local-API-key social metrics sync for TikTok, Instagram, and X.
 *
 * Auto-discovers connected creator handles from Buffer (with MEMORY.md fallback),
 * pulls 1-item profile snapshots via curated pay-per-event Apify actors,
 * and persists daily snapshots into `channel_metrics` in studio.db alongside YouTube.
 */

import fs from "node:fs";
import path from "node:path";
import { CURATED_APIFY_ACTORS, runCuratedApifyActor } from "./apify.ts";
import { listBufferChannels } from "./buffer.ts";
import {
  getStudioMeta,
  listChannelMetrics,
  setStudioMeta,
  upsertDailyChannelMetric,
  type ChannelMetric,
} from "./studio-db.ts";

export type SocialPlatform = "tiktok" | "instagram" | "x";

const SOCIAL_CACHE_KEY = "social_metrics_cache_v1";

interface CachedPlatformMeta {
  handle: string;
  displayName: string;
  followers: number | null;
  secondaryLabel: string;
  secondaryValue: number | null;
  profileUrl: string;
  studioUrl: string;
  syncedAt: string;
  lastError?: string;
}

type SocialCacheMap = Partial<Record<SocialPlatform, CachedPlatformMeta>>;

export interface SocialPlatformSummary {
  platform: SocialPlatform;
  label: string;
  handle: string;
  displayName: string;
  followers: number | null;
  deltaFollowers: number | null;
  secondaryLabel: string;
  secondaryValue: number | null;
  profileUrl: string;
  studioUrl: string;
  lastSyncedAt: string | null;
  lastError: string;
  sparkline: Array<{ date: string; followers: number | null }>;
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X (Twitter)",
};

async function readCache(): Promise<SocialCacheMap> {
  const raw = await getStudioMeta(SOCIAL_CACHE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SocialCacheMap;
  } catch {
    return {};
  }
}

async function writeCache(map: SocialCacheMap): Promise<void> {
  await setStudioMeta(SOCIAL_CACHE_KEY, JSON.stringify(map));
}

async function patchCache(platform: SocialPlatform, entry: CachedPlatformMeta): Promise<void> {
  const fresh = await readCache();
  fresh[platform] = entry;
  await writeCache(fresh);
}

function cleanHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").split(/[/?#\s]/)[0] ?? "";
}

function parseHandlesFromMemoryMd(): Partial<Record<SocialPlatform, string>> {
  const out: Partial<Record<SocialPlatform, string>> = {};
  try {
    const home = process.env.HOME || "/home/sprite";
    const memPath = path.join(home, ".omp", "agent", "MEMORY.md");
    if (!fs.existsSync(memPath)) return out;
    const text = fs.readFileSync(memPath, "utf8");
    const tt = text.match(/tiktok[^@\n]*@([A-Za-z0-9_.-]+)/i);
    if (tt?.[1]) out.tiktok = tt[1];
    const ig = text.match(/instagram[^@\n]*@([A-Za-z0-9_.-]+)/i);
    if (ig?.[1]) out.instagram = ig[1];
    const tw = text.match(/(?:\bX\b|twitter)[^@\n]*@([A-Za-z0-9_.-]+)/i);
    if (tw?.[1]) out.x = tw[1];
  } catch {
    // ignore
  }
  return out;
}

export async function resolveSocialHandles(): Promise<Partial<Record<SocialPlatform, string>>> {
  const handles = parseHandlesFromMemoryMd();
  try {
    const channels = await listBufferChannels();
    for (const ch of channels) {
      if (ch.isDisconnected) continue;
      const svc = ch.service.toLowerCase();
      const h = cleanHandle(ch.name || ch.displayName || "");
      if (!h) continue;
      if (svc === "tiktok") handles.tiktok = h;
      else if (svc === "instagram") handles.instagram = h;
      else if (svc === "twitter" || svc === "x") handles.x = h;
    }
  } catch {
    // Fallback to MEMORY.md handles if Buffer connector isn't available
  }
  return handles;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function syncSocialPlatform(
  platform: SocialPlatform,
  handleOverride?: string
): Promise<{ ok: boolean; platform: SocialPlatform; metric?: ChannelMetric; error?: string }> {
  const handles = await resolveSocialHandles();
  const handle = cleanHandle(handleOverride || handles[platform] || "");
  if (!handle) {
    return {
      ok: false,
      platform,
      error: `No ${PLATFORM_LABELS[platform]} handle found in Buffer or MEMORY.md.`,
    };
  }

  const nowIso = new Date().toISOString();

  try {
    if (platform === "tiktok") {
      const run = await runCuratedApifyActor<{
        authorMeta?: { name?: string; nickName?: string; fans?: number; heart?: number; video?: number };
      }>(
        CURATED_APIFY_ACTORS.tiktok,
        {
          profiles: [handle],
          resultsPerPage: 1,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
        },
        { limit: 1 }
      );
      const author = run.items[0]?.authorMeta;
      if (!author) throw new Error(`TikTok profile @${handle} returned no profile metadata.`);
      const followers = typeof author.fans === "number" ? author.fans : null;
      const totalLikes = typeof author.heart === "number" ? author.heart : null;
      const videoCount = typeof author.video === "number" ? author.video : null;
      const metric = await upsertDailyChannelMetric({
        recordedAt: todayDateStr(),
        platform: "tiktok",
        subscribers: followers,
        totalViews: totalLikes,
        notes: `Auto-sync @${handle}${videoCount !== null ? ` · ${videoCount} videos` : ""}`,
      });
      await patchCache("tiktok", {
        handle,
        displayName: author.nickName || `@${handle}`,
        followers,
        secondaryLabel: "Total likes",
        secondaryValue: totalLikes,
        profileUrl: `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
        studioUrl: "https://www.tiktok.com/tiktokstudio/analytics",
        syncedAt: nowIso,
      });
      return { ok: true, platform, metric };
    }

    if (platform === "instagram") {
      const run = await runCuratedApifyActor<{
        username?: string;
        fullName?: string;
        followersCount?: number;
        followsCount?: number;
        postsCount?: number;
      }>(
        CURATED_APIFY_ACTORS.instagram,
        {
          directUrls: [`https://www.instagram.com/${encodeURIComponent(handle)}/`],
          resultsType: "details",
          resultsLimit: 1,
        },
        { limit: 1 }
      );
      const p = run.items[0];
      if (!p) throw new Error(`Instagram profile @${handle} returned no profile details.`);
      const followers = typeof p.followersCount === "number" ? p.followersCount : null;
      const postsCount = typeof p.postsCount === "number" ? p.postsCount : null;
      const metric = await upsertDailyChannelMetric({
        recordedAt: todayDateStr(),
        platform: "instagram",
        subscribers: followers,
        totalViews: postsCount,
        notes: `Auto-sync @${handle}${postsCount !== null ? ` · ${postsCount} posts` : ""}`,
      });
      await patchCache("instagram", {
        handle,
        displayName: p.fullName || `@${handle}`,
        followers,
        secondaryLabel: "Posts",
        secondaryValue: postsCount,
        profileUrl: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        studioUrl: "https://www.instagram.com/accounts/insights/",
        syncedAt: nowIso,
      });
      return { ok: true, platform, metric };
    }

    // X / Twitter
    const run = await runCuratedApifyActor<{
      author?: {
        userName?: string;
        name?: string;
        followers?: number;
        statusesCount?: number;
        favouritesCount?: number;
      };
      viewCount?: number;
    }>(
      CURATED_APIFY_ACTORS.x,
      {
        searchTerms: [`from:${handle}`],
        maxItems: 1,
      },
      { limit: 1 }
    );
    const author = run.items[0]?.author;
    if (!author) throw new Error(`X profile @${handle} returned no recent posts/author data.`);
    const followers = typeof author.followers === "number" ? author.followers : null;
    const postsCount = typeof author.statusesCount === "number" ? author.statusesCount : null;
    const metric = await upsertDailyChannelMetric({
      recordedAt: todayDateStr(),
      platform: "x",
      subscribers: followers,
      totalViews: postsCount,
      notes: `Auto-sync @${handle}${postsCount !== null ? ` · ${postsCount} posts` : ""}`,
    });
    await patchCache("x", {
      handle,
      displayName: author.name || `@${handle}`,
      followers,
      secondaryLabel: "Posts",
      secondaryValue: postsCount,
      profileUrl: `https://x.com/${encodeURIComponent(handle)}`,
      studioUrl: "https://analytics.x.com/",
      syncedAt: nowIso,
    });
    return { ok: true, platform, metric };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prev = (await readCache())[platform];
    await patchCache(platform, {
      handle,
      displayName: prev?.displayName || `@${handle}`,
      followers: prev?.followers ?? null,
      secondaryLabel:
        prev?.secondaryLabel || (platform === "tiktok" ? "Total likes" : "Posts"),
      secondaryValue: prev?.secondaryValue ?? null,
      profileUrl:
        prev?.profileUrl ||
        (platform === "tiktok"
          ? `https://www.tiktok.com/@${encodeURIComponent(handle)}`
          : platform === "instagram"
            ? `https://www.instagram.com/${encodeURIComponent(handle)}/`
            : `https://x.com/${encodeURIComponent(handle)}`),
      studioUrl:
        prev?.studioUrl ||
        (platform === "tiktok"
          ? "https://www.tiktok.com/tiktokstudio/analytics"
          : platform === "instagram"
            ? "https://www.instagram.com/accounts/insights/"
            : "https://analytics.x.com/"),
      syncedAt: prev?.syncedAt || "",
      lastError: message,
    });
    return { ok: false, platform, error: message };
  }
}

export async function syncAllSocialMetrics(): Promise<
  Array<{ ok: boolean; platform: SocialPlatform; metric?: ChannelMetric; error?: string }>
> {
  if (socialSyncInFlight) return socialSyncInFlight;
  const platforms: SocialPlatform[] = ["tiktok", "instagram", "x"];
  socialSyncInFlight = Promise.all(platforms.map((p) => syncSocialPlatform(p))).finally(() => {
    socialSyncInFlight = null;
  });
  return socialSyncInFlight;
}

const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours (matches YouTube widget throttle)
let socialSyncInFlight: Promise<
  Array<{ ok: boolean; platform: SocialPlatform; metric?: ChannelMetric; error?: string }>
> | null = null;

export async function shouldAutoSyncSocialMetrics(): Promise<boolean> {
  if (socialSyncInFlight) return false;
  const cache = await readCache();
  const platforms: SocialPlatform[] = ["tiktok", "instagram", "x"];
  const now = Date.now();
  // Trigger auto-sync if any platform has never synced or is older than 6 hours
  return platforms.some((p) => {
    const syncedAt = cache[p]?.syncedAt;
    if (!syncedAt) return true;
    const ts = Date.parse(syncedAt);
    return Number.isNaN(ts) || now - ts >= AUTO_SYNC_INTERVAL_MS;
  });
}

export async function getSocialMetricsOverview(): Promise<SocialPlatformSummary[]> {
  const [cache, allMetrics] = await Promise.all([readCache(), listChannelMetrics(120)]);
  const platforms: SocialPlatform[] = ["tiktok", "instagram", "x"];

  return platforms.map((platform) => {
    const rows = allMetrics
      .filter((m) => m.platform.toLowerCase() === platform)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const latest = rows[rows.length - 1] ?? null;
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
    const c = cache[platform];
    const followers = latest?.subscribers ?? c?.followers ?? null;
    const deltaFollowers =
      latest?.subscribers !== null &&
      latest?.subscribers !== undefined &&
      prev?.subscribers !== null &&
      prev?.subscribers !== undefined
        ? latest.subscribers - prev.subscribers
        : null;

    return {
      platform,
      label: PLATFORM_LABELS[platform],
      handle: c?.handle || "",
      displayName: c?.displayName || (c?.handle ? `@${c.handle}` : PLATFORM_LABELS[platform]),
      followers,
      deltaFollowers,
      secondaryLabel: c?.secondaryLabel || (platform === "tiktok" ? "Total likes" : "Posts"),
      secondaryValue: latest?.totalViews ?? c?.secondaryValue ?? null,
      profileUrl: c?.profileUrl || "",
      studioUrl:
        c?.studioUrl ||
        (platform === "tiktok"
          ? "https://www.tiktok.com/tiktokstudio/analytics"
          : platform === "instagram"
            ? "https://www.instagram.com/accounts/insights/"
            : "https://analytics.x.com/"),
      lastSyncedAt: c?.syncedAt || latest?.createdAt || null,
      lastError: c?.lastError || "",
      sparkline: rows.slice(-14).map((r) => ({
        date: r.recordedAt,
        followers: r.subscribers,
      })),
    };
  });
}
