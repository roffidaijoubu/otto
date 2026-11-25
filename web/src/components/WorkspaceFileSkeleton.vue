<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    variant?: "rows" | "tree" | "preview";
    count?: number;
  }>(),
  {
    variant: "rows",
    count: 5,
  }
);

const ROW_TITLE_WIDTHS = ["118px", "158px", "96px", "174px", "134px", "112px"];
const ROW_SUB_WIDTHS = ["126px", "106px", "140px", "114px", "122px", "98px"];
const TREE_LABEL_WIDTHS = ["108px", "64px", "54px", "74px", "68px", "88px", "66px"];
const PREVIEW_LINE_WIDTHS = ["42%", "92%", "86%", "95%", "72%", "60%"];

function pickWidth(list: string[], idx: number): string {
  return list[idx % list.length];
}
</script>

<template>
  <div
    v-if="props.variant === 'rows'"
    class="fm-skel-rows"
    role="status"
    aria-busy="true"
    aria-label="Loading files"
  >
    <div
      v-for="idx in props.count"
      :key="`row-${idx}`"
      class="fm-skel-row"
      :style="{ '--skel-delay': `${(idx - 1) * 70}ms` }"
    >
      <div class="fm-skel-main">
        <span class="fm-skel-bone fm-skel-icon" aria-hidden="true"></span>
        <div class="fm-skel-meta">
          <span
            class="fm-skel-bone fm-skel-title"
            :style="{ width: pickWidth(ROW_TITLE_WIDTHS, idx - 1) }"
            aria-hidden="true"
          ></span>
          <span
            class="fm-skel-bone fm-skel-sub"
            :style="{ width: pickWidth(ROW_SUB_WIDTHS, idx - 1) }"
            aria-hidden="true"
          ></span>
        </div>
      </div>
      <div class="fm-skel-actions" aria-hidden="true">
        <span class="fm-skel-bone fm-skel-pill-lg"></span>
        <span class="fm-skel-bone fm-skel-pill-md"></span>
        <span class="fm-skel-bone fm-skel-pill-sm"></span>
      </div>
    </div>
  </div>

  <div
    v-else-if="props.variant === 'tree'"
    class="fm-skel-tree"
    role="status"
    aria-busy="true"
    aria-label="Loading folders"
  >
    <div
      v-for="idx in props.count"
      :key="`tree-${idx}`"
      class="fm-skel-dir"
      :style="{ '--skel-delay': `${(idx - 1) * 55}ms` }"
    >
      <span class="fm-skel-bone fm-skel-dir-icon" aria-hidden="true"></span>
      <span
        class="fm-skel-bone fm-skel-dir-label"
        :style="{ width: pickWidth(TREE_LABEL_WIDTHS, idx - 1) }"
        aria-hidden="true"
      ></span>
    </div>
  </div>

  <div
    v-else
    class="fm-skel-preview"
    role="status"
    aria-busy="true"
    aria-label="Loading file preview"
  >
    <span
      v-for="(w, idx) in PREVIEW_LINE_WIDTHS"
      :key="`preview-${idx}`"
      class="fm-skel-bone"
      :class="idx === 0 ? 'fm-skel-preview-head' : 'fm-skel-preview-line'"
      :style="{ width: w, '--skel-delay': `${idx * 60}ms` }"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style scoped>
.fm-skel-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fm-skel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  min-height: 51px;
  border-radius: 14px;
  background: var(--surface-alt);
}

.fm-skel-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.fm-skel-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
}

.fm-skel-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.fm-skel-title {
  height: 12px;
  max-width: 100%;
  border-radius: 6px;
}

.fm-skel-sub {
  height: 10px;
  max-width: 100%;
  border-radius: 5px;
  opacity: 0.78;
}

.fm-skel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.fm-skel-pill-lg {
  width: 48px;
  height: 22px;
  border-radius: var(--radius-pill);
}

.fm-skel-pill-md {
  width: 44px;
  height: 22px;
  border-radius: var(--radius-pill);
}

.fm-skel-pill-sm {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
}

.fm-skel-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fm-skel-dir {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 6px 10px;
  border-radius: var(--radius-pill);
}

.fm-skel-dir-icon {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  flex-shrink: 0;
}

.fm-skel-dir-label {
  height: 11px;
  border-radius: 5px;
}

.fm-skel-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-alt);
}

.fm-skel-preview-head {
  height: 16px;
  border-radius: 6px;
  margin-bottom: 4px;
}

.fm-skel-preview-line {
  height: 11px;
  border-radius: 5px;
}

.fm-skel-bone {
  display: block;
  position: relative;
  overflow: hidden;
  background: var(--surface-inset-hover);
}

.fm-skel-bone::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translate3d(-100%, 0, 0);
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.58) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: fm-skel-shimmer 1.35s ease-in-out infinite;
  animation-delay: var(--skel-delay, 0ms);
  will-change: transform;
}

@keyframes fm-skel-shimmer {
  0% {
    transform: translate3d(-100%, 0, 0);
  }
  100% {
    transform: translate3d(100%, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fm-skel-bone::after {
    animation: none;
    display: none;
  }
}

@media (max-width: 560px) {
  .fm-skel-actions {
    display: none;
  }
}
</style>
