<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FileCodeIcon } from "@lucide/vue";
import {
  buildArtifactSrcdoc,
  detectArtifactKind,
  type ArtifactKind,
} from "@/lib/artifact-sandbox";

const props = defineProps<{
  relPath: string;
  name: string;
  updatedAt?: string;
}>();

const rootRef = ref<HTMLElement | null>(null);
const inView = ref(false);
const loadedText = ref("");
const failed = ref(false);

let observer: IntersectionObserver | null = null;
let abortCtrl: AbortController | null = null;

const kind = computed<ArtifactKind | null>(() => detectArtifactKind(props.name));

const svgDataUrl = computed(() => {
  if (kind.value !== "svg" || !loadedText.value) return "";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(loadedText.value)}`;
});

const iframeSrcdoc = computed(() => {
  if (!loadedText.value || !kind.value || kind.value === "svg" || kind.value === "markdown") return "";
  return buildArtifactSrcdoc(kind.value, loadedText.value, props.name);
});

async function fetchPreview() {
  if (!inView.value || !kind.value || kind.value === "markdown") return;
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  failed.value = false;
  try {
    const res = await fetch(`/api/workspace/text?path=${encodeURIComponent(props.relPath)}`, {
      signal: abortCtrl.signal,
    });
    if (!res.ok) {
      failed.value = true;
      return;
    }
    const data = (await res.json()) as { content?: string };
    loadedText.value = data.content || "";
  } catch (err) {
    if ((err as { name?: string })?.name !== "AbortError") {
      failed.value = true;
    }
  }
}

watch([inView, () => props.relPath, () => props.updatedAt], () => {
  if (inView.value) {
    void fetchPreview();
  }
});

onMounted(() => {
  if (typeof IntersectionObserver === "undefined" || !rootRef.value) {
    inView.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        inView.value = true;
        observer?.disconnect();
        observer = null;
      }
    },
    { rootMargin: "120px" }
  );
  observer.observe(rootRef.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  abortCtrl?.abort();
});
</script>

<template>
  <div ref="rootRef" class="relative h-full w-full overflow-hidden bg-white">
    <img
      v-if="kind === 'svg' && svgDataUrl && !failed"
      :src="svgDataUrl"
      :alt="name"
      class="h-full w-full object-contain p-2"
    />
    <iframe
      v-else-if="iframeSrcdoc && !failed"
      :srcdoc="iframeSrcdoc"
      sandbox="allow-scripts"
      tabindex="-1"
      class="pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0 bg-white"
      :title="name"
    />
    <div v-else class="flex h-full w-full items-center justify-center bg-[#f2f2f3]">
      <FileCodeIcon class="size-7 text-muted-foreground" />
    </div>
  </div>
</template>
