<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowLeftIcon,
  DownloadIcon,
  EyeIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UploadCloudIcon,
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
import { playSound } from "@/lib/sounds";

interface ThumbnailItem {
  slug: string;
  title: string;
  description: string;
  width: number;
  height: number;
  assets: string[];
  previewUrl: string;
  exportedFile: string | null;
  exportedUrl: string | null;
  exportedSize: number | null;
  createdAt: string;
  updatedAt: string;
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
  selectedChanged: [payload: { slug: string; title: string }];
}>();

const thumbnails = ref<ThumbnailItem[]>([]);
const viewMode = ref<"list" | "detail">("list");
const selectedSlug = ref("");
const showSafeZone = ref(true);
const showRefinePanel = ref(true);
const loading = ref(true);
const frameKey = ref(0);
const deleteTarget = ref<ThumbnailItem | null>(null);
const deleting = ref(false);
const exporting = ref(false);
const handingOffBox = ref(false);

interface UploadedAttachment {
  workspacePath: string;
  originalName: string;
  previewUrl: string;
}

const showCreateDialog = ref(false);
const customPrompt = ref("");
const creating = ref(false);
const creatingLabel = ref("");
const createAttachments = ref<UploadedAttachment[]>([]);
const createFileInputRef = ref<HTMLInputElement | null>(null);

// Isolated per-thumbnail Refine with Otto chat state
const refineInput = ref("");
const refining = ref(false);
const refineAttachments = ref<UploadedAttachment[]>([]);
const refineFileInputRef = ref<HTMLInputElement | null>(null);
const uploadingImage = ref(false);
const refineThreads = ref<Record<string, RefineMessage[]>>({});
const refineScrollRef = ref<HTMLElement | null>(null);

// ResizeObserver for true 1280x720 aspect-ratio scaling on Detail stage
const stageWrapRef = ref<HTMLElement | null>(null);
const previewFrameRef = ref<HTMLIFrameElement | null>(null);
const previewScale = ref(0.45);
let stageObserver: ResizeObserver | null = null;

const selectedThumbnail = computed(
  () => thumbnails.value.find((t) => t.slug === selectedSlug.value) || null
);

const activeRefineMessages = computed<RefineMessage[]>(() => {
  if (!selectedSlug.value) return [];
  return refineThreads.value[selectedSlug.value] ?? [];
});

const scaledBoxStyle = computed(() => ({
  width: `${Math.round(1280 * previewScale.value)}px`,
  height: `${Math.round(720 * previewScale.value)}px`,
}));

const scaledIframeStyle = computed(() => ({
  width: "1280px",
  height: "720px",
  transform: `scale(${previewScale.value})`,
  transformOrigin: "top left",
}));

const starters = [
  {
    label: "Dramatic Reaction Split",
    desc: "Expressive character cutout + 3-word shock hook + moody Pixabay backdrop",
    prompt:
      "Create a high-CTR 1280x720 YouTube thumbnail using an expressive character cutout from Otto Assets/Characters, a moody dark Pixabay photo background, and bold 3-word yellow/white hook text on the left side.",
  },
  {
    label: "Deep Dive / Commentary",
    desc: "Serious pose + editorial dark gradient + crisp highlight headline + logo badge",
    prompt:
      "Create a sharp 1280x720 commentary thumbnail with my serious character pose and emblem logo from Otto Assets, a clean Pixabay atmospheric background, and bold editorial headline typography.",
  },
  {
    label: "Chill Talk / Zatsudan",
    desc: "Warm smiling cutout + cozy blurred background + inviting title card",
    prompt:
      "Create a warm, inviting 1280x720 livestream thumbnail using a smiling character cutout from Otto Assets/Characters, a cozy blurred warm-lit Pixabay room background, and clean readable typography.",
  },
  {
    label: "Hot Take / Versus",
    desc: "Smug/wink expression + high-contrast color split + punchy question hook",
    prompt:
      "Create a punchy 1280x720 hot-take thumbnail with my wink/smug character pose from Otto Assets/Characters, dramatic contrast lighting over a real Pixabay photo background, and a huge 2-3 word hook.",
  },
];

const quickRefineChips = [
  "Make headline bigger & higher contrast",
  "Swap character pose from Otto Assets",
  "Use a darker, moodier Pixabay background",
  "Add subtle brand logo in top-left corner",
];

