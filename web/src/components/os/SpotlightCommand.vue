<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  Columns2,
  CornerDownLeft,
  FolderOpen,
  Layers,
  LayoutGrid,
  Maximize2,
  RotateCcw,
  Search,
} from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import StudioAppIcon from "./StudioAppIcon.vue";
import type {
  LayoutPreset,
  StudioAppIconName,
  StudioAppId,
  WindowManagerInstance,
} from "@/composables/useWindowManager";

interface SpotlightItem {
  id: string;
  group: "Apps" | "Folders" | "Layouts";
  title: string;
  subtitle: string;
  keywords: string;
  appIcon?: StudioAppIconName;
  badge?: string;
  run: () => void;
}

const props = defineProps<{
  wm: WindowManagerInstance;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "open-files-path", path: string): void;
}>();

const query = ref("");
const activeIndex = ref(0);
const inputWrapRef = ref<HTMLElement | null>(null);

const QUICK_FOLDERS = [
  { path: "clips", title: "Clips Folder", subtitle: "/clips · Hype clips & exports" },
  { path: "brand", title: "Brand Assets", subtitle: "/brand · Overlays, logos & thumbnails" },
  { path: "notes", title: "Studio Notes", subtitle: "/notes · Ideas & drafts" },
  { path: "rundowns", title: "Stream Rundowns", subtitle: "/rundowns · Episode outlines" },
];

const layoutActions = computed<
  Array<{
    preset: LayoutPreset;
    title: string;
    subtitle: string;
    badge?: string;
  }>
>(() => [
  {
    preset: "tile-2up",
    title: "Tile 2-Up",
    subtitle: "Otto Chat left + secondary window right",
    badge: props.wm.shortcutLabels.value.tile,
  },
  { preset: "focus-chat", title: "Focus Otto Chat", subtitle: "Center Otto Chat and minimize others" },
  { preset: "cascade", title: "Cascade Windows", subtitle: "Stack open windows cleanly" },
  {
    preset: "show-desktop",
    title: "Show Desktop",
    subtitle: "Toggle minimize all open windows",
    badge: props.wm.shortcutLabels.value.desktop,
  },
  { preset: "reset", title: "Reset Layout", subtitle: "Restore default Otto Studio OS geometry" },
]);

