<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  CheckIcon,
  Columns2Icon,
  LayersIcon,
  LayoutGridIcon,
  Maximize2Icon,
  PaletteIcon,
  PencilIcon,
  PlugIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
  Volume2Icon,
  VolumeXIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import OttoMascot from "./OttoMascot.vue";
import { renderMarkdown } from "@/lib/markdown";
import { playSound, setSoundsEnabled, soundsEnabled } from "@/lib/sounds";
import type { WindowManagerInstance } from "@/composables/useWindowManager";

export interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  updatedAt: string | null;
  status: string;
}

export type SettingsTab = "general" | "appearance" | "profile" | "connectors";

const props = defineProps<{
  wm: WindowManagerInstance | null;
  activeTab: SettingsTab;
  refreshTick: number;
  mascotColor: string;
  statusState: "ready" | "busy" | "error";
  swatches: readonly string[];
  creatorName: string;
  timezone: string;
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: SettingsTab];
  selectMascotColor: [color: string];
  identityUpdated: [payload: { creatorName: string; timezone: string }];
  openSetup: [];
  askPrompt: [prompt: string];
}>();

const NAV_ITEMS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "profile", label: "Profile" },
  { id: "connectors", label: "Connectors" },
];

const editingIdentity = ref(false);
const draftCreatorName = ref("");
const draftTimezone = ref("");
const savingIdentity = ref(false);
const identityError = ref("");

const allTimezones: string[] = (() => {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch {
    // fallback
  }
  return [
    "Asia/Jakarta",
    "Asia/Makassar",
    "Asia/Jayapura",
    "Asia/Tokyo",
    "UTC",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
  ];
})();

function startEditIdentity() {
  draftCreatorName.value = props.creatorName || "";
  draftTimezone.value = props.timezone || "";
  identityError.value = "";
  editingIdentity.value = true;
}

async function saveIdentity() {
  if (savingIdentity.value) return;
  savingIdentity.value = true;
  identityError.value = "";
  try {
    const res = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorName: draftCreatorName.value.trim(),
        timezone: draftTimezone.value.trim(),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      identityError.value = data.error || "Failed to update profile";
      return;
    }
    emit("identityUpdated", {
      creatorName: draftCreatorName.value.trim(),
      timezone: draftTimezone.value.trim(),
    });
    editingIdentity.value = false;
    await fetchData();
  } catch (err) {
    identityError.value = err instanceof Error ? err.message : "Failed to update profile";
  } finally {
    savingIdentity.value = false;
  }
}

const dossierContent = ref("");
const dossierUpdatedAt = ref<string | null>(null);
const connectors = ref<ConnectorInfo[]>([]);
const zeroLocalKeys = ref(true);
const aiMediaDisabled = ref(true);
const loading = ref(false);
const probingOllama = ref(false);

interface LlmRouterStatus {
  ollamaConnected: boolean;
  geminiConnected: boolean;
  ollamaModel: string;
  geminiFallbackModel: string;
  activeProvider: "ollama" | "gemini-fallback" | "gemini";
  circuitOpen: boolean;
  cooldownRemainingSec: number;
  lastFailureStatus: number | null;
  lastFailureReason: string | null;
  lastProviderUsed: string | null;
  stats: {
    ollamaAttempts: number;
    ollamaSuccesses: number;
    fallbackSuccesses: number;
  };
}
const llmRouter = ref<LlmRouterStatus | null>(null);

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

