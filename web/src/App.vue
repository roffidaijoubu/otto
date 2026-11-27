<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Loader2Icon, MessageSquareIcon, PlusIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DesktopShell, type DesktopShellExposed } from "@/components/os";
import type { CustomAppId, DesktopShortcut } from "@/composables/useWindowManager";
import CustomStudioAppWindow from "./components/CustomStudioAppWindow.vue";
import ObsOverlaysWorkspaceApp from "./components/ObsOverlaysWorkspaceApp.vue";
import ThumbnailsWorkspaceApp from "./components/ThumbnailsWorkspaceApp.vue";
import AnalyticsWorkspaceApp from "./components/AnalyticsWorkspaceApp.vue";
import CalendarWorkspaceApp from "./components/CalendarWorkspaceApp.vue";
import ChannelMetricsWidget from "./components/ChannelMetricsWidget.vue";
import ChatComposer, { type ComposerAttachment } from "./components/ChatComposer.vue";
import ClipsWorkspaceApp from "./components/ClipsWorkspaceApp.vue";
import ContactsWorkspaceApp from "./components/ContactsWorkspaceApp.vue";
import IdeasWorkspaceApp from "./components/IdeasWorkspaceApp.vue";
import MessageBubble from "./components/MessageBubble.vue";
import NextStreamWidget from "./components/NextStreamWidget.vue";
import OttoMascot from "./components/OttoMascot.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import StudioSetupWizard from "./components/StudioSetupWizard.vue";
import SystemSettingsApp, { type SettingsTab } from "./components/SystemSettingsApp.vue";
import TodoChecklistCard from "./components/TodoChecklistCard.vue";
import WorkspaceFileManager from "./components/WorkspaceFileManager.vue";
import { playSound } from "@/lib/sounds";
import type { ChatMessage, SessionSummary, TodoPhase, TraceStep } from "./types/chat";

const MASCOT_SWATCHES = ["#303030", "#7CC6A5", "#E89B7E", "#A7D8F0", "#C9B8E8", "#F9F5A2"] as const;

const shellRef = ref<DesktopShellExposed | null>(null);
const fileManagerRef = ref<InstanceType<typeof WorkspaceFileManager> | null>(null);
const obsOverlaysRef = ref<InstanceType<typeof ObsOverlaysWorkspaceApp> | null>(null);
const thumbnailsRef = ref<InstanceType<typeof ThumbnailsWorkspaceApp> | null>(null);
const activeObsOverlaySlug = ref("");
const activeThumbnailSlug = ref("");
const studioAppsRefreshTick = ref(0);
const obsOverlaysRefreshTick = ref(0);
const thumbnailsRefreshTick = ref(0);
const clipsRefreshTick = ref(0);

interface InstalledCustomApp {
  slug: string;
  title: string;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
}
const installedCustomApps = ref<InstalledCustomApp[]>([]);

const BUILTIN_DESKTOP_SHORTCUTS: DesktopShortcut[] = [
  { id: "clips", label: "Clips", sublabel: "VOD Clipper", icon: "scissors", appId: "clips" },
  { id: "obs-overlays", label: "OBS Overlays", sublabel: "Fly Machine", icon: "tv", appId: "obs-overlays" },
  { id: "thumbnails", label: "Thumbnails", sublabel: "Zero-AI Studio", icon: "image", appId: "thumbnails" },
  { id: "ideas", label: "Ideas", sublabel: "Content", icon: "lightbulb", appId: "ideas" },
  { id: "analytics", label: "Analytics", sublabel: "YouTube", icon: "chart", appId: "analytics" },
  { id: "calendar", label: "Calendar", sublabel: "Schedule", icon: "calendar", appId: "calendar" },
  { id: "contacts", label: "Contacts", sublabel: "Rolodex", icon: "contacts", appId: "contacts" },
];

const desktopShortcuts = computed<DesktopShortcut[]>(() => [
  ...BUILTIN_DESKTOP_SHORTCUTS,
  ...installedCustomApps.value.map((app) => ({
    id: `custom-${app.slug}`,
    label: app.title,
    sublabel: "Studio App",
    icon: "app" as const,
    appId: `custom:${app.slug}` as CustomAppId,
  })),
]);

