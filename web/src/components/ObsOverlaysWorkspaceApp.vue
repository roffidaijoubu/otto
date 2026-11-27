<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MonitorPlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ObsOverlayItem {
  slug: string;
  title: string;
  description: string;
  overlayUrl: string;
  controlUrl: string;
  updatedAt: string;
}

interface MachineStatus {
  connectorAvailable: boolean;
  connectorName: string;
  provisioned: boolean;
  appName?: string;
  region?: string;
  baseUrl?: string;
  machineState?: string;
}

const props = defineProps<{
  refreshTick: number;
  initialSlug?: string;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  selectedChanged: [payload: { slug: string; title: string }];
}>();

const status = ref<MachineStatus>({
  connectorAvailable: false,
  connectorName: "Fly Machines",
  provisioned: false,
});
const overlays = ref<ObsOverlayItem[]>([]);
const viewMode = ref<"list" | "detail">("list");
const selectedSlug = ref("");
const stageBackdrop = ref<"checker" | "dark" | "chroma">("checker");
const showRemote = ref(true);
const loading = ref(true);
const frameKey = ref(0);
const copiedKey = ref("");
const deleteTarget = ref<ObsOverlayItem | null>(null);
const deleting = ref(false);

const showCreateDialog = ref(false);
const customOverlayPrompt = ref("");

// ResizeObserver for true 1920x1080 aspect-ratio scaling on Detail stage
const stageWrapRef = ref<HTMLElement | null>(null);
const previewScale = ref(0.35);
let stageObserver: ResizeObserver | null = null;

const selectedOverlay = computed(
  () => overlays.value.find((o) => o.slug === selectedSlug.value) || null
);

const scaledBoxStyle = computed(() => ({
  width: `${Math.round(1920 * previewScale.value)}px`,
  height: `${Math.round(1080 * previewScale.value)}px`,
}));

const scaledIframeStyle = computed(() => ({
  width: "1920px",
  height: "1080px",
  transform: `scale(${previewScale.value})`,
  transformOrigin: "top left",
}));

const starters = [
  {
    label: "Starting Soon Countdown",
    desc: "10-minute timer, stream title & live Start/Pause/Reset deck",
    prompt:
      "Deploy a transparent 1920x1080 Starting Soon countdown OBS overlay to my Fly Machine with remote Start/Pause/Reset and editable stream title.",
  },
  {
    label: "Broadcast Lower Third",
    desc: "Clean animated name/topic plate with remote show/hide toggle",
    prompt:
      "Deploy a clean transparent 1920x1080 Lower Third OBS overlay to my Fly Machine with remote toggle and editable speaker/topic text.",
  },
  {
    label: "Be Right Back Slate",
    desc: "Minimal BRB screen with editable return note & remote control",
    prompt:
      "Deploy a minimal 1920x1080 Be Right Back OBS overlay to my Fly Machine with an editable return message and live remote control.",
  },
  {
    label: "Stream Goal Bar",
    desc: "Compact follower/sub goal progress bar with live +1 / edit controls",
    prompt:
      "Deploy a clean transparent 1920x1080 Stream Goal Bar OBS overlay to my Fly Machine with editable goal title, current/target counters, and live remote control.",
  },
];

function recalcPreviewScale() {
  const el = stageWrapRef.value;
  if (!el) return;
  const padX = 24;
  const padY = 24;
  const availW = Math.max(160, el.clientWidth - padX);
  const availH = Math.max(90, el.clientHeight - padY);
  const scale = Math.min(availW / 1920, availH / 1080, 1);
  previewScale.value = Math.max(0.1, Number(scale.toFixed(4)));
}

function attachStageObserver() {
  stageObserver?.disconnect();
  stageObserver = null;
  if (!stageWrapRef.value) return;
  recalcPreviewScale();
  stageObserver = new ResizeObserver(() => {
    recalcPreviewScale();
  });
  stageObserver.observe(stageWrapRef.value);
}