function resolveConnectorIcon(conn: ConnectorInfo): string | null {
  const hay = `${conn.provider} ${conn.displayName}`.toLowerCase();
  if (hay.includes("apify")) return "/apify.svg";
  if (hay.includes("box")) return "/box.svg";
  if (hay.includes("buffer")) return "/buffer.svg";
  if (hay.includes("composio")) return "/composio.svg";
  if (hay.includes("exa")) return "/exa.svg";
  if (hay.includes("firecrawl")) return "/firecrawl.svg";
  if (hay.includes("gemini") || hay.includes("google")) return "/google-gemini.svg";
  if (hay.includes("neon")) return "/neon.svg";
  if (hay.includes("fly") || hay.includes("machine") || hay.includes("obs")) return "/obs-overlay-fly.svg";
  if (hay.includes("pinecone")) return "/pinecone.svg";
  if (hay.includes("qstash") || hay.includes("upstash")) return "/qstash-upstash.svg";
  return null;
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

async function fetchData() {
  loading.value = true;
  try {
    const [dRes, cRes, rRes] = await Promise.all([
      fetch("/api/dossier").then((r) => r.json()).catch(() => null),
      fetch("/api/connectors").then((r) => r.json()).catch(() => null),
      fetch("/api/llm/router-status").then((r) => r.json()).catch(() => null),
    ]);
    if (dRes && typeof dRes === "object") {
      dossierContent.value = String(dRes.content || "");
      dossierUpdatedAt.value = dRes.updatedAt || null;
    }
    if (cRes && typeof cRes === "object") {
      connectors.value = Array.isArray(cRes.connectors) ? cRes.connectors : [];
      if (typeof cRes.zeroLocalKeys === "boolean") zeroLocalKeys.value = cRes.zeroLocalKeys;
      if (typeof cRes.aiMediaDisabled === "boolean") aiMediaDisabled.value = cRes.aiMediaDisabled;
    }
    if (rRes && typeof rRes === "object" && rRes.router) {
      llmRouter.value = rRes.router as LlmRouterStatus;
    }
  } finally {
    loading.value = false;
  }
}

async function probeOllama() {
  if (probingOllama.value) return;
  probingOllama.value = true;
  try {
    const res = await fetch("/api/llm/router-probe", { method: "POST" });
    const data = (await res.json().catch(() => null)) as { router?: LlmRouterStatus } | null;
    if (data?.router) llmRouter.value = data.router;
  } finally {
    probingOllama.value = false;
  }
}

onMounted(() => {
  void fetchData();
});

watch(
  () => props.refreshTick,
  () => {
    void fetchData();
  }
);
</script>

<template>
  <div class="flex h-full min-h-0 bg-white text-[#171717]">
    <!-- Left Native Preferences Sidebar -->
    <aside class="hidden w-[196px] shrink-0 flex-col border-r border-black/8 bg-[#FAF9F6] p-2.5 sm:flex">
      <nav class="flex flex-col gap-0.5" aria-label="Settings sections">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors"
          :class="
            activeTab === item.id
              ? 'bg-[#171717] text-white'
              : 'text-neutral-700 hover:bg-black/5'
          "
          @click="emit('update:activeTab', item.id)"
        >
          <span class="flex items-center gap-2">
            <SettingsIcon v-if="item.id === 'general'" class="size-3.5 shrink-0" />
            <PaletteIcon v-else-if="item.id === 'appearance'" class="size-3.5 shrink-0" />
            <UserIcon v-else-if="item.id === 'profile'" class="size-3.5 shrink-0" />
            <PlugIcon v-else class="size-3.5 shrink-0" />
            <span>{{ item.label }}</span>
          </span>
          <span
            v-if="item.id === 'connectors' && connectors.length > 0"
            class="font-mono text-[10.5px] tabular-nums"
            :class="activeTab === item.id ? 'text-white/75' : 'text-neutral-400'"
          >
            {{ connectors.length }}
          </span>
        </button>
      </nav>
    </aside>

    <!-- Right Settings Pane -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <!-- Mobile Section Strip -->
      <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-black/8 bg-[#FAF9F6] px-3 py-1.5 sm:hidden">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          class="rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap"
          :class="activeTab === item.id ? 'bg-[#171717] text-white' : 'text-neutral-600'"
          @click="emit('update:activeTab', item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <div class="mx-auto flex max-w-2xl flex-col gap-6">
          <!-- ==================== GENERAL ==================== -->
          <template v-if="activeTab === 'general'">
            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-xs font-semibold text-[#171717]">Studio Identity</h3>
                <div class="flex items-center gap-1.5">
                  <Button
                    v-if="!editingIdentity"
                    size="xs"
                    variant="outline"
                    type="button"
                    class="h-7 gap-1 rounded-lg text-[11px]"
                    @click="startEditIdentity"
                  >
                    <PencilIcon class="size-3" />
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    type="button"
                    class="h-7 gap-1 rounded-lg text-[11px]"
                    @click="emit('openSetup')"
                  >
                    <SparklesIcon class="size-3" />
                    Re-run Setup Wizard
                  </Button>
                </div>
              </div>

              <div class="overflow-hidden rounded-xl border border-black/8 bg-[#FAF9F6]/60">
                <form v-if="editingIdentity" class="flex flex-col gap-3 p-4" @submit.prevent="saveIdentity">
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1">
                      <span class="font-mono text-[10.5px] text-neutral-500">Creator</span>
                      <input
                        v-model="draftCreatorName"
                        type="text"
                        class="h-8 rounded-lg border border-black/15 bg-white px-2.5 font-mono text-xs text-[#171717] outline-none focus:border-[#171717]"
                        placeholder="Creator name / persona"
                      />
                    </label>
                    <label class="flex flex-col gap-1">
                      <span class="font-mono text-[10.5px] text-neutral-500">Timezone (IANA)</span>
                      <input
                        v-model="draftTimezone"
                        type="text"
                        list="settings-tz-list"
                        class="h-8 rounded-lg border border-black/15 bg-white px-2.5 font-mono text-xs text-[#171717] outline-none focus:border-[#171717]"
                        placeholder="Asia/Jakarta"
                      />
                      <datalist id="settings-tz-list">
                        <option v-for="tz in allTimezones" :key="tz" :value="tz" />
                      </datalist>
                    </label>
                  </div>
                  <div v-if="identityError" class="font-mono text-xs text-red-700">{{ identityError }}</div>
                  <div class="flex items-center justify-end gap-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      type="button"
                      class="h-7 rounded-lg text-[11px]"
                      :disabled="savingIdentity"
                      @click="editingIdentity = false"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      type="submit"
                      class="h-7 gap-1 rounded-lg text-[11px]"
                      :disabled="savingIdentity"
                    >
                      <CheckIcon class="size-3" />
                      {{ savingIdentity ? "Saving..." : "Save to MEMORY.md" }}
                    </Button>
                  </div>
                </form>

                <div v-else class="divide-y divide-black/6">
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <span class="text-xs text-neutral-500">Creator</span>
                    <span class="font-mono text-xs font-medium text-[#171717]">
                      {{ creatorName || "Not configured" }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-4 py-3">
                    <span class="text-xs text-neutral-500">Timezone</span>
                    <span class="font-mono text-xs font-medium text-[#171717]">
                      {{ timezone || "Browser local" }}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-[#171717]">Keyboard Shortcuts</h3>
              <div class="divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 bg-[#FAF9F6]/60">
                <div class="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span class="text-neutral-600">Spotlight Launcher</span>
                  <kbd class="rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[11px] text-[#171717]">
                    {{ wm?.shortcutLabels.value.spotlight ?? "Ctrl+K" }}
                  </kbd>
                </div>
                <div class="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span class="text-neutral-600">Toggle Desktop Apps</span>
                  <kbd class="rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[11px] text-[#171717]">
                    {{ wm?.shortcutLabels.value.altPrefix ?? "Alt+" }}1–9
                  </kbd>
                </div>
                <div class="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span class="text-neutral-600">Tile 2-Up</span>
                  <kbd class="rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[11px] text-[#171717]">
                    {{ wm?.shortcutLabels.value.tile ?? "Alt+Shift+T" }}
                  </kbd>
                </div>
                <div class="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span class="text-neutral-600">Show Desktop</span>
                  <kbd class="rounded-md border border-black/10 bg-white px-2 py-0.5 font-mono text-[11px] text-[#171717]">
                    {{ wm?.shortcutLabels.value.desktop ?? "Alt+Shift+D" }}
                  </kbd>
                </div>
              </div>
            </section>
          </template>

          <!-- ==================== APPEARANCE ==================== -->
          <template v-else-if="activeTab === 'appearance'">
            <section class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-[#171717]">Otto Mascot</h3>
              <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/8 bg-[#FAF9F6]/60 px-4 py-3.5">
                <div class="flex items-center gap-3.5">
                  <OttoMascot :size="48" :color="mascotColor" :state="statusState" />
                  <div>
                    <div class="text-xs font-medium text-[#171717]">Sphere Color</div>
                    <div class="text-[11px] text-neutral-500">
                      Applied across Otto Chat and the desktop companion.
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    v-for="sw in swatches"
                    :key="sw"
                    type="button"
                    class="size-6 rounded-full border-2 transition-transform hover:scale-110"
                    :class="mascotColor === sw ? 'scale-110 border-[#171717]' : 'border-black/15'"
                    :style="{ background: sw }"
                    :aria-label="`Set Otto color ${sw}`"
                    @click="playSound('toggle'); emit('selectMascotColor', sw)"
                  />
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-[#171717]">Sound Effects</h3>
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/8 bg-[#FAF9F6]/60 px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <Volume2Icon v-if="soundsEnabled" class="size-4 shrink-0 text-[#171717]" />
                  <VolumeXIcon v-else class="size-4 shrink-0 text-neutral-400" />
                  <div>
                    <div class="text-xs font-medium text-[#171717]">Tactile UI Audio</div>
                    <div class="text-[11px] text-neutral-500">
                      Subtle desk feedback for windows, chat, and background jobs. Mute anytime from the top bar when live in OBS.
                    </div>
                  </div>
                </div>
                <div
                  data-settings-sounds-toggle
                  class="inline-flex items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5"
                >
                  <button
                    type="button"
                    class="rounded-md px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors"
                    :class="soundsEnabled ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
                    @click="setSoundsEnabled(true)"
                  >
                    On
                  </button>
                  <button
                    type="button"
                    class="rounded-md px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors"
                    :class="!soundsEnabled ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
                    @click="setSoundsEnabled(false)"
                  >
                    Muted
                  </button>
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-xs font-semibold text-[#171717]">Window Controls &amp; Layouts</h3>
              <div class="divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 bg-[#FAF9F6]/60">
                <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div class="text-xs font-medium text-[#171717]">Titlebar Controls</div>
                    <div class="text-[11px] text-neutral-500">Choose macOS left traffic lights or Windows right controls.</div>
                  </div>
                  <div
                    v-if="wm"
                    data-settings-controls-mode
                    class="inline-flex items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5"
                  >
                    <button
                      type="button"
                      data-controls-mode="auto"
                      class="rounded-md px-2 py-1 font-mono text-[10.5px] font-medium transition-colors"
                      :class="wm.controlsMode.value === 'auto' ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
                      @click="playSound('toggle'); wm.setControlsMode('auto')"
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      data-controls-mode="mac"
                      class="rounded-md px-2 py-1 font-mono text-[10.5px] font-medium transition-colors"
                      :class="wm.controlsMode.value === 'mac' ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
                      @click="playSound('toggle'); wm.setControlsMode('mac')"
                    >
                      macOS
                    </button>
                    <button
                      type="button"
                      data-controls-mode="windows"
                      class="rounded-md px-2 py-1 font-mono text-[10.5px] font-medium transition-colors"
                      :class="wm.controlsMode.value === 'windows' ? 'bg-[#171717] text-white' : 'text-neutral-600 hover:text-[#171717]'"
                      @click="playSound('toggle'); wm.setControlsMode('windows')"
                    >
                      Windows
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-2.5 px-4 py-3">
                  <div class="text-xs font-medium text-[#171717]">Quick Window Layouts</div>
                  <div class="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" type="button" class="h-7 gap-1 rounded-lg bg-white text-[11px]" @click="wm?.applyPreset('tile-2up')">
                      <Columns2Icon class="size-3" />
                      Tile 2-Up
                    </Button>
                    <Button size="xs" variant="outline" type="button" class="h-7 gap-1 rounded-lg bg-white text-[11px]" @click="wm?.applyPreset('focus-chat')">
                      <Maximize2Icon class="size-3" />
                      Focus Otto
                    </Button>
                    <Button size="xs" variant="outline" type="button" class="h-7 gap-1 rounded-lg bg-white text-[11px]" @click="wm?.applyPreset('cascade')">
                      <LayersIcon class="size-3" />
                      Cascade
                    </Button>
                    <Button size="xs" variant="outline" type="button" class="h-7 gap-1 rounded-lg bg-white text-[11px]" @click="wm?.applyPreset('show-desktop')">
                      <LayoutGridIcon class="size-3" />
                      Show Desktop
                    </Button>
                    <Button size="xs" variant="outline" type="button" class="h-7 gap-1 rounded-lg bg-white text-[11px]" @click="wm?.applyPreset('reset')">
                      <RotateCcwIcon class="size-3" />
                      Reset Layout
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </template>

          <!-- ==================== PROFILE (MEMORY.MD) ==================== -->
          <template v-else-if="activeTab === 'profile'">
            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h3 class="text-xs font-semibold text-[#171717]">Talent Dossier (MEMORY.md)</h3>
                  <p v-if="dossierUpdatedAt" class="font-mono text-[10.5px] text-neutral-400">
                    Updated {{ formatTime(dossierUpdatedAt) }}
                  </p>
                </div>
                <Button
                  size="xs"
                  type="button"
                  class="h-7 gap-1 rounded-lg text-[11px]"
                  @click="emit('askPrompt', 'Review my studio profile and ask me if anything is outdated or missing.')"
                >
                  <SparklesIcon class="size-3" />
                  Audit with Otto
                </Button>
              </div>

              <div class="rounded-xl border border-black/8 bg-[#FAF9F6]/60 p-4">
                <div
                  v-if="dossierHtml"
                  class="prose-dossier text-[13px] leading-relaxed text-[#171717]"
                  v-html="dossierHtml"
                />
                <div v-else class="font-mono text-xs text-neutral-500">
                  No creator profile recorded yet. Tell Otto about your channel in chat or run the Setup Wizard.
                </div>
              </div>
            </section>
          </template>

          <!-- ==================== CONNECTORS & SECURITY ==================== -->
          <template v-else>
            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <ShieldCheckIcon class="size-4 text-[#171717]" />
                  <h3 class="text-xs font-semibold text-[#171717]">Runtime Security Guardrails</h3>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  type="button"
                  class="h-7 gap-1 rounded-lg bg-white text-[11px]"
                  :disabled="loading"
                  @click="fetchData"
                >
                  <RefreshCwIcon class="size-3" :class="loading ? 'animate-spin' : ''" />
                  Refresh
                </Button>
              </div>

              <div class="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 bg-[#FAF9F6]/60 p-3.5 font-mono text-[11px]">
                <span
                  class="rounded-lg border px-2.5 py-1"
                  :class="
                    zeroLocalKeys
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  "
                >
                  {{ zeroLocalKeys ? "Zero local API keys verified" : "Local keys detected" }}
                </span>
                <span
                  class="rounded-lg border px-2.5 py-1"
                  :class="
                    aiMediaDisabled
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  "
                >
                  {{ aiMediaDisabled ? "AI art & video generation disabled" : "AI media enabled" }}
                </span>
                <span class="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-neutral-700">
                  Fly.io Sprite · $0 idle
                </span>
              </div>
            </section>

            <section v-if="llmRouter" class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-xs font-semibold text-[#171717]">Hybrid LLM Router (Ollama → Gemini)</h3>
                <Button
                  size="xs"
                  variant="outline"
                  type="button"
                  class="h-7 gap-1 rounded-lg bg-white text-[11px]"
                  :disabled="probingOllama"
                  @click="probeOllama"
                >
                  <RefreshCwIcon class="size-3" :class="probingOllama ? 'animate-spin' : ''" />
                  {{ probingOllama ? "Probing..." : "Test Ollama" }}
                </Button>
              </div>

              <div class="flex flex-col gap-2 rounded-xl border border-black/8 bg-[#FAF9F6]/60 p-3.5 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-mono text-[11px] text-[#171717]">
                    Primary: <span class="font-semibold">{{ llmRouter.ollamaModel }}</span> (Ollama) →
                    Fallback: <span class="font-semibold">{{ llmRouter.geminiFallbackModel }}</span> (Gemini)
                  </div>
                  <span
                    class="rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium"
                    :class="
                      llmRouter.activeProvider === 'ollama'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    "
                  >
                    {{
                      llmRouter.activeProvider === "ollama"
                        ? "Ollama active"
                        : llmRouter.activeProvider === "gemini-fallback"
                          ? `Gemini fallback (${llmRouter.cooldownRemainingSec}s cooldown)`
                          : "Gemini direct"
                    }}
                  </span>
                </div>
                <div class="font-mono text-[10.5px] text-neutral-500">
                  Roles: smol · memory · autorename · tiny · commit · widget ·
                  Ollama attempts: {{ llmRouter.stats.ollamaAttempts }} ({{ llmRouter.stats.ollamaSuccesses }} ok) ·
                  Gemini fallbacks: {{ llmRouter.stats.fallbackSuccesses }}
                </div>
                <div
                  v-if="llmRouter.lastFailureReason"
                  class="rounded-lg border border-amber-200/80 bg-amber-50/70 px-2.5 py-1.5 font-mono text-[10.5px] text-amber-900"
                >
                  Last Ollama probe{{ llmRouter.lastFailureStatus ? ` (HTTP ${llmRouter.lastFailureStatus})` : "" }}:
                  {{ llmRouter.lastFailureReason }}
                </div>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <h3 class="text-xs font-semibold text-[#171717]">Sprites Connectors</h3>
                <span class="font-mono text-[11px] text-neutral-400">
                  {{ connectors.length }} active
                </span>
              </div>

              <div
                v-if="connectors.length === 0"
                class="rounded-xl border border-black/8 bg-[#FAF9F6]/60 px-4 py-8 text-center font-mono text-xs text-neutral-500"
              >
                No Sprites Connectors detected yet.
              </div>

              <div
                v-else
                class="divide-y divide-black/6 overflow-hidden rounded-xl border border-black/8 bg-[#FAF9F6]/40"
              >
                <div
                  v-for="conn in connectors"
                  :key="`${conn.provider}-${conn.displayName}`"
                  class="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-white"
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/8 bg-white p-1.5">
                      <img
                        v-if="resolveConnectorIcon(conn)"
                        :src="resolveConnectorIcon(conn)!"
                        :alt="conn.displayName || conn.provider"
                        class="size-5 object-contain"
                      />
                      <PlugIcon v-else class="size-4 text-neutral-500" />
                    </div>
                    <div class="min-w-0">
                      <div class="truncate font-mono text-xs font-semibold text-[#171717]">
                        {{ conn.displayName || conn.provider }}
                      </div>
                      <div v-if="conn.description" class="truncate text-[11px] text-neutral-500">
                        {{ conn.description }}
                      </div>
                    </div>
                  </div>
                  <span class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-800">
                    {{ conn.status || "connected" }}
                  </span>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prose-dossier :deep(h1),
.prose-dossier :deep(h2),
.prose-dossier :deep(h3) {
  font-family: var(--font-mono);
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.4rem;
}
.prose-dossier :deep(h1) {
  font-size: 0.95rem;
}
.prose-dossier :deep(h2) {
  font-size: 0.85rem;
}
.prose-dossier :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
  margin: 0.35rem 0;
}
.prose-dossier :deep(p) {
  margin: 0.35rem 0;
}
</style>
