<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";
import type { StudioTab } from "./ChatHeader.vue";
import LearnedPlaybooksCard from "./LearnedPlaybooksCard.vue";
import OttoMascot from "./OttoMascot.vue";
import StudioDatabaseView from "./StudioDatabaseView.vue";
import WorkspaceFileManager, {
  type WorkspaceEntry,
  type WorkspaceStats,
} from "./WorkspaceFileManager.vue";

export interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  updatedAt: string | null;
  status: string;
}

export interface CalendarWakeupHook {
  qstashId: string;
  kind: "one_shot" | "recurring_cron";
  label: string;
  triggerAt: string | null;
  cron: string | null;
  offsetMinutes: number | null;
  prompt: string;
  status: "armed" | "cancelled";
}

export interface CalendarEventItem {
  id: string;
  title: string;
  type: "stream" | "collab" | "upload" | "reminder" | "deadline";
  startAt: string;
  endAt: string | null;
  cron: string | null;
  notes: string;
  status: "planned" | "done" | "cancelled";
  source?: "local" | "google";
  googleEventId?: string | null;
  googleHtmlLink?: string | null;
  wakeups: CalendarWakeupHook[];
  createdAt: string;
  updatedAt: string;
}

const props = defineProps<{
  activeTab: StudioTab;
  refreshTick: number;
  workspaceRefreshTick: number;
  dbRefreshTick: number;
  mascotColor: string;
  statusState: "ready" | "busy" | "error";
  swatches: string[];
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: StudioTab];
  selectMascotColor: [color: string];
  countsUpdated: [counts: { schedule: number; files: number; database: number; playbooks: number; connectors: number }];
  askPrompt: [prompt: string];
  openSetup: [];
}>();
const workspaceInitialPath = ref("");
const loading = ref(false);

const dossierContent = ref("");
const dossierUpdatedAt = ref<string | null>(null);
const connectors = ref<ConnectorInfo[]>([]);
const workspaceStats = ref<WorkspaceStats>({ totalBytes: 0, fileCount: 0, clipCount: 0 });
const recentFiles = ref<WorkspaceEntry[]>([]);
const dbSummary = ref({
  pipelineCount: 0,
  coreCount: 0,
  experimentCount: 0,
  contactsCount: 0,
  trackersCount: 0,
});
const learningSummary = ref({
  enabled: false,
  timezone: "UTC",
  lastRunAt: null as string | null,
  running: false,
  pendingCount: 0,
  activeCount: 0,
});
const calendarEvents = ref<CalendarEventItem[]>([]);
const cancellingEventId = ref<string | null>(null);
const syncingGoogle = ref(false);
const googleSyncNote = ref("");
const quickAddText = ref("");

// Live ticking clock for (Y)our next stream. countdown widget
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  clearInterval(tickTimer ?? undefined);
});

const nowDate = new Date();
const viewYear = ref(nowDate.getFullYear());
const viewMonth = ref(nowDate.getMonth());
const selectedDayKey = ref<string | null>(null);

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

