import { describe, it, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  createMockExtensionApi,
  installExtensionModuleHooks,
} from "./helpers/extension-harness.ts";

// Isolate all filesystem & SQLite state before importing any extension module
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otto-ext-suite-"));
const tmpWorkspace = path.join(tmpHome, "workspace");
const tmpOutsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-outside-"));
fs.mkdirSync(path.join(tmpWorkspace, "clips"), { recursive: true });
fs.mkdirSync(path.join(tmpWorkspace, "thumbnails"), { recursive: true });
fs.mkdirSync(path.join(tmpWorkspace, "assets"), { recursive: true });

process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.LMA_WORKSPACE_DIR = tmpWorkspace;
process.env.LMA_CONFIG_DIR = path.join(tmpHome, ".config", "lma");
process.env.LMA_STUDIO_APPS_DIR = path.join(tmpHome, ".omp", "agent", "studio-apps");
process.env.LMA_FORCE_SQLITE = "1";
process.env.LMA_STUDIO_DB_PATH = path.join(tmpHome, "studio.db");

installExtensionModuleHooks();

// Directly import ALL 22 agent extensions (zero node_modules required)
const extModules: Record<string, { default: (pi: ExtensionAPI) => void }> = {
  "box-gateway.ts": await import("../agent/extensions/box-gateway.ts"),
  "calendar.ts": await import("../agent/extensions/calendar.ts"),
  "cloud-memory.ts": await import("../agent/extensions/cloud-memory.ts"),
  "composio-youtube.ts": await import("../agent/extensions/composio-youtube.ts"),
  "creator-archive.ts": await import("../agent/extensions/creator-archive.ts"),
  "exa-gateway.ts": await import("../agent/extensions/exa-gateway.ts"),
  "firecrawl-gateway.ts": await import("../agent/extensions/firecrawl-gateway.ts"),
  "instagram.ts": await import("../agent/extensions/instagram.ts"),
  "media-reviewer.ts": await import("../agent/extensions/media-reviewer.ts"),
  "new-session.ts": await import("../agent/extensions/new-session.ts"),
  "obs-overlays.ts": await import("../agent/extensions/obs-overlays.ts"),
  "pixabay.ts": await import("../agent/extensions/pixabay.ts"),
  "qstash-scheduler.ts": await import("../agent/extensions/qstash-scheduler.ts"),
  "social-channels.ts": await import("../agent/extensions/social-channels.ts"),
  "studio-apps.ts": await import("../agent/extensions/studio-apps.ts"),
  "studio-db.ts": await import("../agent/extensions/studio-db.ts"),
  "studio-jobs.ts": await import("../agent/extensions/studio-jobs.ts"),
  "studio-system.ts": await import("../agent/extensions/studio-system.ts"),
  "thumbnails.ts": await import("../agent/extensions/thumbnails.ts"),
  "tiktok.ts": await import("../agent/extensions/tiktok.ts"),
  "vod-clipper.ts": await import("../agent/extensions/vod-clipper.ts"),
  "x-twitter.ts": await import("../agent/extensions/x-twitter.ts"),
};

const { resetApifyGatewayCache } = await import("../agent/lib/apify.ts");
const { resetBoxGatewayCache } = await import("../agent/lib/box.ts");

const harness = createMockExtensionApi();
for (const mod of Object.values(extModules)) {
  mod.default(harness.api);
}

after(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // Windows holds open SQLite handles until process exit
  }
  try {
    fs.rmSync(tmpOutsideDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup race
  }
});

