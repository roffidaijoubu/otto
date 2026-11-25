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
      <span class="sidebar-title">Conversations</span>
      <button class="btn btn-xs btn-cafe-secondary" type="button" :disabled="busy" @click="emit('newChat')">
        + New
      </button>
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
  display: none;
}
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  height: 100%;
}
.sidebar-header {
  height: var(--header-height);
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-title {
  font-family: var(--font-serif);
  font-size: 17px;
  color: var(--fg);
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.session-empty {
  padding: 18px 16px;
  font-size: 13px;
  color: var(--fg-muted);
}
.session-item {
  width: 100%;
  text-align: left;
  border: none;
  border-bottom: 1px solid var(--border);
  border-left: 3px solid transparent;
  background: transparent;
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: background var(--duration-fast) var(--ease-out);
}
.session-item:hover:not(:disabled) {
  background: var(--surface-alt);
}
.session-item.active {
  background: var(--surface-inset);
  border-left-color: var(--accent);
  cursor: default;
}
.session-item-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item-meta {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}

@media (max-width: 768px) {
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(62, 39, 35, 0.28);
    z-index: 15;
  }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 20;
    box-shadow: var(--shadow-lg);
  }
}
</style>
