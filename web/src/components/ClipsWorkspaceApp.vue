<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
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
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
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

interface ArchiveSearchMatch {
  id: string;
  videoId: string;
  title: string;
  publishedAt: string;
  contentType: "video" | "live" | "short";
  startSec: number;
  endSec: number;
  startStr: string;
  endStr: string;
  durationSec: number;
  lang: string;
  text: string;
  score: number;
  youtubeUrl: string;
  thumbUrl: string;
}

interface ArchiveVideoItem {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  contentType: "video" | "live" | "short";
  status: "pending" | "indexing" | "indexed" | "no_captions" | "failed";
  chunkCount: number;
  lang: string;
  error: string;
  indexedAt: string | null;
  updatedAt: string;
}

interface ArchiveStatusPayload {
  ok?: boolean;
  pinecone?: {
    connected: boolean;
    indexName: string;
    ready: boolean;
    totalVectorCount: number;
    namespaceVectorCount: number;
    error?: string;
  };
  local?: {
    totalTracked: number;
    indexedVideos: number;
    noCaptionsVideos: number;
    failedVideos: number;
    pendingVideos: number;
    totalChunks: number;
  };
  channelUrl?: string | null;
  sync?: {
    running: boolean;
    stage: string;
    discovered: number;
    alreadyIndexed: number;
    processed: number;
    totalToIndex: number;
    indexedThisRun: number;
    noCaptionsThisRun: number;
    failedThisRun: number;
    currentTitle: string;
    error: string;
  };
  videos?: ArchiveVideoItem[];
}

const props = defineProps<{
  refreshTick: number;
}>();

const activeTab = ref<"library" | "archive">("library");
const loading = ref(false);
const launching = ref(false);
const jobs = ref<ClipJob[]>([]);
const records = ref<ClipRecord[]>([]);
const untrackedFiles = ref<UntrackedClipFile[]>([]);
const boxUploadingId = ref<string | null>(null);
const copiedBoxId = ref<string | null>(null);
const copiedNotes = ref(false);
const expandedJobId = ref<string | null>(null);
const selectedVideoId = ref<string | null>(null);
const selectedClipId = ref<string | null>(null);
const detailVideoRef = ref<HTMLVideoElement | null>(null);

interface UnifiedClip {
  id: string;
  videoId: string;
  title: string;
  mp4Url: string;
  mp4DownloadUrl: string;
  srtUrl: string | null;
  srtDownloadUrl: string | null;
  filePath: string;
  startSec: number | null;
  endSec: number | null;
  durationSec: number | null;
  hookScore: number | null;
  editorNotes: string;
  youtubeUrl: string;
  boxUrl: string;
  sizeBytes: number | null;
  updatedAt: string;
  record: ClipRecord | null;
}

interface VodGroup {
  videoId: string;
  title: string;
  vodUrl: string;
  latestJob: ClipJob | null;
  clips: UnifiedClip[];
  updatedAt: string;
}

interface SrtCue {
  index: number;
  startSec: number;
  endSec: number;
  startLabel: string;
  text: string;
}
const srtCues = ref<SrtCue[]>([]);
const srtLoading = ref(false);
const showCaptions = ref(true);
const detailCurrentTime = ref(0);

// Creator Archive (Pinecone) state
const archiveStatus = ref<ArchiveStatusPayload | null>(null);
const archiveLoading = ref(false);
const archiveQuery = ref("");
const archiveContentType = ref<"all" | "live" | "video" | "short">("all");
const archiveSearching = ref(false);
const archiveHasSearched = ref(false);
const archiveMatches = ref<ArchiveSearchMatch[]>([]);
const archiveSyncStarting = ref(false);

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

const allUnifiedClips = computed<UnifiedClip[]>(() => {
  const list: UnifiedClip[] = [];
  for (const r of records.value) {
    const mp4Url = clipMediaUrl(r.filePath);
    const srtUrl = r.srtPath ? clipMediaUrl(r.srtPath) : null;
    list.push({
      id: r.id,
      videoId: r.videoId || "unknown",
      title: r.title,
      mp4Url,
      mp4DownloadUrl: `${mp4Url}&download=1`,
      srtUrl,
      srtDownloadUrl: srtUrl ? `${srtUrl}&download=1` : null,
      filePath: r.filePath,
      startSec: r.startSec,
      endSec: r.endSec,
      durationSec: r.durationSec,
      hookScore: r.hookScore,
      editorNotes: r.editorNotes,
      youtubeUrl: r.youtubeUrl,
      boxUrl: r.boxUrl,
      sizeBytes: null,
      updatedAt: r.updatedAt || r.createdAt,
      record: r,
    });
  }
  for (const f of untrackedFiles.value) {
    list.push({
      id: `file:${f.relPath}`,
      videoId: f.videoId || "unknown",
      title: f.name.replace(/_prepped$/, "").replace(/_/g, " "),
      mp4Url: f.mp4Url,
      mp4DownloadUrl: `${f.mp4Url}?download=1`,
      srtUrl: f.srtUrl,
      srtDownloadUrl: f.srtUrl ? `${f.srtUrl}?download=1` : null,
      filePath: f.relPath,
      startSec: null,
      endSec: null,
      durationSec: null,
      hookScore: null,
      editorNotes: "",
      youtubeUrl: f.videoId ? `https://www.youtube.com/watch?v=${f.videoId}` : "",
      boxUrl: "",
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt,
      record: null,
    });
  }
  return list;
});

const vodGroups = computed<VodGroup[]>(() => {
  const map = new Map<string, VodGroup>();
  const ensure = (videoId: string): VodGroup => {
    const key = videoId || "unknown";
    let g = map.get(key);
    if (!g) {
      g = {
        videoId: key,
        title: key === "unknown" ? "Uncategorized Clips" : `VOD ${key}`,
        vodUrl: key === "unknown" ? "" : `https://www.youtube.com/watch?v=${key}`,
        latestJob: null,
        clips: [],
        updatedAt: "",
      };
      map.set(key, g);
    }
    return g;
  };

  for (const job of jobs.value) {
    const g = ensure(job.videoId);
    if (!g.latestJob || job.updatedAt > g.latestJob.updatedAt) {
      g.latestJob = job;
    }
    if (job.title && (!g.title || g.title.startsWith("VOD "))) {
      g.title = job.title;
    }
    if (job.vodUrl) g.vodUrl = job.vodUrl;
    if (job.updatedAt > g.updatedAt) g.updatedAt = job.updatedAt;
  }

  for (const clip of allUnifiedClips.value) {
    const g = ensure(clip.videoId);
    g.clips.push(clip);
    if (clip.updatedAt > g.updatedAt) g.updatedAt = clip.updatedAt;
  }

  return Array.from(map.values()).sort((a, b) => {
    const aActive = a.latestJob && (a.latestJob.status === "running" || a.latestJob.status === "queued") ? 1 : 0;
    const bActive = b.latestJob && (b.latestJob.status === "running" || b.latestJob.status === "queued") ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
});

const filteredVodGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return vodGroups.value;
  return vodGroups.value.filter(
    (v) =>
      v.title.toLowerCase().includes(q) ||
      v.videoId.toLowerCase().includes(q) ||
      v.clips.some((c) => c.title.toLowerCase().includes(q) || c.editorNotes.toLowerCase().includes(q))
  );
});

