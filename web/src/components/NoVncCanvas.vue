<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import RFB from "@novnc/novnc";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    wsPath?: string;
    viewOnly?: boolean;
    background?: string;
  }>(),
  {
    active: true,
    wsPath: "/api/browser/ws",
    viewOnly: false,
    background: "#f4f4f5",
  }
);

const emit = defineEmits<{
  connected: [];
  disconnected: [clean: boolean];
  error: [message: string];
}>();

const containerRef = ref<HTMLElement | null>(null);
const state = ref<"idle" | "connecting" | "connected" | "disconnected">("idle");
let rfb: RFB | null = null;

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

function disconnect() {
  if (rfb) {
    try {
      rfb.disconnect();
    } catch {
      // ignore
    }
    rfb = null;
  }
  state.value = "disconnected";
}

function connect() {
  disconnect();
  if (!props.active || !containerRef.value) return;

  state.value = "connecting";
  try {
    const client = new RFB(containerRef.value, buildWsUrl(props.wsPath));
    client.scaleViewport = true;
    client.resizeSession = false;
    client.viewOnly = props.viewOnly;
    client.background = props.background;

    client.addEventListener("connect", () => {
      state.value = "connected";
      client.focus();
      emit("connected");
    });

    client.addEventListener("disconnect", (e: CustomEvent<{ clean?: boolean }>) => {
      const clean = Boolean(e?.detail?.clean);
      state.value = "disconnected";
      if (!clean) {
        emit("error", "VNC connection closed unexpectedly.");
      }
      emit("disconnected", clean);
    });

    rfb = client;
  } catch (err) {
    state.value = "disconnected";
    emit("error", err instanceof Error ? err.message : String(err));
  }
}

function pasteText(text: string) {
  if (rfb && text) {
    rfb.clipboardPasteFrom(text);
  }
}

function focusCanvas() {
  rfb?.focus();
}

defineExpose({
  connect,
  disconnect,
  pasteText,
  focusCanvas,
  state,
});

watch(
  () => props.active,
  (isActive) => {
    if (isActive) connect();
    else disconnect();
  }
);

onMounted(() => {
  if (props.active) connect();
});

onBeforeUnmount(() => {
  disconnect();
});
</script>

<template>
  <div class="novnc-wrap" :style="{ background: props.background }">
    <div ref="containerRef" class="novnc-stage" @click="focusCanvas" />
    <div v-if="state === 'connecting'" class="novnc-overlay">
      <span>Connecting to browser…</span>
    </div>
  </div>
</template>

<style scoped>
.novnc-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.novnc-stage {
  width: 100%;
  height: 100%;
}

.novnc-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(250, 250, 250, 0.85);
  color: #303030;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
}
</style>
