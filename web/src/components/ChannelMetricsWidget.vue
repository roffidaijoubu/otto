<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RefreshCwIcon } from "@lucide/vue";
import PlatformBrandIcon from "./PlatformBrandIcon.vue";

interface SocialWidgetItem {
  platform: "tiktok" | "instagram" | "x";
  label: string;
  handle: string;
  followers: number | null;
  deltaFollowers: number | null;
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

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  openMetrics: [];
}>();

const state = ref<YouTubeMetricsWidgetState | null>(null);
const socials = ref<SocialWidgetItem[]>([]);
const syncing = ref(false);
const togglingDaily = ref(false);
const errorMsg = ref("");

function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "";
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatCompact(n)}`;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never synced";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.floor(diffMin / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const sparklinePath = computed(() => {
  const pts = (state.value?.sparkline || [])
    .map((p) => p.totalViews ?? p.subscribers)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (pts.length < 2) return "";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const w = 264;
  const h = 28;
  const pad = 2;
  return pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});

async function loadWidget(auto = false) {
  try {
    const [wRes, pRes] = await Promise.all([
      fetch(auto ? "/api/db/metrics/widget?auto=1" : "/api/db/metrics/widget").catch(() => null),
      fetch("/api/db/metrics/platforms").catch(() => null),
    ]);
    if (wRes && wRes.ok) {
      const data = (await wRes.json()) as { state?: YouTubeMetricsWidgetState };
      if (data.state) state.value = data.state;
    }
    if (pRes && pRes.ok) {
      const pData = (await pRes.json()) as { socials?: SocialWidgetItem[] };
      if (Array.isArray(pData.socials)) socials.value = pData.socials;
    }
  } catch {
    // ignore transient network errors
  }
}

async function syncNow() {
  if (syncing.value) return;
  syncing.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/db/metrics/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "all" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      state?: YouTubeMetricsWidgetState;
      socials?: SocialWidgetItem[];
      error?: string;
    };
    if (data.state) state.value = data.state;
    if (Array.isArray(data.socials)) socials.value = data.socials;
    if (!res.ok || data.ok === false) {
      errorMsg.value = data.error || "Sync failed";
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    syncing.value = false;
  }
}

async function toggleDailySync() {
  if (togglingDaily.value || !state.value) return;
  togglingDaily.value = true;
  errorMsg.value = "";
  try {
    const nextEnabled = !state.value.dailySync.enabled;
    const res = await fetch("/api/db/metrics/daily-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      state?: YouTubeMetricsWidgetState;
      error?: string;
    };
    if (data.state) state.value = data.state;
    if (!res.ok && data.error) errorMsg.value = data.error;
  } finally {
    togglingDaily.value = false;
  }
}

onMounted(() => {
  void loadWidget(true);
});

watch(
  () => props.refreshTick,
  () => {
    void loadWidget(false);
  }
);
</script>

<template>
  <aside
    data-os-channel-widget
    class="w-[308px] rounded-[20px] border border-black/8 bg-white/86 shadow-[0_12px_32px_rgba(32,32,32,0.09)] backdrop-blur-md transition-colors hover:bg-white/95"
  >
    <!-- Header strip matching DESIGN.md -->
    <div class="flex items-center justify-between border-b border-[#ededed] px-4 py-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="font-mono text-[11px] text-[#303030]">(Y)our channel.</span>
        <span
          v-if="state?.liveState === 'live'"
          class="rounded-full bg-[#fde8e8] px-1.5 py-px font-mono text-[9.5px] font-semibold text-[#991b1b]"
        >
          LIVE
        </span>
        <span
          v-else-if="state?.liveState === 'upcoming'"
          class="rounded-full bg-[#f9f5a2] px-1.5 py-px font-mono text-[9.5px] font-semibold text-[#854d0e]"
        >
          UPCOMING
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          :disabled="togglingDaily"
          :title="state?.dailySync.enabled ? 'Daily QStash snapshot active (click to pause)' : 'Enable daily QStash snapshot'"
          class="rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors"
          :class="
            state?.dailySync.enabled
              ? 'bg-[#e6f7ee] text-[#166534]'
              : 'bg-[#f2f2f2] text-[#737373] hover:text-[#303030]'
          "
          @click="toggleDailySync"
        >
          {{ state?.dailySync.enabled ? "Daily on" : "Daily off" }}
        </button>
        <button
          type="button"
          :disabled="syncing"
          aria-label="Sync YouTube metrics"
          title="Sync live YouTube metrics"
          class="flex size-6 items-center justify-center rounded-full bg-[#f2f2f2] text-[#303030] transition-colors hover:bg-[#e5e5e5] disabled:opacity-50"
          @click="syncNow"
        >
          <RefreshCwIcon class="size-3" :class="syncing ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="flex flex-col gap-3 px-4 py-3">
      <div v-if="errorMsg" class="rounded-lg bg-[#fde8e8] px-2.5 py-1.5 font-mono text-[10.5px] text-[#991b1b]">
        {{ errorMsg }}
      </div>

      <!-- 3 Core KPIs -->
      <div class="grid grid-cols-3 gap-2">
        <div class="flex flex-col">
          <span class="flex items-center gap-1 font-mono text-[10px] text-[#808080]">
            <PlatformBrandIcon platform="youtube" class="size-3 shrink-0" />
            Subs
          </span>
          <span class="font-mono text-[18px] leading-tight text-[#303030] tabular-nums">
            {{ formatCompact(state?.subscribers) }}
          </span>
          <span
            v-if="formatDelta(state?.deltaSubs)"
            class="font-mono text-[10px]"
            :class="(state?.deltaSubs ?? 0) > 0 ? 'text-[#166534]' : 'text-[#991b1b]'"
          >
            {{ formatDelta(state?.deltaSubs) }}
          </span>
        </div>

        <div class="flex flex-col">
          <span class="font-mono text-[10px] text-[#808080]">Views</span>
          <span class="font-mono text-[18px] leading-tight text-[#303030] tabular-nums">
            {{ formatCompact(state?.totalViews) }}
          </span>
          <span
            v-if="formatDelta(state?.deltaViews)"
            class="font-mono text-[10px]"
            :class="(state?.deltaViews ?? 0) > 0 ? 'text-[#166534]' : 'text-[#991b1b]'"
          >
            {{ formatDelta(state?.deltaViews) }}
          </span>
        </div>

        <div class="flex flex-col">
          <span class="font-mono text-[10px] text-[#808080]">Videos</span>
          <span class="font-mono text-[18px] leading-tight text-[#303030] tabular-nums">
            {{ formatCompact(state?.videoCount) }}
          </span>
          <span v-if="state?.daysSinceLast !== null && state?.daysSinceLast !== undefined" class="font-mono text-[10px] text-[#808080]">
            {{ state.daysSinceLast === 0 ? "today" : `${state.daysSinceLast}d ago` }}
          </span>
        </div>
      </div>

      <!-- Minimal Sparkline (only when >= 2 daily snapshots exist) -->
      <svg
        v-if="sparklinePath"
        viewBox="0 0 264 28"
        class="h-7 w-full overflow-visible"
        aria-hidden="true"
      >
        <path
          :d="sparklinePath"
          fill="none"
          stroke="#303030"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <!-- Latest Stream / Video Pulse -->
      <div
        v-if="state?.latestVideo"
        class="flex flex-col gap-0.5 rounded-[12px] bg-[#f4f4f4] px-2.5 py-2"
      >
        <span class="truncate font-mono text-[11px] font-medium text-[#303030]" :title="state.latestVideo.title">
          {{ state.latestVideo.title }}
        </span>
        <div class="flex items-center justify-between gap-2 font-mono text-[10px] text-[#737373]">
          <span>
            {{ formatCompact(state.latestVideo.views) }} views
            <template v-if="state.latestVideo.likes !== null">
              · {{ formatCompact(state.latestVideo.likes) }} likes
            </template>
          </span>
          <span
            v-if="state.latestVideo.vsAvgPct !== null"
            :class="state.latestVideo.vsAvgPct >= 0 ? 'text-[#166534]' : 'text-[#808080]'"
          >
            {{ state.latestVideo.vsAvgPct >= 0 ? "+" : "" }}{{ state.latestVideo.vsAvgPct }}% avg
          </span>
        </div>
      </div>

      <div v-else-if="!state?.connected" class="font-mono text-[10.5px] text-[#808080]">
        Click refresh to pull live YouTube stats into Studio DB.
      </div>

      <!-- Compact Multi-Platform Social Strip (TikTok, Instagram, X) -->
      <div
        v-if="socials.length > 0"
        class="grid grid-cols-3 gap-1.5 border-t border-[#ededed] pt-2.5"
      >
        <button
          v-for="s in socials"
          :key="s.platform"
          type="button"
          class="flex items-center gap-1.5 rounded-xl bg-[#f4f4f4]/80 px-2 py-1.5 text-left transition-colors hover:bg-[#ececec]"
          :title="`${s.label}${s.handle ? ` (@${s.handle})` : ''} — open Analytics`"
          @click="emit('openMetrics')"
        >
          <PlatformBrandIcon :platform="s.platform" class="size-3.5 shrink-0" />
          <div class="min-w-0">
            <div class="truncate font-mono text-[11.5px] font-semibold leading-tight text-[#303030] tabular-nums">
              {{ formatCompact(s.followers) }}
            </div>
            <div class="truncate font-mono text-[9px] leading-tight text-[#808080]">
              {{ s.platform === "x" ? "X" : s.label }}
            </div>
          </div>
        </button>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t border-[#ededed] pt-2 font-mono text-[10px] text-[#808080]">
        <span>{{ syncing ? "Syncing..." : formatRelativeTime(state?.lastSyncedAt) }}</span>
        <div class="flex items-center gap-2.5">
          <a
            v-if="state?.channelId"
            :href="`https://studio.youtube.com/channel/${encodeURIComponent(state.channelId)}/analytics/tab-overview/period-default`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[#666] underline decoration-black/20 underline-offset-2 hover:text-[#303030] hover:decoration-[#303030]"
          >
            YT Studio ↗
          </a>
          <button
            type="button"
            class="text-[#303030] underline decoration-black/25 underline-offset-2 hover:decoration-[#303030]"
            @click="emit('openMetrics')"
          >
            Analytics
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
