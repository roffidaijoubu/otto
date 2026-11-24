<script setup lang="ts">
defineProps<{
  sidebarOpen: boolean;
  statusState: "ready" | "busy" | "error";
  statusLabel: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  newChat: [];
}>();
</script>

<template>
  <header class="header">
    <div class="header-left">
      <button class="btn" type="button" @click="emit('toggleSidebar')">
        {{ sidebarOpen ? "Hide" : "Chats" }}
      </button>
      <div class="brand">
        <div class="avatar">L</div>
        <div>
          <div class="brand-title">Professor L</div>
          <div class="brand-sub">Talent Manager</div>
        </div>
      </div>
    </div>
    <div class="header-actions">
      <span class="status">
        <span class="status-dot" :class="statusState"></span>
        <span>{{ statusLabel }}</span>
      </span>
      <button class="btn" type="button" :disabled="busy" @click="emit('newChat')">New Chat</button>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: var(--header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-circle);
  border: 1px solid var(--border-strong);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  font-family: var(--font-mono);
  background: var(--surface);
  color: var(--fg);
}
.brand-title {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.brand-sub {
  font-size: 12px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: var(--warning);
}
.status-dot.ready { background: var(--success); }
.status-dot.busy { background: var(--warning); }
.status-dot.error { background: var(--error); }

@media (max-width: 768px) {
  .brand-sub { display: none; }
}
</style>
