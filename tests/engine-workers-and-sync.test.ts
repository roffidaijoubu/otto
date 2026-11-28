import { describe, it, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type https from "node:https";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otto-engine-suite-"));
const tmpWorkspace = path.join(tmpHome, "workspace");
fs.mkdirSync(path.join(tmpWorkspace, "assets"), { recursive: true });
fs.mkdirSync(path.join(tmpWorkspace, "briefs"), { recursive: true });

process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.LMA_WORKSPACE_DIR = tmpWorkspace;
process.env.LMA_FORCE_SQLITE = "1";
process.env.LMA_STUDIO_DB_PATH = path.join(tmpHome, "studio.db");
process.env.LMA_DISABLE_AUTO_SPAWN = "1";

const {
  runManagedRpcWorker,
  nudgeManagedWorker,
  cancelManagedWorker,
  getLiveWorkerSnapshot,
  hasActiveManagedWorkers,
} = await import("../web/lib/rpc-worker.ts");
const {
  extractYouTubeVideoId,
  reconcileOrphanedClipJobs,
  cancelBackgroundClipJob,
} = await import("../web/lib/clip-worker.ts");
const {
  createClipJob,
  getClipJob,
  createStudioJob,
  getStudioJob,
} = await import("../agent/lib/studio-db.ts");
const { syncWorkspaceWithBox, getBoxSyncStatus } = await import("../agent/lib/box-sync.ts");
const { resetBoxGatewayCache, BOX_MAX_UPLOAD_BYTES } = await import("../agent/lib/box.ts");
const { getNeonRuntimeInfo } = await import("../agent/lib/neon-db.ts");
const { downloadPixabayImage } = await import("../agent/lib/pixabay.ts");

after(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // Windows holds open SQLite handles until process exit
  }
});

describe("Managed live JSONL RPC worker registry (web/lib/rpc-worker.ts)", () => {
  const fakeWorkerScript = path.join(tmpHome, "fake-omp-rpc.mjs");

  it("spawns a real child RPC worker, streams live tool telemetry, supports steer->follow_up nudge fallback, and cleans up", async () => {
    // Real Node subprocess implementing the omp --mode rpc JSONL protocol
    fs.writeFileSync(
      fakeWorkerScript,
      `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
emit({ type: "ready" });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const cmd = JSON.parse(line);
  if (cmd.type === "prompt") {
    emit({ type: "response", id: cmd.id, command: "prompt", success: true, data: {} });
    emit({ type: "agent_start" });
    emit({ type: "tool_execution_start", toolName: "vod_scan_hype" });
  } else if (cmd.type === "steer") {
    // Force rpc-worker.ts fallback path: steer -> follow_up
    emit({ type: "response", id: cmd.id, command: "steer", success: false, error: "Steer unsupported between steps" });
  } else if (cmd.type === "follow_up") {
    emit({ type: "response", id: cmd.id, command: "follow_up", success: true, data: {} });
    emit({ type: "tool_execution_end", toolName: "vod_scan_hype" });
    emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Applied nudge: " + cmd.message }] },
    });
    emit({ type: "agent_end" });
  } else if (cmd.type === "abort") {
    emit({ type: "response", id: cmd.id, command: "abort", success: true, data: {} });
    process.exit(0);
  }
});
`,
      "utf8"
    );

    const observedTools: string[] = [];
    let workerStartedResolve!: () => void;
    const workerStarted = new Promise<void>((r) => {
      workerStartedResolve = r;
    });

    await createStudioJob({ id: "job_rpc_live_1", kind: "clip", title: "Live RPC Test" });

    const runPromise = runManagedRpcWorker({
      jobId: "job_rpc_live_1",
      kind: "clip",
      tools: "vod_scan_hype",
      prompt: "Scan demo VOD",
      command: [process.execPath, fakeWorkerScript],
      workDir: tmpHome,
      timeoutMs: 10_000,
      onToolStart: (toolName) => {
        observedTools.push(toolName);
        workerStartedResolve();
      },
    });

    await workerStarted;
    assert.equal(hasActiveManagedWorkers(), true);
    const snap = getLiveWorkerSnapshot("job_rpc_live_1");
    assert.ok(snap);
    assert.equal(snap.live, true);
    assert.equal(snap.canNudge, true);
    assert.equal(snap.currentTool, "vod_scan_hype");

    // Nudge live worker mid-flight; verify steer -> follow_up fallback succeeds
    const nudgeRes = await nudgeManagedWorker("job_rpc_live_1", "Keep hook under 3s", "steer");
    assert.equal(nudgeRes.ok, true);
    assert.equal(nudgeRes.modeUsed, "follow_up");
    assert.equal(nudgeRes.snapshot.nudgesCount, 1);

    const result = await runPromise;
    assert.equal(result.ok, true);
    assert.equal(result.aborted, false);
    assert.equal(result.reply, "Applied nudge: Keep hook under 3s");
    assert.deepEqual(observedTools, ["vod_scan_hype"]);
    assert.equal(hasActiveManagedWorkers(), false);
    assert.equal(getLiveWorkerSnapshot("job_rpc_live_1"), null);
  });

  it("cancels a running child RPC worker cleanly via cancelManagedWorker", async () => {
    let toolSeenResolve!: () => void;
    const toolSeen = new Promise<void>((r) => {
      toolSeenResolve = r;
    });

    const runPromise = runManagedRpcWorker({
      jobId: "job_rpc_cancel_1",
      kind: "thumbnail",
      tools: "",
      prompt: "Build thumbnail",
      command: [process.execPath, fakeWorkerScript],
      workDir: tmpHome,
      timeoutMs: 10_000,
      onToolStart: () => toolSeenResolve(),
    });

    await toolSeen;
    const cancelled = await cancelManagedWorker("job_rpc_cancel_1");
    assert.equal(cancelled, true);

    const result = await runPromise;
    assert.equal(result.ok, false);
    assert.equal(result.aborted, true);
    assert.equal(hasActiveManagedWorkers(), false);
  });
});

