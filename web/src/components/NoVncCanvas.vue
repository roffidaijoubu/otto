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
const state = ref<"idle" | "connecting" | "reconnecting" | "connected" | "disconnected">("idle");
const disconnectReason = ref("");
let rfb: RFB | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let reconnectAttempts = 0;
let intentionalDisconnect = false;
const MAX_RECONNECT_ATTEMPTS = 6;

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function disconnect() {
  intentionalDisconnect = true;
  clearReconnectTimer();
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

function scheduleReconnect() {
  clearReconnectTimer();
  if (!props.active) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    state.value = "disconnected";
    disconnectReason.value = "Display stream disconnected.";
    return;
  }
  reconnectAttempts += 1;
  state.value = "reconnecting";
  const delayMs = Math.min(800 * Math.pow(1.6, reconnectAttempts - 1), 5000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (props.active) {
      connectInternal(true);
    }
  }, delayMs);
}

function connectInternal(isRetry = false) {
  clearReconnectTimer();
  if (rfb) {
    intentionalDisconnect = true;
    try {
      rfb.disconnect();
    } catch {
      // ignore
    }
    rfb = null;
  }
  if (!props.active || !containerRef.value) return;

  intentionalDisconnect = false;
  disconnectReason.value = "";
  state.value = isRetry ? "reconnecting" : "connecting";

  try {
    const client = new RFB(containerRef.value, buildWsUrl(props.wsPath));
    client.scaleViewport = true;
    client.resizeSession = false;
    client.viewOnly = props.viewOnly;
    client.background = props.background;

    client.addEventListener("connect", () => {
      if (rfb !== client) return;
      reconnectAttempts = 0;
      disconnectReason.value = "";
      state.value = "connected";
      client.focus();
      emit("connected");
    });

    client.addEventListener("disconnect", (e: CustomEvent<{ clean?: boolean }>) => {
      if (rfb !== client) return;
      rfb = null;
      const clean = Boolean(e?.detail?.clean);
      emit("disconnected", clean);
      if (intentionalDisconnect || !props.active) {
        state.value = "disconnected";
        return;
      }
      if (!clean) {
        emit("error", "VNC connection closed unexpectedly.");
      }
      scheduleReconnect();
    });

    rfb = client;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    disconnectReason.value = message;
    emit("error", message);
    scheduleReconnect();
  }
}

function connect() {
  reconnectAttempts = 0;
  connectInternal(false);
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
  if (containerRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (rfb) {
        rfb.scaleViewport = true;
      }
    });
    resizeObserver.observe(containerRef.value);
  }
  if (props.active) connect();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  disconnect();
});
</script>

<template>
  <div class="novnc-wrap" :style="{ background: props.background }">
    <div ref="containerRef" class="novnc-stage" @click="focusCanvas" />
    <div v-if="state === 'connecting' || state === 'reconnecting'" class="novnc-overlay">
      <span>{{ state === "reconnecting" ? "Reconnecting to browser…" : "Connecting to browser…" }}</span>
    </div>
    <div v-else-if="state === 'disconnected' && props.active" class="novnc-overlay novnc-overlay-interactive">
      <span>{{ disconnectReason || "Browser display disconnected." }}</span>
      <button type="button" class="novnc-retry-btn" @click="connect">
        Reconnect
      </button>
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(250, 250, 250, 0.88);
  color: #303030;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
}

.novnc-overlay-interactive {
  pointer-events: auto;
}

.novnc-retry-btn {
  border: 1px solid #d4d4d8;
  background: #ffffff;
  color: #303030;
  border-radius: 9999px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.novnc-retry-btn:hover {
  background: #f4f4f5;
}
</style>
