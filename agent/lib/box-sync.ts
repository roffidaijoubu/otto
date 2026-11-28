/**
 * Incremental Workspace <-> Box Sync Engine.
 * - Pulls Box `Otto Assets/` -> `/home/sprite/workspace/assets/` (incremental via size + modifiedAt)
 * - Pushes `/home/sprite/workspace/{briefs,scripts,thumbnails,clips}/` (<= 48 MiB) -> Box `Otto Handoffs/`
 * - Tracks skipped >48 MiB files so Studio Files can flag them as "Local only (>48 MB)"
 */

import fs from "node:fs";
import path from "node:path";
import {
  BOX_HANDOFF_ROOT_NAME,
  BOX_MAX_UPLOAD_BYTES,
  downloadBoxFileToLocal,
  ensureBoxAssetsFolder,
  ensureBoxFolder,
  ensureBoxPath,
  listBoxFolder,
  resolveBoxGatewayUrl,
  uploadLocalFileToBox,
} from "./box.ts";

const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(HOME_DIR, "workspace");
const CONFIG_DIR = path.join(HOME_DIR, ".config", "lma");
const SYNC_STATE_PATH = path.join(CONFIG_DIR, "box-sync-state.json");

const PUSH_DIRS = ["briefs", "scripts", "thumbnails", "clips"] as const;

interface SyncedFileRecord {
  boxId?: string;
  size: number;
  modifiedAt?: string;
  mtimeMs?: number;
}

interface PersistedSyncState {
  pulled: Record<string, SyncedFileRecord>;
  pushed: Record<string, SyncedFileRecord>;
  lastSyncedAt: string | null;
}

export interface BoxSyncSummary {
  connected: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  pulledCount: number;
  pushedCount: number;
  skippedUnchanged: number;
  skippedOversize: Array<{ relPath: string; sizeBytes: number }>;
  lastError: string | null;
}

let activeSyncPromise: Promise<BoxSyncSummary> | null = null;
let lastSummary: BoxSyncSummary = {
  connected: false,
  syncing: false,
  lastSyncedAt: null,
  pulledCount: 0,
  pushedCount: 0,
  skippedUnchanged: 0,
  skippedOversize: [],
  lastError: null,
};

function readSyncState(): PersistedSyncState {
  if (!fs.existsSync(SYNC_STATE_PATH)) {
    return { pulled: {}, pushed: {}, lastSyncedAt: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, "utf8")) as Partial<PersistedSyncState>;
    return {
      pulled: raw.pulled && typeof raw.pulled === "object" ? raw.pulled : {},
      pushed: raw.pushed && typeof raw.pushed === "object" ? raw.pushed : {},
      lastSyncedAt: typeof raw.lastSyncedAt === "string" ? raw.lastSyncedAt : null,
    };
  } catch {
    return { pulled: {}, pushed: {}, lastSyncedAt: null };
  }
}

function saveSyncState(state: PersistedSyncState): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${SYNC_STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, SYNC_STATE_PATH);
}

export async function getBoxSyncStatus(): Promise<BoxSyncSummary> {
  const gw = await resolveBoxGatewayUrl();
  const persisted = readSyncState();
  return {
    ...lastSummary,
    connected: Boolean(gw),
    syncing: Boolean(activeSyncPromise),
    lastSyncedAt: lastSummary.lastSyncedAt || persisted.lastSyncedAt,
  };
}