describe("Clip worker reconciliation & cancellation (web/lib/clip-worker.ts)", () => {
  it("extracts YouTube video IDs, reconciles orphaned running jobs after restart, and cancels active jobs", async () => {
    assert.equal(extractYouTubeVideoId("https://youtu.be/Icp_tjjgmvI?t=10"), "Icp_tjjgmvI");
    assert.equal(extractYouTubeVideoId("https://www.youtube.com/live/Icp_tjjgmvI"), "Icp_tjjgmvI");
    assert.throws(() => extractYouTubeVideoId("https://example.com/nope"), /Invalid YouTube/i);

    const orphan = await createClipJob({
      videoId: "Icp_tjjgmvI",
      vodUrl: "https://youtu.be/Icp_tjjgmvI",
      title: "Orphaned Stream",
    });
    assert.equal(orphan.status, "queued");

    const fixedCount = await reconcileOrphanedClipJobs();
    assert.ok(fixedCount >= 1);
    const afterReconcile = await getClipJob(orphan.id);
    assert.equal(afterReconcile?.status, "failed");
    assert.equal(afterReconcile?.stage, "Interrupted");

    const toCancel = await createClipJob({
      videoId: "Icp_tjjgmvI",
      vodUrl: "https://youtu.be/Icp_tjjgmvI",
      title: "Cancel Target",
    });
    await createStudioJob({ id: toCancel.id, kind: "clip", title: "Cancel Target" });

    const broadcasts: Array<Record<string, unknown>> = [];
    const cancelled = await cancelBackgroundClipJob(
      toCancel.id,
      (ev) => broadcasts.push(ev),
      () => {}
    );
    assert.equal(cancelled?.status, "cancelled");
    assert.equal((await getStudioJob(toCancel.id))?.status, "cancelled");
    assert.ok(broadcasts.some((b) => b.type === "clips_changed"));
    assert.ok(broadcasts.some((b) => b.type === "jobs_changed"));
  });
});

