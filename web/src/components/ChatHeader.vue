<script setup lang="ts">
defineProps<{
  statusState: "ready" | "busy" | "error";
  statusLabel: string;
  zeroLocalKeys: boolean | null;
  aiMediaDisabled: boolean | null;
  mobilePane: "dashboard" | "chat";
}>();

const emit = defineEmits<{
  "update:mobilePane": [pane: "dashboard" | "chat"];
}>();
</script>

<template>
  <header class="header">
    <div class="header-left">
      <div class="brand">
        <div class="avatar">L</div>
        <div>
          <div class="brand-title">Professor L</div>
          <div class="brand-sub">Studio Mission Control</div>
        </div>
      </div>
    </div>

    <div class="mobile-switch">
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: mobilePane === 'dashboard' }"
        @click="emit('update:mobilePane', 'dashboard')"
      >
        Mission Control
      </button>
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: mobilePane === 'chat' }"
        @click="emit('update:mobilePane', 'chat')"
      >
        Co-Pilot
      </button>
    </div>

    <div class="header-actions">
      <span v-if="zeroLocalKeys === true" class="guard-pill guard-ok">
        0 Keys in VM
      </span>
      <span v-if="aiMediaDisabled === true" class="guard-pill guard-off">
        No AI Art
      </span>
      <span class="status-pill" :class="statusState">
        <span class="status-dot" :class="statusState"></span>
        <span>{{ statusLabel }}</span>
      </span>
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
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-circle);
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
  font-size: 18px;
  background: var(--accent);
  color: var(--accent-fg);
  box-shadow: var(--shadow-raised-sm);
}
.brand-title {
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 20px;
  line-height: 1.1;
  color: var(--fg);
}
.brand-sub {
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-circle);
  font-size: 11.5px;
  font-family: var(--font-mono);
  font-weight: 500;
}
.status-pill.ready {
  background: var(--success-bg);
  color: var(--success);
}
.status-pill.busy {
  background: var(--warning-bg);
  color: var(--warning);
}
.status-pill.error {
  background: var(--error-bg);
  color: var(--error);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
}
.status-dot.ready { background: var(--success); }
.status-dot.busy { background: var(--warning); }
.status-dot.error { background: var(--error); }
.guard-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--radius-circle);
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 600;
}
.guard-ok {
  background: var(--success-bg);
  color: var(--success);
}
.guard-off {
  background: var(--error-bg);
  color: var(--error);
}
.mobile-switch {
  display: none;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-circle);
  background: var(--surface-inset);
}
.mobile-tab {
  border: none;
  border-radius: var(--radius-circle);
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
}
.mobile-tab.active {
  background: var(--accent);
  color: var(--accent-fg);
}

@media (max-width: 1024px) {
  .mobile-switch { display: inline-flex; }
  .guard-pill { display: none; }
}
@media (max-width: 768px) {
  .header { padding: 0 12px; }
  .brand-sub, .status-pill { display: none; }
}
</style>
