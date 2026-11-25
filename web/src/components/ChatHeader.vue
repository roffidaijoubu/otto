<script setup lang="ts">
import OttoMascot from "./OttoMascot.vue";

export type StudioTab = "overview" | "schedule" | "files" | "database" | "playbooks" | "dossier" | "connectors" | "browser";

defineProps<{
  statusState: "ready" | "busy" | "error";
  statusLabel: string;
  mobilePane: "dashboard" | "chat";
  activeTab: StudioTab;
  mascotColor: string;
  counts: {
    schedule: number;
    files: number;
    database: number;
    playbooks: number;
    connectors: number;
  };
}>();

const emit = defineEmits<{
  "update:mobilePane": [pane: "dashboard" | "chat"];
  "update:activeTab": [tab: StudioTab];
  cycleMascotColor: [];
}>();

const tabs: Array<{ id: StudioTab; label: string; countKey?: "schedule" | "files" | "database" | "playbooks" | "connectors" }> = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule", countKey: "schedule" },
  { id: "files", label: "Files & Clips", countKey: "files" },
  { id: "database", label: "Studio DB", countKey: "database" },
  { id: "playbooks", label: "Playbooks", countKey: "playbooks" },
  { id: "dossier", label: "Dossier" },
  { id: "connectors", label: "Connectors", countKey: "connectors" },
  { id: "browser", label: "Browser" },
];
</script>

<template>
  <header class="otto-header">
    <div class="header-left">
      <button
        type="button"
        class="eyes-pill"
        title="Otto Studio Overview"
        aria-label="Otto Studio Overview"
        @click="emit('update:activeTab', 'overview'); emit('update:mobilePane', 'dashboard')"
      >
        <OttoMascot :size="28" :state="statusState" eyes-only />
      </button>

      <nav class="nav-pill-bar" aria-label="Studio navigation">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="nav-pill-btn"
          :class="{ active: activeTab === tab.id }"
          @click="emit('update:activeTab', tab.id); emit('update:mobilePane', 'dashboard')"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.countKey" class="nav-count">{{ counts[tab.countKey] }}</span>
        </button>
      </nav>
    </div>

    <div class="mobile-switch">
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: mobilePane === 'dashboard' }"
        @click="emit('update:mobilePane', 'dashboard')"
      >
        Studio
      </button>
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: mobilePane === 'chat' }"
        @click="emit('update:mobilePane', 'chat')"
      >
        Otto Chat
      </button>
    </div>

    <div class="header-right">
      <span class="status-float-pill" :class="`st-${statusState}`">
        <span class="st-dot"></span>
        <span>{{ statusLabel }}</span>
      </span>
      <button
        type="button"
        class="mascot-btn"
        title="Click to switch Otto's swatch color"
        aria-label="Switch Otto swatch color"
        @click="emit('cycleMascotColor')"
      >
        <OttoMascot :size="30" :color="mascotColor" :state="statusState" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.otto-header {
  height: var(--header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px 4px;
  gap: 10px;
  background: transparent;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eyes-pill {
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform var(--duration-fast) var(--ease-out);
}
.eyes-pill:hover {
  transform: translateY(-1px);
  background: #ffffff;
}
.nav-pill-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: var(--shadow-pill);
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-pill-bar::-webkit-scrollbar {
  display: none;
}
.nav-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 400;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.nav-pill-btn:hover {
  color: var(--fg);
  background: var(--surface-alt);
}
.nav-pill-btn.active {
  background: var(--fg);
  color: #ffffff;
  font-weight: 500;
}
.nav-count {
  font-size: 10px;
  opacity: 0.72;
}
.nav-pill-btn.active .nav-count {
  opacity: 0.88;
}

.mobile-switch {
  display: none;
  background: rgba(255, 255, 255, 0.9);
  border-radius: var(--radius-pill);
  padding: 3px;
  box-shadow: var(--shadow-pill);
}
.mobile-tab {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 5px 11px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.mobile-tab.active {
  background: var(--fg);
  color: #ffffff;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.status-float-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-pill);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
}
.pill-ok {
  background: var(--success-bg);
  color: var(--success);
}
.pill-noai {
  background: var(--error-bg);
  color: var(--error);
}
.st-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: #16a34a;
}
.st-busy {
  background: var(--highlight-yellow);
  color: var(--fg);
}
.st-busy .st-dot {
  background: #ca8a04;
}
.st-error {
  background: var(--error-bg);
  color: var(--error);
}
.st-error .st-dot {
  background: #dc2626;
}
.mascot-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: #ffffff;
  box-shadow: var(--shadow-pill);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}
.mascot-btn:hover {
  transform: scale(1.06);
}

@media (max-width: 1140px) {
  .pill-ok,
  .pill-noai {
    display: none;
  }
}
@media (max-width: 1024px) {
  .nav-pill-bar {
    display: none;
  }
  .mobile-switch {
    display: inline-flex;
  }
}
@media (max-width: 640px) {
  .otto-header {
    padding: 8px 10px 4px;
  }
  .status-float-pill {
    display: none;
  }
}
</style>
