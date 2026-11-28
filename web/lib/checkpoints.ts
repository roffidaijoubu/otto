/**
 * Fly.io Sprites Time-Travel Checkpoints Service (`web/lib/checkpoints.ts`).
 *
 * Talks directly to the local Sprite API Unix socket (`/.sprite/api.sock`, zero API keys)
 * to list, create, and restore VM filesystem snapshots, plus optional daily 04:00 local-time
 * QStash auto-snapshots persisted in Neon (`studio_meta`).
 */

import { deleteStudioMeta, getStudioMeta, setStudioMeta } from "../../agent/lib/studio-db.ts";
import { extractIanaTimezone, resolveQStashGatewayUrl } from "../../agent/lib/qstash-cron.ts";

export interface SpriteCheckpointItem {
  id: string;
  createTime: string;
  comment: string;
  isAuto: boolean;
  isCurrent: boolean;
}

export interface AutoSnapshotConfig {
  enabled: boolean;
  timezone: string;
  cron: string | null;
  scheduleId: string | null;
}

function buildDaily04Cron(timezone: string): string {
  const tz = extractIanaTimezone(timezone || "UTC");
  return `CRON_TZ=${tz} 0 4 * * *`;
}

const ACTIVE_CHECKPOINT_META_KEY = "active_checkpoint_ref_v1";

interface ActiveCheckpointRef {
  id: string;
  at: string;
}

async function readActiveCheckpointRef(): Promise<ActiveCheckpointRef | null> {
  try {
    const raw = await getStudioMeta(ACTIVE_CHECKPOINT_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveCheckpointRef>;
    if (typeof parsed.id === "string" && /^v\d+$/.test(parsed.id) && typeof parsed.at === "string") {
      return { id: parsed.id, at: parsed.at };
    }
  } catch {
    // ignore malformed or unavailable DB in isolated tests
  }
  return null;
}

async function writeActiveCheckpointRef(id: string): Promise<void> {
  try {
    const ref: ActiveCheckpointRef = { id, at: new Date().toISOString() };
    await setStudioMeta(ACTIVE_CHECKPOINT_META_KEY, JSON.stringify(ref));
  } catch {
    // non-fatal if DB unavailable
  }
}

export async function listSpriteCheckpoints(): Promise<{
  available: boolean;
  checkpoints: SpriteCheckpointItem[];
  error?: string;
}> {
  try {
    const res = await fetch("http://sprite/v1/checkpoints", {
      unix: "/.sprite/api.sock",
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { available: false, checkpoints: [], error: `Sprites API returned HTTP ${res.status}` };
    }
    const raw = (await res.json()) as Array<{
      id?: string;
      create_time?: string;
      comment?: string;
      is_auto?: boolean;
      is_current?: boolean;
    }>;
    const list = Array.isArray(raw) ? raw : [];
    const currentRow = list.find((c) => c.id === "Current");
    const currentTime = currentRow?.create_time || "";

    const checkpoints: SpriteCheckpointItem[] = list
      .filter((c) => c.id && c.id !== "Current")
      .map((c) => ({
        id: String(c.id),
        createTime: String(c.create_time || ""),
        comment: String(c.comment || ""),
        isAuto: Boolean(c.is_auto),
        isCurrent: Boolean(c.is_current) || Boolean(currentTime && c.create_time === currentTime),
      }))
      .sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime));

    // Sprites API often omits a synthetic "Current" row or gives it wall-clock time; derive
    // current marker deterministically from stored active ref (create/restore) or latest snapshot.
    if (checkpoints.length > 0 && !checkpoints.some((c) => c.isCurrent)) {
      const ref = await readActiveCheckpointRef();
      const latestTs = Date.parse(checkpoints[0].createTime);
      const refTs = ref ? Date.parse(ref.at) : NaN;
      const refMatch =
        ref && (!Number.isFinite(latestTs) || !Number.isFinite(refTs) || latestTs <= refTs)
          ? checkpoints.find((c) => c.id === ref.id)
          : undefined;
      if (refMatch) {
        refMatch.isCurrent = true;
      } else {
        checkpoints[0].isCurrent = true;
      }
    }

    return { available: true, checkpoints };
  } catch (err) {
    return {
      available: false,
      checkpoints: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function parseCheckpointIdFromResponse(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Prefer structured JSON / NDJSON fields before falling back to prose regexes
  for (const line of trimmed.split(/\r?\n/)) {
    const candidateLine = line.trim();
    if (!candidateLine.startsWith("{")) continue;
    try {
      const obj = JSON.parse(candidateLine) as {
        id?: unknown;
        checkpoint_id?: unknown;
        checkpointId?: unknown;
        data?: { id?: unknown; checkpoint_id?: unknown };
      };
      const candidates = [
        obj.id,
        obj.checkpoint_id,
        obj.checkpointId,
        obj.data?.id,
        obj.data?.checkpoint_id,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && /^v\d+$/.test(c.trim())) {
          return c.trim();
        }
      }
    } catch {
      // fall through to regex parser
    }
  }

  // 2. Fallback to Fly Sprites human-readable stream / text responses
  const idMatch =
    trimmed.match(/Checkpoint\s+(v\d+)\s+created/i) ||
    trimmed.match(/\bID:\s*(v\d+)\b/i) ||
    trimmed.match(/"id"\s*:\s*"(v\d+)"/i);
  return idMatch ? idMatch[1] : null;
}

export async function createSpriteCheckpoint(comment = ""): Promise<{
  ok: boolean;
  id: string | null;
  comment: string;
  error?: string;
}> {
  const cleanComment = comment.trim().slice(0, 180) || `manual: snapshot ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  try {
    const res = await fetch("http://sprite/v1/checkpoint", {
      unix: "/.sprite/api.sock",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: cleanComment }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        id: null,
        comment: cleanComment,
        error: text.trim().slice(0, 220) || `Checkpoint creation failed (HTTP ${res.status})`,
      };
    }
    const parsedId = parseCheckpointIdFromResponse(text);
    if (!parsedId) {
      return {
        ok: false,
        id: null,
        comment: cleanComment,
        error: `Checkpoint API succeeded (HTTP ${res.status}) but returned no parseable checkpoint ID`,
      };
    }
    await writeActiveCheckpointRef(parsedId);
    return {
      ok: true,
      id: parsedId,
      comment: cleanComment,
    };
  } catch (err) {
    return {
      ok: false,
      id: null,
      comment: cleanComment,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function restoreSpriteCheckpoint(id: string): Promise<{
  ok: boolean;
  id: string;
  error?: string;
}> {
  const cleanId = id.trim();
  if (!/^v\d+$/.test(cleanId)) {
    throw new Error(`Invalid checkpoint ID: ${id}`);
  }
  const res = await fetch(`http://sprite/v1/checkpoints/${encodeURIComponent(cleanId)}/restore`, {
    unix: "/.sprite/api.sock",
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ok: false,
      id: cleanId,
      error: text.trim().slice(0, 220) || `Restore failed (HTTP ${res.status})`,
    };
  }
  await writeActiveCheckpointRef(cleanId);
  return { ok: true, id: cleanId };
}

