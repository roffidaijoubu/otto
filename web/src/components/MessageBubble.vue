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

const visibleText = computed(() =>
  props.text.replace(/<hidden>[\s\S]*?<\/hidden>/gi, "").trim()
);
const html = computed(() => renderMarkdown(visibleText.value));
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
    <div v-if="visibleText" class="msg-body md-content" v-html="html"></div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg.user {
  align-items: flex-end;
}
.msg.assistant {
  align-items: flex-start;
}
.msg-meta {
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--fg-muted);
  padding: 0 4px;
}
.msg-body {
  max-width: 92%;
  padding: 16px 20px;
  border-radius: var(--radius);
  word-wrap: break-word;
}
.msg.user .msg-body {
  background: var(--surface-alt);
  color: var(--fg);
  box-shadow: var(--shadow-raised-sm);
}
.msg.assistant .msg-body {
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-raised);
  width: 100%;
  max-width: 100%;
}
</style>
