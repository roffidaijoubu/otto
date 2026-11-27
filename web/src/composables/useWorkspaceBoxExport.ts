import { ref } from "vue";
import { toast } from "vue-sonner";
import { playSound } from "@/lib/sounds";
import type { BoxExportResult } from "../types/workspace";

export const BOX_MAX_UPLOAD_BYTES = 48 * 1024 * 1024;
export const BOX_OVERSIZE_REASON =
  "Exceeds 48 MB Box API limit — not synced to Box (download locally instead)";

export function isBoxOversize(entry?: { isDir?: boolean; sizeBytes?: number } | null): boolean {
  if (!entry || entry.isDir) return false;
  return typeof entry.sizeBytes === "number" && entry.sizeBytes > BOX_MAX_UPLOAD_BYTES;
}

export function useWorkspaceBoxExport() {
  const boxConnected = ref(false);
  const boxSyncing = ref(false);
  const boxLastSyncedAt = ref<string | null>(null);
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
        const data = (await res.json()) as {
          connected?: boolean;
          sync?: { syncing?: boolean; lastSyncedAt?: string | null };
        };
        boxConnected.value = Boolean(data.connected);
        if (data.sync) {
          boxSyncing.value = Boolean(data.sync.syncing);
          boxLastSyncedAt.value = data.sync.lastSyncedAt ?? null;
        }
      }
    } catch {
      // ignore
    }
  }

  async function syncBoxNow(onDone?: () => void) {
    if (boxSyncing.value) return;
    boxSyncing.value = true;
    try {
      const res = await fetch("/api/workspace/box-sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sync?: {
          pulledCount: number;
          pushedCount: number;
          skippedUnchanged: number;
          skippedOversize: Array<{ relPath: string; sizeBytes: number }>;
          lastSyncedAt: string | null;
        };
      };
      if (!res.ok || !data.ok || !data.sync) {
        playSound("error");
        toast.error(data.error || "Box sync failed");
        return;
      }
      boxLastSyncedAt.value = data.sync.lastSyncedAt;
      const parts: string[] = [];
      if (data.sync.pulledCount > 0) parts.push(`pulled ${data.sync.pulledCount}`);
      if (data.sync.pushedCount > 0) parts.push(`pushed ${data.sync.pushedCount}`);
      if (parts.length === 0) parts.push("already up to date");
      if (data.sync.skippedOversize.length > 0) {
        parts.push(`${data.sync.skippedOversize.length} file(s) >48 MB kept local`);
      }
      playSound("job_complete");
      toast.success(`Box synced (${parts.join(" · ")})`);
      onDone?.();
    } catch (err) {
      playSound("error");
      toast.error(err instanceof Error ? err.message : "Box sync failed");
    } finally {
      boxSyncing.value = false;
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
    boxSyncing,
    boxLastSyncedAt,
    boxModalOpen,
    boxUploading,
    boxTargetName,
    boxTargetIsDir,
    boxResult,
    boxError,
    boxCopied,
    checkBoxStatus,
    syncBoxNow,
    sendToBox,
    copyBoxLink,
  };
}
