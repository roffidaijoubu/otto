<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";

export interface WorkspaceEntry {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  kind: "dir" | "image" | "video" | "audio" | "markdown" | "text" | "other";
  editable: boolean;
  previewable: boolean;
  sizeBytes: number;
  updatedAt: string;
  matchedSrtRelPath?: string | null;
}

export interface WorkspaceStats {
  totalBytes: number;
  fileCount: number;
  clipCount: number;
}

const props = defineProps<{
  refreshTick: number;
  initialPath?: string;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  statsUpdated: [payload: { stats: WorkspaceStats; recentFiles: WorkspaceEntry[] }];
}>();

const currentPath = ref(props.initialPath || "");
const breadcrumbs = ref<Array<{ name: string; path: string }>>([{ name: "workspace", path: "" }]);
const items = ref<WorkspaceEntry[]>([]);
const dirs = ref<string[]>([""]);
const stats = ref<WorkspaceStats>({ totalBytes: 0, fileCount: 0, clipCount: 0 });
const searchQuery = ref("");
const loading = ref(false);
const uploading = ref(false);
const dragOver = ref(false);
const statusMsg = ref("");
const errorMsg = ref("");

// Inline folder / note creation
const creatingFolder = ref(false);
const newFolderName = ref("");
const creatingNote = ref(false);
const newNoteName = ref("");

// Rename / Move inline state
const movingItem = ref<WorkspaceEntry | null>(null);
const moveTargetName = ref("");
const moveTargetDir = ref("");

// Preview / Editor state
const selectedFile = ref<WorkspaceEntry | null>(null);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fileIcon(entry: WorkspaceEntry): string {
  if (entry.isDir) return "📁";
  if (entry.kind === "image") return "🖼";
  if (entry.kind === "video") return "🎬";
  if (entry.kind === "audio") return "🎵";
  if (entry.kind === "markdown") return "📝";
  if (entry.kind === "text") return "📄";
  return "📦";
}

function fileUrl(relPath: string, download = false): string {
  const q = new URLSearchParams({ path: relPath });
  if (download) q.set("download", "1");
  return `/api/workspace/file?${q.toString()}`;
}

function zipUrl(relDir: string): string {
  const q = new URLSearchParams({ path: relDir });
  return `/api/workspace/zip?${q.toString()}`;
}

function setFlash(msg: string) {
  statusMsg.value = msg;
  errorMsg.value = "";
  setTimeout(() => {
    if (statusMsg.value === msg) statusMsg.value = "";
  }, 3500);
}

async function loadDirectory(targetPath = currentPath.value) {
  loading.value = true;
  errorMsg.value = "";
  try {
    const q = new URLSearchParams({ path: targetPath });
    if (searchQuery.value.trim()) q.set("q", searchQuery.value.trim());
    const res = await fetch(`/api/workspace/list?${q.toString()}`);
    const data = (await res.json()) as {
      path?: string;
      breadcrumbs?: Array<{ name: string; path: string }>;
      items?: WorkspaceEntry[];
      dirs?: string[];
      stats?: WorkspaceStats;
      recentFiles?: WorkspaceEntry[];
      error?: string;
    };
    if (!res.ok) {
      errorMsg.value = data.error || "Could not load folder";
      return;
    }
    currentPath.value = data.path ?? "";
    breadcrumbs.value = data.breadcrumbs || [{ name: "workspace", path: "" }];
    items.value = data.items || [];
    dirs.value = data.dirs || [""];
    if (data.stats) {
      stats.value = data.stats;
      emit("statsUpdated", {
        stats: data.stats,
        recentFiles: data.recentFiles || [],
      });
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Network error";
  } finally {
    loading.value = false;
  }
}

function navigateTo(relDir: string) {
  searchQuery.value = "";
  movingItem.value = null;
  loadDirectory(relDir);
}

async function openEntry(entry: WorkspaceEntry) {
  if (entry.isDir) {
    navigateTo(entry.relPath);
    return;
  }
  selectedFile.value = entry;
  editMode.value = false;
  if (entry.kind === "markdown" || entry.kind === "text") {
    textLoading.value = true;
    errorMsg.value = "";
    try {
      const res = await fetch(`/api/workspace/text?path=${encodeURIComponent(entry.relPath)}`);
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) {
        errorMsg.value = data.error || "Unable to read file";
        textContent.value = "";
        originalTextContent.value = "";
      } else {
        textContent.value = data.content || "";
        originalTextContent.value = data.content || "";
      }
    } catch {
      errorMsg.value = "Unable to read file";
    } finally {
      textLoading.value = false;
    }
  }
}

