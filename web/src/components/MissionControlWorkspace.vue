<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";

export interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  updatedAt: string | null;
  status: string;
}

export interface ClipItem {
  videoId: string;
  name: string;
  filename: string;
  mp4Url: string;
  srtUrl: string | null;
  sizeBytes: number;
  updatedAt: string;
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
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  guardrailsUpdated: [payload: { zeroLocalKeys: boolean | null; aiMediaDisabled: boolean | null }];
}>();

const activeTab = ref<"overview" | "schedule" | "dossier" | "clips" | "connectors">("overview");
const loading = ref(false);

const dossierContent = ref("");
const dossierUpdatedAt = ref<string | null>(null);
const connectors = ref<ConnectorInfo[]>([]);
const zeroLocalKeys = ref<boolean | null>(null);
const aiMediaDisabled = ref<boolean | null>(null);
const clips = ref<ClipItem[]>([]);
const previewClipUrl = ref<string | null>(null);
const calendarEvents = ref<CalendarEventItem[]>([]);
const cancellingEventId = ref<string | null>(null);
const syncingGoogle = ref(false);
const googleSyncNote = ref("");
const quickAddText = ref("");

const nowDate = new Date();
const viewYear = ref(nowDate.getFullYear());
const viewMonth = ref(nowDate.getMonth());
const selectedDayKey = ref<string | null>(null);

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

// Extract compact at-a-glance snapshot fields from MEMORY.md
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
  const isDraft = /auto-discovered draft/i.test(md);
  return { persona, timezone, niche, youtube, pendingCount, isDraft };
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
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  return activeCalendarEvents.value.filter((e) => {
    if (e.cron) return true;
    const t = Date.parse(e.startAt);
    return Number.isNaN(t) || t >= cutoff;
  });
});

const nextEvent = computed(() => upcomingEvents.value[0] || null);

