<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "vue-sonner";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, CalendarWakeupHook } from "@/types/calendar";

type CalendarViewMode = "month" | "week" | "agenda";

const props = defineProps<{
  refreshTick?: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  eventsUpdated: [count: number];
}>();

const events = ref<CalendarEventItem[]>([]);
const loading = ref(false);
const syncingGoogle = ref(false);
const cancellingEventId = ref<string | null>(null);
const updatingEventId = ref<string | null>(null);
const viewMode = ref<CalendarViewMode>("month");

const now = new Date();
const viewYear = ref(now.getFullYear());
const viewMonth = ref(now.getMonth());
const anchorDate = ref(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
const selectedDayKey = ref<string | null>(toLocalDayKey(now));
const quickAddText = ref("");

// New Event dialog state
const newEventOpen = ref(false);
const newTitle = ref("");
const newType = ref<CalendarEventItem["type"]>("stream");
const newDate = ref(toLocalDayKey(now) || "");
const newTime = ref("20:00");
const newNotes = ref("");
const savingNewEvent = ref(false);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toLocalDayKey(isoOrDate: string | Date): string | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateTime(iso: string | null): string {
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

function formatDayHeading(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  return hook.triggerAt ? formatDateTime(hook.triggerAt) : "Armed";
}

function eventPillClass(evt: CalendarEventItem): string {
  if (evt.status === "done") {
    return "bg-[#ededed] text-muted-foreground line-through border-transparent";
  }
  if (evt.type === "stream") return "bg-[#303030] text-white border-[#303030]";
  if (evt.type === "collab") return "bg-violet-100 text-violet-900 border-violet-200";
  if (evt.type === "upload") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (evt.type === "deadline") return "bg-rose-100 text-rose-900 border-rose-200";
  return "bg-amber-100 text-amber-900 border-amber-200";
}

function eventAccentBarClass(type: CalendarEventItem["type"]): string {
  if (type === "stream") return "bg-[#303030]";
  if (type === "collab") return "bg-violet-500";
  if (type === "upload") return "bg-emerald-500";
  if (type === "deadline") return "bg-rose-500";
  return "bg-amber-500";
}

const todayKey = computed(() => toLocalDayKey(new Date()) || "");

const activeEvents = computed(() =>
  events.value
    .filter((e) => e.status !== "cancelled")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
);

const googleSyncedCount = computed(
  () => activeEvents.value.filter((e) => e.source === "google" || Boolean(e.googleEventId)).length
);

const eventsByDay = computed(() => {
  const map = new Map<string, CalendarEventItem[]>();
  for (const evt of activeEvents.value) {
    const key = toLocalDayKey(evt.startAt);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(evt);
    map.set(key, list);
  }
  return map;
});

interface MonthCell {
  key: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: CalendarEventItem[];
}

const monthCells = computed<MonthCell[]>(() => {
  const firstOfMonth = new Date(viewYear.value, viewMonth.value, 1);
  const leading = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(viewYear.value, viewMonth.value, 1 - leading);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = toLocalDayKey(d) || "";
    const inCurrentMonth = d.getMonth() === viewMonth.value && d.getFullYear() === viewYear.value;
    cells.push({
      key,
      day: d.getDate(),
      inCurrentMonth,
      isToday: key === todayKey.value,
      isSelected: key === selectedDayKey.value,
      events: eventsByDay.value.get(key) || [],
    });
  }
  return cells;
});

interface WeekColumn {
  key: string;
  weekday: string;
  day: number;
  monthShort: string;
  isToday: boolean;
  isSelected: boolean;
  events: CalendarEventItem[];
}

const weekColumns = computed<WeekColumn[]>(() => {
  const base = anchorDate.value;
  const offsetToMonday = (base.getDay() + 6) % 7;
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offsetToMonday);
  const cols: WeekColumn[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = toLocalDayKey(d) || "";
    cols.push({
      key,
      weekday: WEEKDAYS[i],
      day: d.getDate(),
      monthShort: d.toLocaleString([], { month: "short" }),
      isToday: key === todayKey.value,
      isSelected: key === selectedDayKey.value,
      events: eventsByDay.value.get(key) || [],
    });
  }
  return cols;
});

