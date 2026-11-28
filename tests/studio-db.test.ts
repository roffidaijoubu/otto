import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-db-test-"));
const dbFile = path.join(tmpDir, "studio-test.db");
process.env.LMA_FORCE_SQLITE = "1";
process.env.LMA_STUDIO_DB_PATH = dbFile;

const db = await import("../agent/lib/studio-db.ts");

describe("Unified Studio DB (10-table SQLite schema, CRUD, orphan reconciliation & read-only SQL gate)", () => {
  before(() => {
    db.resetStudioDbForTests();
  });

  after(() => {
    db.resetStudioDbForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes all 10 tables and returns accurate overview counts", async () => {
    const overview = await db.getStudioDbOverview();
    assert.equal(overview.backend, "sqlite");
    const tablesRes = await db.runReadOnlySql(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tableNames = tablesRes.rows.map((r) => String(r.name));
    for (const expected of [
      "archive_videos",
      "calendar_events",
      "channel_metrics",
      "clip_jobs",
      "clips",
      "contacts",
      "content_pipeline",
      "studio_jobs",
      "studio_memories",
      "studio_meta",
    ]) {
      assert.ok(tableNames.includes(expected), `Missing table ${expected}`);
    }
    assert.equal(tableNames.length, 10);
  });

  it("performs parameterized CRUD on content_pipeline, calendar_events, contacts, metrics, meta & memories", async () => {
    // Pipeline CRUD + field whitelisting
    const createdIdea = await db.upsertPipelineItem({
      title: "Friday Co-op Stream",
      format: "stream",
      status: "idea",
      hook: "Can we clear without dying?",
      notes: "Prep overlays first",
    });
    assert.match(createdIdea.id, /^idea_/);
    const fetchedIdea = await db.getPipelineItemById(createdIdea.id);
    assert.equal(fetchedIdea?.title, "Friday Co-op Stream");
    assert.equal((await db.listPipelineItems({ status: "idea" })).length, 1);
    assert.equal(await db.deletePipelineItem(createdIdea.id), true);
    assert.equal(await db.getPipelineItemById(createdIdea.id), null);

    // Calendar event + Google ID lookup
    const now = new Date().toISOString();
    await db.upsertCalendarEvent({
      id: "evt_test_1",
      title: "Hacksgiving Finale",
      type: "stream",
      startAt: "2026-11-29T13:00:00Z",
      endAt: "2026-11-29T15:00:00Z",
      cron: null,
      notes: "Test event",
      status: "planned",
      source: "google",
      googleEventId: "gcal_abc_123",
      googleHtmlLink: "https://calendar.google.com/event?eid=123",
      wakeups: [],
      createdAt: now,
      updatedAt: now,
    });
    const byGoogle = await db.getCalendarEventByGoogleId("gcal_abc_123");
    assert.equal(byGoogle?.id, "evt_test_1");

    // Contacts CRUD + role filter
    const contact = await db.upsertContact({
      name: "Mina",
      role: "artist",
      handle: "@mina_draws",
      platform: "x",
      status: "active",
      notes: "Emote commission",
    });
    assert.equal((await db.listContacts({ role: "artist" })).length, 1);
    assert.equal((await db.listContacts({ role: "sponsor" })).length, 0);
    assert.equal(await db.deleteContact(contact.id), true);

    // Daily metrics upsert deduplication (same date + platform updates in place)
    await db.upsertDailyChannelMetric({
      recordedAt: "2026-11-28",
      platform: "youtube",
      subscribers: 1200,
      totalViews: 45000,
      notes: "morning",
    });
    await db.upsertDailyChannelMetric({
      recordedAt: "2026-11-28",
      platform: "youtube",
      subscribers: 1235,
      totalViews: 46100,
      notes: "evening",
    });
    const metrics = await db.listChannelMetrics(10);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].subscribers, 1235);

    // Studio meta + memories
    await db.setStudioMeta("timezone", "Asia/Jakarta");
    assert.equal(await db.getStudioMeta("timezone"), "Asia/Jakarta");
    await db.deleteStudioMeta("timezone");
    assert.equal(await db.getStudioMeta("timezone"), null);

    const mem = await db.upsertStudioMemory({
      category: "opsec",
      content: "Never share private handles",
      tags: ["safety"],
    });
    assert.equal((await db.listStudioMemories({ category: "opsec" })).length, 1);
    assert.equal(await db.deleteStudioMemory(mem.id), true);
  });

  it("tracks studio_jobs lifecycle and reconciles orphaned running jobs on restart", async () => {
    const job = await db.createStudioJob({
      kind: "thumbnail",
      title: "Build Friday Thumbnail",
      slug: "friday-stream",
      status: "running",
      stage: "rendering",
      prompt: "Render 1280x720 thumbnail",
    });
    assert.equal(job.status, "running");
    const reconciled = await db.reconcileOrphanedStudioJobs();
    assert.equal(reconciled, 1);
    const afterReconcile = await db.getStudioJob(job.id);
    assert.equal(afterReconcile?.status, "failed");
    assert.match(afterReconcile?.error || "", /restarted|interrupted/i);
  });

  it("enforces strict read-only SQL allowlist on runReadOnlySql (blocks all mutations & multi-statements)", async () => {
    const okSelect = await db.runReadOnlySql("SELECT COUNT(*) AS cnt FROM calendar_events");
    assert.equal(Number(okSelect.rows[0].cnt), 1);

    const okWith = await db.runReadOnlySql("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
    assert.equal(Number(okWith.rows[0].n), 1);

    const okPragma = await db.runReadOnlySql("PRAGMA table_info(contacts)");
    assert.ok(okPragma.rows.length > 0);

    const blockedQueries = [
      "DROP TABLE contacts",
      "DELETE FROM calendar_events",
      "UPDATE calendar_events SET title = 'hacked'",
      "INSERT INTO studio_meta(key, value, updated_at) VALUES ('a','b','c')",
      "ALTER TABLE contacts ADD COLUMN evil TEXT",
      "ATTACH DATABASE '/tmp/x.db' AS evil",
      "SELECT 1; DROP TABLE contacts",
      "PRAGMA journal_mode = DELETE",
    ];
    for (const q of blockedQueries) {
      await assert.rejects(() => db.runReadOnlySql(q), /Read-only|Single|not allowed|blocked|Only/i);
    }
  });
});
