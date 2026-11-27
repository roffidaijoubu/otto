<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MonitorPlayIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
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
import { playSound } from "@/lib/sounds";

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

interface RefineMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
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
const showRefinePanel = ref(true);
const loading = ref(true);
const frameKey = ref(0);
const copiedKey = ref("");
const deleteTarget = ref<ObsOverlayItem | null>(null);
const deleting = ref(false);

interface UploadedAttachment {
  workspacePath: string;
  originalName: string;
  previewUrl: string;
}

const showCreateDialog = ref(false);
const customOverlayPrompt = ref("");
const creatingOverlay = ref(false);
const creatingOverlayLabel = ref("");
const createAttachments = ref<UploadedAttachment[]>([]);
const createFileInputRef = ref<HTMLInputElement | null>(null);

// Isolated per-overlay Refine with Otto chat state (never pollutes main Otto Chat)
const refineInput = ref("");
const refining = ref(false);
const refineAttachments = ref<UploadedAttachment[]>([]);
const refineFileInputRef = ref<HTMLInputElement | null>(null);
const uploadingImage = ref(false);
const refineThreads = ref<Record<string, RefineMessage[]>>({});
const refineScrollRef = ref<HTMLElement | null>(null);

// ResizeObserver for true 1920x1080 aspect-ratio scaling on Detail stage
const stageWrapRef = ref<HTMLElement | null>(null);
const previewScale = ref(0.32);
let stageObserver: ResizeObserver | null = null;

const selectedOverlay = computed(
  () => overlays.value.find((o) => o.slug === selectedSlug.value) || null
);

const activeRefineMessages = computed<RefineMessage[]>(() => {
  if (!selectedSlug.value) return [];
  return refineThreads.value[selectedSlug.value] ?? [];
});

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
    desc: "10-minute timer, stream title, brand logo & Start/Pause/Reset deck",
    prompt:
      "Deploy a 1920x1080 Starting Soon countdown OBS overlay to my Fly Machine with my logo from Otto Assets, match the visual style and color palette to my logo, and include remote Start/Pause/Reset plus editable stream title.",
  },
  {
    label: "Broadcast Lower Third",
    desc: "Clean animated name/topic plate styled to your logo with remote toggle",
    prompt:
      "Deploy a clean transparent 1920x1080 Lower Third OBS overlay to my Fly Machine featuring my logo from Otto Assets, match the visual style and color palette to my logo, with remote show/hide toggle and editable speaker/topic text.",
  },
  {
    label: "Be Right Back Slate",
    desc: "Minimal BRB screen with your logo, brand palette & editable return note",
    prompt:
      "Deploy a minimal 1920x1080 Be Right Back OBS overlay to my Fly Machine with my logo from Otto Assets, match the visual style and color palette to my logo, with an editable return message and live remote control.",
  },
  {
    label: "Stream Goal Bar",
    desc: "Compact follower/sub goal bar styled to your logo with live +1 controls",
    prompt:
      "Deploy a clean transparent 1920x1080 Stream Goal Bar OBS overlay to my Fly Machine featuring my logo from Otto Assets, match the visual style and color palette to my logo, with editable goal title, current/target counters, and live remote control.",
  },
];

const quickRefineChips = [
  "Include my logo & match its visual style",
  "Make typography bigger & sharper",
  "Move overlay to bottom-left safe zone",
  "Add subtle entrance animation",
];