const headerTitle = computed(() => {
  if (viewMode.value === "week") {
    const cols = weekColumns.value;
    if (cols.length === 7) {
      const first = cols[0];
      const last = cols[6];
      if (first.monthShort === last.monthShort) {
        return `${first.monthShort} ${first.day}–${last.day}, ${anchorDate.value.getFullYear()}`;
      }
      return `${first.monthShort} ${first.day} – ${last.monthShort} ${last.day}, ${anchorDate.value.getFullYear()}`;
    }
  }
  return new Date(viewYear.value, viewMonth.value, 1).toLocaleString([], {
    month: "long",
    year: "numeric",
  });
});

const inspectorEvents = computed(() => {
  if (selectedDayKey.value) {
    return eventsByDay.value.get(selectedDayKey.value) || [];
  }
  return activeEvents.value;
});

const groupedAgendaDays = computed(() => {
  const groups = new Map<string, CalendarEventItem[]>();
  for (const evt of activeEvents.value) {
    const key = toLocalDayKey(evt.startAt) || "unscheduled";
    const list = groups.get(key) || [];
    list.push(evt);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([key, list]) => ({
    key,
    label: key === todayKey.value ? `Today · ${formatDayHeading(key)}` : formatDayHeading(key),
    events: list,
  }));
});

function shiftPeriod(delta: number) {
  if (viewMode.value === "week") {
    const next = new Date(
      anchorDate.value.getFullYear(),
      anchorDate.value.getMonth(),
      anchorDate.value.getDate() + delta * 7
    );
    anchorDate.value = next;
    viewYear.value = next.getFullYear();
    viewMonth.value = next.getMonth();
    return;
  }
  const next = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = next.getFullYear();
  viewMonth.value = next.getMonth();
  anchorDate.value = next;
}

function goToday() {
  const today = new Date();
  viewYear.value = today.getFullYear();
  viewMonth.value = today.getMonth();
  anchorDate.value = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  selectedDayKey.value = toLocalDayKey(today);
}

function selectDay(key: string) {
  selectedDayKey.value = selectedDayKey.value === key ? null : key;
  const [y, m, d] = key.split("-").map(Number);
  if (y && m && d) {
    anchorDate.value = new Date(y, m - 1, d);
    viewYear.value = y;
    viewMonth.value = m - 1;
  }
}

function openNewEventModal(dayKey?: string) {
  newTitle.value = "";
  newType.value = "stream";
  newDate.value = dayKey || selectedDayKey.value || todayKey.value;
  newTime.value = "20:00";
  newNotes.value = "";
  newEventOpen.value = true;
}

async function fetchEvents() {
  loading.value = true;
  try {
    const res = await fetch("/api/calendar");
    if (res.ok) {
      const data = (await res.json()) as { events?: CalendarEventItem[] };
      events.value = Array.isArray(data.events) ? data.events : [];
      emit("eventsUpdated", activeEvents.value.length);
    }
  } finally {
    loading.value = false;
  }
}

async function syncGoogleCalendar() {
  syncingGoogle.value = true;
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
      if (Array.isArray(data.events)) {
        events.value = data.events;
        emit("eventsUpdated", activeEvents.value.length);
      }
      toast.success(`Synced Google Calendar (+${data.added ?? 0}, ~${data.updated ?? 0})`);
    } else if (data && data.connected === false) {
      toast.info("Google Calendar is not connected in Connectors.");
    } else {
      toast.error(data?.error || "Calendar sync failed");
    }
  } catch {
    toast.error("Calendar sync failed");
  } finally {
    syncingGoogle.value = false;
  }
}

async function createDirectEvent() {
  const title = newTitle.value.trim();
  if (!title || !newDate.value || savingNewEvent.value) return;
  const isoStart = new Date(`${newDate.value}T${newTime.value || "20:00"}:00`).toISOString();
  savingNewEvent.value = true;
  try {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        type: newType.value,
        startAt: isoStart,
        notes: newNotes.value.trim(),
      }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !data?.ok) {
      toast.error(data?.error || "Could not save event");
      return;
    }
    newEventOpen.value = false;
    selectedDayKey.value = newDate.value;
    toast.success(`Added "${title}"`);
    await fetchEvents();
  } finally {
    savingNewEvent.value = false;
  }
}

