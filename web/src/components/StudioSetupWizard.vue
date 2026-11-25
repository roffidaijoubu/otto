<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { TIMEZONE_OPTIONS } from "../lib/timezones";
import OttoMascot from "./OttoMascot.vue";
interface ConnectorInfo {
  provider: string;
  displayName: string;
  connectionType: string;
  description: string;
  status: string;
}

const props = defineProps<{
  initialName: string;
  initialTimezone: string;
  mascotColor: string;
  swatches: string[];
}>();

const emit = defineEmits<{
  completed: [];
  skipped: [];
  selectMascotColor: [color: string];
}>();

const step = ref<1 | 2 | 3>(1);
const creatorName = ref(props.initialName || "");
const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();
const timezone = ref(props.initialTimezone || browserTz);
const newPassword = ref("");
const confirmPassword = ref("");
const saving = ref(false);
const errorMsg = ref("");

const connectors = ref<ConnectorInfo[]>([]);
const loadingConnectors = ref(false);

const timezoneOptions = computed(() => {
  const current = timezone.value.trim();
  if (current && !TIMEZONE_OPTIONS.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...TIMEZONE_OPTIONS];
  }
  return TIMEZONE_OPTIONS;
});
const expectedServices = [
  { key: "gemini", label: "Google Gemini", role: "Brain + Multimodal Review", required: true, match: /gemini/i },
  { key: "composio", label: "Composio v3", role: "YouTube & Google Calendar", required: false, match: /composio/i },
  { key: "buffer", label: "Buffer", role: "X / TikTok / Instagram Drafts", required: false, match: /buffer/i },
  { key: "qstash", label: "Upstash QStash", role: "Proactive Sprite Wake-Ups", required: false, match: /qstash/i },
  { key: "exa", label: "Exa", role: "Live Research & Benchmarks", required: false, match: /exa/i },
  { key: "firecrawl", label: "Firecrawl", role: "Clean Web Page Scraping", required: false, match: /firecrawl/i },
];

const serviceChecklist = computed(() =>
  expectedServices.map((svc) => ({
    ...svc,
    connected: connectors.value.some(
      (c) => svc.match.test(c.provider) || svc.match.test(c.displayName)
    ),
  }))
);

const extraConnectors = computed(() =>
  connectors.value.filter(
    (c) =>
      !expectedServices.some(
        (svc) => svc.match.test(c.provider) || svc.match.test(c.displayName)
      )
  )
);

async function fetchConnectors() {
  loadingConnectors.value = true;
  try {
    const res = await fetch("/api/connectors");
    const data = (await res.json()) as {
      connectors?: ConnectorInfo[];
    };
    connectors.value = Array.isArray(data.connectors) ? data.connectors : [];
  } catch {
  } finally {
    loadingConnectors.value = false;
  }
}

function goStep2() {
  errorMsg.value = "";
  if (!creatorName.value.trim()) {
    errorMsg.value = "Drop your creator name or handle so Otto knows who's in the chair.";
    return;
  }
  step.value = 2;
}

function goStep3() {
  errorMsg.value = "";
  const pw = newPassword.value.trim();
  if (pw) {
    if (pw.length < 8) {
      errorMsg.value = "New passcode must be at least 8 characters.";
      return;
    }
    if (pw !== confirmPassword.value.trim()) {
      errorMsg.value = "Passcodes do not match.";
      return;
    }
  }
  step.value = 3;
  fetchConnectors();
}

async function finishSetup() {
  saving.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorName: creatorName.value.trim(),
        timezone: timezone.value.trim() || browserTz,
        newPassword: newPassword.value.trim() || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) {
      errorMsg.value = data.error || "Could not save setup";
      return;
    }
    emit("completed");
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Network error";
  } finally {
    saving.value = false;
  }
}

async function skipSetup() {
  saving.value = true;
  try {
    await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: true }),
    }).catch(() => {});
  } finally {
    saving.value = false;
    emit("skipped");
  }
}

onMounted(() => {
  fetchConnectors();
});
</script>

