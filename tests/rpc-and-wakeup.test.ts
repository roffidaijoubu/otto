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

function signWakeupJwt(body: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("sha256").update(body).digest("base64url");
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      sub: "https://otto.sprites.app/api/wakeup",
      exp: now + 300,
      body: hash,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

function attachFakeRpcProc(bridge: InstanceType<typeof OmpRpcBridge>, opts: { autoAck?: boolean; failMsg?: string } = {}) {
  const written: string[] = [];
  const fakeProc = {
    exitCode: null as number | null,
    stdin: {
      write(line: string) {
        written.push(line);
        const parsed = JSON.parse(line) as { id: string; type: string };
        if (opts.autoAck) {
          queueMicrotask(() => {
            (bridge as unknown as { handleEvent(ev: Record<string, unknown>): void }).handleEvent({
              type: "response",
              id: parsed.id,
              command: parsed.type,
              success: !opts.failMsg,
              error: opts.failMsg,
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

  it("auto-clears busy via silent-hang watchdog if an inFlight turn never emits agent_end", async () => {
    const b = new OmpRpcBridge({ autoSpawn: false });
    attachFakeRpcProc(b, { autoAck: false });

    const res = await b.prompt("Silently hung turn", { ackTimeoutMs: 25, watchdogMs: 60 });
    assert.deepEqual(res, { accepted: true, inFlight: true });
    assert.equal(b.busy, true);

    await new Promise((r) => setTimeout(r, 110));
    assert.equal(b.busy, false);
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

  it("dispatches signed chat wake-up while holding rpc.busy continuously (no TOCTOU gap)", async () => {
    const { written } = attachFakeRpcProc(rpc, { autoAck: true });
    const body = JSON.stringify({ label: "T-1h Reminder", prompt: "Prep stream checklist" });
    const req = new Request("https://otto.sprites.app/api/wakeup", {
      method: "POST",
      headers: { "upstash-signature": signWakeupJwt(body, "sig_wakeup_test_key") },
      body,
    });
    const res = await handleWakeupRoutes(req, new URL(req.url));
    assert.equal(res?.status, 200);
    assert.equal(rpc.busy, true);
    assert.equal(written.length, 1);
    assert.match(written[0], /SCHEDULED WAKE-UP: T-1h Reminder/);
  });
});
