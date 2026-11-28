import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const {
  verifyQStashJwtWithKey,
  verifyUpstashSignature,
  getClientKey,
  computeGuardrailStatus,
} = await import("../web/lib/qstash.ts");
const {
  normalizeQStashCron,
  extractIanaTimezone,
  buildMidnightCronForTimezone,
} = await import("../agent/lib/qstash-cron.ts");

function signTestJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: string
): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

describe("QStash JWT verification (HS256 + alg check + sub binding + SHA-256 body)", () => {
  const KEY1 = "sig_test_primary_key_12345";
  const KEY2 = "sig_test_secondary_key_67890";
  const BODY = JSON.stringify({ label: "Pre-Stream Check", prompt: "Check schedule" });
  const BODY_HASH_URL = crypto.createHash("sha256").update(BODY).digest("base64url");
  const BODY_HASH_STD = crypto.createHash("sha256").update(BODY).digest("base64");
  const NOW = Math.floor(Date.now() / 1000);
  const savedPublicUrl = process.env.LMA_PUBLIC_URL;
  const savedCurKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const savedNextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  beforeEach(() => {
    delete process.env.LMA_PUBLIC_URL;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  afterEach(() => {
    if (savedPublicUrl === undefined) delete process.env.LMA_PUBLIC_URL;
    else process.env.LMA_PUBLIC_URL = savedPublicUrl;
    if (savedCurKey === undefined) delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    else process.env.QSTASH_CURRENT_SIGNING_KEY = savedCurKey;
    if (savedNextKey === undefined) delete process.env.QSTASH_NEXT_SIGNING_KEY;
    else process.env.QSTASH_NEXT_SIGNING_KEY = savedNextKey;
  });

  it("accepts a valid HS256 JWT with base64url or standard base64 body digest", () => {
    const tok1 = signTestJwt(
      { alg: "HS256", typ: "JWT" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/wakeup", exp: NOW + 300, nbf: NOW - 10, body: BODY_HASH_URL },
      KEY1
    );
    const tok2 = signTestJwt(
      { alg: "HS256", typ: "JWT" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/wakeup", exp: NOW + 300, nbf: NOW - 10, body: BODY_HASH_STD },
      KEY1
    );
    assert.equal(verifyQStashJwtWithKey(tok1, BODY, KEY1), true);
    assert.equal(verifyQStashJwtWithKey(tok2, BODY, KEY1), true);
  });

  it("rejects alg=none, alg=RS256, and malformed JWT headers", () => {
    const payload = {
      iss: "Upstash",
      sub: "https://otto.sprites.app/api/wakeup",
      exp: NOW + 300,
      body: BODY_HASH_URL,
    };
    const noneAlg = signTestJwt({ alg: "none", typ: "JWT" }, payload, KEY1);
    const rsAlg = signTestJwt({ alg: "RS256", typ: "JWT" }, payload, KEY1);
    assert.equal(verifyQStashJwtWithKey(noneAlg, BODY, KEY1), false);
    assert.equal(verifyQStashJwtWithKey(rsAlg, BODY, KEY1), false);
    assert.equal(verifyQStashJwtWithKey("not.a.jwt", BODY, KEY1), false);
  });

  it("enforces fail-closed destination sub binding (rejects missing sub, mismatched host, or non-wakeup path)", () => {
    const missingSub = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", exp: NOW + 300, body: BODY_HASH_URL },
      KEY1
    );
    assert.equal(verifyQStashJwtWithKey(missingSub, BODY, KEY1), false);

    const otherEndpoint = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/other", exp: NOW + 300, body: BODY_HASH_URL },
      KEY1
    );
    assert.equal(verifyQStashJwtWithKey(otherEndpoint, BODY, KEY1), false);

    process.env.LMA_PUBLIC_URL = "https://otto.sprites.app";
    const wrongHost = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", sub: "https://other-app.sprites.app/api/wakeup", exp: NOW + 300, body: BODY_HASH_URL },
      KEY1
    );
    assert.equal(verifyQStashJwtWithKey(wrongHost, BODY, KEY1), false);
    assert.equal(verifyQStashJwtWithKey(missingSub, BODY, KEY1), false);
  });

  it("rejects expired tokens, wrong issuer, wrong signing key, and tampered bodies", () => {
    const expired = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/wakeup", exp: NOW - 120, body: BODY_HASH_URL },
      KEY1
    );
    const wrongIss = signTestJwt(
      { alg: "HS256" },
      { iss: "Attacker", sub: "https://otto.sprites.app/api/wakeup", exp: NOW + 300, body: BODY_HASH_URL },
      KEY1
    );
    const valid = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/wakeup", exp: NOW + 300, body: BODY_HASH_URL },
      KEY1
    );
    assert.equal(verifyQStashJwtWithKey(expired, BODY, KEY1), false);
    assert.equal(verifyQStashJwtWithKey(wrongIss, BODY, KEY1), false);
    assert.equal(verifyQStashJwtWithKey(valid, BODY, KEY2), false);
    assert.equal(verifyQStashJwtWithKey(valid, BODY + " ", KEY1), false);
  });

  it("verifies dual rotating signing keys via verifyUpstashSignature", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = KEY1;
    process.env.QSTASH_NEXT_SIGNING_KEY = KEY2;

    const tokWithNext = signTestJwt(
      { alg: "HS256" },
      { iss: "Upstash", sub: "https://otto.sprites.app/api/wakeup", exp: NOW + 300, body: BODY_HASH_URL },
      KEY2
    );
    const req = new Request("https://otto.sprites.app/api/wakeup", {
      method: "POST",
      headers: { "upstash-signature": tokWithNext },
      body: BODY,
    });
    assert.equal(verifyUpstashSignature(req, BODY), true);
    assert.equal(verifyUpstashSignature(new Request("https://otto.sprites.app/api/wakeup"), BODY), false);
  });
});