const allItems = computed<SpotlightItem[]>(() => {
  const items: SpotlightItem[] = [];

  for (const app of props.wm.apps) {
    const win = props.wm.windows[app.id];
    items.push({
      id: `app:${app.id}`,
      group: "Apps",
      title: app.title,
      subtitle: win.isOpen
        ? win.isMinimized
          ? "Restore minimized window"
          : "Focus running window"
        : "Launch Studio app",
      keywords: `${app.id} ${app.title} ${app.shortLabel} app open`,
      appIcon: app.icon,
      badge: app.shortcutDigit ? `${props.wm.shortcutLabels.value.altPrefix}${app.shortcutDigit}` : undefined,
      run: () => props.wm.openWindow(app.id as StudioAppId),
    });
  }

  for (const folder of QUICK_FOLDERS) {
    items.push({
      id: `folder:${folder.path}`,
      group: "Folders",
      title: folder.title,
      subtitle: folder.subtitle,
      keywords: `files folder ${folder.path} ${folder.title}`,
      run: () => {
        props.wm.openWindow("files", { subtitle: `/${folder.path}` });
        emit("open-files-path", folder.path);
      },
    });
  }

  for (const layout of layoutActions.value) {
    items.push({
      id: `layout:${layout.preset}`,
      group: "Layouts",
      title: layout.title,
      subtitle: layout.subtitle,
      keywords: `layout window snap ${layout.preset} ${layout.title}`,
      badge: layout.badge,
      run: () => props.wm.applyPreset(layout.preset),
    });
  }

  return items;
});

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return allItems.value;
  return allItems.value.filter((item) => {
    const hay = `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase();
    return hay.includes(q);
  });
});

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      query.value = "";
      activeIndex.value = 0;
      await nextTick();
      const input = inputWrapRef.value?.querySelector("input");
      input?.focus();
    }
  }
);

watch(filteredItems, (list) => {
  if (activeIndex.value >= list.length) {
    activeIndex.value = Math.max(0, list.length - 1);
  }
});

function close() {
  emit("update:open", false);
}

function runItem(item: SpotlightItem) {
  item.run();
  close();
}

function handleKeyDown(event: KeyboardEvent) {
  const list = filteredItems.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (list.length > 0) activeIndex.value = (activeIndex.value + 1) % list.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (list.length > 0) activeIndex.value = (activeIndex.value - 1 + list.length) % list.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const selected = list[activeIndex.value];
    if (selected) runItem(selected);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      data-os-spotlight
      :show-close-button="false"
      class="gap-0 overflow-hidden rounded-[20px] p-0 sm:max-w-[540px]"
      @keydown="handleKeyDown"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>Otto OS Spotlight</DialogTitle>
        <DialogDescription>
          Quickly launch Studio apps, open workspace folders, or apply window layouts.
        </DialogDescription>
      </DialogHeader>

      <div ref="inputWrapRef" class="border-b border-[#ededed] p-3">
        <InputGroup class="border-0 bg-[#f6f6f6] shadow-none">
          <InputGroupAddon align="inline-start">
            <Search class="size-4 text-[#707070]" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            v-model="query"
            placeholder="Open app, jump to /clips, or run layout..."
            class="font-mono text-[13px]"
          />
          <InputGroupAddon align="inline-end">
            <Badge variant="secondary" class="font-mono text-[10px]">ESC</Badge>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <ScrollArea class="max-h-[360px]">
        <div v-if="filteredItems.length === 0" class="px-4 py-10 text-center font-mono text-xs text-muted-foreground">
          No matching Studio apps, folders, or layouts.
        </div>

        <div v-else class="flex flex-col gap-1 p-2">
          <button
            v-for="(item, idx) in filteredItems"
            :key="item.id"
            type="button"
            :data-spotlight-item="item.id"
            :class="
              cn(
                'flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors',
                idx === activeIndex
                  ? 'bg-[#303030] text-white'
                  : 'text-[#303030] hover:bg-[#f2f2f2]'
              )
            "
            @mouseenter="activeIndex = idx"
            @click="runItem(item)"
          >
            <span
              :class="
                cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                  idx === activeIndex ? 'bg-white/15 text-white' : 'bg-[#f2f2f2] text-[#303030]'
                )
              "
            >
              <StudioAppIcon v-if="item.appIcon" :icon="item.appIcon" class="size-4" />
              <FolderOpen v-else-if="item.group === 'Folders'" class="size-4" aria-hidden="true" />
              <Columns2 v-else-if="item.id === 'layout:tile-2up'" class="size-4" aria-hidden="true" />
              <Maximize2 v-else-if="item.id === 'layout:focus-chat'" class="size-4" aria-hidden="true" />
              <Layers v-else-if="item.id === 'layout:cascade'" class="size-4" aria-hidden="true" />
              <LayoutGrid v-else-if="item.id === 'layout:show-desktop'" class="size-4" aria-hidden="true" />
              <RotateCcw v-else class="size-4" aria-hidden="true" />
            </span>

            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-mono text-[12.5px] font-semibold">
                {{ item.title }}
              </span>
              <span
                :class="
                  cn(
                    'truncate text-[11.5px]',
                    idx === activeIndex ? 'text-white/75' : 'text-[#737373]'
                  )
                "
              >
                {{ item.subtitle }}
              </span>
            </div>

            <span
              :class="
                cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium',
                  idx === activeIndex
                    ? 'bg-[#f9f5a2] text-[#303030]'
                    : 'bg-[#f2f2f2] text-[#666]'
                )
              "
            >
              {{ item.badge ?? item.group }}
            </span>
          </button>
        </div>
      </ScrollArea>

      <div class="flex items-center justify-between border-t border-[#ededed] bg-[#fafafa] px-3.5 py-2 font-mono text-[10.5px] text-[#757575]">
        <span>↑↓ Navigate</span>
        <span class="inline-flex items-center gap-1">
          <CornerDownLeft class="size-3" aria-hidden="true" />
          Open
        </span>
      </div>
    </DialogContent>
  </Dialog>
</template>
