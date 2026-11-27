<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  CheckIcon,
  Columns2Icon,
  LayersIcon,
  LayoutGridIcon,
  Maximize2Icon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import OttoMascot from "./OttoMascot.vue";
import { renderMarkdown } from "@/lib/markdown";
import type { WindowManagerInstance } from "@/composables/useWindowManager";

export interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  updatedAt: string | null;
  status: string;
}

export type SettingsTab = "general" | "profile" | "connectors";

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
  return ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Tokyo", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London"];
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

const dossierHtml = computed(() =>
  dossierContent.value.trim() ? renderMarkdown(dossierContent.value) : ""
);

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
    const [dRes, cRes] = await Promise.all([
      fetch("/api/dossier").then((r) => r.json()).catch(() => null),
      fetch("/api/connectors").then((r) => r.json()).catch(() => null),
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
  } finally {
    loading.value = false;
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
  <div class="flex h-full flex-col gap-4 overflow-y-auto bg-[#fafafa]/60 p-4">
    <!-- TAB 1: GENERAL -->
    <template v-if="activeTab === 'general'">
      <!-- Otto Appearance -->
      <div class="otto-card p-4">
        <div class="mb-3 font-mono text-xs font-semibold text-[#303030]">
          Otto Appearance
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <OttoMascot :size="54" :color="mascotColor" :state="statusState" />
          <div class="flex flex-col gap-2">
            <div class="text-xs text-[#666]">
              Choose Otto's studio sphere color across windows and desktop companion.
            </div>
            <div class="flex items-center gap-2">
              <button
                v-for="sw in swatches"
                :key="sw"
                type="button"
                class="size-6 rounded-full border-2 transition-transform hover:scale-110"
                :class="mascotColor === sw ? 'border-[#303030] scale-110' : 'border-black/15'"
                :style="{ background: sw }"
                :aria-label="`Set Otto color ${sw}`"
                @click="emit('selectMascotColor', sw)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Studio Identity & Onboarding -->
      <div class="otto-card p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="font-mono text-xs font-semibold text-[#303030]">
            Studio Profile &amp; Onboarding
          </span>
          <div class="flex items-center gap-1.5">
            <Button
              v-if="!editingIdentity"
              size="xs"
              variant="secondary"
              type="button"
              @click="startEditIdentity"
            >
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
            <Button size="xs" type="button" @click="emit('openSetup')">
              <SparklesIcon data-icon="inline-start" />
              Re-run Setup Wizard
            </Button>
          </div>
        </div>

        <form v-if="editingIdentity" class="flex flex-col gap-3" @submit.prevent="saveIdentity">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 font-mono text-xs">
            <label class="flex flex-col gap-1">
              <span class="text-[10.5px] text-[#777]">CREATOR</span>
              <input
                v-model="draftCreatorName"
                type="text"
                class="h-8 rounded-xl border border-[#d9d9d9] bg-white px-3 font-mono text-xs text-[#303030] outline-none focus:border-[#303030]"
                placeholder="Creator name / persona"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[10.5px] text-[#777]">TIMEZONE (IANA)</span>
              <input
                v-model="draftTimezone"
                type="text"
                list="settings-tz-list"
                class="h-8 rounded-xl border border-[#d9d9d9] bg-white px-3 font-mono text-xs text-[#303030] outline-none focus:border-[#303030]"
                placeholder="Asia/Jakarta"
              />
              <datalist id="settings-tz-list">
                <option v-for="tz in allTimezones" :key="tz" :value="tz" />
              </datalist>
            </label>
          </div>
          <div v-if="identityError" class="font-mono text-xs text-[#991b1b]">{{ identityError }}</div>
          <div class="flex items-center justify-end gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              type="button"
              :disabled="savingIdentity"
              @click="editingIdentity = false"
            >
              Cancel
            </Button>
            <Button size="xs" type="submit" :disabled="savingIdentity">
              <CheckIcon data-icon="inline-start" />
              {{ savingIdentity ? "Saving..." : "Save to Profile" }}
            </Button>
          </div>
        </form>

        <div v-else class="grid grid-cols-2 gap-3 font-mono text-xs">
          <div class="rounded-xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="text-[10.5px] text-[#777]">CREATOR</div>
            <div class="mt-0.5 font-semibold text-[#303030]">
              {{ creatorName || "Not configured" }}
            </div>
          </div>
          <div class="rounded-xl border border-[#ededed] bg-[#fafafa] p-3">
            <div class="text-[10.5px] text-[#777]">TIMEZONE</div>
            <div class="mt-0.5 font-semibold text-[#303030]">
              {{ timezone || "Browser local" }}
            </div>
          </div>
        </div>
      </div>

      <!-- Window Layouts, Controls & Shortcuts -->
      <div class="otto-card p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="font-mono text-xs font-semibold text-[#303030]">
            Window Controls &amp; Layouts
          </span>
          <div
            v-if="wm"
            data-settings-controls-mode
            class="flex items-center gap-0.5 rounded-full bg-[#f2f2f2] p-0.5"
          >
            <button
              type="button"
              data-controls-mode="auto"
              class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
              :class="
                wm.controlsMode.value === 'auto'
                  ? 'bg-[#303030] text-white'
                  : 'text-[#666] hover:text-[#303030]'
              "
              @click="wm.setControlsMode('auto')"
            >
              Auto ({{ wm.detectedPlatform === 'mac' ? 'macOS' : 'Windows' }})
            </button>
            <button
              type="button"
              data-controls-mode="mac"
              class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
              :class="
                wm.controlsMode.value === 'mac'
                  ? 'bg-[#303030] text-white'
                  : 'text-[#666] hover:text-[#303030]'
              "
              @click="wm.setControlsMode('mac')"
            >
              macOS (Left)
            </button>
            <button
              type="button"
              data-controls-mode="windows"
              class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
              :class="
                wm.controlsMode.value === 'windows'
                  ? 'bg-[#303030] text-white'
                  : 'text-[#666] hover:text-[#303030]'
              "
              @click="wm.setControlsMode('windows')"
            >
              Windows (Right)
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" type="button" @click="wm?.applyPreset('tile-2up')">
            <Columns2Icon data-icon="inline-start" />
            Tile 2-Up
          </Button>
          <Button size="xs" variant="secondary" type="button" @click="wm?.applyPreset('focus-chat')">
            <Maximize2Icon data-icon="inline-start" />
            Focus Otto
          </Button>
          <Button size="xs" variant="secondary" type="button" @click="wm?.applyPreset('cascade')">
            <LayersIcon data-icon="inline-start" />
            Cascade
          </Button>
          <Button size="xs" variant="secondary" type="button" @click="wm?.applyPreset('show-desktop')">
            <LayoutGridIcon data-icon="inline-start" />
            Show Desktop
          </Button>
          <Button size="xs" variant="outline" type="button" @click="wm?.applyPreset('reset')">
            <RotateCcwIcon data-icon="inline-start" />
            Reset Layout
          </Button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-[#666]">
          <div>
            <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
              {{ wm?.shortcutLabels.value.spotlight ?? 'Ctrl+K' }}
            </kbd>
            Spotlight
          </div>
          <div>
            <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
              {{ wm?.shortcutLabels.value.altPrefix ?? 'Alt+' }}1–8
            </kbd>
            Toggle Apps
          </div>
          <div>
            <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
              {{ wm?.shortcutLabels.value.tile ?? 'Alt+Shift+T' }}
            </kbd>
            Tile 2-Up
          </div>
          <div>
            <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
              {{ wm?.shortcutLabels.value.desktop ?? 'Alt+Shift+D' }}
            </kbd>
            Show Desktop
          </div>
        </div>
      </div>
    </template>

    <!-- TAB 2: CREATOR PROFILE / DOSSIER -->
    <template v-else-if="activeTab === 'profile'">
      <div class="otto-card">
        <div class="otto-card-head">
          <span>(Y)our profile.</span>
          <div class="otto-card-head-right flex items-center gap-2">
            <span v-if="dossierUpdatedAt" class="font-mono text-[10.5px] text-[#808080]">
              Updated {{ formatTime(dossierUpdatedAt) }}
            </span>
            <Button
              size="xs"
              type="button"
              @click="emit('askPrompt', 'Review my studio profile and ask me if anything is outdated or missing.')"
            >
              Audit Profile
            </Button>
          </div>
        </div>
        <div class="otto-card-body">
          <div
            v-if="dossierHtml"
            class="prose-dossier text-[13.5px] leading-relaxed text-[#303030]"
            v-html="dossierHtml"
          />
          <div v-else class="font-mono text-xs text-[#808080]">
            No creator profile recorded yet. Tell Otto about your channel in chat or run the Setup Wizard.
          </div>
        </div>
      </div>
    </template>

    <!-- TAB 3: SPRITES CONNECTORS & GUARDRAILS -->
    <template v-else>
      <div class="otto-card p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#303030]">
            <ShieldCheckIcon class="size-4" />
            Runtime Security Guardrails
          </div>
          <Button size="xs" variant="secondary" type="button" :disabled="loading" @click="fetchData">
            <RefreshCwIcon data-icon="inline-start" :class="loading ? 'animate-spin' : ''" />
            Refresh
          </Button>
        </div>
        <div class="flex flex-wrap gap-2 font-mono text-[11px]">
          <span
            class="rounded-full px-2.5 py-1"
            :class="zeroLocalKeys ? 'bg-[#e6f7ee] text-[#166534]' : 'bg-[#fde8e8] text-[#991b1b]'"
          >
            {{ zeroLocalKeys ? "Zero local API keys verified" : "Local keys detected" }}
          </span>
          <span
            class="rounded-full px-2.5 py-1"
            :class="aiMediaDisabled ? 'bg-[#e6f7ee] text-[#166534]' : 'bg-[#fde8e8] text-[#991b1b]'"
          >
            {{ aiMediaDisabled ? "AI art & video generation disabled" : "AI media enabled" }}
          </span>
          <span class="rounded-full bg-[#f2f2f2] px-2.5 py-1 text-[#303030]">
            Fly.io Sprite · $0 idle
          </span>
        </div>
      </div>

      <div class="otto-card">
        <div class="otto-card-head">
          <span>(Y)our connectors.</span>
          <div class="otto-card-head-right">
            <span class="font-mono text-[10.5px] text-[#808080]">
              {{ connectors.length }} active
            </span>
          </div>
        </div>
        <div class="otto-card-body">
          <div v-if="connectors.length === 0" class="font-mono text-xs text-[#808080]">
            No Sprites Connectors detected yet.
          </div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="conn in connectors"
              :key="`${conn.provider}-${conn.displayName}`"
              class="flex items-center justify-between gap-3 rounded-xl border border-[#ededed] bg-[#fafafa] px-3 py-2.5"
            >
              <div class="min-w-0">
                <div class="font-mono text-xs font-semibold text-[#303030]">
                  {{ conn.displayName || conn.provider }}
                </div>
                <div v-if="conn.description" class="truncate text-xs text-[#737373]">
                  {{ conn.description }}
                </div>
              </div>
              <span class="shrink-0 rounded-full bg-[#e6f7ee] px-2 py-0.5 font-mono text-[10px] text-[#166534]">
                {{ conn.status || "connected" }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
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
  font-size: 1rem;
}
.prose-dossier :deep(h2) {
  font-size: 0.875rem;
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
