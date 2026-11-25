<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";

export interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  updatedAt: string | null;
  status: string;
}

export interface ClipItem {
  videoId: string;
  name: string;
  filename: string;
  mp4Url: string;
  srtUrl: string | null;
  sizeBytes: number;
  updatedAt: string;
}

const props = defineProps<{
  open: boolean;
  refreshTick: number;
}>();

const emit = defineEmits<{
  close: [];
  askPrompt: [prompt: string];
}>();

const activeTab = ref<"dossier" | "connectors" | "clips">("dossier");
const loading = ref(false);

const dossierContent = ref("");
const dossierUpdatedAt = ref<string | null>(null);
const connectors = ref<ConnectorInfo[]>([]);
const zeroLocalKeys = ref(true);
const aiMediaDisabled = ref(true);
const clips = ref<ClipItem[]>([]);
const previewClipUrl = ref<string | null>(null);

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
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

async function fetchAll() {
  loading.value = true;
  try {
    const [dRes, cRes, clRes] = await Promise.all([
      fetch("/api/dossier").then((r) => r.json()).catch(() => null),
      fetch("/api/connectors").then((r) => r.json()).catch(() => null),
      fetch("/api/clips").then((r) => r.json()).catch(() => null),
    ]);
    if (dRes && typeof dRes === "object") {
      dossierContent.value = String(dRes.content || "");
      dossierUpdatedAt.value = dRes.updatedAt || null;
    }
    if (cRes && typeof cRes === "object") {
      connectors.value = Array.isArray(cRes.connectors) ? cRes.connectors : [];
      zeroLocalKeys.value = cRes.zeroLocalKeys !== false;
      aiMediaDisabled.value = cRes.aiMediaDisabled !== false;
    }
    if (clRes && typeof clRes === "object") {
      clips.value = Array.isArray(clRes.clips) ? clRes.clips : [];
    }
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.refreshTick],
  ([isOpen]) => {
    if (isOpen) fetchAll();
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="open" class="mc-backdrop" @click="emit('close')"></div>

  <aside class="mc-drawer" :class="{ open }">
    <div class="mc-head">
      <div>
        <div class="mc-title">Mission Control</div>
        <div class="mc-sub">Live Sprite State</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-xs btn-outline" type="button" :disabled="loading" @click="fetchAll">
          {{ loading ? "..." : "Refresh" }}
        </button>
        <button class="btn btn-xs btn-ghost" type="button" @click="emit('close')">✕</button>
      </div>
    </div>

    <!-- DaisyUI Tabs -->
    <div role="tablist" class="tabs tabs-border px-3 pt-2 border-b border-base-300 bg-base-100">
      <button
        role="tab"
        type="button"
        class="tab text-xs font-mono"
        :class="{ 'tab-active font-bold': activeTab === 'dossier' }"
        @click="activeTab = 'dossier'"
      >
        Dossier
      </button>
      <button
        role="tab"
        type="button"
        class="tab text-xs font-mono"
        :class="{ 'tab-active font-bold': activeTab === 'connectors' }"
        @click="activeTab = 'connectors'"
      >
        Connectors ({{ connectors.length }})
      </button>
      <button
        role="tab"
        type="button"
        class="tab text-xs font-mono"
        :class="{ 'tab-active font-bold': activeTab === 'clips' }"
        @click="activeTab = 'clips'"
      >
        Clips ({{ clips.length }})
      </button>
    </div>

    <!-- Panel Body -->
    <div class="mc-body">
      <!-- TAB 1: TALENT DOSSIER -->
      <section v-if="activeTab === 'dossier'" class="space-y-3">
        <div class="flex items-center justify-between text-xs font-mono opacity-70">
          <span>Persistent Talent Dossier</span>
          <span v-if="dossierUpdatedAt">Updated {{ formatTime(dossierUpdatedAt) }}</span>
        </div>

        <div
          v-if="dossierHtml"
          class="dossier-md md-content border border-base-300 bg-base-200 p-3 text-sm leading-relaxed"
          v-html="dossierHtml"
        ></div>
        <div v-else class="border border-base-300 bg-base-200 p-4 text-xs font-mono opacity-75">
          No talent dossier recorded yet. Start onboarding with Professor L to populate your Goals,
          Ideal Schedule, 3 GOATs, and 3+1 Stream Tracker.
        </div>

        <button
          class="btn btn-sm btn-outline w-full font-mono"
          type="button"
          @click="emit('askPrompt', 'Review my current goals, schedule, and 3+1 stream tracker and tell me what needs attention next.')"
        >
          Ask Professor L to Audit My Dossier
        </button>
      </section>

      <!-- TAB 2: ZERO-KEY CONNECTORS & GUARDRAILS -->
      <section v-else-if="activeTab === 'connectors'" class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div class="border border-base-300 bg-base-200 p-2.5">
            <div class="text-[11px] font-mono opacity-65">LOCAL API KEYS</div>
            <div class="mt-1 flex items-center gap-1.5 font-mono text-sm font-bold">
              <span class="badge badge-xs badge-success"></span>
              <span>{{ zeroLocalKeys ? "0 Keys in VM" : "Check Env" }}</span>
            </div>
          </div>
          <div class="border border-base-300 bg-base-200 p-2.5">
            <div class="text-[11px] font-mono opacity-65">AI ART &amp; VIDEO</div>
            <div class="mt-1 flex items-center gap-1.5 font-mono text-sm font-bold">
              <span class="badge badge-xs badge-error"></span>
              <span>{{ aiMediaDisabled ? "Disabled" : "Enabled" }}</span>
            </div>
          </div>
        </div>

        <div class="text-xs font-mono opacity-70 pt-1">
          Live Fly.io Sprites Gateway Connectors
        </div>

        <div v-if="connectors.length === 0" class="border border-base-300 bg-base-200 p-3 text-xs font-mono opacity-70">
          No active connectors reported by gateway.
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="c in connectors"
            :key="c.displayName + c.provider"
            class="border border-base-300 bg-base-100 p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-sm">{{ c.displayName }}</span>
              <span class="badge badge-xs badge-success font-mono">LIVE</span>
            </div>
            <div class="mt-1 text-[11px] font-mono opacity-65">
              provider: {{ c.provider }} · auth: {{ c.connectionType }}
            </div>
            <p v-if="c.description" class="mt-1 text-xs opacity-80">
              {{ c.description }}
            </p>
          </div>
        </div>
      </section>

      <!-- TAB 3: RAW CLIP HAND-OFF SHELF -->
      <section v-else class="space-y-3">
        <div class="border border-base-300 bg-base-200 p-2.5 text-xs font-mono">
          Human-Editor Hand-Off Shelf — raw <code>.mp4</code> + synced <code>.srt</code> cuts
          (strictly zero AI video editing).
        </div>

        <div v-if="clips.length === 0" class="border border-base-300 bg-base-200 p-4 text-xs font-mono opacity-75 space-y-2">
          <div>No raw clips cut yet.</div>
          <button
            class="btn btn-xs btn-outline w-full font-mono"
            type="button"
            @click="emit('askPrompt', 'Scan my latest YouTube livestream VOD for the top 3 clippable hype moments.')"
          >
            Scan Latest VOD for Clips
          </button>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="clip in clips"
            :key="clip.mp4Url"
            class="border border-base-300 bg-base-100 p-3 space-y-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-semibold text-sm truncate">{{ clip.name }}</div>
                <div class="text-[11px] font-mono opacity-65">
                  VOD {{ clip.videoId }} · {{ formatBytes(clip.sizeBytes) }} · {{ formatTime(clip.updatedAt) }}
                </div>
              </div>
              <button
                class="btn btn-xs btn-outline font-mono shrink-0"
                type="button"
                @click="previewClipUrl = previewClipUrl === clip.mp4Url ? null : clip.mp4Url"
              >
                {{ previewClipUrl === clip.mp4Url ? "Hide" : "Preview" }}
              </button>
            </div>

            <video
              v-if="previewClipUrl === clip.mp4Url"
              :src="clip.mp4Url"
              controls
              preload="metadata"
              class="w-full border border-base-300 bg-black max-h-56"
            ></video>

            <div class="flex items-center gap-2">
              <a
                :href="`${clip.mp4Url}?download=1`"
                class="btn btn-xs btn-primary font-mono flex-1"
              >
                Download .mp4
              </a>
              <a
                v-if="clip.srtUrl"
                :href="`${clip.srtUrl}?download=1`"
                class="btn btn-xs btn-outline font-mono flex-1"
              >
                Download .srt
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.mc-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  z-index: 25;
}
.mc-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: 92vw;
  background: var(--bg);
  border-left: 1px solid var(--border-strong);
  z-index: 30;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 180ms ease;
}
.mc-drawer.open {
  transform: translateX(0);
}
.mc-head {
  height: var(--header-height);
  flex-shrink: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mc-title {
  font-weight: 700;
  font-size: 14px;
}
.mc-sub {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-muted);
}
.mc-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}
.dossier-md :deep(h1),
.dossier-md :deep(h2),
.dossier-md :deep(h3) {
  font-weight: 700;
  margin: 10px 0 4px;
  font-size: 13px;
}
.dossier-md :deep(h1) {
  font-size: 14px;
  margin-top: 0;
}
.dossier-md :deep(p) {
  margin: 4px 0;
  font-size: 12.5px;
}
.dossier-md :deep(ul),
.dossier-md :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
  font-size: 12.5px;
}
.dossier-md :deep(code) {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--bg);
  padding: 0 3px;
  border: 1px solid var(--border);
}
</style>
