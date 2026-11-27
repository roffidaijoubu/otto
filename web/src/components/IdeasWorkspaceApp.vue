<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FileTextIcon, ImageIcon, PlusIcon, XIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

export interface ContentIdeaItem {
  id: string;
  title: string;
  format: "stream" | "video" | "short" | "collab";
  status: "idea" | "prepping" | "scheduled" | "live" | "editing" | "published" | "dropped";
  hook: string;
  thumbnailPath: string;
  scriptPath: string;
  scheduledFor: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const props = defineProps<{
  refreshTick: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  openWorkspacePath: [relPath: string];
}>();

const items = ref<ContentIdeaItem[]>([]);
const loading = ref(false);
const errorMsg = ref("");
const filterFormat = ref<"all" | ContentIdeaItem["format"]>("all");

const newTitle = ref("");
const newFormat = ref<ContentIdeaItem["format"]>("stream");
const newHook = ref("");

const activeItems = computed(() => items.value.filter((i) => i.status !== "dropped"));
const filteredItems = computed(() =>
  filterFormat.value === "all"
    ? items.value
    : items.value.filter((i) => i.format === filterFormat.value)
);

async function fetchIdeas() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/db/pipeline");
    const data = (await res.json().catch(() => null)) as { items?: ContentIdeaItem[] } | null;
    if (data && Array.isArray(data.items)) {
      items.value = data.items;
    }
  } finally {
    loading.value = false;
  }
}

async function addIdea() {
  if (!newTitle.value.trim()) return;
  errorMsg.value = "";
  const res = await fetch("/api/db/pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: newTitle.value.trim(),
      format: newFormat.value,
      hook: newHook.value.trim(),
    }),
  });
  if (!res.ok) {
    errorMsg.value = "Could not save idea";
    return;
  }
  newTitle.value = "";
  newHook.value = "";
  await fetchIdeas();
}

async function patchIdea(id: string, patch: Partial<ContentIdeaItem>) {
  await fetch(`/api/db/pipeline/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await fetchIdeas();
}

async function removeIdea(id: string) {
  await fetch(`/api/db/pipeline/${encodeURIComponent(id)}`, { method: "DELETE" });
  await fetchIdeas();
}

watch(
  () => props.refreshTick,
  () => {
    void fetchIdeas();
  },
  { immediate: true }
);

defineExpose({ fetchIdeas });
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-y-auto bg-[#fafafa]/60 p-4">
    <div class="otto-card">
      <div class="otto-card-head">
        <span>(Y)our ideas.</span>
        <div class="otto-card-head-right flex items-center gap-2">
          <span class="otto-chip otto-chip-neutral">
            {{ activeItems.length }} active
          </span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            @click="emit('askPrompt', 'Review my saved content ideas and suggest which one we should prep next.')"
          >
            Prioritize with Otto
          </Button>
        </div>
      </div>

      <div class="otto-card-body flex flex-col gap-3">
        <!-- Quick Add Form -->
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="addIdea">
          <input
            v-model="newTitle"
            type="text"
            class="h-8 flex-1 min-w-[180px] rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs text-[#303030] outline-none focus:border-[#303030]"
            placeholder="New stream, video, short, or collab idea..."
            required
          />
          <select
            v-model="newFormat"
            class="h-8 rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs text-[#303030] outline-none focus:border-[#303030]"
          >
            <option value="stream">Stream</option>
            <option value="video">YouTube Video</option>
            <option value="short">Short / Clip</option>
            <option value="collab">Collab</option>
          </select>
          <input
            v-model="newHook"
            type="text"
            class="h-8 flex-1 min-w-[150px] rounded-full border border-[#ededed] bg-[#f6f6f6] px-3 font-mono text-xs text-[#303030] outline-none focus:border-[#303030]"
            placeholder="Hook / angle (optional)"
          />
          <Button type="submit" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add Idea
          </Button>
        </form>

        <!-- Format Filter Pills -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="fmt in (['all', 'stream', 'video', 'short', 'collab'] as const)"
            :key="fmt"
            type="button"
            class="rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors"
            :class="
              filterFormat === fmt
                ? 'bg-[#303030] text-white'
                : 'bg-[#f2f2f2] text-[#666] hover:text-[#303030]'
            "
            @click="filterFormat = fmt"
          >
            {{ fmt === "all" ? `All (${items.length})` : fmt }}
          </button>
        </div>

        <div v-if="errorMsg" class="font-mono text-xs text-[#991b1b]">{{ errorMsg }}</div>

        <div
          v-if="filteredItems.length === 0 && !loading"
          class="rounded-2xl border border-dashed border-[#d9d9d9] bg-[#fafafa] px-4 py-8 text-center font-mono text-xs text-[#808080]"
        >
          No content ideas yet. Drop an idea above or brainstorm one with Otto.
        </div>

        <div v-else class="flex flex-col gap-2">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="rounded-2xl border border-[#ededed] bg-white p-3 transition-colors hover:border-[#d9d9d9]"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2 min-w-0">
                <span class="otto-chip otto-chip-neutral">{{ item.format }}</span>
                <span class="text-sm font-medium text-[#303030]">{{ item.title }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <select
                  :value="item.status"
                  class="h-7 rounded-full border border-[#ededed] bg-[#f4f4f4] px-2.5 font-mono text-[11px] text-[#303030] outline-none"
                  @change="patchIdea(item.id, { status: ($event.target as HTMLSelectElement).value as ContentIdeaItem['status'] })"
                >
                  <option value="idea">Idea</option>
                  <option value="prepping">Prepping</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="editing">Editing</option>
                  <option value="published">Published</option>
                  <option value="dropped">Dropped</option>
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  @click="emit('askPrompt', `Let's plan and prep my ${item.format} idea '${item.title}' (id: ${item.id}) — title options, rundown, and brief notes for my team.`)"
                >
                  Prep
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  class="text-destructive hover:text-destructive"
                  aria-label="Delete idea"
                  @click="removeIdea(item.id)"
                >
                  <XIcon />
                </Button>
              </div>
            </div>

            <div v-if="item.hook" class="mt-1.5 text-xs text-[#666]">Hook: {{ item.hook }}</div>
            <div v-if="item.notes" class="mt-0.5 text-xs text-[#737373]">{{ item.notes }}</div>

            <div v-if="item.thumbnailPath || item.scriptPath" class="mt-2 flex flex-wrap gap-1.5">
              <Button
                v-if="item.thumbnailPath"
                type="button"
                variant="secondary"
                size="xs"
                @click="emit('openWorkspacePath', item.thumbnailPath.includes('/') ? item.thumbnailPath.slice(0, item.thumbnailPath.lastIndexOf('/')) : '')"
              >
                <ImageIcon data-icon="inline-start" />
                {{ item.thumbnailPath }}
              </Button>
              <Button
                v-if="item.scriptPath"
                type="button"
                variant="secondary"
                size="xs"
                @click="emit('openWorkspacePath', item.scriptPath.includes('/') ? item.scriptPath.slice(0, item.scriptPath.lastIndexOf('/')) : '')"
              >
                <FileTextIcon data-icon="inline-start" />
                {{ item.scriptPath }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