const armedWakeups = computed(() => {
  const nowMs = Date.now();
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

const nextWakeup = computed(() => armedWakeups.value[0] || null);

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
      if (evt.type === "stream" || evt.type === "collab") dots.push("dot-accent");
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
  if (type === "stream" || type === "collab") return "chip-accent";
  if (type === "upload") return "chip-success";
  return "chip-warn";
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

async function fetchAll() {
  loading.value = true;
  try {
    const [dRes, calRes, cRes, clRes] = await Promise.all([
      fetch("/api/dossier").then((r) => r.json()).catch(() => null),
      fetch("/api/calendar").then((r) => r.json()).catch(() => null),
      fetch("/api/connectors").then((r) => r.json()).catch(() => null),
      fetch("/api/clips").then((r) => r.json()).catch(() => null),
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
      zeroLocalKeys.value = typeof cRes.zeroLocalKeys === "boolean" ? cRes.zeroLocalKeys : null;
      aiMediaDisabled.value = typeof cRes.aiMediaDisabled === "boolean" ? cRes.aiMediaDisabled : null;
    } else {
      zeroLocalKeys.value = null;
      aiMediaDisabled.value = null;
    }
    emit("guardrailsUpdated", {
      zeroLocalKeys: zeroLocalKeys.value,
      aiMediaDisabled: aiMediaDisabled.value,
    });
    if (clRes && typeof clRes === "object") {
      clips.value = Array.isArray(clRes.clips) ? clRes.clips : [];
    }
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
    <!-- TOP KPI GLANCE STRIP -->
    <div class="kpi-grid">
      <button type="button" class="kpi-card" @click="activeTab = 'schedule'">
        <div class="kpi-label">NEXT SCHEDULED</div>
        <div class="kpi-value">
          {{ nextEvent ? formatTime(nextEvent.startAt) : "Open Slot" }}
        </div>
        <div class="kpi-sub">
          {{ nextEvent ? nextEvent.title : "Add stream or reminder below" }}
        </div>
      </button>

      <button type="button" class="kpi-card" @click="activeTab = 'schedule'">
        <div class="kpi-label">ARMED WAKE-UPS</div>
        <div class="kpi-value">
          {{ armedWakeups.length }} <span class="kpi-unit">armed</span>
        </div>
        <div class="kpi-sub">
          {{
            nextWakeup?.hook.triggerAt
              ? `Sprite wakes ${formatTime(nextWakeup.hook.triggerAt)}`
              : "Idle sleep ($0/hr)"
          }}
        </div>
      </button>

      <button type="button" class="kpi-card" @click="activeTab = 'connectors'">
        <div class="kpi-label">ZERO-KEY GATEWAY</div>
        <div class="kpi-value">
          {{ connectors.length }} <span class="kpi-unit">live</span>
        </div>
        <div class="kpi-sub">
          {{
            zeroLocalKeys === true
              ? "0 outbound API keys in VM"
              : zeroLocalKeys === false
                ? "Check VM env"
                : "Checking gateway..."
          }}
        </div>
      </button>

      <button type="button" class="kpi-card" @click="activeTab = 'clips'">
        <div class="kpi-label">RAW CLIPS SHELF</div>
        <div class="kpi-value">
          {{ clips.length }} <span class="kpi-unit">.mp4</span>
        </div>
        <div class="kpi-sub">
          {{ clips.length > 0 ? "Ready for human editor (.mp4 + .srt)" : "No VOD clips cut yet" }}
        </div>
      </button>
    </div>

    <!-- WORKSPACE NAV TABS -->
    <div class="mc-nav-row">
      <div class="mc-tabs">
        <button type="button" class="mc-tab" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">
          Overview
        </button>
        <button type="button" class="mc-tab" :class="{ active: activeTab === 'schedule' }" @click="activeTab = 'schedule'">
          Schedule ({{ activeCalendarEvents.length }})
        </button>
        <button type="button" class="mc-tab" :class="{ active: activeTab === 'dossier' }" @click="activeTab = 'dossier'">
          Dossier
        </button>
        <button type="button" class="mc-tab" :class="{ active: activeTab === 'clips' }" @click="activeTab = 'clips'">
          Clips ({{ clips.length }})
        </button>
        <button type="button" class="mc-tab" :class="{ active: activeTab === 'connectors' }" @click="activeTab = 'connectors'">
          Connectors ({{ connectors.length }})
        </button>
      </div>
      <button class="btn btn-xs btn-cafe-secondary shrink-0" type="button" :disabled="loading" @click="fetchAll">
        {{ loading ? "Syncing..." : "Refresh" }}
      </button>
    </div>

    <!-- VIEW 1: AT-A-GLANCE OVERVIEW BENTO -->
    <div v-if="activeTab === 'overview'" class="bento-grid">
      <!-- BENTO 1: UPCOMING SCHEDULE & QUICK-ADD -->
      <div class="cafe-card bento-card">
        <div class="bento-head">
          <div>
            <div class="bento-title">Upcoming Schedule</div>
            <div class="bento-sub">Google Calendar + Auto Wake-Ups</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" class="btn btn-xs btn-cafe-secondary" :disabled="syncingGoogle" @click="syncGoogleCalendar">
              {{ syncingGoogle ? "..." : "Sync GCal" }}
            </button>
            <button type="button" class="btn btn-xs btn-ghost" @click="activeTab = 'schedule'">
              Calendar →
            </button>
          </div>
        </div>

        <form class="cal-quick-add" @submit.prevent="submitQuickAdd">
          <input
            v-model="quickAddText"
            type="text"
            class="cal-quick-input"
            placeholder="Quick-add stream, collab, or reminder..."
          />
          <button
            type="submit"
            class="btn btn-sm btn-cafe-primary cal-quick-btn"
            :disabled="!quickAddText.trim()"
            aria-label="Add to calendar"
            title="Add to calendar"
          >
            +
          </button>
        </form>
        <div v-if="googleSyncNote" class="text-[11px] font-mono opacity-75">{{ googleSyncNote }}</div>

        <div v-if="upcomingEvents.length === 0" class="empty-inset">
          No upcoming events yet. Type above and hit <strong>+</strong> to schedule with Professor L.
        </div>

        <div v-else class="space-y-2.5">
          <div v-for="evt in upcomingEvents.slice(0, 3)" :key="evt.id" class="sub-item-card">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="chip-pill" :class="eventTypeBadgeClass(evt.type)">{{ evt.type.toUpperCase() }}</span>
                <a
                  v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                  :href="evt.googleHtmlLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chip-pill chip-success no-underline"
                >
                  GCal ↗
                </a>
                <span class="text-[11px] font-mono opacity-75">
                  {{ evt.cron ? `Cron: ${evt.cron}` : formatTime(evt.startAt) }}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="btn btn-xs btn-cafe-secondary"
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
                class="wakeup-pill"
              >
                ⏰ {{ formatHookOffset(hook) }}
                <template v-if="hook.triggerAt"> · {{ formatTime(hook.triggerAt) }}</template>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- BENTO 2: TALENT DOSSIER SNAPSHOT -->
      <div class="cafe-card bento-card">
        <div class="bento-head">
          <div>
            <div class="bento-title">Talent Dossier</div>
            <div class="bento-sub">
              {{ dossierUpdatedAt ? `Updated ${formatTime(dossierUpdatedAt)}` : "Persistent Sprite Memory" }}
            </div>
          </div>
          <button type="button" class="btn btn-xs btn-ghost" @click="activeTab = 'dossier'">
            Full Dossier →
          </button>
        </div>

        <div class="snapshot-rows">
          <div class="snapshot-row">
            <span class="snapshot-key">PERSONA</span>
            <span class="snapshot-val">{{ dossierSnapshot.persona || "Not set yet" }}</span>
          </div>
          <div class="snapshot-row">
            <span class="snapshot-key">TIMEZONE</span>
            <span class="snapshot-val">{{ dossierSnapshot.timezone || "Not set yet" }}</span>
          </div>
          <div v-if="dossierSnapshot.youtube" class="snapshot-row">
            <span class="snapshot-key">YOUTUBE</span>
            <span class="snapshot-val">{{ dossierSnapshot.youtube }}</span>
          </div>
          <div v-else-if="dossierSnapshot.niche" class="snapshot-row">
            <span class="snapshot-key">NICHE</span>
            <span class="snapshot-val">{{ dossierSnapshot.niche }}</span>
          </div>
          <div class="snapshot-row">
            <span class="snapshot-key">HOMEWORK #1</span>
            <span class="snapshot-val">
              <span class="chip-pill" :class="dossierSnapshot.pendingCount === 0 ? 'chip-success' : 'chip-warn'">
                {{
                  dossierSnapshot.pendingCount === 0
                    ? "Complete"
                    : `${dossierSnapshot.pendingCount} field(s) pending`
                }}
              </span>
            </span>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 mt-auto pt-2">
          <button
            class="btn btn-xs btn-cafe-primary flex-1"
            type="button"
            @click="emit('askPrompt', 'Review my current dossier, goals, and schedule and tell me what needs attention next.')"
          >
            Audit Dossier
          </button>
          <button
            class="btn btn-xs btn-cafe-secondary flex-1"
            type="button"
            @click="emit('askPrompt', 'Audit my latest YouTube uploads and roast my titles & thumbnails (Squint Test).')"
          >
            Audit YouTube
          </button>
        </div>
      </div>

      <!-- BENTO 3: RAW CLIPS HAND-OFF SHELF -->
      <div class="cafe-card bento-card">
        <div class="bento-head">
          <div>
            <div class="bento-title">Raw Clips Shelf</div>
            <div class="bento-sub">Hype-Scanned .mp4 + .srt for Human Editor</div>
          </div>
          <button type="button" class="btn btn-xs btn-ghost" @click="activeTab = 'clips'">
            All Clips →
          </button>
        </div>

        <div v-if="clips.length === 0" class="empty-inset space-y-2.5">
          <div>No raw clips cut yet. Drop any YouTube VOD URL in chat and Professor L will scan live-chat hype spikes and cut raw clips.</div>
          <button
            class="btn btn-xs btn-cafe-secondary"
            type="button"
            @click="emit('askPrompt', 'Help me find hype moments and cut raw clips from my latest livestream VOD.')"
          >
            Scan a VOD for Hype Clips
          </button>
        </div>

        <div v-else class="space-y-2.5">
          <div v-for="clip in clips.slice(0, 2)" :key="clip.mp4Url" class="sub-item-card">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium text-sm truncate">{{ clip.name }}</div>
                <div class="text-[11px] font-mono opacity-70">
                  {{ formatBytes(clip.sizeBytes) }} · {{ formatTime(clip.updatedAt) }}
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="btn btn-xs btn-cafe-secondary"
                  @click="activeTab = 'clips'; previewClipUrl = clip.mp4Url"
                >
                  Preview
                </button>
                <a :href="clip.mp4Url" :download="clip.filename" class="btn btn-xs btn-cafe-primary">.mp4</a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BENTO 4: ZERO-KEY CONNECTORS & GUARDRAILS -->
      <div class="cafe-card bento-card">
        <div class="bento-head">
          <div>
            <div class="bento-title">Sprite Guardrails &amp; Connectors</div>
            <div class="bento-sub">Fly.io Sprites Gateway (Zero Local Keys)</div>
          </div>
          <button type="button" class="btn btn-xs btn-ghost" @click="activeTab = 'connectors'">
            Details →
          </button>
        </div>

        <div class="flex flex-wrap gap-2">
          <span
            class="chip-pill"
            :class="zeroLocalKeys === true ? 'chip-success' : zeroLocalKeys === false ? 'chip-error' : 'chip-warn'"
          >
            {{ zeroLocalKeys === true ? "✓ 0 Outbound Keys in VM" : zeroLocalKeys === false ? "Check Env" : "Unverified" }}
          </span>
          <span
            class="chip-pill"
            :class="aiMediaDisabled === true ? 'chip-error' : 'chip-warn'"
          >
            {{ aiMediaDisabled === true ? "✕ AI Art & Video: Disabled" : "AI Media: Unverified" }}
          </span>
        </div>

        <div class="connector-chips">
          <div v-for="c in connectors" :key="`${c.provider}-${c.displayName}`" class="connector-chip">
            <span class="conn-dot"></span>
            <span class="truncate">{{ c.displayName }}</span>
          </div>
          <div v-if="connectors.length === 0" class="text-xs font-mono opacity-70">
            No Sprites Connectors detected yet.
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 2: FULL SCHEDULE CALENDAR -->
    <div v-else-if="activeTab === 'schedule'" class="detail-stack">
      <div class="schedule-split">
        <div class="cafe-card !p-4">
          <div class="flex items-center justify-between gap-2 mb-3">
            <div class="flex items-center gap-1">
              <button class="btn btn-xs btn-ghost px-1.5" type="button" @click="shiftMonth(-1)">‹</button>
              <span class="text-sm font-medium">{{ monthLabel }}</span>
              <button class="btn btn-xs btn-ghost px-1.5" type="button" @click="shiftMonth(1)">›</button>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" class="btn btn-xs btn-cafe-secondary" :disabled="syncingGoogle" @click="syncGoogleCalendar">
                {{ syncingGoogle ? "Syncing..." : "Sync GCal" }}
              </button>
              <a href="/api/calendar/export.ics" download="lma-schedule.ics" class="btn btn-xs btn-ghost" title="Download .ics">
                .ics
              </a>
            </div>
          </div>
          <div v-if="googleSyncNote" class="text-[11px] font-mono opacity-75 mb-2">{{ googleSyncNote }}</div>

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
                'has-events': cell.dots.length > 0,
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

        <div class="space-y-3 min-w-0">
          <form class="cal-quick-add" @submit.prevent="submitQuickAdd">
            <input
              v-model="quickAddText"
              type="text"
              class="cal-quick-input"
              placeholder="Add stream, collab, or reminder..."
            />
            <button
              type="submit"
              class="btn btn-sm btn-cafe-primary cal-quick-btn"
              :disabled="!quickAddText.trim()"
              aria-label="Add to calendar"
            >
              +
            </button>
          </form>

          <div v-if="selectedDayKey" class="flex items-center justify-between text-xs font-mono opacity-80 px-1">
            <span>Filtered: {{ selectedDayKey }}</span>
            <button type="button" class="underline cursor-pointer" @click="selectedDayKey = null">Show all</button>
          </div>

          <div v-if="visibleAgendaEvents.length === 0" class="cafe-card">
            <div class="text-xs font-mono opacity-75">
              {{ selectedDayKey ? "No events scheduled on this day." : "No events scheduled yet. Type above and hit + to add one." }}
            </div>
          </div>

          <div v-else class="space-y-3">
            <div v-for="evt in visibleAgendaEvents" :key="evt.id" class="cafe-card space-y-2.5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="chip-pill" :class="eventTypeBadgeClass(evt.type)">{{ evt.type.toUpperCase() }}</span>
                    <a
                      v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                      :href="evt.googleHtmlLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="chip-pill chip-success no-underline"
                    >
                      GCal ↗
                    </a>
                    <span v-else-if="evt.googleEventId" class="chip-pill chip-success">GCal</span>
                    <span class="text-[11px] font-mono opacity-75">
                      {{ evt.cron ? `Cron: ${evt.cron}` : formatTime(evt.startAt) }}
                    </span>
                  </div>
                  <div class="font-medium text-sm mt-1.5">{{ evt.title }}</div>
                  <div v-if="evt.notes" class="text-xs opacity-75 mt-1 leading-relaxed">{{ evt.notes }}</div>
                </div>
              </div>

              <div v-if="evt.wakeups && evt.wakeups.some((w) => w.status === 'armed')" class="flex flex-wrap gap-1.5 pt-1">
                <span
                  v-for="hook in evt.wakeups.filter((w) => w.status === 'armed')"
                  :key="hook.qstashId"
                  class="wakeup-pill"
                >
                  ⏰ {{ formatHookOffset(hook) }}
                  <template v-if="hook.triggerAt"> · {{ formatTime(hook.triggerAt) }}</template>
                </span>
              </div>

              <div class="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  class="btn btn-xs btn-cafe-secondary flex-1"
                  @click="emit('askPrompt', `Let's prep for my scheduled ${evt.type} '${evt.title}' (${evt.startAt}). Review run-of-show, Buffer drafts, and readiness.`)"
                >
                  Ask L to Prep
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

    <!-- VIEW 3: FULL TALENT DOSSIER -->
    <div v-else-if="activeTab === 'dossier'" class="detail-stack">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs font-mono opacity-75">
          {{ dossierUpdatedAt ? `Last updated ${formatTime(dossierUpdatedAt)}` : "Persistent ~/.omp/agent/MEMORY.md" }}
        </div>
        <button
          class="btn btn-xs btn-cafe-primary"
          type="button"
          @click="emit('askPrompt', 'Review my current goals, schedule, and 3+1 stream tracker and tell me what needs attention next.')"
        >
          Ask Professor L to Audit Dossier
        </button>
      </div>
      <div v-if="dossierHtml" class="cafe-card md-content text-sm" v-html="dossierHtml"></div>
      <div v-else class="cafe-card text-xs font-mono opacity-80">
        No talent dossier yet. Ask Professor L to run onboarding!
      </div>
    </div>

    <!-- VIEW 4: RAW CLIPS HAND-OFF SHELF -->
    <div v-else-if="activeTab === 'clips'" class="detail-stack">
      <div v-if="clips.length === 0" class="cafe-card space-y-3">
        <div class="text-xs font-mono opacity-75">
          No raw clips cut yet. Paste any YouTube livestream VOD URL in chat and ask Professor L to find hype moments and cut raw clips.
        </div>
        <button
          class="btn btn-sm btn-cafe-primary"
          type="button"
          @click="emit('askPrompt', 'Help me find hype moments and cut raw clips from my latest livestream VOD.')"
        >
          Scan a VOD for Hype Clips
        </button>
      </div>

      <div v-else class="clips-grid">
        <div v-for="clip in clips" :key="clip.mp4Url" class="cafe-card space-y-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-sm truncate">{{ clip.name }}</div>
              <div class="text-[11px] font-mono opacity-70 mt-0.5">
                VOD {{ clip.videoId }} · {{ formatBytes(clip.sizeBytes) }} · {{ formatTime(clip.updatedAt) }}
              </div>
            </div>
          </div>

          <video
            v-if="previewClipUrl === clip.mp4Url"
            :src="clip.mp4Url"
            controls
            preload="metadata"
            class="w-full rounded-lg bg-black max-h-60"
          ></video>

          <div class="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              class="btn btn-xs btn-cafe-secondary"
              @click="previewClipUrl = previewClipUrl === clip.mp4Url ? null : clip.mp4Url"
            >
              {{ previewClipUrl === clip.mp4Url ? "Hide Preview" : "Preview" }}
            </button>
            <a :href="clip.mp4Url" :download="clip.filename" class="btn btn-xs btn-cafe-primary">
              Download .mp4
            </a>
            <a v-if="clip.srtUrl" :href="clip.srtUrl" :download="`${clip.name}.srt`" class="btn btn-xs btn-cafe-secondary">
              Download .srt
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- VIEW 5: ZERO-KEY CONNECTORS & GUARDRAILS -->
    <div v-else class="detail-stack">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="cafe-card !p-3.5">
          <div class="text-[11px] font-mono opacity-70">OUTBOUND API KEYS</div>
          <div class="mt-2">
            <span
              class="chip-pill"
              :class="zeroLocalKeys === true ? 'chip-success' : zeroLocalKeys === false ? 'chip-error' : 'chip-warn'"
            >
              {{ zeroLocalKeys === true ? "0 Keys in VM" : zeroLocalKeys === false ? "Check Env" : "Unverified" }}
            </span>
          </div>
        </div>
        <div class="cafe-card !p-3.5">
          <div class="text-[11px] font-mono opacity-70">AI ART &amp; VIDEO</div>
          <div class="mt-2">
            <span class="chip-pill" :class="aiMediaDisabled === true ? 'chip-error' : 'chip-warn'">
              {{ aiMediaDisabled === true ? "Disabled (Human Only)" : "Unverified" }}
            </span>
          </div>
        </div>
      </div>

      <div class="clips-grid">
        <div v-for="c in connectors" :key="`${c.provider}-${c.displayName}`" class="cafe-card !p-3.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-sm">{{ c.displayName }}</span>
            <span class="chip-pill chip-success">Live</span>
          </div>
          <div class="text-[11px] font-mono opacity-70 mt-1">
            {{ c.provider }} · {{ c.connectionType }}
          </div>
          <div v-if="c.description" class="text-xs opacity-75 mt-1">{{ c.description }}</div>
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
  padding: 18px 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.kpi-card {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-raised-sm);
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: transform var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}
.kpi-card:hover {
  transform: translateY(-1px);
  border-color: var(--accent-secondary);
}
.kpi-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--fg-muted);
}
.kpi-value {
  font-family: var(--font-serif);
  font-size: 20px;
  line-height: 1.15;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-unit {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}
.kpi-sub {
  font-size: 11.5px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mc-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.mc-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mc-tab {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-circle);
  background: var(--surface-alt);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: var(--shadow-raised-sm);
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.mc-tab.active {
  background: var(--accent);
  color: var(--accent-fg);
}

.bento-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.bento-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bento-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.bento-title {
  font-family: var(--font-serif);
  font-size: 17px;
  line-height: 1.15;
  color: var(--fg);
}
.bento-sub {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
  margin-top: 2px;
}

.cafe-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-raised);
  padding: 16px;
}
.sub-item-card {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
}
.empty-inset {
  background: var(--surface-inset);
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.45;
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
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.snapshot-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.snapshot-key {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-muted);
  letter-spacing: 0.04em;
}
.snapshot-val {
  font-size: 12.5px;
  color: var(--fg);
  line-height: 1.35;
}

.connector-chips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.connector-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
}
.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--success);
  flex-shrink: 0;
}