export async function getAutoSnapshotConfig(fallbackTimezone = "UTC"): Promise<AutoSnapshotConfig> {
  const [enabled, tz, cron, scheduleId] = await Promise.all([
    getStudioMeta("auto_checkpoint_enabled"),
    getStudioMeta("auto_checkpoint_timezone"),
    getStudioMeta("auto_checkpoint_cron"),
    getStudioMeta("auto_checkpoint_qstash_id"),
  ]);
  return {
    enabled: enabled === "1",
    timezone: tz || fallbackTimezone || "UTC",
    cron,
    scheduleId,
  };
}

export async function configureAutoSnapshotSchedule(opts: {
  enabled: boolean;
  timezone: string;
}): Promise<{
  ok: boolean;
  armed: boolean;
  cron: string | null;
  scheduleId: string | null;
  note: string;
}> {
  const tz = extractIanaTimezone(opts.timezone || "UTC");
  const cron = buildDaily04Cron(tz);
  const existingId = await getStudioMeta("auto_checkpoint_qstash_id");
  const existingCron = await getStudioMeta("auto_checkpoint_cron");

  await setStudioMeta("auto_checkpoint_enabled", opts.enabled ? "1" : "0");
  await setStudioMeta("auto_checkpoint_timezone", tz);
  await setStudioMeta("auto_checkpoint_cron", cron);

  const gw = await resolveQStashGatewayUrl();
  const publicBase = process.env.LMA_PUBLIC_URL?.trim();

  if (!opts.enabled) {
    if (existingId && gw) {
      await fetch(`${gw}/v2/schedules/${encodeURIComponent(existingId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    await deleteStudioMeta("auto_checkpoint_qstash_id");
    return { ok: true, armed: false, cron, scheduleId: null, note: "Daily auto-snapshot paused." };
  }

  if (existingId && existingCron === cron) {
    return { ok: true, armed: true, cron, scheduleId: existingId, note: `Already armed (${cron}).` };
  }

  if (!gw || !publicBase) {
    return {
      ok: true,
      armed: false,
      cron,
      scheduleId: null,
      note: !gw
        ? "QStash connector not connected yet; preference saved."
        : "LMA_PUBLIC_URL not set; preference saved.",
    };
  }

  if (existingId) {
    await fetch(`${gw}/v2/schedules/${encodeURIComponent(existingId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
    await deleteStudioMeta("auto_checkpoint_qstash_id");
  }

  const targetUrl = `${publicBase.replace(/\/$/, "")}/api/wakeup`;
  const res = await fetch(`${gw}/v2/schedules/${encodeURIComponent(targetUrl)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Upstash-Cron": cron,
      "Upstash-Retries": "2",
    },
    body: JSON.stringify({
      label: "Daily Workspace Auto-Snapshot",
      mode: "checkpoint",
      silent: true,
      scheduledAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      armed: false,
      cron,
      scheduleId: null,
      note: `QStash schedule failed (${res.status}): ${errText.slice(0, 160)}`,
    };
  }

  const raw = (await res.json().catch(() => ({}))) as { scheduleId?: string };
  const scheduleId = typeof raw.scheduleId === "string" ? raw.scheduleId : null;
  if (scheduleId) {
    await setStudioMeta("auto_checkpoint_qstash_id", scheduleId);
  }
  return {
    ok: true,
    armed: Boolean(scheduleId),
    cron,
    scheduleId,
    note: `Armed daily 04:00 auto-snapshot (${cron}).`,
  };
}

export async function runScheduledAutoSnapshot(): Promise<{
  ok: boolean;
  id: string | null;
  comment: string;
  error?: string;
}> {
  const dateStr = new Date().toISOString().slice(0, 10);
  return createSpriteCheckpoint(`auto: daily workspace snapshot (${dateStr})`);
}
