<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Columns2,
  Globe,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
} from "@lucide/vue";
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
import { cn } from "@/lib/utils";
import StudioAppIcon from "./StudioAppIcon.vue";
import type { WindowManagerInstance } from "@/composables/useWindowManager";

const props = withDefaults(
  defineProps<{
    wm: WindowManagerInstance;
    timezone?: string;
    studioLabel?: string;
    chromeRunning?: boolean;
    chromeLoginPending?: boolean;
  }>(),
  {
    timezone: "",
    studioLabel: "Otto OS",
    chromeRunning: false,
    chromeLoginPending: false,
  }
);

const emit = defineEmits<{
  (e: "open-spotlight"): void;
}>();

const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date();
  }, 15_000);
});

onBeforeUnmount(() => {
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
              <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
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
              <DropdownMenuShortcut>⌥⇧D</DropdownMenuShortcut>
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
              <DropdownMenuShortcut>⌥⇧T</DropdownMenuShortcut>
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
              <DropdownMenuShortcut>⌥⇧D</DropdownMenuShortcut>
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

    <!-- Right: Spotlight pill + Chrome status + Clock + Settings -->
    <div class="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        data-os-spotlight-trigger
        class="flex items-center gap-1.5 rounded-full border border-black/8 bg-white/90 px-2.5 py-0.5 font-mono text-[11px] text-[#666] transition-colors hover:border-black/18 hover:text-[#303030]"
        @click="emit('open-spotlight')"
      >
        <Search class="size-3" aria-hidden="true" />
        <span class="hidden sm:inline">Spotlight</span>
        <kbd class="rounded bg-[#f2f2f2] px-1 py-px text-[10px] font-semibold text-[#303030]">
          ⌘K
        </kbd>
      </button>

      <button
        v-if="chromeRunning || chromeLoginPending"
        type="button"
        data-os-chrome-indicator
        :class="
          cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold transition-colors',
            chromeLoginPending
              ? 'bg-[#f9f5a2] text-[#303030] animate-pulse'
              : 'bg-[#f2f2f2] text-[#303030] hover:bg-[#e8e8e8]'
          )
        "
        @click="wm.openWindow('chrome')"
      >
        <Globe class="size-3" aria-hidden="true" />
        <span>{{ chromeLoginPending ? "Login Needed" : "Chrome Live" }}</span>
      </button>

      <span class="px-1.5 font-mono text-[11.5px] font-medium tabular-nums text-[#4a4a4a]">
        {{ formattedClock }}
      </span>

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
