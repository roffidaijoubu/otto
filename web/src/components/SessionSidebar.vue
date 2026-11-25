<script setup lang="ts">
import type { SessionSummary } from "../types/chat";

defineProps<{
  open: boolean;
  sessions: SessionSummary[];
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  newChat: [];
  select: [session: SessionSummary];
}>();

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
</script>

<template>
  <div v-if="open" class="backdrop" @click="emit('close')"></div>
  <aside v-if="open" class="sidebar otto-card">
    <div class="otto-card-head">
      <span>(Y)our chats.</span>
      <div class="otto-card-head-right">
        <button class="btn btn-xs btn-otto-primary" type="button" :disabled="busy" @click="emit('newChat')">
          + New
        </button>
        <button class="btn btn-xs btn-otto-secondary" type="button" @click="emit('close')">
          ✕
        </button>
      </div>
    </div>
    <div class="session-list">
      <div v-if="sessions.length === 0" class="session-empty">No previous chats yet.</div>
      <button
        v-for="s in sessions"
        :key="s.path"
        type="button"
        class="session-item"
        :class="{ active: s.active }"
        :disabled="busy || s.active"
        @click="emit('select', s)"
      >
        <span class="session-item-title">{{ s.title }}</span>
        <span class="session-item-meta">{{ formatTime(s.updatedAt) }} · {{ s.messageCount }} msgs</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(48, 48, 48, 0.25);
  backdrop-filter: blur(2px);
  z-index: 40;
}
.sidebar {
  position: fixed;
  top: 66px;
  right: 18px;
  bottom: 18px;
  width: min(92vw, 320px);
  z-index: 50;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.session-empty {
  padding: 20px 12px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
}
.session-item {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: none;
  border-radius: 12px;
  background: var(--surface-alt);
  color: var(--fg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: background var(--duration-fast) var(--ease-out);
}
.session-item:hover:not(:disabled) {
  background: var(--surface-inset-hover);
}
.session-item.active {
  background: var(--highlight-yellow);
  cursor: default;
}
.session-item-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item-meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}
</style>
