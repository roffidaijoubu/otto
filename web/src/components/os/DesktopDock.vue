<script setup lang="ts">
import { computed } from "vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import StudioAppIcon from "./StudioAppIcon.vue";
import type { StudioAppDefinition, WindowManagerInstance } from "@/composables/useWindowManager";

const props = defineProps<{
  wm: WindowManagerInstance;
}>();

const primaryApps = computed(() => props.wm.apps.filter((a) => a.dockSection === "primary"));
const runningCustomApps = computed(() =>
  props.wm.apps.filter((a) => a.dockSection === "custom" && props.wm.windows[a.id]?.isOpen)
);
const utilityApps = computed(() => props.wm.apps.filter((a) => a.dockSection === "utility"));

function statusLabel(app: StudioAppDefinition): string {
  const win = props.wm.windows[app.id];
  if (win.badgeText) return win.badgeText;
  if (!win.isOpen) return "Closed";
  if (win.isMinimized) return "Minimized";
  if (props.wm.focusedWindowId.value === app.id) return "Active";
  return "Running";
}
</script>

<template>
  <nav
    data-os-dock
    aria-label="Otto Studio Dock"
    class="fixed right-0 bottom-3 left-0 z-[45] flex justify-center px-3 pointer-events-none"
  >
    <div
      class="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-[22px] border border-black/10 bg-white/88 px-2.5 py-2 shadow-[0_14px_38px_rgba(32,32,32,0.13),0_2px_8px_rgba(32,32,32,0.06)] backdrop-blur-xl"
    >
      <!-- Primary Studio Apps -->
      <template v-for="app in primaryApps" :key="app.id">
        <ContextMenu>
          <Tooltip>
            <ContextMenuTrigger as-child>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  :data-dock-app="app.id"
                  :aria-label="`${app.title} (${statusLabel(app)})`"
                  :class="
                    cn(
                      'group/dock relative flex size-11 shrink-0 flex-col items-center justify-center rounded-[14px] border transition-all duration-150 select-none',
                      wm.focusedWindowId.value === app.id && wm.windows[app.id].isOpen && !wm.windows[app.id].isMinimized
                        ? 'bg-[#303030] text-white border-[#303030] shadow-sm -translate-y-0.5'
                        : wm.windows[app.id].isOpen
                          ? 'bg-[#f4f4f4] text-[#303030] border-black/8 hover:-translate-y-1 hover:bg-[#ececec]'
                          : 'bg-white text-[#525252] border-black/6 hover:-translate-y-1 hover:bg-[#f4f4f4] hover:text-[#303030]',
                      wm.windows[app.id].attention && 'animate-bounce ring-2 ring-[#f9f5a2]'
                    )
                  "
                  @click="wm.toggleFromDock(app.id)"
                >
                  <StudioAppIcon :icon="app.icon" class="size-[18px]" />

                  <!-- Attention yellow dot -->
                  <span
                    v-if="wm.windows[app.id].attention"
                    class="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full border border-[#303030]/20 bg-[#f9f5a2] shadow-xs"
                    aria-hidden="true"
                  >
                    <span class="size-1.5 rounded-full bg-[#303030]" />
                  </span>

                  <!-- Running / Minimized indicator dot -->
                  <span
                    v-if="wm.windows[app.id].isOpen"
                    :class="
                      cn(
                        'absolute -bottom-1 h-1 rounded-full transition-all',
                        wm.focusedWindowId.value === app.id && !wm.windows[app.id].isMinimized
                          ? 'w-3 bg-[#303030]'
                          : wm.windows[app.id].isMinimized
                            ? 'w-1.5 bg-[#b0b0b0]'
                            : 'w-1.5 bg-[#303030]/60'
                      )
                    "
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
            </ContextMenuTrigger>
            <TooltipContent side="top" :side-offset="10" class="flex items-center gap-2 font-mono text-[11px]">
              <span class="font-semibold">{{ app.title }}</span>
              <span class="opacity-70">· {{ statusLabel(app) }}</span>
              <kbd
                v-if="app.shortcutDigit && !wm.isMobile.value"
                class="rounded bg-white/15 px-1 py-px text-[10px]"
              >
                {{ wm.shortcutLabels.value.altPrefix }}{{ app.shortcutDigit }}
              </kbd>
            </TooltipContent>
          </Tooltip>

          <ContextMenuContent class="w-44">
            <ContextMenuGroup>
              <ContextMenuItem @select="wm.openWindow(app.id)">
                {{ wm.windows[app.id].isOpen ? "Focus Window" : "Open" }}
              </ContextMenuItem>
              <ContextMenuItem
                v-if="wm.windows[app.id].isOpen && !wm.windows[app.id].isMinimized && !wm.isMobile.value"
                @select="wm.minimizeWindow(app.id)"
              >
                Minimize
              </ContextMenuItem>
              <ContextMenuItem
                v-if="!wm.isMobile.value"
                @select="wm.toggleMaximize(app.id)"
              >
                {{ wm.windows[app.id].isMaximized ? "Restore Size" : "Maximize" }}
              </ContextMenuItem>
            </ContextMenuGroup>
            <template v-if="!wm.isMobile.value">
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem @select="wm.snapWindow(app.id, 'left')">
                  Snap Left Half
                </ContextMenuItem>
                <ContextMenuItem @select="wm.snapWindow(app.id, 'right')">
                  Snap Right Half
                </ContextMenuItem>
              </ContextMenuGroup>
            </template>
            <template v-if="wm.windows[app.id].isOpen">
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem variant="destructive" @select="wm.closeWindow(app.id)">
                  Close {{ app.shortLabel }}
                </ContextMenuItem>
              </ContextMenuGroup>
            </template>
          </ContextMenuContent>
        </ContextMenu>
      </template>

      <template v-if="runningCustomApps.length > 0">
        <Separator orientation="vertical" class="mx-1 h-7 bg-black/10" />
        <template v-for="app in runningCustomApps" :key="app.id">
          <ContextMenu>
            <Tooltip>
              <ContextMenuTrigger as-child>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :data-dock-app="app.id"
                    :aria-label="`${app.title} (${statusLabel(app)})`"
                    :class="
                      cn(
                        'relative flex size-11 shrink-0 items-center justify-center rounded-[14px] border transition-all duration-150 select-none',
                        wm.focusedWindowId.value === app.id && !wm.windows[app.id].isMinimized
                          ? 'bg-[#303030] text-white border-[#303030] shadow-sm -translate-y-0.5'
                          : 'bg-[#f9f5a2]/70 text-[#303030] border-black/10 hover:-translate-y-1 hover:bg-[#f9f5a2]'
                      )
                    "
                    @click="wm.toggleFromDock(app.id)"
                  >
                    <StudioAppIcon :icon="app.icon" class="size-[18px]" />
                    <span
                      :class="
                        cn(
                          'absolute -bottom-1 h-1 rounded-full transition-all',
                          wm.focusedWindowId.value === app.id && !wm.windows[app.id].isMinimized
                            ? 'w-3 bg-[#303030]'
                            : wm.windows[app.id].isMinimized
                              ? 'w-1.5 bg-[#b0b0b0]'
                              : 'w-1.5 bg-[#303030]/60'
                        )
                      "
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
              </ContextMenuTrigger>
              <TooltipContent side="top" :side-offset="10" class="flex items-center gap-2 font-mono text-[11px]">
                <span class="font-semibold">{{ app.title }}</span>
                <span class="opacity-70">· {{ statusLabel(app) }}</span>
              </TooltipContent>
            </Tooltip>
            <ContextMenuContent class="w-44">
              <ContextMenuGroup>
                <ContextMenuItem @select="wm.openWindow(app.id)">Focus Window</ContextMenuItem>
                <ContextMenuItem
                  v-if="!wm.windows[app.id].isMinimized && !wm.isMobile.value"
                  @select="wm.minimizeWindow(app.id)"
                >
                  Minimize
                </ContextMenuItem>
                <ContextMenuItem v-if="!wm.isMobile.value" @select="wm.toggleMaximize(app.id)">
                  {{ wm.windows[app.id].isMaximized ? "Restore Size" : "Maximize" }}
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem variant="destructive" @select="wm.closeWindow(app.id)">
                  Close {{ app.shortLabel }}
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
          </ContextMenu>
        </template>
      </template>

      <Separator orientation="vertical" class="mx-1 h-7 bg-black/10" />

      <!-- Utility Apps (Settings) -->
      <template v-for="app in utilityApps" :key="app.id">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              :data-dock-app="app.id"
              :aria-label="`${app.title} (${statusLabel(app)})`"
              :class="
                cn(
                  'relative flex size-11 shrink-0 items-center justify-center rounded-[14px] border transition-all duration-150 select-none',
                  wm.focusedWindowId.value === app.id && wm.windows[app.id].isOpen && !wm.windows[app.id].isMinimized
                    ? 'bg-[#303030] text-white border-[#303030] shadow-sm -translate-y-0.5'
                    : wm.windows[app.id].isOpen
                      ? 'bg-[#f4f4f4] text-[#303030] border-black/8 hover:-translate-y-1'
                      : 'bg-white text-[#525252] border-black/6 hover:-translate-y-1 hover:bg-[#f4f4f4] hover:text-[#303030]'
                )
              "
              @click="wm.toggleFromDock(app.id)"
            >
              <StudioAppIcon :icon="app.icon" class="size-[18px]" />
              <span
                v-if="wm.windows[app.id].isOpen"
                class="absolute -bottom-1 h-1 w-1.5 rounded-full bg-[#303030]/60"
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" :side-offset="10" class="flex items-center gap-2 font-mono text-[11px]">
            <span class="font-semibold">{{ app.title }}</span>
            <kbd
              v-if="app.shortcutDigit && !wm.isMobile.value"
              class="rounded bg-white/15 px-1 py-px text-[10px]"
            >
              {{ wm.shortcutLabels.value.altPrefix }}{{ app.shortcutDigit }}
            </kbd>
          </TooltipContent>
        </Tooltip>
      </template>
    </div>
  </nav>
</template>
