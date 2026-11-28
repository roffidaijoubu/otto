import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otto-core-libs-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.LMA_FORCE_SQLITE = "1";

const { LMA_INTERNAL_SECRET } = await import("../web/lib/config.ts");
const { requireInternalSecret } = await import("../web/lib/internal-auth.ts");
const { readSetupIdentity, writeIdentityToMemoryMd } = await import("../web/lib/identity.ts");
const {
  resolveGoogleReminders,
  toNaiveUtcDatetime,
  extractGCalPayload,
  buildPresetHookSpec,
  inferEventTypeFromTitle,
} = await import("../agent/lib/scheduler-core.ts");
const { formatSec, extractVideoId } = await import("../agent/lib/pinecone-archive.ts");
const {
  discoverElevenLabsGatewayUrl,
  discoverGeminiGatewayUrl,
} = await import("../agent/lib/elevenlabs-stt.ts");

describe("Internal IPC auth & Setup Identity helpers (web/lib/internal-auth.ts, identity.ts)", () => {
  it("enforces timing-safe Bearer / header checks on requireInternalSecret", () => {
    const noAuth = requireInternalSecret(new Request("http://127.0.0.1:8080/api/internal/jobs"));
    assert.equal(noAuth?.status, 403);

    const wrongAuth = requireInternalSecret(
      new Request("http://127.0.0.1:8080/api/internal/jobs", {
        headers: { Authorization: "Bearer wrong-secret-token" },
      })
    );
    assert.equal(wrongAuth?.status, 403);

    const bearerOk = requireInternalSecret(
      new Request("http://127.0.0.1:8080/api/internal/jobs", {
        headers: { Authorization: `Bearer ${LMA_INTERNAL_SECRET}` },
      })
    );
    assert.equal(bearerOk, null);

    const headerOk = requireInternalSecret(
      new Request("http://127.0.0.1:8080/api/internal/jobs", {
        headers: { "x-lma-internal-secret": LMA_INTERNAL_SECRET },
      })
    );
    assert.equal(headerOk, null);
  });

  it("writes & reads MEMORY.md identity atomically while stripping CR/LF injection and ignoring placeholders", () => {
    // Initially empty
    assert.deepEqual(readSetupIdentity(), { creatorName: "", timezone: "" });

    writeIdentityToMemoryMd("Mika\r\n## Injected", "Asia/Jakarta\nEvil");
    const parsed = readSetupIdentity();
    assert.equal(parsed.creatorName, "Mika ## Injected");
    assert.equal(parsed.timezone, "Asia/Jakarta Evil");
    assert.equal(parsed.creatorName.includes("\n"), false);
    assert.equal(parsed.timezone.includes("\n"), false);

    // Placeholder text should be treated as unset
    const memPath = path.join(tmpHome, ".omp", "agent", "MEMORY.md");
    fs.writeFileSync(
      memPath,
      "# Talent Dossier\n- **Name / Persona:** (not set)\n- **Timezone:** (pending onboarding)\n"
    );
    assert.deepEqual(readSetupIdentity(), { creatorName: "", timezone: "" });
  });
});

describe("Scheduler Core, Pinecone Archive & ElevenLabs STT pure helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SPRITES_ELEVENLABS_GATEWAY_URL;
    delete process.env.SPRITES_GEMINI_GATEWAY_URL;
  });

  it("resolves Google Calendar reminder defaults, clamps custom minutes [0..40320], and formats UTC datetimes", () => {
    assert.deepEqual(resolveGoogleReminders("reminder"), [{ method: "popup", minutes: 0 }]);
    assert.deepEqual(resolveGoogleReminders("stream"), [
      { method: "popup", minutes: 60 },
      { method: "popup", minutes: 15 },
    ]);
    assert.deepEqual(resolveGoogleReminders("deadline"), [
      { method: "popup", minutes: 60 },
      { method: "popup", minutes: 10 },
    ]);
    assert.deepEqual(
      resolveGoogleReminders("stream", [
        { method: "email", minutes: 999999 },
        { method: "popup", minutes: -10 },
      ]),
      [
        { method: "email", minutes: 40320 },
        { method: "popup", minutes: 0 },
      ]
    );

    assert.equal(toNaiveUtcDatetime(Date.UTC(2026, 10, 28, 12, 5, 9)), "2026-11-28T12:05:09");
    assert.deepEqual(extractGCalPayload({ data: { response_data: { id: "gcal_1" } } }), { id: "gcal_1" });
    assert.equal(inferEventTypeFromTitle("Collab with Hana"), "collab");
    assert.equal(inferEventTypeFromTitle("Upload new vlog"), "upload");
    assert.equal(inferEventTypeFromTitle("Pay editor invoice"), "reminder");

    const startMs = Date.UTC(2026, 11, 1, 13, 0, 0);
    const endMs = startMs + 3 * 3600_000;
    const pre = buildPresetHookSpec("pre_stream_1h", "Horror Night", startMs, endMs, "2026-12-01T13:00:00Z", "");
    assert.equal(pre.offsetMinutes, -60);
    assert.equal(pre.triggerMs, startMs - 60 * 60_000);
  });

  it("formats archive timestamps and extracts 11-char YouTube IDs across URL formats", () => {
    assert.equal(formatSec(0), "00:00:00");
    assert.equal(formatSec(3665), "01:01:05");
    assert.equal(extractVideoId("Icp_tjjgmvI"), "Icp_tjjgmvI");
    assert.equal(extractVideoId("https://youtu.be/Icp_tjjgmvI?t=42"), "Icp_tjjgmvI");
    assert.equal(extractVideoId("https://www.youtube.com/watch?v=Icp_tjjgmvI&list=PL1"), "Icp_tjjgmvI");
    assert.equal(extractVideoId("https://www.youtube.com/live/Icp_tjjgmvI"), "Icp_tjjgmvI");
    assert.equal(extractVideoId("https://www.youtube.com/shorts/Icp_tjjgmvI"), "Icp_tjjgmvI");
    assert.throws(() => extractVideoId("https://evil.example/not-a-video"), /Could not extract/i);
  });

  it("discovers ElevenLabs and Gemini Sprites Gateways with zero Authorization headers", async () => {
    const authHeaders: Array<string | null> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      return Response.json({
        connections: [
          { provider: "elevenlabs", display_name: "ElevenLabs", gateway_base_url: "https://api.sprites.dev/v1/gateway/elevenlabs/el_1/" },
          { provider: "gemini", display_name: "Google Gemini", gateway_base_url: "https://api.sprites.dev/v1/gateway/gemini/gem_1/" },
        ],
      });
    }) as typeof fetch;

    const elUrl = await discoverElevenLabsGatewayUrl();
    const gemUrl = await discoverGeminiGatewayUrl();
    assert.equal(elUrl, "https://api.sprites.dev/v1/gateway/elevenlabs/el_1");
    assert.equal(gemUrl, "https://api.sprites.dev/v1/gateway/gemini/gem_1");
    assert.ok(authHeaders.every((h) => h === null));

    fs.rmSync(tmpHome, { recursive: true, force: true });
  });
});