const selectedVod = computed<VodGroup | null>(() => {
  if (!selectedVideoId.value) return null;
  return vodGroups.value.find((v) => v.videoId === selectedVideoId.value) ?? null;
});

const filteredVodClips = computed<UnifiedClip[]>(() => {
  const clips = selectedVod.value?.clips ?? [];
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return clips;
  return clips.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.editorNotes.toLowerCase().includes(q) ||
      c.filePath.toLowerCase().includes(q)
  );
});

const totalClipsCount = computed(() => allUnifiedClips.value.length);

const selectedClip = computed<UnifiedClip | null>(() => {
  if (!selectedClipId.value) return null;
  return allUnifiedClips.value.find((c) => c.id === selectedClipId.value) ?? null;
});

const selectedClipIndex = computed(() => {
  if (!selectedClip.value) return -1;
  return filteredVodClips.value.findIndex((c) => c.id === selectedClip.value?.id);
});

function parseSrtTimestampToSec(ts: string): number {
  const m = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseSrtContent(raw: string): SrtCue[] {
  const blocks = raw.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const tsIdx = lines.findIndex((l) => l.includes("-->"));
    if (tsIdx < 0) continue;
    const [startRaw, endRaw] = lines[tsIdx].split("-->").map((s) => s.trim());
    const startSec = parseSrtTimestampToSec(startRaw || "00:00:00,000");
    const endSec = parseSrtTimestampToSec(endRaw || startRaw || "00:00:02,000");
    const text = lines.slice(tsIdx + 1).join(" ").trim();
    if (!text) continue;
    cues.push({
      index: cues.length + 1,
      startSec,
      endSec: Math.max(startSec + 0.4, endSec),
      startLabel: formatSec(startSec),
      text,
    });
  }
  return cues;
}

const activeSrtCue = computed<SrtCue | null>(() => {
  if (!showCaptions.value || srtCues.value.length === 0) return null;
  const t = detailCurrentTime.value;
  return srtCues.value.find((c) => t >= c.startSec && t <= c.endSec) ?? null;
});

function onDetailTimeUpdate(e: Event) {
  const el = e.target as HTMLVideoElement | null;
  if (el) detailCurrentTime.value = el.currentTime;
}

async function loadSrtForClip(clip: UnifiedClip | null) {
  srtCues.value = [];
  if (!clip?.srtUrl) return;
  srtLoading.value = true;
  try {
    const res = await fetch(clip.srtUrl);
    if (!res.ok) return;
    const raw = await res.text();
    srtCues.value = parseSrtContent(raw);
  } catch {
    // ignore
  } finally {
    srtLoading.value = false;
  }
}

function openVod(videoId: string) {
  selectedVideoId.value = videoId;
  selectedClipId.value = null;
  searchQuery.value = "";
  playSound("toggle");
}

function closeVod() {
  selectedVideoId.value = null;
  selectedClipId.value = null;
  searchQuery.value = "";
}

function openClipDetail(clip: UnifiedClip) {
  selectedVideoId.value = clip.videoId;
  selectedClipId.value = clip.id;
  playSound("toggle");
}

function closeClipDetail() {
  selectedClipId.value = null;
}

function goPrevClip() {
  const idx = selectedClipIndex.value;
  if (idx > 0) {
    selectedClipId.value = filteredVodClips.value[idx - 1].id;
  }
}

function goNextClip() {
  const idx = selectedClipIndex.value;
  if (idx >= 0 && idx < filteredVodClips.value.length - 1) {
    selectedClipId.value = filteredVodClips.value[idx + 1].id;
  }
}

function seekDetailVideo(sec: number) {
  const video = detailVideoRef.value;
  if (!video) return;
  video.currentTime = Math.max(0, sec);
  void video.play().catch(() => {});
}

async function copyEditorNotes(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedNotes.value = true;
    toast.success("Editor notes copied");
    setTimeout(() => {
      copiedNotes.value = false;
    }, 1800);
  } catch {
    toast.error("Could not copy notes");
  }
}

watch(selectedClip, (clip) => {
  detailCurrentTime.value = 0;
  void loadSrtForClip(clip);
});

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