const messages = ref<ChatMessage[]>([]);
const sessions = ref<SessionSummary[]>([]);
const todos = ref<TodoPhase[]>([]);
const draft = ref("");
const busy = ref(false);
const activity = ref("Thinking...");
const connectionState = ref<"connecting" | "ready" | "error">("connecting");
const error = ref("");
const sidebarOpen = ref(false);
const settingsTab = ref<SettingsTab>("general");
const filesTargetPath = ref("");
const workspaceRefreshTick = ref(0);
const dbRefreshTick = ref(0);
const messagesWrapRef = ref<HTMLElement | null>(null);
const setupChecked = ref(false);
const showSetupWizard = ref(false);
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
  "Plan tonight's stream, lock it on Calendar, create the YouTube Live waiting room (unlisted) with a thumbnail, and draft X, TikTok & IG promos.",
  "Run a background VOD clip job on my latest stream and prep clips for my editor.",
  "Check my recent TikTok, Instagram, and X posts — what's getting the best traction?",
  "Build a live OBS Starting Soon overlay with my brand logo, matching visual style, countdown timer, and remote deck.",
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

async function loadInstalledCustomApps() {
  try {
    const res = await fetch("/api/studio-apps");
    if (!res.ok) return;
    const data = (await res.json()) as { apps?: InstalledCustomApp[] };
    const next = Array.isArray(data.apps) ? data.apps : [];
    const wm = shellRef.value?.wm;
    const nextIds = new Set(next.map((a) => `custom:${a.slug}`));
    if (wm) {
      for (const existing of [...wm.apps]) {
        if (existing.id.startsWith("custom:") && !nextIds.has(existing.id)) {
          wm.unregisterCustomApp(existing.id as CustomAppId);
        }
      }
      for (const app of next) {
        wm.registerCustomApp({
          id: `custom:${app.slug}` as CustomAppId,
          title: app.title,
          shortLabel: app.title.slice(0, 14),
          icon: "app",
          minWidth: 380,
          minHeight: 340,
          defaultWidth: app.defaultWidth || 680,
          defaultHeight: app.defaultHeight || 580,
          dockSection: "custom",
        });
      }
    }
    installedCustomApps.value = next;
  } catch {
    // ignore transient errors
  }
}

async function openCustomStudioApp(slug: string, title?: string, autoFocus = true) {
  const cleaned = slug.trim();
  if (!cleaned) return;
  await loadInstalledCustomApps();
  const wm = shellRef.value?.wm;
  const id = `custom:${cleaned}` as CustomAppId;
  if (wm && !wm.appMap[id]) {
    wm.registerCustomApp({
      id,
      title: title || cleaned,
      shortLabel: (title || cleaned).slice(0, 14),
      icon: "app",
      minWidth: 380,
      minHeight: 340,
      defaultWidth: 680,
      defaultHeight: 580,
      dockSection: "custom",
    });
  }
  studioAppsRefreshTick.value += 1;
  wm?.openWindow(id, { focus: autoFocus });
}

function handleCustomAppUninstalled(slug: string) {
  const id = `custom:${slug}` as CustomAppId;
  shellRef.value?.wm.unregisterCustomApp(id);
  installedCustomApps.value = installedCustomApps.value.filter((a) => a.slug !== slug);
}

function openObsOverlayWindow(slug?: string, title?: string, autoFocus = true) {
  if (slug) activeObsOverlaySlug.value = slug;
  obsOverlaysRefreshTick.value += 1;
  shellRef.value?.wm.openWindow("obs-overlays", {
    focus: autoFocus,
    subtitle: title || slug || undefined,
  });
  if (slug) {
    nextTick(() => {
      obsOverlaysRef.value?.selectOverlay(slug);
    });
  }
}

