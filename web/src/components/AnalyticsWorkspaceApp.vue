<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BarChart3Icon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { YouTubeMetricsWidgetState } from "./ChannelMetricsWidget.vue";
import PlatformBrandIcon from "./PlatformBrandIcon.vue";
import { renderMarkdown } from "@/lib/markdown";
import { playSound } from "@/lib/sounds";

export interface ChannelMetric {
  id: string;
  recordedAt: string;
  platform: string;
  subscribers: number | null;
  totalViews: number | null;
  avgCcv: number | null;
  avgCtr: number | null;
  notes: string;
  createdAt: string;
}

export interface SocialPlatformSummary {
  platform: "tiktok" | "instagram" | "x";
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

type ActiveTab = "overview" | "youtube" | "tiktok" | "instagram" | "x";

const insightsOpen = ref(false);
const insightsLoading = ref(false);
const insightsMarkdown = ref("");
const insightsError = ref("");
const insightsHtml = computed(() =>
  insightsMarkdown.value.trim() ? renderMarkdown(insightsMarkdown.value) : ""
);

async function runContainedInsights() {
  insightsOpen.value = true;
  if (insightsLoading.value) return;
  insightsLoading.value = true;
  insightsError.value = "";
  try {
    const focus = activeTab.value === "overview" ? "all platforms (YouTube, TikTok, Instagram, X)" : activeTab.value;
    const res = await fetch("/api/analytics/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focusPlatform: focus }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      insights?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Insights failed (${res.status})`);
    }
    insightsMarkdown.value = data.insights || "";
    playSound("complete");
  } catch (err) {
    insightsError.value = err instanceof Error ? err.message : "Could not generate analytics insights";
    playSound("error");
  } finally {
    insightsLoading.value = false;
  }
}

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
}>();

const metrics = ref<ChannelMetric[]>([]);
const widgetState = ref<YouTubeMetricsWidgetState | null>(null);
const socials = ref<SocialPlatformSummary[]>([]);
const activeTab = ref<ActiveTab>("overview");
const loading = ref(false);
const syncingTarget = ref<string | null>(null);
const togglingDaily = ref(false);
const dailyNote = ref("");
const errorMsg = ref("");

const showManualForm = ref(false);
const newPlatform = ref<"youtube" | "tiktok" | "instagram" | "x">("youtube");
const newDate = ref(new Date().toISOString().slice(0, 10));
const newSubs = ref("");
const newViews = ref("");
const newCcv = ref("");
const newCtr = ref("");
const newNotes = ref("");

const studioLinks = computed(() => {
  const chId = widgetState.value?.channelId;
  if (!chId) return null;
  const base = `https://studio.youtube.com/channel/${encodeURIComponent(chId)}`;
  const latestId = widgetState.value?.latestVideo?.id;
  return {
    analytics: `${base}/analytics/tab-overview/period-default`,
    live: `${base}/videos/live`,
    videos: `${base}/videos/upload`,
    latestVideo: latestId
      ? `https://studio.youtube.com/video/${encodeURIComponent(latestId)}/analytics/tab-overview/period-default`
      : null,
  };
});

const socialMap = computed<Record<"tiktok" | "instagram" | "x", SocialPlatformSummary | undefined>>(
  () => ({
    tiktok: socials.value.find((s) => s.platform === "tiktok"),
    instagram: socials.value.find((s) => s.platform === "instagram"),
    x: socials.value.find((s) => s.platform === "x"),
  })
);

const activeSocial = computed<SocialPlatformSummary | null>(() => {
  if (activeTab.value === "tiktok" || activeTab.value === "instagram" || activeTab.value === "x") {
    return socialMap.value[activeTab.value] ?? null;
  }
  return null;
});

const filteredMetrics = computed(() => {
  if (activeTab.value === "overview") return metrics.value;
  return metrics.value.filter((m) => m.platform.toLowerCase() === activeTab.value);
});

