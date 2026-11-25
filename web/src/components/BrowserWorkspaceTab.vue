<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { toast } from "vue-sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardPasteIcon,
  CookieIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockIcon,
  PlayIcon,
  PowerIcon,
  RotateCwIcon,
  Trash2Icon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  currentUrl?: string;
  pageTitle?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  sessions: SavedSession[];
}

const QUICK_SITES = [
  { label: "Tokopedia", url: "https://www.tokopedia.com" },
  { label: "X (Twitter)", url: "https://x.com/i/flow/login" },
  { label: "TikTok", url: "https://www.tiktok.com/login" },
  { label: "YouTube", url: "https://studio.youtube.com/" },
  { label: "Instagram", url: "https://www.instagram.com/accounts/login/" },
  { label: "NotebookLM", url: "https://notebooklm.google.com/" },
];

const props = defineProps<{
  modalActive?: boolean;
  refreshTick?: number;
}>();

const emit = defineEmits<{
  statusChanged: [payload: { running: boolean; sessionCount: number; currentUrl?: string }];
}>();

const status = ref<BrowserStatus>({
  running: false,
  chromeBinary: null,
  sessions: [],
});
const busy = ref(false);
const capturing = ref(false);
const justCaptured = ref(false);
const sessionsOpen = ref(false);
const navUrl = ref("tokopedia.com");
const isEditingUrl = ref(false);
const errorMsg = ref("");
const vncRef = ref<InstanceType<typeof NoVncCanvas> | null>(null);

let captureResetTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function normalizeUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^about:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (!/\s/.test(trimmed) && trimmed.includes(".")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

const isSecureUrl = computed(() => /^https:\/\//i.test(navUrl.value.trim()));

function applyStatus(next: BrowserStatus) {
  status.value = next;
  if (
    next.running &&
    next.currentUrl &&
    next.currentUrl !== "about:blank" &&
    !isEditingUrl.value
  ) {
    navUrl.value = next.currentUrl;
  }
}

async function loadStatus() {
  try {
    const res = await fetch("/api/browser/status");
    if (res.ok) {
      applyStatus((await res.json()) as BrowserStatus);
    }
  } catch {
    // ignore transient network errors
  }
}

async function startBrowser(url?: string) {
  busy.value = true;
  errorMsg.value = "";
  const target = normalizeUrlInput(url ?? navUrl.value) || "about:blank";
  if (target !== "about:blank") {
    navUrl.value = target;
  }
  try {
    const res = await fetch("/api/browser/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; status?: BrowserStatus };
    if (!res.ok || !data.ok) {
      errorMsg.value = data.error || "Failed to start embedded browser.";
    } else if (data.status) {
      applyStatus(data.status);
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
    if (data.status) applyStatus(data.status);
  } finally {
    busy.value = false;
  }
}

async function navigateBrowser() {
  const normalized = normalizeUrlInput(navUrl.value);
  if (!normalized) return;
  navUrl.value = normalized;
  isEditingUrl.value = false;
  if (!status.value.running) {
    await startBrowser(normalized);
    return;
  }
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: normalized }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; status?: BrowserStatus };
    if (!res.ok || !data.ok) {
      errorMsg.value = data.error || "Failed to navigate.";
    } else if (data.status) {
      applyStatus(data.status);
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function runBrowserAction(action: "back" | "forward" | "reload") {
  if (!status.value.running || busy.value) return;
  try {
    const res = await fetch("/api/browser/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as { ok?: boolean; status?: BrowserStatus };
    if (data.status) applyStatus(data.status);
  } catch {
    // ignore
  }
}

async function handlePasteClipboard() {
  if (!status.value.running) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      vncRef.value?.pasteText(text);
      toast.success("Clipboard text sent to browser");
    }
  } catch {
    toast.error("Clipboard access denied; type directly into the browser.");
  }
}

async function captureCurrentCookies() {
  if (!status.value.running || capturing.value) return;
  capturing.value = true;
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
      session?: SavedSession;
      sessions?: SavedSession[];
    };
    if (!res.ok || !data.ok) {
      errorMsg.value = data.error || "Failed to capture cookies.";
    } else {
      if (data.sessions) status.value.sessions = data.sessions;
      justCaptured.value = true;
      if (captureResetTimer) clearTimeout(captureResetTimer);
      captureResetTimer = setTimeout(() => {
        justCaptured.value = false;
      }, 2400);
      if (data.session) {
        toast.success(`Saved ${data.session.cookieCount} cookies for ${data.session.label}`);
      } else {
        toast.success("Session cookies captured");
      }
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    capturing.value = false;
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

function openSavedSession(url: string) {
  sessionsOpen.value = false;
  void startBrowser(url);
}

function handleUrlFocus(event: FocusEvent) {
  isEditingUrl.value = true;
  (event.target as HTMLInputElement | null)?.select();
}

function syncPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (status.value.running && !props.modalActive) {
    pollTimer = setInterval(() => {
      void loadStatus();
    }, 2500);
  }
}

watch(
  status,
  (next) => {
    emit("statusChanged", {
      running: Boolean(next.running),
      sessionCount: next.sessions.length,
      currentUrl: next.currentUrl,
    });
    syncPolling();
  },
  { deep: true, immediate: true }
);

watch(
  () => props.modalActive,
  () => {
    syncPolling();
  }
);

watch(
  () => props.refreshTick,
  () => {
    void loadStatus();
  }
);

onMounted(() => {
  void loadStatus();
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (captureResetTimer) clearTimeout(captureResetTimer);
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
  <div class="flex h-full min-h-0 flex-col bg-white">
    <!-- Realistic Browser Toolbar -->
    <div class="flex flex-wrap items-center gap-2 border-b border-[#ededed] bg-[#fafafa] px-3 py-2 shrink-0">
      <!-- Navigation cluster -->
      <div class="flex items-center gap-0.5 shrink-0">
        <Button
          size="icon-sm"
          variant="ghost"
          type="button"
          title="Back"
          :disabled="!status.running || status.canGoBack === false"
          @click="runBrowserAction('back')"
        >
          <ArrowLeftIcon class="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          type="button"
          title="Forward"
          :disabled="!status.running || status.canGoForward === false"
          @click="runBrowserAction('forward')"
        >
          <ArrowRightIcon class="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          type="button"
          title="Reload"
          :disabled="!status.running"
          @click="runBrowserAction('reload')"
        >
          <RotateCwIcon class="size-3.5" />
        </Button>
      </div>

      <!-- Browser Omnibox (accepts bare domains like tokopedia.com) -->
      <form class="flex flex-1 min-w-[200px] items-center" @submit.prevent="navigateBrowser">
        <div
          class="flex h-8 w-full items-center gap-2 rounded-full border border-[#e3e3e3] bg-white pl-3 pr-1.5 transition-colors focus-within:border-[#303030] focus-within:ring-2 focus-within:ring-[#303030]/10"
        >
          <LockIcon
            v-if="status.running && isSecureUrl"
            class="size-3.5 shrink-0 text-emerald-600"
          />
          <GlobeIcon v-else class="size-3.5 shrink-0 text-muted-foreground" />
          <input
            v-model="navUrl"
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="Enter domain or URL (e.g. tokopedia.com)"
            class="w-full min-w-0 bg-transparent text-xs text-[#303030] placeholder:text-muted-foreground outline-none"
            @focus="handleUrlFocus"
            @blur="isEditingUrl = false"
          />
          <Button
            size="xs"
            variant="secondary"
            type="submit"
            :disabled="busy"
            class="h-6 rounded-full px-2.5 shrink-0"
          >
            Go
          </Button>
        </div>
      </form>

      <!-- Primary Objective + Saved Sessions Popover + Power -->
      <div class="flex items-center gap-1.5 shrink-0">
        <!-- Hero CTA: Capture Cookies -->
        <Button
          size="sm"
          :variant="status.running ? 'default' : 'outline'"
          type="button"
          :disabled="!status.running || busy || capturing"
          :title="status.running ? 'Save active login cookies for Otto' : 'Start browser and sign in to capture cookies'"
          :class="[
            'h-8 rounded-full px-3.5 font-medium transition-all',
            justCaptured
              ? 'bg-emerald-600 text-white hover:bg-emerald-600 border-emerald-600'
              : status.running
                ? 'bg-[#303030] text-white hover:bg-[#141414] shadow-xs'
                : '',
          ]"
          @click="captureCurrentCookies()"
        >
          <CheckIcon v-if="justCaptured" class="size-3.5" />
          <CookieIcon v-else class="size-3.5" />
          <span>{{ justCaptured ? "Captured!" : capturing ? "Saving…" : "Capture Cookies" }}</span>
        </Button>

        <!-- Saved Cookie Sessions Popover -->
        <Popover v-model:open="sessionsOpen">
          <PopoverTrigger as-child>
            <Button
              size="sm"
              variant="outline"
              type="button"
              class="h-8 rounded-full px-2.5 gap-1.5 bg-white"
              title="Saved Cookie Sessions"
            >
              <KeyRoundIcon class="size-3.5 text-muted-foreground" />
              <span class="hidden sm:inline">Sessions</span>
              <Badge
                variant="secondary"
                class="h-4 min-w-4 px-1 text-[10px] leading-none rounded-full"
              >
                {{ status.sessions.length }}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            class="w-96 p-0 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-lg"
          >
            <div class="flex items-center justify-between border-b border-[#ededed] bg-[#fafafa] px-3.5 py-2.5">
              <div class="flex items-center gap-1.5">
                <CookieIcon class="size-3.5 text-[#303030]" />
                <span class="text-xs font-semibold text-[#303030]">Saved Cookie Sessions</span>
              </div>
              <span class="font-mono text-[10px] text-muted-foreground">~/.config/lma/cookies/</span>
            </div>

            <div
              v-if="status.sessions.length === 0"
              class="p-4 text-xs text-muted-foreground leading-relaxed"
            >
              No saved sessions yet. Sign into any website in the browser and click
              <strong>Capture Cookies</strong>, or ask Otto to sign in.
            </div>

            <div v-else class="max-h-72 overflow-y-auto divide-y divide-[#ededed]">
              <div
                v-for="s in status.sessions"
                :key="s.site"
                class="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs hover:bg-[#fafafa]"
              >
                <div class="flex min-w-0 flex-col gap-0.5">
                  <div class="flex items-center gap-1.5">
                    <span class="font-medium truncate text-[#303030]">{{ s.label }}</span>
                    <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
                      {{ s.cookieCount }} cookies
                    </Badge>
                  </div>
                  <span class="truncate text-[11px] text-muted-foreground">
                    {{ new Date(s.capturedAt).toLocaleDateString() }} · {{ s.domains.slice(0, 2).join(", ") }}
                  </span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <Button
                    size="xs"
                    variant="outline"
                    type="button"
                    @click="openSavedSession(s.url)"
                  >
                    Open
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    title="Delete saved session"
                    @click="revokeSession(s.site)"
                  >
                    <Trash2Icon class="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <!-- Paste Clipboard helper (useful for password managers in noVNC) -->
        <Button
          v-if="status.running"
          size="icon-sm"
          variant="ghost"
          type="button"
          title="Paste clipboard into browser"
          @click="handlePasteClipboard"
        >
          <ClipboardPasteIcon class="size-3.5" />
        </Button>

        <!-- Start / Stop Browser -->
        <Button
          v-if="!status.running"
          size="sm"
          variant="secondary"
          type="button"
          class="h-8 rounded-full px-3"
          :disabled="busy"
          @click="startBrowser()"
        >
          <PlayIcon class="size-3.5" />
          <span>Start</span>
        </Button>
        <Button
          v-else
          size="sm"
          variant="ghost"
          type="button"
          title="Stop Chrome ($0 idle)"
          class="h-8 rounded-full px-2.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          :disabled="busy"
          @click="stopBrowser()"
        >
          <span class="size-1.5 rounded-full bg-emerald-500 mr-1" />
          <PowerIcon class="size-3.5" />
          <span class="hidden md:inline">Stop</span>
        </Button>
      </div>
    </div>

    <div
      v-if="errorMsg"
      class="border-b border-destructive/20 bg-destructive/10 px-3.5 py-1.5 text-xs text-destructive shrink-0"
    >
      {{ errorMsg }}
    </div>

    <!-- Full-Bleed Browser Viewport -->
    <div
      v-if="status.running && !modalActive"
      class="relative flex-1 min-h-[380px] w-full bg-[#f4f4f5] overflow-hidden"
    >
      <NoVncCanvas
        ref="vncRef"
        :active="status.running && !modalActive"
        background="#f4f4f5"
      />
    </div>

    <div
      v-else-if="status.running && modalActive"
      class="flex flex-1 min-h-[320px] flex-col items-center justify-center gap-2 bg-[#fafafa] p-6 text-center text-xs text-muted-foreground"
    >
      <GlobeIcon class="size-6 text-muted-foreground/60" />
      <span>Browser viewport paused while Otto's login modal is active.</span>
    </div>

    <!-- Clean Browser Start Page when stopped ($0 idle) -->
    <div
      v-else
      class="flex flex-1 min-h-[340px] flex-col items-center justify-center gap-5 bg-[#fafafa] p-6 text-center"
    >
      <div class="flex flex-col items-center gap-2 max-w-md">
        <div class="flex size-11 items-center justify-center rounded-2xl bg-white border border-[#e5e5e5] shadow-xs">
          <GlobeIcon class="size-5 text-[#303030]" />
        </div>
        <h3 class="text-sm font-semibold text-[#303030]">
          Sign in to save session cookies
        </h3>
        <p class="text-xs text-muted-foreground leading-relaxed">
          Browser sleeps at $0 when stopped. Enter any site above (like <code>tokopedia.com</code>) or launch a quick site below, log in, then click <strong>Capture Cookies</strong>.
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-1.5 max-w-lg">
        <Button
          v-for="site in QUICK_SITES"
          :key="site.label"
          size="xs"
          variant="outline"
          type="button"
          class="rounded-full bg-white"
          :disabled="busy"
          @click="openUrl(site.url)"
        >
          {{ site.label }}
        </Button>
      </div>

      <Button
        size="sm"
        type="button"
        class="rounded-full px-4"
        :disabled="busy"
        @click="startBrowser()"
      >
        <PlayIcon class="size-3.5" />
        <span>Launch Browser</span>
      </Button>
    </div>
  </div>
</template>
