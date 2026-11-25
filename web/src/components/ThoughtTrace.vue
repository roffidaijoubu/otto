<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";
import type { TraceStep } from "../types/chat";

const props = defineProps<{
  thinking?: string;
  steps?: TraceStep[];
  live?: boolean;
}>();

const expanded = ref(Boolean(props.live));
const thinkingHtml = computed(() => renderMarkdown((props.thinking || "").trim()));

watch(
  () => props.live,
  (isLive, wasLive) => {
    if (isLive) expanded.value = true;
    else if (wasLive && !isLive) expanded.value = false;
  }
);
</script>

<template>
  <div v-if="(thinking && thinking.trim()) || (steps && steps.length)" class="trace">
    <button class="trace-toggle" type="button" @click="expanded = !expanded">
      <span class="trace-dot" :class="{ live }"></span>
      <span class="trace-label">
        {{ live ? "Thinking..." : "Thought trace" }}
        <template v-if="steps && steps.length"> · {{ steps.length }} step{{ steps.length > 1 ? "s" : "" }}</template>
      </span>
      <span class="trace-caret">{{ expanded ? "▲" : "▼" }}</span>
    </button>

    <div v-if="expanded" class="trace-body">
      <div v-if="steps && steps.length" class="trace-steps">
        <div v-for="(step, i) in steps" :key="i" class="trace-step">
          <span class="step-dot" :class="{ done: step.done }"></span>
          <span>{{ step.label }}</span>
        </div>
      </div>
      <div v-if="thinking && thinking.trim()" class="trace-text md-content" v-html="thinkingHtml"></div>
    </div>
  </div>
</template>

<style scoped>
.trace {
  width: 100%;
  margin-bottom: 4px;
}
.trace-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border: none;
  border-radius: var(--radius-circle);
  background: var(--surface-alt);
  color: var(--accent);
  box-shadow: var(--shadow-raised-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.trace-toggle:hover {
  background: var(--surface);
}
.trace-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: var(--accent-secondary);
}
.trace-dot.live {
  background: var(--warning);
  animation: pulse 1.1s ease-in-out infinite;
}
.trace-caret {
  font-size: 9px;
  opacity: 0.7;
}
.trace-body {
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--surface-alt);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trace-steps {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.trace-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg);
}
.step-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: var(--warning);
  flex-shrink: 0;
}
.step-dot.done {
  background: var(--success);
}
.trace-text {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--fg-muted);
  max-height: 220px;
  overflow-y: auto;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
