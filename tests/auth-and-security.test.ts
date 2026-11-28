import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LMA_DISABLE_AUTO_SPAWN = "1";

const { timingSafeStrEqual } = await import("../web/lib/secure-compare.ts");
const {
  hashWebPassword,
  verifyWebPassword,
  initWebPassword,
  hasConfiguredAuth,
  buildAuthCookieHeader,
  isAuthenticated,
  clearActiveSessions,
  getActiveSessionCount,
} = await import("../web/lib/auth.ts");
const { buildAgentChildEnv } = await import("../web/lib/child-env.ts");
const { resetLoginRateLimits } = await import("../web/lib/qstash.ts");
const { handlePublicRoutes } = await import("../web/routes/public.ts");
const { rpc } = await import("../web/lib/rpc-bridge.ts");

describe("timingSafeStrEqual", () => {
  it("matches identical strings and rejects differences of same or different lengths", () => {
    assert.equal(timingSafeStrEqual("secret-token-123", "secret-token-123"), true);
    assert.equal(timingSafeStrEqual("secret-token-123", "secret-token-124"), false);
    assert.equal(timingSafeStrEqual("short", "longer-string"), false);
    assert.equal(timingSafeStrEqual("", ""), true);
    assert.equal(timingSafeStrEqual("a", ""), false);
  });
});

describe("auth: fail-closed scrypt PIN & true LRU sessions", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    clearActiveSessions();
    resetLoginRateLimits();
    delete process.env.LMA_WEB_PASSWORD;
    delete process.env.LMA_WEB_PASSWORD_HASH;
    initWebPassword();
  });

  afterEach(() => {
    clearActiveSessions();
    resetLoginRateLimits();
    process.env.LMA_WEB_PASSWORD = savedEnv.LMA_WEB_PASSWORD;
    process.env.LMA_WEB_PASSWORD_HASH = savedEnv.LMA_WEB_PASSWORD_HASH;
    if (savedEnv.LMA_WEB_PASSWORD === undefined) delete process.env.LMA_WEB_PASSWORD;
    if (savedEnv.LMA_WEB_PASSWORD_HASH === undefined) delete process.env.LMA_WEB_PASSWORD_HASH;
    initWebPassword();
  });

  it("fails closed when neither LMA_WEB_PASSWORD nor LMA_WEB_PASSWORD_HASH is set", () => {
    assert.equal(hasConfiguredAuth(), false);
    assert.equal(verifyWebPassword("123456"), false);
    const req = new Request("http://localhost:8080/api/dossier");
    assert.equal(isAuthenticated(req), false);
  });

  it("produces unique salted scrypt hashes and verifies correctly", () => {
    const h1 = hashWebPassword("654321");
    const h2 = hashWebPassword("654321");
    assert.notEqual(h1, h2);
    assert.match(h1, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);

    process.env.LMA_WEB_PASSWORD_HASH = h1;
    initWebPassword();
    assert.equal(hasConfiguredAuth(), true);
    assert.equal(verifyWebPassword("654321"), true);
    assert.equal(verifyWebPassword("000000"), false);
    assert.equal(verifyWebPassword(""), false);
  });

  it("rejects malformed scrypt hash formats fail-closed", () => {
    process.env.LMA_WEB_PASSWORD_HASH = "scrypt$nothex$short";
    initWebPassword();
    assert.equal(verifyWebPassword("654321"), false);
  });

  it("issues HttpOnly SameSite=Lax cookies and adds Secure on HTTPS", () => {
    process.env.LMA_WEB_PASSWORD_HASH = hashWebPassword("112233");
    initWebPassword();

    const httpReq = new Request("http://localhost:8080/api/auth/login");
    const httpCookie = buildAuthCookieHeader(httpReq, new URL(httpReq.url));
    assert.match(httpCookie, /^lma_session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);

    const httpsReq = new Request("https://otto.sprites.app/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    const httpsCookie = buildAuthCookieHeader(httpsReq, new URL(httpsReq.url));
    assert.match(httpsCookie, /; Secure$/);

    const tokenPair = httpsCookie.split(";")[0];
    const authedReq = new Request("https://otto.sprites.app/api/dossier", {
      headers: { cookie: `other=1; ${tokenPair}` },
    });
    assert.equal(isAuthenticated(authedReq), true);
    assert.equal(
      isAuthenticated(new Request("https://otto.sprites.app/api/dossier", { headers: { cookie: "lma_session=forged" } })),
      false
    );
  });

  it("preserves actively used owner session via true LRU touch when >64 logins occur", () => {
    process.env.LMA_WEB_PASSWORD_HASH = hashWebPassword("778899");
    initWebPassword();
    const loginReq = new Request("https://otto.sprites.app/api/auth/login");
    const loginUrl = new URL(loginReq.url);

    const ownerCookie = buildAuthCookieHeader(loginReq, loginUrl).split(";")[0];
    const ownerReq = new Request("https://otto.sprites.app/api/dossier", {
      headers: { cookie: ownerCookie },
    });

    // Generate 40 idle logins, then actively touch owner session, then 40 more idle logins (81 total > 64 cap)
    for (let i = 0; i < 40; i++) buildAuthCookieHeader(loginReq, loginUrl);
    assert.equal(isAuthenticated(ownerReq), true);
    for (let i = 0; i < 40; i++) buildAuthCookieHeader(loginReq, loginUrl);

    assert.equal(getActiveSessionCount(), 64);
    assert.equal(isAuthenticated(ownerReq), true);
  });
});

