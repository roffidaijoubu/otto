<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  Columns2Icon,
  GlobeIcon,
  LayersIcon,
  LayoutGridIcon,
  Maximize2Icon,
  MessageSquareIcon,
  PlugIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DesktopShell, type DesktopShellExposed } from "@/components/os";
import BrowserLoginModal, { type BrowserLoginRequest } from "./components/BrowserLoginModal.vue";
import BrowserWorkspaceTab from "./components/BrowserWorkspaceTab.vue";
import CalendarWorkspaceApp from "./components/CalendarWorkspaceApp.vue";
import ChatComposer, { type ComposerAttachment } from "./components/ChatComposer.vue";
import ContactsWorkspaceApp from "./components/ContactsWorkspaceApp.vue";
import type { StudioTab } from "./components/ChatHeader.vue";
import LearnedPlaybooksCard from "./components/LearnedPlaybooksCard.vue";
import MessageBubble from "./components/MessageBubble.vue";
import MissionControlWorkspace from "./components/MissionControlWorkspace.vue";
import OttoMascot from "./components/OttoMascot.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import StudioDatabaseView from "./components/StudioDatabaseView.vue";
import StudioSetupWizard from "./components/StudioSetupWizard.vue";
import TodoChecklistCard from "./components/TodoChecklistCard.vue";
import WorkspaceFileManager from "./components/WorkspaceFileManager.vue";
import type { ChatMessage, SessionSummary, TodoPhase, TraceStep } from "./types/chat";

const MASCOT_SWATCHES = ["#303030", "#7CC6A5", "#E89B7E", "#A7D8F0", "#C9B8E8", "#F9F5A2"] as const;

type MissionSubTab = "overview" | "dossier" | "connectors";

const MISSION_SUB_TABS: Array<{ id: MissionSubTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "dossier", label: "Profile" },
  { id: "connectors", label: "Connectors" },
];

const shellRef = ref<DesktopShellExposed | null>(null);
const fileManagerRef = ref<InstanceType<typeof WorkspaceFileManager> | null>(null);
const browserTabRef = ref<InstanceType<typeof BrowserWorkspaceTab> | null>(null);

const messages = ref<ChatMessage[]>([]);
const sessions = ref<SessionSummary[]>([]);
const todos = ref<TodoPhase[]>([]);
const draft = ref("");
const busy = ref(false);
const activity = ref("Thinking...");
const connectionState = ref<"connecting" | "ready" | "error">("connecting");
const error = ref("");
const sidebarOpen = ref(false);
const missionTab = ref<MissionSubTab>("overview");
const filesTargetPath = ref("");
const pendingChromeUrl = ref("");
const chromeRunning = ref(false);
const chromeSessionCount = ref(0);
const navCounts = ref({ schedule: 0, files: 0, database: 0, playbooks: 0, connectors: 0 });
const missionRefreshTick = ref(0);
const workspaceRefreshTick = ref(0);
const dbRefreshTick = ref(0);
const messagesWrapRef = ref<HTMLElement | null>(null);
const setupChecked = ref(false);
const showSetupWizard = ref(false);
const activeLoginRequest = ref<BrowserLoginRequest | null>(null);
const browserRefreshTick = ref(0);
const setupInitialName = ref("");
const setupInitialTimezone = ref("");

const savedColor = typeof localStorage !== "undefined" ? localStorage.getItem("otto_mascot_color") : null;
const mascotColor = ref<string>(
  savedColor && (MASCOT_SWATCHES as readonly string[]).includes(savedColor) ? savedColor : "#303030"
);

function setMascotColor(color: string) {
  mascotColor.value = color;
  try {
    localStorage.setItem("otto_mascot_color", color);
  } catch {
    // ignore storage errors
  }
}

// Live streaming accumulator for the active assistant response
const liveText = ref("");
const liveThinking = ref("");
const liveSteps = ref<TraceStep[]>([]);

