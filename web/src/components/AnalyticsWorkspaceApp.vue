<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ExternalLinkIcon, PlusIcon, RefreshCwIcon, XIcon } from "@lucide/vue";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { YouTubeMetricsWidgetState } from "./ChannelMetricsWidget.vue";
import PlatformBrandIcon from "./PlatformBrandIcon.vue";

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

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
}>();

const metrics = ref<ChannelMetric[]>([]);
const widgetState = ref<YouTubeMetricsWidgetState | null>(null);
const socials = ref<SocialPlatformSummary[]>([]);
const platformFilter = ref<"all" | "youtube" | "tiktok" | "instagram" | "x">("all");
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

const filteredMetrics = computed(() => {
  if (platformFilter.value === "all") return metrics.value;
  return metrics.value.filter((m) => m.platform.toLowerCase() === platformFilter.value);
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

const sparklinePath = computed(() => {
  const pts = (widgetState.value?.sparkline || [])
    .map((p) => p.totalViews ?? p.subscribers)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (pts.length < 2) return "";
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const w = 520;
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
    if (!res.ok && data.error) errorMsg.value = data.error;
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
      platform: newPlatform.value,
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
  await fetch(`/api/db/metrics/${encodeURIComponent(id)}`, { method: "DELETE" });
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
  <div class="flex h-full flex-col gap-3.5 overflow-y-auto bg-[#fafafa]/60 p-4">
    <!-- Top Summary & YouTube Studio Deep Links -->
    <div class="otto-card">
      <div class="otto-card-head">
        <span>(Y)our analytics.</span>
        <div class="otto-card-head-right flex flex-wrap items-center gap-1.5">
          <Button type="button" size="xs" :disabled="Boolean(syncingTarget)" @click="syncPlatform('all')">
            <RefreshCwIcon data-icon="inline-start" :class="syncingTarget === 'all' ? 'animate-spin' : ''" />
            {{ syncingTarget === "all" ? "Syncing all..." : "Sync All Platforms" }}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            :disabled="togglingDaily"
            @click="toggleDaily"
          >
            {{ widgetState?.dailySync.enabled ? "Daily Snapshot: On" : "Daily Snapshot: Off" }}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            @click="emit('askPrompt', 'Analyze my multi-platform analytics history (YouTube, TikTok, Instagram, X) and suggest concrete growth experiments.')"
          >
            Analyze with Otto
          </Button>
        </div>
      </div>

      <div class="otto-card-body flex flex-col gap-3.5">
        <div v-if="errorMsg" class="rounded-xl bg-[#fde8e8] px-3 py-2 font-mono text-xs text-[#991b1b]">
          {{ errorMsg }}
        </div>
        <div v-if="dailyNote" class="font-mono text-[11px] text-[#666]">{{ dailyNote }}</div>

        <!-- YouTube KPI Row -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-2xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="flex items-center gap-1.5 font-mono text-[10.5px] text-[#808080]">
              <PlatformBrandIcon platform="youtube" class="size-3.5 shrink-0" />
              <span>YOUTUBE SUBS</span>
            </div>
            <div class="mt-1 font-mono text-2xl text-[#303030] tabular-nums">
              {{ formatCompact(widgetState?.subscribers) }}
            </div>
            <div
              v-if="formatDelta(widgetState?.deltaSubs)"
              class="font-mono text-[11px]"
              :class="(widgetState?.deltaSubs ?? 0) > 0 ? 'text-[#166534]' : 'text-[#991b1b]'"
            >
              {{ formatDelta(widgetState?.deltaSubs) }} vs prev
            </div>
          </div>

          <div class="rounded-2xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="font-mono text-[10.5px] text-[#808080]">TOTAL VIEWS</div>
            <div class="mt-1 font-mono text-2xl text-[#303030] tabular-nums">
              {{ formatCompact(widgetState?.totalViews) }}
            </div>
            <div
              v-if="formatDelta(widgetState?.deltaViews)"
              class="font-mono text-[11px]"
              :class="(widgetState?.deltaViews ?? 0) > 0 ? 'text-[#166534]' : 'text-[#991b1b]'"
            >
              {{ formatDelta(widgetState?.deltaViews) }} vs prev
            </div>
          </div>

          <div class="rounded-2xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="font-mono text-[10.5px] text-[#808080]">UPLOADS</div>
            <div class="mt-1 font-mono text-2xl text-[#303030] tabular-nums">
              {{ formatCompact(widgetState?.videoCount) }}
            </div>
            <div
              v-if="widgetState?.daysSinceLast !== null && widgetState?.daysSinceLast !== undefined"
              class="font-mono text-[11px] text-[#808080]"
            >
              Last {{ widgetState.daysSinceLast === 0 ? "today" : `${widgetState.daysSinceLast}d ago` }}
            </div>
          </div>

          <div class="rounded-2xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="font-mono text-[10.5px] text-[#808080]">AVG LAST 5</div>
            <div class="mt-1 font-mono text-2xl text-[#303030] tabular-nums">
              {{ formatCompact(widgetState?.avgViewsRecent) }}
            </div>
            <div class="font-mono text-[11px] text-[#808080]">views / stream</div>
          </div>
        </div>

        <!-- Clean Sparkline (when >= 2 snapshots) -->
        <div v-if="sparklinePath" class="rounded-2xl border border-[#ededed] bg-white px-4 py-3">
          <svg viewBox="0 0 520 56" class="h-14 w-full overflow-visible" aria-hidden="true">
            <path
              :d="sparklinePath"
              fill="none"
              stroke="#303030"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <!-- Latest Stream/Video Pulse + Quick YouTube Studio Links -->
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#ededed] bg-[#fafafa] px-3.5 py-2.5">
          <div class="min-w-0 flex-1">
            <div class="font-mono text-[10px] text-[#808080]">LATEST STREAM / VIDEO</div>
            <div v-if="widgetState?.latestVideo" class="truncate font-mono text-xs font-semibold text-[#303030]">
              {{ widgetState.latestVideo.title }}
            </div>
            <div v-else class="font-mono text-xs text-[#808080]">
              Click Sync All Platforms to pull your latest stream &amp; social stats.
            </div>
            <div v-if="widgetState?.latestVideo" class="mt-0.5 font-mono text-[11px] text-[#666]">
              {{ formatCompact(widgetState.latestVideo.views) }} views
              <template v-if="widgetState.latestVideo.likes !== null">
                · {{ formatCompact(widgetState.latestVideo.likes) }} likes
              </template>
              <template v-if="widgetState.latestVideo.vsAvgPct !== null">
                · {{ widgetState.latestVideo.vsAvgPct >= 0 ? "+" : "" }}{{ widgetState.latestVideo.vsAvgPct }}% vs avg
              </template>
            </div>
          </div>

          <div v-if="studioLinks" class="flex flex-wrap items-center gap-1.5">
            <a
              :href="studioLinks.analytics"
              target="_blank"
              rel="noopener noreferrer"
              :class="cn(buttonVariants({ variant: 'default', size: 'xs' }), 'no-underline')"
            >
              <ExternalLinkIcon data-icon="inline-start" />
              YouTube Studio
            </a>
            <a
              :href="studioLinks.live"
              target="_blank"
              rel="noopener noreferrer"
              :class="cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'no-underline')"
            >
              Live Control
            </a>
            <a
              v-if="studioLinks.latestVideo"
              :href="studioLinks.latestVideo"
              target="_blank"
              rel="noopener noreferrer"
              :class="cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'no-underline')"
            >
              Latest Video Stats
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Social Platforms Programmatic Cards (TikTok, Instagram, X) -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div
        v-for="s in socials"
        :key="s.platform"
        class="otto-card flex flex-col justify-between"
      >
        <div class="otto-card-head">
          <div class="flex min-w-0 items-center gap-2.5 text-left">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-xl border border-[#ededed] bg-[#fafafa]">
              <PlatformBrandIcon :platform="s.platform" class="size-4" />
            </div>
            <div class="min-w-0">
              <span class="block truncate text-left">{{ s.label }}</span>
              <span v-if="s.handle" class="block truncate text-left font-mono text-[10.5px] font-normal text-[#808080]">
                @{{ s.handle }}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            :disabled="Boolean(syncingTarget)"
            @click="syncPlatform(s.platform)"
          >
            <RefreshCwIcon
              data-icon="inline-start"
              :class="syncingTarget === s.platform || syncingTarget === 'all' ? 'animate-spin' : ''"
            />
            Sync
          </Button>
        </div>

        <div class="otto-card-body flex flex-col gap-2.5">
          <div class="flex items-baseline justify-between gap-2">
            <div>
              <div class="font-mono text-[10px] text-[#808080]">FOLLOWERS</div>
              <div class="font-mono text-2xl text-[#303030] tabular-nums">
                {{ formatCompact(s.followers) }}
              </div>
              <div
                v-if="formatDelta(s.deltaFollowers)"
                class="font-mono text-[11px]"
                :class="(s.deltaFollowers ?? 0) > 0 ? 'text-[#166534]' : 'text-[#991b1b]'"
              >
                {{ formatDelta(s.deltaFollowers) }} vs prev
              </div>
            </div>
            <div class="text-right">
              <div class="font-mono text-[10px] uppercase text-[#808080]">{{ s.secondaryLabel }}</div>
              <div class="font-mono text-base text-[#303030] tabular-nums">
                {{ formatCompact(s.secondaryValue) }}
              </div>
            </div>
          </div>

          <div v-if="s.lastError" class="truncate rounded-lg bg-[#fde8e8] px-2 py-1 font-mono text-[10.5px] text-[#991b1b]" :title="s.lastError">
            {{ s.lastError }}
          </div>

          <div class="flex items-center justify-between gap-2 border-t border-[#f0f0f0] pt-2">
            <a
              :href="s.studioUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-mono text-[11px] text-[#303030] no-underline hover:underline"
            >
              Insights
              <ExternalLinkIcon class="size-3" />
            </a>
            <a
              v-if="s.profileUrl"
              :href="s.profileUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-[10.5px] text-[#808080] no-underline hover:text-[#303030]"
            >
              Profile ↗
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Snapshot History Table (Single Source of Truth in studio.db) -->
    <div class="otto-card">
      <div class="otto-card-head flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <span>(Y)our history.</span>
          <div class="flex items-center gap-1">
            <button
              v-for="tab in (['all', 'youtube', 'tiktok', 'instagram', 'x'] as const)"
              :key="tab"
              type="button"
              class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] transition-colors"
              :class="
                platformFilter === tab
                  ? 'bg-[#303030] text-white'
                  : 'bg-[#f2f2f2] text-[#666] hover:bg-[#e8e8e8]'
              "
              @click="platformFilter = tab"
            >
              {{ tab === "all" ? "All" : platformLabel(tab) }}
            </button>
          </div>
        </div>

        <div class="otto-card-head-right flex items-center gap-2">
          <span class="font-mono text-[10.5px] text-[#808080]">
            {{ filteredMetrics.length }} snapshot{{ filteredMetrics.length === 1 ? "" : "s" }}
          </span>
          <Button type="button" variant="secondary" size="xs" @click="showManualForm = !showManualForm">
            <PlusIcon data-icon="inline-start" />
            {{ showManualForm ? "Cancel" : "Log Manual" }}
          </Button>
        </div>
      </div>

      <div class="otto-card-body flex flex-col gap-3">
        <form v-if="showManualForm" class="flex flex-wrap items-center gap-2" @submit.prevent="addManualMetric">
          <select v-model="newPlatform" class="h-8 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs">
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="x">X</option>
          </select>
          <input v-model="newDate" type="date" class="h-8 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" />
          <input v-model="newSubs" type="number" class="h-8 w-24 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" placeholder="Followers" />
          <input v-model="newViews" type="number" class="h-8 w-28 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" placeholder="Views/Likes" />
          <input v-model="newCcv" type="number" class="h-8 w-24 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" placeholder="Avg CCV" />
          <input v-model="newCtr" type="number" step="0.1" class="h-8 w-24 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" placeholder="CTR %" />
          <input v-model="newNotes" type="text" class="h-8 flex-1 min-w-[140px] rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs" placeholder="Notes" />
          <Button type="submit" size="sm">Save</Button>
        </form>

        <div
          v-if="filteredMetrics.length === 0 && !loading"
          class="rounded-2xl border border-dashed border-[#d9d9d9] bg-[#fafafa] px-4 py-8 text-center font-mono text-xs text-[#808080]"
        >
          No snapshots recorded yet. Click <strong>Sync All Platforms</strong> above to record today's baseline.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse font-mono text-xs">
            <thead>
              <tr class="border-b border-[#ededed] text-left text-[10.5px] uppercase text-[#808080]">
                <th class="py-2 pr-3 font-medium">Date</th>
                <th class="py-2 pr-3 font-medium">Platform</th>
                <th class="py-2 pr-3 font-medium">Followers / Subs</th>
                <th class="py-2 pr-3 font-medium">Views / Likes / Posts</th>
                <th class="py-2 pr-3 font-medium">Avg CCV</th>
                <th class="py-2 pr-3 font-medium">CTR %</th>
                <th class="py-2 pr-3 font-medium">Notes</th>
                <th class="py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in filteredMetrics" :key="m.id" class="border-b border-[#f2f2f2] last:border-0">
                <td class="py-2 pr-3 whitespace-nowrap text-[#303030]">{{ m.recordedAt }}</td>
                <td class="py-2 pr-3 whitespace-nowrap">
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-[#f2f2f2] px-2 py-0.5 text-[10.5px] text-[#303030]">
                    <PlatformBrandIcon :platform="m.platform" class="size-3 shrink-0" />
                    {{ platformLabel(m.platform) }}
                  </span>
                </td>
                <td class="py-2 pr-3 tabular-nums">{{ m.subscribers?.toLocaleString() ?? "—" }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ m.totalViews?.toLocaleString() ?? "—" }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ m.avgCcv?.toLocaleString() ?? "—" }}</td>
                <td class="py-2 pr-3 tabular-nums">{{ m.avgCtr !== null ? `${m.avgCtr}%` : "—" }}</td>
                <td class="py-2 pr-3 text-[#666]">{{ m.notes || "—" }}</td>
                <td class="py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="text-destructive hover:text-destructive"
                    aria-label="Delete snapshot"
                    @click="removeMetric(m.id)"
                  >
                    <XIcon />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
