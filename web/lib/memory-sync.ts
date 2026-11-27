/**
 * 2-Way Creator Dossier (`~/.omp/agent/MEMORY.md`) <-> Neon Cloud Sync (`web/lib/memory-sync.ts`).
 *
 * - On boot: hydrates MEMORY.md from Neon (`studio_meta.creator_dossier_md`) if cloud has a
 *   non-blank dossier, so Sprite checkpoints/resets never wipe creator profile updates.
 * - If Neon has no dossier yet and local MEMORY.md is populated (not blank template), seeds Neon.
 * - Watches MEMORY.md for edits by Otto or Setup Wizard and debounced-syncs back to Neon.
 */

import fs from "node:fs";
import path from "node:path";
import { getStudioMeta, setStudioMeta } from "../../agent/lib/studio-db.ts";

const DOSSIER_META_KEY = "creator_dossier_md";

function getMemoryMdPath(): string {
  const home = process.env.HOME || "/home/sprite";
  return path.join(home, ".omp", "agent", "MEMORY.md");
}

function isBlankTemplate(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  // Blank MEMORY.md.example has `(not set)` placeholders for Name & Timezone
  return /\*\*Name \/ Persona:\*\*\s*\(not set\)/i.test(trimmed) && /\*\*Timezone:\*\*\s*\(not set\)/i.test(trimmed);
}

let lastSyncedContent = "";
let syncTimer: NodeJS.Timeout | null = null;
let watcherStarted = false;

export async function pushLocalMemoryMdToCloud(): Promise<boolean> {
  if (process.env.LMA_NO_CLOUD_MEMORY === "1") return false;
  const memPath = getMemoryMdPath();
  if (!fs.existsSync(memPath)) return false;
  const content = fs.readFileSync(memPath, "utf8");
  if (!content.trim() || isBlankTemplate(content) || content === lastSyncedContent) {
    return false;
  }
  await setStudioMeta(DOSSIER_META_KEY, content);
  lastSyncedContent = content;
  return true;
}

export async function initCloudMemoryMdSync(): Promise<void> {
  if (process.env.LMA_NO_CLOUD_MEMORY === "1") return;
  const memPath = getMemoryMdPath();

  try {
    const cloudContent = await getStudioMeta(DOSSIER_META_KEY);
    const localExists = fs.existsSync(memPath);
    const localContent = localExists ? fs.readFileSync(memPath, "utf8") : "";

    if (cloudContent && cloudContent.trim() && !isBlankTemplate(cloudContent)) {
      if (!localExists || isBlankTemplate(localContent) || localContent !== cloudContent) {
        fs.mkdirSync(path.dirname(memPath), { recursive: true });
        fs.writeFileSync(memPath, cloudContent, "utf8");
      }
      lastSyncedContent = cloudContent;
    } else if (localExists && !isBlankTemplate(localContent)) {
      await setStudioMeta(DOSSIER_META_KEY, localContent);
      lastSyncedContent = localContent;
    }
  } catch (err) {
    console.warn(
      "[memory-sync] Initial MEMORY.md cloud sync warning:",
      err instanceof Error ? err.message : String(err)
    );
  }

  if (watcherStarted) return;
  watcherStarted = true;

  try {
    const dir = path.dirname(memPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.watch(dir, (_event, filename) => {
      if (filename && String(filename) !== "MEMORY.md") return;
      clearTimeout(syncTimer ?? undefined);
      syncTimer = setTimeout(() => {
        void pushLocalMemoryMdToCloud().catch(() => {});
      }, 900);
    });
  } catch {
    // Non-fatal if fs.watch is unavailable
  }
}
