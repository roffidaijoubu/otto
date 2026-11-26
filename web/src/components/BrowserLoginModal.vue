<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowLeftIcon, ClipboardPasteIcon, CheckIcon, RotateCwIcon, XIcon, GlobeIcon } from "@lucide/vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NoVncCanvas from "./NoVncCanvas.vue";

export interface BrowserLoginRequest {
  requestId: string;
  site: string;
  label: string;
  url: string;
  reason?: string;
  expectedCookies: string[];
  status: "pending" | "completed" | "cancelled" | "timeout";
}

const props = defineProps<{
  request: BrowserLoginRequest | null;
}>();

const emit = defineEmits<{
  completed: [requestId: string];
  cancelled: [requestId: string];
}>();

const vncRef = ref<InstanceType<typeof NoVncCanvas> | null>(null);
const busyAction = ref(false);
const pasteError = ref("");
const completeError = ref("");

const isOpen = computed(() => Boolean(props.request && props.request.status === "pending"));

const watchingLabel = computed(() => {
  if (!props.request) return "";
  if (props.request.expectedCookies.length > 0) {
    return `Auto-detecting: ${props.request.expectedCookies.join(", ")}`;
  }
  return "Click Done after logging in";
});

async function handleBrowserAction(action: "back" | "reload") {
  try {
    await fetch("/api/browser/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  } catch {
    // ignore
  }
}

async function handlePasteClipboard() {
  pasteError.value = "";
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      vncRef.value?.pasteText(text);
    }
  } catch {
    pasteError.value = "Clipboard access denied by browser; type directly into the window.";
  }
}
async function handleManualComplete() {
  if (!props.request || busyAction.value) return;
  busyAction.value = true;
  completeError.value = "";
  try {
    const res = await fetch("/api/browser/login/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: props.request.requestId }),
    });
    if (res.ok) {
      emit("completed", props.request.requestId);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    completeError.value = data.error || "Could not capture this session.";
  } finally {
    busyAction.value = false;
  }
}

async function handleCancel() {
  if (!props.request || busyAction.value) return;
  busyAction.value = true;
  try {
    await fetch("/api/browser/login/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: props.request.requestId }),
    });
    emit("cancelled", props.request.requestId);
  } finally {
    busyAction.value = false;
  }
}
</script>

<template>
  <Dialog :open="isOpen" @update:open="(val) => { if (!val) handleCancel(); }">
    <DialogContent
      class="w-[95vw] max-w-[95vw] sm:max-w-[95vw] p-4 gap-3 overflow-hidden"
      @escape-key-down.prevent
      @pointer-down-outside.prevent
      @interact-outside.prevent
    >
      <DialogHeader class="min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-2 pr-8 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <GlobeIcon class="w-4 h-4 shrink-0 text-muted-foreground" />
            <DialogTitle class="text-base truncate">
              Sign in to {{ request?.label || request?.site }}
            </DialogTitle>
            <Badge variant="secondary" class="text-xs shrink-0">
              {{ watchingLabel }}
            </Badge>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="xs"
              type="button"
              title="Back"
              @click="handleBrowserAction('back')"
            >
              <ArrowLeftIcon class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              title="Reload"
              @click="handleBrowserAction('reload')"
            >
              <RotateCwIcon class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              @click="handlePasteClipboard"
            >
              <ClipboardPasteIcon class="w-3.5 h-3.5 mr-1" />
              Paste Clipboard
            </Button>
          </div>
        </div>
        <DialogDescription class="text-xs truncate min-w-0">
          {{ request?.reason || `Otto needs your ${request?.label || request?.site} session cookies. Complete login below; this modal closes automatically.` }}
          <span class="ml-1 opacity-70">({{ request?.url }})</span>
        </DialogDescription>
      </DialogHeader>

      <div class="relative w-full h-[64vh] min-h-[420px] rounded-lg overflow-hidden border border-border bg-[#f4f4f5]">
        <NoVncCanvas
          v-if="isOpen"
          ref="vncRef"
          :active="isOpen"
          background="#f4f4f5"
        />
      </div>

      <p v-if="pasteError" class="text-xs text-destructive">{{ pasteError }}</p>
      <p v-if="completeError" class="text-xs text-destructive">{{ completeError }}</p>

      <DialogFooter class="flex items-center justify-between sm:justify-between gap-2">
        <span class="text-xs text-muted-foreground">
          Cookies are saved locally in <code>~/.config/lma/cookies/</code> (chmod 600).
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            :disabled="busyAction"
            @click="handleCancel"
          >
            <XIcon class="w-3.5 h-3.5 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            type="button"
            :disabled="busyAction"
            @click="handleManualComplete"
          >
            <CheckIcon class="w-3.5 h-3.5 mr-1" />
            Done (Capture Cookies)
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
