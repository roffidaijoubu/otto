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
          <span class="todo-title">Checklist</span>
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
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  padding: 0 16px 8px;
}
.todo-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-raised-sm);
  overflow: hidden;
}
.todo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: var(--surface-alt);
}
.todo-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.todo-chevron {
  font-size: 11px;
  color: var(--fg-muted);
}
.todo-title {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.todo-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted);
}
.todo-ready {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--radius-circle);
  background: var(--success-bg);
  color: var(--success);
}
.todo-dismiss {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 6px;
}
.todo-dismiss:hover {
  background: var(--surface);
  color: var(--fg);
}
.todo-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}
.todo-phase-name {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--fg);
}
.todo-item.is-done .todo-text {
  text-decoration: line-through;
  opacity: 0.6;
}
.todo-item.is-done .todo-icon {
  color: var(--success);
  font-weight: 700;
}
.todo-item.is-active .todo-icon {
  color: var(--accent);
}
.todo-item.is-optional:not(.is-done) .todo-text {
  color: var(--fg-muted);
}
.todo-icon {
  width: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.todo-text {
  flex: 1;
  min-width: 0;
}
.todo-opt-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-circle);
  background: var(--surface-alt);
  color: var(--fg-muted);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
</style>
