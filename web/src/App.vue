<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import ChatComposer from "./components/ChatComposer.vue";
import ChatHeader from "./components/ChatHeader.vue";
import MessageBubble from "./components/MessageBubble.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import MissionControlDrawer from "./components/MissionControlDrawer.vue";
import type { ChatMessage, SessionSummary, TraceStep } from "./types/chat";

const messages = ref<ChatMessage[]>([]);
const sessions = ref<SessionSummary[]>([]);
const draft = ref("");
const busy = ref(false);
const activity = ref("Thinking...");
const connectionState = ref<"connecting" | "ready" | "error">("connecting");
const error = ref("");
const sidebarOpen = ref(window.innerWidth > 768);
const missionControlOpen = ref(false);
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
  es.onopen = () => {
    error.value = "";
    connectionState.value = "ready";
  };
  es.onerror = () => {
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
    } else if (type === "activity") {
      busy.value = true;
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
  missionControlOpen.value = false;
  useStarter(prompt);
}

async function stopReply() {
  await fetch("/api/abort", { method: "POST" }).catch(() => {});
}

async function newChat() {
  if (busy.value) return;
  error.value = "";
  await fetch("/api/new", { method: "POST" }).catch(() => {});
  if (window.innerWidth <= 768) sidebarOpen.value = false;
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
    } else if (window.innerWidth <= 768) {
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
  <div class="shell">
    <SessionSidebar
      :open="sidebarOpen"
      :sessions="sessions"
      :busy="busy"
      @close="sidebarOpen = false"
      @new-chat="newChat"
      @select="switchChat"
    />

    <div class="main">
      <ChatHeader
        :sidebar-open="sidebarOpen"
        :mission-control-open="missionControlOpen"
        :status-state="statusState"
        :status-label="statusLabel"
        :busy="busy"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @toggle-mission-control="missionControlOpen = !missionControlOpen"
        @new-chat="newChat"
      />

      <main class="messages-wrap" ref="messagesWrapRef">
        <div class="messages">
          <div v-if="messages.length === 0 && !hasLiveContent" class="empty-state">
            <h2>Professor L is in the room.</h2>
            <p>
              No fluff, no yes-man answers, zero AI slop. Tell me who you are or what stream/video
              we are working on today.
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

      <ChatComposer v-model="draft" :busy="busy" @send="sendMessage" @stop="stopReply" />
    </div>

    <MissionControlDrawer
      :open="missionControlOpen"
      :refresh-tick="missionRefreshTick"
      @close="missionControlOpen = false"
      @ask-prompt="handleMissionPrompt"
    />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  width: 100%;
  background: var(--bg);
  overflow: hidden;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--bg);
}
.messages-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px;
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
  max-width: 460px;
  padding: 24px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
}
.empty-state h2 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.empty-state p {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: var(--fg-muted);
}
.starters {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.starter-btn {
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
}
.starter-btn:hover {
  border-color: var(--border-strong);
  background: var(--surface-alt);
}
.activity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
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
  padding: 8px 16px;
  border-top: 1px solid var(--error);
  background: var(--bg);
  color: var(--error);
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
