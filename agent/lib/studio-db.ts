import { Database } from "bun:sqlite";
import type { SQL } from "bun";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getNeonRuntimeInfo, getNeonSql, type NeonRuntimeInfo } from "./neon-db.ts";

export type CalendarEventType = "stream" | "collab" | "upload" | "reminder" | "deadline";

export interface CalendarWakeupHook {
  qstashId: string;
  kind: "one_shot" | "recurring_cron";
  label: string;
  triggerAt: string | null;
  cron: string | null;
  offsetMinutes: number | null;
  prompt: string;
  status: "armed" | "cancelled";
}

export interface CalendarEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  startAt: string;
  endAt: string | null;
  cron: string | null;
  notes: string;
  status: "planned" | "done" | "cancelled";
  source?: "local" | "google";
  googleEventId?: string | null;
  googleHtmlLink?: string | null;
  wakeups: CalendarWakeupHook[];
  createdAt: string;
  updatedAt: string;
}

export type PipelineFormat = "stream" | "video" | "short" | "collab";
export type PipelineStatus =
  | "idea"
  | "prepping"
  | "scheduled"
  | "live"
  | "editing"
  | "published"
  | "dropped";

export interface ContentPipelineItem {
  id: string;
  title: string;
  format: PipelineFormat;
  status: PipelineStatus;
  hook: string;
  thumbnailPath: string;
  scriptPath: string;
  scheduledFor: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ContactRole =
  | "artist"
  | "clipper"
  | "editor"
  | "rigger"
  | "collab"
  | "sponsor"
  | "mod";
export type ContactStatus = "prospect" | "pitched" | "active" | "paused";

export interface StudioContact {
  id: string;
  name: string;
  role: ContactRole;
  handle: string;
  platform: string;
  status: ContactStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMetric {
  id: string;
  recordedAt: string;
  platform: string;
  subscribers: number | null;
  totalViews: number | null;
  avgCcv: number | null;
  avgCtr: number | null;
  notes: string;
  createdAt: string;
}

export type ClipJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface ClipJobLogEntry {
  at: string;
  stage: string;
  message: string;
}

export interface ClipJob {
  id: string;
  vodUrl: string;
  videoId: string;
  title: string;
  maxClips: number;
  focusNotes: string;
  status: ClipJobStatus;
  stage: string;
  progressLog: ClipJobLogEntry[];
  error: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ClipRecordStatus = "ready" | "sent_to_box" | "archived";

export interface ClipRecord {
  id: string;
  jobId: string | null;
  videoId: string;
  title: string;
  filePath: string;
  srtPath: string;
  startSec: number | null;
  endSec: number | null;
  durationSec: number | null;
  hookScore: number | null;
  editorNotes: string;
  youtubeUrl: string;
  boxUrl: string;
  status: ClipRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export type ArchiveVideoStatus = "pending" | "indexing" | "indexed" | "no_captions" | "failed";
export type ArchiveContentType = "video" | "live" | "short";

export interface ArchiveVideoRecord {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  contentType: ArchiveContentType;
  status: ArchiveVideoStatus;
  chunkCount: number;
  lang: string;
  error: string;
  indexedAt: string | null;
  updatedAt: string;
}

export interface ArchiveStats {
  totalTracked: number;
  indexedVideos: number;
  noCaptionsVideos: number;
  failedVideos: number;
  pendingVideos: number;
  totalChunks: number;
}

export type StudioMemoryCategory =
  | "preference"
  | "decision"
  | "workflow"
  | "team"
  | "content"
  | "opsec"
  | "general";

export interface StudioMemory {
  id: string;
  category: StudioMemoryCategory;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Dual Backend Driver (Neon Serverless Postgres Primary + SQLite Fallback) ----------

type SqlParam = string | number | boolean | null;

interface DbDriver {
  backend: "neon" | "sqlite";
  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T | null>;
  run(sql: string, ...params: SqlParam[]): Promise<{ changes: number }>;
}

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'stream',
    start_at TEXT NOT NULL,
    end_at TEXT,
    cron TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned',
    source TEXT NOT NULL DEFAULT 'local',
    google_event_id TEXT,
    google_html_link TEXT,
    wakeups_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_at)`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_google ON calendar_events(google_event_id)`,
  `CREATE TABLE IF NOT EXISTS content_pipeline (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'stream',
    status TEXT NOT NULL DEFAULT 'idea',
    hook TEXT NOT NULL DEFAULT '',
    thumbnail_path TEXT NOT NULL DEFAULT '',
    script_path TEXT NOT NULL DEFAULT '',
    scheduled_for TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_status ON content_pipeline(status)`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'collab',
    handle TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS channel_metrics (
    id TEXT PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'youtube',
    subscribers INTEGER,
    total_views INTEGER,
    avg_ccv INTEGER,
    avg_ctr DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON channel_metrics(recorded_at DESC)`,
  `CREATE TABLE IF NOT EXISTS studio_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clip_jobs (
    id TEXT PRIMARY KEY,
    vod_url TEXT NOT NULL,
    video_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    max_clips INTEGER NOT NULL DEFAULT 3,
    focus_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'Queued',
    progress_log TEXT NOT NULL DEFAULT '[]',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clip_jobs_created ON clip_jobs(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS archive_videos (
    video_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT 0,
    content_type TEXT NOT NULL DEFAULT 'video',
    status TEXT NOT NULL DEFAULT 'pending',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    indexed_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_archive_videos_status ON archive_videos(status)`,
  `CREATE INDEX IF NOT EXISTS idx_archive_videos_published ON archive_videos(published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    video_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    srt_path TEXT NOT NULL DEFAULT '',
    start_sec INTEGER,
    end_sec INTEGER,
    duration_sec INTEGER,
    hook_score INTEGER,
    editor_notes TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL DEFAULT '',
    box_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_job ON clips(job_id)`,
  `CREATE TABLE IF NOT EXISTS studio_memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'otto',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_studio_memories_updated ON studio_memories(updated_at DESC)`,
];

function convertPlaceholdersToPg(sql: string): string {
  let out = "";
  let idx = 1;
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingle && sql[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (!inSingle && ch === "?") {
      out += `$${idx++}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function createPgDriver(pg: SQL): DbDriver {
  return {
    backend: "neon",
    async all<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
      const rows = await pg.unsafe(convertPlaceholdersToPg(sql), params);
      return Array.from(rows) as T[];
    },
    async get<T>(sql: string, ...params: SqlParam[]): Promise<T | null> {
      const rows = await pg.unsafe(convertPlaceholdersToPg(sql), params);
      return rows.length > 0 ? (rows[0] as T) : null;
    },
    async run(sql: string, ...params: SqlParam[]): Promise<{ changes: number }> {
      const res = (await pg.unsafe(convertPlaceholdersToPg(sql), params)) as unknown as {
        count?: number;
        length?: number;
      };
      const changes = typeof res.count === "number" ? res.count : Number(res.length ?? 0);
      return { changes };
    },
  };
}

let sqliteInstance: Database | null = null;
let sqliteInstancePath: string | null = null;

export function getStudioDbPath(): string {
  const home = process.env.HOME || "/home/sprite";
  return path.join(home, ".omp", "agent", "studio.db");
}

function getSqliteFallback(): Database {
  const dbPath = getStudioDbPath();
  if (sqliteInstance && sqliteInstancePath === dbPath && fs.existsSync(dbPath)) {
    return sqliteInstance;
  }
  if (sqliteInstance) {
    try {
      sqliteInstance.close();
    } catch {
      // ignore
    }
    sqliteInstance = null;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  for (const stmt of SCHEMA_STATEMENTS) {
    db.exec(stmt.replace(/DOUBLE PRECISION/g, "REAL"));
  }
  sqliteInstance = db;
  sqliteInstancePath = dbPath;
  return db;
}

function createSqliteDriver(db: Database): DbDriver {
  return {
    backend: "sqlite",
    async all<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
      return db.query(sql).all(...params) as T[];
    },
    async get<T>(sql: string, ...params: SqlParam[]): Promise<T | null> {
      return (db.query(sql).get(...params) as T | null) ?? null;
    },
    async run(sql: string, ...params: SqlParam[]): Promise<{ changes: number }> {
      const res = db.prepare(sql).run(...params);
      return { changes: res.changes };
    },
  };
}

let driverPromise: Promise<DbDriver> | null = null;

async function initDriver(): Promise<DbDriver> {
  const pg = await getNeonSql();
  if (pg) {
    for (const stmt of SCHEMA_STATEMENTS) {
      await pg.unsafe(stmt);
    }
    return createPgDriver(pg);
  }
  return createSqliteDriver(getSqliteFallback());
}

async function getDb(): Promise<DbDriver> {
  if (!driverPromise) {
    driverPromise = initDriver().catch((err) => {
      driverPromise = null;
      throw err;
    });
  }
  return driverPromise;
}

export function getStudioDbBackendInfo(): NeonRuntimeInfo {
  return getNeonRuntimeInfo();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- Calendar Events ----------

interface CalendarRow {
  id: string;
  title: string;
  type: CalendarEventType;
  start_at: string;
  end_at: string | null;
  cron: string | null;
  notes: string;
  status: "planned" | "done" | "cancelled";
  source: "local" | "google";
  google_event_id: string | null;
  google_html_link: string | null;
  wakeups_json: string;
  created_at: string;
  updated_at: string;
}

function mapCalendarRow(r: CalendarRow): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    startAt: r.start_at,
    endAt: r.end_at,
    cron: r.cron,
    notes: r.notes,
    status: r.status,
    source: r.source || "local",
    googleEventId: r.google_event_id,
    googleHtmlLink: r.google_html_link,
    wakeups: safeJsonParse<CalendarWakeupHook[]>(r.wakeups_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  const db = await getDb();
  const rows = await db.all<CalendarRow>("SELECT * FROM calendar_events ORDER BY start_at ASC");
  return rows.map(mapCalendarRow);
}

export async function getCalendarEventById(id: string): Promise<CalendarEvent | null> {
  const db = await getDb();
  const row = await db.get<CalendarRow>("SELECT * FROM calendar_events WHERE id = ?", id);
  return row ? mapCalendarRow(row) : null;
}

export async function getCalendarEventByGoogleId(googleEventId: string): Promise<CalendarEvent | null> {
  const db = await getDb();
  const row = await db.get<CalendarRow>(
    "SELECT * FROM calendar_events WHERE google_event_id = ?",
    googleEventId
  );
  return row ? mapCalendarRow(row) : null;
}

export async function upsertCalendarEvent(evt: CalendarEvent): Promise<CalendarEvent> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const normalized: CalendarEvent = {
    ...evt,
    source: evt.source || "local",
    googleEventId: evt.googleEventId ?? null,
    googleHtmlLink: evt.googleHtmlLink ?? null,
    wakeups: Array.isArray(evt.wakeups) ? evt.wakeups : [],
    createdAt: evt.createdAt || nowIso,
    updatedAt: evt.updatedAt || nowIso,
  };
  await db.run(
    `INSERT INTO calendar_events (
      id, title, type, start_at, end_at, cron, notes, status, source,
      google_event_id, google_html_link, wakeups_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      cron = excluded.cron,
      notes = excluded.notes,
      status = excluded.status,
      source = excluded.source,
      google_event_id = excluded.google_event_id,
      google_html_link = excluded.google_html_link,
      wakeups_json = excluded.wakeups_json,
      updated_at = excluded.updated_at`,
    normalized.id,
    normalized.title,
    normalized.type,
    normalized.startAt,
    normalized.endAt,
    normalized.cron,
    normalized.notes,
    normalized.status,
    normalized.source ?? "local",
    normalized.googleEventId ?? null,
    normalized.googleHtmlLink ?? null,
    JSON.stringify(normalized.wakeups),
    normalized.createdAt,
    normalized.updatedAt
  );
  return normalized;
}

export async function saveCalendarEventsBatch(events: CalendarEvent[]): Promise<void> {
  for (const evt of events) {
    await upsertCalendarEvent(evt);
  }
}

// ---------- Content Pipeline ----------

interface PipelineRow {
  id: string;
  title: string;
  format: PipelineFormat;
  status: PipelineStatus;
  hook: string;
  thumbnail_path: string;
  script_path: string;
  scheduled_for: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function mapPipelineRow(r: PipelineRow): ContentPipelineItem {
  return {
    id: r.id,
    title: r.title,
    format: r.format,
    status: r.status,
    hook: r.hook,
    thumbnailPath: r.thumbnail_path,
    scriptPath: r.script_path,
    scheduledFor: r.scheduled_for,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listPipelineItems(filters?: {
  status?: string;
  format?: string;
}): Promise<ContentPipelineItem[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters?.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.format) {
    clauses.push("format = ?");
    params.push(filters.format);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all<PipelineRow>(
    `SELECT * FROM content_pipeline ${where} ORDER BY updated_at DESC`,
    ...params
  );
  return rows.map(mapPipelineRow);
}

export async function getPipelineItemById(id: string): Promise<ContentPipelineItem | null> {
  const db = await getDb();
  const row = await db.get<PipelineRow>("SELECT * FROM content_pipeline WHERE id = ?", id);
  return row ? mapPipelineRow(row) : null;
}

export async function upsertPipelineItem(input: {
  id?: string;
  title?: string;
  format?: PipelineFormat;
  status?: PipelineStatus;
  hook?: string;
  thumbnailPath?: string;
  scriptPath?: string;
  scheduledFor?: string | null;
  notes?: string;
}): Promise<ContentPipelineItem> {
  const db = await getDb();
  const existing = input.id ? await getPipelineItemById(input.id) : null;
  const nowIso = new Date().toISOString();
  const title = (input.title ?? existing?.title ?? "").trim();
  if (!title) throw new Error("Pipeline item title is required");

  const item: ContentPipelineItem = {
    id: existing?.id || input.id || makeId("idea"),
    title,
    format: input.format ?? existing?.format ?? "stream",
    status: input.status ?? existing?.status ?? "idea",
    hook: input.hook ?? existing?.hook ?? "",
    thumbnailPath: input.thumbnailPath ?? existing?.thumbnailPath ?? "",
    scriptPath: input.scriptPath ?? existing?.scriptPath ?? "",
    scheduledFor: input.scheduledFor !== undefined ? input.scheduledFor : (existing?.scheduledFor ?? null),
    notes: input.notes ?? existing?.notes ?? "",
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  await db.run(
    `INSERT INTO content_pipeline (
      id, title, format, status, hook, thumbnail_path, script_path,
      scheduled_for, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      format = excluded.format,
      status = excluded.status,
      hook = excluded.hook,
      thumbnail_path = excluded.thumbnail_path,
      script_path = excluded.script_path,
      scheduled_for = excluded.scheduled_for,
      notes = excluded.notes,
      updated_at = excluded.updated_at`,
    item.id,
    item.title,
    item.format,
    item.status,
    item.hook,
    item.thumbnailPath,
    item.scriptPath,
    item.scheduledFor,
    item.notes,
    item.createdAt,
    item.updatedAt
  );
  return item;
}

export async function deletePipelineItem(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM content_pipeline WHERE id = ?", id);
  return res.changes > 0;
}

// ---------- Contacts (Artists / Clippers / Collabs / Sponsors) ----------

interface ContactRow {
  id: string;
  name: string;
  role: ContactRole;
  handle: string;
  platform: string;
  status: ContactStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

function mapContactRow(r: ContactRow): StudioContact {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    handle: r.handle,
    platform: r.platform,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listContacts(filters?: { role?: string; status?: string }): Promise<StudioContact[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters?.role) {
    clauses.push("role = ?");
    params.push(filters.role);
  }
  if (filters?.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.all<ContactRow>(
    `SELECT * FROM contacts ${where} ORDER BY updated_at DESC`,
    ...params
  );
  return rows.map(mapContactRow);
}

export async function getContactById(id: string): Promise<StudioContact | null> {
  const db = await getDb();
  const row = await db.get<ContactRow>("SELECT * FROM contacts WHERE id = ?", id);
  return row ? mapContactRow(row) : null;
}

export async function upsertContact(input: {
  id?: string;
  name?: string;
  role?: ContactRole;
  handle?: string;
  platform?: string;
  status?: ContactStatus;
  notes?: string;
}): Promise<StudioContact> {
  const db = await getDb();
  const existing = input.id ? await getContactById(input.id) : null;
  const nowIso = new Date().toISOString();
  const name = (input.name ?? existing?.name ?? "").trim();
  if (!name) throw new Error("Contact name is required");

  const item: StudioContact = {
    id: existing?.id || input.id || makeId("ctc"),
    name,
    role: input.role ?? existing?.role ?? "collab",
    handle: input.handle ?? existing?.handle ?? "",
    platform: input.platform ?? existing?.platform ?? "",
    status: input.status ?? existing?.status ?? "active",
    notes: input.notes ?? existing?.notes ?? "",
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  await db.run(
    `INSERT INTO contacts (
      id, name, role, handle, platform, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      handle = excluded.handle,
      platform = excluded.platform,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at`,
    item.id,
    item.name,
    item.role,
    item.handle,
    item.platform,
    item.status,
    item.notes,
    item.createdAt,
    item.updatedAt
  );
  return item;
}

export async function deleteContact(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM contacts WHERE id = ?", id);
  return res.changes > 0;
}

// ---------- Channel Metrics ----------

interface MetricRow {
  id: string;
  recorded_at: string;
  platform: string;
  subscribers: number | string | null;
  total_views: number | string | null;
  avg_ccv: number | string | null;
  avg_ctr: number | string | null;
  notes: string;
  created_at: string;
}

function mapMetricRow(r: MetricRow): ChannelMetric {
  return {
    id: r.id,
    recordedAt: r.recorded_at,
    platform: r.platform,
    subscribers: toNullableNumber(r.subscribers),
    totalViews: toNullableNumber(r.total_views),
    avgCcv: toNullableNumber(r.avg_ccv),
    avgCtr: toNullableNumber(r.avg_ctr),
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export async function listChannelMetrics(limit = 50): Promise<ChannelMetric[]> {
  const db = await getDb();
  const rows = await db.all<MetricRow>(
    "SELECT * FROM channel_metrics ORDER BY recorded_at DESC, created_at DESC LIMIT ?",
    Math.max(1, Math.min(200, limit))
  );
  return rows.map(mapMetricRow);
}

export async function addChannelMetric(input: {
  recordedAt?: string;
  platform?: string;
  subscribers?: number | null;
  totalViews?: number | null;
  avgCcv?: number | null;
  avgCtr?: number | null;
  notes?: string;
}): Promise<ChannelMetric> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const item: ChannelMetric = {
    id: makeId("met"),
    recordedAt: (input.recordedAt || nowIso.slice(0, 10)).trim(),
    platform: (input.platform || "youtube").trim().toLowerCase(),
    subscribers: typeof input.subscribers === "number" && Number.isFinite(input.subscribers) ? Math.round(input.subscribers) : null,
    totalViews: typeof input.totalViews === "number" && Number.isFinite(input.totalViews) ? Math.round(input.totalViews) : null,
    avgCcv: typeof input.avgCcv === "number" && Number.isFinite(input.avgCcv) ? Math.round(input.avgCcv) : null,
    avgCtr: typeof input.avgCtr === "number" && Number.isFinite(input.avgCtr) ? Number(input.avgCtr) : null,
    notes: (input.notes || "").trim(),
    createdAt: nowIso,
  };

  await db.run(
    `INSERT INTO channel_metrics (
      id, recorded_at, platform, subscribers, total_views, avg_ccv, avg_ctr, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.recordedAt,
    item.platform,
    item.subscribers,
    item.totalViews,
    item.avgCcv,
    item.avgCtr,
    item.notes,
    item.createdAt
  );
  return item;
}

export async function deleteChannelMetric(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM channel_metrics WHERE id = ?", id);
  return res.changes > 0;
}

export async function upsertDailyChannelMetric(input: {
  recordedAt?: string;
  platform?: string;
  subscribers?: number | null;
  totalViews?: number | null;
  avgCcv?: number | null;
  avgCtr?: number | null;
  notes?: string;
}): Promise<ChannelMetric> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const recordedAt = (input.recordedAt || nowIso.slice(0, 10)).trim();
  const platform = (input.platform || "youtube").trim().toLowerCase();
  const existing = await db.get<MetricRow>(
    "SELECT * FROM channel_metrics WHERE recorded_at = ? AND platform = ? ORDER BY created_at DESC LIMIT 1",
    recordedAt,
    platform
  );

  if (!existing) {
    return addChannelMetric({ ...input, recordedAt, platform });
  }

  const nextSubs =
    typeof input.subscribers === "number" && Number.isFinite(input.subscribers)
      ? Math.round(input.subscribers)
      : toNullableNumber(existing.subscribers);
  const nextViews =
    typeof input.totalViews === "number" && Number.isFinite(input.totalViews)
      ? Math.round(input.totalViews)
      : toNullableNumber(existing.total_views);
  const nextCcv =
    typeof input.avgCcv === "number" && Number.isFinite(input.avgCcv)
      ? Math.round(input.avgCcv)
      : toNullableNumber(existing.avg_ccv);
  const nextCtr =
    typeof input.avgCtr === "number" && Number.isFinite(input.avgCtr)
      ? Number(input.avgCtr)
      : toNullableNumber(existing.avg_ctr);
  const nextNotes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : existing.notes;

  await db.run(
    `UPDATE channel_metrics
     SET subscribers = ?, total_views = ?, avg_ccv = ?, avg_ctr = ?, notes = ?
     WHERE id = ?`,
    nextSubs,
    nextViews,
    nextCcv,
    nextCtr,
    nextNotes,
    existing.id
  );

  return {
    id: existing.id,
    recordedAt,
    platform,
    subscribers: nextSubs,
    totalViews: nextViews,
    avgCcv: nextCcv,
    avgCtr: nextCtr,
    notes: nextNotes,
    createdAt: existing.created_at,
  };
}

// ---------- Overview & Safe Read-Only SQL ----------

async function countQuery(db: DbDriver, sql: string): Promise<number> {
  const row = await db.get<{ c?: number | string }>(sql);
  return Number(row?.c ?? 0);
}

export async function getStudioDbOverview() {
  const db = await getDb();
  const [calCount, pipeAll, contactsCount, metricsCount, clipJobsCount, clipsCount, archiveCount] =
    await Promise.all([
      countQuery(db, "SELECT COUNT(*) as c FROM calendar_events WHERE status != 'cancelled'"),
      listPipelineItems(),
      countQuery(db, "SELECT COUNT(*) as c FROM contacts"),
      countQuery(db, "SELECT COUNT(*) as c FROM channel_metrics"),
      countQuery(db, "SELECT COUNT(*) as c FROM clip_jobs"),
      countQuery(db, "SELECT COUNT(*) as c FROM clips"),
      countQuery(db, "SELECT COUNT(*) as c FROM archive_videos"),
    ]);
  const activePipe = pipeAll.filter((p) => p.status !== "dropped");
  const info = getNeonRuntimeInfo();
  return {
    backend: db.backend,
    dbPath: db.backend === "neon" ? `neon://${info.projectName || "lma-studio"}` : getStudioDbPath(),
    neon: info,
    tables: {
      calendar_events: calCount,
      content_pipeline: activePipe.length,
      contacts: contactsCount,
      channel_metrics: metricsCount,
      clip_jobs: clipJobsCount,
      clips: clipsCount,
      archive_videos: archiveCount,
    },
  };
}

export async function runReadOnlySql(
  sql: string,
  params: Array<string | number | null> = []
): Promise<{ rows: unknown[]; truncated: boolean }> {
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH|PRAGMA\s+table_info)\b/i.test(trimmed)) {
    throw new Error("Only read-only SELECT, WITH, or PRAGMA table_info statements are allowed.");
  }
  if (/;[\s\S]*\S/.test(trimmed)) {
    throw new Error("Multiple SQL statements are not allowed.");
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(trimmed)) {
    throw new Error("Mutation keywords are forbidden in read-only queries.");
  }
  const db = await getDb();
  const allRows = await db.all<unknown>(trimmed, ...params);
  const MAX_ROWS = 100;
  return {
    rows: allRows.slice(0, MAX_ROWS),
    truncated: allRows.length > MAX_ROWS,
  };
}

// ---------- Studio Metadata KV (Setup State, Preferences) ----------

export async function getStudioMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get<{ value?: string }>("SELECT value FROM studio_meta WHERE key = ?", key);
  return typeof row?.value === "string" ? row.value : null;
}

export async function setStudioMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  await db.run(
    `INSERT INTO studio_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    key,
    value,
    nowIso
  );
}

export async function deleteStudioMeta(key: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM studio_meta WHERE key = ?", key);
}

// ---------- Clip Jobs & Clips Ecosystem ----------

function rowToClipJob(row: Record<string, unknown>): ClipJob {
  return {
    id: String(row.id),
    vodUrl: String(row.vod_url ?? ""),
    videoId: String(row.video_id ?? ""),
    title: String(row.title ?? ""),
    maxClips: toNullableNumber(row.max_clips) ?? 3,
    focusNotes: String(row.focus_notes ?? ""),
    status: (String(row.status ?? "queued") as ClipJobStatus),
    stage: String(row.stage ?? "Queued"),
    progressLog: safeJsonParse<ClipJobLogEntry[]>(row.progress_log as string, []),
    error: String(row.error ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function rowToClipRecord(row: Record<string, unknown>): ClipRecord {
  return {
    id: String(row.id),
    jobId: row.job_id ? String(row.job_id) : null,
    videoId: String(row.video_id ?? ""),
    title: String(row.title ?? ""),
    filePath: String(row.file_path ?? ""),
    srtPath: String(row.srt_path ?? ""),
    startSec: toNullableNumber(row.start_sec),
    endSec: toNullableNumber(row.end_sec),
    durationSec: toNullableNumber(row.duration_sec),
    hookScore: toNullableNumber(row.hook_score),
    editorNotes: String(row.editor_notes ?? ""),
    youtubeUrl: String(row.youtube_url ?? ""),
    boxUrl: String(row.box_url ?? ""),
    status: (String(row.status ?? "ready") as ClipRecordStatus),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function createClipJob(input: {
  vodUrl: string;
  videoId?: string;
  title?: string;
  maxClips?: number;
  focusNotes?: string;
}): Promise<ClipJob> {
  const db = await getDb();
  const id = makeId("job");
  const nowIso = new Date().toISOString();
  const rawMax = input.maxClips ?? 0;
  const maxClips = rawMax <= 0 ? 0 : Math.max(1, Math.min(30, Math.floor(rawMax)));
  const initialLog: ClipJobLogEntry[] = [
    { at: nowIso, stage: "Queued", message: "Clip job created and queued for background worker." },
  ];
  await db.run(
    `INSERT INTO clip_jobs (
      id, vod_url, video_id, title, max_clips, focus_notes,
      status, stage, progress_log, error, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'Queued', ?, '', ?, ?, NULL)`,
    id,
    input.vodUrl.trim(),
    (input.videoId ?? "").trim(),
    (input.title ?? "").trim(),
    maxClips,
    (input.focusNotes ?? "").trim(),
    JSON.stringify(initialLog),
    nowIso,
    nowIso
  );
  return (await getClipJob(id))!;
}

export async function getClipJob(id: string): Promise<ClipJob | null> {
  const db = await getDb();
  const row = await db.get<Record<string, unknown>>("SELECT * FROM clip_jobs WHERE id = ?", id);
  return row ? rowToClipJob(row) : null;
}

export async function listClipJobs(limit = 20): Promise<ClipJob[]> {
  const db = await getDb();
  const rows = await db.all<Record<string, unknown>>(
    "SELECT * FROM clip_jobs ORDER BY created_at DESC LIMIT ?",
    Math.max(1, Math.min(100, limit))
  );
  return rows.map(rowToClipJob);
}

export async function updateClipJob(
  id: string,
  patch: {
    title?: string;
    videoId?: string;
    status?: ClipJobStatus;
    stage?: string;
    logMessage?: string;
    error?: string;
    completedAt?: string | null;
  }
): Promise<ClipJob | null> {
  const existing = await getClipJob(id);
  if (!existing) return null;
  const nowIso = new Date().toISOString();
  const nextStage = patch.stage ?? existing.stage;
  const nextStatus = patch.status ?? existing.status;
  const nextLog = [...existing.progressLog];
  if (patch.logMessage) {
    nextLog.push({ at: nowIso, stage: nextStage, message: patch.logMessage });
  }
  const trimmedLog = nextLog.slice(-40);
  const completedAt =
    patch.completedAt !== undefined
      ? patch.completedAt
      : nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled"
        ? existing.completedAt ?? nowIso
        : existing.completedAt;

  const db = await getDb();
  await db.run(
    `UPDATE clip_jobs
     SET title = ?, video_id = ?, status = ?, stage = ?, progress_log = ?, error = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
    patch.title !== undefined ? patch.title : existing.title,
    patch.videoId !== undefined ? patch.videoId : existing.videoId,
    nextStatus,
    nextStage,
    JSON.stringify(trimmedLog),
    patch.error !== undefined ? patch.error : existing.error,
    nowIso,
    completedAt,
    id
  );
  return getClipJob(id);
}

export async function deleteClipJob(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM clip_jobs WHERE id = ?", id);
  return res.changes > 0;
}

export async function upsertClipRecord(input: {
  id?: string;
  jobId?: string | null;
  videoId?: string;
  title: string;
  filePath: string;
  srtPath?: string;
  startSec?: number | null;
  endSec?: number | null;
  durationSec?: number | null;
  hookScore?: number | null;
  editorNotes?: string;
  youtubeUrl?: string;
  boxUrl?: string;
  status?: ClipRecordStatus;
}): Promise<ClipRecord> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const normalizedPath = input.filePath.trim().replace(/^\/home\/sprite\/workspace\//, "").replace(/^\/+/, "");
  const existing =
    (input.id ? await db.get<Record<string, unknown>>("SELECT * FROM clips WHERE id = ?", input.id) : null) ??
    (await db.get<Record<string, unknown>>("SELECT * FROM clips WHERE file_path = ?", normalizedPath));

  const id = existing ? String(existing.id) : input.id?.trim() || makeId("clip");
  const startSec = input.startSec ?? toNullableNumber(existing?.start_sec);
  const endSec = input.endSec ?? toNullableNumber(existing?.end_sec);
  const durationSec =
    input.durationSec ??
    (startSec !== null && endSec !== null && endSec > startSec
      ? Math.round(endSec - startSec)
      : toNullableNumber(existing?.duration_sec));
  const hookScore =
    typeof input.hookScore === "number"
      ? Math.max(1, Math.min(10, Math.round(input.hookScore)))
      : toNullableNumber(existing?.hook_score);
  const srtPath = (input.srtPath ?? (existing ? String(existing.srt_path ?? "") : ""))
    .trim()
    .replace(/^\/home\/sprite\/workspace\//, "")
    .replace(/^\/+/, "");

  await db.run(
    `INSERT INTO clips (
      id, job_id, video_id, title, file_path, srt_path,
      start_sec, end_sec, duration_sec, hook_score,
      editor_notes, youtube_url, box_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = COALESCE(excluded.job_id, clips.job_id),
      video_id = CASE WHEN excluded.video_id != '' THEN excluded.video_id ELSE clips.video_id END,
      title = excluded.title,
      file_path = excluded.file_path,
      srt_path = CASE WHEN excluded.srt_path != '' THEN excluded.srt_path ELSE clips.srt_path END,
      start_sec = COALESCE(excluded.start_sec, clips.start_sec),
      end_sec = COALESCE(excluded.end_sec, clips.end_sec),
      duration_sec = COALESCE(excluded.duration_sec, clips.duration_sec),
      hook_score = COALESCE(excluded.hook_score, clips.hook_score),
      editor_notes = CASE WHEN excluded.editor_notes != '' THEN excluded.editor_notes ELSE clips.editor_notes END,
      youtube_url = CASE WHEN excluded.youtube_url != '' THEN excluded.youtube_url ELSE clips.youtube_url END,
      box_url = CASE WHEN excluded.box_url != '' THEN excluded.box_url ELSE clips.box_url END,
      status = excluded.status,
      updated_at = excluded.updated_at`,
    id,
    input.jobId !== undefined ? input.jobId : existing?.job_id ? String(existing.job_id) : null,
    (input.videoId ?? (existing ? String(existing.video_id ?? "") : "")).trim(),
    input.title.trim(),
    normalizedPath,
    srtPath,
    startSec,
    endSec,
    durationSec,
    hookScore,
    (input.editorNotes ?? (existing ? String(existing.editor_notes ?? "") : "")).trim(),
    (input.youtubeUrl ?? (existing ? String(existing.youtube_url ?? "") : "")).trim(),
    (input.boxUrl ?? (existing ? String(existing.box_url ?? "") : "")).trim(),
    input.status ?? (existing ? (String(existing.status ?? "ready") as ClipRecordStatus) : "ready"),
    existing ? String(existing.created_at ?? nowIso) : nowIso,
    nowIso
  );
  const saved = (await db.get<Record<string, unknown>>("SELECT * FROM clips WHERE id = ?", id))!;
  return rowToClipRecord(saved);
}

export async function listClipRecords(opts?: { jobId?: string; limit?: number }): Promise<ClipRecord[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 60));
  if (opts?.jobId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM clips WHERE job_id = ? ORDER BY created_at DESC LIMIT ?",
      opts.jobId,
      limit
    );
    return rows.map(rowToClipRecord);
  }
  const rows = await db.all<Record<string, unknown>>(
    "SELECT * FROM clips ORDER BY created_at DESC LIMIT ?",
    limit
  );
  return rows.map(rowToClipRecord);
}

export async function updateClipBoxUrl(id: string, boxUrl: string): Promise<ClipRecord | null> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  await db.run(
    "UPDATE clips SET box_url = ?, status = 'sent_to_box', updated_at = ? WHERE id = ?",
    boxUrl,
    nowIso,
    id
  );
  const row = await db.get<Record<string, unknown>>("SELECT * FROM clips WHERE id = ?", id);
  return row ? rowToClipRecord(row) : null;
}

export async function deleteClipRecord(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM clips WHERE id = ?", id);
  return res.changes > 0;
}

// ---------- Creator Archive (Pinecone Video Transcript Index) ----------

function rowToArchiveVideo(row: Record<string, unknown>): ArchiveVideoRecord {
  return {
    videoId: String(row.video_id ?? ""),
    title: String(row.title ?? ""),
    publishedAt: String(row.published_at ?? ""),
    durationSec: Number(row.duration_sec ?? 0),
    contentType: (String(row.content_type ?? "video") as ArchiveContentType),
    status: (String(row.status ?? "pending") as ArchiveVideoStatus),
    chunkCount: Number(row.chunk_count ?? 0),
    lang: String(row.lang ?? ""),
    error: String(row.error ?? ""),
    indexedAt: row.indexed_at ? String(row.indexed_at) : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function upsertArchiveVideo(input: {
  videoId: string;
  title?: string;
  publishedAt?: string;
  durationSec?: number;
  contentType?: ArchiveContentType;
  status: ArchiveVideoStatus;
  chunkCount?: number;
  lang?: string;
  error?: string;
  indexedAt?: string | null;
}): Promise<ArchiveVideoRecord> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const vid = input.videoId.trim();
  const existing = await db.get<Record<string, unknown>>(
    "SELECT * FROM archive_videos WHERE video_id = ?",
    vid
  );

  await db.run(
    `INSERT INTO archive_videos (
      video_id, title, published_at, duration_sec, content_type,
      status, chunk_count, lang, error, indexed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE archive_videos.title END,
      published_at = CASE WHEN excluded.published_at != '' THEN excluded.published_at ELSE archive_videos.published_at END,
      duration_sec = CASE WHEN excluded.duration_sec > 0 THEN excluded.duration_sec ELSE archive_videos.duration_sec END,
      content_type = excluded.content_type,
      status = excluded.status,
      chunk_count = CASE WHEN excluded.chunk_count > 0 OR excluded.status != 'indexed' THEN excluded.chunk_count ELSE archive_videos.chunk_count END,
      lang = CASE WHEN excluded.lang != '' THEN excluded.lang ELSE archive_videos.lang END,
      error = excluded.error,
      indexed_at = COALESCE(excluded.indexed_at, archive_videos.indexed_at),
      updated_at = excluded.updated_at`,
    vid,
    (input.title ?? (existing ? String(existing.title ?? "") : "")).trim(),
    (input.publishedAt ?? (existing ? String(existing.published_at ?? "") : "")).trim(),
    input.durationSec ?? (existing ? Number(existing.duration_sec ?? 0) : 0),
    input.contentType ?? (existing ? (String(existing.content_type ?? "video") as ArchiveContentType) : "video"),
    input.status,
    input.chunkCount ?? (existing ? Number(existing.chunk_count ?? 0) : 0),
    (input.lang ?? (existing ? String(existing.lang ?? "") : "")).trim(),
    (input.error ?? "").trim(),
    input.indexedAt !== undefined ? input.indexedAt : input.status === "indexed" ? nowIso : null,
    nowIso
  );

  const saved = (await db.get<Record<string, unknown>>(
    "SELECT * FROM archive_videos WHERE video_id = ?",
    vid
  ))!;
  return rowToArchiveVideo(saved);
}

export async function listArchiveVideos(opts?: {
  status?: ArchiveVideoStatus;
  limit?: number;
}): Promise<ArchiveVideoRecord[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 120));
  if (opts?.status) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM archive_videos WHERE status = ? ORDER BY published_at DESC, updated_at DESC LIMIT ?",
      opts.status,
      limit
    );
    return rows.map(rowToArchiveVideo);
  }
  const rows = await db.all<Record<string, unknown>>(
    "SELECT * FROM archive_videos ORDER BY published_at DESC, updated_at DESC LIMIT ?",
    limit
  );
  return rows.map(rowToArchiveVideo);
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  const db = await getDb();
  const row = await db.get<Record<string, unknown>>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_cnt,
      SUM(CASE WHEN status = 'no_captions' THEN 1 ELSE 0 END) AS nocap_cnt,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_cnt,
      SUM(CASE WHEN status IN ('pending', 'indexing') THEN 1 ELSE 0 END) AS pending_cnt,
      COALESCE(SUM(chunk_count), 0) AS total_chunks
    FROM archive_videos
  `);

  return {
    totalTracked: Number(row?.total ?? 0),
    indexedVideos: Number(row?.indexed_cnt ?? 0),
    noCaptionsVideos: Number(row?.nocap_cnt ?? 0),
    failedVideos: Number(row?.failed_cnt ?? 0),
    pendingVideos: Number(row?.pending_cnt ?? 0),
    totalChunks: Number(row?.total_chunks ?? 0),
  };
}

export async function deleteArchiveVideo(videoId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM archive_videos WHERE video_id = ?", videoId);
  return res.changes > 0;
}

// ---------- Cloud Persistent Long-Term Memories (Neon + Pinecone otto-memory) ----------

function rowToStudioMemory(row: Record<string, unknown>): StudioMemory {
  return {
    id: String(row.id ?? ""),
    category: (String(row.category ?? "general") as StudioMemoryCategory),
    content: String(row.content ?? ""),
    tags: safeJsonParse<string[]>(row.tags_json as string, []),
    source: String(row.source ?? "otto"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function upsertStudioMemory(input: {
  id?: string;
  category?: StudioMemoryCategory;
  content: string;
  tags?: string[];
  source?: string;
}): Promise<StudioMemory> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const content = input.content.trim();
  if (!content) throw new Error("Memory content is required");

  const existing = input.id
    ? await db.get<Record<string, unknown>>("SELECT * FROM studio_memories WHERE id = ?", input.id.trim())
    : null;
  const id = existing ? String(existing.id) : input.id?.trim() || makeId("mem");
  const category = input.category ?? (existing ? (String(existing.category ?? "general") as StudioMemoryCategory) : "general");
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12)
    : existing
      ? safeJsonParse<string[]>(existing.tags_json as string, [])
      : [];
  const source = (input.source ?? (existing ? String(existing.source ?? "otto") : "otto")).trim();

  await db.run(
    `INSERT INTO studio_memories (
      id, category, content, tags_json, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      content = excluded.content,
      tags_json = excluded.tags_json,
      source = excluded.source,
      updated_at = excluded.updated_at`,
    id,
    category,
    content,
    JSON.stringify(tags),
    source,
    existing ? String(existing.created_at ?? nowIso) : nowIso,
    nowIso
  );

  const saved = (await db.get<Record<string, unknown>>(
    "SELECT * FROM studio_memories WHERE id = ?",
    id
  ))!;
  return rowToStudioMemory(saved);
}

export async function listStudioMemories(opts?: {
  category?: StudioMemoryCategory;
  limit?: number;
}): Promise<StudioMemory[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  if (opts?.category) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM studio_memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?",
      opts.category,
      limit
    );
    return rows.map(rowToStudioMemory);
  }
  const rows = await db.all<Record<string, unknown>>(
    "SELECT * FROM studio_memories ORDER BY updated_at DESC LIMIT ?",
    limit
  );
  return rows.map(rowToStudioMemory);
}

export async function deleteStudioMemory(id: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.run("DELETE FROM studio_memories WHERE id = ?", id);
  return res.changes > 0;
}
