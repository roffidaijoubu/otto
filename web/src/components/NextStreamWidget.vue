<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { CalendarDaysIcon } from "@lucide/vue";
import type { CalendarEventItem } from "@/types/calendar";

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  openCalendar: [];
  askPrompt: [prompt: string];
}>();

const events = ref<CalendarEventItem[]>([]);
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

async function loadEvents() {
  try {
    const res = await fetch("/api/calendar");
    if (!res.ok) return;
    const data = (await res.json()) as { events?: CalendarEventItem[] };
    events.value = Array.isArray(data.events) ? data.events : [];
  } catch {
    // ignore transient errors
  }
}

onMounted(() => {
  void loadEvents();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  clearInterval(tickTimer ?? undefined);
});

watch(
  () => props.refreshTick,
  () => {
    void loadEvents();
  }
);

const upcomingEvents = computed(() => {
  const cutoff = nowTick.value - 2 * 60 * 60 * 1000;
  return events.value
    .filter((e) => e.status !== "cancelled")
    .filter((e) => {
      if (e.cron) return true;
      const t = Date.parse(e.startAt);
      return Number.isNaN(t) || t >= cutoff;
    });
});

const nextEvent = computed(() => upcomingEvents.value[0] || null);

const countdown = computed(() => {
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

const armedHooksCount = computed(() =>
  (nextEvent.value?.wakeups || []).filter((w) => w.status === "armed").length
);

function formatStart(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
</script>

<template>
  <aside
    data-os-next-stream-widget
    class="w-[308px] rounded-[20px] border border-black/8 bg-white/86 shadow-[0_12px_32px_rgba(32,32,32,0.09)] backdrop-blur-md transition-colors hover:bg-white/95"
  >
    <div class="flex items-center justify-between border-b border-[#ededed] px-4 py-2">
      <span class="font-mono text-[11px] text-[#303030]">(Y)our next stream.</span>
      <button
        type="button"
        class="inline-flex items-center gap-1 font-mono text-[10px] text-[#303030] underline decoration-black/25 underline-offset-2 hover:decoration-[#303030]"
        @click="emit('openCalendar')"
      >
        <CalendarDaysIcon class="size-3" />
        Calendar
      </button>
    </div>

    <div class="flex flex-col gap-2 px-4 py-3">
      <div class="flex items-baseline justify-between gap-2">
        <span
          class="font-mono text-[24px] leading-none tracking-tight text-[#303030] tabular-nums"
          :class="countdown === 'LIVE NOW' ? 'text-[#991b1b]' : ''"
        >
          {{ countdown }}
        </span>
        <span
          v-if="armedHooksCount > 0"
          class="rounded-full bg-[#f9f5a2] px-2 py-0.5 font-mono text-[9.5px] font-medium text-[#854d0e]"
        >
          {{ armedHooksCount }} reminder{{ armedHooksCount === 1 ? "" : "s" }}
        </span>
      </div>

      <template v-if="nextEvent">
        <div class="truncate font-mono text-[11.5px] font-medium text-[#303030]" :title="nextEvent.title">
          {{ nextEvent.title }}
        </div>
        <div class="flex items-center justify-between gap-2 font-mono text-[10px] text-[#737373]">
          <span>{{ formatStart(nextEvent.startAt) }}</span>
          <span v-if="upcomingEvents.length > 1">+{{ upcomingEvents.length - 1 }} more</span>
        </div>
      </template>

      <div v-else class="flex items-center justify-between gap-2">
        <span class="font-mono text-[10.5px] text-[#808080]">No upcoming stream scheduled.</span>
        <button
          type="button"
          class="shrink-0 rounded-full bg-[#303030] px-2.5 py-1 font-mono text-[10px] text-white transition-colors hover:bg-[#141414]"
          @click="emit('askPrompt', 'Help me plan and schedule my next stream on the calendar.')"
        >
          Plan
        </button>
      </div>
    </div>
  </aside>
</template>
