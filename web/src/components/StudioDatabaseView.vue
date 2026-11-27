<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FileTextIcon, ImageIcon, PlusIcon, RefreshCwIcon, XIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
export interface ContentPipelineItem {
  id: string;
  title: string;
  format: "stream" | "video" | "short" | "collab";
  status: "idea" | "prepping" | "scheduled" | "live" | "editing" | "published" | "dropped";
  hook: string;
  thumbnailPath: string;
  scriptPath: string;
  scheduledFor: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

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

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  openWorkspacePath: [relPath: string];
  overviewUpdated: [payload: {
    pipelineCount: number;
    contactsCount: number;
  }];
}>();

const subTab = ref<"pipeline" | "metrics">("pipeline");
const loading = ref(false);
const syncingYouTube = ref(false);
const togglingDaily = ref(false);
const dailySyncEnabled = ref(false);
const dailySyncNote = ref("");
const errorMsg = ref("");

const pipeline = ref<ContentPipelineItem[]>([]);
const metrics = ref<ChannelMetric[]>([]);

const newPipeTitle = ref("");
const newPipeFormat = ref<ContentPipelineItem["format"]>("stream");
const newPipeHook = ref("");

const newMetricDate = ref(new Date().toISOString().slice(0, 10));
const newMetricSubs = ref("");
const newMetricViews = ref("");
const newMetricCcv = ref("");
const newMetricCtr = ref("");
const newMetricNotes = ref("");

const activePipeline = computed(() => pipeline.value.filter((p) => p.status !== "dropped"));

async function fetchAllDb() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [pRes, mRes, cRes, wRes] = await Promise.all([
      fetch("/api/db/pipeline").then((r) => r.json()).catch(() => null),
      fetch("/api/db/metrics").then((r) => r.json()).catch(() => null),
      fetch("/api/db/contacts").then((r) => r.json()).catch(() => null),
      fetch("/api/db/metrics/widget").then((r) => r.json()).catch(() => null),
    ]);
    if (pRes && Array.isArray(pRes.items)) pipeline.value = pRes.items;
    if (mRes && Array.isArray(mRes.metrics)) metrics.value = mRes.metrics;
    if (wRes && wRes.state?.dailySync) {
      dailySyncEnabled.value = Boolean(wRes.state.dailySync.enabled);
    }
    emit("overviewUpdated", {
      pipelineCount: activePipeline.value.length,
      contactsCount: cRes && Array.isArray(cRes.contacts) ? cRes.contacts.length : 0,
    });
  } finally {
    loading.value = false;
  }
}

async function addPipeline() {
  if (!newPipeTitle.value.trim()) return;
  errorMsg.value = "";
  const res = await fetch("/api/db/pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: newPipeTitle.value.trim(),
      format: newPipeFormat.value,
      hook: newPipeHook.value.trim(),
    }),
  });
  if (!res.ok) {
    errorMsg.value = "Could not add content idea";
    return;
  }
  newPipeTitle.value = "";
  newPipeHook.value = "";
  await fetchAllDb();
}

