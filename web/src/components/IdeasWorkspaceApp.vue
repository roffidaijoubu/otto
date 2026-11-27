<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  FileTextIcon,
  ImageIcon,
  LightbulbIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { playSound } from "@/lib/sounds";

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
const filterStatus = ref<"all" | ContentIdeaItem["status"]>("all");

const newTitle = ref("");
const newFormat = ref<ContentIdeaItem["format"]>("stream");
const newHook = ref("");
const showHookInput = ref(false);

const FORMAT_LABELS: Record<ContentIdeaItem["format"], string> = {
  stream: "Stream",
  video: "Video",
  short: "Short",
  collab: "Collab",
};

const STATUS_OPTIONS: Array<{ value: ContentIdeaItem["status"]; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "prepping", label: "Prepping" },
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "editing", label: "Editing" },
  { value: "published", label: "Published" },
  { value: "dropped", label: "Dropped" },
];

const activeCount = computed(() => items.value.filter((i) => i.status !== "dropped").length);

function formatCount(fmt: "all" | ContentIdeaItem["format"]): number {
  if (fmt === "all") return items.value.length;
  return items.value.filter((i) => i.format === fmt).length;
}

const filteredItems = computed(() =>
  items.value.filter((item) => {
    if (filterFormat.value !== "all" && item.format !== filterFormat.value) return false;
    if (filterStatus.value !== "all" && item.status !== filterStatus.value) return false;
    return true;
  })
);

