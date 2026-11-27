<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CaptionsIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudUploadIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePlus2Icon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HardDriveIcon,
  LayoutGridIcon,
  ListIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "../lib/markdown";
import WorkspaceFileSkeleton from "./WorkspaceFileSkeleton.vue";
import {
  ROOT_SELECT_VALUE,
  VIEW_STORAGE_KEY,
  type SortMode,
  type ViewMode,
  type WorkspaceEntry,
  type WorkspaceStats,
} from "@/types/workspace";
import {
  askActionLabel,
  buildAskOttoPrompt,
  buildBreadcrumbs,
  entryIconComponent,
  fileUrl,
  folderIconComponent,
  formatBytes,
  formatTime,
  kindBadgeLabel,
  normalizeDirPath,
  readStoredViewMode,
  sortModeLabel,
  sortWorkspaceEntries,
  triggerDownload,
  zipUrl,
} from "@/lib/workspace-helpers";
import {
  BOX_OVERSIZE_REASON,
  isBoxOversize,
  useWorkspaceBoxExport,
} from "@/composables/useWorkspaceBoxExport";

const props = defineProps<{
  refreshTick: number;
  initialPath?: string;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  statsUpdated: [payload: { stats: WorkspaceStats; recentFiles: WorkspaceEntry[] }];
  pathChanged: [relDir: string];
}>();

const initialNormalizedPath = normalizeDirPath(props.initialPath || "");
const currentPath = ref(initialNormalizedPath);
const navHistory = ref<string[]>([initialNormalizedPath]);
const navHistoryIndex = ref(0);
const breadcrumbs = ref<Array<{ name: string; path: string }>>(buildBreadcrumbs(currentPath.value));
const items = ref<WorkspaceEntry[]>([]);
const dirs = ref<string[]>([""]);
const stats = ref<WorkspaceStats>({ totalBytes: 0, fileCount: 0, clipCount: 0 });
const searchQuery = ref("");
const viewMode = ref<ViewMode>(readStoredViewMode());
const sortMode = ref<SortMode>("name-asc");
const loading = ref(false);
const hasLoadedDirs = ref(false);
const showListSkeleton = ref(true);
const uploading = ref(false);
const dragOver = ref(false);
const errorMsg = ref("");

const dirCache = new Map<string, WorkspaceEntry[]>();
let latestRequestId = 0;
let activeAbortController: AbortController | null = null;
let latestTextRequestId = 0;
let activeTextAbortController: AbortController | null = null;

const canGoBack = computed(() => navHistoryIndex.value > 0);
const canGoForward = computed(() => navHistoryIndex.value < navHistory.value.length - 1);
const canGoUp = computed(() => currentPath.value.length > 0);
// Dialog states
const newFolderOpen = ref(false);
const newFolderTargetDir = ref("");
const newFolderName = ref("");
const newFolderError = ref("");
const newFolderSubmitting = ref(false);

const newNoteOpen = ref(false);
const newNoteTargetDir = ref("");
const newNoteName = ref("");
const newNoteError = ref("");
const newNoteSubmitting = ref(false);

const movingItem = ref<WorkspaceEntry | null>(null);
const moveTargetName = ref("");
const moveTargetDir = ref(ROOT_SELECT_VALUE);
const moveError = ref("");
const moveSubmitting = ref(false);

const entryPendingDelete = ref<WorkspaceEntry | null>(null);
const deleteSubmitting = ref(false);

// Slide-over Sheet preview & Tier 3 editor state
const selectedFile = ref<WorkspaceEntry | null>(null);
const previewSheetOpen = computed({
  get: () => Boolean(selectedFile.value),
  set: (next: boolean) => {
    if (!next) selectedFile.value = null;
  },
});
const textContent = ref("");
const originalTextContent = ref("");
const textLoading = ref(false);
const textSaving = ref(false);
const editMode = ref(false);

const fileInputRef = ref<HTMLInputElement | null>(null);

const isTextDirty = computed(() => textContent.value !== originalTextContent.value);
const renderedPreviewHtml = computed(() =>
  selectedFile.value?.kind === "markdown" ? renderMarkdown(textContent.value) : ""
);

const sortedItems = computed(() => sortWorkspaceEntries(items.value, sortMode.value));

const sortLabel = computed(() => sortModeLabel(sortMode.value));