async function saveTextFile() {
  if (!selectedFile.value || textSaving.value) return;
  textSaving.value = true;
  errorMsg.value = "";
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
      errorMsg.value = data.error || "Save failed";
      return;
    }
    originalTextContent.value = textContent.value;
    setFlash(`Saved ${selectedFile.value.name}`);
    await loadDirectory();
  } finally {
    textSaving.value = false;
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
    const form = new FormData();
    form.append("dir", currentPath.value || "uploads");
    for (const f of arr) {
      form.append("files", f);
    }
    const res = await fetch("/api/workspace/upload", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as {
      ok?: boolean;
      uploaded?: Array<{ name: string; relPath: string }>;
      error?: string;
    };
    if (!res.ok) {
      errorMsg.value = data.error || "Upload failed";
      return;
    }
    const count = data.uploaded?.length || arr.length;
    setFlash(`Uploaded ${count} file${count === 1 ? "" : "s"} to ${currentPath.value || "uploads"}`);
    if (!currentPath.value) {
      await loadDirectory("uploads");
    } else {
      await loadDirectory();
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Upload error";
  } finally {
    uploading.value = false;
  }
}

function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    uploadFileList(input.files);
    input.value = "";
  }
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    uploadFileList(e.dataTransfer.files);
  }
}

async function submitNewFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  errorMsg.value = "";
  const res = await fetch("/api/workspace/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir: currentPath.value, name }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    errorMsg.value = data.error || "Failed to create folder";
    return;
  }
  newFolderName.value = "";
  creatingFolder.value = false;
  setFlash(`Created folder "${name}"`);
  await loadDirectory();
}

async function submitNewNote() {
  let name = newNoteName.value.trim();
  if (!name) return;
  if (!/\.(md|txt|csv|json|yml)$/i.test(name)) {
    name = `${name}.md`;
  }
  const dir = currentPath.value || "scripts";
  const relPath = dir ? `${dir}/${name}` : name;
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
    errorMsg.value = data.error || "Could not create note";
    return;
  }
  newNoteName.value = "";
  creatingNote.value = false;
  setFlash(`Created ${relPath}`);
  await loadDirectory(dir);
  const created = items.value.find((i) => i.relPath === relPath);
  if (created) {
    await openEntry(created);
    editMode.value = true;
  }
}

function startMove(entry: WorkspaceEntry) {
  movingItem.value = entry;
  moveTargetName.value = entry.name;
  moveTargetDir.value = entry.relPath.includes("/")
    ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/"))
    : "";
}

async function submitMove() {
  if (!movingItem.value) return;
  const name = moveTargetName.value.trim();
  if (!name) return;
  const newPath = moveTargetDir.value ? `${moveTargetDir.value}/${name}` : name;
  const res = await fetch("/api/workspace/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: movingItem.value.relPath, newPath }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    errorMsg.value = data.error || "Rename/Move failed";
    return;
  }
  if (selectedFile.value?.relPath === movingItem.value.relPath) {
    selectedFile.value = null;
  }
  movingItem.value = null;
  setFlash(`Moved to ${newPath}`);
  await loadDirectory();
}