describe("getClientKey & computeGuardrailStatus", () => {
  it("prefers fly-client-ip and takes rightmost hop from x-forwarded-for", () => {
    const reqFly = new Request("https://otto.sprites.app/", {
      headers: { "fly-client-ip": "198.51.100.5", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    assert.equal(getClientKey(reqFly), "198.51.100.5");

    const reqXff = new Request("https://otto.sprites.app/", {
      headers: { "x-forwarded-for": "spoofed.attacker, 203.0.113.42" },
    });
    assert.equal(getClientKey(reqXff), "203.0.113.42");
  });

  it("reports zeroOutboundApiKeys and inboundSigningKeysConfigured transparently", () => {
    const outboundKeys = [
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "EXA_API_KEY",
      "FIRECRAWL_API_KEY",
      "COMPOSIO_API_KEY",
      "BUFFER_API_KEY",
      "QSTASH_TOKEN",
      "LMA_NEON_DATABASE_URL",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "ELEVENLABS_API_KEY",
      "PINECONE_API_KEY",
      "APIFY_TOKEN",
      "BOX_DEVELOPER_TOKEN",
      "PIXABAY_API_KEY",
      "FLY_API_TOKEN",
      "NEON_API_KEY",
    ];
    const saved: Record<string, string | undefined> = {};
    for (const k of [...outboundKeys, "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      // Case 1: Zero outbound API keys AND zero inbound signing keys
      const totallyClean = computeGuardrailStatus();
      assert.equal(totallyClean.zeroOutboundApiKeys, true);
      assert.equal(totallyClean.inboundSigningKeysConfigured, false);
      assert.equal(totallyClean.zeroLocalKeys, true);
      assert.equal(totallyClean.inboundKeysIsolatedFromAgent, true);

      // Case 2: Deployed Sprite with inbound QStash signing key — zeroOutboundApiKeys stays true,
      // but zeroLocalKeys honestly flips false while inboundKeysIsolatedFromAgent dynamically verifies child-env stripping
      process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_local_webhook_key";
      const withInboundKey = computeGuardrailStatus();
      assert.equal(withInboundKey.zeroOutboundApiKeys, true);
      assert.equal(withInboundKey.inboundSigningKeysConfigured, true);
      assert.equal(withInboundKey.zeroLocalKeys, false);
      assert.equal(withInboundKey.inboundKeysIsolatedFromAgent, true);

      // Case 3: Outbound vendor key present -> both zeroOutboundApiKeys and zeroLocalKeys flip false
      process.env.ANTHROPIC_API_KEY = "sk-ant-leak";
      const dirty = computeGuardrailStatus();
      assert.equal(dirty.zeroOutboundApiKeys, false);
      assert.equal(dirty.zeroLocalKeys, false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("QStash CRON_TZ validation & IANA timezone extraction", () => {
  it("normalizes valid UTC and CRON_TZ expressions", () => {
    assert.equal(normalizeQStashCron("0 4 * * *"), "0 4 * * *");
    assert.equal(normalizeQStashCron("CRON_TZ=Asia/Jakarta   0  0  *  *  *"), "CRON_TZ=Asia/Jakarta 0 0 * * *");
    assert.equal(buildMidnightCronForTimezone("America/Los_Angeles"), "CRON_TZ=America/Los_Angeles 0 0 * * *");
    assert.equal(buildMidnightCronForTimezone("Asia/Jakarta (WIB, UTC+7)"), "CRON_TZ=Asia/Jakarta 0 0 * * *");
    assert.equal(extractIanaTimezone("WIB"), "Asia/Jakarta");
    assert.equal(extractIanaTimezone("WITA"), "Asia/Makassar");
    assert.equal(extractIanaTimezone("WIT"), "Asia/Jayapura");
  });

  it("rejects invalid timezones, wrong field counts, and header injection characters", () => {
    assert.throws(() => normalizeQStashCron("CRON_TZ=Mars/Olympus 0 0 * * *"), /Invalid|Unrecognized/i);
    assert.throws(() => normalizeQStashCron("0 0 * *"), /exactly 5 fields/i);
    assert.throws(() => normalizeQStashCron("0 0 * * *\nX-Evil: 1"), /single line/i);
    assert.throws(() => normalizeQStashCron("CRON_TZ=Asia/Jakarta"), /5-field/i);
    assert.throws(() => normalizeQStashCron("0 0 * * $(whoami)"), /Invalid cron field/i);
  });
});
