<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MonitorPlayIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "@lucide/vue";
import { toast } from "vue-sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ObsOverlayItem {
  slug: string;
  title: string;
  description: string;
  overlayUrl: string;
  controlUrl: string;
  updatedAt: string;
}

interface MachineStatus {
  connectorAvailable: boolean;
  connectorName: string;
  provisioned: boolean;
  appName?: string;
  region?: string;
  baseUrl?: string;
  machineState?: string;
}

const props = defineProps<{
  refreshTick: number;
  initialSlug?: string;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  selectedChanged: [payload: { slug: string; title: string }];
}>();

const status = ref<MachineStatus>({
  connectorAvailable: false,
  connectorName: "Fly Machines",
  provisioned: false,
});
const overlays = ref<ObsOverlayItem[]>([]);
const selectedSlug = ref("");
const stageBackdrop = ref<"checker" | "dark" | "chroma">("checker");
const showRemote = ref(true);
const loading = ref(true);
const frameKey = ref(0);
const copiedField = ref<"obs" | "remote" | "">("");
const confirmDelete = ref(false);
const deleting = ref(false);

const selectedOverlay = computed(
  () => overlays.value.find((o) => o.slug === selectedSlug.value) || null
);

const starters = [
  {
    label: "Starting Soon Countdown",
    prompt: "Deploy a transparent 1920x1080 Starting Soon countdown OBS overlay to my Fly Machine with remote Start/Pause/Reset and editable stream title.",
  },
  {
    label: "Broadcast Lower Third",
    prompt: "Deploy a clean transparent Lower Third OBS overlay to my Fly Machine with remote toggle and editable speaker/topic text.",
  },
  {
    label: "BRB Slate",
    prompt: "Deploy a minimal Be Right Back OBS overlay to my Fly Machine with an editable return message and live remote control.",
  },
];

async function loadOverlays(preferSlug?: string) {
  loading.value = true;
  try {
    const res = await fetch("/api/obs-overlays");
    if (!res.ok) return;
    const data = (await res.json()) as {
      status?: MachineStatus;
      overlays?: ObsOverlayItem[];
    };
    if (data.status) status.value = data.status;
    overlays.value = Array.isArray(data.overlays) ? data.overlays : [];

    const target = preferSlug || selectedSlug.value || props.initialSlug;
    if (target && overlays.value.some((o) => o.slug === target)) {
      selectedSlug.value = target;
    } else if (overlays.value.length > 0) {
      selectedSlug.value = overlays.value[0].slug;
    } else {
      selectedSlug.value = "";
    }

    if (selectedOverlay.value) {
      emit("selectedChanged", {
        slug: selectedOverlay.value.slug,
        title: selectedOverlay.value.title,
      });
    }
  } finally {
    loading.value = false;
  }
}

async function copyUrl(kind: "obs" | "remote") {
  const ov = selectedOverlay.value;
  if (!ov) return;
  const text = kind === "obs" ? ov.overlayUrl : ov.controlUrl;
  try {
    await navigator.clipboard.writeText(text);
    copiedField.value = kind;
    toast.success(kind === "obs" ? "Copied OBS Browser Source URL" : "Copied Mobile Remote URL");
    setTimeout(() => {
      if (copiedField.value === kind) copiedField.value = "";
    }, 1600);
  } catch {
    toast.error("Failed to copy URL");
  }
}

