<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import MessageBubble from "@/components/MessageBubble.vue";
import type { RefineChatMessage } from "@/lib/refine-stream";
import type { TraceStep } from "@/types/chat";

export interface RefineUploadedAttachment {
  workspacePath: string;
  originalName: string;
  previewUrl: string;
}

const props = defineProps<{
  title?: string;
  subtitle?: string;
  emptyDescription: string;
  placeholder?: string;
  quickPrompts: string[];
  messages: RefineChatMessage[];
  refining: boolean;
  liveText: string;
  liveThinking: string;
  liveSteps: TraceStep[];
  attachments: RefineUploadedAttachment[];
  uploadingImage?: boolean;
}>();

const emit = defineEmits<{
  send: [instruction: string];
  uploadFile: [file: File];
  removeAttachment: [workspacePath: string];
}>();

const inputText = ref("");
const scrollRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    }
  });
}

watch(
  () => [props.messages.length, props.liveText, props.liveThinking, props.liveSteps.length, props.refining],
  scrollToBottom
);

function submit() {
  const text = inputText.value.trim();
  if ((!text && props.attachments.length === 0) || props.refining) return;
  inputText.value = "";
  emit("send", text || "Use the attached image(s) to update this design.");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  for (const file of Array.from(files)) {
    emit("uploadFile", file);
  }
  input.value = "";
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        emit("uploadFile", file);
      }
    }
  }
}
</script>

<template>
  <aside
    class="flex h-[280px] w-full shrink-0 flex-col border-t border-black/10 bg-white md:h-auto md:w-[340px] md:border-l md:border-t-0 lg:w-[380px]"
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center justify-between border-b border-black/8 px-3.5 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <SparklesIcon class="size-3.5 shrink-0 text-[#171717]" aria-hidden="true" />
        <div class="min-w-0">
          <div class="truncate text-xs font-semibold text-[#171717]">
            {{ title || "Refine with Otto" }}
          </div>
          <div v-if="subtitle" class="truncate text-[10.5px] text-neutral-500">
            {{ subtitle }}
          </div>
        </div>
      </div>
      <span class="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
        isolated
      </span>
    </div>

    <!-- Messages & Quick Prompts -->
    <div ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto p-3.5">
      <div v-if="messages.length === 0 && !refining" class="flex flex-col gap-3">
        <p class="text-xs leading-relaxed text-neutral-500">
          {{ emptyDescription }}
        </p>

        <div class="flex flex-col gap-1.5">
          <button
            v-for="chip in quickPrompts"
            :key="chip"
            type="button"
            class="rounded-xl border border-black/10 bg-[#FAFAFA] px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:border-[#171717] hover:bg-white"
            :disabled="refining"
            @click="emit('send', chip)"
          >
            {{ chip }}
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <MessageBubble
          v-for="msg in messages"
          :key="msg.id"
          :role="msg.role"
          :text="msg.text"
          :thinking="msg.thinking"
          :steps="msg.steps"
        />

        <MessageBubble
          v-if="refining"
          role="assistant"
          :text="liveText"
          :thinking="liveThinking"
          :steps="liveSteps"
          live
        />
      </div>
    </div>

    <!-- Unified Composer -->
    <div class="shrink-0 border-t border-black/8 bg-white p-2.5">
      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        class="hidden"
        @change="onFileChange"
      />

      <div v-if="attachments.length > 0" class="mb-2 flex flex-wrap gap-1.5">
        <div
          v-for="att in attachments"
          :key="att.workspacePath"
          class="flex items-center gap-1.5 rounded-lg border border-black/10 bg-[#FAFAFA] py-0.5 pl-1 pr-1.5 text-[11px]"
        >
          <img :src="att.previewUrl" alt="" class="size-5 rounded object-cover" />
          <span class="max-w-[120px] truncate text-neutral-700">{{ att.originalName }}</span>
          <button
            type="button"
            class="text-neutral-400 hover:text-neutral-900"
            aria-label="Remove image"
            @click="emit('removeAttachment', att.workspacePath)"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </div>

      <form
        class="flex items-end gap-1.5 rounded-xl border border-black/15 bg-white p-1.5 transition-colors focus-within:border-[#171717] focus-within:ring-2 focus-within:ring-black/6"
        @submit.prevent="submit"
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          class="size-7 shrink-0 rounded-lg text-neutral-500 hover:text-[#171717]"
          title="Attach or paste image"
          :disabled="uploadingImage || refining"
          @click="fileInputRef?.click()"
        >
          <Loader2Icon v-if="uploadingImage" class="size-3.5 animate-spin" />
          <PaperclipIcon v-else class="size-3.5" />
        </Button>

        <textarea
          v-model="inputText"
          rows="1"
          :placeholder="placeholder || 'Ask Otto to refine... (or paste image)'"
          class="max-h-28 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-xs leading-relaxed text-[#171717] placeholder:text-neutral-400 focus:outline-none"
          :disabled="refining"
          @keydown="onKeydown"
          @paste="onPaste"
        />

        <Button
          type="submit"
          size="icon-sm"
          class="size-7 shrink-0 rounded-lg bg-[#171717] text-white hover:bg-neutral-800"
          :disabled="refining || (!inputText.trim() && attachments.length === 0)"
        >
          <Loader2Icon v-if="refining" class="size-3.5 animate-spin" />
          <SendIcon v-else class="size-3.5" />
        </Button>
      </form>
    </div>
  </aside>
</template>
