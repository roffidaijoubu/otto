<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderOpenIcon,
  LayersIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
} from "@lucide/vue";
import { toast } from "vue-sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildArtifactSrcdoc,
  detectArtifactKind,
  type ArtifactKind,
} from "@/lib/artifact-sandbox";
import { renderMarkdown } from "@/lib/markdown";

interface ArtifactListItem {
  name: string;
  relPath: string;
  updatedAt: string;
  kind: ArtifactKind;
}

const props = defineProps<{
  refreshTick: number;
  activePath?: string;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  openInFiles: [relDir: string];
  activeChanged: [payload: { path: string; title: string }];
}>();

const artifacts = ref<ArtifactListItem[]>([]);
const selectedPath = ref("");
const currentTitle = ref("");
const currentKind = ref<ArtifactKind>("html");
const content = ref("");
const originalContent = ref("");
const viewMode = ref<"preview" | "code">("preview");
const loading = ref(false);
const saving = ref(false);
const copied = ref(false);
const errorMsg = ref("");
const renderKey = ref(0);

const isDirty = computed(() => content.value !== originalContent.value);

const srcdoc = computed(() => {
  if (!selectedPath.value || currentKind.value === "markdown") return "";
  return buildArtifactSrcdoc(currentKind.value, content.value, currentTitle.value || selectedPath.value);
});

const renderedMarkdownHtml = computed(() =>
  currentKind.value === "markdown" ? renderMarkdown(content.value) : ""
);

const kindBadge = computed(() => {
  const map: Record<ArtifactKind, string> = {
    html: "HTML",
    react: "React",
    svg: "SVG",
    mermaid: "Mermaid",
    markdown: "Markdown",
  };
  return map[currentKind.value] || "Artifact";
});

const quickStarters = [
  {
    label: "OBS Countdown Overlay",
    prompt: "Create an interactive OBS Starting Soon countdown overlay artifact in HTML with a customizable timer and theme.",
  },
  {
    label: "Sponsor Rate Calculator",
    prompt: "Create an interactive React sponsorship rate-card calculator artifact for my channel.",
  },
  {
    label: "Stream Rundown Flow",
    prompt: "Create a Mermaid flowchart artifact mapping out my pre-stream, live, and post-stream workflow.",
  },
];

async function fetchArtifactsList() {
  try {
    const res = await fetch("/api/workspace/list?path=artifacts");
    if (!res.ok) return;
    const data = (await res.json()) as {
      items?: Array<{ name: string; relPath: string; isDir: boolean; updatedAt: string }>;
    };
    const list: ArtifactListItem[] = [];
    for (const item of data.items || []) {
      if (item.isDir) continue;
      const kind = detectArtifactKind(item.name);
      if (!kind) continue;
      list.push({
        name: item.name,
        relPath: item.relPath,
        updatedAt: item.updatedAt,
        kind,
      });
    }
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    artifacts.value = list;
    if (!selectedPath.value && list.length > 0) {
      await loadArtifact(list[0].relPath, list[0].name);
    }
  } catch {
    // ignore transient errors
  }
}

async function loadArtifact(relPath: string, title?: string) {
  const cleaned = relPath.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch(`/api/workspace/text?path=${encodeURIComponent(cleaned)}`);
    const data = (await res.json()) as {
      path?: string;
      name?: string;
      content?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || `Failed to load artifact (${res.status})`);
    }
    selectedPath.value = data.path || cleaned;
    currentTitle.value = title || data.name || cleaned.split("/").pop() || cleaned;
    currentKind.value = detectArtifactKind(data.name || cleaned) || "html";
    content.value = data.content ?? "";
    originalContent.value = content.value;
    renderKey.value += 1;
    emit("activeChanged", { path: selectedPath.value, title: currentTitle.value });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function saveArtifact() {
  if (!selectedPath.value || !isDirty.value || saving.value) return;
  saving.value = true;
  try {
    const res = await fetch("/api/workspace/text", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedPath.value, content: content.value }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to save artifact");
    }
    originalContent.value = content.value;
    renderKey.value += 1;
    toast.success("Artifact saved");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not save artifact");
  } finally {
    saving.value = false;
  }
}