function recalcPreviewScale() {
  const el = stageWrapRef.value;
  if (!el) return;
  const availW = Math.max(200, el.clientWidth - 20);
  const availH = Math.max(112, el.clientHeight - 20);
  const scale = Math.min(availW / 1280, availH / 720, 1);
  previewScale.value = Math.max(0.12, Number(scale.toFixed(4)));
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

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchThumbnails(preferredSlug?: string) {
  loading.value = true;
  try {
    const res = await fetch("/api/thumbnails");
    const data = (await res.json()) as { thumbnails?: ThumbnailItem[] };
    thumbnails.value = Array.isArray(data.thumbnails) ? data.thumbnails : [];

    const want = preferredSlug || selectedSlug.value;
    if (want && thumbnails.value.some((t) => t.slug === want)) {
      selectedSlug.value = want;
    } else if (viewMode.value === "detail" && !thumbnails.value.some((t) => t.slug === selectedSlug.value)) {
      selectedSlug.value = "";
      viewMode.value = "list";
    }
    frameKey.value += 1;
  } catch {
    toast.error("Could not load thumbnails");
  } finally {
    loading.value = false;
  }
}

function openDetail(slug: string) {
  selectedSlug.value = slug;
  viewMode.value = "detail";
  frameKey.value += 1;
  const item = thumbnails.value.find((t) => t.slug === slug);
  if (item) {
    emit("selectedChanged", { slug: item.slug, title: item.title });
  }
  nextTick(() => {
    attachStageObserver();
  });
}

function backToList() {
  viewMode.value = "list";
  emit("selectedChanged", { slug: "", title: "" });
}

function selectThumbnail(slug: string) {
  if (!slug) return;
  if (thumbnails.value.some((t) => t.slug === slug)) {
    openDetail(slug);
  } else {
    void fetchThumbnails(slug).then(() => {
      if (thumbnails.value.some((t) => t.slug === slug)) {
        openDetail(slug);
      }
    });
  }
}

async function uploadImageFiles(files: FileList | File[], target: "create" | "refine") {
  const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (list.length === 0) return;
  uploadingImage.value = true;
  try {
    for (const file of list) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/thumbnails/upload", { method: "POST", body: form });
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
      if (target === "create") {
        createAttachments.value.push(item);
      } else {
        refineAttachments.value.push(item);
      }
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
    void uploadImageFiles(imgs, target);
  }
}

async function submitCreate(promptText: string, label?: string) {
  const prompt = promptText.trim();
  if (!prompt || creating.value) return;
  playSound("send");
  creating.value = true;
  creatingLabel.value = label || "Composing 1280×720 thumbnail with Otto Assets & Pixabay...";
  showCreateDialog.value = false;
  const attachedPaths = createAttachments.value.map((a) => a.workspacePath);

  try {
    const res = await fetch("/api/thumbnails/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, attachedImages: attachedPaths }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      slug?: string;
      reply?: string;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Creation failed (${res.status})`);
    }
    customPrompt.value = "";
    createAttachments.value.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    createAttachments.value = [];
    playSound("complete");
    toast.success(data.reply || "Thumbnail ready!");
    await fetchThumbnails(data.slug || undefined);
    if (data.slug && thumbnails.value.some((t) => t.slug === data.slug)) {
      openDetail(data.slug);
    }
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Could not create thumbnail");
  } finally {
    creating.value = false;
    creatingLabel.value = "";
  }
}

async function sendRefine(instructionOverride?: string) {
  const thumb = selectedThumbnail.value;
  const text = (instructionOverride ?? refineInput.value).trim();
  if (!thumb || !text || refining.value) return;
  playSound("send");

  const slug = thumb.slug;
  const attachedPaths = instructionOverride ? [] : refineAttachments.value.map((a) => a.workspacePath);
  const attachNote =
    attachedPaths.length > 0 ? ` [${attachedPaths.length} image${attachedPaths.length > 1 ? "s" : ""} attached]` : "";

  if (!refineThreads.value[slug]) refineThreads.value[slug] = [];
  const history = refineThreads.value[slug].map((m) => ({ role: m.role, text: m.text }));
  refineThreads.value[slug].push({ id: `${Date.now()}-u`, role: "user", text: text + attachNote });
  if (!instructionOverride) {
    refineInput.value = "";
    refineAttachments.value.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    refineAttachments.value = [];
  }
  refining.value = true;
  await nextTick();
  refineScrollRef.value?.scrollTo({ top: refineScrollRef.value.scrollHeight, behavior: "smooth" });

  try {
    const res = await fetch(`/api/thumbnails/${encodeURIComponent(slug)}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: text,
        title: thumb.title,
        attachedImages: attachedPaths,
        history,
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
      id: `${Date.now()}-a`,
      role: "assistant",
      text: data.reply || "Updated thumbnail.",
    });
    playSound("complete");
    await fetchThumbnails(slug);
    frameKey.value += 1;
  } catch (err) {
    playSound("error");
    const msg = err instanceof Error ? err.message : "Refinement failed";
    refineThreads.value[slug].push({
      id: `${Date.now()}-e`,
      role: "assistant",
      text: `Error: ${msg}`,
    });
    toast.error(msg);
  } finally {
    refining.value = false;
    await nextTick();
    refineScrollRef.value?.scrollTo({ top: refineScrollRef.value.scrollHeight, behavior: "smooth" });
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read asset blob"));
    reader.readAsDataURL(blob);
  });
}

