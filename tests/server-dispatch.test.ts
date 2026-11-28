import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-server-dispatch-"));
process.env.LMA_NO_LISTEN = "1";
process.env.LMA_DISABLE_AUTO_SPAWN = "1";
process.env.LMA_FORCE_SQLITE = "1";
process.env.LMA_STUDIO_DB_PATH = path.join(tmpDir, "dispatch.db");
process.env.LMA_WORKSPACE_DIR = path.join(tmpDir, "workspace");

const { handleServerRequest } = await import("../web/server.ts");
const { hashWebPassword, initWebPassword, clearActiveSessions } = await import("../web/lib/auth.ts");
const { resetLoginRateLimits } = await import("../web/lib/qstash.ts");
const db = await import("../agent/lib/studio-db.ts");

describe("web/server.ts top-level dispatch & auth-gate ordering", () => {
  const savedHash = process.env.LMA_WEB_PASSWORD_HASH;
  const savedPw = process.env.LMA_WEB_PASSWORD;

  before(() => {
    db.resetStudioDbForTests();
    clearActiveSessions();
    resetLoginRateLimits();
    delete process.env.LMA_WEB_PASSWORD;
    process.env.LMA_WEB_PASSWORD_HASH = hashWebPassword("314159");
    initWebPassword();
  });

  after(() => {
    clearActiveSessions();
    resetLoginRateLimits();
    db.resetStudioDbForTests();
    if (savedHash === undefined) delete process.env.LMA_WEB_PASSWORD_HASH;
    else process.env.LMA_WEB_PASSWORD_HASH = savedHash;
    if (savedPw === undefined) delete process.env.LMA_WEB_PASSWORD;
    else process.env.LMA_WEB_PASSWORD = savedPw;
    initWebPassword();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enforces public /api/health minimalism, QStash 401, internal 403, and fail-closed 401 across all protected routes", async () => {
    // 1. Public health returns minimal liveness only
    const hRes = await handleServerRequest(new Request("http://127.0.0.1:8080/api/health"));
    assert.equal(hRes.status, 200);
    assert.deepEqual(await hRes.json(), { ok: true, status: "healthy" });

    // 2. Unsigned wakeup -> 401
    const wRes = await handleServerRequest(
      new Request("http://127.0.0.1:8080/api/wakeup", { method: "POST", body: "{}" })
    );
    assert.equal(wRes.status, 401);

    // 3. Unauthenticated internal IPC -> 403
    const iRes = await handleServerRequest(
      new Request("http://127.0.0.1:8080/api/internal/studio-app/open", { method: "POST", body: "{}" })
    );
    assert.equal(iRes.status, 403);

    // 4. Root HTML requires PIN (401 HTML)
    const rootRes = await handleServerRequest(new Request("http://127.0.0.1:8080/"));
    assert.equal(rootRes.status, 401);
    assert.match(rootRes.headers.get("content-type") || "", /text\/html/);

    // 5. Every protected API route MUST sit behind the auth gate (401 JSON)
    const protectedEndpoints = [
      "/api/dossier",
      "/api/connectors",
      "/api/db/overview",
      "/api/workspace/list",
      "/api/thumbnails",
      "/api/clips",
      "/api/calendar",
      "/api/checkpoints",
      "/api/setup/status",
      "/api/jobs",
    ];
    for (const p of protectedEndpoints) {
      const res = await handleServerRequest(new Request(`http://127.0.0.1:8080${p}`));
      assert.equal(res.status, 401, `Expected 401 auth gate on ${p}`);
    }
  });

  it("admits authenticated session through full login -> protected API flow", async () => {
    const loginRes = await handleServerRequest(
      new Request("http://127.0.0.1:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "fly-client-ip": "203.0.113.99" },
        body: JSON.stringify({ password: "314159" }),
      })
    );
    assert.equal(loginRes.status, 200);
    const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^lma_session=/);

    const dbRes = await handleServerRequest(
      new Request("http://127.0.0.1:8080/api/db/overview", { headers: { cookie } })
    );
    assert.equal(dbRes.status, 200);
    const ov = (await dbRes.json()) as { backend: string; tables: { calendar_events: number } };
    assert.equal(ov.backend, "sqlite");
    assert.equal(typeof ov.tables.calendar_events, "number");

    const setupRes = await handleServerRequest(
      new Request("http://127.0.0.1:8080/api/setup/status", { headers: { cookie } })
    );
    assert.equal(setupRes.status, 200);
  });
});
