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
const { resetStudioDbForTests } = await import("../agent/lib/studio-db.ts");
const { resetApifyGatewayCache } = await import("../agent/lib/apify.ts");

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
  opts: {
    autoAck?: boolean;
    autoAckAbort?: boolean;
    emitAgentEndOnAbort?: boolean;
    failMsg?: string;
  } = {}
) {
  const written: string[] = [];
  const fakeProc = {
    exitCode: null as number | null,
    killed: false,
    kill() {
      this.killed = true;
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
            const handleEvent = (
              bridge as unknown as { handleEvent(ev: Record<string, unknown>): void }
            ).handleEvent.bind(bridge);
            handleEvent({
              type: "response",
              id: parsed.id,
              command: parsed.type,
              success: parsed.type === "abort" ? true : !opts.failMsg,
              error: parsed.type === "abort" ? undefined : opts.failMsg,
              data: { ok: true },
            });
            if (parsed.type === "abort" && opts.emitAgentEndOnAbort) {
              handleEvent({ type: "agent_end" });
            }
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

  it("actively aborts and enforces fail-closed 3-state pipe isolation on ack-timeout, post-ack hangs, clean aborts, and wedged processes", async () => {
    // Case 1: Ack-timeout inFlight turn where wedged omp never emits agent_end -> kills & detaches proc
    const b1 = new OmpRpcBridge({ autoSpawn: false });
    const { written: written1, fakeProc: proc1 } = attachFakeRpcProc(b1, {
      autoAck: false,
      emitAgentEndOnAbort: false,
    });
    const res1 = await b1.prompt("Silently hung turn", {
      ackTimeoutMs: 25,
      watchdogMs: 50,
      abortGraceMs: 40,
    });
    assert.deepEqual(res1, { accepted: true, inFlight: true });
    assert.equal(b1.busy, true);

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(b1.busy, false);
    assert.equal(proc1.killed, true, "Wedged process that fails to emit agent_end must be terminated");
    assert.ok(
      written1.some((line) => JSON.parse(line).type === "abort"),
      "Watchdog must send RPC abort to omp before terminating wedged process"
    );

    // Case 2: Normal post-ack hang where omp cleanly settles with agent_end -> keeps healthy proc alive
    const b2 = new OmpRpcBridge({ autoSpawn: false });
    const { written: written2, fakeProc: proc2 } = attachFakeRpcProc(b2, {
      autoAck: true,
      emitAgentEndOnAbort: true,
    });
    const emit2 = (ev: Record<string, unknown>) =>
      (b2 as unknown as { handleEvent(e: Record<string, unknown>): void }).handleEvent(ev);

    const res2 = await b2.prompt("Post-ack hung turn", {
      ackTimeoutMs: 500,
      watchdogMs: 50,
      abortGraceMs: 80,
    });
    assert.deepEqual(res2, { accepted: true });
    assert.equal(b2.busy, true);

    await new Promise((r) => setTimeout(r, 110));
    assert.equal(b2.busy, false);
    assert.equal(proc2.killed, false, "Clean abort emitting agent_end must preserve healthy omp subprocess");
    assert.ok(written2.some((line) => JSON.parse(line).type === "abort"));

    // Turn 2 on preserved healthy process runs with active watchdog and settles cleanly
    await b2.prompt("Turn 2 after clean abort", { ackTimeoutMs: 500, watchdogMs: 5000 });
    assert.equal(b2.busy, true);
    assert.equal(b2.hasActiveWatchdog(), true);
    emit2({ type: "agent_end" });
    assert.equal(b2.busy, false);
    assert.equal(b2.hasActiveWatchdog(), false);

    // Case 3 (R2' Failure B): Wedged omp never emits agent_end on abort -> killed & detached;
    // fresh worker immediately serves Turn 2 with ZERO permanent busy wedge
    const b3 = new OmpRpcBridge({ autoSpawn: false });
    const { fakeProc: wedgedProc } = attachFakeRpcProc(b3, {
      autoAck: true,
      autoAckAbort: true,
      emitAgentEndOnAbort: false,
    });
    const emit3 = (ev: Record<string, unknown>) =>
      (b3 as unknown as { handleEvent(e: Record<string, unknown>): void }).handleEvent(ev);

    await b3.prompt("Turn 1 (wedged after agent_start)", {
      ackTimeoutMs: 500,
      watchdogMs: 45,
      abortGraceMs: 40,
    });
    emit3({ type: "agent_start" });
    await new Promise((r) => setTimeout(r, 140));
    assert.equal(wedgedProc.killed, true);
    assert.equal(b3.busy, false);
    assert.equal((b3 as unknown as { proc: unknown }).proc, null);

    // Attach fresh worker and execute Turn 2 -> completes cleanly with single agent_end (never wedged!)
    const { fakeProc: freshProc } = attachFakeRpcProc(b3, { autoAck: true });
    await b3.prompt("Turn 2 on fresh worker", { ackTimeoutMs: 500, watchdogMs: 5000 });
    emit3({ type: "agent_start" });
    assert.equal(b3.busy, true);
    emit3({ type: "agent_end" });
    assert.equal(b3.busy, false);
    assert.equal(freshProc.killed, false);

    // Case 4 (R2' Failure A' & resurrection guard):
    // 4a. Stale trailing session_settled from cleanly-aborted Turn 1 arriving AFTER Turn 2 starts
    //     MUST NOT clear Turn 2's busy flag, disarm its watchdog, or admit a 2nd prompt into stdin!
    const b4 = new OmpRpcBridge({ autoSpawn: false });
    const { fakeProc: proc4, written: written4 } = attachFakeRpcProc(b4, {
      autoAck: true,
      autoAckAbort: true,
      emitAgentEndOnAbort: true,
    });
    const emit4 = (ev: Record<string, unknown>) =>
      (b4 as unknown as { handleEvent(e: Record<string, unknown>): void }).handleEvent(ev);

    await b4.prompt("Turn 1 (aborts cleanly via agent_end)", {
      ackTimeoutMs: 500,
      watchdogMs: 40,
      abortGraceMs: 80,
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b4.busy, false);
    assert.equal(proc4.killed, false);

    // Turn 2 starts immediately before Turn 1's trailing session_settled arrives on stdout
    await b4.prompt("Turn 2 (live successor)", { ackTimeoutMs: 500, watchdogMs: 5000 });
    assert.equal(b4.busy, true);
    assert.equal(b4.hasActiveWatchdog(), true);

    // Trailing session_settled from Turn 1 arrives -> MUST be absorbed!
    emit4({ type: "session_settled" });
    assert.equal(b4.busy, true, "Stale trailing session_settled must not clear successor busy");
    assert.equal(b4.hasActiveWatchdog(), true, "Stale trailing session_settled must not disarm watchdog");
    assert.equal(b4.isAnyBusy(), true);
    await assert.rejects(() => b4.prompt("Intruder concurrent prompt"), /still responding/i);

    // Explicit mismatched turnGen terminal event is also rejected
    emit4({ type: "agent_start" });
    emit4({ type: "agent_end", turnGen: 1 });
    assert.equal(b4.busy, true);
    assert.equal(b4.hasActiveWatchdog(), true);

    // Turn 2's real agent_end settles cleanly
    emit4({ type: "agent_end" });
    assert.equal(b4.busy, false);
    assert.equal(b4.hasActiveWatchdog(), false);

    // 4b. Stray events while idle cannot resurrect busy
    emit4({ type: "agent_end" });
    emit4({ type: "session_settled" });
    emit4({ type: "agent_start" });
    emit4({ type: "tool_execution_start", toolName: "bash" });
    assert.equal(b4.busy, false);

    // 4c. Manual abort() during idle OR wakeup's pre-prompt claim window (busy=true, turnState=idle)
    //     MUST derive from authoritative turnState and NEVER kill a healthy worker!
    const preAbortWrites = written4.length;
    b4.busy = true; // simulates web/routes/wakeup.ts:148 while awaiting holdSpriteActive()
    await b4.abort(40);
    assert.equal(b4.busy, false);
    assert.equal(proc4.killed, false, "abort() in busy=true/turnState=idle window must not kill healthy worker");
    assert.equal((b4 as unknown as { proc: unknown }).proc, proc4);
    assert.equal(written4.length, preAbortWrites, "abort() with no running turn must not send RPC abort");

    // 4d. Case 5: autoSpawn=true real respawn, readStdout(owner) cutoff & delayed exited guard
    const enc = new TextEncoder();
    const spawnedWorkers: Array<{
      killed: boolean;
      pushLine: (obj: Record<string, unknown>) => void;
      resolveExit: (code: number) => void;
    }> = [];

    const b5 = new OmpRpcBridge({
      autoSpawn: true,
      respawnDelayMs: 25,
      spawnFactory: () => {
        let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>;
        let resolveExit!: (code: number) => void;
        const stdout = new ReadableStream<Uint8Array>({
          start(controller) {
            stdoutCtrl = controller;
          },
        });
        const stderr = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
        const exited = new Promise<number>((r) => {
          resolveExit = r;
        });
        const worker = {
          exitCode: null as number | null,
          killed: false,
          stdout,
          stderr,
          exited,
          kill() {
            this.killed = true;
            this.exitCode = 1;
          },
          stdin: {
            write(line: string) {
              const parsed = JSON.parse(line) as { id: string; type: string };
              // Both workers ack prompt/abort responses, but worker #1 never emits agent_end on abort
              queueMicrotask(() => {
                stdoutCtrl.enqueue(
                  enc.encode(
                    JSON.stringify({
                      type: "response",
                      id: parsed.id,
                      command: parsed.type,
                      success: true,
                      data: { ok: true },
                    }) + "\n"
                  )
                );
              });
            },
          },
        };
        const record = {
          get killed() {
            return worker.killed;
          },
          pushLine(obj: Record<string, unknown>) {
            stdoutCtrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
          },
          resolveExit(code: number) {
            resolveExit(code);
          },
        };
        spawnedWorkers.push(record);
        queueMicrotask(() => record.pushLine({ type: "ready" }));
        return worker as unknown as Bun.Subprocess<"pipe", "pipe", "pipe">;
      },
    });

    try {
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(spawnedWorkers.length, 1);

      // Turn 1 wedges on worker #1 -> watchdog kills & detaches worker #1, auto-respawns worker #2
      await b5.prompt("Turn 1 wedged", { ackTimeoutMs: 500, watchdogMs: 40, abortGraceMs: 35 });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(spawnedWorkers[0].killed, true);
      assert.equal(spawnedWorkers.length, 2, "scheduleRespawn must spawn replacement worker automatically");
      assert.equal(b5.busy, false);

      // Start Turn 2 on fresh worker #2
      await b5.prompt("Turn 2 on respawned worker", { ackTimeoutMs: 500, watchdogMs: 5000 });
      assert.equal(b5.busy, true);
      assert.equal(b5.hasActiveWatchdog(), true);

      // Detached worker #1 emits a late agent_end on its old stdout pipe AND fires delayed exited -> MUST be ignored!
      spawnedWorkers[0].pushLine({ type: "agent_end" });
      spawnedWorkers[0].resolveExit(137);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(b5.busy, true, "Detached worker stdout & delayed exited must never disrupt replacement worker");
      assert.equal(b5.hasActiveWatchdog(), true);
      assert.equal(spawnedWorkers.length, 2, "Delayed exited from replaced worker must not trigger duplicate spawn");

      // Replacement worker #2 finishes Turn 2 cleanly
      spawnedWorkers[1].pushLine({ type: "agent_end" });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(b5.busy, false);
    } finally {
      b5.dispose();
    }
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

      // Fire concurrent checkpoint wake-up with a DISTINCT jti -> still blocked 503 by mode lock (inFlightDeterministicModes)!
      const distinctJwt = signWakeupJwt(body, "sig_wakeup_test_key", "msg_ckpt_distinct_B");
      const crossJtiRes = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": distinctJwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(crossJtiRes?.status, 503);
      assert.equal(crossJtiRes?.headers.get("retry-after"), "15");
      assert.equal(snapshotCalls, 1);

      // Let first snapshot finish -> 200 OK and commits jti #1
      releaseSnapshot();
      const firstRes = await p1;
      assert.equal(firstRes?.status, 200);
      assert.equal(snapshotCalls, 1);

      // Replay of jti #1 after 200 OK is permanently rejected with 401
      const afterReplay = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(afterReplay?.status, 401);

      // Distinct jti #2 was NOT poisoned by its 503 -> succeeds cleanly once mode lock releases
      const secondRes = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": distinctJwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(secondRes?.status, 200);
      assert.equal(snapshotCalls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 503 Retry-After without committing replay token on partial metrics_sync failure (R1' allOk commit gate)", async () => {
    const originalFetch = globalThis.fetch;
    const savedForceSqlite = process.env.LMA_FORCE_SQLITE;
    const savedDbPath = process.env.LMA_STUDIO_DB_PATH;
    const savedComposioGw = process.env.SPRITES_COMPOSIO_GATEWAY_URL;
    const savedBufferGw = process.env.SPRITES_BUFFER_GATEWAY_URL;
    const savedApifyGw = process.env.SPRITES_APIFY_GATEWAY_URL;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-metrics-partial-"));

    process.env.LMA_FORCE_SQLITE = "1";
    process.env.LMA_STUDIO_DB_PATH = path.join(tmpDir, "studio.db");
    process.env.SPRITES_COMPOSIO_GATEWAY_URL = "https://gw.test/composio";
    process.env.SPRITES_BUFFER_GATEWAY_URL = "https://gw.test/buffer";
    process.env.SPRITES_APIFY_GATEWAY_URL = "https://gw.test/apify";
    resetStudioDbForTests();
    resetApifyGatewayCache();

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // YouTube (Composio) fails with upstream 502
      if (urlStr.startsWith("https://gw.test/composio")) {
        return new Response("upstream bad gateway", { status: 502 });
      }
      // Buffer returns one TikTok channel handle (so TikTok runs, while IG & X fail with missing handles)
      if (urlStr.startsWith("https://gw.test/buffer")) {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        if (bodyText.includes("organizations")) {
          return Response.json({
            data: { account: { organizations: [{ id: "org-1", name: "Studio" }] } },
          });
        }
        return Response.json({
          data: {
            channels: [
              {
                id: "ch-tt",
                name: "creator_tt",
                displayName: "Creator TT",
                service: "tiktok",
                isDisconnected: false,
              },
            ],
          },
        });
      }
      // Apify TikTok actor succeeds cleanly
      if (urlStr.includes("/v2/actors/")) {
        return Response.json({
          data: { id: "run-tt-1", status: "SUCCEEDED", defaultDatasetId: "ds-tt-1" },
        });
      }
      if (urlStr.includes("/v2/datasets/ds-tt-1/items")) {
        return Response.json([
          { authorMeta: { name: "creator_tt", nickName: "Creator", fans: 4200, heart: 99000, video: 42 } },
        ]);
      }
      return new Response("unexpected url: " + urlStr, { status: 500 });
    }) as unknown as typeof fetch;

    try {
      const body = JSON.stringify({ mode: "metrics_sync", label: "Daily Metrics Sync" });
      const jwt = signWakeupJwt(body, "sig_wakeup_test_key", "msg_metrics_partial_001");

      // First delivery: TikTok succeeds while YouTube fails -> 503 partial=true, replay token NOT committed
      const res1 = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(res1?.status, 503);
      assert.equal(res1?.headers.get("retry-after"), "15");
      const data1 = (await res1?.json()) as {
        ok: boolean;
        partial: boolean;
        socials: Array<{ platform: string; ok: boolean }>;
      };
      assert.equal(data1.ok, false);
      assert.equal(data1.partial, true);
      assert.ok(data1.socials.some((s) => s.platform === "tiktok" && s.ok === true));

      // Retry with the EXACT SAME jti must NOT be rejected with 401 (replay token remains unconsumed!)
      const res2 = await handleWakeupRoutes(
        new Request("https://otto.sprites.app/api/wakeup", {
          method: "POST",
          headers: { "upstash-signature": jwt },
          body,
        }),
        new URL("https://otto.sprites.app/api/wakeup")
      );
      assert.equal(res2?.status, 503);
    } finally {
      globalThis.fetch = originalFetch;
      resetStudioDbForTests();
      resetApifyGatewayCache();
      if (savedForceSqlite === undefined) delete process.env.LMA_FORCE_SQLITE;
      else process.env.LMA_FORCE_SQLITE = savedForceSqlite;
      if (savedDbPath === undefined) delete process.env.LMA_STUDIO_DB_PATH;
      else process.env.LMA_STUDIO_DB_PATH = savedDbPath;
      if (savedComposioGw === undefined) delete process.env.SPRITES_COMPOSIO_GATEWAY_URL;
      else process.env.SPRITES_COMPOSIO_GATEWAY_URL = savedComposioGw;
      if (savedBufferGw === undefined) delete process.env.SPRITES_BUFFER_GATEWAY_URL;
      else process.env.SPRITES_BUFFER_GATEWAY_URL = savedBufferGw;
      if (savedApifyGw === undefined) delete process.env.SPRITES_APIFY_GATEWAY_URL;
      else process.env.SPRITES_APIFY_GATEWAY_URL = savedApifyGw;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
