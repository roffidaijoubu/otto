<script setup lang="ts">
import { computed, ref } from "vue";
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

const requiredRemaining = computed(
  () => allTasks.value.filter((t) => !isOptional(t) && !isDone(t)).length
);

const allRequiredDone = computed(
  () => totalCount.value > 0 && requiredRemaining.value === 0
);
</script>

<template>
  <section v-if="totalCount > 0" class="todo-wrap">
    <div class="todo-card">
      <div class="todo-head" @click="collapsed = !collapsed">
        <div class="todo-head-left">
          <span class="todo-chevron">{{ collapsed ? "▸" : "▾" }}</span>
          <span class="todo-title">(Y)our checklist.</span>
          <span class="todo-count">{{ doneCount }}/{{ totalCount }}</span>
          <span v-if="allRequiredDone" class="todo-ready">Ready</span>
        </div>
        <button
          type="button"
          class="todo-dismiss"
          title="Hide checklist"
          aria-label="Hide checklist"
          @click.stop="emit('dismiss')"
        >
          ✕
        </button>
      </div>

      <div v-if="!collapsed" class="todo-body">
        <div v-for="phase in phases" :key="phase.name" class="todo-phase">
          <div v-if="phases.length > 1 || phase.name" class="todo-phase-name">
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
                <template v-if="isDone(task)">✓</template>
                <template v-else-if="task.status === 'in_progress'">●</template>
                <template v-else>○</template>
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
  padding: 0 14px 8px;
  flex-shrink: 0;
}
.todo-card {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}
.todo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
}
.todo-head-left {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg);
}
.todo-chevron {
  color: var(--fg-muted);
}
.todo-title {
  font-weight: 500;
}
.todo-count {
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  font-size: 10.5px;
  color: var(--fg-muted);
}
.todo-ready {
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--success-bg);
  color: var(--success);
  font-size: 10px;
  font-weight: 600;
}
.todo-dismiss {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 11px;
}
.todo-dismiss:hover {
  color: var(--fg);
}
.todo-body {
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 8px 12px 10px;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.todo-phase-name {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
  margin-bottom: 3px;
}
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.todo-item {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg);
}
.todo-item.is-done {
  color: var(--fg-muted);
  text-decoration: line-through;
}
.todo-item.is-active .todo-icon {
  color: var(--fg);
}
.todo-item.is-done .todo-icon {
  color: var(--success);
}
.todo-icon {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--fg-muted);
}
.todo-text {
  flex: 1;
  min-width: 0;
}
.todo-opt-badge {
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--highlight-yellow);
  color: var(--fg);
  font-size: 9.5px;
  flex-shrink: 0;
}
</style>