function setViewMode(mode: ViewMode) {
  viewMode.value = mode;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

interface LoadDirectoryOptions {
  showSkeleton?: boolean;
  silent?: boolean;
  rollbackPath?: string;
}

async function loadDirectory(targetPath = currentPath.value, opts: LoadDirectoryOptions = {}) {
  const normalizedTarget = normalizeDirPath(targetPath);
  const trimmedQuery = searchQuery.value.trim();
  const reqId = ++latestRequestId;

  activeAbortController?.abort();
  const controller = new AbortController();
  activeAbortController = controller;

  if (normalizedTarget !== currentPath.value) {
    currentPath.value = normalizedTarget;
    breadcrumbs.value = buildBreadcrumbs(normalizedTarget);
  }

  loading.value = true;
  if (opts.showSkeleton || (!opts.silent && !hasLoadedDirs.value)) {
    showListSkeleton.value = true;
  }
  errorMsg.value = "";

  try {
    const q = new URLSearchParams({ path: normalizedTarget });
    if (trimmedQuery) q.set("q", trimmedQuery);
    const res = await fetch(`/api/workspace/list?${q.toString()}`, {
      signal: controller.signal,
    });
    const data = (await res.json()) as {
      path?: string;
      breadcrumbs?: Array<{ name: string; path: string }>;
      items?: WorkspaceEntry[];
      dirs?: string[];
      stats?: WorkspaceStats;
      recentFiles?: WorkspaceEntry[];
      error?: string;
    };
    if (reqId !== latestRequestId) return;
    if (!res.ok) {
      errorMsg.value = data.error || "Could not load folder";
      if (opts.rollbackPath !== undefined && opts.rollbackPath !== normalizedTarget) {
        currentPath.value = opts.rollbackPath;
        breadcrumbs.value = buildBreadcrumbs(opts.rollbackPath);
        const cachedPrev = dirCache.get(opts.rollbackPath);
        if (cachedPrev) {
          items.value = cachedPrev;
        }
      }
      showListSkeleton.value = false;
      return;
    }
    const resolvedPath = normalizeDirPath(data.path ?? normalizedTarget);
    const resolvedItems = data.items || [];
    currentPath.value = resolvedPath;
    breadcrumbs.value = data.breadcrumbs || buildBreadcrumbs(resolvedPath);
    items.value = resolvedItems;
    dirs.value = data.dirs || [""];
    hasLoadedDirs.value = true;
    showListSkeleton.value = false;
    if (!trimmedQuery) {
      dirCache.set(resolvedPath, resolvedItems);
    }
    if (data.stats) {
      stats.value = data.stats;
      emit("statsUpdated", {
        stats: data.stats,
        recentFiles: data.recentFiles || [],
      });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (reqId !== latestRequestId) return;
    errorMsg.value = err instanceof Error ? err.message : "Network error";
    if (opts.rollbackPath !== undefined && opts.rollbackPath !== normalizedTarget) {
      currentPath.value = opts.rollbackPath;
      breadcrumbs.value = buildBreadcrumbs(opts.rollbackPath);
      const cachedPrev = dirCache.get(opts.rollbackPath);
      if (cachedPrev) {
        items.value = cachedPrev;
      }
    }
    showListSkeleton.value = false;
  } finally {
    if (reqId === latestRequestId) {
      loading.value = false;
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  }
}

function navigateTo(relDir: string, opts: { recordHistory?: boolean } = {}) {
  const nextDir = normalizeDirPath(relDir);
  const prevPath = currentPath.value;
  const hadSearch = Boolean(searchQuery.value.trim());

  if (nextDir === prevPath && loading.value && !hadSearch) {
    return;
  }

  if (opts.recordHistory !== false && nextDir !== prevPath) {
    const sliced = navHistory.value.slice(0, navHistoryIndex.value + 1);
    sliced.push(nextDir);
    navHistory.value = sliced;
    navHistoryIndex.value = sliced.length - 1;
  }

  clearTimeout(searchTimer ?? undefined);
  searchQuery.value = "";
  errorMsg.value = "";

  // Optimistic client update: move sidebar active indicator and breadcrumbs immediately
  currentPath.value = nextDir;
  breadcrumbs.value = buildBreadcrumbs(nextDir);

  const cached = dirCache.get(nextDir);
  if (cached && !hadSearch) {
    items.value = cached;
    showListSkeleton.value = false;
    void loadDirectory(nextDir, { silent: true, rollbackPath: prevPath });
    return;
  }

  items.value = [];
  showListSkeleton.value = true;
  void loadDirectory(nextDir, { showSkeleton: true, rollbackPath: prevPath });
}

function goBack() {
  if (!canGoBack.value) return;
  navHistoryIndex.value -= 1;
  navigateTo(navHistory.value[navHistoryIndex.value], { recordHistory: false });
}

function goForward() {
  if (!canGoForward.value) return;
  navHistoryIndex.value += 1;
  navigateTo(navHistory.value[navHistoryIndex.value], { recordHistory: false });
}

function goUp() {
  if (!canGoUp.value) return;
  const parts = currentPath.value.split("/").filter(Boolean);
  parts.pop();
  navigateTo(parts.join("/"));
}

async function openEntry(entry: WorkspaceEntry, startInEdit = false) {
  if (entry.isDir) {
    navigateTo(entry.relPath);
    return;
  }
  selectedFile.value = entry;
  editMode.value = startInEdit && entry.editable;
  if (entry.kind === "markdown" || entry.kind === "text") {
    const textReqId = ++latestTextRequestId;
    activeTextAbortController?.abort();
    const controller = new AbortController();
    activeTextAbortController = controller;

    textLoading.value = true;
    errorMsg.value = "";
    try {
      const res = await fetch(`/api/workspace/text?path=${encodeURIComponent(entry.relPath)}`, {
        signal: controller.signal,
      });
      const data = (await res.json()) as { content?: string; error?: string };
      if (textReqId !== latestTextRequestId) return;
      if (!res.ok) {
        toast.error(data.error || "Unable to read file");
        textContent.value = "";
        originalTextContent.value = "";
      } else {
        textContent.value = data.content || "";
        originalTextContent.value = data.content || "";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (textReqId !== latestTextRequestId) return;
      toast.error("Unable to read file");
    } finally {
      if (textReqId === latestTextRequestId) {
        textLoading.value = false;
        if (activeTextAbortController === controller) {
          activeTextAbortController = null;
        }
      }
    }
  }
}

async function saveTextFile() {
  if (!selectedFile.value || textSaving.value) return;
  textSaving.value = true;
  try {
    const res = await fetch("/api/workspace/text", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: selectedFile.value.relPath,
        content: textContent.value,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      toast.error(data.error || "Save failed");
      return;
    }
    originalTextContent.value = textContent.value;
    toast.success(`Saved ${selectedFile.value.name}`);
    dirCache.clear();
    await loadDirectory(currentPath.value, { silent: true });
  } finally {
    textSaving.value = false;
  }
}

function onEditorKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (isTextDirty.value && !textSaving.value) {
      void saveTextFile();
    }
  }
}

function triggerUploadPicker() {
  fileInputRef.value?.click();
}

async function uploadFileList(fileList: FileList | File[]) {
  const arr = Array.from(fileList);
  if (arr.length === 0) return;
  uploading.value = true;
  errorMsg.value = "";
  try {
    const targetDir = currentPath.value || "uploads";
    const form = new FormData();
    form.append("dir", targetDir);
    for (const f of arr) form.append("files", f);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
    const data = (await res.json()) as {
      ok?: boolean;
      uploaded?: Array<{ name: string; relPath: string }>;
      error?: string;
    };
    if (!res.ok) {
      toast.error(data.error || "Upload failed");
      return;
    }
    const count = data.uploaded?.length || arr.length;
    toast.success(`Uploaded ${count} file${count === 1 ? "" : "s"} to /${targetDir}`);
    dirCache.clear();
    if (!currentPath.value) {
      await loadDirectory("uploads", { showSkeleton: true });
    } else {
      await loadDirectory(currentPath.value, { silent: true });
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Upload error");
  } finally {
    uploading.value = false;
  }
}

function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    void uploadFileList(input.files);
    input.value = "";
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    void uploadFileList(e.dataTransfer.files);
  }
}

function openNewFolderDialog(targetDir = currentPath.value) {
  newFolderTargetDir.value = normalizeDirPath(targetDir);
  newFolderName.value = "";
  newFolderError.value = "";
  newFolderOpen.value = true;
}

async function submitNewFolder() {
  const name = newFolderName.value.trim();
  if (!name) {
    newFolderError.value = "Folder name is required.";
    return;
  }
  newFolderSubmitting.value = true;
  newFolderError.value = "";
  try {
    const res = await fetch("/api/workspace/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: newFolderTargetDir.value, name }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      newFolderError.value = data.error || "Failed to create folder";
      return;
    }
    newFolderOpen.value = false;
    toast.success(`Created folder "${name}"`);
    dirCache.clear();
    await loadDirectory(newFolderTargetDir.value, {
      silent: newFolderTargetDir.value === currentPath.value,
      showSkeleton: newFolderTargetDir.value !== currentPath.value,
    });
  } finally {
    newFolderSubmitting.value = false;
  }
}

function openNewNoteDialog(targetDir = currentPath.value || "scripts") {
  newNoteTargetDir.value = normalizeDirPath(targetDir) || "scripts";
  newNoteName.value = "";
  newNoteError.value = "";
  newNoteOpen.value = true;
}

async function submitNewNote() {
  let name = newNoteName.value.trim();
  if (!name) {
    newNoteError.value = "Note filename is required.";
    return;
  }
  if (!/\.(md|txt|csv|json|yml)$/i.test(name)) {
    name = `${name}.md`;
  }
  const dir = newNoteTargetDir.value || "scripts";
  const relPath = dir ? `${dir}/${name}` : name;
  newNoteSubmitting.value = true;
  newNoteError.value = "";
  try {
    const res = await fetch("/api/workspace/text", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: relPath,
        content: `# ${name.replace(/\.[^.]+$/, "")}\n\n`,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      newNoteError.value = data.error || "Could not create note";
      return;
    }
    newNoteOpen.value = false;
    toast.success(`Created /${relPath}`);
    dirCache.clear();
    await loadDirectory(dir, {
      silent: dir === currentPath.value,
      showSkeleton: dir !== currentPath.value,
    });
    const created = items.value.find((i) => i.relPath === relPath);
    if (created) {
      await openEntry(created, true);
    }
  } finally {
    newNoteSubmitting.value = false;
  }
}

function openMoveDialog(entry: WorkspaceEntry) {
  movingItem.value = entry;
  moveTargetName.value = entry.name;
  const parent = entry.relPath.includes("/")
    ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/"))
    : "";
  moveTargetDir.value = parent || ROOT_SELECT_VALUE;
  moveError.value = "";
}

async function submitMove() {
  if (!movingItem.value) return;
  const name = moveTargetName.value.trim();
  if (!name) {
    moveError.value = "Name cannot be empty.";
    return;
  }
  const destDir = moveTargetDir.value === ROOT_SELECT_VALUE ? "" : moveTargetDir.value;
  const newPath = destDir ? `${destDir}/${name}` : name;
  moveSubmitting.value = true;
  moveError.value = "";
  try {
    const res = await fetch("/api/workspace/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: movingItem.value.relPath, newPath }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      moveError.value = data.error || "Rename/Move failed";
      return;
    }
    if (selectedFile.value?.relPath === movingItem.value.relPath) {
      selectedFile.value = null;
    }
    movingItem.value = null;
    toast.success(`Moved to /${newPath}`);
    dirCache.clear();
    await loadDirectory(currentPath.value, { silent: true });
  } finally {
    moveSubmitting.value = false;
  }
}

function promptDelete(entry: WorkspaceEntry) {
  entryPendingDelete.value = entry;
}

async function confirmDelete() {
  const entry = entryPendingDelete.value;
  if (!entry || deleteSubmitting.value) return;
  deleteSubmitting.value = true;
  try {
    const res = await fetch(`/api/workspace/entry?path=${encodeURIComponent(entry.relPath)}`, {
      method: "DELETE",
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      toast.error(data.error || "Delete failed");
      return;
    }
    if (selectedFile.value?.relPath === entry.relPath) {
      selectedFile.value = null;
    }
    entryPendingDelete.value = null;
    toast.success(`Deleted ${entry.name}`);
    dirCache.clear();
    await loadDirectory(currentPath.value, { silent: true });
  } finally {
    deleteSubmitting.value = false;
  }
}

function askOttoAbout(entry: WorkspaceEntry) {
  emit("askPrompt", buildAskOttoPrompt(entry));
}
const {
  boxConnected,
  boxSyncing,
  boxLastSyncedAt,
  boxModalOpen,
  boxUploading,
  boxTargetName,
  boxTargetIsDir,
  boxResult,
  boxError,
  boxCopied,
  checkBoxStatus,
  syncBoxNow,
  sendToBox,
  copyBoxLink,
} = useWorkspaceBoxExport();

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  clearTimeout(searchTimer ?? undefined);
  searchTimer = setTimeout(() => {
    void loadDirectory(currentPath.value, { showSkeleton: true });
  }, 220);
}

function clearSearch() {
  searchQuery.value = "";
  clearTimeout(searchTimer ?? undefined);
  const cached = dirCache.get(currentPath.value);
  if (cached) {
    items.value = cached;
    showListSkeleton.value = false;
    void loadDirectory(currentPath.value, { silent: true });
  } else {
    void loadDirectory(currentPath.value, { showSkeleton: true });
  }
}

function manualRefresh() {
  dirCache.clear();
  void loadDirectory(currentPath.value, { silent: true });
}

watch(
  () => props.refreshTick,
  () => {
    dirCache.clear();
    void loadDirectory(currentPath.value, {
      showSkeleton: !hasLoadedDirs.value,
      silent: hasLoadedDirs.value,
    });
  },
  { immediate: true }
);

watch(
  () => props.initialPath,
  (next) => {
    if (typeof next === "string" && normalizeDirPath(next) !== currentPath.value) {
      navigateTo(next);
    }
  }
);

onUnmounted(() => {
  clearTimeout(searchTimer ?? undefined);
  activeAbortController?.abort();
  activeTextAbortController?.abort();
});

watch(
  currentPath,
  (next) => {
    emit("pathChanged", next);
  },
  { immediate: true }
);

defineExpose({ loadDirectory, navigateTo, openNewFolderDialog, openNewNoteDialog });
</script>

<template>
  <div
    :class="
      cn(
        'relative flex h-full min-h-0 flex-col bg-white select-none',
        dragOver && 'outline-2 outline-dashed outline-primary -outline-offset-4'
      )
    "
    @dragover.prevent="dragOver = true"
    @dragleave.self="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFileInputChange" />

    <!-- TOP OS FILE MANAGER TOOLBAR -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#ededed] bg-[#fafafa] px-3 py-2 shrink-0">
      <!-- Navigation & Path Breadcrumb Bar -->
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <div class="flex items-center gap-0.5 shrink-0">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="Back"
            :disabled="!canGoBack"
            @click="goBack"
          >
            <ArrowLeftIcon class="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="Forward"
            :disabled="!canGoForward"
            @click="goForward"
          >
            <ArrowRightIcon class="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="Parent folder"
            :disabled="!canGoUp"
            @click="goUp"
          >
            <ArrowUpIcon class="size-3.5" />
          </Button>
        </div>

        <div class="flex h-8 min-w-[160px] flex-1 max-w-xl items-center gap-1 overflow-x-auto rounded-lg border border-[#e3e3e3] bg-white px-2.5">
          <HardDriveIcon class="size-3.5 shrink-0 text-muted-foreground mr-0.5" />
          <Breadcrumb class="min-w-0">
            <BreadcrumbList class="font-mono text-xs gap-0.5 flex-nowrap">
              <template v-for="(bc, idx) in breadcrumbs" :key="bc.path || 'root'">
                <ChevronRightIcon v-if="idx > 0" class="size-3 shrink-0 text-muted-foreground/60" />
                <BreadcrumbItem class="shrink-0">
                  <BreadcrumbPage
                    v-if="idx === breadcrumbs.length - 1"
                    class="font-mono text-xs font-medium text-[#303030] px-1.5 py-0.5 rounded bg-[#f2f2f2]"
                  >
                    {{ bc.name }}
                  </BreadcrumbPage>
                  <BreadcrumbLink v-else as-child>
                    <button
                      type="button"
                      class="font-mono text-xs text-muted-foreground hover:text-[#303030] hover:bg-[#f2f2f2] px-1.5 py-0.5 rounded transition-colors"
                      @click="navigateTo(bc.path)"
                    >
                      {{ bc.name }}
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </template>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <Button
          v-if="boxConnected"
          type="button"
          size="xs"
          variant="outline"
          class="h-7 shrink-0 gap-1 rounded-lg bg-white px-2 font-mono text-[11px]"
          :disabled="boxSyncing"
          :title="boxLastSyncedAt ? `Last synced: ${formatTime(boxLastSyncedAt)}` : 'Sync Otto Assets & Handoffs with Box'"
          @click="syncBoxNow(() => loadDirectory(currentPath))"
        >
          <RefreshCwIcon class="size-3" :class="boxSyncing ? 'animate-spin' : ''" />
          <span>{{ boxSyncing ? "Syncing..." : "Sync Box" }}</span>
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Refresh"
          class="shrink-0"
          @click="manualRefresh"
        >
          <RefreshCwIcon class="size-3.5" />
        </Button>
      </div>

      <!-- Search, View Mode, Sort, Actions -->
      <div class="flex items-center gap-1.5 flex-wrap shrink-0">
        <InputGroup class="w-40 sm:w-48 h-8 rounded-lg bg-white border-[#e3e3e3]">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            v-model="searchQuery"
            type="text"
            placeholder="Search files..."
            class="font-mono text-[11.5px] h-8"
            @input="onSearchInput"
          />
          <InputGroupAddon v-if="searchQuery" align="inline-end">
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              aria-label="Clear search"
              @click="clearSearch"
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          :model-value="viewMode"
          class="rounded-lg bg-[#ededed] p-0.5 gap-0.5"
          @update:model-value="(val) => { if (val === 'list' || val === 'grid') setViewMode(val); }"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <ToggleGroupItem
                value="list"
                aria-label="List view"
                class="h-7 px-2 rounded-md border-0 data-[state=on]:bg-white data-[state=on]:shadow-2xs"
              >
                <ListIcon class="size-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>List view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <ToggleGroupItem
                value="grid"
                aria-label="Grid view"
                class="h-7 px-2 rounded-md border-0 data-[state=on]:bg-white data-[state=on]:shadow-2xs"
              >
                <LayoutGridIcon class="size-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Grid view</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button type="button" variant="outline" size="sm" class="h-8 rounded-lg bg-white">
              <ArrowUpDownIcon data-icon="inline-start" />
              {{ sortLabel }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-40">
            <DropdownMenuLabel class="font-mono text-[11px]">Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem @select="sortMode = 'name-asc'">
                <CheckIcon :class="cn('opacity-0', sortMode === 'name-asc' && 'opacity-100')" />
                Name (A–Z)
              </DropdownMenuItem>
              <DropdownMenuItem @select="sortMode = 'modified-desc'">
                <CheckIcon :class="cn('opacity-0', sortMode === 'modified-desc' && 'opacity-100')" />
                Newest first
              </DropdownMenuItem>
              <DropdownMenuItem @select="sortMode = 'size-desc'">
                <CheckIcon :class="cn('opacity-0', sortMode === 'size-desc' && 'opacity-100')" />
                Largest first
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button type="button" variant="outline" size="sm" class="h-8 rounded-lg bg-white">
              <PlusIcon data-icon="inline-start" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem @select="openNewNoteDialog(currentPath || 'scripts')">
                <FilePlus2Icon />
                New Note (.md)
              </DropdownMenuItem>
              <DropdownMenuItem @select="openNewFolderDialog(currentPath)">
                <FolderPlusIcon />
                New Folder
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem @select="triggerDownload(zipUrl(currentPath))">
                <ArchiveIcon />
                Download ZIP
              </DropdownMenuItem>
              <DropdownMenuItem @select="manualRefresh">
                <RefreshCwIcon />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          size="sm"
          class="h-8 rounded-lg"
          :disabled="uploading"
          @click="triggerUploadPicker"
        >
          <Spinner v-if="uploading" data-icon="inline-start" />
          <UploadIcon v-else data-icon="inline-start" />
          {{ uploading ? "Uploading" : "Upload" }}
        </Button>
      </div>
    </div>

    <!-- SPLIT OS FILE MANAGER BODY -->
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- LEFT SIDEBAR: LOCATIONS / FOLDER TREE -->
      <aside class="hidden md:flex w-52 lg:w-56 shrink-0 flex-col border-r border-[#ededed] bg-[#f7f7f8]">
        <div class="px-3.5 pt-3 pb-1.5 flex items-center justify-between">
          <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Locations
          </span>
          <span class="font-mono text-[10px] text-muted-foreground">{{ formatBytes(stats.totalBytes) }}</span>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
          <WorkspaceFileSkeleton v-if="!hasLoadedDirs && loading" variant="tree" :count="7" />
          <template v-else>
            <ContextMenu v-for="d in dirs" :key="d || '__root__'">
              <ContextMenuTrigger as-child>
                <button
                  type="button"
                  :class="
                    cn(
                      'flex items-center gap-2 w-full rounded-lg py-1.5 pr-2.5 text-left text-xs transition-colors',
                      currentPath === d && !searchQuery.trim()
                        ? 'bg-black/[0.08] text-[#141414] font-medium'
                        : 'text-[#525252] hover:bg-black/[0.04] hover:text-[#141414]'
                    )
                  "
                  :aria-current="currentPath === d && !searchQuery.trim() ? 'page' : undefined"
                  :style="{ paddingLeft: d ? `${10 + (d.split('/').length - 1) * 12}px` : '10px' }"
                  @click="navigateTo(d)"
                >
                  <component
                    :is="folderIconComponent(d, currentPath === d && !searchQuery.trim())"
                    class="size-3.5 shrink-0 opacity-80"
                  />
                  <span class="truncate font-mono text-[11.5px]">{{ d ? d.split("/").pop() : "workspace" }}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-48">
                <ContextMenuLabel class="font-mono text-[11px] truncate">
                  /{{ d || "workspace" }}
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuItem @select="navigateTo(d)">
                    <FolderOpenIcon />
                    Open Folder
                  </ContextMenuItem>
                  <ContextMenuItem @select="openNewFolderDialog(d)">
                    <FolderPlusIcon />
                    New Subfolder...
                  </ContextMenuItem>
                  <ContextMenuItem @select="openNewNoteDialog(d || 'scripts')">
                    <FilePlus2Icon />
                    New Note Here...
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuItem @select="triggerDownload(zipUrl(d))">
                    <ArchiveIcon />
                    Download ZIP
                  </ContextMenuItem>
                  <ContextMenuItem v-if="boxConnected" @select="sendToBox(d, d || 'workspace', true)">
                    <CloudUploadIcon />
                    Send to Box
                  </ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>
          </template>
        </div>

        <div class="shrink-0 border-t border-[#ededed] p-2.5 flex flex-col gap-1.5">
          <a
            :href="zipUrl(currentPath)"
            :class="cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'w-full rounded-lg bg-white no-underline justify-center')"
          >
            <DownloadIcon data-icon="inline-start" />
            Download ZIP
          </a>
          <Button
            v-if="boxConnected"
            type="button"
            variant="secondary"
            size="xs"
            class="w-full rounded-lg justify-center"
            @click="sendToBox(currentPath, currentPath ? currentPath.split('/').pop() || currentPath : 'workspace', true)"
          >
            <CloudUploadIcon data-icon="inline-start" />
            Send Folder to Box
          </Button>
        </div>
      </aside>

      <!-- RIGHT MAIN PANE -->
      <div class="flex flex-1 min-w-0 min-h-0 flex-col bg-white">
        <!-- Mobile/narrow folder strip -->
        <div class="flex md:hidden items-center gap-1 overflow-x-auto border-b border-[#ededed] bg-[#fafafa] px-3 py-1.5 shrink-0">
          <button
            v-for="d in dirs"
            :key="`mob-${d || '__root__'}`"
            type="button"
            :class="
              cn(
                'shrink-0 rounded-md px-2 py-1 font-mono text-[11px] transition-colors',
                currentPath === d && !searchQuery.trim()
                  ? 'bg-[#303030] text-white font-medium'
                  : 'text-muted-foreground hover:bg-black/5'
              )
            "
            @click="navigateTo(d)"
          >
            {{ d ? d.split("/").pop() : "workspace" }}
          </button>
        </div>

        <Alert v-if="errorMsg" variant="destructive" class="m-3 mb-0 shrink-0">
          <AlertDescription class="font-mono text-xs">{{ errorMsg }}</AlertDescription>
        </Alert>

        <!-- FILE LIST / GRID AREA WITH BACKGROUND CONTEXT MENU -->
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <div class="relative flex-1 min-h-0 overflow-y-auto">
              <div
                v-if="dragOver"
                class="absolute inset-3 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-highlight-yellow/90 font-mono text-xs text-foreground"
              >
                <span>Drop files to upload into <strong>/{{ currentPath || "uploads" }}</strong></span>
              </div>

              <!-- SKELETON STATE -->
              <div v-if="showListSkeleton" class="p-4">
                <WorkspaceFileSkeleton
                  :variant="viewMode === 'grid' ? 'grid' : 'rows'"
                  :count="currentPath === '' ? 6 : 4"
                />
              </div>

              <!-- EMPTY STATE -->
              <div v-else-if="sortedItems.length === 0" class="flex h-full min-h-[260px] items-center justify-center p-6">
                <Empty class="border-0 py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderOpenIcon />
                    </EmptyMedia>
                    <EmptyTitle class="font-mono text-xs">
                      {{ searchQuery.trim() ? `No files match "${searchQuery.trim()}"` : "This folder is empty" }}
                    </EmptyTitle>
                    <EmptyDescription class="text-xs max-w-md">
                      {{
                        searchQuery.trim()
                          ? "Try a different filename keyword or clear the search filter."
                          : "Drag & drop files here, right-click anywhere, click Upload, or ask Otto to write a brief or cut a VOD clip."
                      }}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <div class="flex flex-wrap justify-center gap-2">
                      <Button v-if="searchQuery.trim()" type="button" variant="secondary" size="xs" @click="clearSearch">
                        Clear Search
                      </Button>
                      <template v-else>
                        <Button type="button" size="xs" @click="triggerUploadPicker">
                          <UploadIcon data-icon="inline-start" />
                          Upload Files
                        </Button>
                        <Button type="button" variant="secondary" size="xs" @click="openNewNoteDialog(currentPath || 'scripts')">
                          <FilePlus2Icon data-icon="inline-start" />
                          New Note
                        </Button>
                        <Button
                          v-if="currentPath === 'clips' || !currentPath"
                          type="button"
                          variant="secondary"
                          size="xs"
                          @click="emit('askPrompt', 'Scan my latest YouTube VOD for hype moments and cut the top raw clips (.mp4 + .srt) into my workspace clips folder.')"
                        >
                          <SparklesIcon data-icon="inline-start" />
                          Scan VOD for Clips
                        </Button>
                      </template>
                    </div>
                  </EmptyContent>
                </Empty>
              </div>

              <!-- LIST VIEW (OS Details Table) -->
              <div v-else-if="viewMode === 'list'" class="flex flex-col">
                <div class="sticky top-0 z-10 hidden sm:grid sm:grid-cols-[minmax(0,1fr)_88px_142px_142px] items-center gap-3 border-b border-[#ededed] bg-[#fafafa]/95 backdrop-blur-xs px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <button
                    type="button"
                    class="text-left hover:text-foreground transition-colors flex items-center gap-1"
                    @click="sortMode = 'name-asc'"
                  >
                    Name
                  </button>
                  <button
                    type="button"
                    class="text-right hover:text-foreground transition-colors"
                    @click="sortMode = 'size-desc'"
                  >
                    Size
                  </button>
                  <button
                    type="button"
                    class="text-right hover:text-foreground transition-colors"
                    @click="sortMode = 'modified-desc'"
                  >
                    Date Modified
                  </button>
                  <span class="text-right pr-1">Actions</span>
                </div>

                <div class="divide-y divide-[#f3f3f4]">
                  <ContextMenu v-for="entry in sortedItems" :key="entry.relPath">
                    <ContextMenuTrigger as-child>
                      <div
                        :class="
                          cn(
                            'group flex sm:grid sm:grid-cols-[minmax(0,1fr)_88px_142px_142px] items-center justify-between gap-2 sm:gap-3 px-4 py-2 transition-colors',
                            selectedFile?.relPath === entry.relPath
                              ? 'bg-highlight-yellow/70 text-foreground'
                              : 'hover:bg-[#f6f6f7]'
                          )
                        "
                      >
                        <button
                          type="button"
                          class="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                          @click="openEntry(entry)"
                        >
                          <span
                            :class="
                              cn(
                                'grid place-items-center size-7 rounded-lg shrink-0 transition-colors',
                                entry.isDir
                                  ? 'bg-[#f2f2f3] text-[#303030]'
                                  : entry.kind === 'image' || entry.kind === 'video'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-[#f2f2f3] text-muted-foreground'
                              )
                            "
                          >
                            <component :is="entryIconComponent(entry)" class="size-3.5" />
                          </span>
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 min-w-0">
                              <span class="font-mono text-[12.5px] font-medium text-[#222] truncate">
                                {{ entry.name }}
                              </span>
                              <Badge v-if="entry.matchedSrtRelPath" variant="secondary" class="font-mono text-[9.5px] h-4 px-1.5">
                                .srt
                              </Badge>
                              <Badge
                                v-if="isBoxOversize(entry)"
                                variant="outline"
                                class="h-4 border-amber-300 bg-amber-50 px-1.5 font-mono text-[9.5px] text-amber-800"
                                :title="BOX_OVERSIZE_REASON"
                              >
                                Local only (&gt;48 MB)
                              </Badge>
                            </div>
                            <div class="sm:hidden font-mono text-[10.5px] text-muted-foreground truncate">
                              <span v-if="searchQuery.trim()">/{{ entry.relPath }} · </span>
                              <span v-if="!entry.isDir">{{ formatBytes(entry.sizeBytes) }} · </span>
                              <span>{{ formatTime(entry.updatedAt) }}</span>
                            </div>
                            <div v-if="searchQuery.trim()" class="hidden sm:block font-mono text-[10px] text-muted-foreground truncate">
                              /{{ entry.relPath }}
                            </div>
                          </div>
                        </button>

                        <div class="hidden sm:block text-right font-mono text-[11px] text-muted-foreground">
                          {{ entry.isDir ? "—" : formatBytes(entry.sizeBytes) }}
                        </div>

                        <div class="hidden sm:block text-right font-mono text-[11px] text-muted-foreground">
                          {{ formatTime(entry.updatedAt) }}
                        </div>

                        <div class="flex items-center justify-end gap-1 shrink-0">
                          <Button
                            v-if="!entry.isDir"
                            type="button"
                            size="xs"
                            @click.stop="askOttoAbout(entry)"
                          >
                            <SparklesIcon data-icon="inline-start" />
                            {{ askActionLabel(entry) }}
                          </Button>
                          <Button
                            v-else
                            type="button"
                            variant="ghost"
                            size="xs"
                            class="text-muted-foreground hover:text-foreground opacity-80 group-hover:opacity-100"
                            @click.stop="navigateTo(entry.relPath)"
                          >
                            Open
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger as-child>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label="More actions"
                                @click.stop
                              >
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" class="w-48">
                              <DropdownMenuGroup>
                                <DropdownMenuItem @select="openEntry(entry)">
                                  <FolderOpenIcon v-if="entry.isDir" />
                                  <EyeIcon v-else />
                                  {{ entry.isDir ? "Open Folder" : "Preview" }}
                                </DropdownMenuItem>
                                <DropdownMenuItem v-if="entry.editable" @select="openEntry(entry, true)">
                                  <PencilIcon />
                                  Edit File
                                </DropdownMenuItem>
                                <DropdownMenuItem v-if="!entry.isDir" @select="askOttoAbout(entry)">
                                  <SparklesIcon />
                                  {{ askActionLabel(entry) }}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  v-if="entry.isDir"
                                  @select="triggerDownload(zipUrl(entry.relPath))"
                                >
                                  <ArchiveIcon />
                                  Download ZIP
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-else
                                  @select="triggerDownload(fileUrl(entry.relPath, true))"
                                >
                                  <DownloadIcon />
                                  Download
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-if="boxConnected"
                                  :disabled="isBoxOversize(entry)"
                                  :title="isBoxOversize(entry) ? BOX_OVERSIZE_REASON : 'Send to Box'"
                                  @select="!isBoxOversize(entry) && sendToBox(entry.relPath, entry.name, entry.isDir)"
                                >
                                  <CloudUploadIcon />
                                  {{ isBoxOversize(entry) ? "Send to Box (>48 MB limit)" : "Send to Box" }}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-if="entry.matchedSrtRelPath"
                                  @select="triggerDownload(fileUrl(entry.matchedSrtRelPath, true))"
                                >
                                  <CaptionsIcon />
                                  Download .srt Captions
                                </DropdownMenuItem>
                                <DropdownMenuItem @select="openMoveDialog(entry)">
                                  <FolderInputIcon />
                                  Rename / Move...
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem variant="destructive" @select="promptDelete(entry)">
                                  <Trash2Icon />
                                  Delete...
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </ContextMenuTrigger>

                    <ContextMenuContent class="w-52">
                      <ContextMenuLabel class="font-mono text-[11px] truncate">
                        {{ entry.name }}
                      </ContextMenuLabel>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem @select="openEntry(entry)">
                          <FolderOpenIcon v-if="entry.isDir" />
                          <EyeIcon v-else />
                          {{ entry.isDir ? "Open Folder" : "Preview" }}
                        </ContextMenuItem>
                        <ContextMenuItem v-if="entry.editable" @select="openEntry(entry, true)">
                          <PencilIcon />
                          Edit File
                        </ContextMenuItem>
                        <ContextMenuItem v-if="!entry.isDir" @select="askOttoAbout(entry)">
                          <SparklesIcon />
                          {{ askActionLabel(entry) }}
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem
                          v-if="entry.isDir"
                          @select="triggerDownload(zipUrl(entry.relPath))"
                        >
                          <ArchiveIcon />
                          Download ZIP
                        </ContextMenuItem>
                        <ContextMenuItem
                          v-else
                          @select="triggerDownload(fileUrl(entry.relPath, true))"
                        >
                          <DownloadIcon />
                          Download
                        </ContextMenuItem>
                        <ContextMenuItem
                          v-if="boxConnected"
                          :disabled="isBoxOversize(entry)"
                          :title="isBoxOversize(entry) ? BOX_OVERSIZE_REASON : 'Send to Box'"
                          @select="!isBoxOversize(entry) && sendToBox(entry.relPath, entry.name, entry.isDir)"
                        >
                          <CloudUploadIcon />
                          {{ isBoxOversize(entry) ? "Send to Box (>48 MB limit)" : "Send to Box" }}
                        </ContextMenuItem>
                        <ContextMenuItem
                          v-if="entry.matchedSrtRelPath"
                          @select="triggerDownload(fileUrl(entry.matchedSrtRelPath, true))"
                        >
                          <CaptionsIcon />
                          Download .srt Captions
                        </ContextMenuItem>
                        <ContextMenuItem @select="openMoveDialog(entry)">
                          <FolderInputIcon />
                          Rename / Move...
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem variant="destructive" @select="promptDelete(entry)">
                          <Trash2Icon />
                          Delete...
                        </ContextMenuItem>
                      </ContextMenuGroup>
                    </ContextMenuContent>
                  </ContextMenu>
                </div>
              </div>

              <!-- GRID VIEW -->
              <div v-else class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                <ContextMenu v-for="entry in sortedItems" :key="entry.relPath">
                  <ContextMenuTrigger as-child>
                    <div
                      :class="
                        cn(
                          'group relative flex flex-col gap-2 rounded-xl border p-2.5 transition-all',
                          selectedFile?.relPath === entry.relPath
                            ? 'border-primary/40 bg-highlight-yellow/70 text-foreground'
                            : 'border-[#ededed] bg-[#fafafa] hover:bg-[#f2f2f4]'
                        )
                      "
                    >
                        <button
                          type="button"
                          class="flex flex-col gap-2 text-left w-full"
                          @click="openEntry(entry)"
                        >
                          <div
                            :class="
                              cn(
                                'relative aspect-[16/10] w-full overflow-hidden rounded-xl flex items-center justify-center',
                                entry.kind === 'video' ? 'bg-primary text-primary-foreground' : 'bg-background'
                              )
                            "
                          >
                            <img
                              v-if="entry.kind === 'image'"
                              :src="fileUrl(entry.relPath)"
                              :alt="entry.name"
                              loading="lazy"
                              class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                            />
                            <component
                              v-else
                              :is="entryIconComponent(entry)"
                              :class="cn('size-7', entry.kind === 'video' ? 'text-primary-foreground' : 'text-muted-foreground')"
                            />
                            <Badge
                              variant="secondary"
                              class="absolute bottom-1.5 left-1.5 font-mono text-[9.5px] uppercase px-1.5 h-4 bg-background/90 text-foreground"
                            >
                              {{ kindBadgeLabel(entry) }}
                            </Badge>
                            <Badge
                              v-if="entry.matchedSrtRelPath"
                              variant="secondary"
                              class="absolute bottom-1.5 right-1.5 font-mono text-[9.5px] px-1.5 h-4 bg-highlight-yellow text-foreground"
                            >
                              .srt
                            </Badge>
                          </div>

                          <div class="flex flex-col gap-0.5 px-0.5 min-w-0">
                            <span class="fm-name font-mono text-xs font-medium text-foreground truncate">
                              {{ entry.name }}
                            </span>
                            <span class="font-mono text-[10px] text-muted-foreground truncate">
                              {{ entry.isDir ? formatTime(entry.updatedAt) : `${formatBytes(entry.sizeBytes)} · ${formatTime(entry.updatedAt)}` }}
                            </span>
                          </div>
                        </button>

                        <div class="absolute top-3.5 right-3.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger as-child>
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon-xs"
                                class="bg-background/90 shadow-xs hover:bg-background"
                                aria-label="More actions"
                                @click.stop
                              >
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" class="w-48">
                              <DropdownMenuGroup>
                                <DropdownMenuItem @select="openEntry(entry)">
                                  <FolderOpenIcon v-if="entry.isDir" />
                                  <EyeIcon v-else />
                                  {{ entry.isDir ? "Open Folder" : "Preview" }}
                                </DropdownMenuItem>
                                <DropdownMenuItem v-if="entry.editable" @select="openEntry(entry, true)">
                                  <PencilIcon />
                                  Edit File
                                </DropdownMenuItem>
                                <DropdownMenuItem v-if="!entry.isDir" @select="askOttoAbout(entry)">
                                  <SparklesIcon />
                                  {{ askActionLabel(entry) }}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  v-if="entry.isDir"
                                  @select="triggerDownload(zipUrl(entry.relPath))"
                                >
                                  <ArchiveIcon />
                                  Download ZIP
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-else
                                  @select="triggerDownload(fileUrl(entry.relPath, true))"
                                >
                                  <DownloadIcon />
                                  Download
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  v-if="boxConnected"
                                  :disabled="isBoxOversize(entry)"
                                  :title="isBoxOversize(entry) ? BOX_OVERSIZE_REASON : 'Send to Box'"
                                  @select="!isBoxOversize(entry) && sendToBox(entry.relPath, entry.name, entry.isDir)"
                                >
                                  <CloudUploadIcon />
                                  {{ isBoxOversize(entry) ? "Send to Box (>48 MB limit)" : "Send to Box" }}
                                </DropdownMenuItem>
                                <DropdownMenuItem @select="openMoveDialog(entry)">
                                  <FolderInputIcon />
                                  Rename / Move...
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem variant="destructive" @select="promptDelete(entry)">
                                  <Trash2Icon />
                                  Delete...
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </ContextMenuTrigger>

                    <ContextMenuContent class="w-52">
                      <ContextMenuLabel class="font-mono text-[11px] truncate">
                        {{ entry.name }}
                      </ContextMenuLabel>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem @select="openEntry(entry)">
                          <FolderOpenIcon v-if="entry.isDir" />
                          <EyeIcon v-else />
                          {{ entry.isDir ? "Open Folder" : "Preview" }}
                        </ContextMenuItem>
                        <ContextMenuItem v-if="entry.editable" @select="openEntry(entry, true)">
                          <PencilIcon />
                          Edit File
                        </ContextMenuItem>
                        <ContextMenuItem v-if="!entry.isDir" @select="askOttoAbout(entry)">
                          <SparklesIcon />
                          {{ askActionLabel(entry) }}
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem
                          v-if="entry.isDir"
                          @select="triggerDownload(zipUrl(entry.relPath))"
                        >
                          <ArchiveIcon />
                          Download ZIP
                        </ContextMenuItem>
                        <ContextMenuItem
                          v-else
                          @select="triggerDownload(fileUrl(entry.relPath, true))"
                        >
                          <DownloadIcon />
                          Download
                        </ContextMenuItem>
                        <ContextMenuItem
                          v-if="boxConnected"
                          :disabled="isBoxOversize(entry)"
                          :title="isBoxOversize(entry) ? BOX_OVERSIZE_REASON : 'Send to Box'"
                          @select="!isBoxOversize(entry) && sendToBox(entry.relPath, entry.name, entry.isDir)"
                        >
                          <CloudUploadIcon />
                          {{ isBoxOversize(entry) ? "Send to Box (>48 MB limit)" : "Send to Box" }}
                        </ContextMenuItem>
                        <ContextMenuItem @select="openMoveDialog(entry)">
                          <FolderInputIcon />
                          Rename / Move...
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem variant="destructive" @select="promptDelete(entry)">
                          <Trash2Icon />
                          Delete...
                        </ContextMenuItem>
                      </ContextMenuGroup>
                    </ContextMenuContent>
                  </ContextMenu>
                </div>
              </div>
            </ContextMenuTrigger>

            <!-- EMPTY-SPACE CONTEXT MENU -->
            <ContextMenuContent class="w-48">
              <ContextMenuLabel class="font-mono text-[11px] truncate">
                /{{ currentPath || "workspace" }}
              </ContextMenuLabel>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem @select="triggerUploadPicker">
                  <UploadIcon />
                  Upload Files...
                </ContextMenuItem>
                <ContextMenuItem @select="openNewNoteDialog(currentPath || 'scripts')">
                  <FilePlus2Icon />
                  New Note (.md)...
                </ContextMenuItem>
                <ContextMenuItem @select="openNewFolderDialog(currentPath)">
                  <FolderPlusIcon />
                  New Folder...
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem @select="triggerDownload(zipUrl(currentPath))">
                  <ArchiveIcon />
                  Download Folder ZIP
                </ContextMenuItem>
                <ContextMenuItem @select="manualRefresh">
                  <RefreshCwIcon />
                  Refresh
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
          </ContextMenu>

        <!-- OS STATUS BAR -->
        <div class="shrink-0 border-t border-[#ededed] bg-[#fafafa] px-4 py-1.5 flex items-center justify-between gap-2 font-mono text-[10.5px] text-muted-foreground">
          <span>
            {{ showListSkeleton ? "Loading…" : `${sortedItems.length} item${sortedItems.length === 1 ? "" : "s"}` }}
            <span class="hidden sm:inline"> · {{ stats.fileCount }} files · {{ stats.clipCount }} clips</span>
          </span>
          <span>/{{ currentPath || "workspace" }} · {{ formatBytes(stats.totalBytes) }}</span>
        </div>
      </div>
    </div>

    <!-- SLIDE-OVER SHEET: INLINE PREVIEW & TIER 3 MARKDOWN/TEXT EDITOR -->
    <Sheet v-model:open="previewSheetOpen">
      <SheetContent side="right" class="w-full sm:max-w-xl p-0 gap-0">
        <template v-if="selectedFile">
          <SheetHeader class="border-b border-border px-5 py-4 pr-12">
            <SheetTitle class="font-mono text-sm font-medium truncate">
              {{ selectedFile.name }}
            </SheetTitle>
            <SheetDescription class="font-mono text-[11px] truncate">
              /{{ selectedFile.relPath }} · {{ formatBytes(selectedFile.sizeBytes) }} · {{ formatTime(selectedFile.updatedAt) }}
            </SheetDescription>
          </SheetHeader>

          <div class="flex items-center justify-between gap-2 flex-wrap border-b border-border bg-secondary/40 px-5 py-2.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <Button type="button" size="xs" @click="askOttoAbout(selectedFile)">
                <SparklesIcon data-icon="inline-start" />
                {{ askActionLabel(selectedFile) }}
              </Button>
              <Button
                v-if="selectedFile.editable"
                type="button"
                variant="secondary"
                size="xs"
                @click="editMode = !editMode"
              >
                <EyeIcon v-if="editMode" data-icon="inline-start" />
                <PencilIcon v-else data-icon="inline-start" />
                {{ editMode ? "Preview" : "Edit" }}
              </Button>
              <Button
                v-if="selectedFile.editable && editMode"
                type="button"
                size="xs"
                :disabled="textSaving || !isTextDirty"
                @click="saveTextFile"
              >
                <Spinner v-if="textSaving" data-icon="inline-start" />
                <SaveIcon v-else data-icon="inline-start" />
                {{ textSaving ? "Saving" : isTextDirty ? "Save*" : "Saved" }}
              </Button>
            </div>

            <div class="flex items-center gap-1">
              <Tooltip v-if="boxConnected">
                <TooltipTrigger as-child>
                  <span class="inline-flex">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      aria-label="Send to Box"
                      :disabled="isBoxOversize(selectedFile)"
                      :title="isBoxOversize(selectedFile) ? BOX_OVERSIZE_REASON : 'Send to Box'"
                      @click="!isBoxOversize(selectedFile) && sendToBox(selectedFile.relPath, selectedFile.name, false)"
                    >
                      <CloudUploadIcon />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {{ isBoxOversize(selectedFile) ? BOX_OVERSIZE_REASON : "Send to Box" }}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <a
                    :href="fileUrl(selectedFile.relPath, true)"
                    :class="buttonVariants({ variant: 'secondary', size: 'icon-xs' })"
                    aria-label="Download file"
                  >
                    <DownloadIcon />
                  </a>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    aria-label="Rename or move file"
                    @click="openMoveDialog(selectedFile)"
                  >
                    <FolderInputIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Rename / Move</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="text-destructive hover:text-destructive"
                    aria-label="Delete file"
                    @click="promptDelete(selectedFile)"
                  >
                    <Trash2Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <ScrollArea class="flex-1 min-h-0">
            <div class="p-5 flex flex-col gap-4">
              <div
                v-if="selectedFile.kind === 'image'"
                class="flex flex-col items-center rounded-2xl bg-secondary p-3"
              >
                <img
                  :src="fileUrl(selectedFile.relPath)"
                  :alt="selectedFile.name"
                  class="max-w-full max-h-[65vh] rounded-xl object-contain"
                />
              </div>

              <div
                v-else-if="selectedFile.kind === 'video'"
                class="flex flex-col gap-3 rounded-2xl bg-secondary p-3"
              >
                <video
                  :key="selectedFile.relPath"
                  :src="fileUrl(selectedFile.relPath)"
                  controls
                  preload="metadata"
                  class="w-full max-h-[60vh] rounded-xl bg-primary"
                ></video>
                <div v-if="selectedFile.matchedSrtRelPath" class="flex items-center justify-between gap-2 text-xs font-mono">
                  <span class="text-muted-foreground">Paired captions ready</span>
                  <a
                    :href="fileUrl(selectedFile.matchedSrtRelPath, true)"
                    :class="buttonVariants({ variant: 'secondary', size: 'xs' })"
                  >
                    <CaptionsIcon data-icon="inline-start" />
                    Download .srt
                  </a>
                </div>
              </div>

              <div
                v-else-if="selectedFile.kind === 'audio'"
                class="rounded-2xl bg-secondary p-4"
              >
                <audio :key="selectedFile.relPath" :src="fileUrl(selectedFile.relPath)" controls class="w-full"></audio>
              </div>

              <div v-else-if="selectedFile.kind === 'markdown' || selectedFile.kind === 'text'">
                <WorkspaceFileSkeleton v-if="textLoading" variant="preview" />
                <Textarea
                  v-else-if="editMode"
                  v-model="textContent"
                  spellcheck="false"
                  class="min-h-[58vh] font-mono text-xs leading-relaxed rounded-2xl bg-secondary border-transparent focus-visible:border-ring"
                  @keydown="onEditorKeydown"
                />
                <div
                  v-else-if="selectedFile.kind === 'markdown'"
                  class="md-content fm-md-box rounded-2xl bg-secondary/70 p-4 text-sm"
                  v-html="renderedPreviewHtml"
                ></div>
                <pre
                  v-else
                  class="rounded-2xl bg-secondary/70 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words m-0"
                >{{ textContent }}</pre>
              </div>

              <Empty v-else class="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PackageIcon />
                  </EmptyMedia>
                  <EmptyTitle class="font-mono text-xs">Preview unavailable</EmptyTitle>
                  <EmptyDescription class="text-xs">
                    Download the file directly or send it to Otto for review.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          </ScrollArea>
        </template>
      </SheetContent>
    </Sheet>

    <!-- DIALOG: NEW FOLDER -->
    <Dialog v-model:open="newFolderOpen">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="font-mono text-sm">New Folder</DialogTitle>
          <DialogDescription class="font-mono text-xs">
            Create a folder inside /{{ newFolderTargetDir || "workspace" }}.
          </DialogDescription>
        </DialogHeader>
        <form @submit.prevent="submitNewFolder">
          <FieldGroup>
            <Field :data-invalid="Boolean(newFolderError) || undefined">
              <FieldLabel for="fm-new-folder-name" class="font-mono text-xs">Folder name</FieldLabel>
              <Input
                id="fm-new-folder-name"
                v-model="newFolderName"
                type="text"
                placeholder="e.g. ep12-assets"
                :aria-invalid="Boolean(newFolderError)"
                autofocus
              />
              <FieldError v-if="newFolderError">{{ newFolderError }}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter class="mt-4">
            <Button type="button" variant="secondary" size="sm" :disabled="newFolderSubmitting" @click="newFolderOpen = false">
              Cancel
            </Button>
            <Button type="submit" size="sm" :disabled="newFolderSubmitting">
              <Spinner v-if="newFolderSubmitting" data-icon="inline-start" />
              Create Folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- DIALOG: NEW NOTE -->
    <Dialog v-model:open="newNoteOpen">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="font-mono text-sm">New Note</DialogTitle>
          <DialogDescription class="font-mono text-xs">
            Create an editable Markdown or text file in /{{ newNoteTargetDir || "scripts" }}.
          </DialogDescription>
        </DialogHeader>
        <form @submit.prevent="submitNewNote">
          <FieldGroup>
            <Field :data-invalid="Boolean(newNoteError) || undefined">
              <FieldLabel for="fm-new-note-name" class="font-mono text-xs">Filename</FieldLabel>
              <Input
                id="fm-new-note-name"
                v-model="newNoteName"
                type="text"
                placeholder="e.g. run-of-show.md"
                :aria-invalid="Boolean(newNoteError)"
                autofocus
              />
              <FieldDescription class="font-mono text-[11px]">
                Defaults to .md if no extension is specified.
              </FieldDescription>
              <FieldError v-if="newNoteError">{{ newNoteError }}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter class="mt-4">
            <Button type="button" variant="secondary" size="sm" :disabled="newNoteSubmitting" @click="newNoteOpen = false">
              Cancel
            </Button>
            <Button type="submit" size="sm" :disabled="newNoteSubmitting">
              <Spinner v-if="newNoteSubmitting" data-icon="inline-start" />
              Create &amp; Edit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- DIALOG: RENAME / MOVE -->
    <Dialog :open="Boolean(movingItem)" @update:open="(open) => { if (!open) movingItem = null; }">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="font-mono text-sm">Rename or Move</DialogTitle>
          <DialogDescription class="font-mono text-xs truncate">
            Updating /{{ movingItem?.relPath }}
          </DialogDescription>
        </DialogHeader>
        <form @submit.prevent="submitMove">
          <FieldGroup>
            <Field>
              <FieldLabel class="font-mono text-xs">Destination folder</FieldLabel>
              <Select v-model="moveTargetDir">
                <SelectTrigger class="w-full font-mono text-xs">
                  <SelectValue placeholder="Choose folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="d in dirs"
                      :key="d || '__r'"
                      :value="d || ROOT_SELECT_VALUE"
                      class="font-mono text-xs"
                    >
                      /{{ d || "workspace" }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field :data-invalid="Boolean(moveError) || undefined">
              <FieldLabel for="fm-move-name" class="font-mono text-xs">Name</FieldLabel>
              <Input
                id="fm-move-name"
                v-model="moveTargetName"
                type="text"
                :aria-invalid="Boolean(moveError)"
                class="font-mono text-xs"
              />
              <FieldError v-if="moveError">{{ moveError }}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter class="mt-4">
            <Button type="button" variant="secondary" size="sm" :disabled="moveSubmitting" @click="movingItem = null">
              Cancel
            </Button>
            <Button type="submit" size="sm" :disabled="moveSubmitting">
              <Spinner v-if="moveSubmitting" data-icon="inline-start" />
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- DIALOG: SEND TO BOX HANDOFF -->
    <Dialog :open="boxModalOpen" @update:open="(open) => { if (!boxUploading) boxModalOpen = open; }">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="font-mono text-sm">
            {{ boxUploading ? "Uploading to Box..." : boxError ? "Box Upload Failed" : "Ready in Box" }}
          </DialogTitle>
          <DialogDescription class="font-mono text-xs truncate">
            {{ boxTargetIsDir ? "Folder" : "File" }}: {{ boxTargetName }} → Otto Handoffs
          </DialogDescription>
        </DialogHeader>

        <div v-if="boxUploading" class="flex items-center gap-3 rounded-xl border border-[#ededed] bg-[#fafafa] p-4 font-mono text-xs text-[#303030]">
          <Spinner />
          <span>Uploading {{ boxTargetIsDir ? "folder contents" : "file" }} to Box...</span>
        </div>

        <Alert v-else-if="boxError" variant="destructive">
          <AlertDescription class="font-mono text-xs">{{ boxError }}</AlertDescription>
        </Alert>

        <div v-else-if="boxResult" class="flex flex-col gap-3">
          <div class="font-mono text-xs text-[#166534] rounded-xl bg-[#e6f7ee] px-3 py-2">
            Uploaded {{ boxResult.uploadedCount }} file{{ boxResult.uploadedCount === 1 ? "" : "s" }} to Box.
            <span v-if="boxResult.skipped.length > 0" class="block text-[#854d0e] mt-1">
              Skipped {{ boxResult.skipped.length }} item(s) (over 48 MB or unsupported).
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <Input :model-value="boxResult.url" readonly class="font-mono text-xs flex-1" />
            <Button type="button" size="sm" @click="copyBoxLink">
              <CheckIcon v-if="boxCopied" data-icon="inline-start" />
              <CopyIcon v-else data-icon="inline-start" />
              {{ boxCopied ? "Copied" : "Copy" }}
            </Button>
          </div>

          <p class="font-mono text-[10.5px] leading-relaxed text-[#737373]">
            Tip: share your <strong>Otto Handoffs</strong> folder once in Box with your human editor or artist so every link opens directly.
          </p>
        </div>

        <DialogFooter class="mt-2">
          <a
            v-if="boxResult && !boxUploading"
            :href="boxResult.url"
            target="_blank"
            rel="noopener noreferrer"
            :class="cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'no-underline')"
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Open in Box
          </a>
          <Button type="button" variant="secondary" size="sm" :disabled="boxUploading" @click="boxModalOpen = false">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- ALERT DIALOG: DELETE CONFIRMATION -->
    <AlertDialog :open="Boolean(entryPendingDelete)" @update:open="(open) => { if (!open) entryPendingDelete = null; }">
      <AlertDialogContent class="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle class="font-mono text-sm">
            Delete {{ entryPendingDelete?.isDir ? "folder" : "file" }}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>{{ entryPendingDelete?.name }}</strong>{{
              entryPendingDelete?.isDir ? " and all files inside it" : ""
            }}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleteSubmitting">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" :disabled="deleteSubmitting" @click.prevent="confirmDelete">
            <Spinner v-if="deleteSubmitting" data-icon="inline-start" />
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
</style>
