#!/usr/bin/env bun
/**
 * One-shot idempotent migration: local SQLite (~/.omp/agent/studio.db) -> Neon Postgres (lma-studio).
 * Runs inside Sprite using the zero-key Neon Sprites Connector (or locally with LMA_NEON_DATABASE_URL).
 */

import { Database } from "bun:sqlite";
import fs from "node:fs";
import {
  addChannelMetric,
  getStudioDbOverview,
  getStudioDbPath,
  setStudioMeta,
  upsertArchiveVideo,
  upsertCalendarEvent,
  upsertClipRecord,
  upsertContact,
  upsertPipelineItem,
  type ArchiveContentType,
  type ArchiveVideoStatus,
  type CalendarEvent,
  type ClipRecordStatus,
  type ContactRole,
  type ContactStatus,
  type PipelineFormat,
  type PipelineStatus,
} from "../agent/lib/studio-db.ts";

const sqlitePath = getStudioDbPath();
const overview = await getStudioDbOverview();
console.log("[migrate] Target Studio DB backend:", JSON.stringify(overview));

if (overview.backend !== "neon") {
  console.error("[migrate] ERROR: Neon backend is not active; aborting migration.");
  process.exit(1);
}

if (!fs.existsSync(sqlitePath)) {
  console.log(`[migrate] No local SQLite file at ${sqlitePath}; Neon schema is initialized and ready.`);
  process.exit(0);
}

const sq = new Database(sqlitePath, { readonly: true });

const safeAll = (table: string): Array<Record<string, unknown>> => {
  try {
    return sq.query(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
};

let counts = {
  calendar_events: 0,
  content_pipeline: 0,
  contacts: 0,
  channel_metrics: 0,
  studio_meta: 0,
  clips: 0,
  archive_videos: 0,
};

for (const r of safeAll("calendar_events")) {
  await upsertCalendarEvent({
    id: String(r.id),
    title: String(r.title),
    type: String(r.type || "stream") as CalendarEvent["type"],
    startAt: String(r.start_at),
    endAt: r.end_at ? String(r.end_at) : null,
    cron: r.cron ? String(r.cron) : null,
    notes: String(r.notes || ""),
    status: String(r.status || "planned") as CalendarEvent["status"],
    source: (String(r.source || "local") as "local" | "google"),
    googleEventId: r.google_event_id ? String(r.google_event_id) : null,
    googleHtmlLink: r.google_html_link ? String(r.google_html_link) : null,
    wakeups: r.wakeups_json ? JSON.parse(String(r.wakeups_json)) : [],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });
  counts.calendar_events += 1;
}

for (const r of safeAll("content_pipeline")) {
  await upsertPipelineItem({
    id: String(r.id),
    title: String(r.title),
    format: String(r.format || "stream") as PipelineFormat,
    status: String(r.status || "idea") as PipelineStatus,
    hook: String(r.hook || ""),
    thumbnailPath: String(r.thumbnail_path || ""),
    scriptPath: String(r.script_path || ""),
    scheduledFor: r.scheduled_for ? String(r.scheduled_for) : null,
    notes: String(r.notes || ""),
  });
  counts.content_pipeline += 1;
}

for (const r of safeAll("contacts")) {
  await upsertContact({
    id: String(r.id),
    name: String(r.name),
    role: String(r.role || "collab") as ContactRole,
    handle: String(r.handle || ""),
    platform: String(r.platform || ""),
    status: String(r.status || "active") as ContactStatus,
    notes: String(r.notes || ""),
  });
  counts.contacts += 1;
}

for (const r of safeAll("channel_metrics")) {
  await addChannelMetric({
    recordedAt: String(r.recorded_at),
    platform: String(r.platform || "youtube"),
    subscribers: typeof r.subscribers === "number" ? r.subscribers : null,
    totalViews: typeof r.total_views === "number" ? r.total_views : null,
    avgCcv: typeof r.avg_ccv === "number" ? r.avg_ccv : null,
    avgCtr: typeof r.avg_ctr === "number" ? r.avg_ctr : null,
    notes: String(r.notes || ""),
  });
  counts.channel_metrics += 1;
}

for (const r of safeAll("studio_meta")) {
  await setStudioMeta(String(r.key), String(r.value));
  counts.studio_meta += 1;
}

for (const r of safeAll("clips")) {
  await upsertClipRecord({
    id: String(r.id),
    jobId: r.job_id ? String(r.job_id) : null,
    videoId: String(r.video_id || ""),
    title: String(r.title || ""),
    filePath: String(r.file_path || ""),
    srtPath: String(r.srt_path || ""),
    startSec: typeof r.start_sec === "number" ? r.start_sec : null,
    endSec: typeof r.end_sec === "number" ? r.end_sec : null,
    durationSec: typeof r.duration_sec === "number" ? r.duration_sec : null,
    hookScore: typeof r.hook_score === "number" ? r.hook_score : null,
    editorNotes: String(r.editor_notes || ""),
    youtubeUrl: String(r.youtube_url || ""),
    boxUrl: String(r.box_url || ""),
    status: String(r.status || "ready") as ClipRecordStatus,
  });
  counts.clips += 1;
}

for (const r of safeAll("archive_videos")) {
  await upsertArchiveVideo({
    videoId: String(r.video_id),
    title: String(r.title || ""),
    publishedAt: String(r.published_at || ""),
    durationSec: Number(r.duration_sec || 0),
    contentType: String(r.content_type || "video") as ArchiveContentType,
    status: String(r.status || "indexed") as ArchiveVideoStatus,
    chunkCount: Number(r.chunk_count || 0),
    lang: String(r.lang || ""),
    error: String(r.error || ""),
    indexedAt: r.indexed_at ? String(r.indexed_at) : null,
  });
  counts.archive_videos += 1;
}

sq.close();
const after = await getStudioDbOverview();
console.log("[migrate] Migrated counts:", JSON.stringify(counts));
console.log("[migrate] Final Neon Studio DB overview:", JSON.stringify(after));