const starters = [
  "Check my connected channels and set up my studio profile.",
  "Audit my latest YouTube uploads and suggest sharper titles.",
  "Help me plan tonight's stream and draft promo posts.",
];

const hasLiveContent = computed(
  () => Boolean(liveText.value.trim() || liveThinking.value.trim() || liveSteps.value.length > 0)
);

const statusState = computed<"ready" | "busy" | "error">(() => {
  if (connectionState.value === "error") return "error";
  if (busy.value) return "busy";
  if (connectionState.value === "ready") return "ready";
  return "busy";
});

const desktopStatusSubtitle = computed(() => {
  if (connectionState.value === "error") return "Reconnecting to Sprite...";
  if (busy.value) return activity.value || "Otto is working...";
  const sCount = sessions.value.length;
  return sCount > 0 ? `Online · ${sCount} studio chat${sCount === 1 ? "" : "s"}` : "Sprite workstation ready";
});

// Clear passive "Updated" badges whenever the user focuses that window
watch(
  () => shellRef.value?.wm.focusedWindowId.value,
  (focusedId) => {
    const wm = shellRef.value?.wm;
    if (!wm || !focusedId) return;
    if (wm.windows[focusedId].badgeText === "Updated") {
      wm.setWindowMeta(focusedId, { badgeText: "" });
    }
  }
);