describe("All 22 agent/extensions/*.ts direct registration & 85-tool contract", () => {
  it("loads every extension file on disk and registers exactly 85 uniquely named tools plus --new flag", () => {
    const repoExtFiles = fs
      .readdirSync(path.resolve(import.meta.dirname, "..", "agent", "extensions"))
      .filter((f) => f.endsWith(".ts"))
      .sort();
    assert.deepEqual(Object.keys(extModules).sort(), repoExtFiles);
    assert.equal(repoExtFiles.length, 22);
    assert.equal(harness.tools.size, 85);

    for (const [name, tool] of harness.tools) {
      assert.ok(name.length > 0);
      assert.ok(tool.label && tool.label.length > 0, `Tool ${name} missing label`);
      assert.ok(tool.description && tool.description.length > 10, `Tool ${name} missing description`);
      assert.equal(typeof tool.parameters, "object", `Tool ${name} missing parameters schema`);
      assert.equal(typeof tool.execute, "function", `Tool ${name} missing execute()`);
    }

    assert.ok(harness.flags.has("new"));
    assert.equal(harness.handlers.get("session_start")?.length, 1);
  });
});

describe("VOD Clipper & Media Reviewer extension behavior + security confinement", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SPRITES_GEMINI_GATEWAY;
  });

  it("vod_scan_hype rejects invalid URLs and handles cached transcript-only fallback cleanly offline", async () => {
    const scanTool = harness.getTool("vod_scan_hype");
    await assert.rejects(
      () => scanTool.execute("c1", { url: "https://evil.example/not-youtube" }),
      /Could not extract 11-character YouTube video ID/i
    );

    // Seed a cached transcript file with no chat file to exercise the real fallback branch
    const vid = "dQw4w9WgXcQ";
    const vidDir = path.join(tmpWorkspace, "clips", vid);
    fs.mkdirSync(vidDir, { recursive: true });
    fs.writeFileSync(
      path.join(vidDir, `${vid}.transcript.json`),
      JSON.stringify({
        metadata: { title: "Demo Stream" },
        segments: [
          { start_ms: 1000, start_str: "00:00:01", text: "Welcome to the boss fight!" },
          { start_ms: 25000, start_str: "00:00:25", text: "Wait no way we cleared it on attempt one!" },
        ],
      })
    );

    const out = await scanTool.execute("c2", { url: `https://youtu.be/${vid}`, topK: 5 });
    const text = out.content[0].text;
    assert.match(text, /transcript_only_fallback/);
    assert.match(text, /boss fight/i);
  });

  it("vod_prep_clip rejects missing files and path escapes outside workspace; vod_save_clip & vod_list_clips persist to SQLite", async () => {
    const prepTool = harness.getTool("vod_prep_clip");
    const outsideFile = path.join(tmpOutsideDir, "secret.mp4");
    fs.writeFileSync(outsideFile, "FAKE_MP4");

    await assert.rejects(
      () => prepTool.execute("c1", { inputPath: path.join(tmpWorkspace, "missing.mp4") }),
      /not found/i
    );
    await assert.rejects(
      () => prepTool.execute("c2", { inputPath: outsideFile }),
      /must exist inside/i
    );

    const saveClip = harness.getTool("vod_save_clip");
    const listClips = harness.getTool("vod_list_clips");
    const saved = await saveClip.execute("c3", {
      videoId: "Icp_tjjgmvI",
      title: "Clutch Boss Dodge",
      filePath: "clips/Icp_tjjgmvI/clip_01.mp4",
      srtPath: "clips/Icp_tjjgmvI/clip_01.srt",
      startSec: 120,
      endSec: 185,
      hookScore: 9,
      editorNotes: "Cut 1.2s dead air at start",
    });
    assert.match(saved.content[0].text, /Clutch Boss Dodge/);

    const listed = await listClips.execute("c4", { videoId: "Icp_tjjgmvI" });
    const parsed = JSON.parse(listed.content[0].text) as { count: number; clips: Array<{ title: string }> };
    assert.equal(parsed.count, 1);
    assert.equal(parsed.clips[0].title, "Clutch Boss Dodge");
  });

  it("watch_clip & critique_thumbnail enforce workspace confinement, block SSRF, and call zero-key Gemini gateway", async () => {
    const watchTool = harness.getTool("watch_clip");
    const critiqueTool = harness.getTool("critique_thumbnail");
    const outsideFile = path.join(tmpOutsideDir, "outside.png");
    fs.writeFileSync(outsideFile, Buffer.from("PNG"));

    await assert.rejects(() => watchTool.execute("c1", { pathOrUrl: outsideFile }), /must reside inside/i);
    await assert.rejects(
      () => critiqueTool.execute("c2", { imagePathOrUrl: "http://example.com/thumb.jpg" }),
      /https:\/\//i
    );
    await assert.rejects(
      () => critiqueTool.execute("c3", { imagePathOrUrl: "https://169.254.169.254/latest/meta-data" }),
      /Refused private\/reserved/i
    );

    // Local thumbnail inside workspace -> sends base64 inlineData to zero-key Gemini gateway
    const localThumb = path.join(tmpWorkspace, "thumbnails", "squint-test.png");
    fs.writeFileSync(localThumb, Buffer.from("FAKE_PNG_DATA"));
    process.env.SPRITES_GEMINI_GATEWAY = "https://api.sprites.dev/v1/gateway/gemini/gem_test";

    let capturedUrl = "";
    let capturedAuth: string | null = "unset";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedAuth = new Headers(init?.headers).get("authorization");
      return Response.json({
        candidates: [{ content: { parts: [{ text: "Verdict: Pass — crisp focal point at 120px." }] } }],
      });
    }) as typeof fetch;

    const res = await critiqueTool.execute("c4", {
      imagePathOrUrl: localThumb,
      videoTitle: "Boss Rush Finale",
    });
    assert.match(capturedUrl, /^https:\/\/api\.sprites\.dev\/v1\/gateway\/gemini\/gem_test\/v1beta\/models\/.+:generateContent$/);
    assert.equal(capturedAuth, null);
    assert.match(res.content[0].text, /Verdict: Pass/);
  });
});

