<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import ChatComposer, { type ComposerAttachment } from "./components/ChatComposer.vue";
import ChatHeader, { type StudioTab } from "./components/ChatHeader.vue";
import MessageBubble from "./components/MessageBubble.vue";
import MissionControlWorkspace from "./components/MissionControlWorkspace.vue";
import OttoMascot from "./components/OttoMascot.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import StudioSetupWizard from "./components/StudioSetupWizard.vue";
import TodoChecklistCard from "./components/TodoChecklistCard.vue";
import type { ChatMessage, SessionSummary, TodoPhase, TraceStep } from "./types/chat";

const MASCOT_SWATCHES = ["#303030", "#7CC6A5", "#E89B7E", "#A7D8F0", "#C9B8E8", "#F9F5A2"] as const;

const messages = ref<ChatMessage[]>([]);
const sessions = ref<SessionSummary[]>([]);
const todos = ref<TodoPhase[]>([]);
const draft = ref("");
const busy = ref(false);
const activity = ref("Thinking...");
const connectionState = ref<"connecting" | "ready" | "error">("connecting");
const error = ref("");
const sidebarOpen = ref(false);
const mobilePane = ref<"dashboard" | "chat">("dashboard");
const activeTab = ref<StudioTab>("overview");
const navCounts = ref({ schedule: 0, files: 0, database: 0, connectors: 0 });
const missionRefreshTick = ref(0);
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

function cycleMascotColor() {
  const idx = (MASCOT_SWATCHES as readonly string[]).indexOf(mascotColor.value);
  const next = MASCOT_SWATCHES[(idx + 1) % MASCOT_SWATCHES.length];
  setMascotColor(next);
}

// Live streaming accumulator for the active assistant response
const liveText = ref("");
const liveThinking = ref("");
const liveSteps = ref<TraceStep[]>([]);

const starters = [
  "Let's get started — do your homework on my channel.",
  "Audit my latest YouTube uploads and roast my titles.",
  "Help me plan a 4-hour segment-first stream for tonight.",
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

const statusLabel = computed(() => {
  if (connectionState.value === "error") return "reconnecting";
  if (busy.value) return "working";
  if (connectionState.value === "ready") return "online";
  return "connecting";
});

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
    } else if (type === "db_changed") {
      dbRefreshTick.value += 1;
      missionRefreshTick.value += 1;
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
  mobilePane.value = "chat";
  useStarter(prompt);
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
  await Promise.all([loadSetupStatus(), loadMessages(), loadSessions()]);
  connectEvents();
});
</script>

<template>
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

  <div v-else-if="setupChecked" class="studio-shell">
    <ChatHeader
      :status-state="statusState"
      :status-label="statusLabel"
      :mobile-pane="mobilePane"
      :active-tab="activeTab"
      :mascot-color="mascotColor"
      :counts="navCounts"
      @update:mobile-pane="mobilePane = $event"
      @update:active-tab="activeTab = $event"
      @cycle-mascot-color="cycleMascotColor"
    />

    <div class="studio-body">
      <!-- PRIMARY STUDIO BENTO DESKTOP -->
      <div class="workspace-pane" :class="{ 'mobile-hidden': mobilePane !== 'dashboard' }">
        <MissionControlWorkspace
          :active-tab="activeTab"
          :refresh-tick="missionRefreshTick"
          :workspace-refresh-tick="workspaceRefreshTick"
          :db-refresh-tick="dbRefreshTick"
          :mascot-color="mascotColor"
          :status-state="statusState"
          :swatches="[...MASCOT_SWATCHES]"
          @update:active-tab="activeTab = $event"
          @select-mascot-color="setMascotColor"
          @counts-updated="navCounts = $event"
          @ask-prompt="handleMissionPrompt"
          @open-setup="reopenSetup"
        />
      </div>

      <!-- DOCKED RIGHT FLOATING WIDGET: (Y)OUR CO-PILOT -->
      <aside class="chat-pane otto-card" :class="{ 'mobile-hidden': mobilePane !== 'chat' }">
        <div class="otto-card-head">
          <div class="otto-card-head-left">
            <button
              class="btn btn-xs btn-otto-secondary"
              type="button"
              @click="sidebarOpen = true"
            >
              Chats ({{ sessions.length }})
            </button>
          </div>
          <span>(Y)our co-pilot.</span>
          <div class="otto-card-head-right">
            <button
              class="btn btn-xs btn-otto-primary"
              type="button"
              :disabled="busy"
              @click="newChat"
            >
              + New
            </button>
          </div>
        </div>

        <main class="messages-wrap" ref="messagesWrapRef">
          <div class="messages">
            <div v-if="messages.length === 0 && !hasLiveContent" class="empty-state">
              <OttoMascot :size="52" :color="mascotColor" :state="statusState" />
              <h2>Otto is in the room.</h2>
              <p>
                No fluff, no yes-man answers, zero AI slop. Use <span class="mark-y">(y)our</span> studio desktop on the left or tell Otto what stream or video we are sharpening today.
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
      </aside>
    </div>

    <SessionSidebar
      :open="sidebarOpen"
      :sessions="sessions"
      :busy="busy"
      @close="sidebarOpen = false"
      @new-chat="newChat"
      @select="switchChat"
    />
  </div>
</template>

<style scoped>
.studio-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 1560px;
  margin: 0 auto;
}
.studio-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
  padding: 10px 18px 18px;
  overflow: hidden;
}
.workspace-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chat-pane {
  width: 430px;
  flex-shrink: 0;
  min-height: 0;
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

@media (max-width: 1200px) {
  .chat-pane {
    width: 370px;
  }
}
@media (max-width: 1024px) {
  .studio-body {
    padding: 8px 10px 10px;
  }
  .chat-pane {
    width: 100%;
    flex: 1;
  }
  .mobile-hidden {
    display: none !important;
  }
}
</style>