function openThumbnailWindow(slug?: string, title?: string, autoFocus = true) {
  if (slug) activeThumbnailSlug.value = slug;
  thumbnailsRefreshTick.value += 1;
  shellRef.value?.wm.openWindow("thumbnails", {
    focus: autoFocus,
    subtitle: title || slug || undefined,
  });
  if (slug) {
    nextTick(() => {
      thumbnailsRef.value?.selectThumbnail(slug);
    });
  }
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
      if (msg.text.trim()) {
        playSound("chat_receive");
      }
      commitLiveAssistant(msg.text);
    } else if (type === "workspace_changed") {
      workspaceRefreshTick.value += 1;
      if (wm && wm.focusedWindowId.value !== "files") {
        wm.setWindowMeta("files", { badgeText: "Updated" });
      }
    } else if (type === "studio_apps_changed") {
      studioAppsRefreshTick.value += 1;
      void loadInstalledCustomApps();
    } else if (type === "studio_app_open" && typeof msg.slug === "string") {
      void openCustomStudioApp(
        msg.slug,
        typeof msg.title === "string" ? msg.title : undefined,
        msg.autoFocus !== false
      );
    } else if (type === "obs_overlays_changed") {
      obsOverlaysRefreshTick.value += 1;
    } else if (type === "obs_overlay_open") {
      openObsOverlayWindow(
        typeof msg.slug === "string" ? msg.slug : undefined,
        typeof msg.title === "string" ? msg.title : undefined,
        msg.autoFocus !== false
      );
    } else if (type === "obs_overlay_job_started") {
      openObsOverlayWindow(undefined, undefined, false);
      nextTick(() => {
        obsOverlaysRef.value?.notifyExternalJob({
          running: true,
          label: typeof msg.label === "string" ? msg.label : "Building OBS overlay...",
          slug: typeof msg.slug === "string" ? msg.slug : undefined,
        });
      });
    } else if (type === "obs_overlay_job_finished") {
      obsOverlaysRef.value?.notifyExternalJob({
        running: false,
        slug: typeof msg.slug === "string" ? msg.slug : undefined,
      });
      obsOverlaysRefreshTick.value += 1;
    } else if (type === "thumbnails_changed") {
      thumbnailsRefreshTick.value += 1;
    } else if (type === "thumbnail_open") {
      openThumbnailWindow(
        typeof msg.slug === "string" ? msg.slug : undefined,
        typeof msg.title === "string" ? msg.title : undefined,
        msg.autoFocus !== false
      );
    } else if (type === "thumbnail_job_started") {
      openThumbnailWindow(undefined, undefined, false);
      nextTick(() => {
        thumbnailsRef.value?.notifyExternalJob({
          running: true,
          label: typeof msg.label === "string" ? msg.label : "Composing thumbnail...",
          slug: typeof msg.slug === "string" ? msg.slug : undefined,
        });
      });
    } else if (type === "thumbnail_job_finished") {
      thumbnailsRef.value?.notifyExternalJob({
        running: false,
        slug: typeof msg.slug === "string" ? msg.slug : undefined,
      });
      thumbnailsRefreshTick.value += 1;
    } else if (type === "db_changed") {
      dbRefreshTick.value += 1;
      if (wm && wm.focusedWindowId.value !== "ideas") {
        wm.setWindowMeta("ideas", { badgeText: "Updated" });
      }
    } else if (type === "jobs_changed") {
      window.dispatchEvent(new CustomEvent("otto:jobs-changed"));
    } else if (type === "clips_changed" || type === "archive_changed") {
      clipsRefreshTick.value += 1;
      window.dispatchEvent(new CustomEvent("otto:jobs-changed"));
      if (type === "clips_changed" && wm && wm.focusedWindowId.value !== "clips") {
        wm.setWindowMeta("clips", { badgeText: "Updated" });
      }
    } else if (type === "done") {
      commitLiveAssistant();
      busy.value = false;
      loadSessions();
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
      playSound("error");
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
  playSound("chat_send");
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
      playSound("error");
    }
  } catch (err) {
    error.value = "Network error: " + (err instanceof Error ? err.message : String(err));
    busy.value = false;
    playSound("error");
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

function openAnalyticsApp() {
  shellRef.value?.wm.openWindow("analytics", { focus: true });
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
  await Promise.all([
    loadSetupStatus(),
    loadMessages(),
    loadSessions(),
  ]);
  nextTick(() => {
    void loadInstalledCustomApps();
  });
  connectEvents();
});