async function deleteSelected() {
  const ov = selectedOverlay.value;
  if (!ov || deleting.value) return;
  deleting.value = true;
  try {
    const res = await fetch(`/api/obs-overlays/${encodeURIComponent(ov.slug)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Delete failed");
    confirmDelete.value = false;
    toast.success(`Deleted ${ov.title}`);
    await loadOverlays();
  } catch {
    toast.error("Could not delete overlay");
  } finally {
    deleting.value = false;
  }
}

function selectOverlay(slug: string) {
  selectedSlug.value = slug;
  frameKey.value += 1;
  void loadOverlays(slug);
}

function handleSelectChange(val: unknown) {
  if (typeof val === "string" && val) {
    selectedSlug.value = val;
    frameKey.value += 1;
    if (selectedOverlay.value) {
      emit("selectedChanged", {
        slug: selectedOverlay.value.slug,
        title: selectedOverlay.value.title,
      });
    }
  }
}

watch(
  () => props.refreshTick,
  () => {
    void loadOverlays();
    frameKey.value += 1;
  }
);

watch(
  () => props.initialSlug,
  (next) => {
    if (next) void loadOverlays(next);
  }
);

onMounted(() => {
  void loadOverlays(props.initialSlug);
});

defineExpose({
  selectOverlay,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#FAFAFA]">
    <!-- Top Control Bar (Strictly Hosted on Fly Machine — No Download) -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDEDED] bg-white px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <Select
          v-if="overlays.length > 0"
          :model-value="selectedSlug"
          @update:model-value="handleSelectChange"
        >
          <SelectTrigger class="h-8 w-[210px] max-w-[42vw] font-mono text-xs font-medium">
            <SelectValue placeholder="Select overlay" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="ov in overlays" :key="ov.slug" :value="ov.slug">
                {{ ov.title }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Badge
          v-if="status.provisioned"
          variant="secondary"
          class="h-6 px-2 font-mono text-[10.5px]"
        >
          {{ status.appName }} · {{ status.region || "sin" }}
        </Badge>
        <Badge
          v-else-if="status.connectorAvailable"
          variant="secondary"
          class="h-6 px-2 font-mono text-[10.5px]"
        >
          Fly Machines ready
        </Badge>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <template v-if="selectedOverlay">
          <Button
            size="xs"
            variant="default"
            class="h-7 gap-1 font-mono text-[11px]"
            @click="copyUrl('obs')"
          >
            <CheckIcon v-if="copiedField === 'obs'" class="size-3" />
            <CopyIcon v-else class="size-3" />
            <span>Copy OBS URL</span>
          </Button>
          <Button
            size="xs"
            variant="secondary"
            class="h-7 gap-1 font-mono text-[11px]"
            @click="copyUrl('remote')"
          >
            <CheckIcon v-if="copiedField === 'remote'" class="size-3" />
            <CopyIcon v-else class="size-3" />
            <span>Remote URL</span>
          </Button>
          <Button
            size="xs"
            :variant="showRemote ? 'secondary' : 'ghost'"
            class="h-7 gap-1 font-mono text-[11px]"
            @click="showRemote = !showRemote"
          >
            <SlidersHorizontalIcon class="size-3" />
            <span>Remote</span>
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Open live OBS URL in new tab"
            as="a"
            :href="selectedOverlay.overlayUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLinkIcon class="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            class="text-destructive hover:text-destructive"
            title="Delete overlay"
            @click="confirmDelete = true"
          >
            <Trash2Icon class="size-3.5" />
          </Button>
        </template>

        <Button
          size="icon-xs"
          variant="ghost"
          title="Refresh overlays"
          @click="loadOverlays(); frameKey += 1"
        >
          <RefreshCwIcon class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- Main Stage -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div v-if="loading && overlays.length === 0" class="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
        <Spinner class="size-4" />
        <span>Checking Fly Machine overlays...</span>
      </div>

      <div
        v-else-if="!selectedOverlay"
        class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div class="flex size-12 items-center justify-center rounded-2xl border border-[#EDEDED] bg-white shadow-xs">
          <MonitorPlayIcon class="size-5 text-[#303030]" />
        </div>
        <div class="max-w-md space-y-1">
          <h3 class="font-mono text-sm font-semibold text-[#303030]">Hosted OBS Overlays</h3>
          <p class="text-xs text-[#666]">
            Overlays run on your dedicated auto-stop Fly Machine with a public Browser Source URL and live SSE remote control.
          </p>
        </div>
        <div v-if="!status.connectorAvailable" class="rounded-xl border border-[#fecaca] bg-[#fde8e8] px-3 py-2 font-mono text-[11px] text-[#991b1b]">
          Connect the Fly Machines API connector (api.machines.dev) in Sprites Dashboard to deploy overlays.
        </div>
        <div v-else class="flex flex-wrap justify-center gap-2">
          <Button
            v-for="s in starters"
            :key="s.label"
            size="xs"
            variant="outline"
            class="h-8 gap-1.5 rounded-full bg-white font-mono text-xs"
            @click="emit('askPrompt', s.prompt)"
          >
            <SparklesIcon class="size-3" />
            <span>{{ s.label }}</span>
          </Button>
        </div>
      </div>

      <template v-else>
        <!-- 16:9 Live Preview from Fly Machine iframe -->
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="truncate font-mono text-[11px] text-[#666]">
              {{ selectedOverlay.overlayUrl }}
            </span>
            <ToggleGroup v-model="stageBackdrop" type="single" variant="outline" size="sm" class="h-6">
              <ToggleGroupItem value="checker" class="h-6 px-2 font-mono text-[10px]">Alpha</ToggleGroupItem>
              <ToggleGroupItem value="dark" class="h-6 px-2 font-mono text-[10px]">Dark</ToggleGroupItem>
              <ToggleGroupItem value="chroma" class="h-6 px-2 font-mono text-[10px]">Chroma</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div
            class="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl border border-[#EDEDED]"
            :class="{
              'obs-checker': stageBackdrop === 'checker',
              'bg-[#111111]': stageBackdrop === 'dark',
              'bg-[#00b140]': stageBackdrop === 'chroma',
            }"
          >
            <iframe
              :key="`ov-${selectedOverlay.slug}-${frameKey}`"
              :src="selectedOverlay.overlayUrl"
              class="h-full w-full border-0 bg-transparent"
              allow="autoplay"
              :title="selectedOverlay.title"
            />
          </div>

          <!-- Embedded Remote Control Deck iframe from Fly Machine -->
          <div
            v-if="showRemote"
            class="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-xl border border-[#EDEDED] bg-white"
          >
            <iframe
              :key="`ctl-${selectedOverlay.slug}-${frameKey}`"
              :src="selectedOverlay.controlUrl"
              class="h-full min-h-[260px] w-full flex-1 border-0 bg-[#FAFAFA]"
              :title="`${selectedOverlay.title} Remote Control`"
            />
          </div>
        </div>
      </template>
    </div>

    <AlertDialog v-model:open="confirmDelete">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ selectedOverlay?.title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the overlay from your Fly Machine volume and disconnects any OBS Browser Source using its URL.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="deleteSelected">
            {{ deleting ? "Deleting..." : "Delete" }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
.obs-checker {
  background-color: #f4f4f2;
  background-image:
    linear-gradient(45deg, #e5e5e1 25%, transparent 25%),
    linear-gradient(-45deg, #e5e5e1 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e5e1 75%),
    linear-gradient(-45deg, transparent 75%, #e5e5e1 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
</style>