function scrollToBottom() {
  nextTick(() => {
    const el = messagesWrapRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function resetLiveBuffers() {
  liveText.value = "";
  liveThinking.value = "";
  liveSteps.value = [];
}

async function loadSessions() {
  try {
    const res = await fetch("/api/sessions");
    const data = (await res.json()) as { sessions?: SessionSummary[] };
    sessions.value = data.sessions || [];
  } catch {
    // keep existing list
  }
}

async function loadInitialBrowserStatus() {
  try {
    const res = await fetch("/api/browser/status");
    if (!res.ok) return;
    const data = (await res.json()) as { running?: boolean; sessions?: unknown[] };
    chromeRunning.value = Boolean(data.running);
    chromeSessionCount.value = Array.isArray(data.sessions) ? data.sessions.length : 0;
  } catch {
    // ignore
  }
}

async function loadMessages() {
  try {
    const res = await fetch("/api/messages");
    const data = (await res.json()) as {
      messages?: Array<{ role: "user" | "assistant"; text: string; thinking?: string }>;
      busy?: boolean;
      activity?: string;
      todos?: TodoPhase[];
    };
    messages.value = (data.messages || []).map((m, idx) => ({
      id: `hist-${idx}`,
      role: m.role,
      text: m.text,
      thinking: m.thinking,
    }));
    resetLiveBuffers();
    busy.value = Boolean(data.busy);
    if (data.activity) activity.value = data.activity;
    if (Array.isArray(data.todos)) todos.value = data.todos;
    scrollToBottom();
  } catch (err) {
    connectionState.value = "error";
    error.value =
      "Could not load conversation history: " +
      (err instanceof Error ? err.message : String(err));
  }
}

function commitLiveAssistant(finalText?: string) {
  const text = (finalText ?? liveText.value).trim();
  const thinking = liveThinking.value.trim();
  const steps = liveSteps.value.map((s) => ({ ...s, done: true }));
  if (text) {
    messages.value.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      text,
      thinking: thinking || undefined,
      steps: steps.length ? steps : undefined,
    });
    resetLiveBuffers();
    scrollToBottom();
  }
}

function connectEvents() {
  const es = new EventSource("/api/events");
  let wasDisconnected = false;
  es.onopen = () => {
    error.value = "";
    connectionState.value = "ready";
    if (wasDisconnected) {
      wasDisconnected = false;
      loadMessages();
      loadSessions();
    }
  };
  es.onerror = () => {
    wasDisconnected = true;
    connectionState.value = "error";
  };
  es.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = msg.type;
    const wm = shellRef.value?.wm;

    if (type === "status") {
      busy.value = Boolean(msg.busy);
      if (typeof msg.activity === "string") activity.value = msg.activity;
      if (Array.isArray(msg.todos)) todos.value = msg.todos as TodoPhase[];
    } else if (type === "todos" && Array.isArray(msg.phases)) {
      todos.value = msg.phases as TodoPhase[];
    } else if (type === "activity") {
      activity.value = typeof msg.label === "string" ? msg.label : "Thinking...";
    } else if (type === "tool_start") {
      busy.value = true;
      const label = typeof msg.label === "string" ? msg.label : "Working on it...";
      activity.value = label;
      liveSteps.value.push({ label, done: false });
      scrollToBottom();
    } else if (type === "tool_end") {
      const last = [...liveSteps.value].reverse().find((s) => !s.done);
      if (last) last.done = true;
    } else if (type === "user_message" && typeof msg.text === "string") {
      messages.value.push({
        id: `user-${Date.now()}`,
        role: "user",
        text: msg.text,
      });
      scrollToBottom();
    } else if (type === "thinking_delta" && typeof msg.delta === "string") {
      liveThinking.value += msg.delta;
      scrollToBottom();
    } else if (type === "text_delta" && typeof msg.delta === "string") {
      liveText.value += msg.delta;
      scrollToBottom();
    } else if (type === "assistant_end" && typeof msg.text === "string") {
      commitLiveAssistant(msg.text);
    } else if (type === "workspace_changed") {
      workspaceRefreshTick.value += 1;
      missionRefreshTick.value += 1;
      if (wm && wm.focusedWindowId.value !== "files") {
        wm.setWindowMeta("files", { badgeText: "Updated" });
      }
    } else if (type === "db_changed") {
      dbRefreshTick.value += 1;
      missionRefreshTick.value += 1;
      if (wm && wm.focusedWindowId.value !== "studio-db") {
        wm.setWindowMeta("studio-db", { badgeText: "Updated" });
      }
    } else if (type === "done") {
      commitLiveAssistant();
      busy.value = false;
      loadSessions();
      missionRefreshTick.value += 1;
      workspaceRefreshTick.value += 1;
      dbRefreshTick.value += 1;
    } else if (type === "session_changed") {
      resetLiveBuffers();
      todos.value = [];
      busy.value = false;
      loadMessages();
      loadSessions();
    } else if (type === "error") {
      error.value = typeof msg.message === "string" ? msg.message : "Unexpected error";
      busy.value = false;
    } else if (type === "browser_login_required" && msg.request && typeof msg.request === "object") {
      const req = msg.request as BrowserLoginRequest;
      activeLoginRequest.value = req;
      chromeRunning.value = true;
      wm?.openWindow("chrome", {
        focus: true,
        attention: true,
        badgeText: "Login",
        subtitle: req.label || req.site,
      });
    } else if (type === "browser_login_done" && msg.request && typeof msg.request === "object") {
      const req = msg.request as BrowserLoginRequest;
      activeLoginRequest.value = null;
      browserRefreshTick.value += 1;
      wm?.setWindowMeta("chrome", { attention: false, badgeText: "" });
      toast.success(`Signed in to ${req.label || req.site}. Cookies saved.`);
    } else if (type === "browser_login_cancelled") {
      activeLoginRequest.value = null;
      browserRefreshTick.value += 1;
      wm?.setWindowMeta("chrome", { attention: false, badgeText: "" });
    } else if (type === "browser_status") {
      browserRefreshTick.value += 1;
      void loadInitialBrowserStatus();
    }
  };
}

