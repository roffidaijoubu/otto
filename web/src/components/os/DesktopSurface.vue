<script setup lang="ts">
import {
  Columns2,
  Database,
  FilePlus2,
  FolderPlus,
  Globe,
  Layers,
  LayoutGrid,
  MessageSquare,
  RotateCcw,
  Search,
  Sparkles,
} from "@lucide/vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import OttoMascot from "@/components/OttoMascot.vue";
import StudioAppIcon from "./StudioAppIcon.vue";
import type {
  DesktopShortcut,
  WindowManagerInstance,
} from "@/composables/useWindowManager";
const props = withDefaults(
  defineProps<{
    wm: WindowManagerInstance;
    shortcuts?: DesktopShortcut[];
    mascotState?: "ready" | "busy" | "error";
    mascotColor?: string;
    statusSubtitle?: string;
  }>(),
  {
    shortcuts: () => [
      { id: "clips", label: "Clips", sublabel: "/clips", icon: "folder", appId: "files", filesPath: "clips" },
      { id: "brand", label: "Brand Kit", sublabel: "/brand", icon: "folder", appId: "files", filesPath: "brand" },
      { id: "chrome", label: "Chrome", sublabel: "noVNC", icon: "globe", appId: "chrome" },
      { id: "studio-db", label: "Studio DB", sublabel: "SQLite", icon: "database", appId: "studio-db" },
      { id: "playbooks", label: "Playbooks", sublabel: "Nightly", icon: "sparkles", appId: "playbooks" },
      { id: "calendar", label: "Calendar", sublabel: "Schedule", icon: "calendar", appId: "calendar" },
      { id: "contacts", label: "Contacts", sublabel: "Rolodex", icon: "contacts", appId: "contacts" },
    ],
    mascotState: "ready",
    mascotColor: "#303030",
    statusSubtitle: "Sprite workstation ready",
  }
);

const emit = defineEmits<{
  (e: "open-spotlight"): void;
  (e: "open-files-path", path: string): void;
  (e: "desktop-action", action: "new-note" | "new-folder"): void;
}>();

function launchShortcut(item: DesktopShortcut) {
  if (item.appId === "files" && item.filesPath) {
    props.wm.openWindow("files", { subtitle: `/${item.filesPath}` });
    emit("open-files-path", item.filesPath);
    return;
  }
  props.wm.openWindow(item.appId);
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        data-os-desktop
        class="fixed inset-0 z-0 overflow-hidden pt-[48px] pb-[88px] px-4 select-none"
      >
        <!-- Left Desktop Quick Shortcuts -->
        <div class="grid w-fit grid-cols-1 gap-2.5 sm:grid-flow-col sm:grid-rows-5">
          <button
            v-for="item in shortcuts"
            :key="item.id"
            type="button"
            :data-desktop-shortcut="item.id"
            class="group flex w-[84px] flex-col items-center gap-1.5 rounded-[16px] border border-transparent px-2 py-2.5 text-center transition-all hover:border-black/8 hover:bg-white/65 hover:backdrop-blur-md focus-visible:border-[#303030]/30 focus-visible:bg-white/80 focus-visible:outline-none"
            @dblclick="launchShortcut(item)"
            @click="wm.isMobile.value && launchShortcut(item)"
            @keydown.enter.prevent="launchShortcut(item)"
          >
            <span
              class="flex size-11 items-center justify-center rounded-[14px] border border-black/8 bg-white/90 text-[#303030] shadow-[0_6px_18px_rgba(32,32,32,0.08)] transition-transform group-hover:-translate-y-0.5"
            >
              <StudioAppIcon :icon="item.icon" class="size-5" />
            </span>
            <span class="w-full truncate font-mono text-[11px] font-semibold text-[#303030]">
              {{ item.label }}
            </span>
            <span
              v-if="item.sublabel"
              class="-mt-1 w-full truncate font-mono text-[9.5px] text-[#757575]"
            >
              {{ item.sublabel }}
            </span>
          </button>
        </div>

        <!-- Bottom-Right Companion Desktop Widget Slot -->
        <div class="pointer-events-auto fixed right-5 bottom-[92px] hidden lg:block">
          <slot name="widget">
            <button
              type="button"
              data-os-companion-widget
              class="flex items-center gap-3.5 rounded-[20px] border border-black/8 bg-white/82 px-4 py-3 text-left shadow-[0_12px_32px_rgba(32,32,32,0.09)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/95"
              @click="wm.openWindow('otto-chat')"
            >
              <OttoMascot :size="44" :color="mascotColor" :state="mascotState" />
              <div class="flex flex-col gap-0.5 pr-1">
                <span class="font-mono text-[12px] font-bold tracking-tight text-[#303030]">
                  Otto Studio OS
                </span>
                <span class="font-mono text-[11px] text-[#6d6d6d]">
                  {{ statusSubtitle }}
                </span>
                <span class="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-[#f9f5a2] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#303030]">
                  Click to summon Otto · {{ wm.shortcutLabels.value.spotlight }}
                </span>
              </div>
            </button>
          </slot>
        </div>
      </div>
    </ContextMenuTrigger>

    <!-- Wallpaper Right-Click ContextMenu -->
    <ContextMenuContent class="w-56">
      <ContextMenuGroup>
        <ContextMenuItem @select="emit('open-spotlight')">
          <Search class="size-4" aria-hidden="true" />
          <span>Spotlight Search</span>
          <ContextMenuShortcut>{{ wm.shortcutLabels.value.spotlight }}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem @select="wm.openWindow('otto-chat')">
          <MessageSquare class="size-4" aria-hidden="true" />
          <span>Open Otto Chat</span>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.openWindow('chrome')">
          <Globe class="size-4" aria-hidden="true" />
          <span>Open Chrome (noVNC)</span>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.openWindow('studio-db')">
          <Database class="size-4" aria-hidden="true" />
          <span>Open Studio DB</span>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.openWindow('playbooks')">
          <Sparkles class="size-4" aria-hidden="true" />
          <span>Open Playbooks</span>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem @select="emit('desktop-action', 'new-note')">
          <FilePlus2 class="size-4" aria-hidden="true" />
          <span>New Studio Note</span>
        </ContextMenuItem>
        <ContextMenuItem @select="emit('desktop-action', 'new-folder')">
          <FolderPlus class="size-4" aria-hidden="true" />
          <span>New Workspace Folder</span>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem @select="wm.applyPreset('tile-2up')">
          <Columns2 class="size-4" aria-hidden="true" />
          <span>Tile 2-Up</span>
          <ContextMenuShortcut>{{ wm.shortcutLabels.value.tile }}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.applyPreset('cascade')">
          <Layers class="size-4" aria-hidden="true" />
          <span>Cascade Windows</span>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.applyPreset('show-desktop')">
          <LayoutGrid class="size-4" aria-hidden="true" />
          <span>Show Desktop</span>
          <ContextMenuShortcut>{{ wm.shortcutLabels.value.desktop }}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @select="wm.applyPreset('reset')">
          <RotateCcw class="size-4" aria-hidden="true" />
          <span>Reset Layout</span>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
