<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Activity,
  Columns2,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import { playSound, soundsEnabled, toggleSounds } from "@/lib/sounds";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import StudioAppIcon from "./StudioAppIcon.vue";
import type { WindowManagerInstance } from "@/composables/useWindowManager";

const props = withDefaults(
  defineProps<{
    wm: WindowManagerInstance;
    timezone?: string;
    studioLabel?: string;
  }>(),
  {
    timezone: "",
    studioLabel: "Otto OS",
  }
);

const emit = defineEmits<{
  (e: "open-spotlight"): void;
}>();

interface StudioJobSummary {
  id: string;
  kind: "clip" | "thumbnail" | "obs_overlay" | "archive_sync";
  targetSlug: string;
  title: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string;
  error: string;
  updatedAt: string;
}

const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
const studioJobs = ref<StudioJobSummary[]>([]);
const resumingJobId = ref<string | null>(null);

const runningJobsCount = computed(
  () => studioJobs.value.filter((j) => j.status === "running" || j.status === "queued").length
);
const failedJobsCount = computed(
  () => studioJobs.value.filter((j) => j.status === "failed").length
);

async function fetchStudioJobs() {
  try {
    const res = await fetch("/api/jobs?limit=12");
    if (!res.ok) return;
    const data = (await res.json()) as { ok?: boolean; jobs?: StudioJobSummary[] };
    if (data.ok && Array.isArray(data.jobs)) {
      studioJobs.value = data.jobs;
    }
  } catch {
    // ignore transient errors
  }
}