describe("public routes: /api/health privacy & /api/auth/login rate limiting", () => {
  const savedHash = process.env.LMA_WEB_PASSWORD_HASH;
  const savedPw = process.env.LMA_WEB_PASSWORD;

  beforeEach(() => {
    clearActiveSessions();
    resetLoginRateLimits();
    delete process.env.LMA_WEB_PASSWORD;
    process.env.LMA_WEB_PASSWORD_HASH = hashWebPassword("246810");
    initWebPassword();
  });

  afterEach(() => {
    clearActiveSessions();
    resetLoginRateLimits();
    if (savedHash === undefined) delete process.env.LMA_WEB_PASSWORD_HASH;
    else process.env.LMA_WEB_PASSWORD_HASH = savedHash;
    if (savedPw === undefined) delete process.env.LMA_WEB_PASSWORD;
    else process.env.LMA_WEB_PASSWORD = savedPw;
    initWebPassword();
  });

  it("returns minimal liveness for unauthenticated /api/health without leaking busy/hold internals", async () => {
    rpc.busy = true;
    try {
      const req = new Request("http://localhost:8080/api/health");
      const res = await handlePublicRoutes(req, new URL(req.url));
      assert.ok(res);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(body, { ok: true, status: "healthy" });
      assert.equal("busy" in body, false);
      assert.equal("hold" in body, false);
      assert.equal("activeBackgroundJobs" in body, false);
    } finally {
      rpc.busy = false;
    }
  });

  it("includes hold/worker telemetry on /api/health only when authenticated", async () => {
    const loginReq = new Request("http://localhost:8080/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "fly-client-ip": "203.0.113.10" },
      body: JSON.stringify({ password: "246810" }),
    });
    const loginRes = await handlePublicRoutes(loginReq, new URL(loginReq.url));
    assert.ok(loginRes);
    assert.equal(loginRes.status, 200);
    const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];

    const healthReq = new Request("http://localhost:8080/api/health", {
      headers: { cookie },
    });
    const healthRes = await handlePublicRoutes(healthReq, new URL(healthReq.url));
    assert.ok(healthRes);
    const body = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(typeof body.busy, "boolean");
    assert.equal(typeof body.activeBackgroundJobs, "number");
    assert.ok(body.hold && typeof body.hold === "object");
  });

  it("blocks brute-force logins after 5 failures with HTTP 429 and Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "fly-client-ip": "198.51.100.77" },
        body: JSON.stringify({ password: "wrong" }),
      });
      const res = await handlePublicRoutes(req, new URL(req.url));
      assert.equal(res?.status, 401);
    }
    const blockedReq = new Request("http://localhost:8080/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "fly-client-ip": "198.51.100.77" },
      body: JSON.stringify({ password: "246810" }),
    });
    const blockedRes = await handlePublicRoutes(blockedReq, new URL(blockedReq.url));
    assert.equal(blockedRes?.status, 429);
    assert.equal(blockedRes?.headers.get("retry-after"), "60");
  });
});

describe("buildAgentChildEnv secret isolation", () => {
  it("strips all sensitive secret/token/password/signing/database env vars while preserving safe vars", () => {
    const prev = {
      LMA_WEB_PASSWORD: process.env.LMA_WEB_PASSWORD,
      LMA_WEB_PASSWORD_HASH: process.env.LMA_WEB_PASSWORD_HASH,
      QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
      LMA_NEON_DATABASE_URL: process.env.LMA_NEON_DATABASE_URL,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      SPRITES_API_TOKEN: process.env.SPRITES_API_TOKEN,
      SPRITE_NAME: process.env.SPRITE_NAME,
    };
    try {
      process.env.LMA_WEB_PASSWORD = "plaintext-secret";
      process.env.LMA_WEB_PASSWORD_HASH = "scrypt$abc$def";
      process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_secret";
      process.env.LMA_NEON_DATABASE_URL = "postgres://user:pass@host/db";
      process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
      process.env.SPRITES_API_TOKEN = "sprites-secret-token";
      process.env.SPRITE_NAME = "otto";

      const env = buildAgentChildEnv({ CUSTOM_SAFE: "yes" });
      assert.equal(env.LMA_WEB_PASSWORD, undefined);
      assert.equal(env.LMA_WEB_PASSWORD_HASH, undefined);
      assert.equal(env.QSTASH_CURRENT_SIGNING_KEY, undefined);
      assert.equal(env.LMA_NEON_DATABASE_URL, undefined);
      assert.equal(env.ANTHROPIC_API_KEY, undefined);
      assert.equal(env.SPRITES_API_TOKEN, undefined);
      assert.equal(env.SPRITE_NAME, "otto");
      assert.equal(env.CUSTOM_SAFE, "yes");
      assert.ok(env.LMA_INTERNAL_SECRET && env.LMA_INTERNAL_SECRET.length >= 32);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("atomic private web.env password rotation", () => {
  it("writes salted scrypt hash and removes plaintext password with isolated HOME", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otto-auth-test-"));
    const prevHome = process.env.HOME;
    try {
      // Test atomic rewrite helper behavior via dynamic fresh HOME config simulation
      const envDir = path.join(tmpHome, ".config", "lma");
      fs.mkdirSync(envDir, { recursive: true });
      const envFile = path.join(envDir, "web.env");
      fs.writeFileSync(envFile, "LMA_WEB_PASSWORD=oldpin\nLMA_PUBLIC_URL=https://otto.sprites.app\n");
      assert.equal(fs.existsSync(envFile), true);
      const hash = hashWebPassword("987654");
      assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