async function exportThumbnail(format: "jpg" | "png") {
  const thumb = selectedThumbnail.value;
  const iframe = previewFrameRef.value;
  if (!thumb || !iframe?.contentDocument || exporting.value) return;

  exporting.value = true;
  try {
    const doc = iframe.contentDocument;
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;

    // Inline same-origin <img> sources so SVG foreignObject renders cleanly without CORS taint
    const imgs = Array.from(clone.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute("src") || "";
        if (!src || src.startsWith("data:")) return;
        try {
          const resp = await fetch(src);
          if (!resp.ok) return;
          const dataUrl = await blobToDataUrl(await resp.blob());
          img.setAttribute("src", dataUrl);
        } catch {
          // keep original if unreachable
        }
      })
    );

    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.width = 1280;
    image.height = 720;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not rasterize thumbnail canvas"));
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.drawImage(image, 0, 0, 1280, 720);
    URL.revokeObjectURL(svgUrl);

    const mime = format === "png" ? "image/png" : "image/jpeg";
    const dataUrl = format === "png" ? canvas.toDataURL(mime) : canvas.toDataURL(mime, 0.92);

    const res = await fetch(`/api/thumbnails/${encodeURIComponent(thumb.slug)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, format }),
    });
    const out = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      workspacePath?: string;
      size?: number;
      error?: string;
    };
    if (!res.ok || !out.ok) {
      throw new Error(out.error || `Export failed (${res.status})`);
    }

    // Trigger immediate local browser download too
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${thumb.slug}.${format}`;
    a.click();

    playSound("complete");
    toast.success(`Exported ${thumb.slug}.${format} (${formatBytes(out.size || 0)}) to Studio Files`);
    await fetchThumbnails(thumb.slug);
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Could not export thumbnail");
  } finally {
    exporting.value = false;
  }
}

