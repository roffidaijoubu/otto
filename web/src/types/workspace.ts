export interface WorkspaceEntry {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  kind: "dir" | "image" | "video" | "audio" | "markdown" | "text" | "other";
  editable: boolean;
  previewable: boolean;
  sizeBytes: number;
  updatedAt: string;
  matchedSrtRelPath?: string | null;
}

export interface WorkspaceStats {
  totalBytes: number;
  fileCount: number;
  clipCount: number;
}

export type ViewMode = "list" | "grid";
export type SortMode = "name-asc" | "modified-desc" | "size-desc";

export interface BoxExportResult {
  kind: "file" | "folder";
  id: string;
  name: string;
  url: string;
  folderUrl: string;
  uploadedCount: number;
  skipped: Array<{ name: string; reason: string }>;
}

export const ROOT_SELECT_VALUE = "__workspace_root__";
export const VIEW_STORAGE_KEY = "otto_fm_view_mode";
