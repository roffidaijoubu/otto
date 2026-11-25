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
  gap: 7px;
  padding: 4px 11px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--surface-alt);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.trace-toggle:hover {
  background: var(--surface-inset-hover);
}
.trace-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--fg-muted);
}
.trace-dot.live {
  background: #ca8a04;
  animation: pulse 1.1s ease-in-out infinite;
}
.trace-caret {
  font-size: 9px;
  opacity: 0.65;
}
.trace-body {
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trace-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trace-step {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg);
}
.step-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: #ca8a04;
  flex-shrink: 0;
}
.step-dot.done {
  background: #16a34a;
}
.trace-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-muted);
  max-height: 200px;
  overflow-y: auto;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