const dossierSnapshot = computed(() => {
  const md = dossierContent.value || "";
  const pick = (re: RegExp): string => {
    const m = md.match(re);
    return m ? m[1].replace(/[*`]/g, "").trim() : "";
  };
  const persona = pick(/-\s*\*\*Name\s*\/\s*Persona:\*\*\s*(.+)/i);
  const timezone = pick(/-\s*\*\*Timezone:\*\*\s*(.+)/i);
  const niche = pick(/-\s*\*\*Niche\s*&\s*Core\s*Vibe:\*\*\s*(.+)/i);
  const youtube = pick(/-\s*\*\*YouTube:\*\*\s*(.+)/i);
  const pendingCount = (md.match(/\(not set|\(pending/gi) || []).length;
  const firstName =
    persona && !/not set/i.test(persona)
      ? persona.split(/[\s—(/-]+/)[0]
      : "Creator";
  const tzShort =
    timezone && !/not set/i.test(timezone)
      ? timezone.split("(")[0].trim().slice(0, 22)
      : "Timezone unset";
  return { persona, timezone, tzShort, firstName, niche, youtube, pendingCount };
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function toLocalDayKey(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const todayKey = computed(() => toLocalDayKey(new Date()) || "");

const activeCalendarEvents = computed(() =>
  calendarEvents.value.filter((e) => e.status !== "cancelled")
);

const upcomingEvents = computed(() => {
  const cutoff = nowTick.value - 2 * 60 * 60 * 1000;
  return activeCalendarEvents.value.filter((e) => {
    if (e.cron) return true;
    const t = Date.parse(e.startAt);
    return Number.isNaN(t) || t >= cutoff;
  });
});

const nextEvent = computed(() => upcomingEvents.value[0] || null);

const nextStreamCountdown = computed(() => {
  if (!nextEvent.value) return "--:--:--";
  const targetMs = Date.parse(nextEvent.value.startAt);
  if (Number.isNaN(targetMs)) return "--:--:--";
  const diffSec = Math.max(0, Math.floor((targetMs - nowTick.value) / 1000));
  if (diffSec === 0) return "LIVE NOW";
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
});

const armedWakeups = computed(() => {
  const nowMs = nowTick.value;
  const list: Array<{ hook: CalendarWakeupHook; eventTitle: string }> = [];
  for (const evt of activeCalendarEvents.value) {
    for (const w of evt.wakeups || []) {
      if (w.status !== "armed") continue;
      if (w.kind === "one_shot" && w.triggerAt && Date.parse(w.triggerAt) < nowMs - 60_000) continue;
      list.push({ hook: w, eventTitle: evt.title });
    }
  }
  return list.sort((a, b) => {
    const ta = a.hook.triggerAt ? Date.parse(a.hook.triggerAt) : Number.MAX_SAFE_INTEGER;
    const tb = b.hook.triggerAt ? Date.parse(b.hook.triggerAt) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
});

const monthLabel = computed(() =>
  new Date(viewYear.value, viewMonth.value, 1).toLocaleString([], {
    month: "long",
    year: "numeric",
  })
);

const eventsByDay = computed(() => {
  const map = new Map<string, CalendarEventItem[]>();
  for (const evt of activeCalendarEvents.value) {
    const key = toLocalDayKey(evt.startAt);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(evt);
    map.set(key, list);
  }
  return map;
});

interface CalendarCell {
  key: string | null;
  day: number | null;
  isToday: boolean;
  isSelected: boolean;
  dots: string[];
}

const calendarCells = computed<CalendarCell[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < leading; i++) {
    cells.push({ key: null, day: null, isToday: false, isSelected: false, dots: [] });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${viewYear.value}-${String(viewMonth.value + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayEvents = eventsByDay.value.get(key) || [];
    const dots: string[] = [];
    for (const evt of dayEvents.slice(0, 3)) {
      if (evt.type === "stream" || evt.type === "collab") dots.push("dot-ink");
      else if (evt.type === "upload") dots.push("dot-success");
      else dots.push("dot-warn");
    }
    cells.push({
      key,
      day,
      isToday: key === todayKey.value,
      isSelected: key === selectedDayKey.value,
      dots,
    });
  }
  return cells;
});

const visibleAgendaEvents = computed(() => {
  if (selectedDayKey.value) {
    return eventsByDay.value.get(selectedDayKey.value) || [];
  }
  return activeCalendarEvents.value;
});

function shiftMonth(delta: number) {
  const next = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = next.getFullYear();
  viewMonth.value = next.getMonth();
}

function toggleDay(key: string | null) {
  if (!key) return;
  selectedDayKey.value = selectedDayKey.value === key ? null : key;
}

function eventTypeBadgeClass(type: CalendarEventItem["type"]): string {
  if (type === "stream" || type === "collab") return "otto-chip-ink";
  if (type === "upload") return "otto-chip-cyan";
  return "otto-chip-yellow";
}

function formatHookOffset(hook: CalendarWakeupHook): string {
  if (hook.kind === "recurring_cron" && hook.cron) return `Cron ${hook.cron}`;
  if (typeof hook.offsetMinutes === "number") {
    if (hook.offsetMinutes === 0) return "At start";
    const abs = Math.abs(hook.offsetMinutes);
    const sign = hook.offsetMinutes < 0 ? "T-" : "T+";
    if (abs % 60 === 0) return `${sign}${abs / 60}h`;
    return `${sign}${abs}m`;
  }
  return hook.triggerAt ? formatTime(hook.triggerAt) : "Armed";
}

function submitQuickAdd() {
  const text = quickAddText.value.trim();
  if (!text) return;
  quickAddText.value = "";
  const hiddenDirective =
    '<hidden>Use the todo tool to track missing details needed to finalize this schedule (and copy-paste YouTube Studio waiting room pack if it is a stream/collab). Prefix non-blocking items with "(Optional)". Once all required items are clear, immediately create the calendar event and mark required tasks done.</hidden>';
  emit("askPrompt", `I want to add this to calendar: ${text}\n${hiddenDirective}`);
}

async function cancelEvent(eventId: string) {
  cancellingEventId.value = eventId;
  try {
    const res = await fetch(`/api/calendar/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await fetchAll();
    }
  } finally {
    cancellingEventId.value = null;
  }
}

async function syncGoogleCalendar() {
  syncingGoogle.value = true;
  googleSyncNote.value = "";
  try {
    const res = await fetch("/api/calendar/sync", { method: "POST" });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      connected?: boolean;
      added?: number;
      updated?: number;
      events?: CalendarEventItem[];
      error?: string;
    } | null;
    if (data?.ok) {
      if (Array.isArray(data.events)) calendarEvents.value = data.events;
      googleSyncNote.value = `Synced (+${data.added ?? 0}, ~${data.updated ?? 0})`;
      emitCounts();
    } else if (data && data.connected === false) {
      googleSyncNote.value = "GCal not connected";
    } else {
      googleSyncNote.value = data?.error || "Sync failed";
    }
  } catch {
    googleSyncNote.value = "Sync failed";
  } finally {
    syncingGoogle.value = false;
  }
}

function openFilesAt(dirPath = "") {
  workspaceInitialPath.value = dirPath;
  emit("update:activeTab", "files");
}

function askAboutWorkspaceEntry(entry: WorkspaceEntry) {
  const hidden = `<hidden>Workspace file absolute path: ${entry.absPath} (relative: ${entry.relPath}, type: ${entry.kind})</hidden>`;
  if (entry.kind === "image") {
    emit(
      "askPrompt",
      `Run the Squint Test on my thumbnail draft "${entry.name}" and give concrete revision notes for my human artist.\n${hidden}`
    );
    return;
  }
  if (entry.kind === "video") {
    emit(
      "askPrompt",
      `Watch my clip "${entry.name}" and critique the first 3-second hook, pacing, dead air, and editor notes.\n${hidden}`
    );
    return;
  }
  emit(
    "askPrompt",
    `Read and review my workspace file "${entry.relPath}" and give me sharp Otto feedback.\n${hidden}`
  );
}

function emitCounts() {
  emit("countsUpdated", {
    schedule: activeCalendarEvents.value.length,
    files: workspaceStats.value.fileCount,
    database: dbSummary.value.pipelineCount,
    playbooks: learningSummary.value.activeCount + learningSummary.value.pendingCount,
    connectors: connectors.value.length,
  });
}

async function fetchAll() {
  loading.value = true;
  try {
    const [dRes, calRes, cRes, wsRes, dbRes, learnRes] = await Promise.all([
      fetch("/api/dossier").then((r) => r.json()).catch(() => null),
      fetch("/api/calendar").then((r) => r.json()).catch(() => null),
      fetch("/api/connectors").then((r) => r.json()).catch(() => null),
      fetch("/api/workspace/list").then((r) => r.json()).catch(() => null),
      fetch("/api/db/overview").then((r) => r.json()).catch(() => null),
      fetch("/api/learning").then((r) => r.json()).catch(() => null),
    ]);
    if (dRes && typeof dRes === "object") {
      dossierContent.value = String(dRes.content || "");
      dossierUpdatedAt.value = dRes.updatedAt || null;
    }
    if (calRes && typeof calRes === "object") {
      calendarEvents.value = Array.isArray(calRes.events) ? calRes.events : [];
    }
    if (cRes && typeof cRes === "object") {
      connectors.value = Array.isArray(cRes.connectors) ? cRes.connectors : [];
    } else {
      connectors.value = [];
    }
    if (wsRes && typeof wsRes === "object") {
      if (wsRes.stats) workspaceStats.value = wsRes.stats;
      if (Array.isArray(wsRes.recentFiles)) recentFiles.value = wsRes.recentFiles;
    }
    if (dbRes && typeof dbRes === "object") {
      const tables = dbRes.tables || {};
      const ratio = dbRes.threePlusOne || {};
      dbSummary.value = {
        pipelineCount: Number(tables.content_pipeline || 0),
        coreCount: Number(ratio.core || 0),
        experimentCount: Number(ratio.experiment || 0),
        contactsCount: Number(tables.contacts || 0),
        trackersCount: Array.isArray(dbRes.customTrackers) ? dbRes.customTrackers.length : 0,
      };
    }
    if (learnRes && typeof learnRes === "object") {
      const cfg = learnRes.config || {};
      const skills = Array.isArray(learnRes.skills) ? learnRes.skills : [];
      learningSummary.value = {
        enabled: Boolean(cfg.enabled),
        timezone: String(cfg.timezone || "UTC"),
        lastRunAt: cfg.lastRunAt ? String(cfg.lastRunAt) : null,
        running: Boolean(cfg.running),
        pendingCount: skills.filter((s: { status?: string }) => s?.status === "pending").length,
        activeCount: skills.filter((s: { status?: string }) => s?.status === "active").length,
      };
    }
    emitCounts();
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.refreshTick,
  () => {
    fetchAll();
  },
  { immediate: true }
);

defineExpose({ fetchAll });
</script>

<template>
  <section class="mc-workspace">
    <!-- MOBILE SECTION PILLS (visible <= 1024px since header hides desktop nav) -->
    <div class="mobile-nav-strip">
      <button
        v-for="tab in (['overview', 'schedule', 'files', 'database', 'playbooks', 'dossier', 'connectors'] as StudioTab[])"
        :key="tab"
        type="button"
        class="m-nav-pill"
        :class="{ active: props.activeTab === tab }"
        @click="emit('update:activeTab', tab)"
      >
        {{ tab === 'files' ? 'Files' : tab === 'database' ? 'DB' : tab[0].toUpperCase() + tab.slice(1) }}
      </button>
    </div>

    <!-- VIEW 1: OTTO STUDIO BENTO OVERVIEW -->
    <div v-if="props.activeTab === 'overview'" class="overview-stack">
      <!-- TOP STUDIO HERO ROW (Greeting on Canvas + Sprite Weather Tile + Live Countdown Clock) -->
      <div class="hero-row">
        <div class="hero-greeting">
          <h1 class="hero-h1">
            <span>Hi {{ dossierSnapshot.firstName }}, </span>
            <OttoMascot :size="30" :color="mascotColor" :state="statusState" class="inline-mascot" />
            <br />
            <span>Otto is </span>
            <span class="mark-y">(y)</span><span>our</span>
            <br />
            <span>stream manager.</span>
          </h1>
          <div class="hero-pills">
            <span class="canvas-pill">{{ dossierSnapshot.tzShort }}</span>
            <button type="button" class="canvas-pill" @click="fetchAll">
              {{ loading ? "syncing..." : "sync studio" }}
            </button>
          </div>
          <div class="swatch-row" aria-label="Otto avatar color swatches">
            <button
              v-for="sw in swatches"
              :key="sw"
              type="button"
              class="swatch-dot"
              :class="{ active: mascotColor === sw }"
              :style="{ background: sw }"
              :title="`Set Otto swatch ${sw}`"
              @click="emit('selectMascotColor', sw)"
            ></button>
          </div>
        </div>

        <!-- MINI WIDGET 1: (Y)our sprite. (Atmospheric Sky Tile) -->
        <button
          type="button"
          class="otto-card sprite-tile"
          @click="emit('update:activeTab', 'connectors')"
        >
          <div class="otto-card-head">(Y)our sprite.</div>
          <div class="sprite-sky">
            <div class="sprite-sun" :class="{ busy: statusState === 'busy' }"></div>
          </div>
          <div class="sprite-foot">
            <div class="sky-val">{{ connectors.length }} live</div>
            <div class="sky-sub">Fly.io Sprite · $0 idle</div>
          </div>
        </button>

        <!-- MINI WIDGET 2: (Y)our next stream. (Digital Clock Countdown Tile) -->
        <div class="otto-card clock-tile">
          <div class="otto-card-head">(Y)our next stream.</div>
          <div class="clock-body">
            <div class="clock-digits">{{ nextStreamCountdown }}</div>
            <div class="clock-sub truncate">
              {{ nextEvent ? `${nextEvent.title} · ${formatTime(nextEvent.startAt)}` : "No stream scheduled yet" }}
            </div>
            <button
              type="button"
              class="btn btn-xs btn-otto-secondary clock-btn"
              @click="
                nextEvent
                  ? emit('askPrompt', `Let's prep for my scheduled ${nextEvent.type} '${nextEvent.title}' (${nextEvent.startAt}). Review run-of-show, Buffer drafts, and readiness.`)
                  : emit('update:activeTab', 'schedule')
              "
            >
              {{ nextEvent ? "Prep with Otto" : "Schedule Stream" }}
            </button>
          </div>
        </div>
      </div>

      <!-- 2x2 CORE STUDIO BENTO GRID -->
      <div class="bento-grid">
        <!-- BENTO 1: (Y)our schedule. -->
        <div class="otto-card bento-card">
          <div class="otto-card-head">
            <span>(Y)our schedule.</span>
            <div class="otto-card-head-right">
              <button
                type="button"
                class="head-link"
                :disabled="syncingGoogle"
                @click="syncGoogleCalendar"
              >
                {{ syncingGoogle ? "..." : "sync" }}
              </button>
              <button type="button" class="head-link" @click="emit('update:activeTab', 'schedule')">
                all →
              </button>
            </div>
          </div>

          <div class="otto-card-body">
            <form class="cal-quick-add" @submit.prevent="submitQuickAdd">
              <input
                v-model="quickAddText"
                type="text"
                class="pill-input"
                placeholder="Quick-add stream, collab, or reminder..."
              />
              <button
                type="submit"
                class="btn btn-sm btn-otto-primary quick-plus"
                :disabled="!quickAddText.trim()"
                aria-label="Add to calendar"
              >
                +
              </button>
            </form>
            <div v-if="googleSyncNote" class="text-[11px] font-mono text-[var(--fg-muted)]">{{ googleSyncNote }}</div>

            <div v-if="upcomingEvents.length === 0" class="empty-inset">
              No upcoming events yet. Type above and hit <strong>+</strong> to lock one with Otto.
            </div>

            <div v-else class="space-y-2">
              <div v-for="evt in upcomingEvents.slice(0, 3)" :key="evt.id" class="sub-item-card">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="otto-chip" :class="eventTypeBadgeClass(evt.type)">{{ evt.type }}</span>
                    <a
                      v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                      :href="evt.googleHtmlLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="otto-chip otto-chip-success no-underline"
                    >
                      GCal ↗
                    </a>
                    <span class="text-[11px] font-mono text-[var(--fg-muted)]">
                      {{ evt.cron ? evt.cron : formatTime(evt.startAt) }}
                    </span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="btn btn-xs btn-otto-secondary"
                      @click="emit('askPrompt', `Let's prep for my scheduled ${evt.type} '${evt.title}' (${evt.startAt}). Review run-of-show, Buffer drafts, and readiness.`)"
                    >
                      Prep
                    </button>
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost text-error"
                      :disabled="cancellingEventId === evt.id"
                      @click="cancelEvent(evt.id)"
                    >
                      {{ cancellingEventId === evt.id ? "..." : "✕" }}
                    </button>
                  </div>
                </div>
                <div class="font-medium text-sm mt-1">{{ evt.title }}</div>
                <div v-if="evt.wakeups && evt.wakeups.some((w) => w.status === 'armed')" class="flex flex-wrap gap-1 mt-1.5">
                  <span
                    v-for="hook in evt.wakeups.filter((w) => w.status === 'armed')"
                    :key="hook.qstashId"
                    class="otto-chip otto-chip-yellow"
                  >
                    ⏰ {{ formatHookOffset(hook) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- BENTO 2: (Y)our dossier. -->
        <div class="otto-card bento-card">
          <div class="otto-card-head">
            <span>(Y)our dossier.</span>
            <div class="otto-card-head-right">
              <button type="button" class="head-link" @click="emit('update:activeTab', 'dossier')">
                open →
              </button>
            </div>
          </div>

          <div class="otto-card-body">
            <div class="snapshot-rows">
              <div class="snapshot-row">
                <span class="snapshot-key">persona</span>
                <span class="snapshot-val">{{ dossierSnapshot.persona || "Not set yet" }}</span>
              </div>
              <div class="snapshot-row">
                <span class="snapshot-key">timezone</span>
                <span class="snapshot-val">{{ dossierSnapshot.timezone || "Not set yet" }}</span>
              </div>
              <div v-if="dossierSnapshot.youtube" class="snapshot-row">
                <span class="snapshot-key">youtube</span>
                <span class="snapshot-val">{{ dossierSnapshot.youtube }}</span>
              </div>
              <div v-else-if="dossierSnapshot.niche" class="snapshot-row">
                <span class="snapshot-key">niche</span>
                <span class="snapshot-val">{{ dossierSnapshot.niche }}</span>
              </div>
              <div class="snapshot-row">
                <span class="snapshot-key">homework #1</span>
                <span class="snapshot-val">
                  <span class="otto-chip" :class="dossierSnapshot.pendingCount === 0 ? 'otto-chip-success' : 'otto-chip-yellow'">
                    {{
                      dossierSnapshot.pendingCount === 0
                        ? "complete"
                        : `${dossierSnapshot.pendingCount} field(s) pending`
                    }}
                  </span>
                </span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 mt-auto pt-2">
              <button
                class="btn btn-xs btn-otto-primary flex-1"
                type="button"
                @click="emit('askPrompt', 'Review my current dossier, goals, and schedule and tell me what needs attention next.')"
              >
                Audit Dossier
              </button>
              <button
                class="btn btn-xs btn-otto-secondary flex-1"
                type="button"
                @click="emit('askPrompt', 'Audit my latest YouTube uploads and roast my titles & thumbnails (Squint Test).')"
              >
                Audit YouTube
              </button>
            </div>
          </div>
        </div>

        <!-- BENTO 3: (Y)our workspace. (Unified Files + Clips + 3+1 DB link) -->
        <div class="otto-card bento-card">
          <div class="otto-card-head">
            <span>(Y)our workspace.</span>
            <div class="otto-card-head-right">
              <button type="button" class="head-link" @click="openFilesAt('clips')">
                clips ({{ workspaceStats.clipCount }})
              </button>
              <button type="button" class="head-link" @click="openFilesAt('')">
                all →
              </button>
            </div>
          </div>

          <div class="otto-card-body">
            <div v-if="recentFiles.length === 0" class="empty-inset space-y-2.5">
              <div>Shared 2-way studio desk. Upload human thumbnail drafts, CSVs, or ask Otto to cut raw VOD clips (.mp4 + .srt).</div>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-xs btn-otto-primary" type="button" @click="openFilesAt('uploads')">
                  + Upload Files
                </button>
                <button
                  class="btn btn-xs btn-otto-secondary"
                  type="button"
                  @click="emit('askPrompt', 'Help me find hype moments and cut raw clips from my latest livestream VOD.')"
                >
                  Scan VOD
                </button>
              </div>
            </div>

            <div v-else class="space-y-2">
              <div v-for="file in recentFiles.slice(0, 3)" :key="file.relPath" class="sub-item-card">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="font-medium text-sm truncate">{{ file.name }}</div>
                    <div class="text-[11px] font-mono text-[var(--fg-muted)] truncate">
                      /{{ file.relPath }} · {{ formatBytes(file.sizeBytes) }}
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      class="btn btn-xs btn-otto-primary"
                      @click="askAboutWorkspaceEntry(file)"
                    >
                      {{ file.kind === "image" ? "Squint" : file.kind === "video" ? "Review" : "Ask Otto" }}
                    </button>
                    <a
                      :href="`/api/workspace/file?path=${encodeURIComponent(file.relPath)}&download=1`"
                      class="btn btn-xs btn-otto-secondary no-underline"
                      title="Download"
                    >
                      ↓
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div class="db-mini-strip mt-auto">
              <span>(Y)our 3+1: <strong>{{ dbSummary.coreCount }}</strong> Core / <strong>{{ dbSummary.experimentCount }}</strong> Exp · {{ dbSummary.contactsCount }} contacts</span>
              <button type="button" class="head-link" @click="emit('update:activeTab', 'database')">
                db →
              </button>
            </div>
          </div>
        </div>

        <!-- BENTO 4: (Y)our connectors. -->
        <div class="otto-card bento-card">
          <div class="otto-card-head">
            <span>(Y)our connectors.</span>
            <div class="otto-card-head-right">
              <button type="button" class="head-link" @click="emit('update:activeTab', 'connectors')">
                details →
              </button>
            </div>
          </div>

          <div class="otto-card-body">
            <div class="connector-chips">
              <div v-for="c in connectors" :key="`${c.provider}-${c.displayName}`" class="connector-chip">
                <span class="conn-dot"></span>
                <span class="truncate">{{ c.displayName }}</span>
              </div>
              <div v-if="connectors.length === 0" class="text-xs font-mono text-[var(--fg-muted)]">
                No Sprites Connectors detected yet.
              </div>
            </div>
          </div>
        </div>

        <!-- BENTO 5: (Y)our playbooks. (Hermes Nightly Self-Learning) -->
        <div class="otto-card bento-card">
          <div class="otto-card-head">
            <span>(Y)our playbooks.</span>
            <div class="otto-card-head-right">
              <button type="button" class="head-link" @click="emit('update:activeTab', 'playbooks')">
                {{ learningSummary.pendingCount > 0 ? `review (${learningSummary.pendingCount}) →` : "manage →" }}
              </button>
            </div>
          </div>

          <div class="otto-card-body">
            <div class="connector-chips">
              <div class="connector-chip">
                <span class="conn-dot"></span>
                <span>{{ learningSummary.activeCount }} active SOP{{ learningSummary.activeCount === 1 ? "" : "s" }}</span>
              </div>
              <div class="connector-chip">
                <span>{{ learningSummary.pendingCount }} pending review</span>
              </div>
              <div class="connector-chip">
                <span>
                  {{
                    learningSummary.running
                      ? "Reflecting now..."
                      : learningSummary.enabled
                        ? `Nightly 00:00 (${learningSummary.timezone})`
                        : "Nightly paused"
                  }}
                </span>
              </div>
            </div>
            <div class="db-mini-strip mt-auto">
              <span>
                {{
                  learningSummary.lastRunAt
                    ? `Last reflection ${formatTime(learningSummary.lastRunAt)}`
                    : "Otto drafts channel-specific SOPs overnight for your approval."
                }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 2: FULL SCHEDULE CALENDAR -->
    <div v-else-if="props.activeTab === 'schedule'" class="detail-stack">
      <div class="schedule-split">
        <div class="otto-card">
          <div class="otto-card-head">
            <span>(Y)our calendar.</span>
            <div class="otto-card-head-right">
              <button type="button" class="head-link" :disabled="syncingGoogle" @click="syncGoogleCalendar">
                {{ syncingGoogle ? "..." : "sync" }}
              </button>
              <a href="/api/calendar/export.ics" download="lma-schedule.ics" class="head-link no-underline">.ics</a>
            </div>
          </div>

          <div class="otto-card-body">
            <div class="flex items-center justify-between gap-2">
              <button class="btn btn-xs btn-otto-secondary" type="button" @click="shiftMonth(-1)">‹</button>
              <span class="font-mono text-xs font-medium">{{ monthLabel }}</span>
              <button class="btn btn-xs btn-otto-secondary" type="button" @click="shiftMonth(1)">›</button>
            </div>
            <div v-if="googleSyncNote" class="text-[11px] font-mono text-[var(--fg-muted)]">{{ googleSyncNote }}</div>
            <div class="cal-weekdays">
              <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
            </div>
            <div class="cal-grid">
              <button
                v-for="(cell, idx) in calendarCells"
                :key="cell.key || `pad-${idx}`"
                type="button"
                class="cal-cell"
                :class="{
                  'is-empty': !cell.day,
                  'is-today': cell.isToday,
                  'is-selected': cell.isSelected,
                }"
                :disabled="!cell.day"
                @click="toggleDay(cell.key)"
              >
                <span v-if="cell.day" class="cal-day-num">{{ cell.day }}</span>
                <span v-if="cell.dots.length" class="cal-dots">
                  <span v-for="(dot, dIdx) in cell.dots" :key="dIdx" class="cal-dot" :class="dot"></span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div class="otto-card">
          <div class="otto-card-head">
            <span>(Y)our agenda.</span>
            <div v-if="selectedDayKey" class="otto-card-head-right">
              <button type="button" class="head-link" @click="selectedDayKey = null">show all</button>
            </div>
          </div>

          <div class="otto-card-body">
            <form class="cal-quick-add" @submit.prevent="submitQuickAdd">
              <input
                v-model="quickAddText"
                type="text"
                class="pill-input"
                placeholder="Add stream, collab, or reminder..."
              />
              <button
                type="submit"
                class="btn btn-sm btn-otto-primary quick-plus"
                :disabled="!quickAddText.trim()"
                aria-label="Add to calendar"
              >
                +
              </button>
            </form>

            <div v-if="visibleAgendaEvents.length === 0" class="empty-inset">
              {{ selectedDayKey ? `No events on ${selectedDayKey}.` : "No events scheduled yet. Type above and hit + to add one." }}
            </div>

            <div v-else class="space-y-2.5">
              <div v-for="evt in visibleAgendaEvents" :key="evt.id" class="sub-item-card space-y-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="otto-chip" :class="eventTypeBadgeClass(evt.type)">{{ evt.type }}</span>
                  <a
                    v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                    :href="evt.googleHtmlLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="otto-chip otto-chip-success no-underline"
                  >
                    GCal ↗
                  </a>
                  <span class="text-[11px] font-mono text-[var(--fg-muted)]">
                    {{ evt.cron ? `Cron: ${evt.cron}` : formatTime(evt.startAt) }}
                  </span>
                </div>
                <div class="font-medium text-sm">{{ evt.title }}</div>
                <div v-if="evt.notes" class="text-xs text-[var(--fg-muted)] leading-relaxed">{{ evt.notes }}</div>

                <div v-if="evt.wakeups && evt.wakeups.some((w) => w.status === 'armed')" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="hook in evt.wakeups.filter((w) => w.status === 'armed')"
                    :key="hook.qstashId"
                    class="otto-chip otto-chip-yellow"
                  >
                    ⏰ {{ formatHookOffset(hook) }}
                    <template v-if="hook.triggerAt"> · {{ formatTime(hook.triggerAt) }}</template>
                  </span>
                </div>

                <div class="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    class="btn btn-xs btn-otto-secondary flex-1"
                    @click="emit('askPrompt', `Let's prep for my scheduled ${evt.type} '${evt.title}' (${evt.startAt}). Review run-of-show, Buffer drafts, and readiness.`)"
                  >
                    Ask Otto to Prep
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost text-error"
                    :disabled="cancellingEventId === evt.id"
                    @click="cancelEvent(evt.id)"
                  >
                    {{ cancellingEventId === evt.id ? "..." : "Cancel" }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 3: UNIFIED WORKSPACE FILE MANAGER & CLIPS -->
    <div v-else-if="props.activeTab === 'files'" class="detail-stack">
      <WorkspaceFileManager
        :refresh-tick="props.workspaceRefreshTick"
        :initial-path="workspaceInitialPath"
        @ask-prompt="emit('askPrompt', $event)"
        @stats-updated="(p) => { workspaceStats = p.stats; recentFiles = p.recentFiles; emitCounts(); }"
      />
    </div>

    <!-- VIEW 4: UNIFIED STUDIO DATABASE (SQLITE WAL) -->
    <div v-else-if="props.activeTab === 'database'" class="detail-stack">
      <StudioDatabaseView
        :refresh-tick="props.dbRefreshTick"
        @ask-prompt="emit('askPrompt', $event)"
        @open-workspace-path="openFilesAt"
        @overview-updated="(p) => { dbSummary = p; emitCounts(); }"
      />
    </div>

    <!-- VIEW 5: LEARNED CREATOR PLAYBOOKS -->
    <div v-else-if="props.activeTab === 'playbooks'" class="detail-stack">
      <LearnedPlaybooksCard :refresh-tick="props.dbRefreshTick + props.refreshTick" />
    </div>

    <!-- VIEW 5: FULL TALENT DOSSIER -->
    <div v-else-if="props.activeTab === 'dossier'" class="detail-stack">
      <div class="otto-card">
        <div class="otto-card-head">
          <span>(Y)our dossier.</span>
          <div class="otto-card-head-right">
            <button
              class="btn btn-xs btn-otto-primary"
              type="button"
              @click="emit('askPrompt', 'Review my current goals, schedule, and 3+1 stream tracker and tell me what needs attention next.')"
            >
              Audit with Otto
            </button>
          </div>
        </div>
        <div class="otto-card-body">
          <div class="text-[11px] font-mono text-[var(--fg-muted)]">
            {{ dossierUpdatedAt ? `Updated ${formatTime(dossierUpdatedAt)}` : "Persistent Studio Memory" }}
          </div>
          <div v-if="dossierHtml" class="md-content text-sm" v-html="dossierHtml"></div>
          <div v-else class="empty-inset">
            No talent dossier yet. Ask Otto to run onboarding!
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 6: SPRITES CONNECTORS -->
    <div v-else class="detail-stack">
      <div class="otto-card">
        <div class="otto-card-head">
          <span>(Y)our connectors.</span>
          <div class="otto-card-head-right">
            <button type="button" class="head-link" @click="emit('openSetup')">
              re-run setup
            </button>
          </div>
        </div>
        <div class="otto-card-body">
          <div class="connectors-grid">
            <div v-for="c in connectors" :key="`${c.provider}-${c.displayName}`" class="sub-item-card">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs font-medium">{{ c.displayName }}</span>
                <span class="otto-chip otto-chip-success">live</span>
              </div>
              <div class="text-[11px] font-mono text-[var(--fg-muted)] mt-1">
                {{ c.provider }} · {{ c.connectionType }}
              </div>
              <div v-if="c.description" class="text-xs text-[var(--fg-muted)] mt-1">{{ c.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mc-workspace {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 2px 4px 12px 2px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mobile-nav-strip {
  display: none;
  flex-shrink: 0;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: none;
}
.m-nav-pill {
  padding: 5px 11px;
  border: none;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.9);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.m-nav-pill.active {
  background: var(--fg);
  color: #ffffff;
}

.overview-stack,
.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* HERO ROW: Greeting on Canvas + Sky Sprite Tile + Digital Countdown Clock */
.hero-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.15fr) 175px minmax(220px, 1fr);
  gap: 16px;
  align-items: stretch;
}
.hero-greeting {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 4px 4px 4px 2px;
}
.hero-h1 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(24px, 2.2vw, 33px);
  font-weight: 400;
  line-height: 1.22;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.inline-mascot {
  margin-left: 2px;
  margin-bottom: 3px;
}
.hero-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.canvas-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 13px;
  border: none;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.78);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.canvas-pill:hover {
  background: #ffffff;
}
.swatch-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 2px;
}
.swatch-dot {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  border: 1.5px solid rgba(48, 48, 48, 0.25);
  cursor: pointer;
  padding: 0;
  transition: transform var(--duration-fast) var(--ease-out);
}
.swatch-dot:hover {
  transform: scale(1.18);
}
.swatch-dot.active {
  box-shadow: 0 0 0 2px #ffffff, 0 0 0 3.5px #303030;
}

/* Sprite Atmospheric Weather-style Tile */
.sprite-tile {
  border: none;
  padding: 0;
  text-align: center;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}
.sprite-tile:hover {
  transform: translateY(-1px);
}
.sprite-sky {
  flex: 1;
  min-height: 76px;
  background: linear-gradient(180deg, #8ec5fc 0%, #d4ebff 100%);
  display: grid;
  place-items: center;
}
.sprite-sun {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-pill);
  background: radial-gradient(circle at 35% 35%, #fff59d 0%, #facc15 65%, #eab308 100%);
  box-shadow: 0 4px 12px rgba(234, 179, 8, 0.35);
}
.sprite-sun.busy {
  animation: sun-pulse 1.4s ease-in-out infinite;
}
@keyframes sun-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
.sprite-foot {
  padding: 10px 10px 12px;
  background: #ffffff;
}
.sprite-foot-main {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--fg);
}
.sprite-foot-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-muted);
  margin-top: 2px;
}

/* Digital Countdown Clock Widget */
.clock-body {
  flex: 1;
  padding: 14px 18px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}
.clock-digits {
  font-family: var(--font-mono);
  font-size: clamp(26px, 2.3vw, 34px);
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1.1;
  color: var(--fg);
}
.clock-sub {
  max-width: 100%;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}
.clock-btn {
  padding: 0 18px;
}

/* 2x2 Bento Grid */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.bento-card {
  min-height: 220px;
}
.head-link {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 6px;
}
.head-link:hover {
  color: var(--fg);
  background: var(--surface-alt);
}

.cal-quick-add {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pill-input {
  flex: 1;
  min-width: 0;
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}
.pill-input:focus {
  box-shadow: var(--shadow-focus);
}
.quick-plus {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 16px;
}

.sub-item-card {
  background: var(--surface-alt);
  border-radius: 14px;
  padding: 10px 12px;
}
.empty-inset {
  background: var(--surface-alt);
  border-radius: 14px;
  padding: 14px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-muted);
  line-height: 1.5;
}

.snapshot-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.snapshot-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.snapshot-key {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-muted);
}
.snapshot-val {
  font-size: 12.5px;
  color: var(--fg);
  line-height: 1.4;
}

.db-mini-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}

.connector-chips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.connector-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 12px;
  background: var(--surface-alt);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg);
  min-width: 0;
}
.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: #16a34a;
  flex-shrink: 0;
}

/* Schedule Split */
.schedule-split {
  display: grid;
  grid-template-columns: minmax(250px, 310px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.cal-cell {
  aspect-ratio: 1;
  border: none;
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11.5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.cal-cell.is-empty {
  background: transparent;
  cursor: default;
}
.cal-cell.is-today {
  background: var(--highlight-yellow);
  font-weight: 600;
}
.cal-cell.is-selected {
  background: var(--fg);
  color: #ffffff;
}
.cal-dots {
  display: flex;
  gap: 2px;
}
.cal-dot {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-pill);
}
.dot-ink { background: var(--fg); }
.cal-cell.is-selected .dot-ink { background: #ffffff; }
.dot-success { background: #16a34a; }
.dot-warn { background: #ca8a04; }

.connectors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

@media (max-width: 1024px) {
  .mobile-nav-strip {
    display: flex;
  }
}
@media (max-width: 900px) {
  .hero-row {
    grid-template-columns: 1fr;
  }
  .bento-grid,
  .schedule-split {
    grid-template-columns: 1fr;
  }
}
</style>