async function patchPipeline(id: string, patch: Partial<ContentPipelineItem>) {
  await fetch(`/api/db/pipeline/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await fetchAllDb();
}

async function removePipeline(id: string) {
  await fetch(`/api/db/pipeline/${encodeURIComponent(id)}`, { method: "DELETE" });
  await fetchAllDb();
}

async function addMetric() {
  const numOrNull = (v: string) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  await fetch("/api/db/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordedAt: newMetricDate.value,
      platform: "youtube",
      subscribers: numOrNull(newMetricSubs.value),
      totalViews: numOrNull(newMetricViews.value),
      avgCcv: numOrNull(newMetricCcv.value),
      avgCtr: numOrNull(newMetricCtr.value),
      notes: newMetricNotes.value.trim(),
    }),
  });
  newMetricSubs.value = "";
  newMetricViews.value = "";
  newMetricCcv.value = "";
  newMetricCtr.value = "";
  newMetricNotes.value = "";
  await fetchAllDb();
}

async function removeMetric(id: string) {
  await fetch(`/api/db/metrics/${encodeURIComponent(id)}`, { method: "DELETE" });
  await fetchAllDb();
}

async function syncYouTubeNow() {
  if (syncingYouTube.value) return;
  syncingYouTube.value = true;
  errorMsg.value = "";
  dailySyncNote.value = "";
  try {
    const res = await fetch("/api/db/metrics/sync", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) {
      errorMsg.value = data.error || "YouTube sync failed";
    } else {
      await fetchAllDb();
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "YouTube sync failed";
  } finally {
    syncingYouTube.value = false;
  }
}

async function toggleDailySync() {
  if (togglingDaily.value) return;
  togglingDaily.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/db/metrics/daily-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !dailySyncEnabled.value }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      note?: string;
      error?: string;
      state?: { dailySync?: { enabled?: boolean } };
    };
    if (data.state?.dailySync) {
      dailySyncEnabled.value = Boolean(data.state.dailySync.enabled);
    }
    if (data.note) dailySyncNote.value = data.note;
    if (!res.ok && data.error) errorMsg.value = data.error;
  } finally {
    togglingDaily.value = false;
  }
}

function openTab(tab: "pipeline" | "metrics") {
  subTab.value = tab;
}

watch(
  () => props.refreshTick,
  () => {
    fetchAllDb();
  },
  { immediate: true }
);

defineExpose({ fetchAllDb, openTab });
</script>

<template>
  <div class="db-shell">
    <div class="otto-card">
      <div class="otto-card-head">
        <span>(Y)our studio database.</span>
        <div class="otto-card-head-right">
          <span class="otto-chip otto-chip-neutral">
            {{ activePipeline.length }} in pipeline · {{ metrics.length }} snapshot{{ metrics.length === 1 ? "" : "s" }}
          </span>
        </div>
      </div>

      <div class="otto-card-body">
        <div class="db-subtabs">
          <button type="button" class="db-tab" :class="{ active: subTab === 'pipeline' }" @click="subTab = 'pipeline'">
            Content Pipeline ({{ activePipeline.length }})
          </button>
          <button type="button" class="db-tab" :class="{ active: subTab === 'metrics' }" @click="subTab = 'metrics'">
            Channel Metrics ({{ metrics.length }})
          </button>
        </div>

        <div v-if="errorMsg" class="text-xs text-destructive font-mono">{{ errorMsg }}</div>

        <!-- TAB 1: CONTENT PIPELINE -->
        <div v-if="subTab === 'pipeline'" class="flex flex-col gap-3">
          <div class="db-panel-head">
            <div class="db-sub">Shared live with Otto. Track stream ideas, videos, shorts, and linked assets.</div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              @click="emit('askPrompt', 'Review my Content Pipeline in the Studio Database and suggest which idea we should prep next.')"
            >
              Review with Otto
            </Button>
          </div>

          <form class="db-form" @submit.prevent="addPipeline">
            <input v-model="newPipeTitle" type="text" class="db-input flex-1" placeholder="New stream or video idea..." required />
            <select v-model="newPipeFormat" class="db-select">
              <option value="stream">Stream</option>
              <option value="video">YouTube Video</option>
              <option value="short">Short / Clip</option>
              <option value="collab">Collab</option>
            </select>
            <input v-model="newPipeHook" type="text" class="db-input" placeholder="Hook / angle (optional)" />
            <Button type="submit" size="sm">
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </form>

          <div v-if="pipeline.length === 0" class="db-empty">
            No content ideas logged yet. Add one above or ask Otto to brainstorm.
          </div>

          <div v-else class="db-cards">
            <div v-for="item in pipeline" :key="item.id" class="db-row-card">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="otto-chip otto-chip-neutral">{{ item.format }}</span>
                  <span class="font-medium text-sm">{{ item.title }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <select
                    :value="item.status"
                    class="db-mini-select"
                    @change="patchPipeline(item.id, { status: ($event.target as HTMLSelectElement).value as ContentPipelineItem['status'] })"
                  >
                    <option value="idea">Idea</option>
                    <option value="prepping">Prepping</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="live">Live</option>
                    <option value="editing">Editing</option>
                    <option value="published">Published</option>
                    <option value="dropped">Dropped</option>
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    @click="emit('askPrompt', `Let's plan and prep my ${item.format} idea '${item.title}' (DB id: ${item.id}) — title options, outline, and any notes for my team.`)"
                  >
                    Prep
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" class="text-destructive hover:text-destructive" aria-label="Delete item" @click="removePipeline(item.id)">
                    <XIcon />
                  </Button>
                </div>
              </div>

              <div v-if="item.hook" class="text-xs text-[var(--fg-muted)] mt-1">Hook: {{ item.hook }}</div>
              <div v-if="item.notes" class="text-xs text-[var(--fg-muted)] mt-0.5">{{ item.notes }}</div>

              <div v-if="item.thumbnailPath || item.scriptPath" class="flex flex-wrap gap-1.5 mt-1.5">
                <Button
                  v-if="item.thumbnailPath"
                  type="button"
                  variant="secondary"
                  size="xs"
                  @click="emit('openWorkspacePath', item.thumbnailPath.includes('/') ? item.thumbnailPath.slice(0, item.thumbnailPath.lastIndexOf('/')) : '')"
                >
                  <ImageIcon data-icon="inline-start" />
                  {{ item.thumbnailPath }}
                </Button>
                <Button
                  v-if="item.scriptPath"
                  type="button"
                  variant="secondary"
                  size="xs"
                  @click="emit('openWorkspacePath', item.scriptPath.includes('/') ? item.scriptPath.slice(0, item.scriptPath.lastIndexOf('/')) : '')"
                >
                  <FileTextIcon data-icon="inline-start" />
                  {{ item.scriptPath }}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: CHANNEL METRICS HISTORY -->
        <div v-else-if="subTab === 'metrics'" class="space-y-3">
          <div class="db-panel-head">
            <div class="db-sub">
              Single source of truth synced with your desktop widget (0 LLM tokens).
              <span v-if="dailySyncNote" class="ml-1 text-[var(--fg)]">· {{ dailySyncNote }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                :disabled="syncingYouTube"
                @click="syncYouTubeNow"
              >
                <RefreshCwIcon data-icon="inline-start" :class="syncingYouTube ? 'animate-spin' : ''" />
                {{ syncingYouTube ? "Syncing..." : "Sync YouTube" }}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                :disabled="togglingDaily"
                @click="toggleDailySync"
              >
                {{ dailySyncEnabled ? "Daily Snapshot: On" : "Daily Snapshot: Off" }}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                @click="emit('askPrompt', 'Analyze my Channel Metrics history in Studio DB and highlight trends or next experiments.')"
              >
                Analyze with Otto
              </Button>
            </div>
          </div>
          <form class="db-form" @submit.prevent="addMetric">
            <input v-model="newMetricDate" type="date" class="db-input" />
            <input v-model="newMetricSubs" type="number" class="db-input w-24" placeholder="Subs" />
            <input v-model="newMetricViews" type="number" class="db-input w-28" placeholder="Views" />
            <input v-model="newMetricCcv" type="number" class="db-input w-24" placeholder="Avg CCV" />
            <input v-model="newMetricCtr" type="number" step="0.1" class="db-input w-24" placeholder="CTR %" />
            <input v-model="newMetricNotes" type="text" class="db-input flex-1" placeholder="Notes" />
            <Button type="submit" size="sm">
              <PlusIcon data-icon="inline-start" />
              Log
            </Button>
          </form>

          <div v-if="metrics.length === 0" class="db-empty">
            No metrics snapshots logged yet. Click <strong>Log Live YT Snapshot</strong> to record your baseline.
          </div>

          <div v-else class="overflow-x-auto">
            <table class="db-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Platform</th>
                  <th>Subs</th>
                  <th>Views</th>
                  <th>Avg CCV</th>
                  <th>CTR %</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in metrics" :key="m.id">
                  <td>{{ m.recordedAt }}</td>
                  <td>{{ m.platform }}</td>
                  <td>{{ m.subscribers?.toLocaleString() ?? "—" }}</td>
                  <td>{{ m.totalViews?.toLocaleString() ?? "—" }}</td>
                  <td>{{ m.avgCcv?.toLocaleString() ?? "—" }}</td>
                  <td>{{ m.avgCtr !== null ? `${m.avgCtr}%` : "—" }}</td>
                  <td>{{ m.notes || "—" }}</td>
                  <td>
                    <Button type="button" variant="ghost" size="icon-xs" class="text-destructive hover:text-destructive" aria-label="Delete metric" @click="removeMetric(m.id)">
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
  </div>
</template>

<style scoped>
.db-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.db-subtabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.db-tab {
  border: none;
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--surface-alt);
  color: var(--fg-muted);
  cursor: pointer;
}
.db-tab:hover {
  color: var(--fg);
}
.db-tab.active {
  background: var(--fg);
  color: #ffffff;
}
.db-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.db-sub {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-muted);
}
.db-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.db-input,
.db-select {
  padding: 7px 12px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}
.db-input:focus,
.db-select:focus {
  box-shadow: var(--shadow-focus);
}
.db-mini-select {
  padding: 3px 9px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11px;
}
.db-empty {
  padding: 20px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--surface-alt);
  border-radius: 14px;
}
.db-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.db-row-card {
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--surface-alt);
}
.db-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
}
.db-table th,
.db-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.db-table th {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
</style>
