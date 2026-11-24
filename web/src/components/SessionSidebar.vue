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
  <aside v-if="open" class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Chats</span>
      <button class="btn" type="button" :disabled="busy" @click="emit('newChat')">+ New</button>
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
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-strong);
  background: var(--surface);
}
.sidebar-header {
  height: var(--header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg);
}
.sidebar-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.session-item {
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}
.session-item:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-alt);
}
.session-item.active {
  border-color: var(--border-strong);
  background: var(--accent);
  color: var(--accent-fg);
}
.session-item:disabled {
  opacity: 0.65;
  cursor: default;
}
.session-item-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}
.session-item.active .session-item-meta {
  color: var(--accent-fg);
  opacity: 0.8;
}
.session-empty {
  padding: 12px 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
}
.backdrop {
  display: none;
}
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 20;
  }
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 15;
  }
}
</style>
