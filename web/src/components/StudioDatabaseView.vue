<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FileTextIcon, ImageIcon, PlusIcon, Trash2Icon, XIcon } from "@lucide/vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
export interface ContentPipelineItem {
  id: string;
  title: string;
  format: "stream" | "video" | "short" | "collab";
  pillar: "core" | "experiment";
  status: "idea" | "prepping" | "scheduled" | "live" | "editing" | "published" | "dropped";
  hook: string;
  thumbnailPath: string;
  scriptPath: string;
  scheduledFor: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioContact {
  id: string;
  name: string;
  role: "artist" | "clipper" | "editor" | "rigger" | "collab" | "sponsor" | "mod";
  handle: string;
  platform: string;
  status: "prospect" | "pitched" | "active" | "paused";
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

export interface CustomTracker {
  slug: string;
  name: string;
  description: string;
  columns: string[];
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomTrackerItem {
  id: string;
  trackerSlug: string;
  title: string;
  status: string;
  data: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  openWorkspacePath: [relPath: string];
  overviewUpdated: [payload: {
    pipelineCount: number;
    coreCount: number;
    experimentCount: number;
    contactsCount: number;
    trackersCount: number;
  }];
}>();

const subTab = ref<"pipeline" | "contacts" | "metrics" | "trackers">("pipeline");
const loading = ref(false);
const errorMsg = ref("");

const pipeline = ref<ContentPipelineItem[]>([]);
const contacts = ref<StudioContact[]>([]);
const metrics = ref<ChannelMetric[]>([]);
const trackers = ref<CustomTracker[]>([]);
const activeTrackerSlug = ref<string | null>(null);
const activeTrackerItems = ref<CustomTrackerItem[]>([]);

const newPipeTitle = ref("");
const newPipeFormat = ref<ContentPipelineItem["format"]>("stream");
const newPipePillar = ref<ContentPipelineItem["pillar"]>("core");
const newPipeHook = ref("");

const newContactName = ref("");
const newContactRole = ref<StudioContact["role"]>("artist");
const newContactHandle = ref("");
const newContactPlatform = ref("");
const newContactNotes = ref("");

const newMetricDate = ref(new Date().toISOString().slice(0, 10));
const newMetricSubs = ref("");
const newMetricViews = ref("");
const newMetricCcv = ref("");
const newMetricCtr = ref("");
const newMetricNotes = ref("");

const creatingTracker = ref(false);
const newTrackerName = ref("");
const newTrackerDesc = ref("");
const newTrackerCols = ref("notes, priority");

const newCustomTitle = ref("");
const newCustomStatus = ref("open");
const newCustomData = ref<Record<string, string>>({});

const activePipeline = computed(() => pipeline.value.filter((p) => p.status !== "dropped"));
const coreCount = computed(() => activePipeline.value.filter((p) => p.pillar === "core").length);
const experimentCount = computed(
  () => activePipeline.value.filter((p) => p.pillar === "experiment").length
);
const experimentPct = computed(() => {
  const total = coreCount.value + experimentCount.value;
  return total > 0 ? Math.round((experimentCount.value / total) * 100) : 0;
});

const activeTracker = computed(
  () => trackers.value.find((t) => t.slug === activeTrackerSlug.value) || null
);

async function fetchAllDb() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [pRes, cRes, mRes, tRes] = await Promise.all([
      fetch("/api/db/pipeline").then((r) => r.json()).catch(() => null),
      fetch("/api/db/contacts").then((r) => r.json()).catch(() => null),
      fetch("/api/db/metrics").then((r) => r.json()).catch(() => null),
      fetch("/api/db/trackers").then((r) => r.json()).catch(() => null),
    ]);
    if (pRes && Array.isArray(pRes.items)) pipeline.value = pRes.items;
    if (cRes && Array.isArray(cRes.contacts)) contacts.value = cRes.contacts;
    if (mRes && Array.isArray(mRes.metrics)) metrics.value = mRes.metrics;
    if (tRes && Array.isArray(tRes.trackers)) {
      trackers.value = tRes.trackers;
      if (trackers.value.length > 0 && !trackers.value.some((t) => t.slug === activeTrackerSlug.value)) {
        activeTrackerSlug.value = trackers.value[0].slug;
      }
      if (trackers.value.length === 0) {
        activeTrackerSlug.value = null;
        activeTrackerItems.value = [];
      }
    }
    if (activeTrackerSlug.value) {
      await fetchTrackerItems(activeTrackerSlug.value);
    }
    emit("overviewUpdated", {
      pipelineCount: activePipeline.value.length,
      coreCount: coreCount.value,
      experimentCount: experimentCount.value,
      contactsCount: contacts.value.length,
      trackersCount: trackers.value.length,
    });
  } finally {
    loading.value = false;
  }
}

async function fetchTrackerItems(slug: string) {
  const res = await fetch(`/api/db/trackers/${encodeURIComponent(slug)}/items`)
    .then((r) => r.json())
    .catch(() => null);
  activeTrackerItems.value = res && Array.isArray(res.items) ? res.items : [];
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
      pillar: newPipePillar.value,
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

async function addContact() {
  if (!newContactName.value.trim()) return;
  const res = await fetch("/api/db/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: newContactName.value.trim(),
      role: newContactRole.value,
      handle: newContactHandle.value.trim(),
      platform: newContactPlatform.value.trim(),
      notes: newContactNotes.value.trim(),
    }),
  });
  if (!res.ok) return;
  newContactName.value = "";
  newContactHandle.value = "";
  newContactPlatform.value = "";
  newContactNotes.value = "";
  await fetchAllDb();
}

