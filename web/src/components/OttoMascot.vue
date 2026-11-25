<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    size?: number;
    color?: string;
    state?: "ready" | "busy" | "error";
    eyesOnly?: boolean;
  }>(),
  {
    size: 36,
    color: "#303030",
    state: "ready",
    eyesOnly: false,
  }
);

const pupilShift = computed(() => {
  if (props.state === "busy") return { dx: 1.5, dy: -1.3 };
  if (props.state === "error") return { dx: 0, dy: 0.4 };
  return { dx: 0.6, dy: 0.2 };
});

const needsDarkOutline = computed(() => {
  const c = props.color.toLowerCase();
  return c === "#ffffff" || c === "#f9f5a2" || c === "#c7f6ff" || c === "#f2f2f2";
});
</script>

<template>
  <!-- Compact Eyes-Only Mark (for top-left Studio OS pill) -->
  <svg
    v-if="eyesOnly"
    :width="size"
    :height="Math.round(size * 0.56)"
    viewBox="0 0 36 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="otto-mascot-svg"
    aria-hidden="true"
  >
    <ellipse cx="11.5" cy="10" rx="5.2" ry="6.8" fill="#FFFFFF" stroke="#303030" stroke-width="1.35" />
    <ellipse cx="24.5" cy="10" rx="5.2" ry="6.8" fill="#FFFFFF" stroke="#303030" stroke-width="1.35" />
    <circle
      class="otto-pupil"
      :cx="11.5 + pupilShift.dx"
      :cy="10 + pupilShift.dy"
      :r="state === 'error' ? 2.6 : 2.35"
      fill="#1A1A1A"
    />
    <circle
      class="otto-pupil"
      :cx="24.5 + pupilShift.dx"
      :cy="10 + pupilShift.dy"
      :r="state === 'error' ? 2.6 : 2.35"
      fill="#1A1A1A"
    />
  </svg>

  <!-- Full Otto Mascot: Pure Geometric Circle + Simple Expressive Eyes (Zero AI Art) -->
  <svg
    v-else
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="otto-mascot-svg"
    aria-label="Otto mascot"
  >
    <circle
      cx="24"
      cy="24"
      r="21.5"
      :fill="color"
      :stroke="needsDarkOutline ? '#303030' : 'rgba(0,0,0,0.08)'"
      stroke-width="1.2"
    />
    <g class="otto-eyes-group" :class="`state-${state}`">
      <ellipse
        cx="17.8"
        cy="22.8"
        rx="4.4"
        ry="6"
        fill="#FFFFFF"
        :stroke="needsDarkOutline ? '#303030' : 'none'"
        stroke-width="1"
      />
      <ellipse
        cx="30.2"
        cy="22.8"
        rx="4.4"
        ry="6"
        fill="#FFFFFF"
        :stroke="needsDarkOutline ? '#303030' : 'none'"
        stroke-width="1"
      />
      <circle
        class="otto-pupil"
        :cx="17.8 + pupilShift.dx"
        :cy="22.8 + pupilShift.dy"
        :r="state === 'error' ? 2.4 : 2.15"
        fill="#141414"
      />
      <circle
        class="otto-pupil"
        :cx="30.2 + pupilShift.dx"
        :cy="22.8 + pupilShift.dy"
        :r="state === 'error' ? 2.4 : 2.15"
        fill="#141414"
      />
    </g>
  </svg>
</template>

<style scoped>
.otto-mascot-svg {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
.otto-pupil {
  transition: cx 220ms ease-out, cy 220ms ease-out;
}
@keyframes otto-blink {
  0%, 94%, 100% {
    transform: scaleY(1);
  }
  96.5% {
    transform: scaleY(0.12);
  }
}
.otto-eyes-group.state-ready {
  transform-origin: 24px 22.8px;
  animation: otto-blink 6.5s infinite;
}
@media (prefers-reduced-motion: reduce) {
  .otto-eyes-group.state-ready {
    animation: none;
  }
}
</style>