function recalcPreviewScale() {
  const el = stageWrapRef.value;
  if (!el) return;
  const availW = Math.max(200, el.clientWidth - 20);
  const availH = Math.max(112, el.clientHeight - 20);
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

async function scrollRefineToBottom() {
  await nextTick();
  if (refineScrollRef.value) {
    refineScrollRef.value.scrollTop = refineScrollRef.value.scrollHeight;
  }
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

async function sendRefine(instructionOverride?: string) {
  const ov = selectedOverlay.value;
  const text = (instructionOverride ?? refineInput.value).trim();
  if (!ov || !text || refining.value) return;

  const slug = ov.slug;
  const attachedPaths = instructionOverride ? [] : refineAttachments.value.map((a) => a.workspacePath);
  const attachNote =
    attachedPaths.length > 0 ? ` [${attachedPaths.length} image${attachedPaths.length > 1 ? "s" : ""} attached]` : "";

  if (!refineThreads.value[slug]) refineThreads.value[slug] = [];
  const historySnapshot = refineThreads.value[slug].map((m) => ({
    role: m.role,
    text: m.text,
  }));

  refineThreads.value[slug].push({
    id: `u_${Date.now()}`,
    role: "user",
    text: text + attachNote,
  });
  if (!instructionOverride) {
    refineInput.value = "";
    refineAttachments.value.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    refineAttachments.value = [];
  }
  refining.value = true;
  playSound("chat_send");
  await scrollRefineToBottom();

  try {
    const res = await fetch(`/api/obs-overlays/${encodeURIComponent(slug)}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: text,
        title: ov.title,
        attachedImages: attachedPaths,
        history: historySnapshot,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      reply?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Refine failed (${res.status})`);
    }
    refineThreads.value[slug].push({
      id: `a_${Date.now()}`,
      role: "assistant",
      text: data.reply || "Overlay updated.",
    });
    frameKey.value += 1;
    await loadOverlays(slug, true);
    playSound("job_complete");
    toast.success(`Refined "${ov.title}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not refine overlay";
    refineThreads.value[slug].push({
      id: `e_${Date.now()}`,
      role: "assistant",
      text: `Error: ${msg}`,
    });
    playSound("error");
    toast.error(msg);
  } finally {
    refining.value = false;
    await scrollRefineToBottom();
  }
}

function handleRefineKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendRefine();
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
    playSound("delete");
    toast.success(`Deleted ${ov.title}`);
    if (wasSelected) {
      selectedSlug.value = "";
      viewMode.value = "list";
    }
    await loadOverlays();
  } catch {
    playSound("error");
    toast.error("Could not delete overlay");
  } finally {
    deleting.value = false;
  }
}

async function uploadOverlayImages(files: FileList | File[], target: "create" | "refine") {
  const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (list.length === 0) return;
  uploadingImage.value = true;
  try {
    for (const file of list) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/obs-overlays/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        workspacePath?: string;
        originalName?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.workspacePath) {
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const item: UploadedAttachment = {
        workspacePath: data.workspacePath,
        originalName: data.originalName || file.name,
        previewUrl: URL.createObjectURL(file),
      };
      if (target === "create") createAttachments.value.push(item);
      else refineAttachments.value.push(item);
    }
    playSound("complete");
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Could not upload image");
  } finally {
    uploadingImage.value = false;
  }
}

function removeAttachment(target: "create" | "refine", idx: number) {
  const list = target === "create" ? createAttachments.value : refineAttachments.value;
  const removed = list.splice(idx, 1)[0];
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
}

function handlePasteImage(e: ClipboardEvent, target: "create" | "refine") {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imgs: File[] = [];
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) imgs.push(f);
    }
  }
  if (imgs.length > 0) {
    e.preventDefault();
    void uploadOverlayImages(imgs, target);
  }
}

function notifyExternalJob(state: { running: boolean; label?: string; slug?: string }) {
  creatingOverlay.value = state.running;
  creatingOverlayLabel.value = state.running ? state.label || "Building OBS overlay..." : "";
  if (!state.running) {
    frameKey.value += 1;
    void loadOverlays(state.slug || undefined, Boolean(state.slug));
  }
}

async function requestNewOverlay(prompt: string, label?: string) {
  const trimmed = prompt.trim();
  if (!trimmed || creatingOverlay.value) return;
  showCreateDialog.value = false;
  customOverlayPrompt.value = "";
  const attachedPaths = createAttachments.value.map((a) => a.workspacePath);
  createAttachments.value.forEach((a) => URL.revokeObjectURL(a.previewUrl));
  createAttachments.value = [];
  creatingOverlay.value = true;
  creatingOverlayLabel.value = label || trimmed.slice(0, 72);
  toast.message("Building new OBS overlay in background — main Otto Chat stays free.");

  try {
    const res = await fetch("/api/obs-overlays/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: trimmed, attachedImages: attachedPaths }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      slug?: string;
      reply?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Failed to create overlay (${res.status})`);
    }
    frameKey.value += 1;
    await loadOverlays(data.slug || undefined, Boolean(data.slug));
    if (data.slug) {
      void nextTick(() => attachStageObserver());
    }
    playSound("job_complete");
    toast.success("OBS overlay deployed live to your Fly Machine!");
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Could not create overlay");
  } finally {
    creatingOverlay.value = false;
    creatingOverlayLabel.value = "";
  }
}

function handleCreateKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void requestNewOverlay(customOverlayPrompt.value);
  }
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

watch([viewMode, showRefinePanel, selectedSlug], () => {
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
  notifyExternalJob,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#FAFAFA] text-[#171717]">
    <!-- ==================== PAGE 1: OVERLAYS LIST ==================== -->
    <template v-if="viewMode === 'list'">
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

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div
          v-if="loading && overlays.length === 0 && !creatingOverlay"
          class="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground"
        >
          <Spinner class="size-4" />
          <span>Checking Fly Machine overlays...</span>
        </div>

        <div
          v-else-if="!status.connectorAvailable && overlays.length === 0 && !creatingOverlay"
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
          v-else-if="overlays.length === 0 && !creatingOverlay"
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

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <!-- IN-PROGRESS OVERLAY CARD (uniform with Thumbnail Studio) -->
          <div
            v-if="creatingOverlay"
            class="flex flex-col overflow-hidden rounded-2xl border border-amber-300/80 bg-white shadow-xs"
          >
            <div class="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden bg-neutral-100">
              <div class="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-200/70 via-neutral-100 to-amber-100/50" />
              <Loader2Icon class="relative z-10 size-6 animate-spin text-amber-700" />
              <span class="relative z-10 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 font-mono text-[10px] font-medium text-amber-800">
                In progress · 1920×1080
              </span>
            </div>
            <div class="flex flex-col gap-1 p-3.5">
              <div class="flex items-center justify-between gap-2">
                <div class="truncate font-mono text-xs font-semibold text-[#171717]">
                  {{ creatingOverlayLabel || "Building OBS overlay..." }}
                </div>
                <span class="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[9.5px] text-amber-800">
                  In progress
                </span>
              </div>
              <div class="text-[11px] text-neutral-500">
                Isolated worker deploying to Fly Machine...
              </div>
            </div>
          </div>

          <article
            v-for="ov in overlays"
            :key="ov.slug"
            class="group flex flex-col overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white transition-colors hover:border-[#171717]/40"
          >
            <button
              type="button"
              class="obs-checker relative aspect-video w-full overflow-hidden border-b border-[#EDEDED] text-left"
              @click="openOverlayDetail(ov)"
            >
              <iframe
                :key="`thumb-${ov.slug}-${frameKey}`"
                :src="ov.overlayUrl"
                class="pointer-events-none absolute left-0 top-0 border-0 bg-transparent"
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

    <!-- ==================== PAGE 2: OVERLAY DETAIL ==================== -->
    <!-- Left = Box 1 (1920x1080 Canvas) + Box 2 (Live Controller always visible) | Right = Isolated Refine with Otto -->
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
            <span>Remote URL</span>
          </Button>
          <Button
            size="xs"
            :variant="showRefinePanel ? 'secondary' : 'ghost'"
            class="h-7 gap-1 rounded-lg font-mono text-[11px]"
            title="Toggle Refine with Otto sidebar"
            @click="showRefinePanel = !showRefinePanel"
          >
            <SparklesIcon class="size-3" />
            <span class="hidden sm:inline">Refine</span>
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

      <!-- Main Split: Left Studio (Overlay Box + Live Controller Box Always Visible) | Right (Refine with Otto) -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <!-- Left Workspace: 2 Framed Boxes Side-by-Side (Wide 1920x1080 Canvas + Narrow OBS-Dock Live Controller) -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#F2F1EE] p-3 lg:flex-row">
          <!-- BOX 1: True 1920x1080 Scaled Overlay Preview Box -->
          <div class="flex min-h-[240px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white">
            <div class="flex shrink-0 items-center justify-between border-b border-[#EDEDED] px-3 py-1.5">
              <span class="font-mono text-[11px] font-semibold text-[#171717]">
                OBS Canvas Preview
              </span>
              <span class="font-mono text-[10.5px] text-neutral-500 tabular-nums">
                1920×1080 · {{ Math.round(previewScale * 100) }}%
              </span>
            </div>

            <div
              ref="stageWrapRef"
              class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#ECEBE7] p-2.5"
            >
              <div
                class="relative shrink-0 overflow-hidden rounded-lg border border-black/12 shadow-xs"
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

              <!-- Subtle Refining Overlay Indicator -->
              <div
                v-if="refining"
                class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-black/15 bg-white/95 px-3 py-1.5 font-mono text-[11px] font-medium text-[#171717] shadow-sm"
              >
                <Loader2Icon class="size-3.5 animate-spin" />
                <span>Otto is refining this overlay...</span>
              </div>
            </div>
          </div>

          <!-- BOX 2: Narrow OBS-Dock Live Controller Box -->
          <div class="flex min-h-[220px] w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white lg:h-full lg:w-[320px] xl:w-[340px]">
            <div class="flex shrink-0 items-center justify-between border-b border-[#EDEDED] px-3 py-1.5">
              <span class="font-mono text-[11px] font-semibold text-[#171717]">
                Live Controller · OBS Dock
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
          </div>
        </div>

        <!-- Right Sidebar: Isolated "Refine with Otto" Chat (Never Pollutes Main Otto Chat) -->
        <aside
          v-if="showRefinePanel"
          class="flex h-[280px] w-full shrink-0 flex-col border-t border-[#E5E5E5] bg-white md:h-auto md:w-[330px] md:border-l md:border-t-0 lg:w-[370px]"
        >
          <div class="flex shrink-0 items-center justify-between border-b border-[#EDEDED] px-3.5 py-2.5">
            <div class="flex items-center gap-1.5">
              <SparklesIcon class="size-3.5 text-[#171717]" />
              <span class="font-mono text-xs font-semibold text-[#171717]">
                Refine with Otto
              </span>
            </div>
            <span class="rounded-full bg-[#F2F2F2] px-2 py-0.5 font-mono text-[10px] text-neutral-500">
              isolated
            </span>
          </div>

          <!-- Per-Overlay Revision Messages -->
          <div ref="refineScrollRef" class="min-h-0 flex-1 overflow-y-auto p-3.5">
            <div
              v-if="activeRefineMessages.length === 0"
              class="flex flex-col gap-3"
            >
              <p class="text-xs leading-relaxed text-neutral-500">
                Tell Otto how to tweak <strong class="font-mono text-[#171717]">{{ selectedOverlay.title }}</strong> — layout, colors, animations, or controller buttons. Runs in place without cluttering main Otto Chat.
              </p>

              <div class="flex flex-col gap-1.5">
                <span class="font-mono text-[10px] uppercase text-neutral-400">Quick tweaks</span>
                <button
                  v-for="chip in quickRefineChips"
                  :key="chip"
                  type="button"
                  class="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:border-[#171717] hover:bg-white"
                  :disabled="refining"
                  @click="sendRefine(chip)"
                >
                  {{ chip }}
                </button>
              </div>
            </div>

            <div v-else class="flex flex-col gap-2.5">
              <div
                v-for="msg in activeRefineMessages"
                :key="msg.id"
                class="flex flex-col"
                :class="msg.role === 'user' ? 'items-end' : 'items-start'"
              >
                <div
                  class="max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                  :class="
                    msg.role === 'user'
                      ? 'bg-[#171717] text-white'
                      : 'border border-[#EDEDED] bg-[#FAFAFA] text-[#171717]'
                  "
                >
                  {{ msg.text }}
                </div>
              </div>

              <div
                v-if="refining"
                class="flex items-center gap-2 rounded-2xl border border-[#EDEDED] bg-[#FAFAFA] px-3 py-2 font-mono text-[11px] text-neutral-500"
              >
                <Loader2Icon class="size-3.5 animate-spin" />
                <span>Updating overlay on Fly Machine...</span>
              </div>
            </div>
          </div>

          <!-- Refine Input Composer -->
          <form
            class="shrink-0 border-t border-[#EDEDED] bg-[#FAFAFA] p-2.5"
            @submit.prevent="sendRefine()"
          >
            <div v-if="refineAttachments.length > 0" class="mb-2 flex flex-wrap gap-1.5">
              <div
                v-for="(att, idx) in refineAttachments"
                :key="att.workspacePath"
                class="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white py-1 pl-1 pr-1.5"
              >
                <img :src="att.previewUrl" :alt="att.originalName" class="size-6 rounded object-cover" />
                <span class="max-w-[110px] truncate font-mono text-[10px] text-[#262626]">
                  {{ att.originalName }}
                </span>
                <button
                  type="button"
                  class="rounded p-0.5 text-neutral-500 hover:bg-black/10 hover:text-black"
                  @click="removeAttachment('refine', idx)"
                >
                  <XIcon class="size-3" />
                </button>
              </div>
            </div>
            <input
              ref="refineFileInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              multiple
              class="hidden"
              @change="(e) => { const f = (e.target as HTMLInputElement).files; if (f) uploadOverlayImages(f, 'refine'); (e.target as HTMLInputElement).value = ''; }"
            />
            <div class="flex items-end gap-1.5 rounded-xl border border-[#E2E2E2] bg-white p-1.5 focus-within:border-[#171717]">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                class="size-8 shrink-0 text-neutral-600 hover:text-black"
                title="Upload image (or paste with Ctrl+V)"
                :disabled="refining || uploadingImage"
                @click="refineFileInputRef?.click()"
              >
                <Loader2Icon v-if="uploadingImage" class="size-3.5 animate-spin" />
                <PaperclipIcon v-else class="size-3.5" />
              </Button>
              <textarea
                v-model="refineInput"
                rows="2"
                placeholder="Describe a change or paste/attach an image (Enter to refine)..."
                class="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 text-xs text-[#171717] placeholder:text-neutral-400 focus:outline-none"
                :disabled="refining"
                @paste="(e) => handlePasteImage(e, 'refine')"
                @keydown="handleRefineKeydown"
              />
              <Button
                type="submit"
                size="icon-xs"
                class="size-8 shrink-0 rounded-lg bg-[#171717] text-white hover:bg-neutral-800"
                :disabled="refining || !refineInput.trim()"
                title="Send refinement to Otto"
              >
                <Loader2Icon v-if="refining" class="size-3.5 animate-spin" />
                <SendIcon v-else class="size-3.5" />
              </Button>
            </div>
          </form>
        </aside>
      </div>
    </template>

    <!-- Create New Overlay Dialog (Prompt-First Hero Composer + Starter Templates Below) -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="sm:max-w-3xl p-6">
        <DialogHeader>
          <div class="flex items-center justify-between gap-3 pr-7">
            <DialogTitle class="font-mono text-base font-semibold">Create New OBS Overlay</DialogTitle>
            <span class="shrink-0 whitespace-nowrap rounded-full bg-[#F2F2F2] px-2.5 py-0.5 font-mono text-[10.5px] text-neutral-600">
              Isolated worker · 1920×1080
            </span>
          </div>
          <DialogDescription class="text-xs leading-relaxed">
            Describe any transparent 1920×1080 OBS Browser Source and remote controller you want. Otto builds and deploys it directly to your Fly Machine without cluttering main Otto Chat.
          </DialogDescription>
        </DialogHeader>

        <!-- Hero Chat / Prompt Composer FIRST -->
        <form
          class="mt-1 flex flex-col gap-2.5"
          @submit.prevent="requestNewOverlay(customOverlayPrompt)"
        >
          <div class="flex flex-col overflow-hidden rounded-2xl border border-[#D4D4D4] bg-[#FAFAFA] transition-colors focus-within:border-[#171717] focus-within:bg-white">
            <div v-if="createAttachments.length > 0" class="flex flex-wrap gap-1.5 px-3 pt-3">
              <div
                v-for="(att, idx) in createAttachments"
                :key="att.workspacePath"
                class="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white py-1 pl-1 pr-1.5"
              >
                <img :src="att.previewUrl" :alt="att.originalName" class="size-7 rounded object-cover" />
                <span class="max-w-[140px] truncate font-mono text-[10px] text-[#262626]">
                  {{ att.originalName }}
                </span>
                <button
                  type="button"
                  class="rounded p-0.5 text-neutral-500 hover:bg-black/10 hover:text-black"
                  @click="removeAttachment('create', idx)"
                >
                  <XIcon class="size-3" />
                </button>
              </div>
            </div>
            <input
              ref="createFileInputRef"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              multiple
              class="hidden"
              @change="(e) => { const f = (e.target as HTMLInputElement).files; if (f) uploadOverlayImages(f, 'create'); (e.target as HTMLInputElement).value = ''; }"
            />
            <textarea
              v-model="customOverlayPrompt"
              rows="5"
              placeholder="Describe your overlay... e.g. 'Starting Soon screen with my logo from Otto Assets, matching visual style, 10-minute countdown, and Start/Pause/Reset controls' (or paste/upload an image)"
              class="min-h-[128px] w-full resize-none bg-transparent p-4 text-sm leading-relaxed text-[#171717] placeholder:text-neutral-400 focus:outline-none"
              @paste="(e) => handlePasteImage(e, 'create')"
              @keydown="handleCreateKeydown"
            />
            <div class="flex items-center justify-between gap-2 border-t border-[#EDEDED] bg-white/80 px-3 py-2">
              <div class="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 bg-white px-2 text-[11px]"
                  :disabled="uploadingImage"
                  @click="createFileInputRef?.click()"
                >
                  <Loader2Icon v-if="uploadingImage" class="size-3 animate-spin" />
                  <PaperclipIcon v-else class="size-3" />
                  Upload Image
                </Button>
                <span class="font-mono text-[10.5px] text-neutral-400">
                  Enter to build · Ctrl+V to paste image
                </span>
              </div>
              <Button
                type="submit"
                size="sm"
                class="h-8 gap-1.5 rounded-xl bg-[#171717] px-4 font-mono text-xs text-white hover:bg-neutral-800"
                :disabled="!customOverlayPrompt.trim() || creatingOverlay"
              >
                <SparklesIcon class="size-3.5" />
                <span>Build &amp; Deploy</span>
              </Button>
            </div>
          </div>
        </form>

        <!-- Compact Quick-Start Templates BELOW -->
        <div class="mt-2 flex flex-col gap-2 border-t border-[#EDEDED] pt-3.5">
          <span class="font-mono text-[10.5px] font-medium uppercase tracking-wide text-neutral-400">
            Or start from a template
          </span>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="s in starters"
              :key="s.label"
              type="button"
              class="flex flex-col items-start gap-0.5 rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2.5 text-left transition-colors hover:border-[#171717] hover:bg-white"
              :disabled="creatingOverlay"
              @click="requestNewOverlay(s.prompt, s.label)"
            >
              <span class="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#171717]">
                <SparklesIcon class="size-3 shrink-0" />
                {{ s.label }}
              </span>
              <span class="text-[11px] text-neutral-500">{{ s.desc }}</span>
            </button>
          </div>
        </div>
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
