<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { PlayIcon, SquareIcon, RefreshCwIcon, Trash2Icon, GlobeIcon, CookieIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NoVncCanvas from "./NoVncCanvas.vue";

interface SavedSession {
  site: string;
  label: string;
  url: string;
  capturedAt: string;
  cookieCount: number;
  domains: string[];
}

interface BrowserStatus {
  running: boolean;
  chromeBinary: string | null;
  sessions: SavedSession[];
}

const props = defineProps<{
  modalActive?: boolean;
  refreshTick?: number;
}>();

const emit = defineEmits<{
  statusChanged: [payload: { running: boolean; sessionCount: number }];
}>();

const status = ref<BrowserStatus>({
  running: false,
  chromeBinary: null,
  sessions: [],
});
const busy = ref(false);
const navUrl = ref("https://x.com/i/flow/login");
const errorMsg = ref("");

async function loadStatus() {
  try {
    const res = await fetch("/api/browser/status");
    if (res.ok) {
      status.value = (await res.json()) as BrowserStatus;
    }
  } catch {
    // ignore
  }
}

async function startBrowser(url?: string) {
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/browser/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url || navUrl.value }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; status?: BrowserStatus };
    if (!res.ok || !data.ok) {
      errorMsg.value = data.error || "Failed to start embedded browser.";
    } else if (data.status) {
      status.value = data.status;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function stopBrowser() {
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/browser/stop", { method: "POST" });
    const data = (await res.json()) as { status?: BrowserStatus };
    if (data.status) status.value = data.status;
  } finally {
    busy.value = false;
  }
}

async function navigateBrowser() {
  if (!navUrl.value.trim()) return;
  await startBrowser(navUrl.value.trim());
}

async function captureCurrentCookies() {
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/browser/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      sessions?: SavedSession[];
    };
    if (!res.ok || !data.ok) {
      errorMsg.value = data.error || "Failed to capture cookies.";
    } else if (data.sessions) {
      status.value.sessions = data.sessions;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
async function revokeSession(site: string) {
  const res = await fetch(`/api/browser/sessions/${encodeURIComponent(site)}`, {
    method: "DELETE",
  });
  if (res.ok) {
    const data = (await res.json()) as { sessions?: SavedSession[] };
    if (data.sessions) status.value.sessions = data.sessions;
  }
}

watch(
  status,
  (next) => {
    emit("statusChanged", {
      running: Boolean(next.running),
      sessionCount: next.sessions.length,
    });
  },
  { deep: true, immediate: true }
);

watch(() => props.refreshTick, () => {
  void loadStatus();
});

onMounted(() => {
  void loadStatus();
});

async function openUrl(url: string) {
  const cleaned = url.trim();
  if (!cleaned) return;
  navUrl.value = cleaned;
  await startBrowser(cleaned);
}

defineExpose({ openUrl, loadStatus });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="otto-card p-4 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <GlobeIcon class="w-4 h-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold">Sprite Chrome (noVNC)</h3>
          <Badge :variant="status.running ? 'default' : 'secondary'">
            {{ status.running ? "Running" : "Stopped ($0 idle)" }}
          </Badge>
        </div>
        <div class="flex items-center gap-2">
          <Button
            v-if="!status.running"
            size="xs"
            type="button"
            :disabled="busy"
            @click="startBrowser()"
          >
            <PlayIcon class="w-3.5 h-3.5 mr-1" />
            Start Chrome
          </Button>
          <Button
            v-else
            variant="destructive"
            size="xs"
            type="button"
            :disabled="busy"
            @click="stopBrowser()"
          >
            <SquareIcon class="w-3.5 h-3.5 mr-1" />
            Stop Chrome
          </Button>
          <Button
            v-if="status.running"
            size="xs"
            variant="secondary"
            type="button"
            :disabled="busy"
            @click="captureCurrentCookies()"
          >
            <CookieIcon class="w-3.5 h-3.5 mr-1" />
            Capture Cookies
          </Button>
          <Button variant="outline" size="xs" type="button" @click="loadStatus">
            <RefreshCwIcon class="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <form class="flex items-center gap-2" @submit.prevent="navigateBrowser">
        <input
          v-model="navUrl"
          type="url"
          placeholder="https://x.com/i/flow/login"
          class="flex-1 h-8 px-2.5 text-xs rounded-md border border-input bg-background"
        />
        <Button size="xs" variant="secondary" type="submit" :disabled="busy">
          Open URL
        </Button>
      </form>

      <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>

      <div
        v-if="status.running && !modalActive"
        class="w-full h-[52vh] min-h-[380px] rounded-lg overflow-hidden border border-border bg-neutral-950"
      >
        <NoVncCanvas :active="status.running && !modalActive" />
      </div>
      <div
        v-else-if="status.running && modalActive"
        class="w-full h-[220px] rounded-lg border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground"
      >
        Browser viewport paused while Otto's login modal is active.
      </div>
      <div
        v-else
        class="w-full h-[220px] rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
      >
        <span>Chrome is stopped to keep Sprite idle cost at $0.</span>
        <span>Click <strong>Start Chrome</strong> or ask Otto to log into a platform.</span>
      </div>
    </div>

    <div class="otto-card p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CookieIcon class="w-4 h-4 text-muted-foreground" />
          <h3 class="text-sm font-semibold">Saved Cookie Sessions</h3>
        </div>
        <span class="text-xs text-muted-foreground">~/.config/lma/cookies/</span>
      </div>

      <div v-if="status.sessions.length === 0" class="text-xs text-muted-foreground py-3">
        No saved sessions yet. Ask Otto to sign into X, TikTok, YouTube, Instagram, or NotebookLM.
      </div>

      <div v-else class="divide-y divide-border">
        <div
          v-for="s in status.sessions"
          :key="s.site"
          class="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ s.label }}</span>
              <Badge variant="secondary">{{ s.cookieCount }} cookies</Badge>
            </div>
            <span class="text-muted-foreground">
              Captured {{ new Date(s.capturedAt).toLocaleString() }} · {{ s.domains.slice(0, 3).join(", ") }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              type="button"
              @click="startBrowser(s.url)"
            >
              Re-open
            </Button>
            <Button
              size="xs"
              variant="ghost"
              type="button"
              @click="revokeSession(s.site)"
            >
              <Trash2Icon class="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
