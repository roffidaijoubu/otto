<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import RFB from "@novnc/novnc";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    wsPath?: string;
    viewOnly?: boolean;
  }>(),
  {
    active: true,
    wsPath: "/api/browser/ws",
    viewOnly: false,
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
    client.background = "#141414";

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
  <div class="novnc-wrap">
    <div ref="containerRef" class="novnc-stage" @click="focusCanvas" />
    <div v-if="state === 'connecting'" class="novnc-overlay">
      <span>Connecting to Sprite Chrome…</span>
    </div>
  </div>
</template>

<style scoped>
.novnc-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  background: #141414;
  border-radius: 10px;
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
  background: rgba(20, 20, 20, 0.72);
  color: #f4f4f5;
  font-size: 13px;
  pointer-events: none;
}
</style>
