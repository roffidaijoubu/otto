<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { PaperclipIcon, Loader2Icon, SendHorizontalIcon, SquareIcon, XIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
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
          <XIcon class="size-3" />
        </button>
      </span>
    </div>

    <div v-if="uploadError" class="attach-err">{{ uploadError }}</div>

    <form class="composer" @submit.prevent="submit">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="shrink-0 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)]"
        :disabled="uploading || busy"
        title="Attach file to workspace/uploads & send to Otto"
        aria-label="Attach file"
        @click="fileInputRef?.click()"
      >
        <Loader2Icon v-if="uploading" class="animate-spin" />
        <PaperclipIcon v-else />
      </Button>
      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="1"
        placeholder="Talk to Otto... (or drop files)"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <Button
        v-if="busy"
        variant="destructive"
        size="sm"
        type="button"
        class="shrink-0 rounded-lg"
        @click="emit('stop')"
      >
        <SquareIcon data-icon="inline-start" />
        Stop
      </Button>
      <Button
        v-else
        size="sm"
        type="submit"
        class="shrink-0 rounded-lg"
        :disabled="uploading || (!modelValue.trim() && attachments.length === 0)"
      >
        <SendHorizontalIcon data-icon="inline-start" />
        Send
      </Button>
    </form>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 10px 16px 14px;
}
.composer-wrap.is-dragover {
  background: #fafafa;
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
  gap: 6px;
  padding: 3px 10px;
  border-radius: 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border-strong);
  font-size: 11.5px;
  font-family: var(--font-sans);
  color: var(--fg);
}
.attach-rm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0;
}
.attach-rm:hover {
  color: var(--fg);
}
.attach-err {
  font-size: 12px;
  font-family: var(--font-sans);
  color: var(--error);
  margin-bottom: 8px;
}
.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: var(--surface);
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
.composer:focus-within {
  border-color: var(--fg);
  box-shadow: 0 0 0 3px rgba(48, 48, 48, 0.08);
}
.composer-wrap.is-dragover .composer {
  border-color: var(--fg);
  border-style: dashed;
}
.composer textarea {
  flex: 1;
  min-height: 32px;
  max-height: 150px;
  resize: none;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  outline: none;
}
.composer textarea::placeholder {
  color: var(--fg-muted);
}
</style>
