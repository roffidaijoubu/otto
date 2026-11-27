<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  Loader2Icon,
  XIcon,
} from "@lucide/vue";
import type { TodoPhase, TodoTask } from "../types/chat";

const props = defineProps<{
  phases: TodoPhase[];
}>();

const emit = defineEmits<{
  dismiss: [];
}>();

const collapsed = ref(false);

const allTasks = computed(() => props.phases.flatMap((p) => p.tasks));

function isOptional(task: TodoTask): boolean {
  return /^\s*\(optional\)/i.test(task.content);
}

function cleanLabel(task: TodoTask): string {
  return task.content.replace(/^\s*\(optional\)\s*/i, "").trim();
}

function isDone(task: TodoTask): boolean {
  return task.status === "completed" || task.status === "done";
}

const doneCount = computed(() => allTasks.value.filter(isDone).length);
const totalCount = computed(() => allTasks.value.length);

const progressPercent = computed(() =>
  totalCount.value > 0 ? Math.round((doneCount.value / totalCount.value) * 100) : 0
);

const requiredRemaining = computed(
  () => allTasks.value.filter((t) => !isOptional(t) && !isDone(t)).length
);

const allRequiredDone = computed(
  () => totalCount.value > 0 && requiredRemaining.value === 0
);

const singlePhaseTitle = computed(() => {
  if (props.phases.length === 1 && props.phases[0]?.name?.trim()) {
    return props.phases[0].name.trim();
  }
  return "";
});
</script>

<template>
  <section v-if="totalCount > 0" class="todo-wrap">
    <div class="todo-card">
      <div class="todo-head" @click="collapsed = !collapsed">
        <div class="todo-head-left">
          <ChevronRightIcon v-if="collapsed" class="todo-chevron" aria-hidden="true" />
          <ChevronDownIcon v-else class="todo-chevron" aria-hidden="true" />
          <span class="todo-title">{{ singlePhaseTitle || "Checklist" }}</span>
          <span v-if="allRequiredDone" class="todo-ready">Done</span>
        </div>

        <div class="todo-head-right">
          <span class="todo-count">{{ doneCount }}/{{ totalCount }}</span>
          <button
            type="button"
            class="todo-dismiss"
            title="Hide checklist"
            aria-label="Hide checklist"
            @click.stop="emit('dismiss')"
          >
            <XIcon class="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="todo-progress-track" aria-hidden="true">
        <div class="todo-progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>

      <div v-if="!collapsed" class="todo-body">
        <div v-for="phase in phases" :key="phase.name" class="todo-phase">
          <div v-if="phases.length > 1 && phase.name" class="todo-phase-name">
            {{ phase.name }}
          </div>
          <ul class="todo-list">
            <li
              v-for="(task, idx) in phase.tasks"
              :key="`${phase.name}-${idx}`"
              class="todo-item"
              :class="{
                'is-done': isDone(task),
                'is-active': task.status === 'in_progress',
                'is-optional': isOptional(task),
              }"
            >
              <span class="todo-icon" aria-hidden="true">
                <CheckCircle2Icon v-if="isDone(task)" class="size-3.5" />
                <Loader2Icon v-else-if="task.status === 'in_progress'" class="size-3.5 animate-spin" />
                <CircleIcon v-else class="size-3.5" />
              </span>
              <span class="todo-text">{{ cleanLabel(task) }}</span>
              <span v-if="isOptional(task)" class="todo-opt-badge">Optional</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.todo-wrap {
  padding: 8px 16px 8px;
  flex-shrink: 0;
  background: var(--surface);
}
.todo-card {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow: hidden;
}
.todo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  cursor: pointer;
  user-select: none;
  transition: background var(--duration-fast) var(--ease-out);
}
.todo-head:hover {
  background: var(--surface-alt);
}
.todo-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.todo-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.todo-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--fg-muted);
}
.todo-title {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.todo-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--fg-muted);
}
.todo-ready {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--success-bg);
  color: var(--success);
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 600;
}
.todo-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.todo-dismiss:hover {
  background: var(--surface-inset);
  color: var(--fg);
}
.todo-progress-track {
  height: 2px;
  width: 100%;
  background: var(--border);
}
.todo-progress-fill {
  height: 100%;
  background: var(--fg);
  transition: width 220ms var(--ease-out);
}
.todo-body {
  background: var(--surface);
  padding: 10px 12px 12px;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.todo-phase-name {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 6px;
}
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--fg);
}
.todo-item.is-done {
  color: var(--fg-muted);
}
.todo-item.is-done .todo-text {
  text-decoration: line-through;
  text-decoration-color: rgba(128, 128, 128, 0.5);
}
.todo-item.is-active {
  color: var(--fg-strong);
  font-weight: 500;
}
.todo-item.is-active .todo-icon {
  color: var(--fg-strong);
}
.todo-item.is-done .todo-icon {
  color: var(--success);
}
.todo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  flex-shrink: 0;
  color: var(--fg-subtle);
}
.todo-text {
  flex: 1;
  min-width: 0;
}
.todo-opt-badge {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--surface-alt);
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  flex-shrink: 0;
}
</style>
