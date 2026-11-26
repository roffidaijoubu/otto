import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_DIR = process.env.HOME || "/home/sprite";
export const WORKSPACE_ROOT = path.resolve(process.env.LMA_WORKSPACE_DIR || path.join(HOME_DIR, "workspace"));
export const WORKSPACE_CLIPS_DIR = path.join(WORKSPACE_ROOT, "clips");
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB inline editor/preview cap
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB zip safety cap

export const STARTER_DIRS = [
  "clips",
  "thumbnails",
  "scripts",
  "briefs",
  "uploads",
  "exports",
] as const;

export type WorkspaceFileKind = "dir" | "image" | "video" | "audio" | "markdown" | "text" | "other";

export interface WorkspaceEntry {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  kind: WorkspaceFileKind;
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

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};
const MARKDOWN_EXTS: Record<string, true> = { ".md": true, ".markdown": true };
const TEXT_EXTS: Record<string, true> = {
  ".txt": true,
  ".srt": true,
  ".vtt": true,
  ".csv": true,
  ".tsv": true,
  ".json": true,
  ".yml": true,
  ".yaml": true,
  ".log": true,
  ".html": true,
  ".htm": true,
  ".svg": true,
  ".xml": true,
  ".css": true,
  ".js": true,
  ".ts": true,
  ".jsx": true,
  ".tsx": true,
  ".mmd": true,
  ".mermaid": true,
};

export function ensureWorkspaceScaffold(): void {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  for (const dir of STARTER_DIRS) {
    fs.mkdirSync(path.join(WORKSPACE_ROOT, dir), { recursive: true });
  }
  // One-time migration: move legacy ~/clips/* contents into ~/workspace/clips/ if present
  const legacyClips = path.resolve(HOME_DIR, "clips");
  if (
    legacyClips !== WORKSPACE_CLIPS_DIR &&
    fs.existsSync(legacyClips) &&
    !fs.lstatSync(legacyClips).isSymbolicLink() &&
    fs.statSync(legacyClips).isDirectory()
  ) {
    try {
      for (const entry of fs.readdirSync(legacyClips)) {
        const src = path.join(legacyClips, entry);
        const dest = path.join(WORKSPACE_CLIPS_DIR, entry);
        if (!fs.existsSync(dest)) {
          fs.renameSync(src, dest);
        }
      }
    } catch {
      // non-fatal best-effort migration
    }
  }
}

export function sanitizeSegment(raw: string): string {
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid file or folder name");
  }
  return cleaned;
}

export function normalizeRelPath(rawRel: string | null | undefined): string {
  if (!rawRel) return "";
  if (rawRel.includes("\0")) throw new Error("Invalid path");
  const normalized = rawRel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  for (const seg of parts) {
    if (seg === "." || seg === ".." || seg.startsWith(".")) {
      throw new Error("Hidden files and parent traversal segments are not allowed");
    }
    if (/[\x00-\x1f\x7f]/.test(seg)) {
      throw new Error("Invalid control character in path");
    }
  }
  return parts.join("/");
}

export function resolveSafeWorkspacePath(
  rawRel: string | null | undefined,
  opts: { allowMissing?: boolean } = {}
): { absPath: string; relPath: string } {
  ensureWorkspaceScaffold();
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const relPath = normalizeRelPath(rawRel);
  const candidate = relPath ? path.resolve(rootReal, relPath) : rootReal;
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error("Path escapes workspace root");
  }

  if (fs.existsSync(candidate)) {
    const lstat = fs.lstatSync(candidate);
    if (lstat.isSymbolicLink()) {
      throw new Error("Symlinks are not permitted inside workspace API");
    }
    const real = fs.realpathSync(candidate);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error("Symlink escapes workspace root");
    }
    return { absPath: real, relPath };
  }

  if (!opts.allowMissing) {
    throw new Error("Path not found");
  }

  // Verify nearest existing ancestor stays within rootReal
  let ancestor = path.dirname(candidate);
  while (ancestor && !fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (fs.existsSync(ancestor)) {
    const realAnc = fs.realpathSync(ancestor);
    if (realAnc !== rootReal && !realAnc.startsWith(rootReal + path.sep)) {
      throw new Error("Target ancestor escapes workspace root");
    }
  }
  return { absPath: candidate, relPath };
}