async function loadOverlays(preferSlug?: string, openDetail = false) {
  loading.value = true;
  try {
    const res = await fetch("/api/obs-overlays");
    if (!res.ok) return;
    const data = (await res.json()) as {
      status?: MachineStatus;
      overlays?: ObsOverlayItem[];
    };
    if (data.status) status.value = data.status;
    overlays.value = Array.isArray(data.overlays) ? data.overlays : [];

    const target = preferSlug || (viewMode.value === "detail" ? selectedSlug.value : "");
    if (target && overlays.value.some((o) => o.slug === target)) {
      selectedSlug.value = target;
      if (openDetail) viewMode.value = "detail";
    } else if (viewMode.value === "detail" && !overlays.value.some((o) => o.slug === selectedSlug.value)) {
      selectedSlug.value = "";
      viewMode.value = "list";
    }

    if (selectedOverlay.value) {
      emit("selectedChanged", {
        slug: selectedOverlay.value.slug,
        title: selectedOverlay.value.title,
      });
    }
  } finally {
    loading.value = false;
  }
}

function openOverlayDetail(ov: ObsOverlayItem) {
  selectedSlug.value = ov.slug;
  viewMode.value = "detail";
  frameKey.value += 1;
  emit("selectedChanged", { slug: ov.slug, title: ov.title });
  void nextTick(() => attachStageObserver());
}

function backToList() {
  viewMode.value = "list";
  stageObserver?.disconnect();
  stageObserver = null;
}

async function copyUrl(ov: ObsOverlayItem, kind: "obs" | "remote") {
  const text = kind === "obs" ? ov.overlayUrl : ov.controlUrl;
  const key = `${ov.slug}:${kind}`;
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    toast.success(kind === "obs" ? "Copied OBS Browser Source URL" : "Copied Mobile Remote URL");
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = "";
    }, 1600);
  } catch {
    toast.error("Failed to copy URL");
  }
}