async function deleteEntry(entry: WorkspaceEntry) {
  if (!window.confirm(`Delete "${entry.name}"${entry.isDir ? " and all files inside it" : ""}?`)) {
    return;
  }
  const res = await fetch(`/api/workspace/entry?path=${encodeURIComponent(entry.relPath)}`, {
    method: "DELETE",
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) {
    errorMsg.value = data.error || "Delete failed";
    return;
  }
  if (selectedFile.value?.relPath === entry.relPath) {
    selectedFile.value = null;
  }
  setFlash(`Deleted ${entry.name}`);
  await loadDirectory();
}

function askProfessorAbout(entry: WorkspaceEntry) {
  const hidden = `<hidden>Workspace file absolute path: ${entry.absPath} (relative: ${entry.relPath}, type: ${entry.kind})</hidden>`;
  if (entry.kind === "image") {
    emit(
      "askPrompt",
      `Run the Squint Test on my thumbnail draft "${entry.name}" and give concrete revision notes for my human artist.\n${hidden}`
    );
    return;
  }
  if (entry.kind === "video") {
    emit(
      "askPrompt",
      `Watch my clip "${entry.name}" and critique the first 3-second hook, pacing, dead air, and editor notes.\n${hidden}`
    );
    return;
  }
  emit(
    "askPrompt",
    `Read and review my workspace file "${entry.relPath}" and give me sharp Professor L feedback.\n${hidden}`
  );
}

function askActionLabel(entry: WorkspaceEntry): string {
  if (entry.kind === "image") return "Squint Test";
  if (entry.kind === "video") return "Review Clip";
  return "Ask L";
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  clearTimeout(searchTimer ?? undefined);
  searchTimer = setTimeout(() => {
    loadDirectory();
  }, 220);
}

watch(
  () => props.refreshTick,
  () => {
    loadDirectory();
  },
  { immediate: true }
);

watch(
  () => props.initialPath,
  (next) => {
    if (typeof next === "string" && next !== currentPath.value) {
      navigateTo(next);
    }
  }
);

defineExpose({ loadDirectory, navigateTo });
</script>

<template>
  <div
    class="fm-shell"
    :class="{ 'is-dragover': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave.self="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden"
      @change="onFileInputChange"
    />

    <!-- LEFT SIDEBAR: FOLDER TREE + STORAGE -->
    <aside class="fm-tree cafe-card">
      <div class="fm-tree-head">
        <div class="fm-tree-title">Studio Folders</div>
        <div class="fm-storage-pill">{{ formatBytes(stats.totalBytes) }}</div>
      </div>

      <div class="fm-tree-list">
        <button
          v-for="d in dirs"
          :key="d || '__root__'"
          type="button"
          class="fm-dir-btn"
          :class="{ active: currentPath === d && !searchQuery.trim() }"
          :style="{ paddingLeft: d ? `${10 + (d.split('/').length - 1) * 12}px` : '10px' }"
          @click="navigateTo(d)"
        >
          <span>{{ d === "clips" ? "🎬" : d === "thumbnails" ? "🖼" : d === "scripts" ? "📝" : d === "briefs" ? "📋" : "📁" }}</span>
          <span class="truncate">{{ d ? d.split("/").pop() : "workspace (all)" }}</span>
        </button>
      </div>

      <div class="fm-tree-foot">
        <div>{{ stats.fileCount }} files · {{ stats.clipCount }} clips</div>
        <a :href="zipUrl(currentPath)" class="btn btn-xs btn-cafe-secondary w-full mt-2 no-underline">
          Download Folder ZIP ↓
        </a>
      </div>
    </aside>

    <!-- RIGHT MAIN: TOOLBAR + FILE LIST + INLINE PREVIEW/EDITOR -->
    <div class="fm-main">
      <!-- TOOLBAR -->
      <div class="cafe-card fm-toolbar">
        <div class="fm-breadcrumbs">
          <template v-for="(bc, idx) in breadcrumbs" :key="bc.path || 'root'">
            <span v-if="idx > 0" class="opacity-40">/</span>
            <button type="button" class="fm-bc-btn" @click="navigateTo(bc.path)">
              {{ bc.name }}
            </button>
          </template>
        </div>

        <div class="fm-actions">
          <input
            v-model="searchQuery"
            type="text"
            class="fm-search"
            placeholder="Search files..."
            @input="onSearchInput"
          />
          <button
            type="button"
            class="btn btn-xs btn-cafe-primary"
            :disabled="uploading"
            @click="triggerUploadPicker"
          >
            {{ uploading ? "Uploading..." : "+ Upload" }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-cafe-secondary"
            @click="creatingNote = !creatingNote; creatingFolder = false"
          >
            + Note
          </button>
          <button
            type="button"
            class="btn btn-xs btn-cafe-secondary"
            @click="creatingFolder = !creatingFolder; creatingNote = false"
          >
            + Folder
          </button>
        </div>
      </div>

      <!-- INLINE CREATE FOLDER / NOTE BARS -->
      <form v-if="creatingFolder" class="cafe-card fm-inline-form" @submit.prevent="submitNewFolder">
        <span class="text-xs font-medium">New folder in /{{ currentPath || "workspace" }}:</span>
        <input
          v-model="newFolderName"
          type="text"
          class="fm-inline-input"
          placeholder="e.g. ep12-assets"
          autofocus
        />
        <button type="submit" class="btn btn-xs btn-cafe-primary">Create</button>
        <button type="button" class="btn btn-xs btn-ghost" @click="creatingFolder = false">Cancel</button>
      </form>

      <form v-if="creatingNote" class="cafe-card fm-inline-form" @submit.prevent="submitNewNote">
        <span class="text-xs font-medium">New Markdown note in /{{ currentPath || "scripts" }}:</span>
        <input
          v-model="newNoteName"
          type="text"
          class="fm-inline-input"
          placeholder="e.g. run-of-show.md"
          autofocus
        />
        <button type="submit" class="btn btn-xs btn-cafe-primary">Create &amp; Edit</button>
        <button type="button" class="btn btn-xs btn-ghost" @click="creatingNote = false">Cancel</button>
      </form>

      <!-- INLINE RENAME / MOVE BAR -->
      <form v-if="movingItem" class="cafe-card fm-inline-form" @submit.prevent="submitMove">
        <span class="text-xs font-medium">Move/Rename:</span>
        <select v-model="moveTargetDir" class="fm-inline-select">
          <option v-for="d in dirs" :key="d || '__r'" :value="d">
            /{{ d || "workspace" }}
          </option>
        </select>
        <input v-model="moveTargetName" type="text" class="fm-inline-input" />
        <button type="submit" class="btn btn-xs btn-cafe-primary">Apply</button>
        <button type="button" class="btn btn-xs btn-ghost" @click="movingItem = null">Cancel</button>
      </form>

      <!-- STATUS / ERROR BANNERS -->
      <div v-if="statusMsg" class="fm-banner fm-banner-ok">{{ statusMsg }}</div>
      <div v-if="errorMsg" class="fm-banner fm-banner-err">{{ errorMsg }}</div>

      <!-- DROPZONE HINT + FILE LIST -->
      <div class="cafe-card fm-list-card">
        <div v-if="dragOver" class="fm-drop-overlay">
          Drop files here to upload into <strong>/{{ currentPath || "uploads" }}</strong>
        </div>

        <div v-if="loading && items.length === 0" class="fm-empty">Loading workspace...</div>

        <div v-else-if="items.length === 0" class="fm-empty">
          <p class="mb-2">
            {{
              searchQuery.trim()
                ? `No files match "${searchQuery.trim()}".`
                : `This folder is empty. Drag & drop files anywhere here, click "+ Upload", or ask Professor L to write a brief or cut a VOD clip.`
            }}
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <button type="button" class="btn btn-xs btn-cafe-primary" @click="triggerUploadPicker">
              Upload Files
            </button>
            <button
              v-if="currentPath === 'clips' || !currentPath"
              type="button"
              class="btn btn-xs btn-cafe-secondary"
              @click="emit('askPrompt', 'Scan my latest YouTube VOD for hype moments and cut the top raw clips (.mp4 + .srt) into my workspace clips folder.')"
            >
              Scan a VOD for Clips
            </button>
          </div>
        </div>

        <div v-else class="fm-rows">
          <div
            v-for="entry in items"
            :key="entry.relPath"
            class="fm-row"
            :class="{ selected: selectedFile?.relPath === entry.relPath }"
          >
            <button type="button" class="fm-row-main" @click="openEntry(entry)">
              <span class="fm-icon">{{ fileIcon(entry) }}</span>
              <div class="fm-meta">
                <div class="fm-name">{{ entry.name }}</div>
                <div class="fm-sub">
                  <span v-if="searchQuery.trim()">/{{ entry.relPath }} · </span>
                  <span v-if="!entry.isDir">{{ formatBytes(entry.sizeBytes) }} · </span>
                  <span>{{ formatTime(entry.updatedAt) }}</span>
                </div>
              </div>
            </button>

            <div class="fm-row-actions">
              <template v-if="!entry.isDir">
                <button
                  type="button"
                  class="btn btn-xs btn-cafe-primary"
                  @click="askProfessorAbout(entry)"
                >
                  {{ askActionLabel(entry) }}
                </button>
                <a
                  v-if="entry.matchedSrtRelPath"
                  :href="fileUrl(entry.matchedSrtRelPath, true)"
                  class="btn btn-xs btn-cafe-secondary no-underline"
                  title="Download paired .srt captions"
                >
                  .srt ↓
                </a>
                <a
                  :href="fileUrl(entry.relPath, true)"
                  class="btn btn-xs btn-cafe-secondary no-underline"
                  title="Download file"
                >
                  ↓
                </a>
              </template>
              <template v-else>
                <a
                  :href="zipUrl(entry.relPath)"
                  class="btn btn-xs btn-cafe-secondary no-underline"
                  title="Download folder as ZIP"
                >
                  ZIP ↓
                </a>
              </template>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                title="Rename or Move"
                @click="startMove(entry)"
              >
                Move
              </button>
              <button
                type="button"
                class="btn btn-xs btn-ghost text-error"
                title="Delete"
                @click="deleteEntry(entry)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- INLINE PREVIEW & TIER 3 MARKDOWN/TEXT EDITOR -->
      <div v-if="selectedFile" class="cafe-card fm-preview">
        <div class="fm-preview-head">
          <div class="min-w-0">
            <div class="font-medium text-sm truncate">
              {{ fileIcon(selectedFile) }} {{ selectedFile.relPath }}
            </div>
            <div class="text-[11px] font-mono opacity-65">
              {{ formatBytes(selectedFile.sizeBytes) }} · {{ formatTime(selectedFile.updatedAt) }}
            </div>
          </div>

          <div class="flex items-center gap-1.5 flex-wrap shrink-0">
            <button
              type="button"
              class="btn btn-xs btn-cafe-primary"
              @click="askProfessorAbout(selectedFile)"
            >
              {{ askActionLabel(selectedFile) }}
            </button>
            <button
              v-if="selectedFile.editable"
              type="button"
              class="btn btn-xs btn-cafe-secondary"
              @click="editMode = !editMode"
            >
              {{ editMode ? "Preview" : "Edit" }}
            </button>
            <button
              v-if="selectedFile.editable && editMode"
              type="button"
              class="btn btn-xs btn-cafe-primary"
              :disabled="textSaving || !isTextDirty"
              @click="saveTextFile"
            >
              {{ textSaving ? "Saving..." : isTextDirty ? "Save*" : "Saved" }}
            </button>
            <a
              :href="fileUrl(selectedFile.relPath, true)"
              class="btn btn-xs btn-cafe-secondary no-underline"
            >
              Download ↓
            </a>
            <button type="button" class="btn btn-xs btn-ghost" @click="selectedFile = null">✕</button>
          </div>
        </div>

        <!-- IMAGE PREVIEW -->
        <div v-if="selectedFile.kind === 'image'" class="fm-media-box">
          <img
            :src="fileUrl(selectedFile.relPath)"
            :alt="selectedFile.name"
            class="fm-img-preview"
          />
        </div>

        <!-- VIDEO PREVIEW -->
        <div v-else-if="selectedFile.kind === 'video'" class="fm-media-box">
          <video
            :key="selectedFile.relPath"
            :src="fileUrl(selectedFile.relPath)"
            controls
            preload="metadata"
            class="fm-video-preview"
          ></video>
          <div v-if="selectedFile.matchedSrtRelPath" class="mt-2 flex items-center gap-2 text-xs">
            <span class="opacity-70">Paired subtitles ready for human editor:</span>
            <a
              :href="fileUrl(selectedFile.matchedSrtRelPath, true)"
              class="btn btn-xs btn-cafe-secondary no-underline"
            >
              Download .srt ↓
            </a>
          </div>
        </div>

        <!-- AUDIO PREVIEW -->
        <div v-else-if="selectedFile.kind === 'audio'" class="fm-media-box">
          <audio
            :key="selectedFile.relPath"
            :src="fileUrl(selectedFile.relPath)"
            controls
            class="w-full"
          ></audio>
        </div>

        <!-- MARKDOWN / TEXT PREVIEW + INLINE EDITOR -->
        <div v-else-if="selectedFile.kind === 'markdown' || selectedFile.kind === 'text'">
          <div v-if="textLoading" class="text-xs opacity-65 py-4">Loading file contents...</div>
          <textarea
            v-else-if="editMode"
            v-model="textContent"
            class="fm-editor"
            spellcheck="false"
          ></textarea>
          <div
            v-else-if="selectedFile.kind === 'markdown'"
            class="md-body fm-md-box"
            v-html="renderedPreviewHtml"
          ></div>
          <pre v-else class="fm-code-box">{{ textContent }}</pre>
        </div>

        <!-- BINARY FALLBACK -->
        <div v-else class="text-xs opacity-75 py-3">
          Preview unavailable for this file type. Use <strong>Download ↓</strong> or send it to Professor L.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cafe-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-raised);
}
.fm-shell {
  display: grid;
  grid-template-columns: 205px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.fm-shell.is-dragover {
  outline: 2px dashed var(--accent);
  outline-offset: 4px;
  border-radius: 16px;
}
.fm-tree {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fm-tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.fm-tree-title {
  font-family: var(--font-serif);
  font-size: 15px;
}
.fm-storage-pill {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 9999px;
  background: var(--surface-inset);
  color: var(--fg-muted);
}
.fm-tree-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 320px;
  overflow-y: auto;
}
.fm-dir-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.fm-dir-btn:hover {
  background: var(--surface-inset);
  color: var(--fg);
}
.fm-dir-btn.active {
  background: var(--accent);
  color: #ffffff;
}
.fm-tree-foot {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}

.fm-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.fm-toolbar {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.fm-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-family: var(--font-mono);
}
.fm-bc-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 6px;
}
.fm-bc-btn:hover {
  background: var(--surface-inset);
}
.fm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fm-search {
  width: 155px;
  padding: 5px 10px;
  border: none;
  border-radius: 9999px;
  background: var(--surface-inset);
  box-shadow: var(--shadow-inset);
  color: var(--fg);
  font-size: 12px;
  outline: none;
}
.fm-inline-form {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fm-inline-input,
.fm-inline-select {
  padding: 5px 10px;
  border: none;
  border-radius: 8px;
  background: var(--surface-inset);
  box-shadow: var(--shadow-inset);
  color: var(--fg);
  font-size: 12.5px;
  outline: none;
}
.fm-inline-input {
  flex: 1;
  min-width: 140px;
}
.fm-banner {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  font-family: var(--font-mono);
}
.fm-banner-ok {
  background: rgba(16, 185, 129, 0.14);
  color: #065f46;
}
.fm-banner-err {
  background: rgba(239, 68, 68, 0.12);
  color: var(--error);
}

.fm-list-card {
  position: relative;
  padding: 10px;
  min-height: 180px;
}
.fm-drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 10;
  border-radius: 12px;
  background: rgba(253, 246, 236, 0.94);
  border: 2px dashed var(--accent);
  display: grid;
  place-items: center;
  font-size: 13.5px;
  color: var(--fg);
}
.fm-empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--fg-muted);
}
.fm-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--bg);
  transition: background var(--duration-fast) var(--ease-out);
  flex-wrap: wrap;
}
.fm-row:hover {
  background: var(--surface-inset);
}
.fm-row.selected {
  background: var(--surface-inset);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.fm-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 180px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.fm-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.fm-meta {
  min-width: 0;
}
.fm-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  word-break: break-word;
}
.fm-sub {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}
.fm-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.fm-preview {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fm-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.fm-media-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg);
  padding: 12px;
  border-radius: 12px;
}
.fm-img-preview {
  max-width: 100%;
  max-height: 380px;
  border-radius: 10px;
  object-fit: contain;
}
.fm-video-preview {
  width: 100%;
  max-height: 380px;
  border-radius: 10px;
  background: #1a110e;
}
.fm-editor {
  width: 100%;
  min-height: 280px;
  padding: 12px;
  border: none;
  border-radius: 12px;
  background: var(--surface-inset);
  box-shadow: var(--shadow-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.fm-md-box {
  max-height: 360px;
  overflow-y: auto;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
}
.fm-code-box {
  max-height: 340px;
  overflow: auto;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

@media (max-width: 820px) {
  .fm-shell {
    grid-template-columns: 1fr;
  }
}
</style>