async function sendMessage(attachments: ComposerAttachment[] = []) {
  const userText = draft.value.trim();
  if ((!userText && attachments.length === 0) || busy.value) return;
  let fullMessage = userText;
  if (attachments.length > 0) {
    const names = attachments.map((a) => a.name).join(", ");
    const visiblePart = userText || `Uploaded to workspace: ${names}. Please review.`;
    const hiddenLines = attachments
      .map((a) => `- ${a.absPath} (relative: ${a.relPath}, type: ${a.kind})`)
      .join("\n");
    fullMessage = `${visiblePart}\n<hidden>Attached workspace files:\n${hiddenLines}</hidden>`;
  }
  error.value = "";
  draft.value = "";
  busy.value = true;
  activity.value = "Thinking...";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: fullMessage }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      error.value = err.error || "Failed to send message";
      busy.value = false;
    }
  } catch (err) {
    error.value = "Network error: " + (err instanceof Error ? err.message : String(err));
    busy.value = false;
  }
}

function useStarter(prompt: string) {
  draft.value = prompt;
  sendMessage();
}

function handleMissionPrompt(prompt: string) {
  shellRef.value?.wm.openWindow("otto-chat", { focus: true });
  useStarter(prompt);
}

function handleMissionTabRequest(tab: StudioTab) {
  const wm = shellRef.value?.wm;
  if (tab === "schedule") {
    wm?.openWindow("calendar", { focus: true });
    return;
  }
  if (tab === "files") {
    wm?.openWindow("files", { focus: true });
    return;
  }
  if (tab === "database") {
    wm?.openWindow("studio-db", { focus: true });
    return;
  }
  if (tab === "playbooks") {
    wm?.openWindow("playbooks", { focus: true });
    return;
  }
  if (tab === "browser") {
    wm?.openWindow("chrome", { focus: true });
    return;
  }
  missionTab.value = tab;
  wm?.openWindow("mission-control", { focus: true });
}

function openFilesAtPath(relPath: string) {
  const cleaned = relPath.replace(/^\/+|\/+$/g, "");
  filesTargetPath.value = cleaned;
  shellRef.value?.wm.openWindow("files", {
    focus: true,
    subtitle: cleaned ? `/${cleaned}` : "/workspace",
  });
  nextTick(() => {
    fileManagerRef.value?.navigateTo(cleaned);
  });
}

function handleFilesPathChanged(relDir: string) {
  shellRef.value?.wm.setWindowMeta("files", {
    subtitle: relDir ? `/${relDir}` : "/workspace",
  });
}

function handleDesktopAction(action: "new-note" | "new-folder") {
  shellRef.value?.wm.openWindow("files", { focus: true });
  nextTick(() => {
    if (action === "new-note") {
      fileManagerRef.value?.openNewNoteDialog();
    } else {
      fileManagerRef.value?.openNewFolderDialog();
    }
  });
}