<template>
  <div class="wizard-shell">
    <div class="otto-card wizard-card">
      <div class="otto-card-head">
        <span>(Y)our studio setup · step {{ step }}/3.</span>
        <div class="otto-card-head-right">
          <button
            type="button"
            class="skip-link"
            :disabled="saving"
            @click="skipSetup"
          >
            skip
          </button>
        </div>
      </div>

      <div class="wizard-body">
        <!-- Step Progress Pills -->
        <div class="step-pills">
          <button type="button" class="step-pill" :class="{ active: step === 1, done: step > 1 }" @click="step = 1">
            1. Identity
          </button>
          <button type="button" class="step-pill" :class="{ active: step === 2, done: step > 2 }" @click="step = 2">
            2. Passcode
          </button>
          <button type="button" class="step-pill" :class="{ active: step === 3 }" @click="goStep3">
            3. Connectors
          </button>
        </div>

        <!-- STEP 1: IDENTITY & TIMEZONE -->
        <div v-if="step === 1" class="step-pane">
          <div class="wizard-hero">
            <OttoMascot :size="54" :color="mascotColor" state="ready" />
            <h1>Hi, Otto is <span class="mark-y">(y)</span>our stream manager.</h1>
            <p>Let's set up your desk in 30 seconds. Pick Otto's color, your creator name, and your local timezone.</p>
          </div>

          <div class="swatch-row">
            <button
              v-for="sw in swatches"
              :key="sw"
              type="button"
              class="swatch-dot"
              :class="{ active: mascotColor === sw }"
              :style="{ background: sw }"
              :title="`Otto color ${sw}`"
              @click="emit('selectMascotColor', sw)"
            ></button>
          </div>

          <div class="field-group">
            <label class="field-label" for="wiz-name">Creator Name / Persona</label>
            <input
              id="wiz-name"
              v-model="creatorName"
              type="text"
              class="wiz-input"
              placeholder="e.g. Roffi Daijoubu"
              autofocus
              @keydown.enter="goStep2"
            />
          </div>

          <div class="field-group">
            <div class="flex items-center justify-between gap-2">
              <label class="field-label" for="wiz-tz">Home Timezone</label>
              <button
                type="button"
                class="tz-detect-btn"
                @click="timezone = browserTz"
              >
                auto: {{ browserTz }}
              </button>
            </div>
            <select
              id="wiz-tz"
              v-model="timezone"
              class="wiz-input wiz-select"
            >
              <option v-for="opt in timezoneOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div v-if="errorMsg" class="wiz-err">{{ errorMsg }}</div>

          <div class="wizard-actions">
            <Button type="button" variant="secondary" size="sm" :disabled="saving" @click="skipSetup">
              Skip for now
            </Button>
            <Button type="button" size="sm" @click="goStep2">
              Next: Passcode
            </Button>
          </div>
        </div>

        <!-- STEP 2: OPTIONAL PASSCODE UPDATE -->
        <div v-else-if="step === 2" class="step-pane">
          <div class="wizard-hero">
            <OttoMascot :size="48" :color="mascotColor" state="ready" />
            <h1>Lock <span class="mark-y">(y)</span>our studio passcode.</h1>
            <p>Optional. Replace the auto-generated passcode with one you'll remember, or leave blank to keep your current passcode.</p>
          </div>

          <div class="field-group">
            <label class="field-label" for="wiz-pw">New Passcode (optional, min 8 chars)</label>
            <input
              id="wiz-pw"
              v-model="newPassword"
              type="password"
              class="wiz-input"
              placeholder="Leave blank to keep current passcode"
              autocomplete="new-password"
            />
          </div>

          <div v-if="newPassword.trim()" class="field-group">
            <label class="field-label" for="wiz-pw2">Confirm New Passcode</label>
            <input
              id="wiz-pw2"
              v-model="confirmPassword"
              type="password"
              class="wiz-input"
              placeholder="Re-enter new passcode"
              autocomplete="new-password"
              @keydown.enter="goStep3"
            />
          </div>

          <div v-if="errorMsg" class="wiz-err">{{ errorMsg }}</div>

          <div class="wizard-actions">
            <Button type="button" variant="secondary" size="sm" @click="step = 1; errorMsg = ''">
              ← Back
            </Button>
            <Button type="button" size="sm" @click="goStep3">
              {{ newPassword.trim() ? "Next: Check Connectors" : "Keep Current & Next" }}
            </Button>
          </div>
        </div>

        <!-- STEP 3: LIVE SPRITES CONNECTORS CHECK -->
        <div v-else class="step-pane">
          <div class="wizard-hero">
            <OttoMascot :size="48" :color="mascotColor" :state="loadingConnectors ? 'busy' : 'ready'" />
            <h1>Check <span class="mark-y">(y)</span>our Sprite connections.</h1>
            <p>Connected services available inside your Fly.io Sprite.</p>
          </div>

          <div class="flex justify-end">
            <button type="button" class="otto-chip otto-chip-neutral cursor-pointer border-0" :disabled="loadingConnectors" @click="fetchConnectors">
              {{ loadingConnectors ? "refreshing..." : "↻ refresh" }}
            </button>
          </div>
          <div class="conn-list">
            <div v-for="svc in serviceChecklist" :key="svc.key" class="conn-row">
              <div class="min-w-0">
                <div class="conn-name">
                  <span>{{ svc.label }}</span>
                  <span v-if="svc.required" class="req-tag">required</span>
                </div>
                <div class="conn-role">{{ svc.role }}</div>
              </div>
              <span class="otto-chip" :class="svc.connected ? 'otto-chip-success' : 'otto-chip-neutral'">
                {{ svc.connected ? "● live" : "optional" }}
              </span>
            </div>

            <div v-for="extra in extraConnectors" :key="extra.displayName" class="conn-row">
              <div class="min-w-0">
                <div class="conn-name">{{ extra.displayName }}</div>
                <div class="conn-role">{{ extra.provider }} · {{ extra.connectionType }}</div>
              </div>
              <span class="otto-chip otto-chip-success">● live</span>
            </div>
          </div>

          <div v-if="errorMsg" class="wiz-err">{{ errorMsg }}</div>

          <div class="wizard-actions">
            <Button type="button" variant="secondary" size="sm" :disabled="saving" @click="step = 2; errorMsg = ''">
              ← Back
            </Button>
            <Button type="button" size="sm" :disabled="saving" @click="finishSetup">
              {{ saving ? "Opening Studio..." : "Enter (y)our studio" }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-shell {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 20px 14px;
}
.wizard-card {
  width: min(94vw, 520px);
}
.skip-link {
  border: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.skip-link:hover {
  color: var(--fg);
  background: var(--surface-alt);
}
.wizard-body {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.step-pills {
  display: flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}
.step-pill {
  border: none;
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  background: var(--surface-alt);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
}
.step-pill.active {
  background: var(--fg);
  color: #ffffff;
}
.step-pill.done {
  background: var(--success-bg);
  color: var(--success);
}
.step-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wizard-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}
.wizard-hero h1 {
  margin: 4px 0 0;
  font-family: var(--font-sans);
  font-size: 24px;
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.25;
  color: var(--fg);
}
.wizard-hero p {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-muted);
  line-height: 1.5;
  max-width: 410px;
}
.swatch-row {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.swatch-dot {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1.5px solid rgba(48, 48, 48, 0.25);
  cursor: pointer;
  padding: 0;
  transition: transform var(--duration-fast) var(--ease-out);
}
.swatch-dot:hover {
  transform: scale(1.14);
}
.swatch-dot.active {
  box-shadow: 0 0 0 2px #ffffff, 0 0 0 3.5px #303030;
}
.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
  padding-left: 4px;
}
.tz-detect-btn {
  border: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
  text-decoration: underline;
  cursor: pointer;
}
.tz-detect-btn:hover {
  color: var(--fg);
}
.wiz-input {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius-input);
  background: var(--surface-inset);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
}
.wiz-input:focus {
  box-shadow: var(--shadow-focus);
}
.wiz-select {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 36px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.25L6 7.75L9.5 4.25' fill='none' stroke='%23303030' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
}
.wiz-err {
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--error-bg);
  color: var(--error);
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-align: center;
}
.conn-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 250px;
  overflow-y: auto;
}
.conn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--surface-alt);
}
.conn-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
}
.req-tag {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--highlight-yellow);
  color: var(--fg);
}
.conn-role {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}
.wizard-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}
</style>