function scheduleWithOttoFromModal() {
  const title = newTitle.value.trim();
  if (!title) return;
  const datePart = newDate.value ? ` on ${newDate.value} at ${newTime.value || "20:00"}` : "";
  const notesPart = newNotes.value.trim() ? ` (Notes: ${newNotes.value.trim()})` : "";
  const hiddenDirective =
    '<hidden>Use the todo tool to track missing details needed to finalize this schedule (and copy-paste YouTube Studio waiting room pack if it is a stream/collab). Prefix non-blocking items with "(Optional)". Once all required items are clear, immediately create the calendar event and mark required tasks done.</hidden>';
  newEventOpen.value = false;
  emit(
    "askPrompt",
    `Schedule a ${newType.value}: "${title}"${datePart}${notesPart}\n${hiddenDirective}`
  );
}

function submitQuickAdd() {
  const text = quickAddText.value.trim();
  if (!text) return;
  quickAddText.value = "";
  const datePart = selectedDayKey.value ? ` on ${selectedDayKey.value}` : "";
  const hiddenDirective =
    '<hidden>Use the todo tool to track missing details needed to finalize this schedule (and copy-paste YouTube Studio waiting room pack if it is a stream/collab). Prefix non-blocking items with "(Optional)". Once all required items are clear, immediately create the calendar event and mark required tasks done.</hidden>';
  emit("askPrompt", `I want to add this to calendar${datePart}: ${text}\n${hiddenDirective}`);
}

async function toggleEventDone(evt: CalendarEventItem) {
  if (updatingEventId.value) return;
  updatingEventId.value = evt.id;
  const nextStatus = evt.status === "done" ? "planned" : "done";
  try {
    const res = await fetch(`/api/calendar/${encodeURIComponent(evt.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      await fetchEvents();
    }
  } finally {
    updatingEventId.value = null;
  }
}

async function cancelEvent(eventId: string) {
  cancellingEventId.value = eventId;
  try {
    const res = await fetch(`/api/calendar/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Event cancelled");
      await fetchEvents();
    }
  } finally {
    cancellingEventId.value = null;
  }
}

function prepWithOtto(evt: CalendarEventItem) {
  emit(
    "askPrompt",
    `Let's prep for my scheduled ${evt.type} '${evt.title}' (${evt.startAt}). Review run-of-show, Buffer drafts, and readiness.`
  );
}

watch(
  () => props.refreshTick,
  () => {
    void fetchEvents();
  },
  { immediate: true }
);

onMounted(() => {
  void fetchEvents();
});

