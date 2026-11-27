<script setup lang="ts">
import { computed, ref } from "vue";
import { Copy, Maximize2, Minimize2, Minus, Square, X } from "@lucide/vue";
import { cn } from "@/lib/utils";
import StudioAppIcon from "./StudioAppIcon.vue";
import type {
  StudioAppDefinition,
  StudioWindowState,
  WindowManagerInstance,
} from "@/composables/useWindowManager";

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const props = defineProps<{
  wm: WindowManagerInstance;
  app: StudioAppDefinition;
  win: StudioWindowState;
}>();

const isDragging = ref(false);
const isResizing = ref(false);

const isFocused = computed(() => props.wm.focusedWindowId.value === props.win.id);
const isMacControls = computed(() => props.wm.effectivePlatform.value === "mac");
const isMobile = computed(() => props.wm.isMobile.value);
const showPointerShield = computed(() => props.wm.isInteracting.value);

const frameStyle = computed(() => {
  if (isMobile.value) {
    return {
      zIndex: props.win.zIndex,
    };
  }
  return {
    transform: `translate3d(${props.win.x}px, ${props.win.y}px, 0)`,
    width: `${props.win.width}px`,
    height: `${props.win.height}px`,
    zIndex: props.win.zIndex,
  };
});

function handleWindowPointerDown() {
  if (!isFocused.value) {
    props.wm.focusWindow(props.win.id);
  } else if (props.win.attention) {
    props.wm.clearAttention(props.win.id);
  }
}

function handleTitlebarPointerDown(event: PointerEvent) {
  if (isMobile.value || event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, [data-no-drag='true']")) return;

  props.wm.focusWindow(props.win.id);

  const el = event.currentTarget as HTMLElement | null;

  let startClientX = event.clientX;
  let startClientY = event.clientY;
  let originX = props.win.x;
  let originY = props.win.y;
  let detached = !(props.win.isMaximized || props.win.snapZone !== null);
  let moved = false;
  let captured = false;

  const onPointerMove = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startClientX;
    const dy = moveEvent.clientY - startClientY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) {
      moved = true;
      isDragging.value = true;
      props.wm.interactingWindowId.value = props.win.id;
      try {
        el?.setPointerCapture?.(event.pointerId);
        captured = true;
      } catch {
        // Ignore if pointer already ended
      }
    }
    if (!detached) {
      const next = props.wm.detachFromSnapForDrag(
        props.win.id,
        moveEvent.clientX,
        moveEvent.clientY
      );
      originX = next.x;
      originY = next.y;
      startClientX = moveEvent.clientX;
      startClientY = moveEvent.clientY;
      detached = true;
    } else {
      props.wm.moveWindow(props.win.id, originX + dx, originY + dy);
    }

    props.wm.activeSnapPreview.value = props.wm.detectSnapZone(
      moveEvent.clientX,
      moveEvent.clientY
    );
  };

  const cleanup = (endEvent?: PointerEvent) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (captured && endEvent) {
      try {
        el?.releasePointerCapture?.(endEvent.pointerId);
      } catch {
        // Ignore if capture already released
      }
    }
    const snapZone = props.wm.activeSnapPreview.value;
    props.wm.activeSnapPreview.value = null;
    isDragging.value = false;
    if (props.wm.interactingWindowId.value === props.win.id) {
      props.wm.interactingWindowId.value = null;
    }
    if (moved && snapZone) {
      props.wm.snapWindow(props.win.id, snapZone);
    }
  };

  const onPointerUp = (upEvent: PointerEvent) => cleanup(upEvent);
  const onPointerCancel = (cancelEvent: PointerEvent) => cleanup(cancelEvent);

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
}

function startResize(direction: ResizeDirection, event: PointerEvent) {
  if (isMobile.value || props.win.isMaximized || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  props.wm.focusWindow(props.win.id);

  const el = event.currentTarget as HTMLElement | null;
  el?.setPointerCapture?.(event.pointerId);

  const startX = event.clientX;
  const startY = event.clientY;
  const initX = props.win.x;
  const initY = props.win.y;
  const initW = props.win.width;
  const initH = props.win.height;
  const minW = props.app.minWidth;
  const minH = props.app.minHeight;

  isResizing.value = true;
  props.wm.interactingWindowId.value = props.win.id;

  const onPointerMove = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;

    let nextX = initX;
    let nextY = initY;
    let nextW = initW;
    let nextH = initH;

    if (direction.includes("e")) {
      nextW = Math.max(minW, initW + dx);
    }
    if (direction.includes("s")) {
      nextH = Math.max(minH, initH + dy);
    }
    if (direction.includes("w")) {
      const clampedW = Math.max(minW, initW - dx);
      nextX = initX + (initW - clampedW);
      nextW = clampedW;
    }
    if (direction.includes("n")) {
      const clampedH = Math.max(minH, initH - dy);
      nextY = initY + (initH - clampedH);
      nextH = clampedH;
    }

    props.wm.resizeWindow(props.win.id, {
      x: nextX,
      y: nextY,
      width: nextW,
      height: nextH,
    });
  };

  const cleanup = (endEvent?: PointerEvent) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (endEvent) {
      try {
        el?.releasePointerCapture?.(endEvent.pointerId);
      } catch {
        // Ignore if capture already released
      }
    }
    isResizing.value = false;
    if (props.wm.interactingWindowId.value === props.win.id) {
      props.wm.interactingWindowId.value = null;
    }
  };

  const onPointerUp = (upEvent: PointerEvent) => cleanup(upEvent);
  const onPointerCancel = (cancelEvent: PointerEvent) => cleanup(cancelEvent);

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
}

