<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DOCK_SAFE_BOTTOM,
  TOP_BAR_HEIGHT,
  WINDOW_MANAGER_KEY,
  useWindowManagerLifecycle,
  type DesktopShellExposed,
  type DesktopShortcut,
  type StudioAppId,
} from "@/composables/useWindowManager";
import DesktopDock from "./DesktopDock.vue";
import DesktopSurface from "./DesktopSurface.vue";
import DesktopWindow from "./DesktopWindow.vue";
import SpotlightCommand from "./SpotlightCommand.vue";
import TopMenuBar from "./TopMenuBar.vue";

const props = withDefaults(
  defineProps<{
    timezone?: string;
    studioLabel?: string;
    chromeRunning?: boolean;
    chromeLoginPending?: boolean;
    mascotState?: "ready" | "busy" | "error";
    mascotColor?: string;
    statusSubtitle?: string;
    shortcuts?: DesktopShortcut[];
    storageKey?: string;
    persistLayout?: boolean;
  }>(),
  {
    timezone: "",
    studioLabel: "Otto OS",
    chromeRunning: false,
    chromeLoginPending: false,
    mascotState: "ready",
    mascotColor: "#303030",
    statusSubtitle: "Sprite workstation ready",
    persistLayout: true,
  }
);

const emit = defineEmits<{
  (e: "open-files-path", path: string): void;
  (e: "open-chrome-url", url: string): void;
  (e: "desktop-action", action: "new-note" | "new-folder"): void;
}>();

const wm = useWindowManagerLifecycle({
  storageKey: props.storageKey,
  persist: props.persistLayout,
});

provide(WINDOW_MANAGER_KEY, wm);

const spotlightOpen = ref(false);

function openSpotlight() {
  spotlightOpen.value = true;
}

const snapGhostStyle = computed(() => {
  const zone = wm.activeSnapPreview.value;
  if (!zone || wm.isMobile.value) return null;
  const rect = wm.getSnapRect(zone);
  return {
    transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
});

// On mobile (< 1024px), show only the top focused window full-bleed inside the stage
const renderedWindows = computed(() => {
  const visible = wm.visibleWindows.value;
  if (!wm.isMobile.value) return visible;
  const activeId = wm.focusedWindowId.value;
  if (activeId) {
    return visible.filter((w) => w.id === activeId);
  }
  return [];
});

const mobileStageStyle = computed(() => ({
  top: `${TOP_BAR_HEIGHT}px`,
  bottom: `${DOCK_SAFE_BOTTOM}px`,
}));

const SHORTCUT_APP_IDS: StudioAppId[] = [
  "otto-chat",
  "chrome",
  "files",
  "mission-control",
  "studio-db",
  "playbooks",
  "settings",
];

function handleGlobalKeyDown(event: KeyboardEvent) {
  // Cmd+K / Ctrl+K toggles Spotlight
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    spotlightOpen.value = !spotlightOpen.value;
    return;
  }

  // Ignore Alt shortcuts while typing inside an input/textarea/contentEditable
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.shiftKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      wm.applyPreset("tile-2up");
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      wm.applyPreset("show-desktop");
      return;
    }
    const digit = Number(event.key);
    if (!event.shiftKey && digit >= 1 && digit <= SHORTCUT_APP_IDS.length) {
      event.preventDefault();
      wm.toggleFromDock(SHORTCUT_APP_IDS[digit - 1]);
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeyDown);
});

defineExpose<DesktopShellExposed>({
  wm,
  openSpotlight,
});
</script>
<template>
  <TooltipProvider :delay-duration="220">
    <div data-os-shell class="relative h-dvh w-screen overflow-hidden">
      <!-- Top OS Menu Bar (z-45) -->
      <TopMenuBar
        :wm="wm"
        :timezone="timezone"
        :studio-label="studioLabel"
        :chrome-running="chromeRunning"
        :chrome-login-pending="chromeLoginPending"
        @open-spotlight="openSpotlight"
      />

      <!-- Interactive Desktop Surface (z-0) -->
      <DesktopSurface
        :wm="wm"
        :shortcuts="shortcuts"
        :mascot-state="mascotState"
        :mascot-color="mascotColor"
        :status-subtitle="statusSubtitle"
        @open-spotlight="openSpotlight"
        @open-files-path="emit('open-files-path', $event)"
        @desktop-action="emit('desktop-action', $event)"
      >
        <template v-if="$slots['desktop-widget']" #widget>
          <slot name="desktop-widget" />
        </template>
      </DesktopSurface>

      <!-- Edge Snap Ghost Preview (z-42, always under top bar/dock and shadcn portals) -->
      <div
        v-if="snapGhostStyle"
        data-os-snap-preview
        :style="snapGhostStyle"
        class="pointer-events-none fixed top-0 left-0 z-[42] rounded-[20px] border-2 border-dashed border-[#303030]/40 bg-[#f9f5a2]/30 backdrop-blur-[2px] transition-all duration-100"
        aria-hidden="true"
      />

      <!-- Managed Window Stage -->
      <div
        :class="wm.isMobile.value ? 'fixed right-0 left-0 z-10' : 'contents'"
        :style="wm.isMobile.value ? mobileStageStyle : undefined"
      >
        <DesktopWindow
          v-for="win in renderedWindows"
          :key="win.id"
          :wm="wm"
          :app="wm.appMap[win.id]"
          :win="win"
        >
          <template #actions>
            <slot :name="`window-actions-${win.id}`" />
          </template>
          <slot :name="`app-${win.id}`">
            <div class="flex h-full items-center justify-center p-6 font-mono text-xs text-muted-foreground">
              {{ wm.appMap[win.id].title }} workspace slot
            </div>
          </slot>
        </DesktopWindow>
      </div>

      <!-- Bottom Floating Pill Dock (z-45) -->
      <DesktopDock :wm="wm" />

      <!-- Spotlight / Command Palette (z-50 Reka UI Dialog portal) -->
      <SpotlightCommand
        v-model:open="spotlightOpen"
        :wm="wm"
        @open-files-path="emit('open-files-path', $event)"
        @open-chrome-url="emit('open-chrome-url', $event)"
      />
    </div>
  </TooltipProvider>
</template>
