<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Box,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Search,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { playSound } from "@/lib/sounds";

interface ClipJobLogEntry {
  at: string;
  stage: string;
  message: string;
}

interface ClipJob {
  id: string;
  vodUrl: string;
  videoId: string;
  title: string;
  maxClips: number;
  focusNotes: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string;
  progressLog: ClipJobLogEntry[];
  error: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface ClipRecord {
  id: string;
  jobId: string | null;
  videoId: string;
  title: string;
  filePath: string;
  srtPath: string;
  startSec: number | null;
  endSec: number | null;
  durationSec: number | null;
  hookScore: number | null;
  editorNotes: string;
  youtubeUrl: string;
  boxUrl: string;
  status: "ready" | "sent_to_box" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface UntrackedClipFile {
  videoId: string;
  name: string;
  filename: string;
  relPath: string;
  mp4Url: string;
  srtUrl: string | null;
  sizeBytes: number;
  updatedAt: string;
}

const props = defineProps<{
  refreshTick: number;
}>();

const loading = ref(false);
const launching = ref(false);
const jobs = ref<ClipJob[]>([]);
const records = ref<ClipRecord[]>([]);
const untrackedFiles = ref<UntrackedClipFile[]>([]);
const boxUploadingId = ref<string | null>(null);
const copiedBoxId = ref<string | null>(null);
const expandedJobId = ref<string | null>(null);
const previewClip = ref<ClipRecord | null>(null);

const viewMode = ref<"list" | "grid">("list");
const searchQuery = ref("");
const showAdvanced = ref(false);

const vodUrl = ref("");
const vodTitle = ref("");
const maxClipsStr = ref("0");
const focusNotes = ref("");

const activeJobs = computed(() =>
  jobs.value.filter((j) => j.status === "running" || j.status === "queued")
);

const recentFinishedJobs = computed(() =>
  jobs.value.filter((j) => j.status === "failed" || j.status === "cancelled" || j.status === "done")
);

const filteredRecords = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return records.value;
  return records.value.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.editorNotes.toLowerCase().includes(q) ||
      c.videoId.toLowerCase().includes(q)
  );
});

const filteredUntracked = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return untrackedFiles.value;
  return untrackedFiles.value.filter(
    (f) => f.name.toLowerCase().includes(q) || f.videoId.toLowerCase().includes(q)
  );
});

const totalClipsCount = computed(() => records.value.length + untrackedFiles.value.length);

function formatSec(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "";
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function clipMediaUrl(filePath: string): string {
  return `/api/workspace/file?path=${encodeURIComponent(filePath)}`;
}

function youtubeThumb(videoId: string): string {
  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg` : "";
}

function jobProgressPercent(job: ClipJob): number {
  if (job.status === "done") return 100;
  if (job.status === "queued") return 8;
  const s = (job.stage || "").toLowerCase();
  if (s.includes("start")) return 12;
  if (s.includes("scan")) return 28;
  if (s.includes("cut")) return 55;
  if (s.includes("norm") || s.includes("prep")) return 72;
  if (s.includes("review")) return 88;
  return 40;
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) {
      vodUrl.value = text.trim();
    }
  } catch {
    toast.error("Clipboard access blocked — paste with Ctrl+V / Cmd+V.");
  }
}

const prevJobStatus = new Map<string, ClipJob["status"]>();

async function loadEcosystem(silent = false) {
  if (!silent) loading.value = true;
  try {
    const res = await fetch("/api/clips/ecosystem");
    if (!res.ok) throw new Error(`Failed to load clips (${res.status})`);
    const data = (await res.json()) as {
      jobs?: ClipJob[];
      records?: ClipRecord[];
      untrackedFiles?: UntrackedClipFile[];
    };
    const nextJobs = data.jobs ?? [];
    if (prevJobStatus.size > 0) {
      let playedDone = false;
      let playedErr = false;
      for (const job of nextJobs) {
        const before = prevJobStatus.get(job.id);
        if (before === "queued" || before === "running") {
          if (job.status === "done" && !playedDone) {
            playSound("job_complete");
            playedDone = true;
          } else if (job.status === "failed" && !playedErr) {
            playSound("error");
            playedErr = true;
          }
        }
      }
    }
    prevJobStatus.clear();
    for (const job of nextJobs) {
      prevJobStatus.set(job.id, job.status);
    }
    jobs.value = nextJobs;
    records.value = data.records ?? [];
    untrackedFiles.value = data.untrackedFiles ?? [];
  } catch (err) {
    if (!silent) {
      toast.error(err instanceof Error ? err.message : "Failed to load Clips");
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

async function launchJob() {
  const url = vodUrl.value.trim();
  if (!url) {
    toast.error("Paste a YouTube VOD URL or 11-character video ID first.");
    return;
  }
  launching.value = true;
  try {
    const maxClips = Number(maxClipsStr.value) || 0;
    const res = await fetch("/api/clips/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vodUrl: url,
        title: vodTitle.value.trim() || undefined,
        maxClips,
        focusNotes: focusNotes.value.trim() || undefined,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; job?: ClipJob; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Failed to start clip job (${res.status})`);
    }
    vodUrl.value = "";
    vodTitle.value = "";
    focusNotes.value = "";
    showAdvanced.value = false;
    toast.success("Background clipper started — main Otto Chat stays free.");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not start clip job");
    playSound("error");
  } finally {
    launching.value = false;
  }
}

