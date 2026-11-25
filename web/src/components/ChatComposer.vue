<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

export interface ComposerAttachment {
  name: string;
  relPath: string;
  absPath: string;
  kind: string;
  sizeBytes: number;
}

const props = defineProps<{
  modelValue: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [attachments: ComposerAttachment[]];
  stop: [];
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const attachments = ref<ComposerAttachment[]>([]);
const uploading = ref(false);
const uploadError = ref("");
const dragOver = ref(false);

function autoResize() {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 150) + "px";
}

watch(
  () => props.modelValue,
  () => nextTick(autoResize)
);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}

function submit() {
  if (props.busy || uploading.value) return;
  if (!props.modelValue.trim() && attachments.value.length === 0) return;
  const attached = [...attachments.value];
  attachments.value = [];
  uploadError.value = "";
  emit("send", attached);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

async function uploadFiles(list: FileList | File[]) {
  const arr = Array.from(list);
  if (arr.length === 0) return;
  uploading.value = true;
  uploadError.value = "";
  try {
    const form = new FormData();
    form.append("dir", "uploads");
    for (const f of arr) form.append("files", f);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
    const data = (await res.json()) as {
      ok?: boolean;
      uploaded?: ComposerAttachment[];
      error?: string;
    };
    if (!res.ok || !data.uploaded) {
      uploadError.value = data.error || "Upload failed";
      return;
    }
    attachments.value.push(...data.uploaded);
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : "Upload failed";
  } finally {
    uploading.value = false;
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    uploadFiles(input.files);
    input.value = "";
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    uploadFiles(e.dataTransfer.files);
  }
}

function removeAttachment(relPath: string) {
  attachments.value = attachments.value.filter((a) => a.relPath !== relPath);
}

function attachIcon(kind: string): string {
  if (kind === "image") return "🖼";
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "📎";
}
</script>

<template>
  <div
    class="composer-wrap"
    :class="{ 'is-dragover': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave.self="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFileChange" />

    <div v-if="attachments.length > 0" class="attach-chips">
      <span v-for="att in attachments" :key="att.relPath" class="attach-chip">
        <span>{{ attachIcon(att.kind) }}</span>
        <span class="truncate max-w-[160px]">{{ att.name }}</span>
        <button type="button" class="attach-rm" aria-label="Remove attachment" @click="removeAttachment(att.relPath)">
          ✕
        </button>
      </span>
    </div>

    <div v-if="uploadError" class="attach-err">{{ uploadError }}</div>

    <form class="composer" @submit.prevent="submit">
      <button
        type="button"
        class="attach-btn"
        :disabled="uploading || busy"
        title="Attach file to workspace/uploads & send to Otto"
        aria-label="Attach file"
        @click="fileInputRef?.click()"
      >
        {{ uploading ? "…" : "📎" }}
      </button>
      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="1"
        placeholder="Talk to Otto... (or drop files)"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <button v-if="busy" class="btn btn-sm btn-danger" type="button" @click="emit('stop')">Stop</button>
      <button
        class="btn btn-sm btn-otto-primary"
        type="submit"
        :disabled="busy || uploading || (!modelValue.trim() && attachments.length === 0)"
      >
        Send
      </button>
    </form>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 12px 14px 14px;
}
.composer-wrap.is-dragover {
  background: var(--highlight-yellow);
}
.attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--highlight-cyan);
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg);
}
.attach-rm {
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  padding: 0 2px;
  font-size: 11px;
}
.attach-err {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--error);
  margin-bottom: 6px;
}
.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.attach-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--surface-alt);
  color: var(--fg);
  font-size: 15px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--duration-fast) var(--ease-out);
}
.attach-btn:hover:not(:disabled) {
  background: var(--surface-inset-hover);
}
.attach-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.composer textarea {
  flex: 1;
  min-height: 38px;
  max-height: 150px;
  resize: none;
  padding: 9px 15px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.45;
  outline: none;
  transition: background var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
.composer textarea::placeholder {
  color: var(--fg-muted);
}
.composer textarea:hover {
  background: var(--surface-inset-hover);
}
.composer textarea:focus {
  background: var(--surface-inset);
  box-shadow: var(--shadow-focus);
}
</style>
