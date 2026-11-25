<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";

export interface LearnedSkillItem {
  slug: string;
  title: string;
  description: string;
  status: "pending" | "active" | "rejected";
  source: "nightly" | "manual" | "chat";
  confidence: "low" | "medium" | "high";
  triggerHint: string;
  evidenceSummary: string;
  bodyMarkdown: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

interface LearningConfig {
  enabled: boolean;
  timezone: string;
  cron: string | null;
  scheduleId: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  running: boolean;
}

const props = defineProps<{
  refreshTick: number;
}>();

const loading = ref(false);
const savingConfig = ref(false);
const runningNow = ref(false);
const notice = ref("");
const errorMsg = ref("");
const expandedSlug = ref<string | null>(null);

const config = ref<LearningConfig>({
  enabled: false,
  timezone: "UTC",
  cron: null,
  scheduleId: null,
  lastRunAt: null,
  lastStatus: null,
  running: false,
});
const skills = ref<LearnedSkillItem[]>([]);

const pendingCount = computed(() => skills.value.filter((s) => s.status === "pending").length);
const activeCount = computed(() => skills.value.filter((s) => s.status === "active").length);

async function fetchLearning() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch("/api/learning");
    if (!res.ok) return;
    const data = (await res.json()) as {
      config?: LearningConfig;
      skills?: LearnedSkillItem[];
    };
    if (data.config) config.value = data.config;
    skills.value = Array.isArray(data.skills) ? data.skills : [];
  } catch {
    // ignore transient fetch errors
  } finally {
    loading.value = false;
  }
}

async function toggleNightly() {
  savingConfig.value = true;
  notice.value = "";
  errorMsg.value = "";
  try {
    const nextEnabled = !config.value.enabled;
    const res = await fetch("/api/learning/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      note?: string;
      error?: string;
      config?: LearningConfig;
    };
    if (!res.ok) {
      errorMsg.value = data.error || "Could not update nightly reflection schedule.";
      return;
    }
    if (data.config) config.value = data.config;
    notice.value = data.note || (nextEnabled ? "Nightly reflection armed." : "Nightly reflection paused.");
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Network error";
  } finally {
    savingConfig.value = false;
  }
}

async function runReflectNow() {
  runningNow.value = true;
  notice.value = "";
  errorMsg.value = "";
  try {
    const res = await fetch("/api/learning/run", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) {
      errorMsg.value = data.error || "Could not start background reflection.";
      return;
    }
    config.value.running = true;
    notice.value = "Silent reflection started in background — new playbooks will appear here shortly.";
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Network error";
  } finally {
    runningNow.value = false;
  }
}

async function setSkillStatus(slug: string, status: "active" | "rejected" | "pending") {
  errorMsg.value = "";
  try {
    const res = await fetch(`/api/learning/skills/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      errorMsg.value = data.error || "Failed to update playbook.";
      return;
    }
    await fetchLearning();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "Network error";
  }
}

async function removeSkill(slug: string) {
  errorMsg.value = "";
  try {
    const res = await fetch(`/api/learning/skills/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (expandedSlug.value === slug) expandedSlug.value = null;
      await fetchLearning();
    }
  } catch {
    // ignore
  }
}

function formatRunTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

watch(
  () => props.refreshTick,
  () => {
    fetchLearning();
  },
  { immediate: true }
);
</script>