async function cancelJob(id: string) {
  try {
    const res = await fetch(`/api/clips/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to cancel job");
    toast.message("Background clip job stopped.");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to cancel job");
  }
}

async function removeJob(id: string) {
  try {
    const res = await fetch(`/api/clips/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) playSound("delete");
    if (expandedJobId.value === id) expandedJobId.value = null;
    await loadEcosystem(true);
  } catch {
    toast.error("Failed to remove job");
    playSound("error");
  }
}

async function sendClipToBox(rec: ClipRecord) {
  boxUploadingId.value = rec.id;
  try {
    const res = await fetch(`/api/clips/records/${encodeURIComponent(rec.id)}/box`, {
      method: "POST",
    });
    const data = (await res.json()) as { ok?: boolean; boxUrl?: string; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Box upload failed");
    }
    playSound("job_complete");
    toast.success("Clip uploaded to Box (Otto Handoffs/)!");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Box upload failed");
    playSound("error");
  } finally {
    boxUploadingId.value = null;
  }
}

async function copyBoxUrl(id: string, url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copiedBoxId.value = id;
    toast.success("Box link copied");
    setTimeout(() => {
      if (copiedBoxId.value === id) copiedBoxId.value = null;
    }, 2000);
  } catch {
    toast.error("Could not copy link");
  }
}

