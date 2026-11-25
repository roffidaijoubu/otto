<script setup lang="ts">
import { Skeleton } from "@/components/ui/skeleton";

const props = withDefaults(
  defineProps<{
    variant?: "rows" | "grid" | "tree" | "preview";
    count?: number;
  }>(),
  {
    variant: "rows",
    count: 5,
  }
);

const ROW_TITLE_WIDTHS = ["w-32", "w-44", "w-28", "w-48", "w-36", "w-30"];
const ROW_SUB_WIDTHS = ["w-28", "w-24", "w-32", "w-26", "w-28", "w-22"];
const TREE_LABEL_WIDTHS = ["w-28", "w-16", "w-14", "w-20", "w-16", "w-24", "w-16"];
const PREVIEW_LINE_WIDTHS = ["w-2/5", "w-11/12", "w-5/6", "w-full", "w-3/4", "w-3/5"];

function pick(list: string[], idx: number): string {
  return list[idx % list.length];
}
</script>

<template>
  <div
    v-if="props.variant === 'rows'"
    class="flex flex-col gap-1.5"
    role="status"
    aria-busy="true"
    aria-label="Loading files"
  >
    <div
      v-for="idx in props.count"
      :key="`row-${idx}`"
      class="flex items-center justify-between gap-3 rounded-2xl bg-secondary/70 px-3 py-2.5 min-h-[52px]"
    >
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <Skeleton class="size-7 rounded-lg shrink-0 bg-accent" />
        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
          <Skeleton :class="['h-3 rounded-md bg-accent', pick(ROW_TITLE_WIDTHS, idx - 1)]" />
          <Skeleton :class="['h-2.5 rounded-md bg-accent/80', pick(ROW_SUB_WIDTHS, idx - 1)]" />
        </div>
      </div>
      <div class="hidden sm:flex items-center gap-2 shrink-0">
        <Skeleton class="h-6 w-16 rounded-full bg-accent" />
        <Skeleton class="size-6 rounded-full bg-accent" />
      </div>
    </div>
  </div>

  <div
    v-else-if="props.variant === 'grid'"
    class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5"
    role="status"
    aria-busy="true"
    aria-label="Loading files"
  >
    <div
      v-for="idx in props.count"
      :key="`grid-${idx}`"
      class="flex flex-col gap-2 rounded-2xl bg-secondary/70 p-2.5"
    >
      <Skeleton class="aspect-[16/10] w-full rounded-xl bg-accent" />
      <div class="flex flex-col gap-1.5 px-0.5">
        <Skeleton :class="['h-3 rounded-md bg-accent', idx % 2 === 0 ? 'w-4/5' : 'w-3/5']" />
        <Skeleton class="h-2.5 w-1/2 rounded-md bg-accent/80" />
      </div>
    </div>
  </div>

  <div
    v-else-if="props.variant === 'tree'"
    class="flex flex-col gap-1"
    role="status"
    aria-busy="true"
    aria-label="Loading folders"
  >
    <div
      v-for="idx in props.count"
      :key="`tree-${idx}`"
      class="flex items-center gap-2 h-8 px-2.5 rounded-full"
    >
      <Skeleton class="size-4 rounded bg-accent shrink-0" />
      <Skeleton :class="['h-3 rounded-md bg-accent', pick(TREE_LABEL_WIDTHS, idx - 1)]" />
    </div>
  </div>

  <div
    v-else
    class="flex flex-col gap-2.5 rounded-2xl bg-secondary/70 p-4"
    role="status"
    aria-busy="true"
    aria-label="Loading file preview"
  >
    <Skeleton
      v-for="(w, idx) in PREVIEW_LINE_WIDTHS"
      :key="`preview-${idx}`"
      :class="[idx === 0 ? 'h-4 mb-1' : 'h-3', 'rounded-md bg-accent', w]"
    />
  </div>
</template>