async function handoffToBox() {
  const thumb = selectedThumbnail.value;
  if (!thumb || handingOffBox.value) return;
  if (!thumb.exportedFile) {
    toast.info("Export to JPG or PNG first before uploading to Box Handoffs.");
    return;
  }
  handingOffBox.value = true;
  try {
    const res = await fetch(`/api/thumbnails/${encodeURIComponent(thumb.slug)}/box-handoff`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Box upload failed (${res.status})`);
    }
    playSound("complete");
    toast.success("Uploaded exported thumbnail to Box Otto Handoffs!");
    if (data.url) window.open(data.url, "_blank", "noopener");
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Box handoff failed");
  } finally {
    handingOffBox.value = false;
  }
}

async function confirmDelete() {
  const item = deleteTarget.value;
  if (!item || deleting.value) return;
  deleting.value = true;
  try {
    const res = await fetch(`/api/thumbnails/${encodeURIComponent(item.slug)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    toast.success(`Deleted "${item.title}"`);
    deleteTarget.value = null;
    if (selectedSlug.value === item.slug) {
      selectedSlug.value = "";
      viewMode.value = "list";
    }
    await fetchThumbnails();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not delete thumbnail");
  } finally {
    deleting.value = false;
  }
}

watch(
  () => props.refreshTick,
  () => {
    void fetchThumbnails();
  }
);

watch(
  () => props.initialSlug,
  (slug) => {
    if (slug) selectThumbnail(slug);
  }
);

onMounted(() => {
  void fetchThumbnails(props.initialSlug).then(() => {
    if (props.initialSlug && thumbnails.value.some((t) => t.slug === props.initialSlug)) {
      openDetail(props.initialSlug);
    }
  });
});

onBeforeUnmount(() => {
  stageObserver?.disconnect();
});

function notifyExternalJob(state: { running: boolean; label?: string; slug?: string }) {
  creating.value = state.running;
  creatingLabel.value = state.running ? state.label || "Composing thumbnail..." : "";
  if (!state.running) {
    frameKey.value += 1;
    void fetchThumbnails(state.slug || undefined).then(() => {
      if (state.slug && thumbnails.value.some((t) => t.slug === state.slug)) {
        openDetail(state.slug);
      }
    });
  }
}

defineExpose({ selectThumbnail, notifyExternalJob, refresh: fetchThumbnails });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#F5F5F4] text-[#171717]">
    <!-- TOP BAR -->
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-black/8 bg-white px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2.5">
        <Button
          v-if="viewMode === 'detail'"
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          @click="backToList"
        >
          <ArrowLeftIcon class="size-3.5" />
          All Thumbnails
        </Button>
        <div class="flex min-w-0 items-center gap-2">
          <ImageIcon class="size-4 shrink-0 text-[#525252]" />
          <span class="truncate text-sm font-semibold">
            {{ viewMode === "detail" && selectedThumbnail ? selectedThumbnail.title : "Thumbnail Studio" }}
          </span>
          <Badge variant="outline" class="hidden text-[10px] font-mono sm:inline-flex">
            1280×720 · Zero-AI
          </Badge>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <template v-if="viewMode === 'detail' && selectedThumbnail">
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :class="showSafeZone ? 'border-amber-500/50 bg-amber-50 text-amber-800' : ''"
            @click="showSafeZone = !showSafeZone"
          >
            <EyeIcon class="size-3.5" />
            Safe Zone
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :disabled="exporting"
            @click="exportThumbnail('jpg')"
          >
            <DownloadIcon class="size-3.5" />
            Export JPG
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :disabled="exporting"
            @click="exportThumbnail('png')"
          >
            <DownloadIcon class="size-3.5" />
            PNG
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            :disabled="handingOffBox || !selectedThumbnail.exportedFile"
            @click="handoffToBox"
          >
            <UploadCloudIcon class="size-3.5" />
            Box
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="showRefinePanel = !showRefinePanel"
          >
            {{ showRefinePanel ? "Hide Refine" : "Refine" }}
          </Button>
        </template>
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          title="Refresh"
          @click="fetchThumbnails()"
        >
          <RefreshCwIcon class="size-3.5" :class="loading ? 'animate-spin' : ''" />
        </Button>
        <Button
          size="sm"
          class="h-7 gap-1 bg-[#171717] px-2.5 text-xs text-white hover:bg-[#303030]"
          :disabled="creating"
          @click="showCreateDialog = true"
        >
          <PlusIcon class="size-3.5" />
          New Thumbnail
        </Button>
      </div>
    </div>

    <!-- GALLERY VIEW -->
    <div v-if="viewMode === 'list'" class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="loading && thumbnails.length === 0 && !creating" class="flex h-full items-center justify-center">
        <Spinner class="size-5" />
      </div>

      <div
        v-else-if="thumbnails.length === 0 && !creating"
        class="mx-auto flex max-w-lg flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-white p-8 text-center"
      >
        <div class="mb-3 flex size-11 items-center justify-center rounded-xl bg-black/5">
          <ImageIcon class="size-5 text-[#525252]" />
        </div>
        <h3 class="text-sm font-semibold">No thumbnails yet</h3>
        <p class="mt-1 text-xs text-[#737373]">
          Compose crisp 1280×720 non-AI thumbnails using your character PNGs &amp; logos from Box
          <span class="font-mono">Otto Assets</span> plus royalty-free Pixabay photography.
        </p>
        <Button
          size="sm"
          class="mt-4 gap-1.5 bg-[#171717] text-white hover:bg-[#303030]"
          @click="showCreateDialog = true"
        >
          <SparklesIcon class="size-3.5" />
          Create First Thumbnail
        </Button>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <!-- IN-PROGRESS GENERATION CARD -->
        <div
          v-if="creating"
          class="flex flex-col overflow-hidden rounded-xl border border-amber-300/80 bg-white shadow-xs"
        >
          <div class="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden bg-neutral-100">
            <div class="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-200/70 via-neutral-100 to-amber-100/50" />
            <Loader2Icon class="relative z-10 size-6 animate-spin text-amber-700" />
            <span class="relative z-10 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 font-mono text-[10px] font-medium text-amber-800">
              In progress · 1280×720
            </span>
          </div>
          <div class="flex flex-col gap-1 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate text-xs font-semibold text-[#171717]">
                {{ creatingLabel || "Composing thumbnail..." }}
              </div>
              <Badge variant="outline" class="shrink-0 border-amber-300 bg-amber-50 font-mono text-[9.5px] text-amber-800">
                In progress
              </Badge>
            </div>
            <div class="text-[11px] text-[#737373]">
              Isolated worker pulling Box Otto Assets &amp; Pixabay photo...
            </div>
          </div>
        </div>

        <div
          v-for="item in thumbnails"
          :key="item.slug"
          class="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-xs transition hover:border-black/25 hover:shadow-sm"
          @click="openDetail(item.slug)"
        >
          <div class="relative aspect-video w-full overflow-hidden bg-neutral-900">
            <iframe
              :src="`${item.previewUrl}?k=${frameKey}`"
              class="pointer-events-none absolute left-0 top-0 h-[720px] w-[1280px] origin-top-left border-0"
              style="transform: scale(0.26)"
              sandbox="allow-same-origin"
            />
            <span
              class="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white"
            >
              1280×720
            </span>
          </div>
          <div class="flex items-start justify-between gap-2 p-3">
            <div class="min-w-0">
              <div class="truncate text-xs font-semibold text-[#171717]">{{ item.title }}</div>
              <div class="mt-0.5 line-clamp-1 text-[11px] text-[#737373]">
                {{ item.description || item.slug }}
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#737373]">
                <span>{{ item.assets.length }} assets</span>
                <span v-if="item.exportedFile" class="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                  Exported {{ formatBytes(item.exportedSize) }}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 opacity-0 transition group-hover:opacity-100"
              title="Delete thumbnail"
              @click.stop="deleteTarget = item"
            >
              <Trash2Icon class="size-3.5 text-red-600" />
            </Button>
          </div>
        </div>

        <!-- UNIFORM DASHED CREATE CARD (matches OBS Overlays gallery) -->
        <button
          type="button"
          class="flex min-h-[210px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#D4D4D4] bg-white/60 p-6 text-center transition-colors hover:border-[#171717] hover:bg-white"
          :disabled="creating"
          @click="showCreateDialog = true"
        >
          <span class="flex size-9 items-center justify-center rounded-full border border-[#E5E5E5] bg-[#FAFAFA] text-[#171717]">
            <PlusIcon class="size-4" />
          </span>
          <span class="font-mono text-xs font-semibold text-[#171717]">Create New Thumbnail</span>
          <span class="max-w-[200px] text-[11px] text-neutral-500">
            Reaction Split, Commentary, Zatsudan, Hot Take, or custom design
          </span>
        </button>
      </div>
    </div>

    <!-- DETAIL STUDIO VIEW (2-PANE: LEFT CANVAS + SQUINT TEST, RIGHT REFINE WITH OTTO) -->
    <div v-else-if="selectedThumbnail" class="flex min-h-0 flex-1 overflow-hidden">
      <!-- LEFT: FRAMED 1280x720 CANVAS + 120px MOBILE SQUINT TEST -->
      <div class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <!-- BOX 1: TRUE 1280x720 LIVE CANVAS -->
        <div class="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-black/10 bg-white">
          <div class="flex items-center justify-between border-b border-black/6 px-3 py-1.5 text-[11px] text-[#525252]">
            <span class="font-medium">Canvas Preview (1280×720 · 16:9)</span>
            <span class="font-mono text-[10px] text-[#737373]">
              {{ Math.round(previewScale * 100) }}% scale
            </span>
          </div>
          <div
            ref="stageWrapRef"
            class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#E7E5E4] p-2.5"
          >
            <div
              class="relative overflow-hidden rounded-md bg-black shadow-md ring-1 ring-black/15"
              :style="scaledBoxStyle"
            >
              <iframe
                ref="previewFrameRef"
                :key="`${selectedThumbnail.slug}-${frameKey}`"
                :src="`${selectedThumbnail.previewUrl}?k=${frameKey}`"
                class="block border-0"
                :style="scaledIframeStyle"
                sandbox="allow-same-origin"
              />
              <!-- Optional YouTube Bottom-Right Duration Badge Safe-Zone Indicator -->
              <div
                v-if="showSafeZone"
                class="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center justify-center rounded border border-dashed border-amber-400 bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
              >
                12:34
              </div>
            </div>
          </div>
        </div>

        <!-- BOX 2: 120px MOBILE SQUINT-TEST + EXPORT INFO -->
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3">
          <div class="flex items-center gap-3">
            <div class="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded bg-black ring-1 ring-black/15">
              <iframe
                :key="`squint-${selectedThumbnail.slug}-${frameKey}`"
                :src="`${selectedThumbnail.previewUrl}?k=${frameKey}`"
                class="pointer-events-none h-[720px] w-[1280px] origin-top-left border-0"
                style="transform: scale(0.09375)"
                sandbox="allow-same-origin"
              />
              <span class="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 font-mono text-[7px] text-white">
                12:34
              </span>
            </div>
            <div class="min-w-0">
              <div class="text-xs font-semibold">120px Mobile Squint Test</div>
              <p class="mt-0.5 text-[11px] text-[#737373]">
                Check if your hook text &amp; expression read instantly at phone feed size.
              </p>
              <div v-if="selectedThumbnail.exportedFile" class="mt-1 flex items-center gap-2 text-[11px]">
                <span class="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                  {{ selectedThumbnail.exportedFile }} · {{ formatBytes(selectedThumbnail.exportedSize) }}
                </span>
                <a
                  v-if="selectedThumbnail.exportedUrl"
                  :href="`${selectedThumbnail.exportedUrl}?download=1`"
                  class="text-[11px] font-medium text-[#171717] underline"
                >
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: ISOLATED REFINE WITH OTTO SIDEBAR -->
      <div
        v-if="showRefinePanel"
        class="flex w-[310px] shrink-0 flex-col border-l border-black/8 bg-white"
      >
        <div class="flex items-center justify-between border-b border-black/6 px-3.5 py-2.5">
          <div>
            <div class="text-xs font-semibold">Refine with Otto</div>
            <div class="text-[10px] text-[#737373]">Isolated thread · keeps Otto Chat clean</div>
          </div>
          <Badge v-if="refining" variant="secondary" class="gap-1 text-[10px]">
            <Loader2Icon class="size-2.5 animate-spin" />
            Refining
          </Badge>
        </div>

        <div ref="refineScrollRef" class="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
          <div v-if="activeRefineMessages.length === 0" class="space-y-2">
            <p class="text-[11px] text-[#737373]">
              Ask Otto to tweak typography, swap your character pose from Box
              <span class="font-mono">Otto Assets</span>, or try a new Pixabay photo background:
            </p>
            <div class="flex flex-col gap-1.5">
              <button
                v-for="chip in quickRefineChips"
                :key="chip"
                type="button"
                class="rounded-lg border border-black/10 bg-[#FAFAF9] px-2.5 py-1.5 text-left text-[11px] text-[#262626] transition hover:border-black/25 hover:bg-black/5"
                :disabled="refining"
                @click="sendRefine(chip)"
              >
                {{ chip }}
              </button>
            </div>
          </div>

          <div
            v-for="m in activeRefineMessages"
            :key="m.id"
            class="rounded-lg px-2.5 py-2 text-xs leading-relaxed"
            :class="
              m.role === 'user'
                ? 'ml-4 bg-[#171717] text-white'
                : 'mr-2 border border-black/8 bg-[#F5F5F4] text-[#171717]'
            "
          >
            {{ m.text }}
          </div>
        </div>

        <div class="border-t border-black/8 p-2.5">
          <div v-if="refineAttachments.length > 0" class="mb-2 flex flex-wrap gap-1.5">
            <div
              v-for="(att, idx) in refineAttachments"
              :key="att.workspacePath"
              class="flex items-center gap-1.5 rounded-lg border border-black/10 bg-[#FAFAF9] py-1 pl-1 pr-1.5"
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
            @change="(e) => { const f = (e.target as HTMLInputElement).files; if (f) uploadImageFiles(f, 'refine'); (e.target as HTMLInputElement).value = ''; }"
          />
          <div class="flex items-end gap-1.5 rounded-lg border border-black/15 bg-[#FAFAF9] p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7 shrink-0 text-neutral-600 hover:text-black"
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
              placeholder="e.g. Ganti background sama gambar ini, atau swap pose..."
              class="min-h-[42px] flex-1 resize-none bg-transparent px-1 text-xs outline-none placeholder:text-[#A3A3A3]"
              :disabled="refining"
              @paste="(e) => handlePasteImage(e, 'refine')"
              @keydown.enter.exact.prevent="sendRefine()"
            />
            <Button
              size="icon"
              class="size-7 shrink-0 bg-[#171717] text-white hover:bg-[#303030]"
              :disabled="refining || !refineInput.trim()"
              @click="sendRefine()"
            >
              <SendIcon class="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- CREATE NEW THUMBNAIL MODAL -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent class="sm:max-w-3xl bg-white p-6">
        <DialogHeader>
          <div class="flex items-center justify-between gap-3 pr-7">
            <DialogTitle class="text-base">Create New Thumbnail</DialogTitle>
            <Badge variant="outline" class="font-mono text-[10px]">
              Isolated worker · 1280×720
            </Badge>
          </div>
          <DialogDescription class="text-xs text-[#737373]">
            Describe the video topic, hook text, and mood. Otto composes a 100% non-AI thumbnail using
            your character cutouts &amp; logos from Box <span class="font-mono">Otto Assets</span> and
            human photography from Pixabay.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="rounded-xl border border-black/15 bg-[#FAFAF9] p-2.5">
            <div v-if="createAttachments.length > 0" class="mb-2 flex flex-wrap gap-1.5">
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
              @change="(e) => { const f = (e.target as HTMLInputElement).files; if (f) uploadImageFiles(f, 'create'); (e.target as HTMLInputElement).value = ''; }"
            />
            <textarea
              v-model="customPrompt"
              rows="4"
              placeholder="e.g. Thumbnail for my late-night horror stream, shocked expression from White_Light, dark abandoned hallway background from Pixabay (or paste/upload an image), huge bold hook 'DON'T TURN AROUND'"
              class="w-full resize-none bg-transparent text-xs outline-none placeholder:text-[#A3A3A3]"
              @paste="(e) => handlePasteImage(e, 'create')"
              @keydown.enter.exact.prevent="submitCreate(customPrompt)"
            />
            <div class="mt-2 flex items-center justify-between gap-2">
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
                <span class="text-[10px] text-[#737373]">Enter to build · Ctrl+V to paste image</span>
              </div>
              <Button
                size="sm"
                class="h-7 gap-1.5 bg-[#171717] text-xs text-white hover:bg-[#303030]"
                :disabled="creating || !customPrompt.trim()"
                @click="submitCreate(customPrompt)"
              >
                <SparklesIcon class="size-3.5" />
                Build Thumbnail
              </Button>
            </div>
          </div>

          <div>
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#737373]">
              Or start from a template
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="s in starters"
                :key="s.label"
                type="button"
                class="rounded-xl border border-black/10 bg-white p-2.5 text-left transition hover:border-black/25 hover:bg-[#FAFAF9]"
                @click="submitCreate(s.prompt, `Building ${s.label}...`)"
              >
                <div class="flex items-center gap-1.5 text-xs font-semibold">
                  <SparklesIcon class="size-3 text-[#525252]" />
                  {{ s.label }}
                </div>
                <p class="mt-1 text-[11px] leading-snug text-[#737373]">{{ s.desc }}</p>
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- DELETE CONFIRMATION -->
    <AlertDialog :open="Boolean(deleteTarget)" @update:open="(v) => { if (!v) deleteTarget = null; }">
      <AlertDialogContent class="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete thumbnail?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes "{{ deleteTarget?.title }}" and its local assets from Thumbnail Studio.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-red-600 text-white hover:bg-red-700"
            :disabled="deleting"
            @click="confirmDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
