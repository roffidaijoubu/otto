<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { subscribeCursor, type CursorPoint } from "../lib/cursor";

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

// Unique per-instance SVG gradient IDs so multiple Otto spheres never collide in DOM
const uid = `otto-${Math.random().toString(36).slice(2, 9)}`;
const svgRef = ref<SVGSVGElement | null>(null);

// Smoothly damped 3D look vector in [-1, 1] x [-1, 1]
const lookX = ref(0.12);
const lookY = ref(0.06);
let targetX = 0.12;
let targetY = 0.06;
let rafId: number | null = null;
let unsubscribe: (() => void) | null = null;
let reducedMotion = false;

function scheduleTick() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(stepAnimation);
}

function stepAnimation() {
  rafId = null;
  const dx = targetX - lookX.value;
  const dy = targetY - lookY.value;
  if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
    lookX.value = targetX;
    lookY.value = targetY;
    return;
  }
  const ease = reducedMotion ? 1 : 0.16;
  lookX.value += dx * ease;
  lookY.value += dy * ease;
  rafId = requestAnimationFrame(stepAnimation);
}

function updateTargetFromCursor(pt: CursorPoint) {
  if (!pt.active || !svgRef.value) {
    targetX = props.state === "busy" ? 0.35 : 0.12;
    targetY = props.state === "busy" ? -0.25 : 0.06;
    scheduleTick();
    return;
  }
  const rect = svgRef.value.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const vx = pt.x - cx;
  const vy = pt.y - cy;
  const dist = Math.hypot(vx, vy);
  // Soft saturation radius so Otto smoothly turns toward both nearby & far cursors
  const maxRange = Math.max(220, Math.min(window.innerWidth, window.innerHeight) * 0.42);
  const mag = Math.tanh(dist / (maxRange * 0.55));
  if (dist > 0.5) {
    targetX = (vx / dist) * mag;
    targetY = (vy / dist) * mag;
  } else {
    targetX = 0;
    targetY = 0;
  }
  scheduleTick();
}

onMounted(() => {
  if (typeof window !== "undefined") {
    reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }
  unsubscribe = subscribeCursor(updateTargetFromCursor);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (rafId !== null) cancelAnimationFrame(rafId);
});

// Spherical 3D surface projection for Otto's face (yaw/pitch on a hemisphere)
const faceTransform = computed(() => {
  const x = lookX.value;
  const y = lookY.value;
  // Translate eyes along curved sphere front (max ~6.4 SVG units on 48x48 sphere of R=21)
  const tx = x * 6.4;
  const ty = y * 5.6;
  // Perspective foreshortening as the face rotates toward the edge of the sphere
  const sx = 1 - Math.abs(x) * 0.16;
  const sy = 1 - Math.abs(y) * 0.13;
  // Subtle spherical roll tilt
  const rot = x * y * -6;
  return `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) translate(24, 23.2) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) translate(-24, -23.2)`;
});

// Extra pupil lead inside the sclera for lifelike eye focus
const pupilOffset = computed(() => {
  if (props.state === "error") return { dx: 0, dy: 0.3 };
  return {
    dx: lookX.value * 1.45,
    dy: lookY.value * 1.25,
  };
});

// Eyes-only top-left mark subtle cursor follow
const eyesOnlyPupil = computed(() => ({
  dx: lookX.value * 1.7,
  dy: lookY.value * 1.35,
}));

// Specular 3D studio key-light focal point gently counter-shifts as sphere rotates
const specularCenter = computed(() => ({
  fx: (33 - lookX.value * 6.5).toFixed(1) + "%",
  fy: (27 - lookY.value * 6.5).toFixed(1) + "%",
}));

// Subtle color tint helpers so even dark charcoal (#303030) and bright pastel spheres get crisp 3D depth
const isLightSphere = computed(() => {
  const c = props.color.toLowerCase();
  return c === "#ffffff" || c === "#f9f5a2" || c === "#c7f6ff" || c === "#f2f2f2" || c === "#a7d8f0";
});

const specOpacity = computed(() => (isLightSphere.value ? 0.72 : 0.44));
const shadeOpacity = computed(() => (isLightSphere.value ? 0.24 : 0.48));
const rimOpacity = computed(() => (isLightSphere.value ? 0.45 : 0.22));
</script>