async function resumeJob(id: string) {
  try {
    const res = await fetch(`/api/clips/jobs/${encodeURIComponent(id)}/resume`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to resume job");
    playSound("toggle");
    toast.success("Resuming clip job from last Neon checkpoint!");
    await loadEcosystem(true);
  } catch (err) {
    playSound("error");
    toast.error(err instanceof Error ? err.message : "Failed to resume job");
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
    if (selectedClipId.value === id) selectedClipId.value = null;
    await loadEcosystem(true);
  } catch {
    toast.error("Failed to remove clip record");
    playSound("error");
  }
}

async function loadArchiveStatus(silent = false) {
  if (!silent) archiveLoading.value = true;
  try {
    const res = await fetch("/api/archive/status");
    if (!res.ok) return;
    const data = (await res.json()) as ArchiveStatusPayload;
    if (data.ok) {
      archiveStatus.value = data;
    }
  } catch {
    // ignore transient errors
  } finally {
    if (!silent) archiveLoading.value = false;
  }
}

async function runArchiveSearch() {
  const q = archiveQuery.value.trim();
  if (!q || archiveSearching.value) return;
  archiveSearching.value = true;
  archiveHasSearched.value = true;
  try {
    const res = await fetch("/api/archive/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q,
        topK: 10,
        contentType: archiveContentType.value,
        useRerank: true,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      matches?: ArchiveSearchMatch[];
      error?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Archive search failed (${res.status})`);
    }
    archiveMatches.value = data.matches ?? [];
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Archive search failed");
    playSound("error");
  } finally {
    archiveSearching.value = false;
  }
}

async function startArchiveSync() {
  if (archiveSyncStarting.value) return;
  archiveSyncStarting.value = true;
  try {
    const res = await fetch("/api/archive/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeShorts: true }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Could not start archive sync");
    }
    playSound("toggle");
    toast.success(data.message || "Background archive sync started.");
    await loadArchiveStatus(true);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not start archive sync");
    playSound("error");
  } finally {
    archiveSyncStarting.value = false;
  }
}

async function stopArchiveSync() {
  try {
    await fetch("/api/archive/sync/cancel", { method: "POST" });
    toast.message("Stopping archive sync...");
    await loadArchiveStatus(true);
  } catch {
    toast.error("Could not stop sync");
  }
}

function handoffMomentToClipper(m: ArchiveSearchMatch) {
  vodUrl.value = `https://www.youtube.com/watch?v=${m.videoId}`;
  vodTitle.value = m.title;
  maxClipsStr.value = "3";
  focusNotes.value = `Focus around ${m.startStr}–${m.endStr} (${m.startSec}s): ${m.text.slice(0, 180)}`;
  showAdvanced.value = true;
  activeTab.value = "library";
  playSound("toggle");
  toast.success(`Loaded "${m.title}" at ${m.startStr} into Clipper — press Clip to cut!`);
}

const archiveVideos = computed<ArchiveVideoItem[]>(() => archiveStatus.value?.videos ?? []);

const archiveTypeCounts = computed(() => {
  const counts = { all: 0, live: 0, video: 0, short: 0 };
  for (const v of archiveVideos.value) {
    counts.all += 1;
    if (v.contentType === "live") counts.live += 1;
    else if (v.contentType === "short") counts.short += 1;
    else counts.video += 1;
  }
  return counts;
});

const filteredArchiveVideos = computed<ArchiveVideoItem[]>(() => {
  const list = archiveVideos.value;
  if (archiveContentType.value === "all") return list;
  return list.filter((v) => v.contentType === archiveContentType.value);
});

function clearArchiveSearch() {
  archiveQuery.value = "";
  archiveHasSearched.value = false;
  archiveMatches.value = [];
}

function handoffVideoToClipper(v: ArchiveVideoItem) {
  vodUrl.value = `https://www.youtube.com/watch?v=${v.videoId}`;
  vodTitle.value = v.title;
  maxClipsStr.value = "0";
  focusNotes.value = "";
  activeTab.value = "library";
  playSound("toggle");
  toast.success(`Loaded "${v.title}" into Clipper — press Clip to cut!`);
}

watch(archiveQuery, (val) => {
  if (!val.trim() && archiveHasSearched.value) {
    archiveHasSearched.value = false;
    archiveMatches.value = [];
  }
});

watch(
  () => props.refreshTick,
  () => {
    void loadEcosystem(true);
    void loadArchiveStatus(true);
  }
);

onMounted(() => {
  void loadEcosystem(false);
  void loadArchiveStatus(false);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white text-[#171717]">
    <!-- Top Mode Tabs: Library vs Creator Archive -->
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-black/8 bg-[#FAF9F6] px-4 py-2">
      <div class="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white p-0.5">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="activeTab === 'library' ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
          @click="activeTab = 'library'; playSound('toggle')"
        >
          <Scissors class="size-3.5" aria-hidden="true" />
          <span>Library</span>
          <span
            class="font-mono text-[10.5px] tabular-nums"
            :class="activeTab === 'library' ? 'text-white/75' : 'text-neutral-400'"
          >
            {{ totalClipsCount }}
          </span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="activeTab === 'archive' ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
          @click="activeTab = 'archive'; selectedVideoId = null; selectedClipId = null; playSound('toggle'); loadArchiveStatus(true)"
        >
          <Database class="size-3.5" aria-hidden="true" />
          <span>Archive</span>
          <span
            v-if="archiveStatus?.pinecone?.namespaceVectorCount"
            class="font-mono text-[10.5px] tabular-nums"
            :class="activeTab === 'archive' ? 'text-white/75' : 'text-neutral-400'"
          >
            {{ archiveStatus.pinecone.namespaceVectorCount.toLocaleString() }}
          </span>
        </button>
      </div>

      <div
        v-if="archiveStatus?.sync?.running"
        class="flex items-center gap-1.5 font-mono text-[11px] text-amber-700"
      >
        <Loader2 class="size-3 animate-spin" aria-hidden="true" />
        <span class="truncate max-w-[220px]">{{ archiveStatus.sync.stage }}</span>
      </div>
    </div>

    <!-- ==================== ARCHIVE SEARCH TAB ==================== -->
    <template v-if="activeTab === 'archive'">
      <div class="shrink-0 border-b border-black/8 bg-[#FAF9F6] px-4 py-3">
        <form
          class="flex items-center gap-2 rounded-xl border border-black/12 bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-black/30"
          @submit.prevent="runArchiveSearch"
        >
          <Search class="ml-1 size-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <input
            v-model="archiveQuery"
            type="text"
            placeholder="Search any topic, quote, or moment across all past streams & videos..."
            class="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-[#171717] placeholder:text-neutral-400 focus:outline-none"
            :disabled="archiveSearching"
          />
          <button
            v-if="archiveQuery.trim() || archiveHasSearched"
            type="button"
            class="flex size-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-black/5 hover:text-[#171717]"
            aria-label="Clear search"
            @click="clearArchiveSearch"
          >
            <X class="size-3.5" aria-hidden="true" />
          </button>
          <Button
            type="submit"
            size="sm"
            class="h-7 gap-1.5 rounded-lg bg-[#171717] px-3 text-[11px] font-medium text-white hover:bg-neutral-800"
            :disabled="archiveSearching || !archiveQuery.trim()"
          >
            <Loader2 v-if="archiveSearching" class="size-3.5 animate-spin" aria-hidden="true" />
            <Sparkles v-else class="size-3.5" aria-hidden="true" />
            <span>Search</span>
          </Button>
        </form>

        <!-- Filter Pills + Pinecone Sync Strip -->
        <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1">
            <button
              v-for="opt in ([
                { id: 'all', label: 'All' },
                { id: 'live', label: 'Livestreams' },
                { id: 'video', label: 'Videos' },
                { id: 'short', label: 'Shorts' },
              ] as const)"
              :key="opt.id"
              type="button"
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
              :class="
                archiveContentType === opt.id
                  ? 'bg-[#171717] text-white'
                  : 'bg-black/5 text-neutral-600 hover:bg-black/10 hover:text-[#171717]'
              "
              @click="archiveContentType = opt.id; if (archiveQuery.trim()) runArchiveSearch()"
            >
              <span>{{ opt.label }}</span>
              <span
                v-if="archiveTypeCounts.all > 0"
                class="font-mono text-[10px] tabular-nums"
                :class="archiveContentType === opt.id ? 'text-white/70' : 'text-neutral-400'"
              >
                {{ archiveTypeCounts[opt.id] }}
              </span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
              <span
                class="size-2 rounded-full"
                :class="archiveStatus?.pinecone?.ready ? 'bg-emerald-500' : 'bg-amber-400'"
              />
              <template v-if="archiveStatus?.pinecone?.ready">
                {{ (archiveStatus.pinecone.namespaceVectorCount || 0).toLocaleString() }} moments indexed
              </template>
              <template v-else-if="archiveStatus?.pinecone?.connected">
                Index initializing
              </template>
              <template v-else>
                Pinecone offline
              </template>
            </span>

            <Button
              v-if="archiveStatus?.sync?.running"
              size="xs"
              variant="outline"
              type="button"
              class="h-7 gap-1 rounded-lg text-[11px]"
              @click="stopArchiveSync"
            >
              <Square class="size-3" aria-hidden="true" />
              Stop Sync
            </Button>
            <Button
              v-else
              size="xs"
              variant="outline"
              type="button"
              class="h-7 gap-1 rounded-lg bg-white text-[11px]"
              :disabled="archiveSyncStarting"
              @click="startArchiveSync"
            >
              <RefreshCw class="size-3" :class="archiveSyncStarting ? 'animate-spin' : ''" aria-hidden="true" />
              Sync Channel
            </Button>
          </div>
        </div>

        <!-- Live Sync Progress Bar -->
        <div
          v-if="archiveStatus?.sync?.running"
          class="mt-2.5 rounded-lg border border-black/8 bg-white px-3 py-2"
        >
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span class="font-medium text-[#171717]">
              {{ archiveStatus.sync.stage }}
              <span v-if="archiveStatus.sync.currentTitle" class="font-normal text-neutral-500">
                — {{ archiveStatus.sync.currentTitle }}
              </span>
            </span>
            <span class="font-mono text-neutral-500 tabular-nums">
              {{ archiveStatus.sync.processed }}/{{ archiveStatus.sync.totalToIndex || '?' }}
            </span>
          </div>
          <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              class="h-full rounded-full bg-[#171717] transition-all duration-300"
              :style="{
                width: `${
                  archiveStatus.sync.totalToIndex > 0
                    ? Math.max(6, Math.round((archiveStatus.sync.processed / archiveStatus.sync.totalToIndex) * 100))
                    : 15
                }%`,
              }"
            />
          </div>
        </div>
      </div>

      <!-- Archive Results Scroll Area -->
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div v-if="archiveSearching" class="flex flex-col items-center justify-center gap-2 py-16 text-xs text-neutral-500">
          <Loader2 class="size-5 animate-spin text-neutral-400" aria-hidden="true" />
          <span>Searching &amp; reranking moments across your channel archive...</span>
        </div>

        <div
          v-else-if="archiveMatches.length > 0"
          class="mx-auto flex max-w-4xl flex-col gap-3"
        >
          <div
            v-for="m in archiveMatches"
            :key="m.id"
            class="flex flex-col gap-3 rounded-xl border border-black/8 bg-white p-3 transition-colors hover:border-black/20 sm:flex-row"
          >
            <a
              :href="m.youtubeUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="relative block aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-neutral-100 sm:w-44"
            >
              <img :src="m.thumbUrl" :alt="m.title" class="size-full object-cover" loading="lazy" />
              <span class="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                {{ m.startStr }}
              </span>
            </a>

            <div class="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div>
                <div class="flex items-start justify-between gap-2">
                  <h4 class="line-clamp-1 text-[13px] font-semibold text-[#171717]">
                    {{ m.title || m.videoId }}
                  </h4>
                  <span class="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-800 tabular-nums">
                    {{ Math.round(m.score * 100) }}%
                  </span>
                </div>

                <div class="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-neutral-500">
                  <span class="uppercase">{{ m.contentType }}</span>
                  <span v-if="m.publishedAt">· {{ m.publishedAt }}</span>
                  <span class="inline-flex items-center gap-1">
                    · <Clock class="size-3" aria-hidden="true" /> {{ m.startStr }}–{{ m.endStr }}
                  </span>
                </div>

                <p class="mt-1.5 line-clamp-3 text-xs leading-relaxed text-neutral-700">
                  “{{ m.text }}”
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <a
                  :href="m.youtubeUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/12 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <ExternalLink class="size-3" aria-hidden="true" />
                  Open at {{ m.startStr }}
                </a>
                <Button
                  size="xs"
                  type="button"
                  class="h-7 gap-1 rounded-lg bg-[#171717] px-2.5 text-[11px] text-white hover:bg-neutral-800"
                  @click="handoffMomentToClipper(m)"
                >
                  <Scissors class="size-3" aria-hidden="true" />
                  Clip This Moment
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="archiveHasSearched"
          class="flex flex-col items-center justify-center gap-1.5 py-16 text-center"
        >
          <p class="text-xs font-medium text-[#171717]">No matching moments found</p>
          <p class="text-[11px] text-neutral-500">Try a broader phrase or switch the filter to All.</p>
        </div>

        <div
          v-else-if="archiveLoading && archiveVideos.length === 0"
          class="flex flex-col items-center justify-center gap-2 py-16 text-xs text-neutral-500"
        >
          <Loader2 class="size-5 animate-spin text-neutral-400" aria-hidden="true" />
          <span>Loading indexed channel archive...</span>
        </div>

        <div
          v-else-if="filteredArchiveVideos.length > 0"
          class="mx-auto flex max-w-5xl flex-col gap-3"
        >
          <div class="flex items-center justify-between text-[11px] text-neutral-500">
            <span>
              Showing <strong class="font-semibold text-[#171717]">{{ filteredArchiveVideos.length }}</strong>
              indexed {{ archiveContentType === 'all' ? 'videos & streams' : archiveContentType === 'live' ? 'livestreams' : archiveContentType === 'short' ? 'shorts' : 'videos' }}
            </span>
            <span class="hidden sm:inline">Type a topic above to search exact transcript timestamps</span>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="v in filteredArchiveVideos"
              :key="v.videoId"
              class="group flex flex-col overflow-hidden rounded-xl border border-black/8 bg-white transition-colors hover:border-black/20"
            >
              <a
                :href="`https://www.youtube.com/watch?v=${v.videoId}`"
                target="_blank"
                rel="noopener noreferrer"
                class="relative block aspect-video w-full overflow-hidden bg-neutral-100"
              >
                <img
                  :src="`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`"
                  :alt="v.title || v.videoId"
                  class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
                <span
                  v-if="v.durationSec > 0"
                  class="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white tabular-nums"
                >
                  {{ formatSec(v.durationSec) }}
                </span>
                <span
                  class="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-white uppercase"
                >
                  {{ v.contentType === 'live' ? 'Live' : v.contentType === 'short' ? 'Short' : 'Video' }}
                </span>
              </a>

              <div class="flex flex-1 flex-col justify-between gap-2.5 p-3">
                <div>
                  <h4
                    class="line-clamp-2 text-[12.5px] leading-snug font-semibold text-[#171717]"
                    :title="v.title || v.videoId"
                  >
                    {{ v.title || v.videoId }}
                  </h4>
                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-neutral-500">
                    <span v-if="v.publishedAt">{{ v.publishedAt }}</span>
                    <span v-if="v.status === 'indexed' && v.chunkCount > 0">
                      · {{ v.chunkCount }} {{ v.chunkCount === 1 ? 'moment' : 'moments' }}
                    </span>
                    <span v-else-if="v.status === 'no_captions'" class="text-amber-700">· No captions</span>
                    <span v-else-if="v.status === 'failed'" class="text-red-600">· Failed</span>
                    <span v-else-if="v.status === 'pending' || v.status === 'indexing'" class="text-neutral-400">
                      · {{ v.status }}
                    </span>
                  </div>
                </div>

                <div class="flex items-center gap-1.5">
                  <a
                    :href="`https://www.youtube.com/watch?v=${v.videoId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-black/12 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    <ExternalLink class="size-3" aria-hidden="true" />
                    Watch
                  </a>
                  <Button
                    size="xs"
                    type="button"
                    class="h-7 flex-1 gap-1 rounded-lg bg-[#171717] px-2 text-[11px] text-white hover:bg-neutral-800"
                    @click="handoffVideoToClipper(v)"
                  >
                    <Scissors class="size-3" aria-hidden="true" />
                    Clip
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="archiveVideos.length > 0"
          class="flex flex-col items-center justify-center gap-1.5 py-16 text-center"
        >
          <p class="text-xs font-medium text-[#171717]">No items in this category yet</p>
          <p class="text-[11px] text-neutral-500">Switch back to All or run Sync Channel to discover more.</p>
        </div>

        <div
          v-else
          class="mx-auto flex max-w-lg flex-col items-center justify-center gap-2 py-16 text-center"
        >
          <Database class="size-7 text-neutral-300" aria-hidden="true" />
          <p class="text-xs font-semibold text-[#171717]">Creator Video Archive</p>
          <p class="text-[11.5px] leading-relaxed text-neutral-500">
            Search across every indexed YouTube video, livestream VOD, and short in Indonesian or English — jump to the exact timestamp or send any moment straight into the Clipper.
          </p>
        </div>
      </div>
    </template>

    <!-- ==================== LIBRARY TAB (3-PAGE: VODS -> VOD CLIPS -> CLIP VIEWER) ==================== -->
    <template v-else>
    <!-- PAGE 3: CLIP VIEWER -->
    <template v-if="selectedClip">
      <!-- Sticky Detail Header Bar -->
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-black/8 bg-[#FAF9F6] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <Button
            variant="outline"
            size="xs"
            type="button"
            class="h-7 shrink-0 gap-1 rounded-lg bg-white px-2.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
            @click="closeClipDetail"
          >
            <ArrowLeft class="size-3.5" aria-hidden="true" />
            <span class="max-w-[160px] truncate">{{ selectedVod?.title || "Clips" }}</span>
          </Button>
          <span class="text-neutral-300">/</span>
          <h3 class="truncate text-xs font-semibold text-[#171717]">
            {{ selectedClip.title }}
          </h3>
          <span
            v-if="selectedClip.hookScore !== null"
            class="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-emerald-800"
          >
            Hook {{ selectedClip.hookScore }}/10
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <span
            v-if="selectedClipIndex >= 0 && filteredVodClips.length > 1"
            class="mr-1 font-mono text-[11px] text-neutral-500 tabular-nums"
          >
            {{ selectedClipIndex + 1 }} / {{ filteredVodClips.length }}
          </span>
          <Button
            v-if="filteredVodClips.length > 1"
            variant="outline"
            size="icon"
            type="button"
            class="size-7 rounded-lg bg-white"
            :disabled="selectedClipIndex <= 0"
            title="Previous clip"
            @click="goPrevClip"
          >
            <ChevronLeft class="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            v-if="filteredVodClips.length > 1"
            variant="outline"
            size="icon"
            type="button"
            class="size-7 rounded-lg bg-white"
            :disabled="selectedClipIndex < 0 || selectedClipIndex >= filteredVodClips.length - 1"
            title="Next clip"
            @click="goNextClip"
          >
            <ChevronRight class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <!-- Detail Body: Almost Full-Size Video Stage + Compact Editor Sidebar -->
      <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
        <!-- Left: Full-Height Video Player with Live SRT Caption Overlay + Action Bar -->
        <div class="flex min-h-0 flex-col gap-3 p-3 lg:overflow-hidden">
          <div class="relative flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-black shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <video
              :key="selectedClip.id"
              ref="detailVideoRef"
              :src="selectedClip.mp4Url"
              controls
              preload="metadata"
              class="h-full w-full object-contain"
              @timeupdate="onDetailTimeUpdate"
              @seeked="onDetailTimeUpdate"
            />
            <!-- Live Synced SRT Caption Overlay (Black BG, White Text) -->
            <div
              v-if="activeSrtCue"
              class="pointer-events-none absolute inset-x-4 bottom-14 z-10 flex justify-center"
            >
              <span
                class="max-w-[90%] rounded-md bg-black/85 px-3.5 py-1.5 text-center text-sm font-medium leading-snug text-white shadow-sm sm:text-base"
              >
                {{ activeSrtCue.text }}
              </span>
            </div>
          </div>

          <!-- Metadata & Handoff Actions -->
          <div class="flex shrink-0 flex-wrap items-center justify-between gap-2.5 rounded-xl border border-black/8 bg-[#FAF9F6] px-3.5 py-2">
            <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] text-neutral-600">
              <span
                v-if="selectedClip.startSec !== null && selectedClip.endSec !== null"
                class="inline-flex items-center gap-1 font-medium text-[#171717]"
              >
                <Clock class="size-3 text-neutral-500" aria-hidden="true" />
                {{ formatSec(selectedClip.startSec) }}–{{ formatSec(selectedClip.endSec) }}
              </span>
              <span v-if="selectedClip.durationSec" class="text-neutral-500">
                · {{ formatSec(selectedClip.durationSec) }} ({{ selectedClip.durationSec }}s)
              </span>
              <span v-else-if="selectedClip.sizeBytes" class="text-neutral-500">
                {{ formatBytes(selectedClip.sizeBytes) }}
              </span>
              <span class="text-neutral-400">· CFR 30fps · -14 LUFS</span>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                v-if="srtCues.length > 0"
                variant="outline"
                size="sm"
                type="button"
                class="h-8 gap-1 rounded-lg px-2.5 text-xs font-mono"
                :class="showCaptions ? 'border-[#171717] bg-[#171717] text-white hover:bg-neutral-800 hover:text-white' : 'bg-white text-neutral-700'"
                title="Toggle live SRT caption overlay"
                @click="showCaptions = !showCaptions"
              >
                CC
              </Button>
              <a
                :href="selectedClip.mp4DownloadUrl"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#171717] px-3 text-xs font-medium text-white hover:bg-neutral-800"
              >
                <Download class="size-3.5" aria-hidden="true" />
                Download MP4
              </a>
              <a
                v-if="selectedClip.srtDownloadUrl"
                :href="selectedClip.srtDownloadUrl"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/12 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <Download class="size-3.5" aria-hidden="true" />
                SRT
              </a>
              <a
                v-if="selectedClip.youtubeUrl"
                :href="selectedClip.youtubeUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/12 bg-white px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <ExternalLink class="size-3.5" aria-hidden="true" />
                VOD Jump
              </a>
              <template v-if="selectedClip.record">
                <Button
                  v-if="!selectedClip.boxUrl"
                  variant="outline"
                  size="sm"
                  class="h-8 gap-1.5 rounded-lg bg-white text-xs"
                  :disabled="boxUploadingId === selectedClip.id"
                  @click="sendClipToBox(selectedClip.record)"
                >
                  <Loader2 v-if="boxUploadingId === selectedClip.id" class="size-3.5 animate-spin" aria-hidden="true" />
                  <Box v-else class="size-3.5" aria-hidden="true" />
                  Send to Box
                </Button>
                <Button
                  v-else
                  variant="outline"
                  size="sm"
                  class="h-8 gap-1.5 rounded-lg border-emerald-200 bg-emerald-50 text-xs text-emerald-800"
                  @click="copyBoxUrl(selectedClip.id, selectedClip.boxUrl)"
                >
                  <Check v-if="copiedBoxId === selectedClip.id" class="size-3.5" aria-hidden="true" />
                  <Copy v-else class="size-3.5" aria-hidden="true" />
                  Copy Box Link
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8 rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete clip"
                  @click="removeClipRecord(selectedClip.id)"
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </Button>
              </template>
            </div>
          </div>
        </div>

        <!-- Right: Editor Notes + Synced Transcript (.srt) -->
        <aside class="flex min-h-0 flex-col border-t border-black/8 bg-[#FAF9F6] lg:border-t-0 lg:border-l">
          <!-- Editor Notes Section -->
          <div class="shrink-0 border-b border-black/8 p-4">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-[#171717]">Editor Notes</span>
              <Button
                v-if="selectedClip.editorNotes"
                variant="ghost"
                size="xs"
                type="button"
                class="h-6 gap-1 rounded-md px-2 text-[11px] text-neutral-600 hover:bg-black/5"
                @click="copyEditorNotes(selectedClip.editorNotes)"
              >
                <Check v-if="copiedNotes" class="size-3 text-emerald-700" aria-hidden="true" />
                <Copy v-else class="size-3" aria-hidden="true" />
                <span>{{ copiedNotes ? "Copied" : "Copy" }}</span>
              </Button>
            </div>
            <p
              v-if="selectedClip.editorNotes"
              class="mt-2 rounded-lg border border-black/8 bg-white p-3 text-xs leading-relaxed text-neutral-700"
            >
              {{ selectedClip.editorNotes }}
            </p>
            <p v-else class="mt-2 text-xs text-neutral-400">
              No editor notes recorded for this clip.
            </p>
          </div>

          <!-- Synced Subtitles (.srt) Preview -->
          <div class="flex min-h-0 flex-1 flex-col p-4">
            <div class="mb-2 flex shrink-0 items-center justify-between gap-2">
              <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#171717]">
                <FileText class="size-3.5 text-neutral-500" aria-hidden="true" />
                Transcript
              </span>
              <span v-if="srtCues.length > 0" class="font-mono text-[10.5px] text-neutral-400 tabular-nums">
                {{ srtCues.length }} lines · click to seek
              </span>
            </div>

            <div
              v-if="srtLoading"
              class="flex items-center gap-2 py-6 text-xs text-neutral-500"
            >
              <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
              Loading subtitles...
            </div>
            <div
              v-else-if="srtCues.length > 0"
              class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
            >
              <button
                v-for="cue in srtCues"
                :key="cue.index"
                type="button"
                class="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                :class="activeSrtCue?.index === cue.index ? 'bg-[#171717] text-white' : 'hover:bg-white'"
                @click="seekDetailVideo(cue.startSec)"
              >
                <span
                  class="mt-0.5 shrink-0 font-mono text-[10.5px] font-medium tabular-nums"
                  :class="activeSrtCue?.index === cue.index ? 'text-white/70' : 'text-neutral-400'"
                >
                  {{ cue.startLabel }}
                </span>
                <span
                  class="text-xs leading-relaxed"
                  :class="activeSrtCue?.index === cue.index ? 'text-white font-medium' : 'text-neutral-700'"
                >
                  {{ cue.text }}
                </span>
              </button>
            </div>
            <p v-else class="text-xs text-neutral-400">
              No synced `.srt` transcript available for this clip.
            </p>
          </div>
        </aside>
      </div>
    </template>

    <!-- PAGE 2: ALL CLIPS FROM SELECTED VOD -->
    <template v-else-if="selectedVod">
      <!-- Sticky VOD Header Bar -->
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/8 bg-[#FAF9F6] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <Button
            variant="outline"
            size="xs"
            type="button"
            class="h-7 shrink-0 gap-1 rounded-lg bg-white px-2.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
            @click="closeVod"
          >
            <ArrowLeft class="size-3.5" aria-hidden="true" />
            <span>All VODs</span>
          </Button>
          <h3 class="truncate text-xs font-semibold text-[#171717]">
            {{ selectedVod.title }}
          </h3>
          <span
            v-if="selectedVod.latestJob"
            class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            :class="
              selectedVod.latestJob.status === 'running' || selectedVod.latestJob.status === 'queued'
                ? 'bg-amber-100 text-amber-800'
                : selectedVod.latestJob.status === 'done'
                  ? 'bg-emerald-100 text-emerald-800'
                  : selectedVod.latestJob.status === 'failed'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-neutral-100 text-neutral-600'
            "
          >
            {{ selectedVod.latestJob.stage || selectedVod.latestJob.status }}
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <a
            v-if="selectedVod.vodUrl"
            :href="selectedVod.vodUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <ExternalLink class="size-3" aria-hidden="true" />
            Open VOD
          </a>
          <template v-if="selectedVod.latestJob">
            <Button
              variant="outline"
              size="xs"
              class="h-7 gap-1 rounded-lg bg-white px-2 text-[11px] text-neutral-700"
              @click="expandedJobId = expandedJobId === selectedVod.latestJob.id ? null : selectedVod.latestJob.id"
            >
              <Terminal class="size-3" aria-hidden="true" />
              Log
            </Button>
            <Button
              v-if="selectedVod.latestJob.status === 'running' || selectedVod.latestJob.status === 'queued'"
              variant="outline"
              size="xs"
              class="h-7 gap-1 rounded-lg border-red-200 bg-white px-2 text-[11px] text-red-700 hover:bg-red-50"
              @click="cancelJob(selectedVod.latestJob.id)"
            >
              <Square class="size-2.5" aria-hidden="true" />
              Stop
            </Button>
            <Button
              v-else-if="selectedVod.latestJob.status === 'failed' || selectedVod.latestJob.status === 'cancelled'"
              size="xs"
              class="h-7 gap-1 rounded-lg bg-[#171717] px-2 text-[11px] text-white hover:bg-neutral-800"
              @click="resumeJob(selectedVod.latestJob.id)"
            >
              <RefreshCw class="size-3" aria-hidden="true" />
              Resume
            </Button>
          </template>
        </div>
      </div>

      <!-- Optional Live Job Progress Strip (when job is running) -->
      <div
        v-if="selectedVod.latestJob && (selectedVod.latestJob.status === 'running' || selectedVod.latestJob.status === 'queued')"
        class="shrink-0 border-b border-black/8 bg-amber-50/50 px-4 py-2"
      >
        <div class="flex items-center justify-between gap-2 text-[11px]">
          <span class="flex items-center gap-1.5 font-medium text-amber-900">
            <Loader2 class="size-3 animate-spin" aria-hidden="true" />
            {{ selectedVod.latestJob.progressLog[selectedVod.latestJob.progressLog.length - 1]?.message || selectedVod.latestJob.stage }}
          </span>
          <span class="font-mono text-[10.5px] text-amber-800 tabular-nums">
            {{ selectedVod.clips.length }} ready
          </span>
        </div>
        <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/70">
          <div
            class="h-full rounded-full bg-[#171717] transition-all duration-500"
            :style="{ width: `${jobProgressPercent(selectedVod.latestJob)}%` }"
          />
        </div>
      </div>

      <!-- Expandable Worker Log for Selected VOD -->
      <div
        v-if="selectedVod.latestJob && expandedJobId === selectedVod.latestJob.id"
        class="max-h-44 shrink-0 overflow-y-auto border-b border-black/8 bg-[#FAF9F6] px-4 py-2.5 font-mono text-[11px] text-neutral-600"
      >
        <div v-for="(entry, idx) in selectedVod.latestJob.progressLog" :key="idx" class="flex gap-2 py-0.5">
          <span class="shrink-0 text-neutral-400">{{ entry.at.slice(11, 19) }}</span>
          <span class="shrink-0 font-semibold text-neutral-800">[{{ entry.stage }}]</span>
          <span class="break-words">{{ entry.message }}</span>
        </div>
      </div>

      <!-- Clips Toolbar -->
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-black/8 bg-white px-4 py-2">
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
          <span class="text-[11px] text-neutral-500">
            {{ selectedVod.clips.length }} {{ selectedVod.clips.length === 1 ? "clip" : "clips" }} · CFR 30fps · -14 LUFS
          </span>
        </div>

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

      <!-- Clips List or Grid for Selected VOD -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-if="filteredVodClips.length === 0"
          class="flex flex-col items-center justify-center px-6 py-20 text-center"
        >
          <Film class="mb-3 size-8 text-neutral-300" aria-hidden="true" />
          <p class="text-xs font-semibold text-neutral-700">
            {{ selectedVod.latestJob && (selectedVod.latestJob.status === 'running' || selectedVod.latestJob.status === 'queued') ? "Extracting clips..." : "No clips yet for this VOD" }}
          </p>
          <p class="mt-1 max-w-sm text-[11px] text-neutral-500">
            Clips appear here automatically as Otto cuts, normalizes to -14 LUFS, and generates ElevenLabs Scribe v3 subtitles.
          </p>
        </div>

        <!-- LIST VIEW OF CLIPS -->
        <div v-else-if="viewMode === 'list'" class="w-full">
          <div
            class="sticky top-0 z-10 grid grid-cols-[88px_1fr_72px_130px_190px] items-center gap-3 border-b border-black/8 bg-[#FAF9F6] px-4 py-2 text-[11px] font-semibold text-neutral-500"
          >
            <span>Clip</span>
            <span>Title &amp; Editor Notes</span>
            <span class="text-right">Hook</span>
            <span>Details</span>
            <span class="text-right">Actions</span>
          </div>

          <div
            v-for="clip in filteredVodClips"
            :key="clip.id"
            class="grid grid-cols-[88px_1fr_72px_130px_190px] items-center gap-3 border-b border-black/6 px-4 py-2.5 transition-colors hover:bg-[#FAF9F6]/80"
          >
            <button
              type="button"
              class="group relative aspect-video w-[88px] overflow-hidden rounded-lg border border-black/10 bg-black text-left"
              title="Open clip viewer"
              @click="openClipDetail(clip)"
            >
              <video :src="clip.mp4Url" preload="metadata" muted class="h-full w-full object-cover" />
              <span class="absolute inset-0 flex items-center justify-center bg-black/25 opacity-90 transition-opacity group-hover:bg-black/40">
                <Play class="size-4 fill-white text-white" aria-hidden="true" />
              </span>
            </button>

            <div class="min-w-0">
              <button
                type="button"
                class="block max-w-full truncate text-left text-xs font-semibold text-[#171717] hover:underline"
                @click="openClipDetail(clip)"
              >
                {{ clip.title }}
              </button>
              <p v-if="clip.editorNotes" class="mt-0.5 truncate text-[11px] text-neutral-500">
                {{ clip.editorNotes }}
              </p>
              <p v-else class="mt-0.5 truncate font-mono text-[10px] text-neutral-400">
                {{ clip.filePath }}
              </p>
            </div>

            <div class="text-right">
              <span
                v-if="clip.hookScore !== null"
                class="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-800"
              >
                {{ clip.hookScore }}/10
              </span>
              <span v-else class="font-mono text-[11px] text-neutral-400">—</span>
            </div>

            <div class="font-mono text-[11px] text-neutral-500">
              <template v-if="clip.startSec !== null && clip.endSec !== null">
                <div>{{ formatSec(clip.startSec) }}–{{ formatSec(clip.endSec) }}</div>
                <div v-if="clip.durationSec" class="text-[10px] text-neutral-400">
                  {{ formatSec(clip.durationSec) }} · -14 LUFS
                </div>
              </template>
              <template v-else-if="clip.sizeBytes">
                <div>{{ formatBytes(clip.sizeBytes) }}</div>
                <div class="text-[10px] text-neutral-400">CFR 30fps</div>
              </template>
            </div>

            <div class="flex items-center justify-end gap-1">
              <a
                :href="clip.mp4DownloadUrl"
                class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                title="Download MP4"
              >
                <Download class="size-3" aria-hidden="true" />
                MP4
              </a>
              <a
                v-if="clip.srtDownloadUrl"
                :href="clip.srtDownloadUrl"
                class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                title="Download SRT subtitles"
              >
                SRT
              </a>
              <template v-if="clip.record">
                <Button
                  v-if="!clip.boxUrl"
                  variant="outline"
                  size="icon"
                  class="size-7 rounded-lg"
                  title="Send to Box (Otto Handoffs/)"
                  :disabled="boxUploadingId === clip.id"
                  @click="sendClipToBox(clip.record)"
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
              </template>
            </div>
          </div>
        </div>

        <!-- GRID VIEW OF CLIPS -->
        <div v-else class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="clip in filteredVodClips"
            :key="clip.id"
            class="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white transition-colors hover:border-black/25"
          >
            <button
              type="button"
              class="group relative aspect-video w-full bg-black text-left"
              @click="openClipDetail(clip)"
            >
              <video :src="clip.mp4Url" preload="metadata" muted class="h-full w-full object-cover" />
              <span class="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/35">
                <Play class="size-7 fill-white text-white" aria-hidden="true" />
              </span>
              <span
                v-if="clip.durationSec"
                class="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white tabular-nums"
              >
                {{ formatSec(clip.durationSec) }}
              </span>
            </button>
            <div class="flex flex-1 flex-col gap-2 p-3">
              <div class="flex items-start justify-between gap-2">
                <button
                  type="button"
                  class="text-left text-xs font-semibold leading-snug text-[#171717] hover:underline"
                  @click="openClipDetail(clip)"
                >
                  {{ clip.title }}
                </button>
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
                  :href="clip.mp4DownloadUrl"
                  class="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                >
                  <Download class="size-3" aria-hidden="true" />
                  MP4
                </a>
                <a
                  v-if="clip.srtDownloadUrl"
                  :href="clip.srtDownloadUrl"
                  class="inline-flex h-7 items-center rounded-lg border border-black/10 bg-white px-2 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  SRT
                </a>
                <template v-if="clip.record">
                  <Button
                    v-if="!clip.boxUrl"
                    variant="outline"
                    size="sm"
                    class="h-7 gap-1 rounded-lg px-2 text-[11px]"
                    :disabled="boxUploadingId === clip.id"
                    @click="sendClipToBox(clip.record)"
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
                </template>
              </div>
            </div>
          </article>
        </div>
      </div>
    </template>

    <!-- PAGE 1: VODS LIST VIEW -->
    <template v-else>
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
          {{ vodGroups.length }} {{ vodGroups.length === 1 ? "VOD" : "VODs" }} · {{ totalClipsCount }} {{ totalClipsCount === 1 ? "clip" : "clips" }}
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
            placeholder="Filter VODs..."
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

    <!-- Row 3: Page 1 VODs Surface (List or Grid) -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- Empty State -->
      <div
        v-if="filteredVodGroups.length === 0"
        class="flex flex-col items-center justify-center px-6 py-20 text-center"
      >
        <Film class="mb-3 size-8 text-neutral-300" aria-hidden="true" />
        <p class="text-xs font-semibold text-neutral-700">No VODs clipped yet</p>
        <p class="mt-1 max-w-sm text-[11px] text-neutral-500">
          Paste any YouTube livestream VOD URL in the bar above and press Enter — Otto runs hype detection, full-arc cutting, -14 LUFS prep, and ElevenLabs Scribe v3 subtitles in the background.
        </p>
      </div>

      <!-- VODs LIST VIEW -->
      <div v-else-if="viewMode === 'list'" class="w-full">
        <div
          class="sticky top-0 z-10 grid grid-cols-[104px_1fr_100px_210px] items-center gap-3 border-b border-black/8 bg-[#FAF9F6] px-4 py-2 text-[11px] font-semibold text-neutral-500"
        >
          <span>VOD</span>
          <span>Title &amp; Status</span>
          <span class="text-right">Clips</span>
          <span class="text-right">Actions</span>
        </div>

        <template v-for="vod in filteredVodGroups" :key="vod.videoId">
          <div
            class="grid grid-cols-[104px_1fr_100px_210px] items-center gap-3 border-b border-black/6 px-4 py-3 transition-colors hover:bg-[#FAF9F6]/80"
          >
            <!-- Clickable VOD Thumb -->
            <button
              type="button"
              class="group relative aspect-video w-[104px] overflow-hidden rounded-lg border border-black/10 bg-neutral-100 text-left"
              @click="openVod(vod.videoId)"
            >
              <img
                v-if="vod.videoId && vod.videoId !== 'unknown'"
                :src="youtubeThumb(vod.videoId)"
                alt=""
                class="h-full w-full object-cover"
              />
              <div
                v-if="vod.latestJob && (vod.latestJob.status === 'running' || vod.latestJob.status === 'queued')"
                class="absolute inset-0 flex items-center justify-center bg-black/40"
              >
                <Loader2 class="size-4 animate-spin text-white" aria-hidden="true" />
              </div>
            </button>

            <!-- VOD Title + Status + Progress -->
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="truncate text-left text-xs font-semibold text-[#171717] hover:underline"
                  @click="openVod(vod.videoId)"
                >
                  {{ vod.title }}
                </button>
                <span
                  v-if="vod.latestJob"
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  :class="
                    vod.latestJob.status === 'running' || vod.latestJob.status === 'queued'
                      ? 'bg-amber-100 text-amber-800'
                      : vod.latestJob.status === 'done'
                        ? 'bg-emerald-100 text-emerald-800'
                        : vod.latestJob.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-neutral-100 text-neutral-600'
                  "
                >
                  {{ vod.latestJob.stage || vod.latestJob.status }}
                </span>
              </div>

              <div
                v-if="vod.latestJob && (vod.latestJob.status === 'running' || vod.latestJob.status === 'queued')"
                class="mt-1.5 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-neutral-200"
              >
                <div
                  class="h-full rounded-full bg-[#171717] transition-all duration-500"
                  :style="{ width: `${jobProgressPercent(vod.latestJob)}%` }"
                />
              </div>

              <p v-if="vod.latestJob?.error" class="mt-1 truncate text-[11px] text-red-600">
                {{ vod.latestJob.error }}
              </p>
              <p
                v-else-if="vod.latestJob && vod.latestJob.progressLog.length > 0"
                class="mt-1 truncate text-[11px] text-neutral-500"
              >
                {{ vod.latestJob.progressLog[vod.latestJob.progressLog.length - 1]?.message }}
              </p>
              <p v-else class="mt-1 font-mono text-[10.5px] text-neutral-400">
                {{ vod.videoId }}
              </p>
            </div>

            <!-- Clip Count -->
            <div class="text-right font-mono text-xs font-medium text-neutral-700 tabular-nums">
              {{ vod.clips.length }} {{ vod.clips.length === 1 ? "clip" : "clips" }}
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-end gap-1">
              <Button
                variant="outline"
                size="sm"
                class="h-7 gap-1 rounded-lg bg-white px-2.5 text-[11px] font-medium text-[#171717]"
                @click="openVod(vod.videoId)"
              >
                <span>Open</span>
                <ChevronRight class="size-3" aria-hidden="true" />
              </Button>
              <template v-if="vod.latestJob">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7 rounded-lg text-neutral-500 hover:text-neutral-900"
                  title="Worker log"
                  @click="expandedJobId = expandedJobId === vod.latestJob.id ? null : vod.latestJob.id"
                >
                  <Terminal class="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  v-if="vod.latestJob.status === 'running' || vod.latestJob.status === 'queued'"
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 rounded-lg border-red-200 px-2 text-[11px] text-red-700 hover:bg-red-50"
                  @click="cancelJob(vod.latestJob.id)"
                >
                  <Square class="size-2.5" aria-hidden="true" />
                  Stop
                </Button>
                <template v-else>
                  <Button
                    v-if="vod.latestJob.status === 'failed' || vod.latestJob.status === 'cancelled'"
                    size="sm"
                    class="h-7 gap-1 rounded-lg bg-[#171717] px-2 text-[11px] text-white hover:bg-neutral-800"
                    @click="resumeJob(vod.latestJob.id)"
                  >
                    <RefreshCw class="size-3" aria-hidden="true" />
                    Resume
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 rounded-lg text-neutral-400 hover:text-red-600"
                    title="Remove job from history"
                    @click="removeJob(vod.latestJob.id)"
                  >
                    <Trash2 class="size-3.5" aria-hidden="true" />
                  </Button>
                </template>
              </template>
            </div>
          </div>

          <!-- Expandable Live Worker Log -->
          <div
            v-if="vod.latestJob && expandedJobId === vod.latestJob.id"
            class="border-b border-black/8 bg-[#FAF9F6] px-6 py-2.5 font-mono text-[11px] text-neutral-600"
          >
            <div v-for="(entry, idx) in vod.latestJob.progressLog" :key="idx" class="flex gap-2 py-0.5">
              <span class="shrink-0 text-neutral-400">{{ entry.at.slice(11, 19) }}</span>
              <span class="shrink-0 font-semibold text-neutral-800">[{{ entry.stage }}]</span>
              <span class="break-words">{{ entry.message }}</span>
            </div>
          </div>
        </template>
      </div>

      <!-- VODs GRID VIEW -->
      <div v-else class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="vod in filteredVodGroups"
          :key="vod.videoId"
          class="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white transition-colors hover:border-black/25"
        >
          <button
            type="button"
            class="group relative aspect-video w-full bg-neutral-100 text-left"
            @click="openVod(vod.videoId)"
          >
            <img
              v-if="vod.videoId && vod.videoId !== 'unknown'"
              :src="youtubeThumb(vod.videoId)"
              alt=""
              class="h-full w-full object-cover"
            />
            <span class="absolute right-2 bottom-2 rounded bg-black/80 px-2 py-0.5 font-mono text-[10.5px] font-medium text-white tabular-nums">
              {{ vod.clips.length }} {{ vod.clips.length === 1 ? "clip" : "clips" }}
            </span>
          </button>
          <div class="flex flex-1 flex-col gap-2 p-3">
            <button
              type="button"
              class="line-clamp-2 text-left text-xs font-semibold leading-snug text-[#171717] hover:underline"
              @click="openVod(vod.videoId)"
            >
              {{ vod.title }}
            </button>
            <div class="mt-auto flex items-center justify-between gap-2 pt-1">
              <span
                v-if="vod.latestJob"
                class="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                :class="
                  vod.latestJob.status === 'running' || vod.latestJob.status === 'queued'
                    ? 'bg-amber-100 text-amber-800'
                    : vod.latestJob.status === 'done'
                      ? 'bg-emerald-100 text-emerald-800'
                      : vod.latestJob.status === 'failed'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-neutral-100 text-neutral-600'
                "
              >
                {{ vod.latestJob.stage || vod.latestJob.status }}
              </span>
              <Button
                variant="outline"
                size="xs"
                class="ml-auto h-7 gap-1 rounded-lg bg-white px-2.5 text-[11px]"
                @click="openVod(vod.videoId)"
              >
                <span>Open Clips</span>
                <ChevronRight class="size-3" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </article>
      </div>
    </div>
    </template>
    </template>
  </div>
</template>
