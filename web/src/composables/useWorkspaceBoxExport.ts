import { ref } from "vue";
import { toast } from "vue-sonner";
import { playSound } from "@/lib/sounds";
import type { BoxExportResult } from "../types/workspace";

export function useWorkspaceBoxExport() {
  const boxConnected = ref(false);
  const boxModalOpen = ref(false);
  const boxUploading = ref(false);
  const boxTargetName = ref("");
  const boxTargetIsDir = ref(false);
  const boxResult = ref<BoxExportResult | null>(null);
  const boxError = ref("");
  const boxCopied = ref(false);

  async function checkBoxStatus() {
    try {
      const res = await fetch("/api/workspace/box-status");
      if (res.ok) {
        const data = (await res.json()) as { connected?: boolean };
        boxConnected.value = Boolean(data.connected);
      }
    } catch {
      // ignore
    }
  }

  void checkBoxStatus();

  async function sendToBox(relPath: string, displayName: string, isDir: boolean) {
    boxTargetName.value = displayName || (relPath ? relPath.split("/").pop() || relPath : "workspace");
    boxTargetIsDir.value = isDir;
    boxResult.value = null;
    boxError.value = "";
    boxCopied.value = false;
    boxModalOpen.value = true;
    boxUploading.value = true;
    try {
      const res = await fetch("/api/workspace/export-box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relPath }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<BoxExportResult> & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        boxError.value = data.error || "Box upload failed";
        playSound("error");
      } else {
        boxResult.value = {
          kind: data.kind === "folder" ? "folder" : "file",
          id: data.id || "",
          name: data.name || boxTargetName.value,
          url: data.url,
          folderUrl: data.folderUrl || data.url,
          uploadedCount: data.uploadedCount ?? 1,
          skipped: Array.isArray(data.skipped) ? data.skipped : [],
        };
        playSound("job_complete");
        toast.success(`Uploaded ${boxResult.value.name} to Box`);
      }
    } catch (err) {
      boxError.value = err instanceof Error ? err.message : "Box upload failed";
      playSound("error");
    } finally {
      boxUploading.value = false;
    }
  }

  async function copyBoxLink() {
    const url = boxResult.value?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      boxCopied.value = true;
      toast.success("Box link copied");
      setTimeout(() => {
        boxCopied.value = false;
      }, 2000);
    } catch {
      toast.error("Could not copy link");
    }
  }

  return {
    boxConnected,
    boxModalOpen,
    boxUploading,
    boxTargetName,
    boxTargetIsDir,
    boxResult,
    boxError,
    boxCopied,
    checkBoxStatus,
    sendToBox,
    copyBoxLink,
  };
}
