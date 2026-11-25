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

const creatingFolder = ref(false);
const newFolderName = ref("");
const creatingNote = ref(false);
const newNoteName = ref("");

const movingItem = ref<WorkspaceEntry | null>(null);
const moveTargetName = ref("");
const moveTargetDir = ref("");

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
    for (const f of arr) form.append("files", f);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
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
    setFlash(`Uploaded ${count} file${count === 1 ? "" : "s"} to /${currentPath.value || "uploads"}`);
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
  setFlash(`Moved to /${newPath}`);
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

function askOttoAbout(entry: WorkspaceEntry) {
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
    `Read and review my workspace file "${entry.relPath}" and give me sharp Otto feedback.\n${hidden}`
  );
}

function askActionLabel(entry: WorkspaceEntry): string {
  if (entry.kind === "image") return "Squint Test";
  if (entry.kind === "video") return "Review Clip";
  return "Ask Otto";
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
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFileInputChange" />

    <!-- LEFT SIDEBAR: (Y)our folders. -->
    <aside class="otto-card fm-tree">
      <div class="otto-card-head">
        <span>(Y)our folders.</span>
        <div class="otto-card-head-right">
          <span class="text-[10px] font-mono text-[var(--fg-muted)]">{{ formatBytes(stats.totalBytes) }}</span>
        </div>
      </div>

      <div class="fm-tree-body">
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
          <a :href="zipUrl(currentPath)" class="btn btn-xs btn-otto-secondary w-full mt-2 no-underline">
            Download ZIP ↓
          </a>
        </div>
      </div>
    </aside>

    <!-- RIGHT MAIN: (Y)our files. + Preview/Editor -->
    <div class="fm-main">
      <div class="otto-card">
        <div class="otto-card-head">(Y)our files.</div>
        <div class="otto-card-body">
          <div class="fm-toolbar">
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
                class="btn btn-xs btn-otto-primary"
                :disabled="uploading"
                @click="triggerUploadPicker"
              >
                {{ uploading ? "Uploading..." : "+ Upload" }}
              </button>
              <button
                type="button"
                class="btn btn-xs btn-otto-secondary"
                @click="creatingNote = !creatingNote; creatingFolder = false"
              >
                + Note
              </button>
              <button
                type="button"
                class="btn btn-xs btn-otto-secondary"
                @click="creatingFolder = !creatingFolder; creatingNote = false"
              >
                + Folder
              </button>
            </div>
          </div>

          <form v-if="creatingFolder" class="fm-inline-form" @submit.prevent="submitNewFolder">
            <span class="text-xs font-mono">New folder in /{{ currentPath || "workspace" }}:</span>
            <input v-model="newFolderName" type="text" class="fm-inline-input" placeholder="e.g. ep12-assets" autofocus />
            <button type="submit" class="btn btn-xs btn-otto-primary">Create</button>
            <button type="button" class="btn btn-xs btn-otto-secondary" @click="creatingFolder = false">Cancel</button>
          </form>

          <form v-if="creatingNote" class="fm-inline-form" @submit.prevent="submitNewNote">
            <span class="text-xs font-mono">New note in /{{ currentPath || "scripts" }}:</span>
            <input v-model="newNoteName" type="text" class="fm-inline-input" placeholder="e.g. run-of-show.md" autofocus />
            <button type="submit" class="btn btn-xs btn-otto-primary">Create &amp; Edit</button>
            <button type="button" class="btn btn-xs btn-otto-secondary" @click="creatingNote = false">Cancel</button>
          </form>

          <form v-if="movingItem" class="fm-inline-form" @submit.prevent="submitMove">
            <span class="text-xs font-mono">Move/Rename:</span>
            <select v-model="moveTargetDir" class="fm-inline-select">
              <option v-for="d in dirs" :key="d || '__r'" :value="d">/{{ d || "workspace" }}</option>
            </select>
            <input v-model="moveTargetName" type="text" class="fm-inline-input" />
            <button type="submit" class="btn btn-xs btn-otto-primary">Apply</button>
            <button type="button" class="btn btn-xs btn-otto-secondary" @click="movingItem = null">Cancel</button>
          </form>

          <div v-if="statusMsg" class="fm-banner fm-banner-ok">{{ statusMsg }}</div>
          <div v-if="errorMsg" class="fm-banner fm-banner-err">{{ errorMsg }}</div>

          <div class="fm-list-wrap">
            <div v-if="dragOver" class="fm-drop-overlay">
              Drop files to upload into <strong>/{{ currentPath || "uploads" }}</strong>
            </div>

            <div v-if="loading && items.length === 0" class="fm-empty">Loading workspace...</div>

            <div v-else-if="items.length === 0" class="fm-empty">
              <p class="mb-3">
                {{
                  searchQuery.trim()
                    ? `No files match "${searchQuery.trim()}".`
                    : `This folder is empty. Drag & drop files here, click "+ Upload", or ask Otto to write a brief or cut a VOD clip.`
                }}
              </p>
              <div class="flex flex-wrap justify-center gap-2">
                <button type="button" class="btn btn-xs btn-otto-primary" @click="triggerUploadPicker">
                  Upload Files
                </button>
                <button
                  v-if="currentPath === 'clips' || !currentPath"
                  type="button"
                  class="btn btn-xs btn-otto-secondary"
                  @click="emit('askPrompt', 'Scan my latest YouTube VOD for hype moments and cut the top raw clips (.mp4 + .srt) into my workspace clips folder.')"
                >
                  Scan VOD for Clips
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
                    <button type="button" class="btn btn-xs btn-otto-primary" @click="askOttoAbout(entry)">
                      {{ askActionLabel(entry) }}
                    </button>
                    <a
                      v-if="entry.matchedSrtRelPath"
                      :href="fileUrl(entry.matchedSrtRelPath, true)"
                      class="btn btn-xs btn-otto-secondary no-underline"
                      title="Download paired .srt captions"
                    >
                      .srt ↓
                    </a>
                    <a
                      :href="fileUrl(entry.relPath, true)"
                      class="btn btn-xs btn-otto-secondary no-underline"
                      title="Download file"
                    >
                      ↓
                    </a>
                  </template>
                  <template v-else>
                    <a :href="zipUrl(entry.relPath)" class="btn btn-xs btn-otto-secondary no-underline">
                      ZIP ↓
                    </a>
                  </template>
                  <button type="button" class="btn btn-xs btn-otto-secondary" @click="startMove(entry)">
                    Move
                  </button>
                  <button type="button" class="btn btn-xs btn-ghost text-error" @click="deleteEntry(entry)">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- INLINE PREVIEW & TIER 3 MARKDOWN/TEXT EDITOR -->
      <div v-if="selectedFile" class="otto-card">
        <div class="otto-card-head">
          <span>(Y)our preview · {{ selectedFile.name }}.</span>
          <div class="otto-card-head-right">
            <button type="button" class="btn btn-xs btn-ghost" @click="selectedFile = null">✕</button>
          </div>
        </div>

        <div class="otto-card-body">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-[11px] font-mono text-[var(--fg-muted)]">
              /{{ selectedFile.relPath }} · {{ formatBytes(selectedFile.sizeBytes) }} · {{ formatTime(selectedFile.updatedAt) }}
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <button type="button" class="btn btn-xs btn-otto-primary" @click="askOttoAbout(selectedFile)">
                {{ askActionLabel(selectedFile) }}
              </button>
              <button
                v-if="selectedFile.editable"
                type="button"
                class="btn btn-xs btn-otto-secondary"
                @click="editMode = !editMode"
              >
                {{ editMode ? "Preview" : "Edit" }}
              </button>
              <button
                v-if="selectedFile.editable && editMode"
                type="button"
                class="btn btn-xs btn-otto-primary"
                :disabled="textSaving || !isTextDirty"
                @click="saveTextFile"
              >
                {{ textSaving ? "Saving..." : isTextDirty ? "Save*" : "Saved" }}
              </button>
              <a :href="fileUrl(selectedFile.relPath, true)" class="btn btn-xs btn-otto-secondary no-underline">
                Download ↓
              </a>
            </div>
          </div>

          <div v-if="selectedFile.kind === 'image'" class="fm-media-box">
            <img :src="fileUrl(selectedFile.relPath)" :alt="selectedFile.name" class="fm-img-preview" />
          </div>

          <div v-else-if="selectedFile.kind === 'video'" class="fm-media-box">
            <video
              :key="selectedFile.relPath"
              :src="fileUrl(selectedFile.relPath)"
              controls
              preload="metadata"
              class="fm-video-preview"
            ></video>
            <div v-if="selectedFile.matchedSrtRelPath" class="mt-2 flex items-center gap-2 text-xs font-mono">
              <span class="text-[var(--fg-muted)]">Paired captions:</span>
              <a :href="fileUrl(selectedFile.matchedSrtRelPath, true)" class="btn btn-xs btn-otto-secondary no-underline">
                Download .srt ↓
              </a>
            </div>
          </div>

          <div v-else-if="selectedFile.kind === 'audio'" class="fm-media-box">
            <audio :key="selectedFile.relPath" :src="fileUrl(selectedFile.relPath)" controls class="w-full"></audio>
          </div>

          <div v-else-if="selectedFile.kind === 'markdown' || selectedFile.kind === 'text'">
            <div v-if="textLoading" class="text-xs font-mono text-[var(--fg-muted)] py-4">Loading...</div>
            <textarea v-else-if="editMode" v-model="textContent" class="fm-editor" spellcheck="false"></textarea>
            <div v-else-if="selectedFile.kind === 'markdown'" class="md-content fm-md-box" v-html="renderedPreviewHtml"></div>
            <pre v-else class="fm-code-box">{{ textContent }}</pre>
          </div>

          <div v-else class="text-xs font-mono text-[var(--fg-muted)] py-2">
            Preview unavailable. Use Download ↓ or send to Otto.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fm-shell {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.fm-shell.is-dragover {
  outline: 2px dashed var(--fg);
  outline-offset: 4px;
  border-radius: var(--radius-card);
}
.fm-tree-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fm-tree-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 330px;
  overflow-y: auto;
}
.fm-dir-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
}
.fm-dir-btn:hover {
  background: var(--surface-alt);
  color: var(--fg);
}
.fm-dir-btn.active {
  background: var(--fg);
  color: #ffffff;
}
.fm-tree-foot {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}