async function patchContact(id: string, patch: Partial<StudioContact>) {
  await fetch(`/api/db/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await fetchAllDb();
}

async function removeContact(id: string) {
  await fetch(`/api/db/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
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

async function createTracker() {
  if (!newTrackerName.value.trim()) return;
  const columns = newTrackerCols.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await fetch("/api/db/trackers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: newTrackerName.value.trim(),
      description: newTrackerDesc.value.trim(),
      columns,
    }),
  });
  const data = (await res.json()) as { tracker?: CustomTracker };
  if (res.ok && data.tracker) {
    activeTrackerSlug.value = data.tracker.slug;
    newTrackerName.value = "";
    newTrackerDesc.value = "";
    creatingTracker.value = false;
    await fetchAllDb();
  }
}

const trackerPendingDelete = ref<string | null>(null);

function promptRemoveTracker(slug: string) {
  trackerPendingDelete.value = slug;
}

async function confirmRemoveTracker() {
  const slug = trackerPendingDelete.value;
  if (!slug) return;
  trackerPendingDelete.value = null;
  await fetch(`/api/db/trackers/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await fetchAllDb();
}

async function addCustomItem() {
  if (!activeTrackerSlug.value || !newCustomTitle.value.trim()) return;
  await fetch(`/api/db/trackers/${encodeURIComponent(activeTrackerSlug.value)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: newCustomTitle.value.trim(),
      status: newCustomStatus.value.trim() || "open",
      data: { ...newCustomData.value },
    }),
  });
  newCustomTitle.value = "";
  newCustomData.value = {};
  await fetchAllDb();
}