const totalAudience = computed(() => {
  const yt = widgetState.value?.subscribers ?? 0;
  const tt = socialMap.value.tiktok?.followers ?? 0;
  const ig = socialMap.value.instagram?.followers ?? 0;
  const x = socialMap.value.x?.followers ?? 0;
  const sum = yt + tt + ig + x;
  return sum > 0 ? sum : null;
});

function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "";
  return `${n > 0 ? "+" : ""}${formatCompact(n)}`;
}

function platformLabel(p: string): string {
  const k = p.toLowerCase();
  if (k === "youtube") return "YouTube";
  if (k === "tiktok") return "TikTok";
  if (k === "instagram") return "Instagram";
  if (k === "x" || k === "twitter") return "X";
  return p;
}

const activeSparklinePath = computed(() => {
  let pts: number[] = [];
  if (activeTab.value === "youtube" || activeTab.value === "overview") {
    pts = (widgetState.value?.sparkline || [])
      .map((p) => p.totalViews ?? p.subscribers)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } else if (activeSocial.value) {
    pts = activeSocial.value.sparkline
      .map((p) => p.followers)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  }
  if (pts.length < 2) return "";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const w = 640;
  const h = 56;
  const pad = 4;
  return pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});

async function fetchAll() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [mRes, wRes, pRes] = await Promise.all([
      fetch("/api/db/metrics?limit=120").then((r) => r.json()).catch(() => null),
      fetch("/api/db/metrics/widget").then((r) => r.json()).catch(() => null),
      fetch("/api/db/metrics/platforms").then((r) => r.json()).catch(() => null),
    ]);
    if (mRes && Array.isArray(mRes.metrics)) metrics.value = mRes.metrics;
    if (wRes && wRes.state) widgetState.value = wRes.state;
    if (pRes && Array.isArray(pRes.socials)) socials.value = pRes.socials;
  } finally {
    loading.value = false;
  }
}

async function syncPlatform(target: "all" | "youtube" | "tiktok" | "instagram" | "x") {
  if (syncingTarget.value) return;
  syncingTarget.value = target;
  errorMsg.value = "";
  dailyNote.value = "";
  try {
    const res = await fetch("/api/db/metrics/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: target }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      state?: YouTubeMetricsWidgetState;
      socials?: SocialPlatformSummary[];
      error?: string;
    };
    if (data.state) widgetState.value = data.state;
    if (Array.isArray(data.socials)) socials.value = data.socials;
    if (!res.ok || data.ok === false) {
      errorMsg.value = data.error || `Sync failed (${target})`;
    }
    await fetchAll();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : `Sync failed (${target})`;
  } finally {
    syncingTarget.value = null;
  }
}

async function toggleDaily() {
  if (togglingDaily.value || !widgetState.value) return;
  togglingDaily.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/db/metrics/daily-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !widgetState.value.dailySync.enabled }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      state?: YouTubeMetricsWidgetState;
      note?: string;
      error?: string;
    };
    if (data.state) widgetState.value = data.state;
    if (data.note) dailyNote.value = data.note;
    if (!res.ok && data.error) {
      errorMsg.value = data.error;
      playSound("error");
    } else if (res.ok) {
      playSound("toggle");
    }
  } finally {
    togglingDaily.value = false;
  }
}

async function addManualMetric() {
  const numOrNull = (v: string) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  await fetch("/api/db/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordedAt: newDate.value,
      platform: activeTab.value === "overview" ? newPlatform.value : activeTab.value,
      subscribers: numOrNull(newSubs.value),
      totalViews: numOrNull(newViews.value),
      avgCcv: numOrNull(newCcv.value),
      avgCtr: numOrNull(newCtr.value),
      notes: newNotes.value.trim(),
    }),
  });
  newSubs.value = "";
  newViews.value = "";
  newCcv.value = "";
  newCtr.value = "";
  newNotes.value = "";
  showManualForm.value = false;
  await fetchAll();
}

