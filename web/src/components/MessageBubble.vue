<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";
import type { TraceStep } from "../types/chat";
import OttoMascot from "./OttoMascot.vue";
import ThoughtTrace from "./ThoughtTrace.vue";

const props = defineProps<{
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  steps?: TraceStep[];
  live?: boolean;
  mascotColor?: string;
}>();

const visibleText = computed(() =>
  props.text.replace(/<hidden>[\s\S]*?<\/hidden>/gi, "").trim()
);
const html = computed(() => renderMarkdown(visibleText.value));
</script>

<template>
  <div class="msg" :class="role">
    <div class="msg-meta">
      <OttoMascot
        v-if="role === 'assistant'"
        :size="18"
        :color="mascotColor || '#303030'"
        :state="live ? 'busy' : 'ready'"
      />
      <span>{{ role === "user" ? "you" : "otto" }}</span>
    </div>
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
  gap: 5px;
}
.msg.user {
  align-items: flex-end;
}
.msg.assistant {
  align-items: flex-start;
}
.msg-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--fg-muted);
  padding: 0 4px;
}
.msg-body {
  max-width: 92%;
  padding: 13px 16px;
  border-radius: 16px;
  word-wrap: break-word;
  font-size: 13.5px;
  line-height: 1.55;
}
.msg.user .msg-body {
  background: var(--surface-alt);
  color: var(--fg);
}
.msg.assistant .msg-body {
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 100%;
}
</style>