defineExpose({ fetchEvents, openNewEventModal });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white select-none">
    <!-- TOP OS CALENDAR TOOLBAR -->
    <div class="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#ededed] bg-[#fafafa] px-4 py-2 shrink-0">
      <!-- Left: Today + Prev/Next + Month Year -->
      <div class="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="h-8 rounded-lg bg-white"
          @click="goToday"
        >
          Today
        </Button>

        <div class="flex items-center gap-0.5">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous period"
            @click="shiftPeriod(-1)"
          >
            <ChevronLeftIcon class="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next period"
            @click="shiftPeriod(1)"
          >
            <ChevronRightIcon class="size-4" />
          </Button>
        </div>

        <h2 class="text-sm sm:text-base font-semibold tracking-tight text-[#141414]">
          {{ headerTitle }}
        </h2>
      </div>

      <!-- Right: View Switcher + Sync + .ics + New Event -->
      <div class="flex items-center gap-2 flex-wrap">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          :model-value="viewMode"
          class="rounded-lg bg-[#ededed] p-0.5 gap-0.5"
          @update:model-value="(val) => { if (val === 'month' || val === 'week' || val === 'agenda') viewMode = val; }"
        >
          <ToggleGroupItem
            value="month"
            class="h-7 px-2.5 rounded-md border-0 text-xs data-[state=on]:bg-white data-[state=on]:shadow-2xs"
          >
            Month
          </ToggleGroupItem>
          <ToggleGroupItem
            value="week"
            class="h-7 px-2.5 rounded-md border-0 text-xs data-[state=on]:bg-white data-[state=on]:shadow-2xs"
          >
            Week
          </ToggleGroupItem>
          <ToggleGroupItem
            value="agenda"
            class="h-7 px-2.5 rounded-md border-0 text-xs data-[state=on]:bg-white data-[state=on]:shadow-2xs"
          >
            Agenda
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          type="button"
          size="sm"
          variant="outline"
          class="h-8 rounded-lg bg-white"
          :disabled="syncingGoogle"
          @click="syncGoogleCalendar"
        >
          <RefreshCwIcon :class="cn('size-3.5', syncingGoogle && 'animate-spin')" />
          <span class="hidden sm:inline">{{ syncingGoogle ? "Syncing…" : "Sync" }}</span>
        </Button>

        <a
          href="/api/calendar/export.ics"
          download="lma-schedule.ics"
          :class="cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 rounded-lg bg-white no-underline')"
          title="Export iCalendar (.ics)"
        >
          <DownloadIcon class="size-3.5" />
          <span class="hidden sm:inline">.ics</span>
        </a>

        <Button
          type="button"
          size="sm"
          class="h-8 rounded-lg"
          @click="openNewEventModal()"
        >
          <PlusIcon class="size-3.5" />
          <span>New Event</span>
        </Button>
      </div>
    </div>

    <!-- MAIN OS CALENDAR SPLIT BODY -->
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- LEFT/CENTER: MONTH / WEEK / AGENDA CANVAS -->
      <div class="flex flex-1 min-w-0 min-h-0 flex-col bg-white overflow-hidden">
        <!-- MONTH VIEW -->
        <template v-if="viewMode === 'month'">
          <div class="grid grid-cols-7 border-b border-[#ededed] bg-[#fafafa] shrink-0">
            <div
              v-for="wd in WEEKDAYS"
              :key="wd"
              class="px-2.5 py-1.5 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground border-r border-[#ededed] last:border-r-0"
            >
              {{ wd }}
            </div>
          </div>

          <div class="grid flex-1 min-h-0 grid-cols-7 grid-rows-6">
            <div
              v-for="cell in monthCells"
              :key="cell.key"
              role="button"
              tabindex="0"
              :class="
                cn(
                  'group relative flex min-h-0 flex-col gap-1 border-r border-b border-[#ededed] p-1.5 text-left transition-colors cursor-pointer overflow-hidden nth-[7n]:border-r-0',
                  !cell.inCurrentMonth && 'bg-[#fafafa]/70 text-muted-foreground/50',
                  cell.inCurrentMonth && 'bg-white hover:bg-[#f8f8f9]',
                  cell.isToday && 'bg-[#f9f5a2]/25',
                  cell.isSelected && 'ring-1 ring-inset ring-[#303030]/60 bg-[#f9f5a2]/35'
                )
              "
              @click="selectDay(cell.key)"
              @dblclick="openNewEventModal(cell.key)"
              @keydown.enter.prevent="selectDay(cell.key)"
            >
              <div class="flex items-center justify-between gap-1 shrink-0">
                <button
                  type="button"
                  title="Add event on this day"
                  class="opacity-0 group-hover:opacity-100 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/8 hover:text-foreground transition-opacity"
                  @click.stop="openNewEventModal(cell.key)"
                >
                  <PlusIcon class="size-3" />
                </button>
                <span
                  :class="
                    cn(
                      'inline-flex size-6 items-center justify-center rounded-full font-mono text-xs',
                      cell.isToday
                        ? 'bg-[#303030] text-white font-semibold'
                        : cell.inCurrentMonth
                          ? 'text-[#222] font-medium'
                          : 'text-muted-foreground/55'
                    )
                  "
                >
                  {{ cell.day }}
                </span>
              </div>

              <!-- Event pills inside the day cell -->
              <div class="flex flex-1 min-h-0 flex-col gap-0.5 overflow-hidden">
                <div
                  v-for="evt in cell.events.slice(0, 3)"
                  :key="evt.id"
                  :class="
                    cn(
                      'flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10.5px] leading-tight truncate',
                      eventPillClass(evt)
                    )
                  "
                  :title="`${formatShortTime(evt.startAt)} ${evt.title}`"
                >
                  <span v-if="!evt.cron" class="shrink-0 opacity-75 font-mono text-[9.5px]">
                    {{ formatShortTime(evt.startAt) }}
                  </span>
                  <span class="truncate font-medium">{{ evt.title }}</span>
                </div>
                <div
                  v-if="cell.events.length > 3"
                  class="px-1 font-mono text-[10px] text-muted-foreground"
                >
                  +{{ cell.events.length - 3 }} more
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- WEEK VIEW -->
        <template v-else-if="viewMode === 'week'">
          <div class="grid flex-1 min-h-0 grid-cols-7 divide-x divide-[#ededed] overflow-hidden">
            <div
              v-for="col in weekColumns"
              :key="col.key"
              class="flex min-w-0 flex-col min-h-0"
            >
              <button
                type="button"
                :class="
                  cn(
                    'flex flex-col items-center gap-0.5 border-b border-[#ededed] py-2 px-1 transition-colors shrink-0',
                    col.isToday ? 'bg-[#f9f5a2]/40' : 'bg-[#fafafa] hover:bg-[#f2f2f3]',
                    col.isSelected && 'ring-1 ring-inset ring-[#303030]/40'
                  )
                "
                @click="selectDay(col.key)"
              >
                <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {{ col.weekday }}
                </span>
                <span
                  :class="
                    cn(
                      'inline-flex size-7 items-center justify-center rounded-full font-mono text-xs font-semibold',
                      col.isToday ? 'bg-[#303030] text-white' : 'text-[#222]'
                    )
                  "
                >
                  {{ col.day }}
                </span>
              </button>

              <div class="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
                <button
                  v-for="evt in col.events"
                  :key="evt.id"
                  type="button"
                  :class="
                    cn(
                      'w-full rounded-lg border p-2 text-left text-xs transition-opacity hover:opacity-90',
                      eventPillClass(evt)
                    )
                  "
                  @click="selectDay(col.key)"
                >
                  <div class="font-mono text-[10px] opacity-80">
                    {{ evt.cron ? evt.cron : formatShortTime(evt.startAt) }}
                  </div>
                  <div class="font-medium leading-snug line-clamp-2">{{ evt.title }}</div>
                </button>
                <button
                  type="button"
                  class="w-full rounded-lg border border-dashed border-transparent py-2 text-[11px] font-mono text-muted-foreground/0 hover:border-[#d9d9d9] hover:text-muted-foreground transition-colors"
                  @click="openNewEventModal(col.key)"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- AGENDA VIEW -->
        <template v-else>
          <div class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
            <div
              v-if="groupedAgendaDays.length === 0"
              class="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-center"
            >
              <CalendarDaysIcon class="size-8 text-muted-foreground/50" />
              <div class="text-sm font-medium text-[#303030]">No upcoming events scheduled</div>
              <p class="text-xs text-muted-foreground max-w-sm">
                Click <strong>New Event</strong> or ask Otto to lock in your next stream, collab, or upload.
              </p>
              <Button type="button" size="sm" @click="openNewEventModal()">
                <PlusIcon class="size-3.5" />
                New Event
              </Button>
            </div>

            <div v-for="group in groupedAgendaDays" :key="group.key" class="space-y-2">
              <div class="sticky top-0 bg-white/95 backdrop-blur-xs py-1 border-b border-[#ededed] font-mono text-xs font-semibold text-[#303030]">
                {{ group.label }}
              </div>
              <div class="space-y-2">
                <div
                  v-for="evt in group.events"
                  :key="evt.id"
                  class="flex items-start justify-between gap-3 rounded-xl border border-[#ededed] bg-[#fafafa] p-3"
                >
                  <div class="flex items-start gap-3 min-w-0">
                    <span :class="cn('mt-1 h-8 w-1 rounded-full shrink-0', eventAccentBarClass(evt.type))" />
                    <div class="min-w-0 space-y-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" class="font-mono text-[10px] uppercase">
                          {{ evt.type }}
                        </Badge>
                        <span class="font-mono text-xs text-muted-foreground">
                          {{ evt.cron ? `Cron: ${evt.cron}` : formatShortTime(evt.startAt) }}
                        </span>
                        <a
                          v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                          :href="evt.googleHtmlLink"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-emerald-700 hover:underline"
                        >
                          GCal <ExternalLinkIcon class="size-2.5" />
                        </a>
                      </div>
                      <div :class="cn('text-sm font-medium', evt.status === 'done' && 'line-through text-muted-foreground')">
                        {{ evt.title }}
                      </div>
                      <p v-if="evt.notes" class="text-xs text-muted-foreground leading-relaxed">
                        {{ evt.notes }}
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <Button type="button" size="xs" variant="secondary" @click="prepWithOtto(evt)">
                      <SparklesIcon class="size-3" />
                      Prep
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      :title="evt.status === 'done' ? 'Mark planned' : 'Mark done'"
                      :disabled="updatingEventId === evt.id"
                      @click="toggleEventDone(evt)"
                    >
                      <CheckIcon :class="cn('size-3.5', evt.status === 'done' && 'text-emerald-600')" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      class="text-destructive hover:text-destructive"
                      title="Cancel event"
                      :disabled="cancellingEventId === evt.id"
                      @click="cancelEvent(evt.id)"
                    >
                      <Trash2Icon class="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- RIGHT SIDEBAR: SELECTED DAY INSPECTOR & AGENDA -->
      <aside class="hidden md:flex w-72 lg:w-80 shrink-0 flex-col border-l border-[#ededed] bg-[#f8f8f9] min-h-0">
        <div class="flex items-center justify-between gap-2 border-b border-[#ededed] px-3.5 py-2.5 shrink-0">
          <div class="min-w-0">
            <div class="text-xs font-semibold text-[#141414] truncate">
              {{ selectedDayKey ? formatDayHeading(selectedDayKey) : "All Scheduled Events" }}
            </div>
            <div class="font-mono text-[10px] text-muted-foreground">
              {{ inspectorEvents.length }} event{{ inspectorEvents.length === 1 ? "" : "s" }}
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button
              v-if="selectedDayKey"
              type="button"
              size="xs"
              variant="ghost"
              @click="selectedDayKey = null"
            >
              Show all
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              class="bg-white"
              title="Add event"
              @click="openNewEventModal()"
            >
              <PlusIcon class="size-3.5" />
            </Button>
          </div>
        </div>

        <!-- Otto Natural-Language Quick-Add -->
        <form class="border-b border-[#ededed] p-2.5 shrink-0" @submit.prevent="submitQuickAdd">
          <div class="flex items-center gap-1.5 rounded-lg border border-[#e3e3e3] bg-white px-2.5 h-8 focus-within:border-[#303030]">
            <SparklesIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <input
              v-model="quickAddText"
              type="text"
              :placeholder="selectedDayKey ? `Ask Otto to add on ${selectedDayKey}…` : 'Ask Otto to schedule…'"
              class="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <Button
              type="submit"
              size="icon-xs"
              variant="ghost"
              :disabled="!quickAddText.trim()"
              aria-label="Send to Otto"
            >
              <PlusIcon class="size-3.5" />
            </Button>
          </div>
        </form>

        <!-- Event Cards for Selected Day / All -->
        <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          <div
            v-if="inspectorEvents.length === 0"
            class="rounded-xl border border-dashed border-[#dcdcdc] bg-white/70 p-4 text-center text-xs text-muted-foreground space-y-2"
          >
            <p>
              {{ selectedDayKey ? `No events on ${selectedDayKey}.` : "No events scheduled yet." }}
            </p>
            <Button type="button" size="xs" variant="outline" class="bg-white" @click="openNewEventModal()">
              <PlusIcon class="size-3" />
              New Event
            </Button>
          </div>

          <div
            v-for="evt in inspectorEvents"
            :key="evt.id"
            class="rounded-xl border border-[#e6e6e6] bg-white p-3 shadow-2xs space-y-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span :class="cn('size-2 rounded-full shrink-0', eventAccentBarClass(evt.type))" />
                <Badge variant="secondary" class="font-mono text-[10px] uppercase h-4 px-1.5">
                  {{ evt.type }}
                </Badge>
                <a
                  v-if="evt.googleHtmlLink && /^https:\/\//i.test(evt.googleHtmlLink)"
                  :href="evt.googleHtmlLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-0.5 font-mono text-[10px] text-emerald-700 hover:underline"
                >
                  GCal <ExternalLinkIcon class="size-2.5" />
                </a>
              </div>
              <span class="font-mono text-[10.5px] text-muted-foreground shrink-0">
                {{ evt.cron ? evt.cron : formatDateTime(evt.startAt) }}
              </span>
            </div>

            <div :class="cn('text-xs font-semibold text-[#141414]', evt.status === 'done' && 'line-through text-muted-foreground')">
              {{ evt.title }}
            </div>

            <p v-if="evt.notes" class="text-[11.5px] text-muted-foreground leading-relaxed">
              {{ evt.notes }}
            </p>

            <div v-if="evt.wakeups && evt.wakeups.some((w) => w.status === 'armed')" class="flex flex-wrap gap-1">
              <span
                v-for="hook in evt.wakeups.filter((w) => w.status === 'armed')"
                :key="hook.qstashId"
                class="inline-flex items-center gap-1 rounded-full bg-[#f9f5a2] px-2 py-0.5 font-mono text-[10px] text-[#303030]"
              >
                <ClockIcon class="size-2.5" />
                {{ formatHookOffset(hook) }}
              </span>
            </div>

            <div class="flex items-center gap-1.5 pt-1 border-t border-[#f2f2f2]">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                class="flex-1 h-6"
                @click="prepWithOtto(evt)"
              >
                <SparklesIcon class="size-3" />
                Prep with Otto
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                :title="evt.status === 'done' ? 'Mark planned' : 'Mark done'"
                :disabled="updatingEventId === evt.id"
                @click="toggleEventDone(evt)"
              >
                <CheckIcon :class="cn('size-3.5', evt.status === 'done' && 'text-emerald-600')" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                class="text-destructive hover:text-destructive"
                title="Cancel event"
                :disabled="cancellingEventId === evt.id"
                @click="cancelEvent(evt.id)"
              >
                <Trash2Icon class="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div class="shrink-0 border-t border-[#ededed] px-3.5 py-2 flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
          <span>{{ activeEvents.length }} scheduled</span>
          <span>{{ googleSyncedCount }} GCal synced</span>
        </div>
      </aside>
    </div>

    <!-- NEW EVENT DIALOG -->
    <Dialog v-model:open="newEventOpen">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="text-sm font-semibold">New Calendar Event</DialogTitle>
          <DialogDescription class="text-xs">
            Save directly to your studio calendar, or let Otto arm reminders and prep notes.
          </DialogDescription>
        </DialogHeader>

        <form class="space-y-3" @submit.prevent="createDirectEvent">
          <FieldGroup>
            <Field>
              <FieldLabel for="cal-new-title" class="font-mono text-xs">Title</FieldLabel>
              <Input
                id="cal-new-title"
                v-model="newTitle"
                type="text"
                placeholder="e.g. Friday Night Ranked Stream"
                required
                autofocus
              />
            </Field>

            <div class="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel class="font-mono text-xs">Type</FieldLabel>
                <Select v-model="newType">
                  <SelectTrigger class="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="stream">Stream</SelectItem>
                      <SelectItem value="collab">Collab</SelectItem>
                      <SelectItem value="upload">Upload</SelectItem>
                      <SelectItem value="reminder">Reminder</SelectItem>
                      <SelectItem value="deadline">Deadline</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel for="cal-new-date" class="font-mono text-xs">Date</FieldLabel>
                <Input id="cal-new-date" v-model="newDate" type="date" required />
              </Field>
            </div>

            <Field>
              <FieldLabel for="cal-new-time" class="font-mono text-xs">Start time</FieldLabel>
              <Input id="cal-new-time" v-model="newTime" type="time" />
            </Field>

            <Field>
              <FieldLabel for="cal-new-notes" class="font-mono text-xs">Notes (optional)</FieldLabel>
              <Textarea
                id="cal-new-notes"
                v-model="newNotes"
                rows="2"
                placeholder="Guests, run-of-show, or reminders..."
                class="text-xs"
              />
            </Field>
          </FieldGroup>

          <DialogFooter class="gap-2 sm:justify-between pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              :disabled="!newTitle.trim() || savingNewEvent"
              @click="scheduleWithOttoFromModal"
            >
              <SparklesIcon class="size-3.5" />
              Ask Otto to Prep &amp; Arm
            </Button>
            <Button type="submit" size="sm" :disabled="!newTitle.trim() || !newDate || savingNewEvent">
              {{ savingNewEvent ? "Saving…" : "Save Event" }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