watch(shellRef, (val) => {
  if (val) void loadInstalledCustomApps();
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
      :mascot-state="statusState"
      :mascot-color="mascotColor"
      :status-subtitle="desktopStatusSubtitle"
      :shortcuts="desktopShortcuts"
      @open-files-path="openFilesAtPath"
      @desktop-action="handleDesktopAction"
    >
      <template #desktop-top-right-widget>
        <div class="flex flex-col gap-3">
          <ChannelMetricsWidget
            :refresh-tick="dbRefreshTick"
            @open-metrics="openAnalyticsApp"
          />
          <NextStreamWidget
            :refresh-tick="dbRefreshTick"
            @open-calendar="shellRef?.wm.openWindow('calendar', { focus: true })"
            @ask-prompt="handleMissionPrompt"
          />
        </div>
      </template>

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
                  Practical stream ops, zero AI art or video. Plan streams, clip VODs in the background, build live OBS overlays, or research what's working across <span class="mark-y">(y)our</span> channels.
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
                @open-studio-app="openCustomStudioApp($event.slug, $event.title)"
                @open-obs-overlay="openObsOverlayWindow($event.slug, $event.title)"
              />

              <MessageBubble
                v-if="hasLiveContent"
                role="assistant"
                :text="liveText"
                :thinking="liveThinking"
                :steps="liveSteps"
                :mascot-color="mascotColor"
                live
                @open-studio-app="openCustomStudioApp($event.slug, $event.title)"
                @open-obs-overlay="openObsOverlayWindow($event.slug, $event.title)"
              />
            </div>
          </main>

          <div v-if="busy" class="activity" role="status" aria-live="polite">
            <Loader2Icon class="activity-spinner" aria-hidden="true" />
            <span class="activity-text">{{ activity }}</span>
          </div>

          <div v-if="error" class="error-banner">{{ error }}</div>

          <TodoChecklistCard :phases="todos" @dismiss="todos = []" />

          <ChatComposer v-model="draft" :busy="busy" @send="sendMessage" @stop="stopReply" />
        </div>
      </template>

      <!-- WINDOW 2: STUDIO FILES -->
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

      <!-- WINDOW 3B: OBS OVERLAYS (Fly Machine Hosted) -->
      <template #app-obs-overlays>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <ObsOverlaysWorkspaceApp
            ref="obsOverlaysRef"
            :refresh-tick="obsOverlaysRefreshTick"
            :initial-slug="activeObsOverlaySlug"
            @ask-prompt="handleMissionPrompt"
            @selected-changed="
              shellRef?.wm.setWindowMeta('obs-overlays', { subtitle: $event.title })
            "
          />
        </div>
      </template>

      <!-- WINDOW 3C: THUMBNAIL STUDIO (Zero-AI Isolated OMP Worker) -->
      <template #app-thumbnails>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <ThumbnailsWorkspaceApp
            ref="thumbnailsRef"
            :refresh-tick="thumbnailsRefreshTick"
            :initial-slug="activeThumbnailSlug"
            @selected-changed="
              shellRef?.wm.setWindowMeta('thumbnails', { subtitle: $event.title })
            "
          />
        </div>
      </template>

      <!-- DYNAMIC CUSTOM STUDIO APP WINDOWS -->
      <template #custom-app="{ win }">
        <CustomStudioAppWindow
          :slug="win.id.replace(/^custom:/, '')"
          :refresh-tick="studioAppsRefreshTick"
          @uninstalled="handleCustomAppUninstalled"
        />
      </template>

      <!-- WINDOW 4: CLIPS -->
      <template #app-clips>
        <ClipsWorkspaceApp :refresh-tick="clipsRefreshTick" />
      </template>

      <!-- WINDOW 5: IDEAS -->
      <template #app-ideas>
        <IdeasWorkspaceApp
          :refresh-tick="dbRefreshTick"
          @ask-prompt="handleMissionPrompt"
          @open-workspace-path="openFilesAtPath"
        />
      </template>

      <!-- WINDOW 5: ANALYTICS -->
      <template #app-analytics>
        <AnalyticsWorkspaceApp
          :refresh-tick="dbRefreshTick"
          @ask-prompt="handleMissionPrompt"
        />
      </template>

      <!-- WINDOW 5: CALENDAR -->
      <template #app-calendar>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <CalendarWorkspaceApp
            :refresh-tick="dbRefreshTick"
            @ask-prompt="handleMissionPrompt"
          />
        </div>
      </template>

      <!-- WINDOW 6: CONTACTS -->
      <template #app-contacts>
        <div class="flex h-full min-h-0 flex-col bg-white">
          <ContactsWorkspaceApp
            :refresh-tick="dbRefreshTick"
            @ask-prompt="handleMissionPrompt"
          />
        </div>
      </template>

      <!-- WINDOW 7: SYSTEM SETTINGS (Native 2-Pane Preferences) -->
      <template #app-settings>
        <SystemSettingsApp
          :wm="shellRef?.wm ?? null"
          :active-tab="settingsTab"
          :refresh-tick="dbRefreshTick"
          :mascot-color="mascotColor"
          :status-state="statusState"
          :swatches="MASCOT_SWATCHES"
          :creator-name="setupInitialName"
          :timezone="setupInitialTimezone"
          @update:active-tab="settingsTab = $event"
          @select-mascot-color="setMascotColor"
          @identity-updated="setupInitialName = $event.creatorName; setupInitialTimezone = $event.timezone; dbRefreshTick += 1"
          @open-setup="reopenSetup"
          @ask-prompt="handleMissionPrompt"
        />
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
  padding: 16px 16px 12px;
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
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  background: #fafafa;
  font-size: 12px;
  font-family: var(--font-sans);
  display: flex;
  align-items: center;
  gap: 8px;
}
.activity-spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--fg);
  animation: spin 1s linear infinite;
}
.activity-text {
  color: var(--fg);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.error-banner {
  flex-shrink: 0;
  padding: 8px 16px;
  border-top: 1px solid #fecaca;
  background: var(--error-bg);
  color: var(--error);
  font-size: 12px;
  font-family: var(--font-sans);
}
</style>