describe("QStash Scheduler & Calendar extension tools", () => {
  const originalFetch = globalThis.fetch;
  const savedPublicUrl = process.env.LMA_PUBLIC_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedPublicUrl === undefined) delete process.env.LMA_PUBLIC_URL;
    else process.env.LMA_PUBLIC_URL = savedPublicUrl;
  });

  it("schedule_wakeup validates inputs, publishes zero-key QStash job, lists & cancels it in SQLite", async () => {
    const scheduleTool = harness.getTool("schedule_wakeup");
    const listTool = harness.getTool("list_wakeups");
    const cancelTool = harness.getTool("cancel_wakeup");

    await assert.rejects(
      () => scheduleTool.execute("c1", { label: "Bad", prompt: "Hi" }),
      /Provide either runAt, delaySeconds, or cron/i
    );
    await assert.rejects(
      () => scheduleTool.execute("c2", { label: "Bad", prompt: "Hi", runAt: "not-a-date" }),
      /Invalid runAt/i
    );

    process.env.LMA_PUBLIC_URL = "https://otto.sprites.app";
    const gatewayCalls: Array<{ url: string; method: string; auth: string | null; cronHeader: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      gatewayCalls.push({
        url,
        method: init?.method || "GET",
        auth: headers.get("authorization"),
        cronHeader: headers.get("upstash-cron"),
      });
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json({
          connections: [
            {
              provider: "custom_api",
              display_name: "Upstash QStash",
              gateway_base_url: "https://api.sprites.dev/v1/gateway/custom_api/qstash_1",
            },
          ],
        });
      }
      if (url.includes("/v2/schedules/")) {
        if (init?.method === "DELETE") return new Response("", { status: 200 });
        return Response.json({ scheduleId: "scd_test_123" });
      }
      if (url.endsWith("/v2/schedules")) {
        return Response.json([{ scheduleId: "scd_test_123", cron: "CRON_TZ=Asia/Jakarta 0 0 * * *" }]);
      }
      if (url.includes("/v2/publish/")) {
        return Response.json({ messageId: "msg_oneshot_99" });
      }
      if (url.includes("/v2/messages/")) {
        return new Response("", { status: 200 });
      }
      throw new Error(`Unexpected QStash URL: ${url}`);
    }) as typeof fetch;

    // Reject CRLF header injection in CRON_TZ
    await assert.rejects(
      () =>
        scheduleTool.execute("c3", {
          label: "Injected",
          prompt: "Hi",
          cron: "CRON_TZ=Asia/Jakarta 0 0 * * *\r\nX-Inject: 1",
        }),
      /single line/i
    );

    // Valid recurring CRON_TZ schedule
    const sched = await scheduleTool.execute("c4", {
      label: "Daily Midnight Snapshot",
      prompt: "Run daily studio summary",
      cron: "CRON_TZ=Asia/Jakarta 0 0 * * *",
    });
    const parsedSched = JSON.parse(sched.content[0].text) as { ok: boolean; kind: string; cron: string };
    assert.equal(parsedSched.ok, true);
    assert.equal(parsedSched.kind, "recurring_cron");
    assert.equal(parsedSched.cron, "CRON_TZ=Asia/Jakarta 0 0 * * *");
    assert.ok(gatewayCalls.every((c) => c.auth === null));
    assert.ok(gatewayCalls.some((c) => c.cronHeader === "CRON_TZ=Asia/Jakarta 0 0 * * *"));

    // List and cancel cleanly
    const listed = await listTool.execute("c5", {});
    assert.match(listed.content[0].text, /scd_test_123/);

    const cancelled = await cancelTool.execute("c6", { id: "scd_test_123", kind: "recurring_cron" });
    assert.equal(JSON.parse(cancelled.content[0].text).ok, true);
  });

  it("calendar_add_event, calendar_list_events, and calendar_cancel_event persist locally and skip past hooks", async () => {
    const addEvt = harness.getTool("calendar_add_event");
    const listEvts = harness.getTool("calendar_list_events");
    const cancelEvt = harness.getTool("calendar_cancel_event");

    globalThis.fetch = (async () => Response.json({ connections: [] })) as unknown as typeof fetch;

    const added = await addEvt.execute("c1", {
      title: "Friday Boss Stream",
      type: "stream",
      startAt: "2020-01-01T19:00:00+07:00",
      hooks: ["promo_24h"],
    });
    const parsed = JSON.parse(added.content[0].text) as {
      ok: boolean;
      event: { id: string; title: string };
      skippedHooks: Array<{ preset: string }>;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event.title, "Friday Boss Stream");
    assert.equal(parsed.skippedHooks.length, 1);
    assert.equal(parsed.skippedHooks[0].preset, "promo_24h");

    const listed = await listEvts.execute("c2", {});
    assert.match(listed.content[0].text, /Friday Boss Stream/);

    const cancelled = await cancelEvt.execute("c3", { eventId: parsed.event.id });
    assert.equal(JSON.parse(cancelled.content[0].text).ok, true);
  });
});