async function removeClipRecord(id: string) {
  try {
    const res = await fetch(`/api/clips/records/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) playSound("delete");
    if (previewClip.value?.id === id) previewClip.value = null;
    await loadEcosystem(true);
  } catch {
    toast.error("Failed to remove clip record");
    playSound("error");
  }
}

watch(
  () => props.refreshTick,
  () => {
    void loadEcosystem(true);
  }
);

onMounted(() => {
  void loadEcosystem(false);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white text-[#171717]">
    <!-- Row 1: Stacher-Style Full-Width Command / URL Omnibar -->
    <div class="shrink-0 border-b border-black/8 bg-[#FAF9F6] px-4 py-3">
      <form
        class="flex items-center gap-2 rounded-xl border border-black/12 bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-black/30"
        @submit.prevent="launchJob"
      >
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          title="Paste URL from clipboard"
          @click="pasteFromClipboard"
        >
          <ClipboardPaste class="size-4" aria-hidden="true" />
        </button>

        <input
          v-model="vodUrl"
          type="text"
          placeholder="Paste a YouTube VOD URL and press Enter to clip it in the background..."
          class="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-[#171717] placeholder:text-neutral-400 focus:outline-none"
          :disabled="launching"
        />

        <!-- Inline Options Toggle (Optional Label & Focus Notes) -->
        <button
          type="button"
          class="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors"
          :class="
            showAdvanced || vodTitle || focusNotes
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
          "
          title="Optional VOD label & focus prompt"
          @click="showAdvanced = !showAdvanced"
        >
          <SlidersHorizontal class="size-3.5" aria-hidden="true" />
          <span class="hidden sm:inline">Focus</span>
        </button>

        <!-- Inline Mode/Cap Selector (like Stacher's format pill) -->
        <Select v-model="maxClipsStr" :disabled="launching">
          <SelectTrigger class="h-7 w-auto gap-1.5 rounded-lg border-0 bg-neutral-100 px-2.5 text-[11px] font-semibold text-[#171717] shadow-none hover:bg-neutral-200/80 focus:ring-0">
            <SelectValue placeholder="Auto (all)" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="0">Auto (all worthy)</SelectItem>
            <SelectItem value="3">Up to 3 clips</SelectItem>
            <SelectItem value="5">Up to 5 clips</SelectItem>
            <SelectItem value="10">Up to 10 clips</SelectItem>
            <SelectItem value="15">Up to 15 clips</SelectItem>
            <SelectItem value="20">Up to 20 clips</SelectItem>
          </SelectContent>
        </Select>

        <div class="h-5 w-px bg-black/10" />

        <!-- Primary Launch Button -->
        <Button
          type="submit"
          size="sm"
          class="h-7 gap-1.5 rounded-lg bg-[#171717] px-3 text-[11px] font-medium text-white hover:bg-neutral-800"
          :disabled="launching || !vodUrl.trim()"
        >
          <Loader2 v-if="launching" class="size-3.5 animate-spin" aria-hidden="true" />
          <Scissors v-else class="size-3.5" aria-hidden="true" />
          <span>Clip</span>
        </Button>
      </form>

      <!-- Collapsible Optional Focus Row -->
      <div
        v-if="showAdvanced"
        class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <input
          v-model="vodTitle"
          type="text"
          placeholder="Optional VOD label (e.g. Friday Horror Stream)"
          class="h-8 rounded-lg border border-black/10 bg-white px-3 text-xs text-[#171717] placeholder:text-neutral-400 focus:border-black/25 focus:outline-none"
        />
        <input
          v-model="focusNotes"
          type="text"
          placeholder="Optional focus (e.g. funny fails, boss fights, Q&A)"
          class="h-8 rounded-lg border border-black/10 bg-white px-3 text-xs text-[#171717] placeholder:text-neutral-400 focus:border-black/25 focus:outline-none"
        />
      </div>
    </div>

    <!-- Row 2: Compact Native View & Filter Toolbar -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-black/8 bg-white px-4 py-2">
      <!-- Left: View Switcher + Live Worker Pill -->
      <div class="flex items-center gap-2">
        <div class="inline-flex items-center rounded-lg border border-black/10 bg-[#FAF9F6] p-0.5">
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md transition-colors"
            :class="viewMode === 'list' ? 'bg-[#171717] text-white' : 'text-neutral-500 hover:text-neutral-900'"
            title="List view"
            @click="viewMode = 'list'"
          >
            <List class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-md transition-colors"
            :class="viewMode === 'grid' ? 'bg-[#171717] text-white' : 'text-neutral-500 hover:text-neutral-900'"
            title="Grid view"
            @click="viewMode = 'grid'"
          >
            <LayoutGrid class="size-3.5" aria-hidden="true" />
          </button>
        </div>

        <span
          v-if="activeJobs.length > 0"
          class="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800"
        >
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          {{ activeJobs.length }} running in background
        </span>
        <span v-else class="text-[11px] text-neutral-500">
          {{ totalClipsCount }} {{ totalClipsCount === 1 ? "clip" : "clips" }} · CFR 30fps · -14 LUFS
        </span>
      </div>

      <!-- Right: Filter Input + Output Folder Pill + Refresh -->
      <div class="flex items-center gap-2">
        <div class="relative">
          <Search
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400"
            aria-hidden="true"
          />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Filter clips..."
            class="h-7 w-44 rounded-lg border border-black/10 bg-[#FAF9F6] pl-8 pr-6 text-xs text-[#171717] placeholder:text-neutral-400 focus:border-black/25 focus:bg-white focus:outline-none"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
            @click="searchQuery = ''"
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </div>

        <span
          class="hidden items-center gap-1.5 rounded-lg border border-black/10 bg-[#FAF9F6] px-2.5 py-1 font-mono text-[11px] text-neutral-600 md:inline-flex"
          title="Workspace output directory"
        >
          <FolderOpen class="size-3.5 text-neutral-500" aria-hidden="true" />
          /workspace/clips
        </span>

        <Button
          variant="ghost"
          size="icon"
          class="size-7 rounded-lg text-neutral-500 hover:text-neutral-900"
          :disabled="loading"
          title="Refresh"
          @click="loadEcosystem(false)"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <!-- Row 3: Full-Bleed Native List or Grid Surface -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- LIST VIEW (Stacher-Style Native Table) -->
      <div v-if="viewMode === 'list'" class="w-full">
        <!-- Sticky Column Header -->
        <div
          class="sticky top-0 z-10 grid grid-cols-[88px_1fr_80px_130px_190px] items-center gap-3 border-b border-black/8 bg-[#FAF9F6] px-4 py-2 text-[11px] font-semibold text-neutral-500"
        >
          <span>Thumbnail</span>
          <span>Title &amp; Status</span>
          <span class="text-right">Hook</span>
          <span>Details</span>
          <span class="text-right">Actions</span>
        </div>

        <!-- Active / Recent Background Jobs Rows -->
        <template v-for="job in [...activeJobs, ...recentFinishedJobs]" :key="job.id">
          <div
            class="grid grid-cols-[88px_1fr_80px_130px_190px] items-center gap-3 border-b border-black/6 px-4 py-2.5 transition-colors hover:bg-[#FAF9F6]/80"
          >
            <!-- Thumb -->
            <div class="relative aspect-video w-[88px] overflow-hidden rounded-lg border border-black/8 bg-neutral-100">
              <img
                v-if="job.videoId"
                :src="youtubeThumb(job.videoId)"
                alt=""
                class="h-full w-full object-cover"
              />
              <div
                v-if="job.status === 'running' || job.status === 'queued'"
                class="absolute inset-0 flex items-center justify-center bg-black/35"
              >
                <Loader2 class="size-4 animate-spin text-white" aria-hidden="true" />
              </div>
            </div>

            <!-- Title + Progress Bar + Stage -->
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-xs font-semibold text-[#171717]">
                  {{ job.title || job.vodUrl }}
                </span>
                <span
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  :class="
                    job.status === 'running' || job.status === 'queued'
                      ? 'bg-amber-100 text-amber-800'
                      : job.status === 'done'
                        ? 'bg-emerald-100 text-emerald-800'
                        : job.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-neutral-100 text-neutral-600'
                  "
                >
                  {{ job.stage || job.status }}
                </span>
              </div>

              <!-- Progress Bar (while running/queued) -->
              <div
                v-if="job.status === 'running' || job.status === 'queued'"
                class="mt-1.5 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-neutral-200"
              >
                <div
                  class="h-full rounded-full bg-[#171717] transition-all duration-500"
                  :style="{ width: `${jobProgressPercent(job)}%` }"
                />
              </div>

              <p v-if="job.error" class="mt-1 truncate text-[11px] text-red-600">
                {{ job.error }}
              </p>
              <p
                v-else-if="job.progressLog.length > 0"
                class="mt-1 truncate text-[11px] text-neutral-500"
              >
                {{ job.progressLog[job.progressLog.length - 1]?.message }}
              </p>
            </div>

            <!-- Hook col -->
            <div class="text-right font-mono text-[11px] text-neutral-400">—</div>

            <!-- Details col -->
            <div class="font-mono text-[11px] text-neutral-500">
              {{ job.maxClips <= 0 ? "Auto (all)" : `Max ${job.maxClips}` }}
            </div>

            <!-- Actions col -->
            <div class="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1 rounded-lg px-2 text-[11px] text-neutral-600"
                @click="expandedJobId = expandedJobId === job.id ? null : job.id"
              >
                <Terminal class="size-3" aria-hidden="true" />
                Log
              </Button>
              <Button
                v-if="job.status === 'running' || job.status === 'queued'"
                variant="outline"
                size="sm"
                class="h-7 gap-1 rounded-lg border-red-200 px-2 text-[11px] text-red-700 hover:bg-red-50"
                @click="cancelJob(job.id)"
              >
                <Square class="size-2.5" aria-hidden="true" />
                Stop
              </Button>
              <Button
                v-else
                variant="ghost"
                size="icon"
                class="size-7 rounded-lg text-neutral-400 hover:text-red-600"
                title="Remove job from history"
                @click="removeJob(job.id)"
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <!-- Expandable Live Worker Log -->
          <div
            v-if="expandedJobId === job.id"
            class="border-b border-black/8 bg-[#FAF9F6] px-6 py-2.5 font-mono text-[11px] text-neutral-600"
          >
            <div v-for="(entry, idx) in job.progressLog" :key="idx" class="flex gap-2 py-0.5">
              <span class="shrink-0 text-neutral-400">{{ entry.at.slice(11, 19) }}</span>
              <span class="shrink-0 font-semibold text-neutral-800">[{{ entry.stage }}]</span>
              <span class="break-words">{{ entry.message }}</span>
            </div>
          </div>
        </template>

        <!-- Saved Clips Rows -->
        <div
          v-for="clip in filteredRecords"
          :key="clip.id"
          class="grid grid-cols-[88px_1fr_80px_130px_190px] items-center gap-3 border-b border-black/6 px-4 py-2.5 transition-colors hover:bg-[#FAF9F6]/80"
        >
          <!-- Clickable Video Thumb -->
          <button
            type="button"
            class="group relative aspect-video w-[88px] overflow-hidden rounded-lg border border-black/10 bg-black text-left"
            title="Preview clip"
            @click="previewClip = clip"
          >
            <video
              :src="clipMediaUrl(clip.filePath)"
              preload="metadata"
              muted
              class="h-full w-full object-cover"
            />
            <span class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-90 transition-opacity group-hover:bg-black/40">
              <Play class="size-4 fill-white text-white" aria-hidden="true" />
            </span>
          </button>

          <!-- Title + Editor Notes -->
          <div class="min-w-0">
            <button
              type="button"
              class="block max-w-full truncate text-left text-xs font-semibold text-[#171717] hover:underline"
              @click="previewClip = clip"
            >
              {{ clip.title }}
            </button>
            <p v-if="clip.editorNotes" class="mt-0.5 truncate text-[11px] text-neutral-500">
              {{ clip.editorNotes }}
            </p>
          </div>

          <!-- Hook Score -->
          <div class="text-right">
            <span
              v-if="clip.hookScore !== null"
              class="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-800"
            >
              {{ clip.hookScore }}/10
            </span>
            <span v-else class="font-mono text-[11px] text-neutral-400">—</span>
          </div>

          <!-- Timestamp & Duration -->
          <div class="font-mono text-[11px] text-neutral-500">
            <div v-if="clip.startSec !== null && clip.endSec !== null">
              {{ formatSec(clip.startSec) }}–{{ formatSec(clip.endSec) }}
            </div>
            <div v-if="clip.durationSec" class="text-[10px] text-neutral-400">
              {{ clip.durationSec }}s · -14 LUFS
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-1">
            <a
              :href="`${clipMediaUrl(clip.filePath)}&download=1`"
              class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
              title="Download MP4"
            >
              <Download class="size-3" aria-hidden="true" />
              MP4
            </a>
            <a
              v-if="clip.srtPath"
              :href="`${clipMediaUrl(clip.srtPath)}&download=1`"
              class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
              title="Download SRT subtitles"
            >
              SRT
            </a>
            <Button
              v-if="!clip.boxUrl"
              variant="outline"
              size="icon"
              class="size-7 rounded-lg"
              title="Send to Box (Otto Handoffs/)"
              :disabled="boxUploadingId === clip.id"
              @click="sendClipToBox(clip)"
            >
              <Loader2 v-if="boxUploadingId === clip.id" class="size-3.5 animate-spin" aria-hidden="true" />
              <Box v-else class="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              v-else
              variant="outline"
              size="icon"
              class="size-7 rounded-lg border-emerald-200 bg-emerald-50 text-emerald-800"
              title="Copy Box handoff link"
              @click="copyBoxUrl(clip.id, clip.boxUrl)"
            >
              <Check v-if="copiedBoxId === clip.id" class="size-3.5" aria-hidden="true" />
              <Copy v-else class="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-7 rounded-lg text-neutral-400 hover:text-red-600"
              title="Remove clip"
              @click="removeClipRecord(clip.id)"
            >
              <Trash2 class="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <!-- Untracked Legacy Clips Rows -->
        <div
          v-for="file in filteredUntracked"
          :key="file.relPath"
          class="grid grid-cols-[88px_1fr_80px_130px_190px] items-center gap-3 border-b border-black/6 px-4 py-2.5 transition-colors hover:bg-[#FAF9F6]/80"
        >
          <div class="relative aspect-video w-[88px] overflow-hidden rounded-lg border border-black/10 bg-black">
            <video :src="file.mp4Url" preload="metadata" muted class="h-full w-full object-cover" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-xs font-semibold text-[#171717]">{{ file.name }}</div>
            <div class="mt-0.5 font-mono text-[10px] text-neutral-400">{{ file.relPath }}</div>
          </div>
          <div class="text-right font-mono text-[11px] text-neutral-400">—</div>
          <div class="font-mono text-[11px] text-neutral-500">{{ formatBytes(file.sizeBytes) }}</div>
          <div class="flex items-center justify-end gap-1">
            <a
              :href="`${file.mp4Url}?download=1`"
              class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
            >
              <Download class="size-3" aria-hidden="true" />
              MP4
            </a>
            <a
              v-if="file.srtUrl"
              :href="`${file.srtUrl}?download=1`"
              class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
            >
              SRT
            </a>
          </div>
        </div>

        <!-- Clean Native Empty State -->
        <div
          v-if="jobs.length === 0 && filteredRecords.length === 0 && filteredUntracked.length === 0"
          class="flex flex-col items-center justify-center px-6 py-20 text-center"
        >
          <Film class="mb-3 size-8 text-neutral-300" aria-hidden="true" />
          <p class="text-xs font-semibold text-neutral-700">No clips or active jobs yet</p>
          <p class="mt-1 max-w-sm text-[11px] text-neutral-500">
            Paste any YouTube livestream VOD URL in the bar above and press Enter — Otto runs hype detection, cutting, -14 LUFS prep, and review in the background.
          </p>
        </div>
      </div>

      <!-- GRID VIEW -->
      <div v-else class="p-4">
        <div
          v-if="filteredRecords.length === 0 && filteredUntracked.length === 0"
          class="flex flex-col items-center justify-center px-6 py-20 text-center"
        >
          <Film class="mb-3 size-8 text-neutral-300" aria-hidden="true" />
          <p class="text-xs font-semibold text-neutral-700">No clips to display</p>
          <p class="mt-1 text-[11px] text-neutral-500">
            Switch to List view to watch active background jobs or paste a VOD URL above.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="clip in filteredRecords"
            :key="clip.id"
            class="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white"
          >
            <div class="relative aspect-video bg-black">
              <video
                :src="clipMediaUrl(clip.filePath)"
                controls
                preload="metadata"
                class="h-full w-full object-contain"
              />
            </div>
            <div class="flex flex-1 flex-col gap-2 p-3">
              <div class="flex items-start justify-between gap-2">
                <h4 class="text-xs font-semibold leading-snug text-[#171717]">{{ clip.title }}</h4>
                <span
                  v-if="clip.hookScore !== null"
                  class="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-800"
                >
                  {{ clip.hookScore }}/10
                </span>
              </div>
              <p v-if="clip.editorNotes" class="line-clamp-2 text-[11px] text-neutral-500">
                {{ clip.editorNotes }}
              </p>
              <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <a
                  :href="`${clipMediaUrl(clip.filePath)}&download=1`"
                  class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <Download class="size-3" aria-hidden="true" />
                  MP4
                </a>
                <a
                  v-if="clip.srtPath"
                  :href="`${clipMediaUrl(clip.srtPath)}&download=1`"
                  class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  SRT
                </a>
                <Button
                  v-if="!clip.boxUrl"
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 rounded-lg px-2 text-[11px]"
                  :disabled="boxUploadingId === clip.id"
                  @click="sendClipToBox(clip)"
                >
                  <Box class="size-3" aria-hidden="true" />
                  Box
                </Button>
                <Button
                  v-else
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 rounded-lg border-emerald-200 bg-emerald-50 px-2 text-[11px] text-emerald-800"
                  @click="copyBoxUrl(clip.id, clip.boxUrl)"
                >
                  <Copy class="size-3" aria-hidden="true" />
                  Copy Link
                </Button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>

    <!-- Native Video Preview Modal (when clicking any clip in List view) -->
    <Dialog :open="Boolean(previewClip)" @update:open="(open) => { if (!open) previewClip = null; }">
      <DialogContent class="max-w-2xl overflow-hidden p-0">
        <div v-if="previewClip" class="flex flex-col">
          <div class="aspect-video w-full bg-black">
            <video
              :src="clipMediaUrl(previewClip.filePath)"
              controls
              autoplay
              class="h-full w-full object-contain"
            />
          </div>
          <div class="flex flex-col gap-3 p-4">
            <DialogHeader>
              <div class="flex items-center justify-between gap-2">
                <DialogTitle class="text-sm font-semibold">{{ previewClip.title }}</DialogTitle>
                <span
                  v-if="previewClip.hookScore !== null"
                  class="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800"
                >
                  Hook {{ previewClip.hookScore }}/10
                </span>
              </div>
              <DialogDescription class="font-mono text-[11px]">
                <span v-if="previewClip.startSec !== null && previewClip.endSec !== null">
                  {{ formatSec(previewClip.startSec) }}–{{ formatSec(previewClip.endSec) }}
                  ({{ previewClip.durationSec }}s) ·
                </span>
                {{ previewClip.filePath }}
              </DialogDescription>
            </DialogHeader>

            <p
              v-if="previewClip.editorNotes"
              class="rounded-xl border border-black/8 bg-[#FAF9F6] p-3 text-xs leading-relaxed text-neutral-700"
            >
              {{ previewClip.editorNotes }}
            </p>

            <div class="flex flex-wrap items-center gap-2">
              <a
                :href="`${clipMediaUrl(previewClip.filePath)}&download=1`"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#171717] px-3 text-xs font-medium text-white hover:bg-neutral-800"
              >
                <Download class="size-3.5" aria-hidden="true" />
                Download MP4
              </a>
              <a
                v-if="previewClip.srtPath"
                :href="`${clipMediaUrl(previewClip.srtPath)}&download=1`"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/12 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download class="size-3.5" aria-hidden="true" />
                Download SRT
              </a>
              <a
                v-if="previewClip.youtubeUrl"
                :href="previewClip.youtubeUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/12 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <ExternalLink class="size-3.5" aria-hidden="true" />
                VOD Jump
              </a>
              <Button
                v-if="!previewClip.boxUrl"
                variant="outline"
                size="sm"
                class="ml-auto h-8 gap-1.5 rounded-lg text-xs"
                :disabled="boxUploadingId === previewClip.id"
                @click="sendClipToBox(previewClip)"
              >
                <Box class="size-3.5" aria-hidden="true" />
                Send to Box
              </Button>
              <Button
                v-else
                variant="outline"
                size="sm"
                class="ml-auto h-8 gap-1.5 rounded-lg border-emerald-200 bg-emerald-50 text-xs text-emerald-800"
                @click="copyBoxUrl(previewClip.id, previewClip.boxUrl)"
              >
                <Copy class="size-3.5" aria-hidden="true" />
                Copy Box Link
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
