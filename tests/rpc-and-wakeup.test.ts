import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LMA_DISABLE_AUTO_SPAWN = "1";

const {
  OmpRpcBridge,
  friendlyToolLabel,
  stripHiddenTags,
  normalizeTodoPhases,
  extractTextContent,
  extractThinkingContent,
  summarizeSessionFile,
  rpc,
} = await import("../web/lib/rpc-bridge.ts");
const { handleWakeupRoutes } = await import("../web/routes/wakeup.ts");
const { resetSeenQStashTokens } = await import("../web/lib/qstash.ts");

function signWakeupJwt(body: string, key: string, jti?: string): string {
  const now = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("sha256").update(body).digest("base64url");
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      sub: "https://otto.sprites.app/api/wakeup",
      ...(jti ? { jti } : {}),
      exp: now + 300,
      body: hash,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

function attachFakeRpcProc(
  bridge: InstanceType<typeof OmpRpcBridge>,
  opts: { autoAck?: boolean; autoAckAbort?: boolean; failMsg?: string } = {}
) {
  const written: string[] = [];
  const fakeProc = {
    exitCode: null as number | null,
    kill() {
      this.exitCode = 1;
    },
    stdin: {
      write(line: string) {
        written.push(line);
        const parsed = JSON.parse(line) as { id: string; type: string };
        const shouldAck =
          parsed.type === "abort" ? (opts.autoAckAbort ?? true) : Boolean(opts.autoAck);
        if (shouldAck) {
          queueMicrotask(() => {
            (bridge as unknown as { handleEvent(ev: Record<string, unknown>): void }).handleEvent({
              type: "response",
              id: parsed.id,
              command: parsed.type,
              success: parsed.type === "abort" ? true : !opts.failMsg,
              error: parsed.type === "abort" ? undefined : opts.failMsg,
              data: { ok: true },
            });
          });
        }
      },
    },
  };
  (bridge as unknown as { proc: unknown; ready: boolean }).proc = fakeProc;
  (bridge as unknown as { proc: unknown; ready: boolean }).ready = true;
  return { written, fakeProc };
}

describe("RPC bridge helpers & JSONL session summarization", () => {
  it("strips hidden tags, normalizes todos, and maps friendly tool labels", () => {
    assert.equal(stripHiddenTags("Hello <hidden>internal path</hidden> world"), "Hello  world");
    assert.equal(friendlyToolLabel("vod_scan_hype"), "Scanning VOD live chat & hype spikes...");
    assert.equal(friendlyToolLabel("studio_job_nudge"), "Steering background worker...");
    assert.equal(friendlyToolLabel("box_upload"), "Syncing files with Box...");

    const todos = normalizeTodoPhases([
      { name: "Prep", tasks: [{ content: "Cut clip", status: "done" }, { content: 123 }] },
      { name: "Empty", tasks: [] },
    ]);
    assert.equal(todos.length, 1);
    assert.equal(todos[0].tasks.length, 1);
    assert.equal(todos[0].tasks[0].content, "Cut clip");

    assert.equal(
      extractTextContent([{ type: "text", text: "Hi " }, { type: "thinking", thinking: "hmm" }, { type: "text", text: "there" }]),
      "Hi there"
    );
    assert.equal(
      extractThinkingContent([{ type: "thinking", thinking: "step 1" }, { type: "thinking", thinking: "step 2" }]),
      "step 1\n\nstep 2"
    );
  });

  it("summarizes a JSONL session file and ignores hidden tags in titles", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-sess-"));
    const sessFile = path.join(tmpDir, "s1.jsonl");
    try {
      const lines = [
        JSON.stringify({ type: "session", id: "sess-1" }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: "Plan Friday stream <hidden>/home/sprite/secret</hidden>" },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "Here is your plan." }] },
        }),
      ];
      fs.writeFileSync(sessFile, lines.join("\n"));
      const summary = summarizeSessionFile(sessFile, sessFile);
      assert.ok(summary);
      assert.equal(summary.id, "sess-1");
      assert.equal(summary.title, "Plan Friday stream");
      assert.equal(summary.messageCount, 2);
      assert.equal(summary.active, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("OmpRpcBridge concurrency, TOCTOU lock & long-turn timeout handling", () => {
  it("tracks background jobs idempotently and keeps isAnyBusy accurate", () => {
    const b = new OmpRpcBridge({ autoSpawn: false });
    assert.equal(b.isAnyBusy(), false);
    const rel1 = b.beginBackgroundJob("clip");
    const rel2 = b.beginBackgroundJob("thumb");
    assert.equal(b.activeBackgroundJobCount, 2);
    assert.equal(b.isAnyBusy(), true);
    rel1();
    rel1(); // idempotent double release
    assert.equal(b.activeBackgroundJobCount, 1);
    rel2();
    assert.equal(b.activeBackgroundJobCount, 0);
    assert.equal(b.isAnyBusy(), false);
  });

  it("prevents concurrent prompt() while lockAlreadyHeld is active (zero TOCTOU window)", async () => {
    const b = new OmpRpcBridge({ autoSpawn: false });
    attachFakeRpcProc(b, { autoAck: true });

    b.busy = true;
    await assert.rejects(() => b.prompt("concurrent chat"), /still responding/i);

    const res = await b.prompt("scheduled wakeup", { lockAlreadyHeld: true });
    assert.equal(res.accepted, true);
    assert.equal(b.busy, true);
  });

  it("treats long-turn prompt RPC ack timeout as inFlight=true instead of HTTP 400 when process is alive", async () => {
    const b = new OmpRpcBridge({ autoSpawn: false });
    attachFakeRpcProc(b, { autoAck: false }); // simulates a 4-minute VOD clip turn still running

    const res = await b.prompt("Scan 4-hour VOD", { ackTimeoutMs: 40 });
    assert.deepEqual(res, { accepted: true, inFlight: true });
    assert.equal(b.busy, true);

    // When agent_end arrives later over stdout, busy clears cleanly
    (b as unknown as { handleEvent(ev: Record<string, unknown>): void }).handleEvent({ type: "agent_end" });
    assert.equal(b.busy, false);
  });

  it("actively aborts and clears busy via watchdog on both ack-timeout and normal post-ack hangs", async () => {
    // Case 1: Ack-timeout inFlight turn that hangs silently
    const b1 = new OmpRpcBridge({ autoSpawn: false });
    const { written: written1 } = attachFakeRpcProc(b1, { autoAck: false });
    const res1 = await b1.prompt("Silently hung turn", { ackTimeoutMs: 25, watchdogMs: 60 });
    assert.deepEqual(res1, { accepted: true, inFlight: true });
    assert.equal(b1.busy, true);

    await new Promise((r) => setTimeout(r, 110));
    assert.equal(b1.busy, false);
    assert.ok(
      written1.some((line) => JSON.parse(line).type === "abort"),
      "Watchdog must send RPC abort to omp before clearing busy on ack-timeout hang"
    );

    // Case 2: Normal prompt ack succeeds quickly, then provider stalls with no agent_end
    const b2 = new OmpRpcBridge({ autoSpawn: false });
    const { written: written2 } = attachFakeRpcProc(b2, { autoAck: true });
    const res2 = await b2.prompt("Post-ack hung turn", { ackTimeoutMs: 500, watchdogMs: 60 });
    assert.deepEqual(res2, { accepted: true });
    assert.equal(b2.busy, true);

    await new Promise((r) => setTimeout(r, 110));
    assert.equal(b2.busy, false);
    assert.ok(
      written2.some((line) => JSON.parse(line).type === "abort"),
      "Watchdog must also abort and recover normal post-ack stalled turns"
    );

    // Case 3 (R2' regression): A late agent_end from an aborted turn must NOT clear the NEXT turn's busy/watchdog
    const b3 = new OmpRpcBridge({ autoSpawn: false });
    attachFakeRpcProc(b3, { autoAck: true, autoAckAbort: true });
    const emit3 = (ev: Record<string, unknown>) =>
      (b3 as unknown as { handleEvent(e: Record<string, unknown>): void }).handleEvent(ev);

    await b3.prompt("Turn 1 (stalls after agent_start)", { ackTimeoutMs: 500, watchdogMs: 50 });
    emit3({ type: "agent_start" }); // activeAgentRuns = 1
    await new Promise((r) => setTimeout(r, 95)); // watchdog awaits abort ack, clears busy
    assert.equal(b3.busy, false);

    // User immediately starts Turn 2 before Turn 1's stale agent_end arrives
    await b3.prompt("Turn 2 (active)", { ackTimeoutMs: 500, watchdogMs: 5000 });
    emit3({ type: "agent_start" }); // activeAgentRuns = 2
    assert.equal(b3.busy, true);

    // Stale agent_end from aborted Turn 1 arrives -> must be absorbed; Turn 2 MUST remain busy!
    emit3({ type: "agent_end" });
    assert.equal(b3.busy, true);

    // Real agent_end from Turn 2 arrives -> clears busy cleanly
    emit3({ type: "agent_end" });
    assert.equal(b3.busy, false);
  });

  it("clears busy and throws on explicit RPC failure", async () => {
    const b = new OmpRpcBridge({ autoSpawn: false });
    attachFakeRpcProc(b, { autoAck: true, failMsg: "Invalid session" });

    await assert.rejects(() => b.prompt("hi"), /Invalid session/);
    assert.equal(b.busy, false);
  });
});

describe("handleWakeupRoutes security & busy dispatch", () => {
  const savedKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const savedUrl = process.env.LMA_PUBLIC_URL;
  const origProc = (rpc as unknown as { proc: unknown }).proc;
  const origReady = (rpc as unknown as { ready: boolean }).ready;

  beforeEach(() => {
    resetSeenQStashTokens();
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_wakeup_test_key";
    process.env.LMA_PUBLIC_URL = "https://otto.sprites.app";
    rpc.busy = false;
  });

  afterEach(() => {
    rpc.busy = false;
    (rpc as unknown as { proc: unknown }).proc = origProc;
    (rpc as unknown as { ready: boolean }).ready = origReady;
    if (savedKey === undefined) delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    else process.env.QSTASH_CURRENT_SIGNING_KEY = savedKey;
    if (savedUrl === undefined) delete process.env.LMA_PUBLIC_URL;
    else process.env.LMA_PUBLIC_URL = savedUrl;
  });

  it("blocks unsigned wakeup calls with 401 and returns 503 when agent is busy", async () => {
    const unsignedReq = new Request("https://otto.sprites.app/api/wakeup", {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
    });
    const res401 = await handleWakeupRoutes(unsignedReq, new URL(unsignedReq.url));
    assert.equal(res401?.status, 401);

    rpc.busy = true;
    const body = JSON.stringify({ label: "Test", prompt: "Do work" });
    const busyReq = new Request("https://otto.sprites.app/api/wakeup", {
      method: "POST",
      headers: { "upstash-signature": signWakeupJwt(body, "sig_wakeup_test_key") },
      body,
    });
    const res503 = await handleWakeupRoutes(busyReq, new URL(busyReq.url));
    assert.equal(res503?.status, 503);
    assert.equal(res503?.headers.get("retry-after"), "15");
  });

  it("dispatches signed chat wake-up while holding rpc.busy continuously (no TOCTOU gap) and keeps 503 retries unpoisoned while blocking post-200 replays", async () => {
    const { written } = attachFakeRpcProc(rpc, { autoAck: true });
    const body = JSON.stringify({ label: "T-1h Reminder", prompt: "Prep stream checklist" });
    const signedJwt = signWakeupJwt(body, "sig_wakeup_test_key", "msg_retry_safe_001");

    // 1. Agent is busy -> returns 503 Retry-After: 15 WITHOUT consuming the single-use jti
    rpc.busy = true;
    const busyRes = await handleWakeupRoutes(
      new Request("https://otto.sprites.app/api/wakeup", {
        method: "POST",
        headers: { "upstash-signature": signedJwt },
        body,
      }),
      new URL("https://otto.sprites.app/api/wakeup")
    );
    assert.equal(busyRes?.status, 503);
    assert.equal(busyRes?.headers.get("retry-after"), "15");
    assert.equal(written.length, 0);

    // 2. QStash retries with the EXACT SAME jti once agent is free -> succeeds with 200 OK
    rpc.busy = false;
    const retryRes = await handleWakeupRoutes(
      new Request("https://otto.sprites.app/api/wakeup", {
        method: "POST",
        headers: { "upstash-signature": signedJwt },
        body,
      }),
      new URL("https://otto.sprites.app/api/wakeup")
    );
    assert.equal(retryRes?.status, 200);
    assert.equal(rpc.busy, true);
    assert.equal(written.length, 1);
    assert.match(written[0], /SCHEDULED WAKE-UP: T-1h Reminder/);

    // 3. Replaying the already-accepted JWT/jti after 200 OK is rejected with 401
    rpc.busy = false;
    const replayRes = await handleWakeupRoutes(
      new Request("https://otto.sprites.app/api/wakeup", {
        method: "POST",
        headers: { "upstash-signature": signedJwt },
        body,
      }),
      new URL("https://otto.sprites.app/api/wakeup")
    );
    assert.equal(replayRes?.status, 401);
    assert.equal(written.length, 1);
  });

  it("blocks concurrent duplicate checkpoint wake-up redeliveries while first snapshot is in flight (R1' atomic claim)", async () => {
    const originalFetch = globalThis.fetch;
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((r) => {
      releaseSnapshot = r;
    });
    let snapshotCalls = 0;

    globalThis.fetch = (async () => {
      snapshotCalls += 1;
      await snapshotGate;
      return new Response(JSON.stringify({ id: "v99" }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const body = JSON.stringify({ mode: "checkpoint", label: "Daily Auto Snapshot" });
      const jwt = signWakeupJwt(body, "sig_wakeup_test_key", "msg_ckpt_concurrent_1");

      // Fire first delivery (stalls awaiting slow 60s checkpoint POST)
      const p1 = handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      await new Promise((r) => setTimeout(r, 20));

      // Fire concurrent QStash redelivery with the SAME jti while first is still running -> 503 Retry-After, zero 2nd POST!
      const dupRes = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(dupRes?.status, 503);
      assert.equal(dupRes?.headers.get("retry-after"), "15");
      assert.equal(snapshotCalls, 1);

      // Let first snapshot finish -> 200 OK and commits jti
      releaseSnapshot();
      const firstRes = await p1;
      assert.equal(firstRes?.status, 200);
      assert.equal(snapshotCalls, 1);

      // Replay after 200 OK is permanently rejected with 401
      const afterReplay = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(afterReplay?.status, 401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
