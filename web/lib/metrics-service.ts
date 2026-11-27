import {
  getSocialMetricsOverview,
  shouldAutoSyncSocialMetrics,
  syncAllSocialMetrics,
  syncSocialPlatform,
  type SocialPlatform,
} from "../../agent/lib/social-metrics.ts";
import {
  shouldAutoSyncYouTubeMetrics,
  syncYouTubeMetrics,
} from "../../agent/lib/youtube-metrics.ts";
import { readSetupIdentity } from "./identity.ts";
import { broadcast } from "./sse.ts";

export function resolveTimezone(): string {
  return readSetupIdentity().timezone || "UTC";
}

export async function syncAllMetrics(timezone = resolveTimezone()) {
  const [ytRes, socialRes] = await Promise.all([
    syncYouTubeMetrics({ timezone }),
    syncAllSocialMetrics(),
  ]);
  const anyOk = ytRes.ok || socialRes.some((r) => r.ok);
  if (anyOk) broadcast({ type: "db_changed" });
  return { ytRes, socialRes, anyOk };
}

export async function syncMetricsForPlatform(
  platform: string,
  timezone = resolveTimezone()
) {
  const target = platform.toLowerCase();
  if (target === "all") {
    const { ytRes, socialRes, anyOk } = await syncAllMetrics(timezone);
    return {
      ok: anyOk,
      status: anyOk ? 200 : 502,
      body: {
        ok: anyOk,
        state: ytRes.state,
        socials: await getSocialMetricsOverview(),
        results: {
          youtube: { ok: ytRes.ok, error: ytRes.error },
          ...Object.fromEntries(socialRes.map((r) => [r.platform, { ok: r.ok, error: r.error }])),
        },
      },
    };
  }

  if (target === "tiktok" || target === "instagram" || target === "x") {
    const sRes = await syncSocialPlatform(target as SocialPlatform);
    if (sRes.ok) broadcast({ type: "db_changed" });
    return {
      ok: sRes.ok,
      status: sRes.ok ? 200 : 502,
      body: {
        ok: sRes.ok,
        result: sRes,
        socials: await getSocialMetricsOverview(),
        error: sRes.error,
      },
    };
  }

  const res = await syncYouTubeMetrics({ timezone });
  if (res.ok) broadcast({ type: "db_changed" });
  return {
    ok: res.ok,
    status: res.ok ? 200 : 502,
    body: res,
  };
}

export async function triggerAutoSyncMetricsIfNeeded(timezone = resolveTimezone()): Promise<boolean> {
  let autoSyncStarted = false;
  if (await shouldAutoSyncYouTubeMetrics()) {
    autoSyncStarted = true;
    void syncYouTubeMetrics({ timezone }).then((res) => {
      if (res.ok) broadcast({ type: "db_changed" });
    });
  }
  if (await shouldAutoSyncSocialMetrics()) {
    autoSyncStarted = true;
    void syncAllSocialMetrics()
      .then((results) => {
        if (results.some((r) => r.ok)) broadcast({ type: "db_changed" });
      })
      .catch(() => {});
  }
  return autoSyncStarted;
}