function openChromeAtUrl(url: string) {
  pendingChromeUrl.value = url;
  shellRef.value?.wm.openWindow("chrome", {
    focus: true,
    subtitle: url.replace(/^https?:\/\//, ""),
  });
  nextTick(() => {
    if (browserTabRef.value && pendingChromeUrl.value) {
      const target = pendingChromeUrl.value;
      pendingChromeUrl.value = "";
      void browserTabRef.value.openUrl(target);
    }
  });
}

function handleBrowserStatusChanged(payload: {
  running: boolean;
  sessionCount: number;
  currentUrl?: string;
}) {
  chromeRunning.value = payload.running;
  chromeSessionCount.value = payload.sessionCount;
}

function handleLoginModalCompleted() {
  activeLoginRequest.value = null;
  browserRefreshTick.value += 1;
  shellRef.value?.wm.setWindowMeta("chrome", { attention: false, badgeText: "" });
}

function handleLoginModalCancelled() {
  activeLoginRequest.value = null;
  shellRef.value?.wm.setWindowMeta("chrome", { attention: false, badgeText: "" });
}

async function stopReply() {
  await fetch("/api/abort", { method: "POST" }).catch(() => {});
}

async function newChat() {
  if (busy.value) return;
  error.value = "";
  await fetch("/api/new", { method: "POST" }).catch(() => {});
  sidebarOpen.value = false;
}

async function switchChat(session: SessionSummary) {
  if (busy.value || session.active) return;
  error.value = "";
  try {
    const res = await fetch("/api/sessions/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: session.path }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      error.value = err.error || "Failed to switch chat";
    } else {
      sidebarOpen.value = false;
    }
  } catch (err) {
    error.value = "Network error: " + (err instanceof Error ? err.message : String(err));
  }
}

async function loadSetupStatus() {
  const params = new URLSearchParams(window.location.search);
  const forceSkip = params.get("skipSetup") === "1";
  const forceShow = params.get("setup") === "1";
  try {
    const res = await fetch("/api/setup/status");
    if (res.ok) {
      const data = (await res.json()) as {
        completed?: boolean;
        creatorName?: string;
        timezone?: string;
      };
      setupInitialName.value = data.creatorName || "";
      setupInitialTimezone.value = data.timezone || "";
      if (forceShow) {
        showSetupWizard.value = true;
      } else if (forceSkip) {
        showSetupWizard.value = false;
      } else {
        showSetupWizard.value = !data.completed;
      }
    }
  } catch {
    showSetupWizard.value = false;
  } finally {
    setupChecked.value = true;
  }
}

function handleSetupDone() {
  showSetupWizard.value = false;
  missionRefreshTick.value += 1;
  dbRefreshTick.value += 1;
  if (window.location.search.includes("setup=1")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

async function reopenSetup() {
  try {
    const res = await fetch("/api/setup/status");
    if (res.ok) {
      const data = (await res.json()) as { creatorName?: string; timezone?: string };
      setupInitialName.value = data.creatorName || "";
      setupInitialTimezone.value = data.timezone || "";
    }
  } catch {
    // ignore
  }
  showSetupWizard.value = true;
}

onMounted(async () => {
  await Promise.all([loadSetupStatus(), loadMessages(), loadSessions(), loadInitialBrowserStatus()]);
  connectEvents();
});
</script>

<template>
  <TooltipProvider :delay-duration="220">
    <StudioSetupWizard
      v-if="setupChecked && showSetupWizard"
      :initial-name="setupInitialName"
      :initial-timezone="setupInitialTimezone"
      :mascot-color="mascotColor"
      :swatches="[...MASCOT_SWATCHES]"
      @select-mascot-color="setMascotColor"
      @completed="handleSetupDone"
      @skipped="handleSetupDone"
    />

    <DesktopShell
      v-else-if="setupChecked"
      ref="shellRef"
      :timezone="setupInitialTimezone"
      :chrome-running="chromeRunning"
      :chrome-login-pending="Boolean(activeLoginRequest)"
      :mascot-state="statusState"
      :mascot-color="mascotColor"
      :status-subtitle="desktopStatusSubtitle"
      @open-files-path="openFilesAtPath"
      @open-chrome-url="openChromeAtUrl"
      @desktop-action="handleDesktopAction"
    >
      <!-- WINDOW 1: OTTO CHAT -->
      <template #window-actions-otto-chat>
        <Button
          variant="secondary"
          size="xs"
          type="button"
          @click="sidebarOpen = true"
        >
          <MessageSquareIcon data-icon="inline-start" />
          Chats ({{ sessions.length }})
        </Button>
        <Button
          size="xs"
          type="button"
          :disabled="busy"
          @click="newChat"
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </template>

      <template #app-otto-chat>
        <div class="chat-window-body">
          <main ref="messagesWrapRef" class="messages-wrap">
            <div class="messages">
              <div v-if="messages.length === 0 && !hasLiveContent" class="empty-state">
                <OttoMascot :size="52" :color="mascotColor" :state="statusState" />
                <h2>Otto is in the room.</h2>
                <p>
                  No fluff, no yes-man answers, zero AI slop. Drag <span class="mark-y">(y)our</span> Studio OS windows around or tell Otto what stream or video we are sharpening today.
                </p>
                <div class="starters">
                  <button
                    v-for="s in starters"
                    :key="s"
                    type="button"
                    class="starter"
                    @click="useStarter(s)"
                  >
                    {{ s }}
                  </button>
                </div>
              </div>

              <MessageBubble
                v-for="m in messages"
                :key="m.id"
                :role="m.role"
                :text="m.text"
                :thinking="m.thinking"
                :steps="m.steps"
                :mascot-color="mascotColor"
              />

              <MessageBubble
                v-if="hasLiveContent"
                role="assistant"
                :text="liveText"
                :thinking="liveThinking"
                :steps="liveSteps"
                :mascot-color="mascotColor"
                live
              />
            </div>
          </main>

          <div v-if="busy" class="activity">
            <span class="pulse"></span>
            <span>{{ activity }}</span>
          </div>

          <div v-if="error" class="error-banner">{{ error }}</div>

          <TodoChecklistCard :phases="todos" @dismiss="todos = []" />

          <ChatComposer v-model="draft" :busy="busy" @send="sendMessage" @stop="stopReply" />
        </div>
      </template>

      <!-- WINDOW 2: MISSION CONTROL -->
      <template #window-actions-mission-control>
        <div class="flex items-center gap-0.5 rounded-full bg-[#f2f2f2] p-0.5">
          <button
            v-for="sub in MISSION_SUB_TABS"
            :key="sub.id"
            type="button"
            class="rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
            :class="
              missionTab === sub.id
                ? 'bg-[#303030] text-white'
                : 'text-[#666] hover:text-[#303030]'
            "
            @click="missionTab = sub.id"
          >
            {{ sub.label }}
          </button>
        </div>
      </template>

      <template #app-mission-control>
        <div class="h-full overflow-y-auto bg-[#fafafa]/60 p-3.5">
          <MissionControlWorkspace
            :active-tab="missionTab"
            :refresh-tick="missionRefreshTick"
            :mascot-color="mascotColor"
            :status-state="statusState"
            :swatches="[...MASCOT_SWATCHES]"
            @update:active-tab="handleMissionTabRequest"
            @open-workspace-path="openFilesAtPath"
            @select-mascot-color="setMascotColor"
            @counts-updated="navCounts = $event"
            @ask-prompt="handleMissionPrompt"
            @open-setup="reopenSetup"
          />
        </div>
      </template>

      <!-- WINDOW 3: STUDIO FILES -->
      <template #app-files>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <WorkspaceFileManager
            ref="fileManagerRef"
            :refresh-tick="workspaceRefreshTick"
            :initial-path="filesTargetPath"
            @ask-prompt="handleMissionPrompt"
            @path-changed="handleFilesPathChanged"
          />
        </div>
      </template>

      <!-- WINDOW 4: EMBEDDED CHROME (noVNC) -->
      <template #app-chrome>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <BrowserWorkspaceTab
            ref="browserTabRef"
            :modal-active="Boolean(activeLoginRequest)"
            :refresh-tick="browserRefreshTick"
            @status-changed="handleBrowserStatusChanged"
          />
        </div>
      </template>

      <!-- WINDOW 5: STUDIO DATABASE -->
      <template #app-studio-db>
        <div class="h-full overflow-y-auto bg-[#fafafa]/60 p-3.5">
          <StudioDatabaseView
            :refresh-tick="dbRefreshTick"
            @ask-prompt="handleMissionPrompt"
            @open-workspace-path="openFilesAtPath"
          />
        </div>
      </template>

      <!-- WINDOW 6: PLAYBOOKS -->
      <template #app-playbooks>
        <div class="h-full overflow-y-auto bg-[#fafafa]/60 p-3.5">
          <LearnedPlaybooksCard :refresh-tick="dbRefreshTick + missionRefreshTick" />
        </div>
      </template>

      <!-- WINDOW 7: CALENDAR -->
      <template #app-calendar>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <CalendarWorkspaceApp
            :refresh-tick="missionRefreshTick + dbRefreshTick"
            @ask-prompt="handleMissionPrompt"
            @events-updated="navCounts.schedule = $event"
          />
        </div>
      </template>

      <!-- WINDOW 8: CONTACTS -->
      <template #app-contacts>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <ContactsWorkspaceApp
            :refresh-tick="dbRefreshTick"
            @ask-prompt="handleMissionPrompt"
          />
        </div>
      </template>

      <!-- WINDOW 7: SYSTEM SETTINGS -->
      <template #app-settings>
        <div class="flex h-full flex-col gap-4 overflow-y-auto bg-[#fafafa]/60 p-4">
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
                    v-for="sw in MASCOT_SWATCHES"
                    :key="sw"
                    type="button"
                    class="size-6 rounded-full border-2 transition-transform hover:scale-110"
                    :class="mascotColor === sw ? 'border-[#303030] scale-110' : 'border-black/15'"
                    :style="{ background: sw }"
                    :aria-label="`Set Otto color ${sw}`"
                    @click="setMascotColor(sw)"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Studio Identity & Onboarding -->
          <div class="otto-card p-4">
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class="font-mono text-xs font-semibold text-[#303030]">
                Studio Profile &amp; Onboarding
              </span>
              <Button size="xs" type="button" @click="reopenSetup">
                <SparklesIcon data-icon="inline-start" />
                Re-run Setup Wizard
              </Button>
            </div>
            <div class="grid grid-cols-2 gap-3 font-mono text-xs">
              <div class="rounded-xl border border-[#ededed] bg-[#fafafa] p-3">
                <div class="text-[10.5px] text-[#777]">CREATOR</div>
                <div class="mt-0.5 font-semibold text-[#303030]">
                  {{ setupInitialName || "Not configured" }}
                </div>
              </div>
              <div class="rounded-xl border border-[#ededed] bg-[#fafafa] p-3">
                <div class="text-[10.5px] text-[#777]">TIMEZONE</div>
                <div class="mt-0.5 font-semibold text-[#303030]">
                  {{ setupInitialTimezone || "Browser local" }}
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
                v-if="shellRef"
                data-settings-controls-mode
                class="flex items-center gap-0.5 rounded-full bg-[#f2f2f2] p-0.5"
              >
                <button
                  type="button"
                  data-controls-mode="auto"
                  class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
                  :class="
                    shellRef.wm.controlsMode.value === 'auto'
                      ? 'bg-[#303030] text-white'
                      : 'text-[#666] hover:text-[#303030]'
                  "
                  @click="shellRef.wm.setControlsMode('auto')"
                >
                  Auto ({{ shellRef.wm.detectedPlatform === 'mac' ? 'macOS' : 'Windows' }})
                </button>
                <button
                  type="button"
                  data-controls-mode="mac"
                  class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
                  :class="
                    shellRef.wm.controlsMode.value === 'mac'
                      ? 'bg-[#303030] text-white'
                      : 'text-[#666] hover:text-[#303030]'
                  "
                  @click="shellRef.wm.setControlsMode('mac')"
                >
                  macOS (Left)
                </button>
                <button
                  type="button"
                  data-controls-mode="windows"
                  class="rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium transition-colors"
                  :class="
                    shellRef.wm.controlsMode.value === 'windows'
                      ? 'bg-[#303030] text-white'
                      : 'text-[#666] hover:text-[#303030]'
                  "
                  @click="shellRef.wm.setControlsMode('windows')"
                >
                  Windows (Right)
                </button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button size="xs" variant="secondary" type="button" @click="shellRef?.wm.applyPreset('tile-2up')">
                <Columns2Icon data-icon="inline-start" />
                Tile 2-Up
              </Button>
              <Button size="xs" variant="secondary" type="button" @click="shellRef?.wm.applyPreset('focus-chat')">
                <Maximize2Icon data-icon="inline-start" />
                Focus Otto
              </Button>
              <Button size="xs" variant="secondary" type="button" @click="shellRef?.wm.applyPreset('cascade')">
                <LayersIcon data-icon="inline-start" />
                Cascade
              </Button>
              <Button size="xs" variant="secondary" type="button" @click="shellRef?.wm.applyPreset('show-desktop')">
                <LayoutGridIcon data-icon="inline-start" />
                Show Desktop
              </Button>
              <Button size="xs" variant="outline" type="button" @click="shellRef?.wm.applyPreset('reset')">
                <RotateCcwIcon data-icon="inline-start" />
                Reset Layout
              </Button>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-[#666]">
              <div>
                <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
                  {{ shellRef?.wm.shortcutLabels.value.spotlight ?? 'Ctrl+K' }}
                </kbd>
                Spotlight
              </div>
              <div>
                <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
                  {{ shellRef?.wm.shortcutLabels.value.altPrefix ?? 'Alt+' }}1–7
                </kbd>
                Toggle Apps
              </div>
              <div>
                <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
                  {{ shellRef?.wm.shortcutLabels.value.tile ?? 'Alt+Shift+T' }}
                </kbd>
                Tile 2-Up
              </div>
              <div>
                <kbd class="rounded bg-[#f2f2f2] px-1.5 py-0.5 text-[#303030]">
                  {{ shellRef?.wm.shortcutLabels.value.desktop ?? 'Alt+Shift+D' }}
                </kbd>
                Show Desktop
              </div>
            </div>
          </div>

          <!-- Quick Links -->
          <div class="otto-card p-4">
            <div class="mb-3 font-mono text-xs font-semibold text-[#303030]">
              Connected Surfaces
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="secondary"
                type="button"
                @click="shellRef?.wm.openWindow('chrome')"
              >
                <GlobeIcon data-icon="inline-start" />
                Chrome Sessions ({{ chromeSessionCount }})
              </Button>
              <Button
                size="xs"
                variant="secondary"
                type="button"
                @click="handleMissionTabRequest('connectors')"
              >
                <PlugIcon data-icon="inline-start" />
                Sprites Connectors ({{ navCounts.connectors }})
              </Button>
            </div>
          </div>
        </div>
      </template>
    </DesktopShell>

    <SessionSidebar
      :open="sidebarOpen"
      :sessions="sessions"
      :busy="busy"
      @close="sidebarOpen = false"
      @new-chat="newChat"
      @select="switchChat"
    />

    <BrowserLoginModal
      :request="activeLoginRequest"
      @completed="handleLoginModalCompleted"
      @cancelled="handleLoginModalCancelled"
    />

    <Toaster position="bottom-right" />
  </TooltipProvider>
</template>

<style scoped>
.chat-window-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}
.messages-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 12px;
  background: var(--surface);
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty-state {
  margin: 20px 6px;
  padding: 22px 18px;
  border-radius: 16px;
  background: var(--surface-alt);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}
.empty-state h2 {
  margin: 4px 0 0;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 500;
  color: var(--fg);
}
.empty-state p {
  margin: 0 0 10px;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1.5;
}
.starters {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.starter {
  width: 100%;
  text-align: left;
  padding: 9px 14px;
  border: none;
  border-radius: 14px;
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
  box-shadow: var(--shadow-pill);
  transition: transform var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}
.starter:hover {
  background: var(--highlight-yellow);
  transform: translateY(-1px);
}
.activity {
  flex-shrink: 0;
  padding: 6px 14px;
  color: var(--fg);
  background: var(--highlight-yellow);
  font-size: 11.5px;
  font-family: var(--font-mono);
  display: flex;
  align-items: center;
  gap: 8px;
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--fg);
  animation: blink 1.1s ease-in-out infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.error-banner {
  flex-shrink: 0;
  padding: 8px 14px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 11.5px;
  font-family: var(--font-mono);
}
</style>