export async function syncWorkspaceWithBox(): Promise<BoxSyncSummary> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async () => {
    const gw = await resolveBoxGatewayUrl();
    if (!gw) {
      lastSummary = {
        ...lastSummary,
        connected: false,
        syncing: false,
        lastError: "Box connector is not connected.",
      };
      return lastSummary;
    }

    lastSummary = { ...lastSummary, connected: true, syncing: true, lastError: null };
    const state = readSyncState();
    let pulledCount = 0;
    let pushedCount = 0;
    let skippedUnchanged = 0;
    const skippedOversize: Array<{ relPath: string; sizeBytes: number }> = [];

    try {
      // 1. PULL: Box `Otto Assets/` -> `/home/sprite/workspace/assets/`
      const assetsRoot = await ensureBoxAssetsFolder();
      const localAssetsRoot = path.join(WORKSPACE_ROOT, "assets");
      fs.mkdirSync(localAssetsRoot, { recursive: true });

      function resolveCaseMatchedDir(parentDir: string, folderName: string): string {
        const direct = path.join(parentDir, folderName);
        if (fs.existsSync(direct)) return direct;
        try {
          const lower = folderName.toLowerCase();
          for (const existing of fs.readdirSync(parentDir, { withFileTypes: true })) {
            if (existing.isDirectory() && existing.name.toLowerCase() === lower) {
              return path.join(parentDir, existing.name);
            }
          }
        } catch {
          // ignore
        }
        return direct;
      }

      async function pullFolder(boxFolderId: string, relPrefix: string, localDir: string): Promise<void> {
        const entries = await listBoxFolder(boxFolderId, 200);
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          if (entry.type === "folder") {
            const nextDir = resolveCaseMatchedDir(localDir, entry.name);
            fs.mkdirSync(nextDir, { recursive: true });
            await pullFolder(entry.id, relPath, nextDir);
          } else if (entry.type === "file") {
            const localAbs = path.join(localDir, entry.name);
            const size = entry.size ?? 0;
            if (size > BOX_MAX_UPLOAD_BYTES) {
              skippedOversize.push({ relPath: `assets/${relPath}`, sizeBytes: size });
              continue;
            }
            const prev = state.pulled[relPath];
            if (
              prev &&
              fs.existsSync(localAbs) &&
              prev.boxId === entry.id &&
              prev.size === size &&
              prev.modifiedAt === entry.modifiedAt
            ) {
              skippedUnchanged += 1;
              continue;
            }
            await downloadBoxFileToLocal(entry.id, localAbs);
            state.pulled[relPath] = {
              boxId: entry.id,
              size,
              modifiedAt: entry.modifiedAt,
            };
            pulledCount += 1;
          }
        }
      }

      await pullFolder(assetsRoot.id, "", localAssetsRoot);

      // 2. PUSH: `/home/sprite/workspace/{briefs,scripts,thumbnails,clips}/` (<= 48 MiB) -> Box `Otto Handoffs/`
      const handoffRoot = await ensureBoxPath([BOX_HANDOFF_ROOT_NAME]);

      async function pushDir(localDir: string, boxParentId: string, relPrefix: string): Promise<void> {
        if (!fs.existsSync(localDir)) return;
        const entries = fs.readdirSync(localDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
          const childAbs = path.join(localDir, entry.name);
          const relPath = `${relPrefix}/${entry.name}`;
          if (entry.isDirectory()) {
            const subFiles = fs.readdirSync(childAbs).filter((n) => !n.startsWith("."));
            if (subFiles.length === 0) continue;
            const subBox = await ensureBoxFolder(boxParentId, entry.name);
            await pushDir(childAbs, subBox.id, relPath);
          } else if (entry.isFile()) {
            const st = fs.statSync(childAbs);
            if (st.size > BOX_MAX_UPLOAD_BYTES) {
              skippedOversize.push({ relPath, sizeBytes: st.size });
              continue;
            }
            const prev = state.pushed[relPath];
            if (prev && prev.size === st.size && prev.mtimeMs === Math.floor(st.mtimeMs)) {
              skippedUnchanged += 1;
              continue;
            }
            const uploaded = await uploadLocalFileToBox(childAbs, boxParentId, entry.name);
            state.pushed[relPath] = {
              boxId: uploaded.id,
              size: st.size,
              mtimeMs: Math.floor(st.mtimeMs),
            };
            pushedCount += 1;
          }
        }
      }

      for (const dirName of PUSH_DIRS) {
        const localDir = path.join(WORKSPACE_ROOT, dirName);
        if (!fs.existsSync(localDir)) continue;
        const nonHidden = fs.readdirSync(localDir).filter((n) => !n.startsWith("."));
        if (nonHidden.length === 0) continue;
        const boxSub = await ensureBoxFolder(handoffRoot.id, dirName);
        await pushDir(localDir, boxSub.id, dirName);
      }

      const now = new Date().toISOString();
      state.lastSyncedAt = now;
      saveSyncState(state);

      lastSummary = {
        connected: true,
        syncing: false,
        lastSyncedAt: now,
        pulledCount,
        pushedCount,
        skippedUnchanged,
        skippedOversize,
        lastError: null,
      };
      return lastSummary;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastSummary = {
        connected: true,
        syncing: false,
        lastSyncedAt: state.lastSyncedAt,
        pulledCount,
        pushedCount,
        skippedUnchanged,
        skippedOversize,
        lastError: msg,
      };
      return lastSummary;
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