.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.schedule-split {
  display: grid;
  grid-template-columns: minmax(250px, 310px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.clips-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.chip-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: var(--radius-circle);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
}
.chip-success {
  background: var(--success-bg);
  color: var(--success);
}
.chip-error {
  background: var(--error-bg);
  color: var(--error);
}
.chip-warn {
  background: var(--warning-bg);
  color: var(--warning);
}
.chip-accent {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.cal-cell {
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}
.cal-cell:hover:not(.is-empty) {
  background: var(--surface-alt);
}
.cal-cell.is-empty {
  cursor: default;
}
.cal-cell.is-today {
  border-color: var(--accent);
  font-weight: 600;
}
.cal-cell.is-selected {
  background: var(--accent);
  color: var(--accent-fg);
}
.cal-cell.is-selected .cal-dot {
  background: var(--accent-fg);
}
.cal-dots {
  display: flex;
  gap: 2px;
}
.cal-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
}
.dot-accent {
  background: var(--accent);
}
.dot-success {
  background: var(--success);
}
.dot-warn {
  background: var(--warning);
}
.wakeup-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-circle);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 10px;
  border: 1px solid var(--border);
}
.cal-quick-add {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cal-quick-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-inset);
  color: var(--fg);
  font-size: 13px;
  box-shadow: var(--shadow-inset);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
.cal-quick-input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}
.cal-quick-input::placeholder {
  color: var(--fg-muted);
  opacity: 0.75;
}
.cal-quick-btn {
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bento-grid,
  .schedule-split,
  .clips-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .mc-workspace {
    padding: 12px 12px 24px;
  }
  .connector-chips {
    grid-template-columns: 1fr;
  }
}
</style>