.fm-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.fm-toolbar {
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
  font-family: var(--font-mono);
  font-size: 12px;
}
.fm-bc-btn {
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: inherit;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.fm-bc-btn:hover {
  background: var(--highlight-yellow);
}
.fm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fm-search {
  width: 155px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11.5px;
  outline: none;
}
.fm-search:focus {
  box-shadow: var(--shadow-focus);
}
.fm-inline-form {
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--surface-alt);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fm-inline-input,
.fm-inline-select {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}
.fm-inline-input {
  flex: 1;
  min-width: 140px;
}
.fm-banner {
  padding: 8px 12px;
  border-radius: 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.fm-banner-ok {
  background: var(--success-bg);
  color: var(--success);
}
.fm-banner-err {
  background: var(--error-bg);
  color: var(--error);
}
.fm-list-wrap {
  position: relative;
  min-height: 160px;
}
.fm-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  border-radius: 14px;
  background: rgba(249, 245, 162, 0.92);
  border: 2px dashed var(--fg);
  display: grid;
  place-items: center;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--fg);
}
.fm-empty {
  padding: 28px 16px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--surface-alt);
  border-radius: 14px;
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
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--surface-alt);
  flex-wrap: wrap;
}
.fm-row:hover {
  background: var(--surface-inset-hover);
}
.fm-row.selected {
  background: var(--highlight-yellow);
}
.fm-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 170px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.fm-icon {
  font-size: 17px;
  flex-shrink: 0;
}
.fm-meta {
  min-width: 0;
}
.fm-name {
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg);
  word-break: break-word;
}
.fm-sub {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}
.fm-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.fm-media-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--surface-alt);
  padding: 12px;
  border-radius: var(--radius-media);
}
.fm-img-preview {
  max-width: 100%;
  max-height: 360px;
  border-radius: var(--radius-media);
  object-fit: contain;
}
.fm-video-preview {
  width: 100%;
  max-height: 360px;
  border-radius: var(--radius-media);
  background: #141414;
}
.fm-editor {
  width: 100%;
  min-height: 260px;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.fm-editor:focus {
  box-shadow: var(--shadow-focus);
}
.fm-md-box {
  max-height: 350px;
  overflow-y: auto;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-alt);
}
.fm-code-box {
  max-height: 340px;
  overflow: auto;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-alt);
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