async function removeCustomItem(id: string) {
  if (!activeTrackerSlug.value) return;
  await fetch(
    `/api/db/trackers/${encodeURIComponent(activeTrackerSlug.value)}/items/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  await fetchAllDb();
}

watch(
  () => props.refreshTick,
  () => {
    fetchAllDb();
  },
  { immediate: true }
);

watch(activeTrackerSlug, (slug) => {
  if (slug) fetchTrackerItems(slug);
});

defineExpose({ fetchAllDb });
</script>

<template>
  <div class="db-shell">
    <div class="otto-card">
      <div class="otto-card-head">
        <span>(Y)our studio database.</span>
        <div class="otto-card-head-right">
          <span class="otto-chip otto-chip-yellow" title="Otto's 3+1 Rule: 3 Core formats + 1 Experiment">
            3+1: {{ coreCount }} Core / {{ experimentCount }} Exp ({{ experimentPct }}%)
          </span>
        </div>
      </div>

      <div class="otto-card-body">
        <div class="db-subtabs">
          <button type="button" class="db-tab" :class="{ active: subTab === 'pipeline' }" @click="subTab = 'pipeline'">
            3+1 Pipeline ({{ activePipeline.length }})
          </button>
          <button type="button" class="db-tab" :class="{ active: subTab === 'contacts' }" @click="subTab = 'contacts'">
            Contacts ({{ contacts.length }})
          </button>
          <button type="button" class="db-tab" :class="{ active: subTab === 'metrics' }" @click="subTab = 'metrics'">
            Metrics ({{ metrics.length }})
          </button>
          <button type="button" class="db-tab" :class="{ active: subTab === 'trackers' }" @click="subTab = 'trackers'">
            Custom Trackers ({{ trackers.length }})
          </button>
        </div>

        <div v-if="errorMsg" class="text-xs text-destructive font-mono">{{ errorMsg }}</div>

        <!-- TAB 1: 3+1 CONTENT PIPELINE -->
        <div v-if="subTab === 'pipeline'" class="flex flex-col gap-3">
          <div class="db-panel-head">
            <div class="db-sub">Shared live with Otto — track Core vs Experiment streams, videos &amp; packaging.</div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              @click="emit('askPrompt', 'Review my 3+1 Content Pipeline in the Studio Database, check my Core vs Experiment ratio, and tell me which idea we should sharpen next.')"
            >
              Audit 3+1 with Otto
            </Button>
          </div>

          <form class="db-form" @submit.prevent="addPipeline">
            <input v-model="newPipeTitle" type="text" class="db-input flex-1" placeholder="New stream or video concept..." required />
            <select v-model="newPipeFormat" class="db-select">
              <option value="stream">Stream</option>
              <option value="video">YouTube Video</option>
              <option value="short">Short / Clip</option>
              <option value="collab">Collab</option>
            </select>
            <select v-model="newPipePillar" class="db-select">
              <option value="core">3x Core</option>
              <option value="experiment">+1 Experiment</option>
            </select>
            <input v-model="newPipeHook" type="text" class="db-input" placeholder="Hook / angle (optional)" />
            <Button type="submit" size="sm">
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </form>

          <div v-if="pipeline.length === 0" class="db-empty">
            No content ideas logged yet. Add one above or brainstorm a $1 / $1,000 / $100,000 idea with Otto.
          </div>

          <div v-else class="db-cards">
            <div v-for="item in pipeline" :key="item.id" class="db-row-card">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="otto-chip" :class="item.pillar === 'experiment' ? 'otto-chip-cyan' : 'otto-chip-ink'">
                    {{ item.pillar === "experiment" ? "+1 EXP" : "CORE" }}
                  </span>
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
                    @click="emit('askPrompt', `Let's sharpen the packaging, 4 Ps intro, and thumbnail brief for my ${item.pillar} ${item.format} idea '${item.title}' (DB id: ${item.id}).`)"
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

        <!-- TAB 2: CONTACTS ROLODEX -->
        <div v-else-if="subTab === 'contacts'" class="space-y-3">
          <div class="db-sub">Human thumbnail artists, clippers, editors, riggers, collabs &amp; sponsors.</div>

          <form class="db-form" @submit.prevent="addContact">
            <input v-model="newContactName" type="text" class="db-input" placeholder="Name" required />
            <select v-model="newContactRole" class="db-select">
              <option value="artist">Artist</option>
              <option value="clipper">Clipper</option>
              <option value="editor">Editor</option>
              <option value="rigger">Rigger</option>
              <option value="collab">Collab</option>
              <option value="sponsor">Sponsor</option>
              <option value="mod">Mod</option>
            </select>
            <input v-model="newContactHandle" type="text" class="db-input" placeholder="@handle / email" />
            <input v-model="newContactPlatform" type="text" class="db-input" placeholder="Platform (X, VGen, YT)" />
            <input v-model="newContactNotes" type="text" class="db-input flex-1" placeholder="Rates, vibe, notes" />
            <Button type="submit" size="sm">
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </form>

          <div v-if="contacts.length === 0" class="db-empty">
            No contacts saved yet. Add your go-to human thumbnail artist, clipper, or collab partners.
          </div>

          <div v-else class="db-cards">
            <div v-for="c in contacts" :key="c.id" class="db-row-card">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="otto-chip otto-chip-ink">{{ c.role }}</span>
                  <span class="font-medium text-sm">{{ c.name }}</span>
                  <span v-if="c.handle" class="text-xs font-mono text-[var(--fg-muted)]">{{ c.handle }}</span>
                  <span v-if="c.platform" class="otto-chip otto-chip-neutral">{{ c.platform }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <select
                    :value="c.status"
                    class="db-mini-select"
                    @change="patchContact(c.id, { status: ($event.target as HTMLSelectElement).value as StudioContact['status'] })"
                  >
                    <option value="prospect">Prospect</option>
                    <option value="pitched">Pitched</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    @click="emit('askPrompt', `Draft a clear, zero-friction ${c.role === 'collab' ? 'collab pitch' : 'brief / outreach message'} for ${c.name} (${c.role}${c.handle ? ', ' + c.handle : ''}).`)"
                  >
                    Draft Outreach
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" class="text-destructive hover:text-destructive" aria-label="Delete contact" @click="removeContact(c.id)">
                    <XIcon />
                  </Button>
                </div>
              </div>
              <div v-if="c.notes" class="text-xs text-[var(--fg-muted)] mt-1">{{ c.notes }}</div>
            </div>
          </div>
        </div>

        <!-- TAB 3: CHANNEL METRICS HISTORY -->
        <div v-else-if="subTab === 'metrics'" class="space-y-3">
          <div class="db-panel-head">
            <div class="db-sub">Log growth snapshots (or let Otto record them during YouTube audits).</div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              @click="emit('askPrompt', 'Check my live YouTube stats, log a fresh Channel Metrics snapshot into the Studio Database, and compare against my previous snapshots.')"
            >
              Log Live YT Snapshot
            </Button>
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

        <!-- TAB 4: CUSTOM TRACKERS -->
        <div v-else class="space-y-3">
          <div class="db-panel-head">
            <div class="db-sub">Flexible trackers created by you or Otto on the fly (e.g. Game Backlog, Series Plan).</div>
            <Button type="button" size="xs" @click="creatingTracker = !creatingTracker">
              {{ creatingTracker ? "Cancel" : "+ New Tracker" }}
            </Button>
          </div>

          <form v-if="creatingTracker" class="db-form" @submit.prevent="createTracker">
            <input v-model="newTrackerName" type="text" class="db-input" placeholder="Tracker name (e.g. Game Backlog)" required />
            <input v-model="newTrackerCols" type="text" class="db-input flex-1" placeholder="Extra columns (genre, hours, priority)" />
            <input v-model="newTrackerDesc" type="text" class="db-input flex-1" placeholder="Short description (optional)" />
            <Button type="submit" size="sm">Create</Button>
          </form>

          <div v-if="trackers.length === 0" class="db-empty">
            No custom trackers yet. Click <strong>+ New Tracker</strong> or ask Otto in chat to spin up a tracker for anything.
          </div>

          <template v-else>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="t in trackers"
                :key="t.slug"
                type="button"
                class="db-tab"
                :class="{ active: activeTrackerSlug === t.slug }"
                @click="activeTrackerSlug = t.slug"
              >
                {{ t.name }} ({{ t.itemCount ?? 0 }})
              </button>
            </div>

            <div v-if="activeTracker" class="space-y-3">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="text-xs font-mono text-[var(--fg-muted)]">{{ activeTracker.description || `slug: ${activeTracker.slug}` }}</div>
                <div class="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    @click="emit('askPrompt', `Review my custom tracker '${activeTracker.name}' (slug: ${activeTracker.slug}) in the Studio Database and suggest priorities.`)"
                  >
                    Ask Otto
                  </Button>
                  <Button type="button" variant="ghost" size="xs" class="text-destructive hover:text-destructive" @click="promptRemoveTracker(activeTracker.slug)">
                    <Trash2Icon data-icon="inline-start" />
                    Delete Tracker
                  </Button>
                </div>
              </div>

              <form class="db-form" @submit.prevent="addCustomItem">
                <input v-model="newCustomTitle" type="text" class="db-input flex-1" placeholder="Item title..." required />
                <input v-model="newCustomStatus" type="text" class="db-input w-28" placeholder="Status" />
                <input
                  v-for="col in activeTracker.columns"
                  :key="col"
                  v-model="newCustomData[col]"
                  type="text"
                  class="db-input"
                  :placeholder="col"
                />
                <Button type="submit" size="sm">
                  <PlusIcon data-icon="inline-start" />
                  Add Row
                </Button>
              </form>

              <div v-if="activeTrackerItems.length === 0" class="db-empty">No rows in {{ activeTracker.name }} yet.</div>

              <div v-else class="overflow-x-auto">
                <table class="db-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Status</th>
                      <th v-for="col in activeTracker.columns" :key="col">{{ col }}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in activeTrackerItems" :key="row.id">
                      <td class="font-medium">{{ row.title }}</td>
                      <td><span class="otto-chip otto-chip-neutral">{{ row.status }}</span></td>
                      <td v-for="col in activeTracker.columns" :key="col">{{ row.data[col] || "—" }}</td>
                      <td>
                        <Button type="button" variant="ghost" size="icon-xs" class="text-destructive hover:text-destructive" aria-label="Delete row" @click="removeCustomItem(row.id)">
                          <XIcon />
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <AlertDialog :open="Boolean(trackerPendingDelete)" @update:open="(open) => { if (!open) trackerPendingDelete = null; }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle class="font-mono text-sm">Delete custom tracker?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes tracker <strong>{{ trackerPendingDelete }}</strong> and all of its saved rows.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="confirmRemoveTracker">
            Delete Tracker
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