describe("Pull-only Box incremental sync, Neon fallback & DNS-pinned Pixabay downloads", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetBoxGatewayCache();
    delete process.env.SPRITES_BOX_GATEWAY_URL;
  });

  it("enforces pull-only boot Box sync ({ pull: true, push: false }), tracks >48 MiB skips, and skips unchanged files on 2nd pass", async () => {
    // Seed a local file in briefs/ to prove push:false NEVER uploads it to Box
    fs.writeFileSync(path.join(tmpWorkspace, "briefs", "private-draft.md"), "Do not push on boot");
    process.env.SPRITES_BOX_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/box/box_sync_1";

    let uploadCalls = 0;
    const authHeaders: Array<string | null> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url.includes("/upload/files/")) {
        uploadCalls += 1;
        return Response.json({ entries: [{ id: "should_not_happen" }] });
      }
      if (url.endsWith("/2.0/folders") && init?.method === "POST") {
        return Response.json(
          { context_info: { conflicts: [{ id: "folder_assets", name: "Otto Assets" }] } },
          { status: 409 }
        );
      }
      if (url.includes("/2.0/folders/0/items")) {
        return Response.json({
          entries: [{ id: "folder_assets", type: "folder", name: "Otto Assets" }],
        });
      }
      if (url.includes("/2.0/folders/folder_assets/items")) {
        return Response.json({
          entries: [
            {
              id: "file_hero",
              type: "file",
              name: "hero-cutout.png",
              size: 11,
              modified_at: "2026-11-28T10:00:00Z",
            },
            {
              id: "file_huge",
              type: "file",
              name: "raw-4k-vod.mov",
              size: BOX_MAX_UPLOAD_BYTES + 1024,
              modified_at: "2026-11-28T10:00:00Z",
            },
          ],
        });
      }
      if (url.endsWith("/2.0/files/file_hero/content")) {
        return new Response(Buffer.from("PNG_CUTOUT!"), { status: 200 });
      }
      throw new Error(`Unexpected Box sync URL: ${url}`);
    }) as typeof fetch;

    const first = await syncWorkspaceWithBox({ pull: true, push: false });
    assert.equal(first.lastError, null);
    assert.equal(first.connected, true);
    assert.equal(first.pulledCount, 1);
    assert.equal(first.pushedCount, 0);
    assert.equal(uploadCalls, 0);
    assert.equal(first.skippedOversize.length, 1);
    assert.equal(first.skippedOversize[0].relPath, "assets/raw-4k-vod.mov");
    assert.equal(
      fs.readFileSync(path.join(tmpWorkspace, "assets", "hero-cutout.png"), "utf8"),
      "PNG_CUTOUT!"
    );

    // Second pass skips unchanged file incrementally
    const second = await syncWorkspaceWithBox({ pull: true, push: false });
    assert.equal(second.pulledCount, 0);
    assert.equal(second.skippedUnchanged, 1);
    assert.equal(uploadCalls, 0);
    assert.ok(authHeaders.every((h) => h === null));

    const status = await getBoxSyncStatus();
    assert.equal(status.connected, true);
    assert.ok(status.lastSyncedAt);
  });

  it("reports clean SQLite fallback info from agent/lib/neon-db.ts offline", () => {
    const info = getNeonRuntimeInfo();
    assert.equal(info.backend, "sqlite");
  });

  it("enforces host allowlist, DNS pinning, redirect host validation, and streaming size caps in downloadPixabayImage", async () => {
    const dst = path.join(tmpWorkspace, "assets", "bg.jpg");
    await assert.rejects(
      () => downloadPixabayImage("https://evil.example/bg.jpg", dst),
      /Blocked non-Pixabay host/i
    );
    await assert.rejects(
      () => downloadPixabayImage("http://cdn.pixabay.com/bg.jpg", dst),
      /Only HTTPS/i
    );

    let lookupCount = 0;
    const fakeReq = ((options: https.RequestOptions, cb?: (res: IncomingMessage) => void) => {
      const customLookup = options.lookup as (
        h: string,
        o: Record<string, unknown>,
        fn: (err: Error | null, addr: string, fam: number) => void
      ) => void;
      customLookup(String(options.hostname), {}, () => {});
      const reqEmitter = Object.assign(new EventEmitter(), {
        setTimeout: () => reqEmitter,
        destroy: () => reqEmitter,
        end: () => {
          const res = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { "content-type": "image/jpeg" },
            resume: () => {},
            destroy: () => {},
          }) as unknown as IncomingMessage;
          cb?.(res);
          queueMicrotask(() => {
            res.emit("data", Buffer.from("PIXABAY_PHOTO_BYTES"));
            res.emit("end");
          });
        },
      });
      return reqEmitter as unknown as ReturnType<typeof https.request>;
    }) as unknown as typeof https.request;

    const dl = await downloadPixabayImage("https://cdn.pixabay.com/photo/studio.jpg", dst, {
      lookupFn: async () => {
        lookupCount += 1;
        return [{ address: "104.18.12.34" }];
      },
      requestImpl: fakeReq,
    });
    assert.equal(lookupCount, 1);
    assert.equal(dl.size, 19);
    assert.equal(fs.readFileSync(dst, "utf8"), "PIXABAY_PHOTO_BYTES");

    // Oversized stream rejected mid-stream before full buffering
    await assert.rejects(
      () =>
        downloadPixabayImage("https://cdn.pixabay.com/photo/huge.jpg", dst, {
          maxBytes: 5,
          lookupFn: async () => [{ address: "104.18.12.34" }],
          requestImpl: fakeReq,
        }),
      /stream cap/i
    );
  });
});
