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
      <span class="trace-caret">{{ expanded ? "[-]" : "[+]" }}</span>
    </button>

    <div v-if="expanded" class="trace-body">
      <div v-if="steps && steps.length" class="trace-steps">
        <div v-for="(step, i) in steps" :key="i" class="trace-step">
          <span class="step-dot" :class="{ done: step.done }"></span>
          <span>{{ step.label }}</span>
        </div>
      </div>
      <div v-if="thinking && thinking.trim()" class="trace-text" v-html="thinkingHtml"></div>
    </div>
  </div>
</template>

<style scoped>
.trace {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  margin-bottom: 6px;
}
.trace-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: var(--surface);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.trace-toggle:hover {
  background: var(--surface-alt);
  color: var(--fg);
}
.trace-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: var(--success);
  flex-shrink: 0;
}
.trace-dot.live {
  background: var(--warning);
  animation: pulse 1.2s ease-in-out infinite;
}
.trace-label {
  flex: 1;
}
.trace-caret {
  font-weight: 700;
}
.trace-body {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
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
  font-size: 11px;
  color: var(--fg);
}
.step-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-circle);
  background: var(--warning);
}
.step-dot.done {
  background: var(--success);
}
.trace-text {
  margin: 0;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--fg-muted);
  max-height: 220px;
  overflow-y: auto;
}
.trace-text :deep(p) { margin: 0 0 6px 0; }
.trace-text :deep(p:last-child) { margin-bottom: 0; }
.trace-text :deep(strong) { color: var(--fg); }
.trace-text :deep(ul),
.trace-text :deep(ol) { margin: 4px 0 6px 0; padding-left: 16px; }
.trace-text :deep(code) {
  padding: 0 3px;
  border: 1px solid var(--border);
  background: var(--surface);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
