<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";
import type { TraceStep } from "../types/chat";
import ThoughtTrace from "./ThoughtTrace.vue";

const props = defineProps<{
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  steps?: TraceStep[];
  live?: boolean;
}>();

const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <div class="msg" :class="role">
    <div class="msg-meta">{{ role === "user" ? "You" : "Professor L" }}</div>
    <ThoughtTrace
      v-if="role === 'assistant'"
      :thinking="thinking"
      :steps="steps"
      :live="live"
    />
    <div v-if="text.trim()" class="msg-body" v-html="html"></div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
}
.msg.user {
  align-self: flex-end;
  align-items: flex-end;
}
.msg.assistant {
  align-self: flex-start;
  align-items: flex-start;
  width: min(100%, 720px);
}
.msg-meta {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.msg-body {
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  word-break: break-word;
  max-width: 100%;
}
.msg.user .msg-body {
  background: var(--user-bubble-bg);
  color: var(--user-bubble-fg);
}
.msg.assistant .msg-body {
  background: var(--assistant-bubble-bg);
  color: var(--assistant-bubble-fg);
}
.msg-body :deep(p) { margin: 0 0 10px 0; }
.msg-body :deep(p:last-child) { margin-bottom: 0; }
.msg-body :deep(h1),
.msg-body :deep(h2),
.msg-body :deep(h3) {
  margin: 12px 0 6px 0;
  font-size: 15px;
  line-height: 1.3;
}
.msg-body :deep(h1:first-child),
.msg-body :deep(h2:first-child),
.msg-body :deep(h3:first-child) {
  margin-top: 0;
}
.msg-body :deep(ul),
.msg-body :deep(ol) {
  margin: 6px 0 10px 0;
  padding-left: 20px;
}
.msg-body :deep(li) { margin: 3px 0; }
.msg-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 1px 4px;
  border: 1px solid var(--border);
  background: var(--surface-alt);
}
.msg.user .msg-body :deep(code) {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.3);
}
.msg-body :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  overflow-x: auto;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
}
.msg-body :deep(pre code) {
  border: none;
  padding: 0;
  background: transparent;
}
.msg-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 10px;
  border-left: 2px solid var(--border-strong);
  color: var(--fg-muted);
}
.msg-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
@media (max-width: 768px) {
  .msg { max-width: 96%; }
}
</style>