describe("Per-Channel Social extensions (x-twitter, tiktok, instagram, social-channels)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetApifyGatewayCache();
    delete process.env.SPRITES_BUFFER_GATEWAY_URL;
    delete process.env.SPRITES_APIFY_GATEWAY_URL;
  });

  it("enforces draft-first (saveToDraft=true default) across x_post, tiktok_post, and instagram_post with zero Authorization headers", async () => {
    process.env.SPRITES_BUFFER_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/custom_api/buf_test";
    const createdInputs: Array<{ channelId: string; saveToDraft: boolean; text: string }> = [];
    const authHeaders: Array<string | null> = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      const body = JSON.parse(String(init?.body || "{}")) as {
        query?: string;
        variables?: { input?: { channelId: string; saveToDraft: boolean; text: string } };
      };
      if (body.query?.includes("organizations")) {
        return Response.json({ data: { account: { organizations: [{ id: "org_1", name: "Studio" }] } } });
      }
      if (body.query?.includes("channels(")) {
        return Response.json({
          data: {
            channels: [
              { id: "ch_x", name: "x_acct", displayName: "@creator", service: "twitter", isDisconnected: false },
              { id: "ch_tt", name: "tt_acct", displayName: "@creator", service: "tiktok", isDisconnected: false },
              { id: "ch_ig", name: "ig_acct", displayName: "@creator", service: "instagram", isDisconnected: false },
            ],
          },
        });
      }
      if (body.query?.includes("createPost")) {
        const inp = body.variables!.input!;
        createdInputs.push({ channelId: inp.channelId, saveToDraft: inp.saveToDraft, text: inp.text });
        return Response.json({
          data: { createPost: { post: { id: `post_${inp.channelId}`, text: inp.text, status: "draft" } } },
        });
      }
      throw new Error(`Unexpected Buffer GraphQL: ${body.query}`);
    }) as typeof fetch;

    const listCh = await harness.getTool("social_list_channels").execute("c0", {});
    assert.equal((JSON.parse(listCh.content[0].text) as unknown[]).length, 3);

    await harness.getTool("x_post").execute("c1", { text: "Live tonight at 8pm!" });
    await harness.getTool("tiktok_post").execute("c2", { text: "Clip drop #gaming" });
    await harness.getTool("instagram_post").execute("c3", { text: "New schedule graphic!" });

    assert.equal(createdInputs.length, 3);
    assert.ok(createdInputs.every((i) => i.saveToDraft === true), "All 3 social post tools must default to saveToDraft=true");
    assert.deepEqual(
      createdInputs.map((i) => i.channelId),
      ["ch_x", "ch_tt", "ch_ig"]
    );
    assert.ok(authHeaders.every((h) => h === null));
  });

  it("cleans handles/hashtags and calls curated Apify actors on x_read, tiktok_read, and instagram_read", async () => {
    process.env.SPRITES_APIFY_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/apify/ap_test";
    const actorInputs: Array<{ url: string; body: Record<string, unknown> }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/runs?waitForFinish=60")) {
        actorInputs.push({ url, body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown> });
        return Response.json({ data: { id: "run_1", status: "SUCCEEDED", defaultDatasetId: "ds_1" } });
      }
      if (url.includes("/datasets/ds_1/items")) {
        return Response.json([{ id: "item_1", text: "Sample post", fullText: "Sample post", likeCount: 42 }]);
      }
      throw new Error(`Unexpected Apify URL: ${url}`);
    }) as typeof fetch;

    const xRes = await harness.getTool("x_read").execute("c1", { mode: "profile", query: "https://x.com/@demo_creator/", limit: 99 });
    const ttRes = await harness.getTool("tiktok_read").execute("c2", { mode: "hashtag", query: "#vtuber id" });
    const igRes = await harness.getTool("instagram_read").execute("c3", { mode: "profile", target: "@demo_ig" });

    assert.equal(JSON.parse(xRes.content[0].text).count, 1);
    assert.deepEqual(actorInputs[0].body.searchTerms, ["from:demo_creator"]);
    assert.equal(actorInputs[0].body.maxItems, 25); // clamped from 99 -> 25
    assert.deepEqual(actorInputs[1].body.hashtags, ["vtuberid"]);
    assert.equal(JSON.parse(ttRes.content[0].text).count, 1);
    assert.equal(JSON.parse(igRes.content[0].text).platform, "instagram");
  });
});

