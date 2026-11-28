import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-routes-test-"));
process.env.LMA_DISABLE_AUTO_SPAWN = "1";
process.env.LMA_FORCE_SQLITE = "1";
process.env.LMA_STUDIO_DB_PATH = path.join(tmpDir, "routes.db");
process.env.LMA_WORKSPACE_DIR = path.join(tmpDir, "workspace");

const { LMA_INTERNAL_SECRET } = await import("../web/lib/config.ts");
const { handleInternalRoutes } = await import("../web/routes/internal.ts");
const { handleCalendarRoutes } = await import("../web/routes/calendar.ts");
const { handleClipsRoutes } = await import("../web/routes/clips.ts");
const { handleDbRoutes } = await import("../web/routes/db.ts");
const { handleChatRoutes } = await import("../web/routes/chat.ts");
const { rpc } = await import("../web/lib/rpc-bridge.ts");
const db = await import("../agent/lib/studio-db.ts");

describe("HTTP routes security boundaries & end-to-end handlers", () => {
  before(() => {
    db.resetStudioDbForTests();
  });

  after(() => {
    db.resetStudioDbForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("blocks all /api/internal/* endpoints without ephemeral LMA_INTERNAL_SECRET (403) and accepts valid secret", async () => {
    const endpoints = [
      ["POST", "/api/internal/llm/v1/chat/completions"],
      ["POST", "/api/internal/studio-app/open"],
      ["POST", "/api/internal/obs-overlay/open"],
      ["POST", "/api/internal/thumbnail/open"],
      ["POST", "/api/internal/jobs/dispatch"],
    ] as const;

    for (const [method, p] of endpoints) {
      const req = new Request(`http://127.0.0.1:8080${p}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "test" }),
      });
      const res = await handleInternalRoutes(req, new URL(req.url));
      assert.equal(res?.status, 403, `Expected 403 for unauthenticated ${p}`);
    }

    const okReq = new Request("http://127.0.0.1:8080/api/internal/studio-app/open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LMA_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ slug: "countdown", title: "Countdown" }),
    });
    const okRes = await handleInternalRoutes(okReq, new URL(okReq.url));
    assert.equal(okRes?.status, 200);
  });

  it("rejects path traversal and non-mp4/srt filenames on /api/clips/file/*", async () => {
    // Raw URL dot-segments normalize out of /api/clips/file/ (handler returns null -> server 404)
    const rawTrav = "http://localhost:8080/api/clips/file/../../etc/passwd";
    const rawRes = await handleClipsRoutes(new Request(rawTrav), new URL(rawTrav));
    assert.equal(rawRes, null);

    // Encoded traversal & disallowed filenames hitting /api/clips/file/* directly must be 400/404
    const badUrls = [
      "http://localhost:8080/api/clips/file/abc12345/secret.env",
      "http://localhost:8080/api/clips/file/..%2F..%2Fetc/passwd.mp4",
      "http://localhost:8080/api/clips/file/short/clip.mp4",
      "http://localhost:8080/api/clips/file/validvid1/nonexistent.mp4",
    ];
    for (const u of badUrls) {
      const req = new Request(u);
      const res = await handleClipsRoutes(req, new URL(u));
      assert.ok(res && (res.status === 400 || res.status === 404), `Expected 400/404 for ${u}`);
    }
  });

  it("exports valid RFC 5545 VCALENDAR with VALARM reminders from /api/calendar/export.ics", async () => {
    const now = new Date().toISOString();
    await db.upsertCalendarEvent({
      id: "evt_ics_1",
      title: "Launch Stream",
      type: "stream",
      startAt: "2026-12-01T13:00:00Z",
      endAt: "2026-12-01T15:00:00Z",
      cron: null,
      notes: "Big day",
      status: "planned",
      source: "local",
      wakeups: [
        {
          qstashId: "msg_1",
          kind: "one_shot",
          label: "Pre-stream 15m check",
          triggerAt: "2026-12-01T12:45:00Z",
          cron: null,
          offsetMinutes: -15,
          prompt: "Verify OBS overlays",
          status: "armed",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const req = new Request("http://localhost:8080/api/calendar/export.ics");
    const res = await handleCalendarRoutes(req, new URL(req.url));
    assert.equal(res?.status, 200);
    assert.match(res?.headers.get("content-type") || "", /text\/calendar/);
    const ics = await res!.text();
    assert.match(ics, /^BEGIN:VCALENDAR/);
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /SUMMARY:.*Launch Stream/);
    assert.match(ics, /BEGIN:VALARM/);
    assert.match(ics, /END:VCALENDAR\s*$/);
  });

  it("handles /api/db/pipeline POST -> GET -> PATCH -> DELETE CRUD lifecycle cleanly", async () => {
    const createReq = new Request("http://localhost:8080/api/db/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Collab Idea", format: "collab", status: "idea" }),
    });
    const createRes = await handleDbRoutes(createReq, new URL(createReq.url));
    assert.equal(createRes?.status, 200);
    const created = (await createRes!.json()) as { ok: boolean; item: { id: string; title: string } };
    assert.equal(created.ok, true);
    assert.equal(created.item.title, "Collab Idea");

    const patchReq = new Request(`http://localhost:8080/api/db/pipeline/${created.item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "prepping", evilColumn: "ignored" }),
    });
    const patchRes = await handleDbRoutes(patchReq, new URL(patchReq.url));
    assert.equal(patchRes?.status, 200);
    const patched = (await patchRes!.json()) as { item: { status: string } };
    assert.equal(patched.item.status, "prepping");

    const delReq = new Request(`http://localhost:8080/api/db/pipeline/${created.item.id}`, {
      method: "DELETE",
    });
    const delRes = await handleDbRoutes(delReq, new URL(delReq.url));
    assert.equal(delRes?.status, 200);
    assert.equal(((await delRes!.json()) as { ok: boolean }).ok, true);
  });

  it("rejects empty /api/chat messages with 400 and returns 200 ok on valid prompt", async () => {
    const badReq = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    const badRes = await handleChatRoutes(badReq, new URL(badReq.url));
    assert.equal(badRes?.status, 400);

    const origPrompt = rpc.prompt.bind(rpc);
    (rpc as unknown as { prompt: () => Promise<{ accepted: true; inFlight: boolean }> }).prompt = async () => ({
      accepted: true,
      inFlight: true,
    });
    try {
      const okReq = new Request("http://localhost:8080/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Cut 3 clips from yesterday's VOD" }),
      });
      const okRes = await handleChatRoutes(okReq, new URL(okReq.url));
      assert.equal(okRes?.status, 200);
      assert.deepEqual(await okRes!.json(), { ok: true, inFlight: true });
    } finally {
      (rpc as unknown as { prompt: typeof origPrompt }).prompt = origPrompt;
    }
  });
});
