<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Code2Icon,
  EyeIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildStudioAppSrcdoc,
  type CustomStudioAppKind,
} from "@/lib/studio-app-sandbox";

const props = defineProps<{
  slug: string;
  refreshTick: number;
}>();

const emit = defineEmits<{
  uninstalled: [slug: string];
  metaLoaded: [payload: { slug: string; title: string; description: string }];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const title = ref(props.slug);
const description = ref("");
const kind = ref<CustomStudioAppKind>("react");
const code = ref("");
const originalCode = ref("");
const appState = ref<Record<string, unknown>>({});
const initialIframeState = ref<Record<string, unknown>>({});
const viewMode = ref<"app" | "code">("app");
const loading = ref(true);
const saving = ref(false);
const errorMsg = ref("");
const renderKey = ref(0);
const confirmUninstall = ref(false);
function createBridgeToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return crypto.randomUUID().replace(/-/g, "");
}
const bridgeToken = createBridgeToken();

const isDirty = computed(() => code.value !== originalCode.value);

const srcdoc = computed(() => {
  if (!code.value) return "";
  return buildStudioAppSrcdoc({
    slug: props.slug,
    title: title.value,
    kind: kind.value,
    code: code.value,
    initialState: initialIframeState.value,
    bridgeToken,
  });
});

async function loadApp() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}`);
    const data = (await res.json()) as {
      meta?: { slug: string; title: string; description?: string; kind: CustomStudioAppKind };
      code?: string;
      state?: Record<string, unknown>;
      error?: string;
    };
    if (!res.ok || !data.meta) {
      throw new Error(data.error || `Failed to load app (${res.status})`);
    }
    title.value = data.meta.title;
    description.value = data.meta.description || "";
    kind.value = data.meta.kind || "react";
    code.value = data.code || "";
    originalCode.value = code.value;
    const loadedState = data.state && typeof data.state === "object" ? data.state : {};
    appState.value = loadedState;
    initialIframeState.value = loadedState;
    renderKey.value += 1;
    emit("metaLoaded", {
      slug: props.slug,
      title: title.value,
      description: description.value,
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function saveCode() {
  if (!isDirty.value || saving.value) return;
  saving.value = true;
  try {
    const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}/code`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.value }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to save app code");
    }
    originalCode.value = code.value;
    renderKey.value += 1;
    viewMode.value = "app";
    toast.success(`Updated ${title.value}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not save code");
  } finally {
    saving.value = false;
  }
}

async function resetAppState() {
  try {
    const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: {} }),
    });
    if (!res.ok) throw new Error("Failed to reset app data");
    appState.value = {};
    initialIframeState.value = {};
    renderKey.value += 1;
    toast.success("App data reset");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Reset failed");
  }
}

async function uninstallApp() {
  try {
    const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to uninstall app");
    confirmUninstall.value = false;
    toast.success(`Removed ${title.value}`);
    emit("uninstalled", props.slug);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not remove app");
  }
}

async function handleBridgeMessage(event: MessageEvent) {
  const win = iframeRef.value?.contentWindow;
  if (!win || event.source !== win) return;
  const msg = event.data as {
    __ottoAppBridge?: boolean;
    token?: string;
    id?: number;
    type?: string;
    state?: Record<string, unknown>;
  } | null;
  if (!msg || msg.__ottoAppBridge !== true || msg.token !== bridgeToken || typeof msg.id !== "number") {
    return;
  }

  try {
    if (msg.type === "loadState") {
      const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}/state`);
      const data = (await res.json()) as { state?: Record<string, unknown>; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load state");
      appState.value = data.state || {};
      win.postMessage(
        { __ottoAppBridgeReply: true, token: bridgeToken, id: msg.id, ok: true, state: appState.value },
        "*"
      );
      return;
    }

    if (msg.type === "saveState") {
      const next = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state) ? msg.state : {};
      const res = await fetch(`/api/studio-apps/${encodeURIComponent(props.slug)}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { state?: Record<string, unknown>; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save state");
      appState.value = data.state || next;
      win.postMessage(
        { __ottoAppBridgeReply: true, token: bridgeToken, id: msg.id, ok: true, state: appState.value },
        "*"
      );
      return;
    }
  } catch (err) {
    win.postMessage(
      {
        __ottoAppBridgeReply: true,
        token: bridgeToken,
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      "*"
    );
  }
}

watch(
  () => props.refreshTick,
  () => {
    if (!isDirty.value) {
      void loadApp();
    }
  }
);

onMounted(() => {
  window.addEventListener("message", handleBridgeMessage);
  void loadApp();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleBridgeMessage);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#FAFAFA]">
    <!-- Subtle App Bar (No Download) -->
    <div class="flex items-center justify-between gap-2 border-b border-[#EDEDED] bg-white px-3 py-1.5">
      <div class="flex items-center gap-1.5">
        <ToggleGroup
          v-model="viewMode"
          type="single"
          variant="outline"
          size="sm"
          class="h-7"
        >
          <ToggleGroupItem value="app" aria-label="App view" class="h-6 gap-1 px-2 font-mono text-[11px]">
            <EyeIcon class="size-3" />
            <span>App</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="code" aria-label="Source code" class="h-6 gap-1 px-2 font-mono text-[11px]">
            <Code2Icon class="size-3" />
            <span>Code</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          v-if="viewMode === 'code' && isDirty"
          size="xs"
          class="h-7 gap-1 px-2.5"
          :disabled="saving"
          @click="saveCode"
        >
          <SaveIcon class="size-3" />
          <span>{{ saving ? "Saving" : "Save" }}</span>
        </Button>
      </div>

      <div class="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Reload app"
          @click="loadApp"
        >
          <RefreshCwIcon class="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Reset saved app data"
          @click="resetAppState"
        >
          <RotateCcwIcon class="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          title="Remove app from desktop"
          @click="confirmUninstall = true"
        >
          <Trash2Icon class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- App Stage -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <div v-if="loading" class="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
        <Spinner class="size-4" />
        <span>Starting {{ title }}...</span>
      </div>

      <div v-else-if="errorMsg" class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="font-mono text-xs text-destructive">{{ errorMsg }}</p>
        <Button size="xs" variant="outline" @click="loadApp">Retry</Button>
      </div>

      <iframe
        v-else-if="viewMode === 'app'"
        ref="iframeRef"
        :key="renderKey"
        :srcdoc="srcdoc"
        sandbox="allow-scripts"
        class="h-full w-full border-0 bg-[#FAFAFA]"
        :title="title"
      />

      <div v-else class="flex h-full flex-col p-3">
        <Textarea
          v-model="code"
          class="h-full min-h-0 flex-1 resize-none bg-white font-mono text-xs leading-relaxed"
          spellcheck="false"
        />
      </div>
    </div>

    <AlertDialog v-model:open="confirmUninstall">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {{ title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the app from your desktop and deletes its saved local data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="uninstallApp">Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
