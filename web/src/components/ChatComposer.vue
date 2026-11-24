<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);

function autoResize() {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

watch(
  () => props.modelValue,
  () => nextTick(autoResize)
);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    emit("send");
  }
}
</script>

<template>
  <div class="composer-wrap">
    <form class="composer" @submit.prevent="emit('send')">
      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="1"
        placeholder="Talk to Professor L... (Enter to send, Shift+Enter for newline)"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <button v-if="busy" class="btn btn-danger" type="button" @click="emit('stop')">Stop</button>
      <button class="btn btn-primary" type="submit" :disabled="busy || !modelValue.trim()">Send</button>
    </form>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex-shrink: 0;
  border-top: 1px solid var(--border-strong);
  background: var(--bg);
  padding: 12px 16px;
}
.composer {
  max-width: var(--max-width);
  margin: 0 auto;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  min-height: 42px;
  max-height: 160px;
  resize: none;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}
.composer textarea:focus {
  background: var(--surface);
}
</style>
