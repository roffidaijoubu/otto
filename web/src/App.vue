<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import ChatComposer from "./components/ChatComposer.vue";
import ChatHeader from "./components/ChatHeader.vue";
import MessageBubble from "./components/MessageBubble.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import MissionControlWorkspace from "./components/MissionControlWorkspace.vue";
import TodoChecklistCard from "./components/TodoChecklistCard.vue";
import type { ChatMessage, SessionSummary, TodoPhase, TraceStep } from "./types/chat";

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
const zeroLocalKeys = ref<boolean | null>(null);
const aiMediaDisabled = ref<boolean | null>(null);
const missionRefreshTick = ref(0);
const messagesWrapRef = ref<HTMLElement | null>(null);

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
    } else if (type === "done") {
      commitLiveAssistant();
      busy.value = false;
      loadSessions();
      missionRefreshTick.value += 1;
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

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || busy.value) return;
  error.value = "";
  draft.value = "";
  busy.value = true;
  activity.value = "Thinking...";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
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

function handleGuardrailsUpdated(payload: {
  zeroLocalKeys: boolean | null;
  aiMediaDisabled: boolean | null;
}) {
  zeroLocalKeys.value = payload.zeroLocalKeys;
  aiMediaDisabled.value = payload.aiMediaDisabled;
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

onMounted(async () => {
  await Promise.all([loadMessages(), loadSessions()]);
  connectEvents();
});
</script>

<template>
  <div class="studio-shell">
    <ChatHeader
      :status-state="statusState"
      :status-label="statusLabel"
      :zero-local-keys="zeroLocalKeys"
      :ai-media-disabled="aiMediaDisabled"
      :mobile-pane="mobilePane"
      @update:mobile-pane="mobilePane = $event"
    />

    <div class="studio-body">
      <!-- PRIMARY WORKSPACE: MISSION CONTROL AT A GLANCE -->
      <div class="workspace-pane" :class="{ 'mobile-hidden': mobilePane !== 'dashboard' }">
        <MissionControlWorkspace
          :refresh-tick="missionRefreshTick"
          @ask-prompt="handleMissionPrompt"
          @guardrails-updated="handleGuardrailsUpdated"
        />
      </div>

      <!-- DOCKED RIGHT CO-PILOT: PROFESSOR L CHAT -->
      <aside class="chat-pane" :class="{ 'mobile-hidden': mobilePane !== 'chat' }">
        <div class="chat-pane-head">
          <div>
            <div class="chat-pane-title">Co-Pilot Chat</div>
            <div class="chat-pane-sub">Direct line to Professor L</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              class="btn btn-xs btn-cafe-secondary"
              type="button"
              @click="sidebarOpen = !sidebarOpen"
            >
              Chats ({{ sessions.length }})
            </button>
            <button
              class="btn btn-xs btn-cafe-primary"
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
              <h2>Professor L is in the room.</h2>
              <p>
                No fluff, no yes-man answers, zero AI slop. Use Mission Control on the left or tell
                me what stream/video we are working on today.
              </p>
              <div class="starters">
                <button
                  v-for="prompt in starters"
                  :key="prompt"
                  class="starter-btn"
                  type="button"
                  @click="useStarter(prompt)"
                >
                  {{ prompt }}
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
            />

            <MessageBubble
              v-if="hasLiveContent"
              role="assistant"
              :text="liveText"
              :thinking="liveThinking"
              :steps="liveSteps"
              :live="true"
            />
          </div>
        </main>

        <div v-if="busy" class="activity">
          <span class="activity-dot"></span>
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
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
  background: var(--bg);
  overflow: hidden;
}
.studio-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.workspace-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.chat-pane {
  width: 430px;
  max-width: 44vw;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg);
}
.chat-pane-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-alt);
}
.chat-pane-title {
  font-family: var(--font-serif);
  font-size: 16px;
  line-height: 1.1;
  color: var(--fg);
}
.chat-pane-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-muted);
}
.messages-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
}
@media (max-width: 1024px) {
  .chat-pane {
    width: 100%;
    max-width: 100%;
    border-left: none;
  }
  .mobile-hidden {
    display: none;
  }
}
.messages {
  max-width: var(--max-width);
  margin: 0 auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.empty-state {
  margin: auto;
  max-width: 500px;
  padding: 28px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-raised);
  text-align: left;
}
.empty-state h2 {
  margin: 0 0 8px 0;
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 26px;
  line-height: 1.25;
  color: var(--fg);
}
.empty-state p {
  margin: 0 0 18px 0;
  font-size: 14px;
  color: var(--fg-muted);
  line-height: 1.55;
}
.starters {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.starter-btn {
  text-align: left;
  padding: 11px 14px;
  border: none;
  border-radius: var(--radius);
  background: var(--surface-alt);
  color: var(--accent);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-raised-sm);
  transition: background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.starter-btn:hover {
  background: var(--surface);
  box-shadow: var(--shadow-raised);
}
.activity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface-alt);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
}
.activity-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-circle);
  background: var(--warning);
}
.error-banner {
  padding: 10px 20px;
  border-top: 1px solid var(--error);
  background: var(--error-bg);
  color: var(--error);
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
