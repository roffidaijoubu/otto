<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Box,
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  Square,
  Trash2,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
const activeWorkerIds = ref<string[]>([]);
const boxUploadingId = ref<string | null>(null);
const copiedBoxId = ref<string | null>(null);
const expandedJobId = ref<string | null>(null);

const vodUrl = ref("");
const vodTitle = ref("");
const maxClips = ref(0);
const focusNotes = ref("");

const activeRunningCount = computed(
  () => jobs.value.filter((j) => j.status === "running" || j.status === "queued").length
);

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

function jobBadgeClass(status: ClipJob["status"]): string {
  if (status === "running" || status === "queued") {
    return "border-amber-300 bg-amber-50 text-amber-800";
  }
  if (status === "done") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (status === "failed") {
    return "border-red-300 bg-red-50 text-red-700";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-600";
}

async function loadEcosystem(silent = false) {
  if (!silent) loading.value = true;
  try {
    const res = await fetch("/api/clips/ecosystem");
    if (!res.ok) throw new Error(`Failed to load clips (${res.status})`);
    const data = (await res.json()) as {
      jobs?: ClipJob[];
      records?: ClipRecord[];
      untrackedFiles?: UntrackedClipFile[];
      activeWorkerIds?: string[];
    };
    jobs.value = data.jobs ?? [];
    records.value = data.records ?? [];
    untrackedFiles.value = data.untrackedFiles ?? [];
    activeWorkerIds.value = data.activeWorkerIds ?? [];
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
    const res = await fetch("/api/clips/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vodUrl: url,
        title: vodTitle.value.trim() || undefined,
        maxClips: maxClips.value,
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
    if (data.job) {
      expandedJobId.value = data.job.id;
    }
    toast.success("Background clipper started — main Otto Chat stays free.");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not start clip job");
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
    toast.message("Background clip job cancelled.");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to cancel job");
  }
}

async function removeJob(id: string) {
  try {
    await fetch(`/api/clips/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadEcosystem(true);
  } catch {
    toast.error("Failed to remove job");
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
    toast.success("Clip uploaded to Box (Otto Handoffs/)!");
    await loadEcosystem(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Box upload failed");
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
    await fetch(`/api/clips/records/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadEcosystem(true);
  } catch {
    toast.error("Failed to remove clip record");
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
  <div class="flex h-full min-h-0 flex-col bg-[#F7F6F3] text-[#171717]">
    <!-- Top Header -->
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-black/8 bg-white px-5 py-3">
      <div class="flex items-center gap-2.5">
        <div class="flex size-8 items-center justify-center rounded-xl bg-[#171717] text-white">
          <Scissors class="size-4" aria-hidden="true" />
        </div>
        <div>
          <h2 class="text-sm font-semibold leading-tight text-[#171717]">Clips</h2>
          <p class="text-[11px] text-neutral-500">
            Background VOD hype clipper &amp; human-editor handoff
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <span
          v-if="activeRunningCount > 0"
          class="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
        >
          <Loader2 class="size-3 animate-spin" aria-hidden="true" />
          {{ activeRunningCount }} background {{ activeRunningCount === 1 ? "job" : "jobs" }} running
        </span>
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5 rounded-xl text-xs"
          :disabled="loading"
          @click="loadEcosystem(false)"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': loading }" aria-hidden="true" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Scrollable Body -->
    <div class="min-h-0 flex-1 overflow-y-auto p-5">
      <div class="mx-auto flex max-w-4xl flex-col gap-5">
        <!-- New Background Clip Job Card -->
        <section class="rounded-2xl border border-black/8 bg-white p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 class="text-xs font-semibold text-[#171717]">
                New Auto-Pilot Clip Job (Runs in Background)
              </h3>
              <p class="text-[11px] text-neutral-500">
                Scans live-chat hype, cuts raw <code>.mp4</code> + <code>.srt</code>, normalizes to -14 LUFS CFR 30fps, and writes editor notes without blocking Otto Chat.
              </p>
            </div>
          </div>

          <form class="flex flex-col gap-2.5" @submit.prevent="launchJob">
            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_155px]">
              <Input
                v-model="vodUrl"
                placeholder="Paste YouTube VOD URL or video ID (e.g. https://youtu.be/...)"
                class="h-9 rounded-xl bg-[#FAF9F6] text-xs"
                :disabled="launching"
              />
              <select
                v-model.number="maxClips"
                class="h-9 rounded-xl border border-black/10 bg-[#FAF9F6] px-2.5 text-xs text-[#171717] focus:outline-none"
                :disabled="launching"
              >
                <option :value="0">Auto (all worthy)</option>
                <option :value="3">Up to 3 clips</option>
                <option :value="5">Up to 5 clips</option>
                <option :value="10">Up to 10 clips</option>
                <option :value="15">Up to 15 clips</option>
                <option :value="20">Up to 20 clips</option>
              </select>
            </div>

            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                v-model="vodTitle"
                placeholder="Optional VOD label (e.g. Friday Horror Stream)"
                class="h-9 rounded-xl bg-[#FAF9F6] text-xs"
                :disabled="launching"
              />
              <Input
                v-model="focusNotes"
                placeholder="Optional focus (e.g. funny fails, Q&A answers)"
                class="h-9 rounded-xl bg-[#FAF9F6] text-xs"
                :disabled="launching"
              />
              <Button
                type="submit"
                size="sm"
                class="h-9 gap-1.5 rounded-xl bg-[#171717] px-4 text-xs text-white hover:bg-neutral-800"
                :disabled="launching || !vodUrl.trim()"
              >
                <Loader2 v-if="launching" class="size-3.5 animate-spin" aria-hidden="true" />
                <Play v-else class="size-3.5" aria-hidden="true" />
                Run in Background
              </Button>
            </div>
          </form>
        </section>

        <!-- Background Jobs Queue / History -->
        <section v-if="jobs.length > 0" class="flex flex-col gap-2.5">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-neutral-700">
              Background Jobs ({{ jobs.length }})
            </h3>
          </div>

          <div
            v-for="job in jobs"
            :key="job.id"
            class="rounded-2xl border border-black/8 bg-white p-3.5"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                    :class="jobBadgeClass(job.status)"
                  >
                    <Loader2
                      v-if="job.status === 'running' || job.status === 'queued'"
                      class="size-2.5 animate-spin"
                      aria-hidden="true"
                    />
                    {{ job.stage || job.status }}
                  </span>
                  <span class="truncate text-xs font-semibold text-[#171717]">
                    {{ job.title || job.videoId }}
                  </span>
                  <span class="font-mono text-[10px] text-neutral-400">
                    {{ job.maxClips <= 0 ? "full auto (all worthy)" : `up to ${job.maxClips} clips` }}
                  </span>
                </div>
                <p v-if="job.error" class="mt-1 text-[11px] text-red-600">
                  {{ job.error }}
                </p>
                <p
                  v-else-if="job.progressLog.length > 0"
                  class="mt-1 truncate text-[11px] text-neutral-500"
                >
                  {{ job.progressLog[job.progressLog.length - 1]?.message }}
                </p>
              </div>

              <div class="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 rounded-lg px-2 text-[11px] text-neutral-600"
                  @click="expandedJobId = expandedJobId === job.id ? null : job.id"
                >
                  {{ expandedJobId === job.id ? "Hide log" : `Log (${job.progressLog.length})` }}
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
                  size="sm"
                  class="h-7 rounded-lg px-2 text-[11px] text-neutral-400 hover:text-red-600"
                  @click="removeJob(job.id)"
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div
              v-if="expandedJobId === job.id"
              class="mt-2.5 max-h-40 overflow-y-auto rounded-xl border border-black/6 bg-[#FAF9F6] p-2.5 font-mono text-[11px] text-neutral-600"
            >
              <div
                v-for="(entry, idx) in job.progressLog"
                :key="idx"
                class="flex gap-2 py-0.5"
              >
                <span class="shrink-0 text-neutral-400">
                  {{ entry.at.slice(11, 19) }}
                </span>
                <span class="shrink-0 font-semibold text-neutral-700">[{{ entry.stage }}]</span>
                <span class="break-words">{{ entry.message }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Saved Clips Gallery -->
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-neutral-700">
              Editor-Ready Clips ({{ records.length + untrackedFiles.length }})
            </h3>
            <span class="text-[11px] text-neutral-400">
              CFR 30fps · H.264 · -14 LUFS · Zero AI edits
            </span>
          </div>

          <div
            v-if="records.length === 0 && untrackedFiles.length === 0"
            class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/12 bg-white/70 px-6 py-10 text-center"
          >
            <Film class="mb-2 size-7 text-neutral-300" aria-hidden="true" />
            <p class="text-xs font-medium text-neutral-700">No clips extracted yet</p>
            <p class="mt-1 max-w-sm text-[11px] text-neutral-500">
              Paste a YouTube VOD URL above to run the background clipper, or tell Otto in chat to clip your latest stream.
            </p>
          </div>

          <!-- Tracked SQLite Clip Records -->
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <article
              v-for="clip in records"
              :key="clip.id"
              class="flex flex-col overflow-hidden rounded-2xl border border-black/8 bg-white"
            >
              <div class="relative aspect-video bg-black">
                <video
                  :src="clipMediaUrl(clip.filePath)"
                  controls
                  preload="metadata"
                  class="h-full w-full object-contain"
                />
              </div>

              <div class="flex flex-1 flex-col gap-2.5 p-3.5">
                <div class="flex items-start justify-between gap-2">
                  <h4 class="text-xs font-semibold leading-snug text-[#171717]">
                    {{ clip.title }}
                  </h4>
                  <span
                    v-if="clip.hookScore !== null"
                    class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-800"
                  >
                    Hook {{ clip.hookScore }}/10
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] text-neutral-500">
                  <span v-if="clip.startSec !== null && clip.endSec !== null">
                    {{ formatSec(clip.startSec) }}–{{ formatSec(clip.endSec) }}
                  </span>
                  <span v-if="clip.durationSec">({{ clip.durationSec }}s)</span>
                  <a
                    v-if="clip.youtubeUrl"
                    :href="clip.youtubeUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-0.5 text-neutral-700 underline-offset-2 hover:underline"
                  >
                    VOD jump
                    <ExternalLink class="size-2.5" aria-hidden="true" />
                  </a>
                </div>

                <p
                  v-if="clip.editorNotes"
                  class="rounded-xl border border-black/6 bg-[#FAF9F6] p-2.5 text-[11px] leading-relaxed text-neutral-700"
                >
                  {{ clip.editorNotes }}
                </p>

                <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  <a
                    :href="`${clipMediaUrl(clip.filePath)}&download=1`"
                    class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    <Download class="size-3" aria-hidden="true" />
                    MP4
                  </a>
                  <a
                    v-if="clip.srtPath"
                    :href="`${clipMediaUrl(clip.srtPath)}&download=1`"
                    class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    <Download class="size-3" aria-hidden="true" />
                    SRT
                  </a>

                  <Button
                    v-if="!clip.boxUrl"
                    variant="outline"
                    size="sm"
                    class="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
                    :disabled="boxUploadingId === clip.id"
                    @click="sendClipToBox(clip)"
                  >
                    <Loader2
                      v-if="boxUploadingId === clip.id"
                      class="size-3 animate-spin"
                      aria-hidden="true"
                    />
                    <Box v-else class="size-3" aria-hidden="true" />
                    Send to Box
                  </Button>
                  <template v-else>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1 rounded-lg border-emerald-200 bg-emerald-50 px-2.5 text-[11px] text-emerald-800"
                      @click="copyBoxUrl(clip.id, clip.boxUrl)"
                    >
                      <Check v-if="copiedBoxId === clip.id" class="size-3" aria-hidden="true" />
                      <Copy v-else class="size-3" aria-hidden="true" />
                      Copy Box Link
                    </Button>
                  </template>

                  <Button
                    variant="ghost"
                    size="sm"
                    class="ml-auto h-7 rounded-lg px-2 text-neutral-400 hover:text-red-600"
                    @click="removeClipRecord(clip.id)"
                  >
                    <Trash2 class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </article>

            <!-- Legacy / Untracked Workspace Clips -->
            <article
              v-for="file in untrackedFiles"
              :key="file.relPath"
              class="flex flex-col overflow-hidden rounded-2xl border border-black/8 bg-white"
            >
              <div class="relative aspect-video bg-black">
                <video
                  :src="file.mp4Url"
                  controls
                  preload="metadata"
                  class="h-full w-full object-contain"
                />
              </div>
              <div class="flex flex-1 flex-col gap-2 p-3.5">
                <div class="flex items-start justify-between gap-2">
                  <h4 class="truncate text-xs font-semibold text-[#171717]">{{ file.name }}</h4>
                  <span class="font-mono text-[10px] text-neutral-400">
                    {{ formatBytes(file.sizeBytes) }}
                  </span>
                </div>
                <div class="mt-auto flex items-center gap-1.5 pt-1">
                  <a
                    :href="`${file.mp4Url}?download=1`"
                    class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    <Download class="size-3" aria-hidden="true" />
                    MP4
                  </a>
                  <a
                    v-if="file.srtUrl"
                    :href="`${file.srtUrl}?download=1`"
                    class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    <Download class="size-3" aria-hidden="true" />
                    SRT
                  </a>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
