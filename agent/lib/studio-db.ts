import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

let dbInstance: Database | null = null;
let dbInstancePath: string | null = null;

export function getStudioDbPath(): string {
  const home = process.env.HOME || "/home/sprite";
  return path.join(home, ".omp", "agent", "studio.db");
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

function initSchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS calendar_events (
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
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_google ON calendar_events(google_event_id);

    CREATE TABLE IF NOT EXISTS content_pipeline (
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
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_status ON content_pipeline(status);

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collab',
      handle TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_metrics (
      id TEXT PRIMARY KEY,
      recorded_at TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'youtube',
      subscribers INTEGER,
      total_views INTEGER,
      avg_ccv INTEGER,
      avg_ctr REAL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON channel_metrics(recorded_at DESC);

    CREATE TABLE IF NOT EXISTS studio_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clip_jobs (
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
    );

    CREATE INDEX IF NOT EXISTS idx_clip_jobs_created ON clip_jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS clips (
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
    );

    CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_job ON clips(job_id);
  `);

  // Drop legacy 3+1 pillar column cleanly on existing databases
  const pipeCols = db.query("PRAGMA table_info(content_pipeline)").all() as Array<{ name?: string }>;
  if (pipeCols.some((c) => c.name === "pillar")) {
    try {
      db.exec("ALTER TABLE content_pipeline DROP COLUMN pillar;");
    } catch {
      // Older SQLite without DROP COLUMN; column remains unused with DEFAULT 'core'
    }
  }
}

function migrateLegacyCalendarJson(db: Database): void {
  const home = process.env.HOME || "/home/sprite";
  const legacyPath = path.join(home, ".omp", "agent", "calendar.json");
  if (!fs.existsSync(legacyPath)) return;

  try {
    const countRow = db.query("SELECT COUNT(*) as c FROM calendar_events").get() as { c: number };
    if (countRow && countRow.c > 0) return;

    const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as {
      events?: Array<Partial<CalendarEvent>>;
    };
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    if (events.length === 0) return;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO calendar_events (
        id, title, type, start_at, end_at, cron, notes, status, source,
        google_event_id, google_html_link, wakeups_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nowIso = new Date().toISOString();
    const tx = db.transaction((list: Array<Partial<CalendarEvent>>) => {
      for (const e of list) {
        if (!e || !e.id || !e.title || !e.startAt) continue;
        stmt.run(
          String(e.id),
          String(e.title),
          String(e.type || "stream"),
          String(e.startAt),
          e.endAt ?? null,
          e.cron ?? null,
          String(e.notes || ""),
          String(e.status || "planned"),
          String(e.source || "local"),
          e.googleEventId ?? null,
          e.googleHtmlLink ?? null,
          JSON.stringify(Array.isArray(e.wakeups) ? e.wakeups : []),
          String(e.createdAt || nowIso),
          String(e.updatedAt || nowIso)
        );
      }
    });
    tx(events);
    try {
      fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    } catch {
      // non-fatal if rename fails
    }
  } catch {
    // ignore malformed legacy json
  }
}

export function getStudioDb(): Database {
  const dbPath = getStudioDbPath();
  if (dbInstance && dbInstancePath === dbPath && fs.existsSync(dbPath)) {
    return dbInstance;
  }
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  initSchema(db);
  migrateLegacyCalendarJson(db);
  dbInstance = db;
  dbInstancePath = dbPath;
  return db;
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

export function listCalendarEvents(): CalendarEvent[] {
  const db = getStudioDb();
  const rows = db.query("SELECT * FROM calendar_events ORDER BY start_at ASC").all() as CalendarRow[];
  return rows.map(mapCalendarRow);
}

export function getCalendarEventById(id: string): CalendarEvent | null {
  const db = getStudioDb();
  const row = db.query("SELECT * FROM calendar_events WHERE id = ?").get(id) as CalendarRow | null;
  return row ? mapCalendarRow(row) : null;
}

export function getCalendarEventByGoogleId(googleEventId: string): CalendarEvent | null {
  const db = getStudioDb();
  const row = db
    .query("SELECT * FROM calendar_events WHERE google_event_id = ?")
    .get(googleEventId) as CalendarRow | null;
  return row ? mapCalendarRow(row) : null;
}

export function upsertCalendarEvent(evt: CalendarEvent): CalendarEvent {
  const db = getStudioDb();
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
  db.prepare(`
    INSERT INTO calendar_events (
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
      updated_at = excluded.updated_at
  `).run(
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

export function saveCalendarEventsBatch(events: CalendarEvent[]): void {
  const db = getStudioDb();
  const tx = db.transaction((list: CalendarEvent[]) => {
    for (const evt of list) {
      upsertCalendarEvent(evt);
    }
  });
  tx(events);
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

export function listPipelineItems(filters?: {
  status?: string;
  format?: string;
}): ContentPipelineItem[] {
  const db = getStudioDb();
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
  const rows = db
    .query(`SELECT * FROM content_pipeline ${where} ORDER BY updated_at DESC`)
    .all(...params) as PipelineRow[];
  return rows.map(mapPipelineRow);
}

export function getPipelineItemById(id: string): ContentPipelineItem | null {
  const db = getStudioDb();
  const row = db.query("SELECT * FROM content_pipeline WHERE id = ?").get(id) as PipelineRow | null;
  return row ? mapPipelineRow(row) : null;
}

export function upsertPipelineItem(input: {
  id?: string;
  title?: string;
  format?: PipelineFormat;
  status?: PipelineStatus;
  hook?: string;
  thumbnailPath?: string;
  scriptPath?: string;
  scheduledFor?: string | null;
  notes?: string;
}): ContentPipelineItem {
  const db = getStudioDb();
  const existing = input.id ? getPipelineItemById(input.id) : null;
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

  db.prepare(`
    INSERT INTO content_pipeline (
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
      updated_at = excluded.updated_at
  `).run(
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

export function deletePipelineItem(id: string): boolean {
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM content_pipeline WHERE id = ?").run(id);
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

export function listContacts(filters?: { role?: string; status?: string }): StudioContact[] {
  const db = getStudioDb();
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
  const rows = db
    .query(`SELECT * FROM contacts ${where} ORDER BY updated_at DESC`)
    .all(...params) as ContactRow[];
  return rows.map(mapContactRow);
}

export function getContactById(id: string): StudioContact | null {
  const db = getStudioDb();
  const row = db.query("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | null;
  return row ? mapContactRow(row) : null;
}

export function upsertContact(input: {
  id?: string;
  name?: string;
  role?: ContactRole;
  handle?: string;
  platform?: string;
  status?: ContactStatus;
  notes?: string;
}): StudioContact {
  const db = getStudioDb();
  const existing = input.id ? getContactById(input.id) : null;
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

  db.prepare(`
    INSERT INTO contacts (
      id, name, role, handle, platform, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      handle = excluded.handle,
      platform = excluded.platform,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
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

export function deleteContact(id: string): boolean {
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  return res.changes > 0;
}

// ---------- Channel Metrics ----------

interface MetricRow {
  id: string;
  recorded_at: string;
  platform: string;
  subscribers: number | null;
  total_views: number | null;
  avg_ccv: number | null;
  avg_ctr: number | null;
  notes: string;
  created_at: string;
}

function mapMetricRow(r: MetricRow): ChannelMetric {
  return {
    id: r.id,
    recordedAt: r.recorded_at,
    platform: r.platform,
    subscribers: r.subscribers,
    totalViews: r.total_views,
    avgCcv: r.avg_ccv,
    avgCtr: r.avg_ctr,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export function listChannelMetrics(limit = 50): ChannelMetric[] {
  const db = getStudioDb();
  const rows = db
    .query("SELECT * FROM channel_metrics ORDER BY recorded_at DESC, created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(200, limit))) as MetricRow[];
  return rows.map(mapMetricRow);
}

export function addChannelMetric(input: {
  recordedAt?: string;
  platform?: string;
  subscribers?: number | null;
  totalViews?: number | null;
  avgCcv?: number | null;
  avgCtr?: number | null;
  notes?: string;
}): ChannelMetric {
  const db = getStudioDb();
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

  db.prepare(`
    INSERT INTO channel_metrics (
      id, recorded_at, platform, subscribers, total_views, avg_ccv, avg_ctr, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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

export function deleteChannelMetric(id: string): boolean {
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM channel_metrics WHERE id = ?").run(id);
  return res.changes > 0;
}

export function upsertDailyChannelMetric(input: {
  recordedAt?: string;
  platform?: string;
  subscribers?: number | null;
  totalViews?: number | null;
  avgCcv?: number | null;
  avgCtr?: number | null;
  notes?: string;
}): ChannelMetric {
  const db = getStudioDb();
  const nowIso = new Date().toISOString();
  const recordedAt = (input.recordedAt || nowIso.slice(0, 10)).trim();
  const platform = (input.platform || "youtube").trim().toLowerCase();
  const existing = db
    .query(
      "SELECT * FROM channel_metrics WHERE recorded_at = ? AND platform = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(recordedAt, platform) as MetricRow | null;

  if (!existing) {
    return addChannelMetric({ ...input, recordedAt, platform });
  }

  const nextSubs =
    typeof input.subscribers === "number" && Number.isFinite(input.subscribers)
      ? Math.round(input.subscribers)
      : existing.subscribers;
  const nextViews =
    typeof input.totalViews === "number" && Number.isFinite(input.totalViews)
      ? Math.round(input.totalViews)
      : existing.total_views;
  const nextCcv =
    typeof input.avgCcv === "number" && Number.isFinite(input.avgCcv)
      ? Math.round(input.avgCcv)
      : existing.avg_ccv;
  const nextCtr =
    typeof input.avgCtr === "number" && Number.isFinite(input.avgCtr)
      ? Number(input.avgCtr)
      : existing.avg_ctr;
  const nextNotes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : existing.notes;

  db.prepare(`
    UPDATE channel_metrics
    SET subscribers = ?, total_views = ?, avg_ccv = ?, avg_ctr = ?, notes = ?
    WHERE id = ?
  `).run(nextSubs, nextViews, nextCcv, nextCtr, nextNotes, existing.id);

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

function countQuery(db: Database, sql: string): number {
  const row = db.query(sql).get();
  if (row && typeof row === "object" && "c" in row && typeof row.c === "number") {
    return row.c;
  }
  return 0;
}

export function getStudioDbOverview() {
  const db = getStudioDb();
  const calCount = countQuery(db, "SELECT COUNT(*) as c FROM calendar_events WHERE status != 'cancelled'");
  const pipeAll = listPipelineItems();
  const activePipe = pipeAll.filter((p) => p.status !== "dropped");
  const contactsCount = countQuery(db, "SELECT COUNT(*) as c FROM contacts");
  const metricsCount = countQuery(db, "SELECT COUNT(*) as c FROM channel_metrics");
  const clipJobsCount = countQuery(db, "SELECT COUNT(*) as c FROM clip_jobs");
  const clipsCount = countQuery(db, "SELECT COUNT(*) as c FROM clips");
  return {
    dbPath: getStudioDbPath(),
    tables: {
      calendar_events: calCount,
      content_pipeline: activePipe.length,
      contacts: contactsCount,
      channel_metrics: metricsCount,
      clip_jobs: clipJobsCount,
      clips: clipsCount,
    },
  };
}

export function runReadOnlySql(
  sql: string,
  params: Array<string | number | null> = []
): { rows: unknown[]; truncated: boolean } {
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
  const db = getStudioDb();
  const allRows = db.query(trimmed).all(...params);
  const MAX_ROWS = 100;
  return {
    rows: allRows.slice(0, MAX_ROWS),
    truncated: allRows.length > MAX_ROWS,
  };
}

// ---------- Studio Metadata KV (Setup State, Preferences) ----------

export function getStudioMeta(key: string): string | null {
  const db = getStudioDb();
  const row = db.query("SELECT value FROM studio_meta WHERE key = ?").get(key);
  if (row && typeof row === "object" && "value" in row && typeof row.value === "string") {
    return row.value;
  }
  return null;
}

export function setStudioMeta(key: string, value: string): void {
  const db = getStudioDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO studio_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, nowIso);
}

export function deleteStudioMeta(key: string): void {
  const db = getStudioDb();
  db.prepare("DELETE FROM studio_meta WHERE key = ?").run(key);
}

// ---------- Clip Jobs & Clips Ecosystem ----------

function rowToClipJob(row: Record<string, unknown>): ClipJob {
  return {
    id: String(row.id),
    vodUrl: String(row.vod_url ?? ""),
    videoId: String(row.video_id ?? ""),
    title: String(row.title ?? ""),
    maxClips: typeof row.max_clips === "number" ? row.max_clips : 3,
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
    startSec: typeof row.start_sec === "number" ? row.start_sec : null,
    endSec: typeof row.end_sec === "number" ? row.end_sec : null,
    durationSec: typeof row.duration_sec === "number" ? row.duration_sec : null,
    hookScore: typeof row.hook_score === "number" ? row.hook_score : null,
    editorNotes: String(row.editor_notes ?? ""),
    youtubeUrl: String(row.youtube_url ?? ""),
    boxUrl: String(row.box_url ?? ""),
    status: (String(row.status ?? "ready") as ClipRecordStatus),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function createClipJob(input: {
  vodUrl: string;
  videoId?: string;
  title?: string;
  maxClips?: number;
  focusNotes?: string;
}): ClipJob {
  const db = getStudioDb();
  const id = makeId("job");
  const nowIso = new Date().toISOString();
  const rawMax = input.maxClips ?? 0;
  const maxClips = rawMax <= 0 ? 0 : Math.max(1, Math.min(30, Math.floor(rawMax)));
  const initialLog: ClipJobLogEntry[] = [
    { at: nowIso, stage: "Queued", message: "Clip job created and queued for background worker." },
  ];
  db.prepare(`
    INSERT INTO clip_jobs (
      id, vod_url, video_id, title, max_clips, focus_notes,
      status, stage, progress_log, error, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 'Queued', ?, '', ?, ?, NULL)
  `).run(
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
  return getClipJob(id)!;
}

export function getClipJob(id: string): ClipJob | null {
  const db = getStudioDb();
  const row = db.query("SELECT * FROM clip_jobs WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToClipJob(row) : null;
}

export function listClipJobs(limit = 20): ClipJob[] {
  const db = getStudioDb();
  const rows = db
    .query("SELECT * FROM clip_jobs ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  return rows.map(rowToClipJob);
}

export function updateClipJob(
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
): ClipJob | null {
  const existing = getClipJob(id);
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

  const db = getStudioDb();
  db.prepare(`
    UPDATE clip_jobs
    SET title = ?, video_id = ?, status = ?, stage = ?, progress_log = ?, error = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).run(
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

export function deleteClipJob(id: string): boolean {
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM clip_jobs WHERE id = ?").run(id);
  return res.changes > 0;
}

export function upsertClipRecord(input: {
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
}): ClipRecord {
  const db = getStudioDb();
  const nowIso = new Date().toISOString();
  const normalizedPath = input.filePath.trim().replace(/^\/home\/sprite\/workspace\//, "").replace(/^\/+/, "");
  const existing =
    (input.id
      ? (db.query("SELECT * FROM clips WHERE id = ?").get(input.id) as Record<string, unknown> | null)
      : null) ??
    (db.query("SELECT * FROM clips WHERE file_path = ?").get(normalizedPath) as Record<string, unknown> | null);

  const id = existing ? String(existing.id) : input.id?.trim() || makeId("clip");
  const startSec = input.startSec ?? (existing && typeof existing.start_sec === "number" ? existing.start_sec : null);
  const endSec = input.endSec ?? (existing && typeof existing.end_sec === "number" ? existing.end_sec : null);
  const durationSec =
    input.durationSec ??
    (startSec !== null && endSec !== null && endSec > startSec
      ? Math.round(endSec - startSec)
      : existing && typeof existing.duration_sec === "number"
        ? existing.duration_sec
        : null);
  const hookScore =
    typeof input.hookScore === "number"
      ? Math.max(1, Math.min(10, Math.round(input.hookScore)))
      : existing && typeof existing.hook_score === "number"
        ? existing.hook_score
        : null;
  const srtPath = (input.srtPath ?? (existing ? String(existing.srt_path ?? "") : ""))
    .trim()
    .replace(/^\/home\/sprite\/workspace\//, "")
    .replace(/^\/+/, "");

  db.prepare(`
    INSERT INTO clips (
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
      updated_at = excluded.updated_at
  `).run(
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
  const saved = db.query("SELECT * FROM clips WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToClipRecord(saved);
}

export function listClipRecords(opts?: { jobId?: string; limit?: number }): ClipRecord[] {
  const db = getStudioDb();
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 60));
  if (opts?.jobId) {
    const rows = db
      .query("SELECT * FROM clips WHERE job_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(opts.jobId, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToClipRecord);
  }
  const rows = db
    .query("SELECT * FROM clips ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToClipRecord);
}

export function updateClipBoxUrl(id: string, boxUrl: string): ClipRecord | null {
  const db = getStudioDb();
  const nowIso = new Date().toISOString();
  db.prepare("UPDATE clips SET box_url = ?, status = 'sent_to_box', updated_at = ? WHERE id = ?").run(
    boxUrl,
    nowIso,
    id
  );
  const row = db.query("SELECT * FROM clips WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToClipRecord(row) : null;
}

export function deleteClipRecord(id: string): boolean {
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM clips WHERE id = ?").run(id);
  return res.changes > 0;
}