<template>
  <div class="otto-card">
    <div class="otto-card-head">
      <span>(Y)our learned playbooks.</span>
      <div class="otto-card-head-right">
        <span v-if="pendingCount > 0" class="otto-chip otto-chip-yellow">
          {{ pendingCount }} pending review
        </span>
        <span class="otto-chip otto-chip-neutral">{{ activeCount }} active</span>
      </div>
    </div>

    <div class="otto-card-body">
      <div class="lp-toolbar">
        <div class="min-w-0">
          <div class="lp-title-row">
            <span class="font-mono text-xs font-medium">Nightly Self-Learning</span>
            <span class="otto-chip" :class="config.enabled ? 'otto-chip-success' : 'otto-chip-neutral'">
              {{ config.running ? "reflecting..." : config.enabled ? "midnight armed" : "paused" }}
            </span>
          </div>
          <div class="lp-meta">
            <span>{{ config.cron || `CRON_TZ=${config.timezone} 0 0 * * *` }}</span>
            <span>·</span>
            <span>last run: {{ formatRunTime(config.lastRunAt) }}</span>
            <span v-if="config.lastStatus">({{ config.lastStatus }})</span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            class="btn btn-xs btn-otto-secondary"
            :disabled="savingConfig"
            @click="toggleNightly"
          >
            {{ savingConfig ? "Saving..." : config.enabled ? "Pause Nightly" : "Enable Nightly" }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-otto-primary"
            :disabled="runningNow || config.running"
            @click="runReflectNow"
          >
            {{ config.running || runningNow ? "Reflecting..." : "Reflect Now" }}
          </button>
        </div>
      </div>

      <div v-if="notice" class="lp-notice">{{ notice }}</div>
      <div v-if="errorMsg" class="lp-err">{{ errorMsg }}</div>

      <div v-if="skills.length === 0" class="lp-empty">
        No learned playbooks yet. Each midnight in your local timezone, Otto silently reviews your recurring creator workflows and stages new SOPs here for your approval.
      </div>

      <div v-else class="lp-list">
        <div v-for="sk in skills" :key="sk.slug" class="lp-row">
          <div class="lp-row-top">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span
                  class="otto-chip"
                  :class="
                    sk.status === 'active'
                      ? 'otto-chip-success'
                      : sk.status === 'pending'
                        ? 'otto-chip-yellow'
                        : 'otto-chip-neutral'
                  "
                >
                  {{ sk.status }}
                </span>
                <span class="font-medium text-sm">{{ sk.title }}</span>
                <span class="font-mono text-[10.5px] text-[var(--fg-muted)]">{{ sk.slug }}</span>
              </div>
              <div class="text-xs text-[var(--fg-muted)] mt-1">{{ sk.description }}</div>
              <div v-if="sk.evidenceSummary" class="font-mono text-[10.5px] text-[var(--fg-muted)] mt-1">
                source: {{ sk.evidenceSummary }}
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                class="btn btn-xs btn-otto-secondary"
                @click="expandedSlug = expandedSlug === sk.slug ? null : sk.slug"
              >
                {{ expandedSlug === sk.slug ? "Hide" : "View" }}
              </button>
              <button
                v-if="sk.status !== 'active'"
                type="button"
                class="btn btn-xs btn-otto-primary"
                @click="setSkillStatus(sk.slug, 'active')"
              >
                Approve
              </button>
              <button
                v-if="sk.status === 'pending'"
                type="button"
                class="btn btn-xs btn-otto-secondary"
                @click="setSkillStatus(sk.slug, 'rejected')"
              >
                Reject
              </button>
              <button
                type="button"
                class="btn btn-xs btn-otto-ghost text-error"
                title="Delete learned playbook"
                @click="removeSkill(sk.slug)"
              >
                ✕
              </button>
            </div>
          </div>

          <div
            v-if="expandedSlug === sk.slug"
            class="lp-body md-content text-xs"
            v-html="renderMarkdown(sk.bodyMarkdown)"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-alt);
}
.lp-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.lp-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
}
.lp-notice {
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--success-bg);
  color: var(--success);
  font-family: var(--font-mono);
  font-size: 11px;
}
.lp-err {
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--error-bg);
  color: var(--error);
  font-family: var(--font-mono);
  font-size: 11px;
}
.lp-empty {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface-alt);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-muted);
  line-height: 1.5;
}
.lp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lp-row {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-alt);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lp-row-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.lp-body {
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
</style>
