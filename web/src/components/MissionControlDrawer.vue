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
  wakeups: CalendarWakeupHook[];
  createdAt: string;
  updatedAt: string;
}

const props = defineProps<{
  open: boolean;
  refreshTick: number;
}>();

const emit = defineEmits<{
  close: [];
  askPrompt: [prompt: string];
}>();

const activeTab = ref<"dossier" | "schedule" | "connectors" | "clips">("dossier");
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

const nowDate = new Date();
const viewYear = ref(nowDate.getFullYear());
const viewMonth = ref(nowDate.getMonth());
const selectedDayKey = ref<string | null>(null);

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

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
  // Monday-first grid (0 = Mon ... 6 = Sun)
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
    if (clRes && typeof clRes === "object") {
      clips.value = Array.isArray(clRes.clips) ? clRes.clips : [];
    }
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.refreshTick],
  ([isOpen]) => {
    if (isOpen) fetchAll();
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="open" class="mc-backdrop" @click="emit('close')"></div>

  <aside class="mc-drawer" :class="{ open }">
    <div class="mc-head">
      <div>
        <div class="mc-title">Mission Control</div>
        <div class="mc-sub">Live Sprite State</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-xs btn-cafe-secondary" type="button" :disabled="loading" @click="fetchAll">
          {{ loading ? "..." : "Refresh" }}
        </button>
        <button class="btn btn-xs btn-ghost" type="button" @click="emit('close')">✕</button>
      </div>
    </div>

    <!-- CafeBlend Pill Tabs -->
    <div class="mc-tabs">
      <button
        type="button"
        class="mc-tab"
        :class="{ active: activeTab === 'dossier' }"
        @click="activeTab = 'dossier'"
      >
        Dossier
      </button>
      <button
        type="button"
        class="mc-tab"
        :class="{ active: activeTab === 'schedule' }"
        @click="activeTab = 'schedule'"
      >
        Schedule ({{ activeCalendarEvents.length }})
      </button>
      <button
        type="button"
        class="mc-tab"
        :class="{ active: activeTab === 'connectors' }"
        @click="activeTab = 'connectors'"
      >
        Connectors ({{ connectors.length }})
      </button>
      <button
        type="button"
        class="mc-tab"
        :class="{ active: activeTab === 'clips' }"
        @click="activeTab = 'clips'"
      >
        Clips ({{ clips.length }})
      </button>
    </div>

    <!-- Panel Body -->
    <div class="mc-body">
      <!-- TAB 1: TALENT DOSSIER -->
      <section v-if="activeTab === 'dossier'" class="space-y-4">
        <div class="flex items-center justify-between text-xs font-mono opacity-75">
          <span>Persistent Talent Dossier</span>
          <span v-if="dossierUpdatedAt">Updated {{ formatTime(dossierUpdatedAt) }}</span>
        </div>

        <div v-if="dossierHtml" class="cafe-card md-content text-sm" v-html="dossierHtml"></div>
        <div v-else class="cafe-card text-xs font-mono opacity-80">
          No talent dossier recorded yet. Start onboarding with Professor L to populate your Goals,
          Ideal Schedule, 3 GOATs, and 3+1 Stream Tracker.
        </div>

        <button
          class="btn btn-sm btn-cafe-primary w-full"
          type="button"
          @click="emit('askPrompt', 'Review my current goals, schedule, and 3+1 stream tracker and tell me what needs attention next.')"
        >
          Ask Professor L to Audit My Dossier
        </button>
      </section>
      <!-- TAB 2: INTEGRATED STREAM SCHEDULE & QSTASH WAKE-UPS -->
      <section v-else-if="activeTab === 'schedule'" class="space-y-4">
        <div class="cafe-card !p-3.5">
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <div class="flex items-center gap-1.5">
              <button class="btn btn-xs btn-ghost px-1.5" type="button" @click="shiftMonth(-1)">‹</button>
              <span class="text-sm font-medium">{{ monthLabel }}</span>
              <button class="btn btn-xs btn-ghost px-1.5" type="button" @click="shiftMonth(1)">›</button>
            </div>
            <a
              href="/api/calendar/export.ics"
              download="lma-schedule.ics"
              class="btn btn-xs btn-cafe-secondary"
            >
              Export .ics
            </a>
          </div>

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

        <div v-if="selectedDayKey" class="flex items-center justify-between text-xs font-mono opacity-80 px-1">
          <span>Filtered: {{ selectedDayKey }}</span>
          <button type="button" class="underline cursor-pointer" @click="selectedDayKey = null">
            Show all
          </button>
        </div>

        <div v-if="visibleAgendaEvents.length === 0" class="cafe-card space-y-3">
          <div class="text-xs font-mono opacity-75">
            {{ selectedDayKey ? "No events scheduled on this day." : "No streams, collabs, or wake-ups scheduled yet." }}
          </div>
          <button
            class="btn btn-sm btn-cafe-primary w-full"
            type="button"
            @click="emit('askPrompt', 'Help me schedule my next stream on the calendar with pre-stream and post-stream VOD wake-up hooks.')"
          >
            Plan a Stream with Wake-Up Hooks
          </button>
        </div>

        <div v-else class="space-y-3">
          <div v-for="evt in visibleAgendaEvents" :key="evt.id" class="cafe-card space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="chip-pill" :class="eventTypeBadgeClass(evt.type)">
                    {{ evt.type.toUpperCase() }}
                  </span>
                  <span class="text-[11px] font-mono opacity-75">
                    {{ evt.cron ? `Cron: ${evt.cron}` : formatTime(evt.startAt) }}
                  </span>
                </div>
                <div class="font-medium text-sm mt-1.5">{{ evt.title }}</div>
                <div v-if="evt.notes" class="text-xs opacity-75 mt-1 leading-relaxed">
                  {{ evt.notes }}
                </div>
              </div>
            </div>

            <div
              v-if="evt.wakeups && evt.wakeups.some((w) => w.status === 'armed')"
              class="flex flex-wrap gap-1.5 pt-1"
            >
              <span
                v-for="hook in evt.wakeups.filter((w) => w.status === 'armed')"
                :key="hook.qstashId"
                class="wakeup-pill"
                :title="hook.triggerAt ? `Wakes Sprite at ${formatTime(hook.triggerAt)}` : hook.label"
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
      </section>

      <!-- TAB 2: ZERO-KEY CONNECTORS & GUARDRAILS -->
      <section v-else-if="activeTab === 'connectors'" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="cafe-card !p-3">
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
          <div class="cafe-card !p-3">
            <div class="text-[11px] font-mono opacity-70">AI ART &amp; VIDEO</div>
            <div class="mt-2">
              <span
                class="chip-pill"
                :class="aiMediaDisabled === true ? 'chip-error' : 'chip-warn'"
              >
                {{ aiMediaDisabled === true ? "Disabled" : aiMediaDisabled === false ? "Enabled" : "Unverified" }}
              </span>
            </div>
          </div>
        </div>

        <div class="text-xs font-mono opacity-75 pt-1">
          Live Fly.io Sprites Gateway Connectors
        </div>

        <div v-if="connectors.length === 0" class="cafe-card text-xs font-mono opacity-75">
          No active connectors reported by gateway.
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="c in connectors"
            :key="c.displayName + c.provider"
            class="cafe-card !p-3.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-sm">{{ c.displayName }}</span>
              <span class="chip-pill chip-success">LIVE</span>
            </div>
            <div class="mt-1 text-[11px] font-mono opacity-70">
              provider: {{ c.provider }} · auth: {{ c.connectionType }}
            </div>
            <p v-if="c.description" class="mt-1.5 text-xs opacity-80">
              {{ c.description }}
            </p>
          </div>
        </div>
      </section>

      <!-- TAB 3: RAW CLIP HAND-OFF SHELF -->
      <section v-else class="space-y-4">
        <div class="cafe-card !p-3 text-xs font-mono">
          Human-Editor Hand-Off Shelf — raw <code>.mp4</code> + synced <code>.srt</code> cuts
          (strictly zero AI video editing).
        </div>

        <div v-if="clips.length === 0" class="cafe-card text-xs font-mono opacity-80 space-y-3">
          <div>No raw clips cut yet.</div>
          <button
            class="btn btn-sm btn-cafe-primary w-full"
            type="button"
            @click="emit('askPrompt', 'Scan my latest YouTube livestream VOD for the top 3 clippable hype moments.')"
          >
            Scan Latest VOD for Clips
          </button>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="clip in clips"
            :key="clip.mp4Url"
            class="cafe-card !p-3.5 space-y-2.5"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-semibold text-sm truncate">{{ clip.name }}</div>
                <div class="text-[11px] font-mono opacity-70">
                  VOD {{ clip.videoId }} · {{ formatBytes(clip.sizeBytes) }} · {{ formatTime(clip.updatedAt) }}
                </div>
              </div>
              <button
                class="btn btn-xs btn-cafe-secondary shrink-0"
                type="button"
                @click="previewClipUrl = previewClipUrl === clip.mp4Url ? null : clip.mp4Url"
              >
                {{ previewClipUrl === clip.mp4Url ? "Hide" : "Preview" }}
              </button>
            </div>

            <video
              v-if="previewClipUrl === clip.mp4Url"
              :src="clip.mp4Url"
              controls
              preload="metadata"
              class="w-full rounded-lg bg-black max-h-56"
            ></video>

            <div class="flex items-center gap-2">
              <a
                :href="`${clip.mp4Url}?download=1`"
                class="btn btn-xs btn-cafe-primary flex-1"
              >
                Download .mp4
              </a>
              <a
                v-if="clip.srtUrl"
                :href="`${clip.srtUrl}?download=1`"
                class="btn btn-xs btn-cafe-secondary flex-1"
              >
                Download .srt
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.mc-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(62, 39, 35, 0.25);
  z-index: 25;
}
.mc-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 94vw;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 30;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 200ms var(--ease-out);
}
.mc-drawer.open {
  transform: translateX(0);
}
.mc-head {
  height: var(--header-height);
  flex-shrink: 0;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mc-title {
  font-family: var(--font-serif);
  font-size: 19px;
  line-height: 1.1;
  color: var(--fg);
}
.mc-sub {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}
.mc-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.mc-tab {
  flex: 1;
  padding: 6px 6px;
  border: none;
  border-radius: var(--radius-circle);
  background: var(--surface-alt);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 10.5px;
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
.mc-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px;
}
.cafe-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-raised);
  padding: 16px;
}
.chip-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--radius-circle);
  font-family: var(--font-mono);
  font-size: 11px;
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
  background: var(--surface-alt);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 10.5px;
  border: 1px solid var(--border);
}
</style>