async function copyCode() {
  if (!content.value) return;
  try {
    await navigator.clipboard.writeText(content.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    toast.error("Failed to copy to clipboard");
  }
}

function downloadArtifact() {
  if (!selectedPath.value) return;
  const q = new URLSearchParams({ path: selectedPath.value, download: "1" });
  window.open(`/api/workspace/file?${q.toString()}`, "_blank", "noopener,noreferrer");
}

function openParentFolder() {
  if (!selectedPath.value) {
    emit("openInFiles", "artifacts");
    return;
  }
  const idx = selectedPath.value.lastIndexOf("/");
  emit("openInFiles", idx > 0 ? selectedPath.value.slice(0, idx) : "");
}

function reloadPreview() {
  if (selectedPath.value) {
    void loadArtifact(selectedPath.value, currentTitle.value);
  }
}

function handleSelectChange(val: unknown) {
  if (typeof val === "string" && val) {
    void loadArtifact(val);
  }
}

function openArtifact(relPath: string, title?: string) {
  viewMode.value = "preview";
  void fetchArtifactsList();
  void loadArtifact(relPath, title);
}

watch(
  () => props.refreshTick,
  () => {
    void fetchArtifactsList();
    if (selectedPath.value && !isDirty.value) {
      void loadArtifact(selectedPath.value, currentTitle.value);
    }
  }
);

watch(
  () => props.activePath,
  (next) => {
    if (next && next !== selectedPath.value) {
      void loadArtifact(next);
    }
  }
);

onMounted(() => {
  void fetchArtifactsList();
  if (props.activePath) {
    void loadArtifact(props.activePath);
  }
});

defineExpose({
  openArtifact,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/70 px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <Select
          v-if="artifacts.length > 0 || selectedPath"
          :model-value="selectedPath"
          @update:model-value="handleSelectChange"
        >
          <SelectTrigger class="h-8 w-[220px] max-w-[45vw] text-xs font-medium">
            <SelectValue :placeholder="currentTitle || 'Select artifact...'" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-if="selectedPath && !artifacts.some((a) => a.relPath === selectedPath)"
                :value="selectedPath"
              >
                {{ currentTitle || selectedPath }}
              </SelectItem>
              <SelectItem v-for="item in artifacts" :key="item.relPath" :value="item.relPath">
                {{ item.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge v-if="selectedPath" variant="secondary" class="h-5 px-2 text-[10px] font-mono uppercase">
          {{ kindBadge }}
        </Badge>
      </div>

      <div class="flex items-center gap-1.5">
        <ToggleGroup
          v-if="selectedPath"
          v-model="viewMode"
          type="single"
          variant="outline"
          size="sm"
          class="h-8"
        >
          <ToggleGroupItem value="preview" aria-label="Preview" class="h-7 gap-1 px-2 text-xs">
            <EyeIcon class="size-3.5" />
            <span>Preview</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="code" aria-label="Code" class="h-7 gap-1 px-2 text-xs">
            <Code2Icon class="size-3.5" />
            <span>Code</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          v-if="viewMode === 'code' && isDirty"
          size="sm"
          class="h-8 gap-1 px-2.5 text-xs"
          :disabled="saving"
          @click="saveArtifact"
        >
          <SaveIcon class="size-3.5" />
          <span>{{ saving ? "Saving..." : "Save" }}</span>
        </Button>

        <Button
          v-if="selectedPath"
          size="icon-sm"
          variant="ghost"
          title="Reload artifact"
          @click="reloadPreview"
        >
          <RefreshCwIcon class="size-3.5" />
        </Button>
        <Button
          v-if="selectedPath"
          size="icon-sm"
          variant="ghost"
          title="Copy source"
          @click="copyCode"
        >
          <CheckIcon v-if="copied" class="size-3.5 text-emerald-600" />
          <CopyIcon v-else class="size-3.5" />
        </Button>
        <Button
          v-if="selectedPath"
          size="icon-sm"
          variant="ghost"
          title="Download file"
          @click="downloadArtifact"
        >
          <DownloadIcon class="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Open folder in Studio Files"
          @click="openParentFolder"
        >
          <FolderOpenIcon class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- Main Stage -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <div v-if="loading" class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner class="size-4" />
        <span>Loading artifact...</span>
      </div>

      <div v-else-if="errorMsg" class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-sm font-medium text-destructive">{{ errorMsg }}</p>
        <Button size="sm" variant="outline" @click="reloadPreview">Try again</Button>
      </div>

      <div
        v-else-if="!selectedPath"
        class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div class="flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-xs">
          <LayersIcon class="size-5 text-foreground/80" />
        </div>
        <div class="max-w-sm space-y-1">
          <h3 class="text-sm font-semibold text-foreground">Live Studio Artifacts</h3>
          <p class="text-xs text-muted-foreground">
            Ask Otto to build an interactive HTML overlay, React tool, SVG badge, or Mermaid diagram. It saves straight to <code class="font-mono">/workspace/artifacts</code> and renders live here.
          </p>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <Button
            v-for="s in quickStarters"
            :key="s.label"
            size="sm"
            variant="outline"
            class="h-8 gap-1.5 rounded-full text-xs"
            @click="emit('askPrompt', s.prompt)"
          >
            <SparklesIcon class="size-3" />
            <span>{{ s.label }}</span>
          </Button>
        </div>
      </div>

      <template v-else-if="viewMode === 'preview'">
        <div
          v-if="currentKind === 'markdown'"
          class="md-content h-full overflow-y-auto px-6 py-5 text-sm"
          v-html="renderedMarkdownHtml"
        />
        <iframe
          v-else
          :key="renderKey"
          :srcdoc="srcdoc"
          sandbox="allow-scripts"
          class="h-full w-full border-0 bg-white"
          :title="currentTitle || 'Artifact preview'"
        />
      </template>

      <div v-else class="flex h-full flex-col p-3">
        <Textarea
          v-model="content"
          class="h-full min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
          spellcheck="false"
        />
      </div>
    </div>
  </div>
</template>