export function classifyFile(name: string): {
  kind: WorkspaceFileKind;
  editable: boolean;
  previewable: boolean;
  inlineMime: string | null;
} {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_MIME_BY_EXT[ext]) {
    return { kind: "image", editable: false, previewable: true, inlineMime: IMAGE_MIME_BY_EXT[ext] };
  }
  if (VIDEO_MIME_BY_EXT[ext]) {
    return { kind: "video", editable: false, previewable: true, inlineMime: VIDEO_MIME_BY_EXT[ext] };
  }
  if (AUDIO_MIME_BY_EXT[ext]) {
    return { kind: "audio", editable: false, previewable: true, inlineMime: AUDIO_MIME_BY_EXT[ext] };
  }
  if (MARKDOWN_EXTS[ext]) {
    return { kind: "markdown", editable: true, previewable: true, inlineMime: null };
  }
  if (TEXT_EXTS[ext]) {
    // .html / .svg are NEVER served inline as active DOM/SVG; only viewed/edited as plain text source!
    return { kind: "text", editable: true, previewable: true, inlineMime: null };
  }
  return { kind: "other", editable: false, previewable: false, inlineMime: null };
}

function buildEntry(absPath: string, relPath: string, st: fs.Stats): WorkspaceEntry {
  const name = path.basename(absPath);
  if (st.isDirectory()) {
    return {
      name,
      relPath,
      absPath,
      isDir: true,
      kind: "dir",
      editable: false,
      previewable: false,
      sizeBytes: 0,
      updatedAt: st.mtime.toISOString(),
    };
  }
  const cls = classifyFile(name);
  let matchedSrtRelPath: string | null = null;
  if (cls.kind === "video" && name.toLowerCase().endsWith(".mp4")) {
    const dirAbs = path.dirname(absPath);
    const dirRel = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
    const base = name.slice(0, -4);
    const exact = `${base}.srt`;
    const stripped = `${base.replace(/_prepped$/, "")}.srt`;
    if (fs.existsSync(path.join(dirAbs, exact))) {
      matchedSrtRelPath = dirRel ? `${dirRel}/${exact}` : exact;
    } else if (fs.existsSync(path.join(dirAbs, stripped))) {
      matchedSrtRelPath = dirRel ? `${dirRel}/${stripped}` : stripped;
    }
  }
  return {
    name,
    relPath,
    absPath,
    isDir: false,
    kind: cls.kind,
    editable: cls.editable && st.size <= MAX_TEXT_PREVIEW_BYTES,
    previewable: cls.previewable,
    sizeBytes: st.size,
    updatedAt: st.mtime.toISOString(),
    matchedSrtRelPath,
  };
}

export function computeWorkspaceTreeAndStats(): {
  dirs: string[];
  stats: WorkspaceStats;
  recentFiles: WorkspaceEntry[];
} {
  ensureWorkspaceScaffold();
  const dirs: string[] = [""];
  const allFiles: WorkspaceEntry[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  let clipCount = 0;

  function walk(absDir: string, relDir: string, depth: number) {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (d.name.startsWith(".") || d.isSymbolicLink()) continue;
      const childRel = relDir ? `${relDir}/${d.name}` : d.name;
      const childAbs = path.join(absDir, d.name);
      let st: fs.Stats;
      try {
        st = fs.statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        dirs.push(childRel);
        walk(childAbs, childRel, depth + 1);
      } else if (st.isFile()) {
        fileCount++;
        totalBytes += st.size;
        if (childRel.startsWith("clips/") && d.name.toLowerCase().endsWith(".mp4")) {
          clipCount++;
        }
        allFiles.push(buildEntry(childAbs, childRel, st));
      }
    }
  }

  walk(WORKSPACE_ROOT, "", 0);
  dirs.sort((a, b) => a.localeCompare(b));
  allFiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    dirs,
    stats: { totalBytes, fileCount, clipCount },
    recentFiles: allFiles.slice(0, 12),
  };
}