<template>
  <!-- Compact Eyes-Only Mark (for top-left Studio OS pill) -->
  <svg
    v-if="eyesOnly"
    ref="svgRef"
    :width="size"
    :height="Math.round(size * 0.62)"
    viewBox="0 0 36 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="otto-mascot-svg"
    aria-hidden="true"
  >
    <ellipse cx="11.5" cy="11" rx="5.2" ry="6.6" fill="#FFFFFF" stroke="#303030" stroke-width="1.6" />
    <ellipse cx="24.5" cy="11" rx="5.2" ry="6.6" fill="#FFFFFF" stroke="#303030" stroke-width="1.6" />
    <circle
      :cx="11.5 + eyesOnlyPupil.dx"
      :cy="11.2 + eyesOnlyPupil.dy"
      r="2.45"
      fill="#303030"
    />
    <circle
      :cx="24.5 + eyesOnlyPupil.dx"
      :cy="11.2 + eyesOnlyPupil.dy"
      r="2.45"
      fill="#303030"
    />
    <circle :cx="10.7 + eyesOnlyPupil.dx" :cy="10.2 + eyesOnlyPupil.dy" r="0.7" fill="#FFFFFF" />
    <circle :cx="23.7 + eyesOnlyPupil.dx" :cy="10.2 + eyesOnlyPupil.dy" r="0.7" fill="#FFFFFF" />
  </svg>

  <!-- Full 3D Tactile Sphere Otto Facing & Following Cursor (Pure SVG, Zero AI Art) -->
  <svg
    v-else
    ref="svgRef"
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="otto-mascot-svg otto-sphere"
    aria-hidden="true"
  >
    <defs>
      <!-- Clip eyes cleanly to the 3D sphere silhouette -->
      <clipPath :id="`${uid}-clip`">
        <circle cx="24" cy="23.5" r="20.6" />
      </clipPath>

      <!-- Soft studio ambient shadow underneath sphere -->
      <radialGradient :id="`${uid}-shadow`" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.28" />
        <stop offset="65%" stop-color="#000000" stop-opacity="0.10" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>

      <!-- Main 3D spherical diffuse shading (top-left studio key light -> bottom-right core shadow) -->
      <radialGradient
        :id="`${uid}-shade`"
        cx="66%"
        cy="72%"
        r="74%"
        :fx="specularCenter.fx"
        :fy="specularCenter.fy"
      >
        <stop offset="0%" stop-color="#FFFFFF" :stop-opacity="specOpacity" />
        <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0" />
        <stop offset="76%" stop-color="#000000" :stop-opacity="shadeOpacity * 0.45" />
        <stop offset="100%" stop-color="#000000" :stop-opacity="shadeOpacity" />
      </radialGradient>

      <!-- Subtle glossy clay specular spot -->
      <radialGradient
        :id="`${uid}-spec`"
        cx="50%"
        cy="50%"
        r="50%"
      >
        <stop offset="0%" stop-color="#FFFFFF" :stop-opacity="isLightSphere ? 0.92 : 0.56" />
        <stop offset="55%" stop-color="#FFFFFF" :stop-opacity="isLightSphere ? 0.25 : 0.14" />
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
      </radialGradient>

      <!-- Bottom-right soft bounce rim light (gives real 3D studio sculpture roundness) -->
      <radialGradient :id="`${uid}-rim`" cx="76%" cy="82%" r="48%">
        <stop offset="0%" stop-color="#FFFFFF" :stop-opacity="rimOpacity" />
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- Contact ground shadow -->
    <ellipse cx="24" cy="44.8" rx="14.5" ry="2.6" :fill="`url(#${uid}-shadow)`" />

    <!-- 3D Sphere Base Body -->
    <circle cx="24" cy="23.5" r="20.6" :fill="color" />
    <!-- 3D Spherical Light/Core-Shadow Layer -->
    <circle cx="24" cy="23.5" r="20.6" :fill="`url(#${uid}-shade)`" />
    <!-- 3D Soft Bounce Rim -->
    <circle cx="24" cy="23.5" r="20.6" :fill="`url(#${uid}-rim)`" />
    <!-- Crisp Top-Left Specular Glint -->
    <ellipse
      :cx="16.4 - lookX * 1.6"
      :cy="14.2 - lookY * 1.4"
      rx="6.2"
      ry="3.9"
      :transform="`rotate(-28 ${(16.4 - lookX * 1.6).toFixed(1)} ${(14.2 - lookY * 1.4).toFixed(1)})`"
      :fill="`url(#${uid}-spec)`"
    />

    <!-- Subtle hairline sphere rim for light pastel swatches -->
    <circle
      v-if="isLightSphere"
      cx="24"
      cy="23.5"
      r="20.2"
      stroke="rgba(48, 48, 48, 0.14)"
      stroke-width="0.9"
    />

    <!-- 3D Projected Face (rotates across the hemisphere to face cursor!) -->
    <g :clip-path="`url(#${uid}-clip)`">
      <g :transform="faceTransform">
        <g class="otto-eyes-group" :class="`state-${state}`">
          <!-- Soft eye socket shadow on sphere surface -->
          <ellipse cx="18.2" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />
          <ellipse cx="29.8" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />

          <!-- Left Sclera -->
          <ellipse cx="18.2" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />
          <!-- Right Sclera -->
          <ellipse cx="29.8" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />

          <!-- Error state: crisp X eyes -->
          <template v-if="state === 'error'">
            <path d="M16.2 21.2 L20.2 25.2 M20.2 21.2 L16.2 25.2" stroke="#303030" stroke-width="1.9" stroke-linecap="round" />
            <path d="M27.8 21.2 L31.8 25.2 M31.8 21.2 L27.8 25.2" stroke="#303030" stroke-width="1.9" stroke-linecap="round" />
          </template>

          <!-- Normal / Busy Pupils with specular catchlight -->
          <template v-else>
            <circle :cx="18.2 + pupilOffset.dx" :cy="23.2 + pupilOffset.dy" r="2.35" fill="#1F1F1F" />
            <circle :cx="29.8 + pupilOffset.dx" :cy="23.2 + pupilOffset.dy" r="2.35" fill="#1F1F1F" />
            <circle :cx="17.4 + pupilOffset.dx" :cy="22.1 + pupilOffset.dy" r="0.82" fill="#FFFFFF" />
            <circle :cx="29.0 + pupilOffset.dx" :cy="22.1 + pupilOffset.dy" r="0.82" fill="#FFFFFF" />
          </template>
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.otto-mascot-svg {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
  overflow: visible;
}
.otto-sphere {
  user-select: none;
}
@keyframes otto-blink {
  0%, 94%, 100% {
    transform: scaleY(1);
  }
  96.5% {
    transform: scaleY(0.1);
  }
}
.otto-eyes-group.state-ready {
  transform-origin: 24px 23.2px;
  animation: otto-blink 6.5s infinite;
}
@media (prefers-reduced-motion: reduce) {
  .otto-eyes-group.state-ready {
    animation: none;
  }
}
</style>
