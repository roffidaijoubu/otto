<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    platform: string;
    class?: string;
  }>(),
  {
    class: "size-4",
  }
);

const normalized = () => props.platform.toLowerCase();
</script>

<template>
  <!-- YouTube -->
  <svg
    v-if="normalized() === 'youtube'"
    viewBox="0 0 24 24"
    fill="none"
    :class="props.class"
    aria-hidden="true"
  >
    <path
      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814Z"
      fill="#FF0000"
    />
    <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568Z" fill="#FFFFFF" />
  </svg>

  <!-- TikTok -->
  <svg
    v-else-if="normalized() === 'tiktok'"
    viewBox="0 0 24 24"
    fill="none"
    :class="props.class"
    aria-hidden="true"
  >
    <path
      d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.73a8.19 8.19 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15Z"
      fill="#111111"
    />
  </svg>

  <!-- Instagram -->
  <svg
    v-else-if="normalized() === 'instagram'"
    viewBox="0 0 24 24"
    fill="none"
    :class="props.class"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="ig-brand-grad" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FD5949" />
        <stop offset="50%" stop-color="#D6249F" />
        <stop offset="100%" stop-color="#285AEB" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#ig-brand-grad)" />
    <circle cx="12" cy="12" r="4.2" stroke="#FFFFFF" stroke-width="1.9" />
    <circle cx="17.3" cy="6.7" r="1.2" fill="#FFFFFF" />
  </svg>

  <!-- X (Twitter) -->
  <svg
    v-else
    viewBox="0 0 24 24"
    fill="none"
    :class="props.class"
    aria-hidden="true"
  >
    <path
      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
      fill="#111111"
    />
  </svg>
</template>