async function resumeStudioJob(job: StudioJobSummary) {
  if (resumingJobId.value) return;
  resumingJobId.value = job.id;
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/resume`, { method: "POST" });
    if (res.ok) {
      playSound("toggle");
      await fetchStudioJobs();
    } else {
      playSound("error");
    }
  } catch {
    playSound("error");
  } finally {
    resumingJobId.value = null;
  }
}

async function dismissStudioJob(job: StudioJobSummary) {
  try {
    await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    playSound("delete");
    await fetchStudioJobs();
  } catch {
    // ignore
  }
}

function handleJobsChangedEvent() {
  void fetchStudioJobs();
}

onMounted(() => {
  void fetchStudioJobs();
  window.addEventListener("otto:jobs-changed", handleJobsChangedEvent);
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 15_000);
});

onBeforeUnmount(() => {
  window.removeEventListener("otto:jobs-changed", handleJobsChangedEvent);
  clearInterval(clockTimer);
  clockTimer = undefined;
});

const formattedClock = computed(() => {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };
    if (props.timezone) {
      opts.timeZone = props.timezone;
    }
    return new Intl.DateTimeFormat("en-US", opts).format(now.value);
  } catch {
    return now.value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
});

const activeAppTitle = computed(() => props.wm.focusedApp.value?.title ?? "Desktop");
const focusedWin = computed(() => {
  const id = props.wm.focusedWindowId.value;
  return id ? props.wm.windows[id] : null;
});
</script>

<template>
  <header
    data-os-menubar
    class="fixed top-0 right-0 left-0 z-[45] flex h-[36px] items-center justify-between border-b border-black/6 bg-white/84 px-3 backdrop-blur-md select-none"
  >
    <!-- Left: Otto OS Menu + Active App + Window/Layout Menu -->
    <div class="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] font-bold tracking-tight text-[#303030] transition-colors hover:bg-black/6"
          >
            <span class="size-2.5 rounded-full bg-[#303030]" aria-hidden="true" />
            <span>{{ studioLabel }}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-52">
          <DropdownMenuLabel class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Otto Studio OS
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @select="emit('open-spotlight')">
              <Search class="size-4" aria-hidden="true" />
              <span>Spotlight Search</span>
              <DropdownMenuShortcut>{{ wm.shortcutLabels.value.spotlight }}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.openWindow('settings')">
              <Settings class="size-4" aria-hidden="true" />
              <span>System Settings</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @select="wm.applyPreset('show-desktop')">
              <Minimize2 class="size-4" aria-hidden="true" />
              <span>Show Desktop</span>
              <DropdownMenuShortcut>{{ wm.shortcutLabels.value.desktop }}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.applyPreset('reset')">
              <RotateCcw class="size-4" aria-hidden="true" />
              <span>Reset Workspace Layout</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span class="mx-1 hidden h-3.5 w-px bg-black/10 sm:inline-block" aria-hidden="true" />

      <span
        class="hidden max-w-[140px] truncate px-1.5 font-mono text-[11.5px] font-semibold text-[#303030] sm:inline-block"
      >
        {{ activeAppTitle }}
      </span>

      <!-- Window & Layout Presets Dropdown -->
      <DropdownMenu v-if="!wm.isMobile.value">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-os-layout-menu
            class="flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11.5px] font-medium text-[#525252] transition-colors hover:bg-black/6 hover:text-[#303030]"
          >
            <SlidersHorizontal class="size-3.5" aria-hidden="true" />
            <span>Window</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-56">
          <DropdownMenuLabel class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Layout Presets
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem @select="wm.applyPreset('tile-2up')">
              <Columns2 class="size-4" aria-hidden="true" />
              <span>Tile 2-Up</span>
              <DropdownMenuShortcut>{{ wm.shortcutLabels.value.tile }}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.applyPreset('focus-chat')">
              <Maximize2 class="size-4" aria-hidden="true" />
              <span>Focus Otto Chat</span>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.applyPreset('cascade')">
              <Layers class="size-4" aria-hidden="true" />
              <span>Cascade Windows</span>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.applyPreset('show-desktop')">
              <LayoutGrid class="size-4" aria-hidden="true" />
              <span>Show Desktop</span>
              <DropdownMenuShortcut>{{ wm.shortcutLabels.value.desktop }}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem @select="wm.applyPreset('reset')">
              <RotateCcw class="size-4" aria-hidden="true" />
              <span>Reset Default Layout</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <template v-if="focusedWin">
            <DropdownMenuSeparator />
            <DropdownMenuLabel class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Active Window
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem @select="wm.snapWindow(focusedWin.id, 'left')">
                <span>Snap Left Half</span>
              </DropdownMenuItem>
              <DropdownMenuItem @select="wm.snapWindow(focusedWin.id, 'right')">
                <span>Snap Right Half</span>
              </DropdownMenuItem>
              <DropdownMenuItem @select="wm.toggleMaximize(focusedWin.id)">
                <span>{{ focusedWin.isMaximized ? "Restore Size" : "Maximize" }}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </template>

          <DropdownMenuSeparator />
          <DropdownMenuLabel class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Studio Apps
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              v-for="app in wm.apps"
              :key="app.id"
              @select="wm.openWindow(app.id)"
            >
              <StudioAppIcon :icon="app.icon" class="size-3.5" />
              <span class="flex-1">{{ app.title }}</span>
              <span
                v-if="wm.windows[app.id].isOpen"
                class="size-1.5 rounded-full bg-[#303030]"
                aria-hidden="true"
              />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Right: Active Jobs pill + Spotlight pill + Clock + Mute + Settings -->
    <div class="flex shrink-0 items-center gap-1.5">
      <DropdownMenu v-if="studioJobs.length > 0" @update:open="(o) => { if (o) fetchStudioJobs(); }">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-os-jobs-trigger
            class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
            :class="
              runningJobsCount > 0
                ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                : failedJobsCount > 0
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-black/8 bg-white/90 text-[#666] hover:border-black/18 hover:text-[#303030]'
            "
          >
            <Loader2 v-if="runningJobsCount > 0" class="size-3 animate-spin" aria-hidden="true" />
            <Activity v-else class="size-3" aria-hidden="true" />
            <span v-if="runningJobsCount > 0">{{ runningJobsCount }} running</span>
            <span v-else-if="failedJobsCount > 0">{{ failedJobsCount }} interrupted</span>
            <span v-else class="hidden sm:inline">Jobs</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-80 p-1.5">
          <div class="flex items-center justify-between px-2 py-1">
            <span class="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
              Background Jobs (Neon)
            </span>
            <span class="font-mono text-[10px] text-neutral-400">{{ studioJobs.length }}</span>
          </div>
          <DropdownMenuSeparator />
          <div class="max-h-72 overflow-y-auto divide-y divide-black/6">
            <div
              v-for="job in studioJobs"
              :key="job.id"
              class="flex items-center justify-between gap-2 px-2 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-medium text-[#171717]">
                    {{ job.title || job.targetSlug || job.kind }}
                  </span>
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-neutral-500">
                  <span class="uppercase">{{ job.kind.replace('_', ' ') }}</span>
                  <span>·</span>
                  <span
                    :class="
                      job.status === 'running' || job.status === 'queued'
                        ? 'text-amber-700'
                        : job.status === 'done'
                          ? 'text-emerald-700'
                          : job.status === 'failed'
                            ? 'text-red-600'
                            : 'text-neutral-400'
                    "
                  >
                    {{ job.stage || job.status }}
                  </span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  v-if="job.status === 'failed' || job.status === 'cancelled'"
                  type="button"
                  class="inline-flex h-6 items-center gap-1 rounded-md bg-[#171717] px-2 font-mono text-[10px] font-medium text-white hover:bg-neutral-800"
                  :disabled="resumingJobId === job.id"
                  @click.stop="resumeStudioJob(job)"
                >
                  <RotateCcw class="size-2.5" aria-hidden="true" />
                  Resume
                </button>
                <button
                  v-if="job.status !== 'running' && job.status !== 'queued'"
                  type="button"
                  title="Dismiss"
                  class="flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-black/5 hover:text-neutral-700"
                  @click.stop="dismissStudioJob(job)"
                >
                  <Trash2 class="size-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        data-os-spotlight-trigger
        class="flex items-center gap-1.5 rounded-full border border-black/8 bg-white/90 px-2.5 py-0.5 font-mono text-[11px] text-[#666] transition-colors hover:border-black/18 hover:text-[#303030]"
        @click="emit('open-spotlight')"
      >
        <Search class="size-3" aria-hidden="true" />
        <span class="hidden sm:inline">Spotlight</span>
        <kbd class="rounded bg-[#f2f2f2] px-1 py-px text-[10px] font-semibold text-[#303030]">
          {{ wm.shortcutLabels.value.spotlight }}
        </kbd>
      </button>

      <span class="px-1.5 font-mono text-[11.5px] font-medium tabular-nums text-[#4a4a4a]">
        {{ formattedClock }}
      </span>

      <button
        type="button"
        data-os-sound-toggle
        :aria-label="soundsEnabled ? 'Turn off UI sounds' : 'Turn on UI sounds'"
        :title="soundsEnabled ? 'UI sounds on (click to turn off)' : 'UI sounds off (click to enable)'"
        :aria-pressed="soundsEnabled"
        class="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-black/6"
        :class="soundsEnabled ? 'text-[#525252] hover:text-[#303030]' : 'text-[#a3a3a3] hover:text-[#303030]'"
        @click="toggleSounds()"
      >
        <Volume2 v-if="soundsEnabled" class="size-3.5" aria-hidden="true" />
        <VolumeX v-else class="size-3.5" aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label="Open System Settings"
        title="System Settings"
        class="flex size-6 items-center justify-center rounded-full text-[#525252] transition-colors hover:bg-black/6 hover:text-[#303030]"
        @click="wm.openWindow('settings')"
      >
        <Settings class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