async function confirmDeleteOverlay() {
  const ov = deleteTarget.value;
  if (!ov || deleting.value) return;
  deleting.value = true;
  try {
    const res = await fetch(`/api/obs-overlays/${encodeURIComponent(ov.slug)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete failed");
    const wasSelected = selectedSlug.value === ov.slug;
    deleteTarget.value = null;
    toast.success(`Deleted ${ov.title}`);
    if (wasSelected) {
      selectedSlug.value = "";
      viewMode.value = "list";
    }
    await loadOverlays();
  } catch {
    toast.error("Could not delete overlay");
  } finally {
    deleting.value = false;
  }
}

function requestNewOverlay(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  showCreateDialog.value = false;
  customOverlayPrompt.value = "";
  emit("askPrompt", trimmed);
}

function selectOverlay(slug: string) {
  selectedSlug.value = slug;
  viewMode.value = "detail";
  frameKey.value += 1;
  void loadOverlays(slug, true);
  void nextTick(() => attachStageObserver());
}

watch(
  () => props.refreshTick,
  () => {
    void loadOverlays();
    frameKey.value += 1;
  }
);

watch(
  () => props.initialSlug,
  (next) => {
    if (next) {
      void loadOverlays(next, true);
      void nextTick(() => attachStageObserver());
    }
  }
);

watch([viewMode, showRemote, selectedSlug], () => {
  if (viewMode.value === "detail") {
    void nextTick(() => attachStageObserver());
  }
});

onMounted(() => {
  if (props.initialSlug) {
    void loadOverlays(props.initialSlug, true);
    void nextTick(() => attachStageObserver());
  } else {
    void loadOverlays();
  }
});

onBeforeUnmount(() => {
  stageObserver?.disconnect();
});

defineExpose({
  selectOverlay,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#FAFAFA] text-[#171717]">
    <!-- ==================== PAGE 1: OVERLAYS LIST ==================== -->
    <template v-if="viewMode === 'list'">
      <!-- List Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDEDED] bg-white px-4 py-2.5">
        <div class="flex items-center gap-2.5">
          <span class="font-mono text-xs font-semibold text-[#171717]">
            Overlays ({{ overlays.length }})
          </span>
          <Badge
            v-if="status.provisioned"
            variant="secondary"
            class="h-6 px-2 font-mono text-[10.5px]"
          >
            {{ status.appName }} · {{ status.region || "sin" }}
          </Badge>
          <Badge
            v-else-if="status.connectorAvailable"
            variant="secondary"
            class="h-6 px-2 font-mono text-[10.5px]"
          >
            Fly Machines ready
          </Badge>
        </div>

        <div class="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="default"
            class="h-7 gap-1.5 rounded-lg px-2.5 font-mono text-[11px]"
            :disabled="!status.connectorAvailable"
            @click="showCreateDialog = true"
          >
            <PlusIcon class="size-3.5" />
            <span>New Overlay</span>
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Refresh overlays"
            @click="loadOverlays(); frameKey += 1"
          >
            <RefreshCwIcon class="size-3.5" :class="{ 'animate-spin': loading }" />
          </Button>
        </div>
      </div>

      <!-- List Body -->
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div
          v-if="loading && overlays.length === 0"
          class="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground"
        >
          <Spinner class="size-4" />
          <span>Checking Fly Machine overlays...</span>
        </div>

        <div
          v-else-if="!status.connectorAvailable && overlays.length === 0"
          class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-2xl border border-[#EDEDED] bg-white">
            <MonitorPlayIcon class="size-5 text-[#303030]" />
          </div>
          <p class="max-w-md rounded-xl border border-[#fecaca] bg-[#fde8e8] px-3 py-2 font-mono text-[11px] text-[#991b1b]">
            Connect the Fly Machines API connector (api.machines.dev) in Sprites Dashboard to deploy live OBS overlays.
          </p>
        </div>

        <div
          v-else-if="overlays.length === 0"
          class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center"
        >
          <div class="flex size-12 items-center justify-center rounded-2xl border border-[#EDEDED] bg-white shadow-xs">
            <MonitorPlayIcon class="size-5 text-[#303030]" />
          </div>
          <div class="space-y-1">
            <h3 class="font-mono text-sm font-semibold text-[#171717]">No OBS overlays deployed yet</h3>
            <p class="text-xs text-neutral-500">
              Overlays run on your dedicated auto-stop Fly Machine (1920×1080 transparent Browser Source + live SSE remote control).
            </p>
          </div>
          <div class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="s in starters"
              :key="s.label"
              type="button"
              class="flex flex-col items-start gap-1 rounded-xl border border-[#E5E5E5] bg-white p-3 text-left transition-colors hover:border-[#171717]"
              @click="requestNewOverlay(s.prompt)"
            >
              <span class="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#171717]">
                <SparklesIcon class="size-3" />
                {{ s.label }}
              </span>
              <span class="text-[11px] text-neutral-500">{{ s.desc }}</span>
            </button>
          </div>
        </div>

        <!-- Deployed Overlays Grid -->
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="ov in overlays"
            :key="ov.slug"
            class="group flex flex-col overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white transition-colors hover:border-[#171717]/40"
          >
            <!-- Clickable 16:9 Mini Preview -->
            <button
              type="button"
              class="obs-checker relative aspect-video w-full overflow-hidden border-b border-[#EDEDED] text-left"
              @click="openOverlayDetail(ov)"
            >
              <iframe
                :key="`thumb-${ov.slug}-${frameKey}`"
                :src="ov.overlayUrl"
                class="pointer-events-none border-0 bg-transparent"
                style="width: 1920px; height: 1080px; transform: scale(0.18); transform-origin: top left;"
                tabindex="-1"
                :title="ov.title"
              />
              <span class="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-0.5 font-mono text-[10px] text-white opacity-90 transition-opacity group-hover:opacity-100">
                Open 1920×1080 →
              </span>
            </button>

            <div class="flex flex-1 flex-col gap-2 p-3.5">
              <div class="min-w-0">
                <button
                  type="button"
                  class="block w-full truncate text-left font-mono text-xs font-semibold text-[#171717] hover:underline"
                  @click="openOverlayDetail(ov)"
                >
                  {{ ov.title }}
                </button>
                <p v-if="ov.description" class="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">
                  {{ ov.description }}
                </p>
                <p v-else class="mt-0.5 truncate font-mono text-[10.5px] text-neutral-400">
                  /o/{{ ov.slug }}
                </p>
              </div>

              <div class="mt-auto flex items-center gap-1.5 pt-2">
                <Button
                  size="xs"
                  variant="default"
                  class="h-7 rounded-lg px-2.5 font-mono text-[11px]"
                  @click="openOverlayDetail(ov)"
                >
                  Open
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  class="h-7 gap-1 rounded-lg px-2 font-mono text-[11px]"
                  @click="copyUrl(ov, 'obs')"
                >
                  <CheckIcon v-if="copiedKey === `${ov.slug}:obs`" class="size-3" />
                  <CopyIcon v-else class="size-3" />
                  OBS URL
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  class="ml-auto text-neutral-400 hover:text-destructive"
                  title="Delete overlay"
                  @click="deleteTarget = ov"
                >
                  <Trash2Icon class="size-3.5" />
                </Button>
              </div>
            </div>
          </article>

          <!-- Add New Overlay Card -->
          <button
            v-if="status.connectorAvailable"
            type="button"
            class="flex min-h-[210px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#D4D4D4] bg-white/60 p-6 text-center transition-colors hover:border-[#171717] hover:bg-white"
            @click="showCreateDialog = true"
          >
            <div class="flex size-10 items-center justify-center rounded-xl bg-[#F2F2F2] text-[#171717]">
              <PlusIcon class="size-5" />
            </div>
            <span class="font-mono text-xs font-semibold text-[#171717]">Create New Overlay</span>
            <span class="max-w-[200px] text-[11px] text-neutral-500">
              Starting Soon, Lower Third, BRB, Goal Bar, or custom design
            </span>
          </button>
        </div>
      </div>
    </template>

    <!-- ==================== PAGE 2: OVERLAY DETAIL (1920x1080 LEFT + CONTROLLER RIGHT) ==================== -->
    <template v-else-if="selectedOverlay">
      <!-- Detail Top Bar -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDEDED] bg-white px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            class="h-7 gap-1 rounded-lg px-2 font-mono text-[11px] text-neutral-700"
            @click="backToList"
          >
            <ArrowLeftIcon class="size-3.5" />
            <span>All Overlays</span>
          </Button>
          <div class="h-4 w-px bg-[#E5E5E5]" />
          <span class="truncate font-mono text-xs font-semibold text-[#171717]">
            {{ selectedOverlay.title }}
          </span>
          <Badge
            v-if="status.provisioned"
            variant="secondary"
            class="hidden h-5 px-1.5 font-mono text-[10px] md:inline-flex"
          >
            {{ status.appName }}
          </Badge>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <ToggleGroup v-model="stageBackdrop" type="single" variant="outline" size="sm" class="h-7">
            <ToggleGroupItem value="checker" class="h-7 px-2 font-mono text-[10px]">Alpha</ToggleGroupItem>
            <ToggleGroupItem value="dark" class="h-7 px-2 font-mono text-[10px]">Dark</ToggleGroupItem>
            <ToggleGroupItem value="chroma" class="h-7 px-2 font-mono text-[10px]">Chroma</ToggleGroupItem>
          </ToggleGroup>

          <Button
            size="xs"
            variant="default"
            class="h-7 gap-1 rounded-lg font-mono text-[11px]"
            @click="copyUrl(selectedOverlay, 'obs')"
          >
            <CheckIcon v-if="copiedKey === `${selectedOverlay.slug}:obs`" class="size-3" />
            <CopyIcon v-else class="size-3" />
            <span>OBS URL</span>
          </Button>
          <Button
            size="xs"
            variant="secondary"
            class="h-7 gap-1 rounded-lg font-mono text-[11px]"
            @click="copyUrl(selectedOverlay, 'remote')"
          >
            <CheckIcon v-if="copiedKey === `${selectedOverlay.slug}:remote`" class="size-3" />
            <CopyIcon v-else class="size-3" />
            <span>Remote</span>
          </Button>
          <Button
            size="xs"
            :variant="showRemote ? 'secondary' : 'ghost'"
            class="h-7 gap-1 rounded-lg font-mono text-[11px]"
            title="Toggle side controller panel"
            @click="showRemote = !showRemote"
          >
            <SlidersHorizontalIcon class="size-3" />
            <span class="hidden sm:inline">Controller</span>
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Open live OBS URL in new tab"
            as="a"
            :href="selectedOverlay.overlayUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLinkIcon class="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            class="text-destructive hover:text-destructive"
            title="Delete overlay"
            @click="deleteTarget = selectedOverlay"
          >
            <Trash2Icon class="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Reload overlay & controller"
            @click="frameKey += 1"
          >
            <RefreshCwIcon class="size-3.5" />
          </Button>
        </div>
      </div>

      <!-- Side-by-Side Workspace: Left = True 1920x1080 Scaled Preview, Right = Live Controller -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <!-- Left Stage: True 1920x1080 Scaled Canvas -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#F2F1EE]">
          <div
            ref="stageWrapRef"
            class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
          >
            <div
              class="relative shrink-0 overflow-hidden rounded-xl border border-black/12 shadow-sm"
              :class="{
                'obs-checker': stageBackdrop === 'checker',
                'bg-[#111111]': stageBackdrop === 'dark',
                'bg-[#00b140]': stageBackdrop === 'chroma',
              }"
              :style="scaledBoxStyle"
            >
              <iframe
                :key="`ov-${selectedOverlay.slug}-${frameKey}`"
                :src="selectedOverlay.overlayUrl"
                class="block border-0 bg-transparent"
                :style="scaledIframeStyle"
                allow="autoplay"
                :title="selectedOverlay.title"
              />
            </div>
          </div>

          <!-- Compact Canvas Footer -->
          <div class="flex shrink-0 items-center justify-between gap-2 border-t border-[#E5E5E5] bg-white px-3 py-1.5 font-mono text-[10.5px] text-neutral-500">
            <span class="truncate">{{ selectedOverlay.overlayUrl }}</span>
            <span class="shrink-0 tabular-nums">
              1920×1080 · {{ Math.round(previewScale * 100) }}%
            </span>
          </div>
        </div>

        <!-- Right Sidebar: Live SSE Remote Controller -->
        <aside
          v-if="showRemote"
          class="flex h-[280px] w-full shrink-0 flex-col border-t border-[#E5E5E5] bg-white md:h-auto md:w-[340px] md:border-l md:border-t-0 lg:w-[380px]"
        >
          <div class="flex shrink-0 items-center justify-between border-b border-[#EDEDED] px-3 py-2">
            <span class="font-mono text-[11px] font-semibold text-[#171717]">
              Live Controller
            </span>
            <a
              :href="selectedOverlay.controlUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-mono text-[10.5px] text-neutral-500 no-underline hover:text-[#171717]"
            >
              Pop out
              <ExternalLinkIcon class="size-3" />
            </a>
          </div>
          <iframe
            :key="`ctl-${selectedOverlay.slug}-${frameKey}`"
            :src="selectedOverlay.controlUrl"
            class="min-h-0 w-full flex-1 border-0 bg-[#FAFAFA]"
            :title="`${selectedOverlay.title} Remote Control`"
          />
        </aside>
      </div>
    </template>

    <!-- Create New Overlay Dialog -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle class="font-mono text-sm">Create New OBS Overlay</DialogTitle>
          <DialogDescription class="text-xs">
            Pick a starter template or describe any 1920×1080 overlay — Otto will build and deploy it live to your Fly Machine.
          </DialogDescription>
        </DialogHeader>

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="s in starters"
            :key="s.label"
            type="button"
            class="flex flex-col items-start gap-1 rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-3 text-left transition-colors hover:border-[#171717] hover:bg-white"
            @click="requestNewOverlay(s.prompt)"
          >
            <span class="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#171717]">
              <SparklesIcon class="size-3" />
              {{ s.label }}
            </span>
            <span class="text-[11px] text-neutral-500">{{ s.desc }}</span>
          </button>
        </div>

        <form
          class="mt-2 flex flex-col gap-2 border-t border-[#EDEDED] pt-3"
          @submit.prevent="requestNewOverlay(`Deploy a transparent 1920x1080 OBS overlay to my Fly Machine: ${customOverlayPrompt}`)"
        >
          <label class="font-mono text-[11px] font-medium text-neutral-600">
            Or describe a custom overlay for Otto
          </label>
          <div class="flex gap-2">
            <input
              v-model="customOverlayPrompt"
              type="text"
              placeholder="e.g. Minimal anime-style Now Playing music bar with song/artist remote"
              class="h-9 flex-1 rounded-lg border border-[#E5E5E5] bg-[#FAFAFA] px-3 text-xs focus:border-[#171717] focus:bg-white focus:outline-none"
            />
            <Button type="submit" size="sm" class="h-9 rounded-lg px-3 text-xs" :disabled="!customOverlayPrompt.trim()">
              Build
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirmation Dialog -->
    <AlertDialog :open="Boolean(deleteTarget)" @update:open="(o) => { if (!o) deleteTarget = null; }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ deleteTarget?.title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the overlay from your Fly Machine volume and disconnects any OBS Browser Source using its URL.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="confirmDeleteOverlay">
            {{ deleting ? "Deleting..." : "Delete" }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
.obs-checker {
  background-color: #f4f4f2;
  background-image:
    linear-gradient(45deg, #e5e5e1 25%, transparent 25%),
    linear-gradient(-45deg, #e5e5e1 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e5e1 75%),
    linear-gradient(-45deg, transparent 75%, #e5e5e1 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
</style>