describe("Remaining 12 extensions (DB, Thumbnails, Apps, OBS, Box, Pixabay, Exa, Firecrawl, YouTube, Archive, Memory, Jobs, System, NewSession)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetBoxGatewayCache();
    delete process.env.LMA_INTERNAL_SECRET;
    delete process.env.SPRITES_PIXABAY_GATEWAY_URL;
    delete process.env.SPRITES_COMPOSIO_GATEWAY_URL;
    delete process.env.SPRITES_EXA_CONNECTOR_ID;
    delete process.env.SPRITES_FIRECRAWL_CONNECTOR_ID;
  });

  it("exercises thumbnails.ts, studio-apps.ts, studio-db.ts, and cloud-memory.ts end-to-end", async () => {
    // Thumbnails extension lifecycle
    const tSave = await harness.getTool("thumbnail_save").execute("t1", {
      slug: "ext-boss-thumb",
      title: "Boss Fight Thumb",
      html: "<div>1280x720</div>",
      autoOpen: false,
    });
    assert.equal(JSON.parse(tSave.content[0].text).ok, true);
    const tList = JSON.parse((await harness.getTool("thumbnail_list").execute("t2", {})).content[0].text) as { count: number };
    assert.ok(tList.count >= 1);
    const tGet = JSON.parse((await harness.getTool("thumbnail_get").execute("t3", { slug: "ext-boss-thumb" })).content[0].text) as { html: string };
    assert.match(tGet.html, /1280x720/);
    const tDel = JSON.parse((await harness.getTool("thumbnail_delete").execute("t4", { slug: "ext-boss-thumb" })).content[0].text) as { ok: boolean };
    assert.equal(tDel.ok, true);

    // Custom Studio Apps extension lifecycle
    const aCreate = await harness.getTool("studio_app_create").execute("a1", {
      slug: "ext-subathon",
      title: "Subathon Timer",
      kind: "html",
      code: "<div>Timer</div>",
      initialState: { mins: 60 },
      autoOpen: false,
    });
    assert.equal(JSON.parse(aCreate.content[0].text).ok, true);
    const aState = await harness.getTool("studio_app_state").execute("a2", {
      slug: "ext-subathon",
      patch: { mins: 90 },
    });
    assert.match(aState.content[0].text, /90/);
    const aList = JSON.parse((await harness.getTool("studio_app_list").execute("a3", {})).content[0].text) as { count: number };
    assert.ok(aList.count >= 1);
    await harness.getTool("studio_app_delete").execute("a4", { slug: "ext-subathon" });

    // Studio DB extension lifecycle + read-only SQL enforcement
    const pipe = await harness.getTool("studio_pipeline_upsert").execute("db1", {
      title: "Patch Notes Reaction",
      format: "stream",
      status: "idea",
    });
    const pipeId = (JSON.parse(pipe.content[0].text) as { item: { id: string } }).item.id;
    const pipeList = JSON.parse((await harness.getTool("studio_pipeline_list").execute("db2", {})).content[0].text) as { count: number };
    assert.ok(pipeList.count >= 1);
    const overview = JSON.parse((await harness.getTool("studio_db_overview").execute("db3", {})).content[0].text) as { tables: { content_pipeline: number } };
    assert.ok(overview.tables.content_pipeline >= 1);
    await assert.rejects(
      () => harness.getTool("studio_db_query").execute("db4", { sql: "DROP TABLE content_pipeline" }),
      /read-only|SELECT/i
    );
    await harness.getTool("studio_pipeline_delete").execute("db5", { id: pipeId });

    // Cloud memory extension (SQLite local persistence when Pinecone connector unavailable)
    globalThis.fetch = (async () => Response.json({ connections: [] })) as unknown as typeof fetch;
    const mem = await harness.getTool("memory_remember").execute("m1", {
      content: "Never use AI thumbnails; always commission human artists.",
      category: "preference",
      tags: ["art", "policy"],
    });
    const memId = (mem.details as { memory: { id: string } }).memory.id;
    const memList = JSON.parse((await harness.getTool("memory_list").execute("m2", {})).content[0].text) as { count: number };
    assert.ok(memList.count >= 1);
    const memForget = JSON.parse((await harness.getTool("memory_forget").execute("m3", { id: memId })).content[0].text) as { ok: boolean };
    assert.equal(memForget.ok, true);
  });

  it("enforces path confinement on obs-overlays.ts, box-gateway.ts, and pixabay.ts, and filters AI images in Pixabay", async () => {
    await assert.rejects(
      () =>
        harness.getTool("obs_overlay_deploy").execute("o1", {
          slug: "bad-overlay",
          title: "Bad",
          html: "<div></div>",
          assets: ["../../etc/passwd"],
        }),
      /escapes/i
    );
    await assert.rejects(
      () => harness.getTool("box_upload_file").execute("b1", { workspacePath: "../../etc/passwd" }),
      /escapes/i
    );
    await assert.rejects(
      () =>
        harness.getTool("pixabay_download_image").execute("p1", {
          imageUrl: "https://cdn.pixabay.com/photo/demo.jpg",
          destWorkspacePath: "../../escape.jpg",
        }),
      /escapes/i
    );

    process.env.SPRITES_PIXABAY_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/custom_api/pix_1";
    globalThis.fetch = (async () =>
      Response.json({
        totalHits: 2,
        hits: [
          {
            id: 1,
            tags: "ai-generated, neon, city",
            largeImageURL: "https://cdn.pixabay.com/ai.jpg",
            isAiGenerated: true,
          },
          {
            id: 2,
            tags: "dark library, warm lamp",
            heading: "Warm Library",
            largeImageURL: "https://cdn.pixabay.com/real-library.jpg",
            isAiGenerated: false,
            isLowQuality: false,
          },
        ],
      })) as unknown as typeof fetch;

    const pix = await harness.getTool("pixabay_search_backgrounds").execute("p2", { query: "dark library" });
    const parsed = JSON.parse(pix.content[0].text) as { filteredOutAi: number; hits: Array<{ id: number }> };
    assert.equal(parsed.filteredOutAi, 1);
    assert.equal(parsed.hits.length, 1);
    assert.equal(parsed.hits[0].id, 2);
  });

  it("exercises exa-gateway.ts, firecrawl-gateway.ts, composio-youtube.ts, and creator-archive.ts via mocked zero-key gateways", async () => {
    process.env.SPRITES_EXA_CONNECTOR_ID = "exa_1";
    process.env.SPRITES_FIRECRAWL_CONNECTOR_ID = "fc_1";
    process.env.SPRITES_COMPOSIO_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/custom_api/comp_1";

    const authHeaders: Array<string | null> = [];
    let broadcastPrivacy = "";

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url.endsWith("/exa_1/search")) return Response.json({ results: [{ title: "Exa Hit" }] });
      if (url.endsWith("/fc_1/v1/scrape")) return Response.json({ data: { markdown: "# Clean Page" } });
      if (url.includes("/api/v3/connected_accounts")) {
        return Response.json({
          items: [{ id: "ca_yt_1", status: "ACTIVE", user_id: "usr_1", toolkit: { slug: "youtube" } }],
        });
      }
      if (url.includes("/api/v3/tools?toolkit_slug=youtube")) {
        return Response.json({ items: [{ slug: "YOUTUBE_LIST_CHANNEL_VIDEOS", description: "List videos" }] });
      }
      if (url.endsWith("/api/v3/tools/execute/proxy")) {
        const body = JSON.parse(String(init?.body || "{}")) as {
          body?: { status?: { privacyStatus?: string } };
        };
        broadcastPrivacy = body.body?.status?.privacyStatus || "";
        return Response.json({ data: { id: "live_bc_1", snippet: { title: "Friday Stream" } } });
      }
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json({ connections: [] });
      }
      throw new Error(`Unexpected gateway URL: ${url}`);
    }) as typeof fetch;

    const exa = await harness.getTool("exa_search").execute("e1", { query: "indie vtuber mic setup" });
    assert.match(exa.content[0].text, /Exa Hit/);

    const fc = await harness.getTool("firecrawl_scrape").execute("f1", { url: "https://example.com" });
    assert.match(fc.content[0].text, /Clean Page/);

    const ytTools = await harness.getTool("youtube_list_tools").execute("y1", {});
    assert.match(ytTools.content[0].text, /YOUTUBE_LIST_CHANNEL_VIDEOS/);

    // Verify default privacyStatus is safely 'unlisted'
    const ytLive = await harness.getTool("youtube_schedule_live_broadcast").execute("y2", {
      title: "Friday Stream",
      scheduledStartTime: "2026-12-20T19:30:00+07:00",
    });
    assert.equal(broadcastPrivacy, "unlisted");
    assert.equal(JSON.parse(ytLive.content[0].text).broadcastId, "live_bc_1");

    const archiveStat = await harness.getTool("archive_status").execute("ar1", {});
    assert.equal(JSON.parse(archiveStat.content[0].text).connected, false);
    assert.ok(authHeaders.every((h) => h === null));
  });

  it("exercises studio-jobs.ts, studio-system.ts (internal IPC auth), and new-session.ts (--new hook deduplication)", async () => {
    // Fail-closed without LMA_INTERNAL_SECRET
    await assert.rejects(() => harness.getTool("studio_jobs_list").execute("j0", {}), /LMA_INTERNAL_SECRET/i);
    await assert.rejects(() => harness.getTool("system_diagnostics").execute("s0", {}), /LMA_INTERNAL_SECRET/i);

    process.env.LMA_INTERNAL_SECRET = "internal_test_secret_123456";
    const internalCalls: Array<{ url: string; auth: string | null; body: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      internalCalls.push({
        url,
        auth: new Headers(init?.headers).get("authorization"),
        body: String(init?.body || ""),
      });
      if (url.includes("/api/internal/jobs/job_42/nudge")) return Response.json({ ok: true, nudged: true });
      if (url.includes("/api/internal/jobs")) return Response.json({ ok: true, jobs: [{ id: "job_42" }] });
      if (url.includes("/api/internal/checkpoints")) return Response.json({ ok: true, id: "v30" });
      if (url.includes("/api/internal/system/status")) return Response.json({ ok: true, connectors: [] });
      throw new Error(`Unexpected internal URL: ${url}`);
    }) as typeof fetch;

    const jobs = await harness.getTool("studio_jobs_list").execute("j1", { kind: "clip", status: "running" });
    assert.equal(JSON.parse(jobs.content[0].text).count, 1);

    await harness.getTool("studio_job_nudge").execute("j2", {
      jobId: "job_42",
      message: "Keep hook under 3 seconds",
    });
    assert.match(internalCalls[1].body, /"mode":"steer"/);

    await harness.getTool("system_diagnostics").execute("s1", {});
    await harness.getTool("checkpoint_create").execute("s2", { comment: "pre-edit" });
    assert.ok(internalCalls.every((c) => c.auth === "Bearer internal_test_secret_123456"));

    // new-session.ts hook: no-op when --new is false, runs once when true (WeakSet dedup)
    let newSessionCalls = 0;
    const nsHarness = createMockExtensionApi({
      MAIN_AGENT_ID: "main",
      AgentRegistry: {
        global: () => ({
          get: () => ({
            session: {
              newSession: async () => {
                newSessionCalls += 1;
                return true;
              },
            },
          }),
        }),
      },
    });
    extModules["new-session.ts"].default(nsHarness.api);
    const onStart = nsHarness.handlers.get("session_start")![0];
    const fakeSessionManager = { getEntries: () => [{ id: 1 }] };
    const ctx = { sessionManager: fakeSessionManager, agent: { kind: "main" }, mode: "rpc" };

    await onStart({}, ctx);
    assert.equal(newSessionCalls, 0);

    nsHarness.flagValues.set("new", true);
    await onStart({}, ctx);
    await onStart({}, ctx); // deduplicated for same sessionManager
    assert.equal(newSessionCalls, 1);
  });
});
