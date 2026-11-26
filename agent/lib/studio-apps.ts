import fs from "node:fs";
import path from "node:path";

const HOME_DIR = process.env.HOME || "/home/sprite";
export const STUDIO_APPS_ROOT = path.resolve(
  process.env.LMA_STUDIO_APPS_DIR || path.join(HOME_DIR, ".omp", "agent", "studio-apps")
);

export const MAX_APP_CODE_BYTES = 1024 * 1024; // 1 MB source cap
export const MAX_APP_STATE_BYTES = 256 * 1024; // 256 KB persistent state cap

export type CustomStudioAppKind = "react" | "html" | "svg";

export interface CustomStudioAppMeta {
  slug: string;
  title: string;
  description: string;
  kind: CustomStudioAppKind;
  entryFile: string;
  icon: string;
  defaultWidth: number;
  defaultHeight: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomStudioAppFull {
  meta: CustomStudioAppMeta;
  code: string;
  state: Record<string, unknown>;
}

export function ensureStudioAppsRoot(): void {
  fs.mkdirSync(STUDIO_APPS_ROOT, { recursive: true });
}

export function sanitizeAppSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!cleaned || !/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
    throw new Error("Invalid studio app slug. Use lowercase letters, numbers, and hyphens.");
  }
  return cleaned;
}

function resolveAppDir(slug: string): string {
  ensureStudioAppsRoot();
  const safeSlug = sanitizeAppSlug(slug);
  const rootReal = fs.realpathSync(STUDIO_APPS_ROOT);
  const dir = path.resolve(rootReal, safeSlug);
  if (!dir.startsWith(rootReal + path.sep)) {
    throw new Error("App path escapes studio-apps root");
  }
  return dir;
}

function atomicWriteFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function entryFileForKind(kind: CustomStudioAppKind): string {
  if (kind === "react") return "app.jsx";
  if (kind === "svg") return "app.svg";
  return "app.html";
}

export function listCustomStudioApps(): CustomStudioAppMeta[] {
  ensureStudioAppsRoot();
  const entries = fs.readdirSync(STUDIO_APPS_ROOT, { withFileTypes: true });
  const apps: CustomStudioAppMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const metaPath = path.join(STUDIO_APPS_ROOT, entry.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as CustomStudioAppMeta;
      if (parsed && parsed.slug && parsed.title) {
        apps.push(parsed);
      }
    } catch {
      // skip corrupted metadata
    }
  }
  apps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return apps;
}

export function getCustomStudioApp(slug: string): CustomStudioAppFull | null {
  const dir = resolveAppDir(slug);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as CustomStudioAppMeta;
  const entryPath = path.join(dir, meta.entryFile || entryFileForKind(meta.kind));
  const code = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, "utf8") : "";
  const statePath = path.join(dir, "state.json");
  let state: Record<string, unknown> = {};
  if (fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        state = parsed as Record<string, unknown>;
      }
    } catch {
      state = {};
    }
  }
  return { meta, code, state };
}

export function saveCustomStudioApp(input: {
  slug: string;
  title: string;
  description?: string;
  kind?: CustomStudioAppKind;
  code: string;
  icon?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  initialState?: Record<string, unknown>;
}): CustomStudioAppMeta {
  const safeSlug = sanitizeAppSlug(input.slug);
  if (Buffer.byteLength(input.code, "utf8") > MAX_APP_CODE_BYTES) {
    throw new Error("App source exceeds 1 MB limit");
  }
  const dir = resolveAppDir(safeSlug);
  fs.mkdirSync(dir, { recursive: true });

  const existing = getCustomStudioApp(safeSlug);
  const now = new Date().toISOString();
  const kind: CustomStudioAppKind =
    input.kind === "html" || input.kind === "svg" || input.kind === "react"
      ? input.kind
      : existing?.meta.kind || "react";
  const entryFile = entryFileForKind(kind);

  const meta: CustomStudioAppMeta = {
    slug: safeSlug,
    title: (input.title || existing?.meta.title || safeSlug).trim().slice(0, 80),
    description: (input.description ?? existing?.meta.description ?? "").trim().slice(0, 220),
    kind,
    entryFile,
    icon: (input.icon || existing?.meta.icon || "app").trim().slice(0, 32),
    defaultWidth: Math.max(420, Math.min(1200, Math.round(input.defaultWidth ?? existing?.meta.defaultWidth ?? 680))),
    defaultHeight: Math.max(360, Math.min(900, Math.round(input.defaultHeight ?? existing?.meta.defaultHeight ?? 580))),
    createdAt: existing?.meta.createdAt || now,
    updatedAt: now,
  };

  // Remove old entry file if kind changed
  if (existing && existing.meta.entryFile !== entryFile) {
    const oldEntry = path.join(dir, existing.meta.entryFile);
    if (fs.existsSync(oldEntry)) fs.rmSync(oldEntry, { force: true });
  }

  atomicWriteFile(path.join(dir, entryFile), input.code);
  atomicWriteFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  const statePath = path.join(dir, "state.json");
  if (input.initialState && typeof input.initialState === "object" && !Array.isArray(input.initialState)) {
    if (!fs.existsSync(statePath)) {
      const stateJson = JSON.stringify(input.initialState, null, 2);
      if (Buffer.byteLength(stateJson, "utf8") <= MAX_APP_STATE_BYTES) {
        atomicWriteFile(statePath, stateJson);
      }
    }
  } else if (!fs.existsSync(statePath)) {
    atomicWriteFile(statePath, "{}");
  }

  return meta;
}

export function updateCustomStudioAppCode(slug: string, code: string): CustomStudioAppMeta {
  const existing = getCustomStudioApp(slug);
  if (!existing) throw new Error(`Studio app '${slug}' not found`);
  return saveCustomStudioApp({
    slug: existing.meta.slug,
    title: existing.meta.title,
    description: existing.meta.description,
    kind: existing.meta.kind,
    code,
    icon: existing.meta.icon,
    defaultWidth: existing.meta.defaultWidth,
    defaultHeight: existing.meta.defaultHeight,
  });
}

export function getCustomStudioAppState(slug: string): Record<string, unknown> {
  const existing = getCustomStudioApp(slug);
  if (!existing) throw new Error(`Studio app '${slug}' not found`);
  return existing.state;
}

export function saveCustomStudioAppState(
  slug: string,
  state: Record<string, unknown>
): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("App state must be a JSON object");
  }
  const dir = resolveAppDir(slug);
  if (!fs.existsSync(path.join(dir, "meta.json"))) {
    throw new Error(`Studio app '${slug}' not found`);
  }
  const serialized = JSON.stringify(state, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_APP_STATE_BYTES) {
    throw new Error("App state exceeds 256 KB limit");
  }
  atomicWriteFile(path.join(dir, "state.json"), serialized);
  return state;
}

export function deleteCustomStudioApp(slug: string): boolean {
  const dir = resolveAppDir(slug);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
