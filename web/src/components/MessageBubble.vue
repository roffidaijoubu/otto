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

const emit = defineEmits<{
  openStudioApp: [payload: { slug: string; title?: string }];
  openObsOverlay: [payload: { slug: string; title?: string }];
}>();

const visibleText = computed(() =>
  props.text.replace(/<hidden>[\s\S]*?<\/hidden>/gi, "").trim()
);
const html = computed(() => renderMarkdown(visibleText.value));

function handleBodyClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const appCard = target?.closest<HTMLElement>("[data-studio-app-slug]");
  if (appCard) {
    const slug = appCard.getAttribute("data-studio-app-slug");
    if (slug) {
      event.preventDefault();
      emit("openStudioApp", {
        slug,
        title: appCard.getAttribute("data-studio-app-title") || undefined,
      });
    }
    return;
  }
  const obsCard = target?.closest<HTMLElement>("[data-obs-overlay-slug]");
  if (obsCard) {
    const slug = obsCard.getAttribute("data-obs-overlay-slug");
    if (slug) {
      event.preventDefault();
      emit("openObsOverlay", {
        slug,
        title: obsCard.getAttribute("data-obs-overlay-title") || undefined,
      });
    }
  }
}
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
    <div
      v-if="visibleText"
      class="msg-body md-content"
      v-html="html"
      @click="handleBodyClick"
    ></div>
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
.msg-body :deep(.otto-artifact-card) {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 4px 0;
  padding: 7px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-alt);
  color: var(--fg);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.msg-body :deep(.otto-artifact-card:hover) {
  background: var(--highlight-yellow);
  transform: translateY(-1px);
}
.msg-body :deep(.otto-artifact-card-meta) {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
  white-space: nowrap;
}
</style>
