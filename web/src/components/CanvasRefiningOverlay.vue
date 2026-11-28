<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";

defineProps<{
  active: boolean;
  label?: string;
  compact?: boolean;
}>();
</script>

<template>
  <Transition name="refine-fade">
    <div
      v-if="active"
      class="refine-overlay"
      :class="{ 'is-compact': compact }"
      role="status"
      aria-live="polite"
    >
      <div class="refine-shimmer" aria-hidden="true" />
      <div class="refine-pill">
        <Loader2Icon class="refine-spinner" aria-hidden="true" />
        <span class="refine-label">{{ label || "Refining..." }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.refine-overlay {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.36);
  backdrop-filter: blur(8px) saturate(1.15);
  -webkit-backdrop-filter: blur(8px) saturate(1.15);
}

.refine-shimmer {
  position: absolute;
  inset: -40%;
  background: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0) 25%,
    rgba(255, 255, 255, 0.45) 45%,
    rgba(249, 245, 162, 0.22) 55%,
    rgba(255, 255, 255, 0) 75%
  );
  animation: refine-drift 2.4s ease-in-out infinite;
  pointer-events: none;
}

.refine-pill {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 9999px;
  background: rgba(23, 23, 23, 0.88);
  color: #ffffff;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
}

.refine-spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  animation: refine-spin 1s linear infinite;
}

.refine-overlay.is-compact {
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.refine-overlay.is-compact .refine-pill {
  gap: 4px;
  padding: 3px 8px;
  font-size: 9.5px;
}

.refine-overlay.is-compact .refine-spinner {
  width: 10px;
  height: 10px;
}

@keyframes refine-drift {
  0% {
    transform: translateX(-35%) translateY(-10%);
  }
  50% {
    transform: translateX(35%) translateY(10%);
  }
  100% {
    transform: translateX(-35%) translateY(-10%);
  }
}

@keyframes refine-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.refine-fade-enter-active,
.refine-fade-leave-active {
  transition: opacity 180ms ease-out;
}
.refine-fade-enter-from,
.refine-fade-leave-to {
  opacity: 0;
}
</style>
