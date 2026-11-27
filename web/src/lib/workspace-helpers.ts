import type { Component } from "vue";
import {
  ClipboardListIcon,
  FileCodeIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  MusicIcon,
  PackageIcon,
  UploadIcon,
} from "@lucide/vue";
import {
  VIEW_STORAGE_KEY,
  type SortMode,
  type ViewMode,
  type WorkspaceEntry,
} from "../types/workspace";

export function normalizeDirPath(relDir: string): string {
  return relDir.replace(/^\/+|\/+$/g, "");
}

export function buildBreadcrumbs(relDir: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [{ name: "workspace", path: "" }];
  const normalized = normalizeDirPath(relDir);
  if (!normalized) return out;
  const parts = normalized.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push({ name: part, path: acc });
  }
  return out;
}

export function readStoredViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "grid" || saved === "list") return saved;
  } catch {
    // ignore storage failures
  }
  return "list";
}

export function sortWorkspaceEntries(entries: WorkspaceEntry[], mode: SortMode): WorkspaceEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (mode === "modified-desc") {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    if (mode === "size-desc") {
      return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return copy;
}

export function sortModeLabel(mode: SortMode): string {
  if (mode === "modified-desc") return "Newest";
  if (mode === "size-desc") return "Largest";
  return "Name";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function folderIconComponent(dirPath: string, isActive: boolean): Component {
  const seg = dirPath.split("/")[0];
  if (seg === "clips") return FilmIcon;
  if (seg === "thumbnails") return ImageIcon;
  if (seg === "scripts") return FileTextIcon;
  if (seg === "briefs") return ClipboardListIcon;
  if (seg === "uploads") return UploadIcon;
  if (seg === "exports") return PackageIcon;
  return isActive ? FolderOpenIcon : FolderIcon;
}

export function entryIconComponent(entry: WorkspaceEntry): Component {
  if (entry.isDir) return folderIconComponent(entry.relPath, false);
  if (entry.kind === "image") return ImageIcon;
  if (entry.kind === "video") return FilmIcon;
  if (entry.kind === "audio") return MusicIcon;
  if (entry.kind === "markdown") return FileTextIcon;
  if (entry.kind === "text") return FileCodeIcon;
  return PackageIcon;
}

export function kindBadgeLabel(entry: WorkspaceEntry): string {
  if (entry.isDir) return "folder";
  if (entry.kind === "markdown") return "md";
  const dot = entry.name.lastIndexOf(".");
  if (dot > 0 && dot < entry.name.length - 1) {
    return entry.name.slice(dot + 1).toLowerCase().slice(0, 6);
  }
  return entry.kind;
}

export function fileUrl(relPath: string, download = false): string {
  const q = new URLSearchParams({ path: relPath });
  if (download) q.set("download", "1");
  return `/api/workspace/file?${q.toString()}`;
}

export function zipUrl(relDir: string): string {
  const q = new URLSearchParams({ path: relDir });
  return `/api/workspace/zip?${q.toString()}`;
}

export function askActionLabel(entry: WorkspaceEntry): string {
  if (entry.kind === "video") return "Review Clip";
  return "Ask Otto";
}

export function buildAskOttoPrompt(entry: WorkspaceEntry): string {
  const hidden = `<hidden>Workspace file absolute path: ${entry.absPath} (relative: ${entry.relPath}, type: ${entry.kind})</hidden>`;
  if (entry.kind === "video") {
    return `Watch my clip "${entry.name}" and critique the first 3-second hook, pacing, dead air, and editor notes.\n${hidden}`;
  }
  return `Read and review my workspace file "${entry.relPath}" and share your feedback.\n${hidden}`;
}

export function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