async function removeMetric(id: string) {
  const res = await fetch(`/api/db/metrics/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.ok) playSound("delete");
  await fetchAll();
}

watch(
  () => props.refreshTick,
  () => {
    void fetchAll();
  },
  { immediate: true }
);

defineExpose({ fetchAll });
</script>

<template>
  <div class="flex h-full min-h-0 bg-white text-[#171717]">
    <!-- Left Native Sidebar -->
    <aside class="hidden w-[216px] shrink-0 flex-col border-r border-black/8 bg-[#FAF9F6] sm:flex">
      <div class="flex-1 overflow-y-auto p-2.5">
        <!-- Overview Item -->
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors"
          :class="
            activeTab === 'overview'
              ? 'bg-[#171717] text-white'
              : 'text-neutral-700 hover:bg-black/5'
          "
          @click="activeTab = 'overview'"
        >
          <span class="flex items-center gap-2">
            <BarChart3Icon class="size-3.5 shrink-0" />
            <span>Overview</span>
          </span>
          <span
            v-if="totalAudience"
            class="font-mono text-[10.5px] tabular-nums"
            :class="activeTab === 'overview' ? 'text-white/75' : 'text-neutral-400'"
          >
            {{ formatCompact(totalAudience) }}
          </span>
        </button>

        <div class="mt-4 mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          Channels
        </div>

        <div class="flex flex-col gap-0.5">
          <!-- YouTube -->
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors"
            :class="
              activeTab === 'youtube'
                ? 'bg-[#171717] text-white'
                : 'text-neutral-700 hover:bg-black/5'
            "
            @click="activeTab = 'youtube'"
          >
            <span class="flex items-center gap-2">
              <PlatformBrandIcon platform="youtube" class="size-3.5 shrink-0" />
              <span>YouTube</span>
            </span>
            <span
              class="font-mono text-[11px] tabular-nums"
              :class="activeTab === 'youtube' ? 'text-white/80' : 'text-neutral-500'"
            >
              {{ formatCompact(widgetState?.subscribers) }}
            </span>
          </button>

          <!-- TikTok, Instagram, X -->
          <button
            v-for="key in (['tiktok', 'instagram', 'x'] as const)"
            :key="key"
            type="button"
            class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors"
            :class="
              activeTab === key
                ? 'bg-[#171717] text-white'
                : 'text-neutral-700 hover:bg-black/5'
            "
            @click="activeTab = key"
          >
            <span class="flex items-center gap-2">
              <PlatformBrandIcon :platform="key" class="size-3.5 shrink-0" />
              <span>{{ platformLabel(key) }}</span>
            </span>
            <span
              class="font-mono text-[11px] tabular-nums"
              :class="activeTab === key ? 'text-white/80' : 'text-neutral-500'"
            >
              {{ formatCompact(socialMap[key]?.followers) }}
            </span>
          </button>
        </div>
      </div>

      <!-- Sidebar Footer: Daily Toggle + Analyze with Otto -->
      <div class="flex flex-col gap-1.5 border-t border-black/8 p-2.5">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          :disabled="togglingDaily"
          @click="toggleDaily"
        >
          <span>Daily Snapshot</span>
          <span
            class="rounded-full px-1.5 py-0.5 font-mono text-[10px]"
            :class="
              widgetState?.dailySync.enabled
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-neutral-100 text-neutral-500'
            "
          >
            {{ widgetState?.dailySync.enabled ? "On" : "Off" }}
          </span>
        </button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 w-full justify-start gap-1.5 rounded-lg bg-white text-[11px] font-medium"
          :disabled="insightsLoading"
          @click="runContainedInsights"
        >
          <SparklesIcon class="size-3.5 shrink-0" />
          <span>{{ insightsLoading ? "Analyzing…" : "AI Growth Insights" }}</span>
        </Button>
      </div>
    </aside>

    <!-- Right Main Stage -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <!-- Slim Native Top Toolbar -->
      <header class="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-black/8 px-4">
        <div class="flex min-w-0 items-center gap-2">
          <PlatformBrandIcon
            v-if="activeTab !== 'overview'"
            :platform="activeTab"
            class="size-4 shrink-0"
          />
          <h2 class="truncate text-xs font-semibold text-[#171717]">
            {{ activeTab === "overview" ? "All Platforms" : platformLabel(activeTab) }}
          </h2>
          <span
            v-if="activeSocial?.handle"
            class="truncate font-mono text-[11px] text-neutral-400"
          >
            @{{ activeSocial.handle }}
          </span>
          <span
            v-else-if="activeTab === 'youtube' && widgetState?.channelTitle"
            class="truncate font-mono text-[11px] text-neutral-400"
          >
            {{ widgetState.channelTitle }}
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <!-- Context-aware Studio / Insights Links -->
          <template v-if="(activeTab === 'overview' || activeTab === 'youtube') && studioLinks">
            <a
              :href="studioLinks.analytics"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
            >
              <span>YouTube Studio</span>
              <ExternalLinkIcon class="size-3" />
            </a>
            <a
              v-if="activeTab === 'youtube'"
              :href="studioLinks.live"
              target="_blank"
              rel="noopener noreferrer"
              class="hidden h-7 items-center rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50 md:inline-flex"
            >
              Live Control
            </a>
          </template>
          <template v-else-if="activeSocial">
            <a
              :href="activeSocial.studioUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
            >
              <span>Insights</span>
              <ExternalLinkIcon class="size-3" />
            </a>
            <a
              v-if="activeSocial.profileUrl"
              :href="activeSocial.profileUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="hidden h-7 items-center rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50 md:inline-flex"
            >
              Profile ↗
            </a>
          </template>

          <Button
            type="button"
            size="xs"
            class="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
            :disabled="Boolean(syncingTarget)"
            @click="syncPlatform(activeTab === 'overview' ? 'all' : activeTab)"
          >
            <RefreshCwIcon class="size-3" :class="syncingTarget ? 'animate-spin' : ''" />
            <span>
              {{
                syncingTarget
                  ? "Syncing..."
                  : activeTab === "overview"
                    ? "Sync All"
                    : `Sync ${platformLabel(activeTab)}`
              }}
            </span>
          </Button>
        </div>
      </header>

      <!-- Mobile Tab Strip (when sidebar hidden) -->
      <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-black/8 bg-[#FAF9F6] px-3 py-1.5 sm:hidden">
        <button
          v-for="tab in (['overview', 'youtube', 'tiktok', 'instagram', 'x'] as const)"
          :key="tab"
          type="button"
          class="rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap"
          :class="activeTab === tab ? 'bg-[#171717] text-white' : 'text-neutral-600'"
          @click="activeTab = tab"
        >
          {{ tab === "overview" ? "All" : platformLabel(tab) }}
        </button>
      </div>

      <!-- Scrollable Full-Bleed Content -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-if="errorMsg"
          class="border-b border-red-200 bg-red-50 px-4 py-2 font-mono text-xs text-red-700"
        >
          {{ errorMsg }}
        </div>
        <div
          v-if="dailyNote"
          class="border-b border-black/6 bg-[#FAF9F6] px-4 py-1.5 font-mono text-[11px] text-neutral-600"
        >
          {{ dailyNote }}
        </div>

        <!-- Contained AI Growth Insights Panel (Isolated OMP Worker) -->
        <div
          v-if="insightsOpen"
          class="border-b border-black/10 bg-[#FAF9F6] px-4 py-3.5"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <SparklesIcon class="size-3.5 text-[#171717]" />
              <span class="font-mono text-xs font-semibold text-[#171717]">AI Growth Insights</span>
              <span class="rounded-full border border-black/10 bg-white px-2 py-0.5 font-mono text-[10px] text-neutral-500">
                isolated worker
              </span>
            </div>
            <div class="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                class="h-6 bg-white px-2 text-[11px]"
                :disabled="insightsLoading"
                @click="runContainedInsights"
              >
                <RefreshCwIcon class="size-3" :class="insightsLoading ? 'animate-spin' : ''" />
                Refresh
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                class="size-6"
                @click="insightsOpen = false"
              >
                <XIcon class="size-3.5" />
              </Button>
            </div>
          </div>

          <div v-if="insightsLoading" class="font-mono text-xs text-neutral-500 py-2">
            Analyzing your multi-platform metrics history…
          </div>
          <div v-else-if="insightsError" class="rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
            {{ insightsError }}
          </div>
          <div
            v-else-if="insightsHtml"
            class="prose-sm max-w-none text-xs leading-relaxed text-[#171717] [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_strong]:font-semibold"
            v-html="insightsHtml"
          />
        </div>

        <!-- ==================== OVERVIEW VIEW ==================== -->
        <template v-if="activeTab === 'overview'">
          <!-- Full-Bleed 4-Column Platform Strip (Hairline Dividers, Zero Floating Cards) -->
          <div class="grid grid-cols-2 border-b border-black/8 lg:grid-cols-4">
            <!-- YouTube Cell -->
            <div
              class="flex cursor-pointer flex-col gap-2 border-r border-b border-black/8 p-4 transition-colors hover:bg-[#FAF9F6] lg:border-b-0"
              @click="activeTab = 'youtube'"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <PlatformBrandIcon platform="youtube" class="size-4 shrink-0" />
                  <span class="text-xs font-semibold text-[#171717]">YouTube</span>
                </div>
                <button
                  type="button"
                  class="rounded-md p-1 text-neutral-400 hover:bg-black/5 hover:text-[#171717]"
                  title="Sync YouTube"
                  @click.stop="syncPlatform('youtube')"
                >
                  <RefreshCwIcon class="size-3" :class="syncingTarget === 'youtube' ? 'animate-spin' : ''" />
                </button>
              </div>
              <div class="font-mono text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
                {{ formatCompact(widgetState?.subscribers) }}
              </div>
              <div class="flex items-center justify-between font-mono text-[11px] text-neutral-500">
                <span>{{ formatCompact(widgetState?.totalViews) }} views</span>
                <span
                  v-if="formatDelta(widgetState?.deltaSubs)"
                  :class="(widgetState?.deltaSubs ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'"
                >
                  {{ formatDelta(widgetState?.deltaSubs) }}
                </span>
              </div>
            </div>

            <!-- TikTok, Instagram, X Cells -->
            <div
              v-for="(key, idx) in (['tiktok', 'instagram', 'x'] as const)"
              :key="key"
              class="flex cursor-pointer flex-col gap-2 border-b border-black/8 p-4 transition-colors hover:bg-[#FAF9F6] lg:border-b-0"
              :class="idx < 2 ? 'lg:border-r' : ''"
              @click="activeTab = key"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <PlatformBrandIcon :platform="key" class="size-4 shrink-0" />
                  <span class="truncate text-xs font-semibold text-[#171717]">
                    {{ platformLabel(key) }}
                  </span>
                </div>
                <button
                  type="button"
                  class="rounded-md p-1 text-neutral-400 hover:bg-black/5 hover:text-[#171717]"
                  :title="`Sync ${platformLabel(key)}`"
                  @click.stop="syncPlatform(key)"
                >
                  <RefreshCwIcon class="size-3" :class="syncingTarget === key ? 'animate-spin' : ''" />
                </button>
              </div>
              <div class="font-mono text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
                {{ formatCompact(socialMap[key]?.followers) }}
              </div>
              <div class="flex items-center justify-between font-mono text-[11px] text-neutral-500">
                <span>
                  {{ formatCompact(socialMap[key]?.secondaryValue) }}
                  {{ (socialMap[key]?.secondaryLabel || "").toLowerCase() }}
                </span>
                <span
                  v-if="formatDelta(socialMap[key]?.deltaFollowers)"
                  :class="(socialMap[key]?.deltaFollowers ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'"
                >
                  {{ formatDelta(socialMap[key]?.deltaFollowers) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Latest YouTube Stream Pulse Strip -->
          <div
            v-if="widgetState?.latestVideo"
            class="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 bg-[#FAF9F6]/70 px-4 py-2.5"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2.5">
              <PlatformBrandIcon platform="youtube" class="size-4 shrink-0" />
              <div class="min-w-0">
                <div class="truncate text-xs font-semibold text-[#171717]">
                  {{ widgetState.latestVideo.title }}
                </div>
                <div class="font-mono text-[11px] text-neutral-500">
                  {{ formatCompact(widgetState.latestVideo.views) }} views
                  <template v-if="widgetState.latestVideo.likes !== null">
                    · {{ formatCompact(widgetState.latestVideo.likes) }} likes
                  </template>
                  <template v-if="widgetState.latestVideo.vsAvgPct !== null">
                    · {{ widgetState.latestVideo.vsAvgPct >= 0 ? "+" : "" }}{{ widgetState.latestVideo.vsAvgPct }}% vs avg
                  </template>
                </div>
              </div>
            </div>

            <div v-if="studioLinks" class="flex items-center gap-1.5">
              <a
                v-if="studioLinks.latestVideo"
                :href="studioLinks.latestVideo"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
              >
                <span>Latest Video Stats</span>
                <ExternalLinkIcon class="size-3" />
              </a>
              <a
                :href="studioLinks.live"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 no-underline hover:bg-neutral-50"
              >
                Live Control
              </a>
            </div>
          </div>
        </template>

        <!-- ==================== SINGLE PLATFORM VIEW ==================== -->
        <template v-else-if="activeTab === 'youtube'">
          <div class="grid grid-cols-2 border-b border-black/8 sm:grid-cols-4">
            <div class="border-r border-b border-black/8 p-4 sm:border-b-0">
              <div class="font-mono text-[10.5px] text-neutral-500">Subscribers</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(widgetState?.subscribers) }}
              </div>
              <div
                v-if="formatDelta(widgetState?.deltaSubs)"
                class="font-mono text-[11px]"
                :class="(widgetState?.deltaSubs ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'"
              >
                {{ formatDelta(widgetState?.deltaSubs) }} vs prev
              </div>
            </div>
            <div class="border-b border-black/8 p-4 sm:border-r sm:border-b-0">
              <div class="font-mono text-[10.5px] text-neutral-500">Total views</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(widgetState?.totalViews) }}
              </div>
            </div>
            <div class="border-r border-black/8 p-4">
              <div class="font-mono text-[10.5px] text-neutral-500">Uploads</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(widgetState?.videoCount) }}
              </div>
            </div>
            <div class="p-4">
              <div class="font-mono text-[10.5px] text-neutral-500">Avg last 5</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(widgetState?.avgViewsRecent) }}
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="activeSocial">
          <div class="grid grid-cols-2 border-b border-black/8 sm:grid-cols-3">
            <div class="border-r border-black/8 p-4">
              <div class="font-mono text-[10.5px] text-neutral-500">Followers</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(activeSocial.followers) }}
              </div>
              <div
                v-if="formatDelta(activeSocial.deltaFollowers)"
                class="font-mono text-[11px]"
                :class="(activeSocial.deltaFollowers ?? 0) > 0 ? 'text-emerald-700' : 'text-red-700'"
              >
                {{ formatDelta(activeSocial.deltaFollowers) }} vs prev
              </div>
            </div>
            <div class="border-r border-black/8 p-4">
              <div class="font-mono text-[10.5px] text-neutral-500">{{ activeSocial.secondaryLabel }}</div>
              <div class="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {{ formatCompact(activeSocial.secondaryValue) }}
              </div>
            </div>
            <div class="col-span-2 border-t border-black/8 p-4 sm:col-span-1 sm:border-t-0">
              <div class="font-mono text-[10.5px] text-neutral-500">Handle</div>
              <div class="mt-1 truncate font-mono text-sm font-medium text-[#171717]">
                {{ activeSocial.handle ? `@${activeSocial.handle}` : "Auto-detected on sync" }}
              </div>
            </div>
          </div>
        </template>

        <!-- Clean Growth Sparkline (when >= 2 snapshots) -->
        <div v-if="activeSparklinePath" class="border-b border-black/8 px-4 py-3">
          <svg viewBox="0 0 640 56" class="h-14 w-full overflow-visible" aria-hidden="true">
            <path
              :d="activeSparklinePath"
              fill="none"
              stroke="#171717"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <!-- ==================== SNAPSHOT HISTORY TABLE ==================== -->
        <div class="flex items-center justify-between border-b border-black/8 bg-[#FAF9F6] px-4 py-2">
          <span class="text-xs font-semibold text-neutral-700">
            Snapshot History ({{ filteredMetrics.length }})
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-7 gap-1 rounded-lg px-2 text-[11px] text-neutral-700"
            @click="showManualForm = !showManualForm"
          >
            <XIcon v-if="showManualForm" class="size-3" />
            <PlusIcon v-else class="size-3" />
            <span>{{ showManualForm ? "Cancel" : "Log Manual" }}</span>
          </Button>
        </div>

        <!-- Inline Manual Log Bar -->
        <form
          v-if="showManualForm"
          class="flex flex-wrap items-center gap-2 border-b border-black/8 bg-[#FAF9F6]/60 px-4 py-2.5"
          @submit.prevent="addManualMetric"
        >
          <select
            v-if="activeTab === 'overview'"
            v-model="newPlatform"
            class="h-8 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs"
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="x">X</option>
          </select>
          <input v-model="newDate" type="date" class="h-8 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" />
          <input v-model="newSubs" type="number" class="h-8 w-24 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" placeholder="Followers" />
          <input v-model="newViews" type="number" class="h-8 w-28 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" placeholder="Views/Likes" />
          <input v-model="newCcv" type="number" class="h-8 w-20 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" placeholder="CCV" />
          <input v-model="newCtr" type="number" step="0.1" class="h-8 w-20 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" placeholder="CTR %" />
          <input v-model="newNotes" type="text" class="h-8 min-w-[140px] flex-1 rounded-lg border border-black/10 bg-white px-2.5 font-mono text-xs" placeholder="Notes" />
          <Button type="submit" size="xs" class="h-8 rounded-lg px-3 text-xs">Save</Button>
        </form>

        <!-- Empty State -->
        <div
          v-if="filteredMetrics.length === 0 && !loading"
          class="px-4 py-14 text-center font-mono text-xs text-neutral-500"
        >
          No snapshots recorded yet. Click <strong>Sync</strong> above to pull live stats into SQLite.
        </div>

        <!-- Edge-to-Edge Native Table -->
        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr class="border-b border-black/8 bg-[#FAF9F6]/60 text-left font-mono text-[10.5px] text-neutral-500">
                <th class="px-4 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Platform</th>
                <th class="px-3 py-2 text-right font-medium">Followers / Subs</th>
                <th class="px-3 py-2 text-right font-medium">Views / Likes / Posts</th>
                <th class="px-3 py-2 text-right font-medium">CCV</th>
                <th class="px-3 py-2 text-right font-medium">CTR</th>
                <th class="px-3 py-2 font-medium">Notes</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in filteredMetrics"
                :key="m.id"
                class="border-b border-black/6 transition-colors hover:bg-[#FAF9F6]"
              >
                <td class="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-[#171717]">
                  {{ m.recordedAt }}
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-neutral-700">
                    <PlatformBrandIcon :platform="m.platform" class="size-3.5 shrink-0" />
                    {{ platformLabel(m.platform) }}
                  </span>
                </td>
                <td class="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-[#171717]">
                  {{ m.subscribers?.toLocaleString() ?? "—" }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-neutral-600">
                  {{ m.totalViews?.toLocaleString() ?? "—" }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-neutral-500">
                  {{ m.avgCcv?.toLocaleString() ?? "—" }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-neutral-500">
                  {{ m.avgCtr !== null ? `${m.avgCtr}%` : "—" }}
                </td>
                <td class="max-w-[260px] truncate px-3 py-2 font-mono text-[11px] text-neutral-500" :title="m.notes">
                  {{ m.notes || "—" }}
                </td>
                <td class="px-3 py-2 text-right">
                  <button
                    type="button"
                    class="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete snapshot"
                    @click="removeMetric(m.id)"
                  >
                    <Trash2Icon class="size-3.5" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
