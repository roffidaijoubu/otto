/**
 * Non-AI Thumbnail Studio project store under /home/sprite/workspace/thumbnails/<slug>/.
 * Each project stores:
 * - project.json   (metadata, dimensions 1280x720, asset list, export info)
 * - index.html     (1280x720 deterministic HTML/CSS composition)
 * - assets/<file>  (local same-origin copies of character PNGs, logos, Pixabay photos)
 * - thumbnail.png / thumbnail.jpg (exported 1280x720 image when rendered)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir() || "/home/sprite";
export const WORKSPACE_ROOT = path.resolve(
  process.env.LMA_WORKSPACE_DIR || path.join(HOME_DIR, "workspace")
);
export const THUMBNAILS_ROOT = path.join(WORKSPACE_ROOT, "thumbnails");

export interface ThumbnailProjectSummary {
  slug: string;
  title: string;
  description: string;
  width: number;
  height: number;
  assets: string[];
  previewUrl: string;
  exportedFile: string | null;
  exportedUrl: string | null;
  exportedSize: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThumbnailProjectDetail extends ThumbnailProjectSummary {
  html: string;
}

export function sanitizeThumbnailSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!cleaned || !/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
    throw new Error("Invalid thumbnail slug. Use lowercase letters, numbers, and hyphens.");
  }
  return cleaned;
}

export function sanitizeThumbnailAssetName(raw: string): string {
  const base = path.basename(raw.trim()).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "");
  if (!base || base.length > 120 || !/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(base)) {
    throw new Error(`Invalid thumbnail asset filename "${raw}".`);
  }
  return base;
}

export function getThumbnailProjectDir(slug: string): string {
  const safe = sanitizeThumbnailSlug(slug);
  return path.join(THUMBNAILS_ROOT, safe);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function toSummary(meta: {
  slug: string;
  title?: string;
  description?: string;
  width?: number;
  height?: number;
  assets?: string[];
  exportedFile?: string | null;
  exportedSize?: number | null;
  createdAt?: string;
  updatedAt?: string;
}): ThumbnailProjectSummary {
  const slug = meta.slug;
  const exportedFile = meta.exportedFile || null;
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || "",
    width: meta.width || 1280,
    height: meta.height || 720,
    assets: Array.isArray(meta.assets) ? meta.assets : [],
    previewUrl: `/api/thumbnails/${encodeURIComponent(slug)}/preview`,
    exportedFile,
    exportedUrl: exportedFile
      ? `/api/thumbnails/${encodeURIComponent(slug)}/exported/${encodeURIComponent(exportedFile)}`
      : null,
    exportedSize: typeof meta.exportedSize === "number" ? meta.exportedSize : null,
    createdAt: meta.createdAt || new Date().toISOString(),
    updatedAt: meta.updatedAt || new Date().toISOString(),
  };
}

export function listThumbnailProjects(): ThumbnailProjectSummary[] {
  fs.mkdirSync(THUMBNAILS_ROOT, { recursive: true });
  const items: ThumbnailProjectSummary[] = [];
  for (const entry of fs.readdirSync(THUMBNAILS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(THUMBNAILS_ROOT, entry.name, "project.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta = readJson<Record<string, unknown> | null>(metaPath, null);
    if (!meta || typeof meta.slug !== "string") continue;
    items.push(toSummary(meta as Parameters<typeof toSummary>[0]));
  }
  items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return items;
}

export function getThumbnailProject(slug: string): ThumbnailProjectDetail | null {
  const dir = getThumbnailProjectDir(slug);
  const metaPath = path.join(dir, "project.json");
  const htmlPath = path.join(dir, "index.html");
  if (!fs.existsSync(metaPath) || !fs.existsSync(htmlPath)) return null;
  const meta = readJson<Record<string, unknown> | null>(metaPath, null);
  if (!meta || typeof meta.slug !== "string") return null;
  const html = fs.readFileSync(htmlPath, "utf8");
  return {
    ...toSummary(meta as Parameters<typeof toSummary>[0]),
    html,
  };
}

function resolveWorkspaceFile(relPath: string): string {
  const cleaned = relPath.trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error(`Invalid workspace asset path: ${relPath}`);
  }
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const candidate = path.resolve(rootReal, cleaned);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error(`Asset path escapes /home/sprite/workspace: ${relPath}`);
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(`Workspace asset not found: ${relPath}`);
  }
  const real = fs.realpathSync(candidate);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(`Asset symlink escapes /home/sprite/workspace: ${relPath}`);
  }
  return real;
}

export function saveThumbnailProject(input: {
  slug: string;
  title: string;
  description?: string;
  html: string;
  assets?: string[];
}): { project: ThumbnailProjectSummary; copiedAssets: Array<{ name: string; url: string }> } {
  const slug = sanitizeThumbnailSlug(input.slug);
  const dir = getThumbnailProjectDir(slug);
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const existing = readJson<Record<string, unknown> | null>(path.join(dir, "project.json"), null);
  const assetSet = new Set<string>(Array.isArray(existing?.assets) ? (existing.assets as string[]) : []);
  const copiedAssets: Array<{ name: string; url: string }> = [];

  for (const rel of input.assets || []) {
    const srcAbs = resolveWorkspaceFile(rel);
    const name = sanitizeThumbnailAssetName(path.basename(srcAbs));
    const dstAbs = path.join(assetsDir, name);
    if (path.resolve(srcAbs) !== path.resolve(dstAbs)) {
      fs.copyFileSync(srcAbs, dstAbs);
    }
    assetSet.add(name);
    copiedAssets.push({
      name,
      url: `/api/thumbnails/${encodeURIComponent(slug)}/assets/${encodeURIComponent(name)}`,
    });
  }

  // Normalize convenient ./assets/<file> or /assets/<file> paths into same-origin project asset URLs
  const assetPrefix = `/api/thumbnails/${encodeURIComponent(slug)}/assets/`;
  const normalizedHtml = input.html
    .replace(/(["'(])(?:\.\/)?assets\/([a-zA-Z0-9._-]+)(["')])/g, `$1${assetPrefix}$2$3`)
    .replace(/(["'(])\/assets\/([a-zA-Z0-9._-]+)(["')])/g, `$1${assetPrefix}$2$3`);

  const now = new Date().toISOString();
  const meta = {
    slug,
    title: input.title.trim() || slug,
    description: (input.description ?? (existing?.description as string) ?? "").trim(),
    width: 1280,
    height: 720,
    assets: Array.from(assetSet).sort(),
    exportedFile: (existing?.exportedFile as string | null) ?? null,
    exportedSize: (existing?.exportedSize as number | null) ?? null,
    createdAt: (existing?.createdAt as string) || now,
    updatedAt: now,
  };

  atomicWrite(path.join(dir, "index.html"), normalizedHtml);
  atomicWrite(path.join(dir, "project.json"), JSON.stringify(meta, null, 2) + "\n");

  return {
    project: toSummary(meta),
    copiedAssets,
  };
}

export function saveThumbnailExportBytes(
  slug: string,
  bytes: Buffer,
  format: "png" | "jpg" = "jpg"
): { project: ThumbnailProjectSummary; workspacePath: string; filePath: string; size: number } {
  const safe = sanitizeThumbnailSlug(slug);
  const dir = getThumbnailProjectDir(safe);
  const metaPath = path.join(dir, "project.json");
  const existing = readJson<Record<string, unknown> | null>(metaPath, null);
  if (!existing) {
    throw new Error(`Thumbnail project "${safe}" not found.`);
  }
  const ext = format === "png" ? "png" : "jpg";
  const fileName = `${safe}.${ext}`;
  const outPath = path.join(dir, fileName);
  atomicWrite(outPath, bytes);

  const now = new Date().toISOString();
  const meta = {
    ...existing,
    slug: safe,
    exportedFile: fileName,
    exportedSize: bytes.length,
    updatedAt: now,
  };
  atomicWrite(metaPath, JSON.stringify(meta, null, 2) + "\n");

  return {
    project: toSummary(meta as Parameters<typeof toSummary>[0]),
    workspacePath: `thumbnails/${safe}/${fileName}`,
    filePath: outPath,
    size: bytes.length,
  };
}

export function deleteThumbnailProject(slug: string): boolean {
  const dir = getThumbnailProjectDir(slug);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function getThumbnailAssetPath(slug: string, rawName: string): { absPath: string; mimeType: string } | null {
  const safeSlug = sanitizeThumbnailSlug(slug);
  const safeName = sanitizeThumbnailAssetName(rawName);
  const absPath = path.join(THUMBNAILS_ROOT, safeSlug, "assets", safeName);
  if (!fs.existsSync(absPath)) return null;
  const lower = safeName.toLowerCase();
  const mimeType = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".gif")
          ? "image/gif"
          : lower.endsWith(".svg")
            ? "image/svg+xml"
            : "application/octet-stream";
  return { absPath, mimeType };
}

export function renderThumbnailHeadless(
  slug: string,
  format: "jpg" | "png" = "jpg"
): { project: ThumbnailProjectSummary; workspacePath: string; filePath: string; size: number } {
  const safe = sanitizeThumbnailSlug(slug);
  const detail = getThumbnailProject(safe);
  if (!detail) {
    throw new Error(`Thumbnail project "${safe}" not found.`);
  }
  const dir = getThumbnailProjectDir(safe);
  const assetsDir = path.join(dir, "assets");
  const tmpHtml = path.join(dir, `._render_${process.pid}_${Date.now()}.html`);
  const tmpPng = path.join(dir, `._render_${process.pid}_${Date.now()}.png`);
  const tmpJpg = path.join(dir, `._render_${process.pid}_${Date.now()}.jpg`);

  // Rewrite same-origin /api/thumbnails/<slug>/assets/<name> URLs to local file:// paths for headless Chrome
  const fileAssetPrefix = `file://${assetsDir.replace(/\\/g, "/")}/`;
  const standaloneHtml = detail.html.replace(
    new RegExp(`/api/thumbnails/${safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/assets/`, "g"),
    fileAssetPrefix
  );

  try {
    fs.writeFileSync(tmpHtml, standaloneHtml, "utf8");
    const candidates: string[] = [
      ...(process.env.CHROME_BIN ? [process.env.CHROME_BIN] : []),
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];
    const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dirEntry of pathEntries) {
      for (const binName of ["google-chrome", "chromium", "chromium-browser"]) {
        candidates.push(path.join(dirEntry, binName));
      }
    }
    const chromeBin = candidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (!chromeBin) {
      throw new Error("Headless Chromium/Chrome not found. Install chromium or re-run setup.sh.");
    }

    execFileSync(
      chromeBin,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=4000",
        `--screenshot=${tmpPng}`,
        `file://${tmpHtml}`,
      ],
      { timeout: 30_000, stdio: "pipe" }
    );

    if (!fs.existsSync(tmpPng)) {
      throw new Error("Headless Chrome did not produce a screenshot.");
    }

    let finalBytes: Buffer;
    if (format === "jpg") {
      execFileSync("ffmpeg", ["-y", "-i", tmpPng, "-q:v", "2", tmpJpg], {
        timeout: 15_000,
        stdio: "pipe",
      });
      finalBytes = fs.readFileSync(tmpJpg);
    } else {
      finalBytes = fs.readFileSync(tmpPng);
    }

    return saveThumbnailExportBytes(safe, finalBytes, format);
  } finally {
    for (const f of [tmpHtml, tmpPng, tmpJpg]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  }
}