function statusDotClass(status: ContentIdeaItem["status"]): string {
  if (status === "published") return "bg-emerald-500";
  if (status === "scheduled" || status === "live") return "bg-amber-500";
  if (status === "prepping" || status === "editing") return "bg-blue-500";
  if (status === "dropped") return "bg-neutral-300";
  return "bg-neutral-500";
}

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
    playSound("error");
    return;
  }
  newTitle.value = "";
  newHook.value = "";
  showHookInput.value = false;
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
  const res = await fetch(`/api/db/pipeline/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.ok) playSound("delete");
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
  <div class="flex h-full min-h-0 bg-white text-[#171717]">
    <!-- Left Native Sidebar -->
    <aside class="hidden w-[204px] shrink-0 flex-col border-r border-black/8 bg-[#FAF9F6] sm:flex">
      <div class="flex-1 overflow-y-auto p-2.5">
        <div class="mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          Formats
        </div>
        <div class="flex flex-col gap-0.5">
          <button
            v-for="fmt in (['all', 'stream', 'video', 'short', 'collab'] as const)"
            :key="fmt"
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
            :class="
              filterFormat === fmt
                ? 'bg-[#171717] text-white'
                : 'text-neutral-700 hover:bg-black/5'
            "
            @click="filterFormat = fmt"
          >
            <span>{{ fmt === "all" ? "All Ideas" : `${FORMAT_LABELS[fmt]}s` }}</span>
            <span
              class="font-mono text-[10.5px] tabular-nums"
              :class="filterFormat === fmt ? 'text-white/75' : 'text-neutral-400'"
            >
              {{ formatCount(fmt) }}
            </span>
          </button>
        </div>

        <div class="mt-4 mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          Stage
        </div>
        <div class="flex flex-col gap-0.5">
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
            :class="
              filterStatus === 'all'
                ? 'bg-black/8 text-[#171717]'
                : 'text-neutral-600 hover:bg-black/5'
            "
            @click="filterStatus = 'all'"
          >
            <span>Any Stage</span>
            <span class="font-mono text-[10.5px] text-neutral-400">{{ activeCount }}</span>
          </button>
          <button
            v-for="st in STATUS_OPTIONS.slice(0, 6)"
            :key="st.value"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
            :class="
              filterStatus === st.value
                ? 'bg-black/8 font-medium text-[#171717]'
                : 'text-neutral-600 hover:bg-black/5'
            "
            @click="filterStatus = st.value"
          >
            <span class="size-1.5 shrink-0 rounded-full" :class="statusDotClass(st.value)" />
            <span>{{ st.label }}</span>
          </button>
        </div>
      </div>

      <div class="border-t border-black/8 p-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-8 w-full justify-start gap-1.5 rounded-lg bg-white text-[11px] font-medium"
          @click="emit('askPrompt', 'Review my saved content ideas and suggest which one we should prep next.')"
        >
          <SparklesIcon class="size-3.5 shrink-0" />
          <span>Prioritize with Otto</span>
        </Button>
      </div>
    </aside>

    <!-- Right Main Stage -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <!-- Top Quick-Capture Omnibar -->
      <div class="shrink-0 border-b border-black/8 bg-[#FAF9F6] px-4 py-3">
        <form
          class="flex items-center gap-2 rounded-xl border border-black/12 bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-black/30"
          @submit.prevent="addIdea"
        >
          <LightbulbIcon class="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <input
            v-model="newTitle"
            type="text"
            placeholder="Capture a stream, video, short, or collab idea and press Enter..."
            class="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-[#171717] placeholder:text-neutral-400 focus:outline-none"
          />

          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors"
            :class="
              showHookInput || newHook
                ? 'bg-[#171717] text-white'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
            "
            title="Add hook or angle"
            @click="showHookInput = !showHookInput"
          >
            <SlidersHorizontalIcon class="size-3.5" />
            <span class="hidden sm:inline">Hook</span>
          </button>

          <Select v-model="newFormat">
            <SelectTrigger class="h-7 w-auto gap-1.5 rounded-lg border-0 bg-neutral-100 px-2.5 text-[11px] font-semibold text-[#171717] shadow-none hover:bg-neutral-200/80 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="stream">Stream</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="collab">Collab</SelectItem>
            </SelectContent>
          </Select>

          <div class="h-5 w-px bg-black/10" />

          <Button
            type="submit"
            size="sm"
            class="h-7 gap-1 rounded-lg bg-[#171717] px-3 text-[11px] font-medium text-white hover:bg-neutral-800"
            :disabled="!newTitle.trim()"
          >
            <PlusIcon class="size-3.5" />
            <span>Add</span>
          </Button>
        </form>

        <input
          v-if="showHookInput"
          v-model="newHook"
          type="text"
          placeholder="Optional hook, angle, or thumbnail concept..."
          class="mt-2 h-8 w-full rounded-lg border border-black/10 bg-white px-3 text-xs text-[#171717] placeholder:text-neutral-400 focus:border-black/25 focus:outline-none"
        />
      </div>

      <!-- Mobile Format Strip -->
      <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-black/8 bg-white px-3 py-1.5 sm:hidden">
        <button
          v-for="fmt in (['all', 'stream', 'video', 'short', 'collab'] as const)"
          :key="fmt"
          type="button"
          class="rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap"
          :class="filterFormat === fmt ? 'bg-[#171717] text-white' : 'text-neutral-600'"
          @click="filterFormat = fmt"
        >
          {{ fmt === "all" ? `All (${items.length})` : FORMAT_LABELS[fmt] }}
        </button>
      </div>

      <div v-if="errorMsg" class="border-b border-red-200 bg-red-50 px-4 py-2 font-mono text-xs text-red-700">
        {{ errorMsg }}
      </div>

      <!-- Full-Bleed Ideas List -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-if="filteredItems.length === 0 && !loading"
          class="flex flex-col items-center justify-center px-6 py-20 text-center"
        >
          <LightbulbIcon class="mb-3 size-8 text-neutral-300" aria-hidden="true" />
          <p class="text-xs font-semibold text-neutral-700">No content ideas yet</p>
          <p class="mt-1 max-w-sm text-[11px] text-neutral-500">
            Type an idea in the bar above and press Enter, or ask Otto to brainstorm stream and video concepts for your channel.
          </p>
        </div>

        <div v-else class="divide-y divide-black/6">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="flex flex-wrap items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#FAF9F6]"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-neutral-600">
                  {{ FORMAT_LABELS[item.format] }}
                </span>
                <span class="text-xs font-semibold text-[#171717]">{{ item.title }}</span>
              </div>
              <p v-if="item.hook" class="mt-1 text-xs text-neutral-600">
                {{ item.hook }}
              </p>
              <p v-if="item.notes" class="mt-0.5 text-[11px] text-neutral-400">
                {{ item.notes }}
              </p>

              <div v-if="item.thumbnailPath || item.scriptPath" class="mt-2 flex flex-wrap gap-1.5">
                <button
                  v-if="item.thumbnailPath"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[10.5px] text-neutral-600 hover:bg-neutral-50"
                  @click="emit('openWorkspacePath', item.thumbnailPath.includes('/') ? item.thumbnailPath.slice(0, item.thumbnailPath.lastIndexOf('/')) : '')"
                >
                  <ImageIcon class="size-3" />
                  {{ item.thumbnailPath }}
                </button>
                <button
                  v-if="item.scriptPath"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[10.5px] text-neutral-600 hover:bg-neutral-50"
                  @click="emit('openWorkspacePath', item.scriptPath.includes('/') ? item.scriptPath.slice(0, item.scriptPath.lastIndexOf('/')) : '')"
                >
                  <FileTextIcon class="size-3" />
                  {{ item.scriptPath }}
                </button>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <Select
                :model-value="item.status"
                @update:model-value="(val) => patchIdea(item.id, { status: String(val) as ContentIdeaItem['status'] })"
              >
                <SelectTrigger class="h-7 w-[108px] rounded-lg border border-black/10 bg-white px-2 font-mono text-[11px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem v-for="st in STATUS_OPTIONS" :key="st.value" :value="st.value">
                    {{ st.label }}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                size="xs"
                class="h-7 rounded-lg px-2.5 text-[11px]"
                @click="emit('askPrompt', `Let's plan and prep my ${item.format} idea '${item.title}' (id: ${item.id}) — title options, rundown, and brief notes for my team.`)"
              >
                Prep
              </Button>
              <button
                type="button"
                class="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Delete idea"
                @click="removeIdea(item.id)"
              >
                <Trash2Icon class="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