function handleTitlebarDoubleClick(event: MouseEvent) {
  if (isMobile.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, [data-no-drag='true']")) return;
  props.wm.toggleMaximize(props.win.id);
}
</script>

<template>
  <section
    :data-os-window="win.id"
    :data-focused="isFocused ? 'true' : 'false'"
    :data-maximized="win.isMaximized ? 'true' : 'false'"
    :aria-label="app.title"
    role="region"
    :style="frameStyle"
    :class="
      cn(
        'flex flex-col overflow-hidden bg-white text-[#303030] border',
        isMobile
          ? 'absolute inset-2 rounded-[18px] shadow-[0_12px_34px_rgba(32,32,32,0.12)] border-black/10'
          : 'fixed top-0 left-0 rounded-[20px]',
        !isDragging && !isResizing && !isMobile
          ? 'transition-[transform,width,height,box-shadow,border-color] duration-150 ease-out'
          : 'select-none',
        isFocused
          ? 'border-[#303030]/22 shadow-[0_18px_48px_rgba(32,32,32,0.14),0_2px_8px_rgba(32,32,32,0.06)]'
          : 'border-black/8 shadow-[0_10px_28px_rgba(32,32,32,0.07)]'
      )
    "
    @pointerdown.capture="handleWindowPointerDown"
  >
    <!-- Otto Bento OS Titlebar -->
    <header
      :data-os-titlebar="win.id"
      :class="
        cn(
          'group/titlebar flex h-[38px] shrink-0 items-center justify-between gap-2 border-b px-3 select-none',
          isFocused
            ? 'bg-[#fafafa] border-[#ededed]'
            : 'bg-[#f6f6f6]/90 border-[#efefef]',
          !isMobile && 'cursor-grab active:cursor-grabbing'
        )
      "
      @pointerdown="handleTitlebarPointerDown"
      @dblclick="handleTitlebarDoubleClick"
    >
      <!-- Left: macOS traffic lights (mac only) + App icon + Title + Subtitle -->
      <div class="flex min-w-0 items-center gap-2.5">
        <div
          v-if="isMacControls"
          data-window-controls="mac"
          class="flex items-center gap-1.5"
          data-no-drag="true"
          role="group"
          :aria-label="`${app.title} window controls`"
        >
          <button
            type="button"
            :aria-label="`Close ${app.title}`"
            title="Close"
            :class="
              cn(
                'flex size-3 items-center justify-center rounded-full border transition-colors',
                isFocused
                  ? 'bg-[#ff5f57] border-[#e0443e] text-[#6d0e0a]/0 hover:text-[#6d0e0a]'
                  : 'bg-[#dcdcdc] border-[#cbcbcb] text-transparent group-hover/titlebar:bg-[#ff5f57] group-hover/titlebar:border-[#e0443e] hover:text-[#6d0e0a]'
              )
            "
            @click.stop="wm.closeWindow(win.id)"
          >
            <X class="size-2 stroke-[3]" aria-hidden="true" />
          </button>

          <button
            v-if="!isMobile"
            type="button"
            :aria-label="`Minimize ${app.title}`"
            title="Minimize"
            :class="
              cn(
                'flex size-3 items-center justify-center rounded-full border transition-colors',
                isFocused
                  ? 'bg-[#febc2e] border-[#d89e24] text-[#6b4700]/0 hover:text-[#6b4700]'
                  : 'bg-[#dcdcdc] border-[#cbcbcb] text-transparent group-hover/titlebar:bg-[#febc2e] group-hover/titlebar:border-[#d89e24] hover:text-[#6b4700]'
              )
            "
            @click.stop="wm.minimizeWindow(win.id)"
          >
            <Minus class="size-2 stroke-[3]" aria-hidden="true" />
          </button>

          <button
            v-if="!isMobile"
            type="button"
            :aria-label="win.isMaximized ? `Restore ${app.title}` : `Maximize ${app.title}`"
            :title="win.isMaximized ? 'Restore' : 'Maximize'"
            :class="
              cn(
                'flex size-3 items-center justify-center rounded-full border transition-colors',
                isFocused
                  ? 'bg-[#28c840] border-[#1aab29] text-[#0b4b16]/0 hover:text-[#0b4b16]'
                  : 'bg-[#dcdcdc] border-[#cbcbcb] text-transparent group-hover/titlebar:bg-[#28c840] group-hover/titlebar:border-[#1aab29] hover:text-[#0b4b16]'
              )
            "
            @click.stop="wm.toggleMaximize(win.id)"
          >
            <Minimize2 v-if="win.isMaximized" class="size-2 stroke-[3]" aria-hidden="true" />
            <Maximize2 v-else class="size-2 stroke-[3]" aria-hidden="true" />
          </button>
        </div>

        <div class="flex min-w-0 items-center gap-1.5">
          <span
            :class="
              cn(
                'flex size-5 shrink-0 items-center justify-center rounded-md',
                isFocused ? 'bg-[#303030] text-white' : 'bg-[#eaeaea] text-[#6a6a6a]'
              )
            "
          >
            <StudioAppIcon :icon="app.icon" class="size-3" />
          </span>

          <span
            :class="
              cn(
                'truncate font-mono text-[12px] font-semibold tracking-tight',
                isFocused ? 'text-[#303030]' : 'text-[#737373]'
              )
            "
          >
            {{ app.title }}
          </span>

          <span
            v-if="win.subtitle"
            class="hidden truncate rounded-md bg-[#f2f2f2] px-1.5 py-0.5 font-mono text-[10.5px] text-[#666] sm:inline-block max-w-[200px]"
          >
            {{ win.subtitle }}
          </span>

          <span
            v-if="win.badgeText"
            class="shrink-0 rounded-full bg-[#f9f5a2] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#303030]"
          >
            {{ win.badgeText }}
          </span>
        </div>
      </div>

      <!-- Right: Custom per-window actions slot + Windows/Linux controls (— □ ×) -->
      <div class="flex shrink-0 items-center gap-1.5" data-no-drag="true">
        <slot name="actions" />

        <template v-if="!isMacControls">
          <span
            v-if="$slots.actions"
            class="mx-0.5 h-4 w-px bg-black/10"
            aria-hidden="true"
          />
          <div
            data-window-controls="windows"
            class="flex items-center gap-0.5"
            role="group"
            :aria-label="`${app.title} window controls`"
          >
            <button
              v-if="!isMobile"
              type="button"
              :aria-label="`Minimize ${app.title}`"
              title="Minimize"
              class="flex size-6 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-black/8 hover:text-[#303030]"
              @click.stop="wm.minimizeWindow(win.id)"
            >
              <Minus class="size-3.5 stroke-[2]" aria-hidden="true" />
            </button>

            <button
              v-if="!isMobile"
              type="button"
              :aria-label="win.isMaximized ? `Restore ${app.title}` : `Maximize ${app.title}`"
              :title="win.isMaximized ? 'Restore' : 'Maximize'"
              class="flex size-6 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-black/8 hover:text-[#303030]"
              @click.stop="wm.toggleMaximize(win.id)"
            >
              <Copy v-if="win.isMaximized" class="size-3 stroke-[2]" aria-hidden="true" />
              <Square v-else class="size-3 stroke-[2]" aria-hidden="true" />
            </button>

            <button
              type="button"
              :aria-label="`Close ${app.title}`"
              title="Close"
              class="flex size-6 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-[#e81123] hover:text-white"
              @click.stop="wm.closeWindow(win.id)"
            >
              <X class="size-3.5 stroke-[2]" aria-hidden="true" />
            </button>
          </div>
        </template>
      </div>
    </header>

    <!-- Window Content Body -->
    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <slot />

      <!-- Pointer guard over embedded iframes/videos during drag/resize -->
      <div
        v-if="showPointerShield"
        class="absolute inset-0 z-10 cursor-grabbing bg-transparent"
        aria-hidden="true"
      />
    </div>

    <!-- 8-Way Resize Handles (desktop, unmaximized only) -->
    <template v-if="!isMobile && !win.isMaximized">
      <div
        data-resize-handle="n"
        class="absolute top-0 right-3 left-3 h-1.5 cursor-ns-resize"
        @pointerdown="startResize('n', $event)"
      />
      <div
        data-resize-handle="s"
        class="absolute right-3 bottom-0 left-3 h-1.5 cursor-ns-resize"
        @pointerdown="startResize('s', $event)"
      />
      <div
        data-resize-handle="e"
        class="absolute top-3 right-0 bottom-3 w-1.5 cursor-ew-resize"
        @pointerdown="startResize('e', $event)"
      />
      <div
        data-resize-handle="w"
        class="absolute top-3 bottom-3 left-0 w-1.5 cursor-ew-resize"
        @pointerdown="startResize('w', $event)"
      />
      <div
        data-resize-handle="nw"
        class="absolute top-0 left-0 size-3 cursor-nwse-resize"
        @pointerdown="startResize('nw', $event)"
      />
      <div
        data-resize-handle="ne"
        class="absolute top-0 right-0 size-3 cursor-nesw-resize"
        @pointerdown="startResize('ne', $event)"
      />
      <div
        data-resize-handle="sw"
        class="absolute bottom-0 left-0 size-3 cursor-nesw-resize"
        @pointerdown="startResize('sw', $event)"
      />
      <div
        data-resize-handle="se"
        class="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize"
        @pointerdown="startResize('se', $event)"
      />
    </template>
  </section>
</template>