export function listWorkspaceDirectory(rawRelDir: string, searchQuery = ""): {
  path: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  items: WorkspaceEntry[];
  dirs: string[];
  stats: WorkspaceStats;
  recentFiles: WorkspaceEntry[];
} {
  const { absPath, relPath } = resolveSafeWorkspacePath(rawRelDir || "");
  if (!fs.statSync(absPath).isDirectory()) {
    throw new Error("Target is not a directory");
  }

  const breadcrumbs: Array<{ name: string; path: string }> = [{ name: "workspace", path: "" }];
  if (relPath) {
    const parts = relPath.split("/");
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      breadcrumbs.push({ name: part, path: acc });
    }
  }

  const q = searchQuery.trim().toLowerCase();
  const items: WorkspaceEntry[] = [];

  if (q) {
    // Recursive search under current directory
    function walkSearch(dirAbs: string, dirRel: string, depth: number) {
      if (depth > 8) return;
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of dirents) {
        if (d.name.startsWith(".") || d.isSymbolicLink()) continue;
        const cRel = dirRel ? `${dirRel}/${d.name}` : d.name;
        const cAbs = path.join(dirAbs, d.name);
        let st: fs.Stats;
        try {
          st = fs.statSync(cAbs);
        } catch {
          continue;
        }
        if (d.name.toLowerCase().includes(q) || cRel.toLowerCase().includes(q)) {
          items.push(buildEntry(cAbs, cRel, st));
        }
        if (st.isDirectory()) {
          walkSearch(cAbs, cRel, depth + 1);
        }
      }
    }
    walkSearch(absPath, relPath, 0);
  } else {
    for (const d of fs.readdirSync(absPath, { withFileTypes: true })) {
      if (d.name.startsWith(".") || d.isSymbolicLink()) continue;
      const cRel = relPath ? `${relPath}/${d.name}` : d.name;
      const cAbs = path.join(absPath, d.name);
      let st: fs.Stats;
      try {
        st = fs.statSync(cAbs);
      } catch {
        continue;
      }
      items.push(buildEntry(cAbs, cRel, st));
    }
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (a.isDir) return a.name.localeCompare(b.name);
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const { dirs, stats, recentFiles } = computeWorkspaceTreeAndStats();
  return { path: relPath, breadcrumbs, items, dirs, stats, recentFiles };
}

export function uniqueDestinationPath(dirAbs: string, fileName: string): { absPath: string; finalName: string } {
  const safeName = sanitizeSegment(fileName);
  let candidate = path.join(dirAbs, safeName);
  if (!fs.existsSync(candidate)) {
    return { absPath: candidate, finalName: safeName };
  }
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
  for (let i = 2; i < 1000; i++) {
    const alt = `${stem}-${i}${ext}`;
    candidate = path.join(dirAbs, alt);
    if (!fs.existsSync(candidate)) {
      return { absPath: candidate, finalName: alt };
    }
  }
  const stamped = `${stem}-${Date.now()}${ext}`;
  return { absPath: path.join(dirAbs, stamped), finalName: stamped };
}

export async function createWorkspaceZip(rawRelDir: string): Promise<{
  zipPath: string;
  downloadName: string;
  cleanup: () => void;
}> {
  const { absPath, relPath } = resolveSafeWorkspacePath(rawRelDir || "");
  if (!fs.statSync(absPath).isDirectory()) {
    throw new Error("ZIP download requires a directory path");
  }

  // Enforce uncompressed size safety cap before archiving
  let totalBytes = 0;
  function measure(dir: string, depth: number) {
    if (depth > 8) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith(".") || d.isSymbolicLink()) continue;
      const p = path.join(dir, d.name);
      const st = fs.statSync(p);
      if (st.isDirectory()) measure(p, depth + 1);
      else if (st.isFile()) {
        totalBytes += st.size;
        if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          throw new Error("Folder exceeds 500 MB ZIP export cap");
        }
      }
    }
  }
  measure(absPath, 0);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lma-zip-"));
  const safeBase = relPath ? sanitizeSegment(relPath.replace(/\//g, "-")) : "lma-workspace";
  const zipPath = path.join(tmpDir, `${safeBase}.zip`);

  const pyScript = `
import os, sys, zipfile
src = os.path.realpath(sys.argv[1])
dst = sys.argv[2]
with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src, followlinks=False):
        dirs[:] = [d for d in dirs if not d.startswith(".") and not os.path.islink(os.path.join(root, d))]
        for fname in files:
            if fname.startswith("."):
                continue
            full = os.path.join(root, fname)
            if os.path.islink(full):
                continue
            rel = os.path.relpath(full, src)
            zf.write(full, rel)
`;

  const proc = Bun.spawn(["python3", "-c", pyScript, absPath, zipPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0 || !fs.existsSync(zipPath)) {
    const stderr = await new Response(proc.stderr).text().catch(() => "");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`ZIP creation failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }

  return {
    zipPath,
    downloadName: `${safeBase}.zip`,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
