import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "otto-obs-cfg-"));
process.env.LMA_CONFIG_DIR = tmpCfg;

const {
  ensureOverlayMachine,
  resetFlyConnectorCacheForTests,
} = await import("../agent/lib/obs-overlays.ts");
const { isPrivateOrReservedIp, assertSafePublicHttpsUrl } = await import("../agent/lib/ssrf-guard.ts");

describe("Fly Machine #2 zero-Docker OBS Overlay provisioning (agent/lib/obs-overlays.ts)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetFlyConnectorCacheForTests();
    const cfgPath = path.join(tmpCfg, "obs-overlay-machine.json");
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetFlyConnectorCacheForTests();
  });

  it("provisions app, shared_v4 + v6 IPs, 1 GB volume, and 256 MB auto-stop Bun Machine with base64 config.files & zero Authorization headers", async () => {
    let capturedMachinePayload: Record<string, unknown> | null = null;
    let capturedVolumePayload: Record<string, unknown> | null = null;
    const gatewayAuthHeaders: Array<string | null> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://api.sprites.dev/")) {
        gatewayAuthHeaders.push(new Headers(init?.headers).get("authorization"));
      }
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json({
          connections: [
            {
              provider: "custom_api",
              display_name: "Fly Machines",
              gateway_base_url: "https://api.sprites.dev/v1/gateway/custom_api/fly_conn_1",
              provider_info: {
                base_api_url: "https://api.machines.dev",
                test_url: "https://api.machines.dev/v1/apps?org_slug=studio-org",
              },
            },
          ],
        });
      }
      if (url.endsWith("/v1/apps") && init?.method === "POST") {
        return Response.json({ ok: true }, { status: 201 });
      }
      if (url.includes("/ip_assignments") && init?.method === "POST") {
        return Response.json({ ip: "198.51.100.10" }, { status: 201 });
      }
      if (url.endsWith("/volumes") && init?.method === "POST") {
        capturedVolumePayload = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
        return Response.json({ id: "vol_test_1gb", region: "sin" }, { status: 201 });
      }
      if (url.endsWith("/machines") && init?.method === "POST") {
        capturedMachinePayload = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
        return Response.json({ id: "mach_obs_1", instance_id: "inst_1" }, { status: 200 });
      }
      if (url.includes("/wait?state=started")) {
        return Response.json({ ok: true }, { status: 200 });
      }
      if (url.endsWith("/health")) {
        return Response.json({ ok: true }, { status: 200 });
      }
      throw new Error(`Unexpected Fly provisioning fetch: ${url}`);
    }) as typeof fetch;

    try {
      const cfg = await ensureOverlayMachine();
      assert.match(cfg.appName, /^otto-obs-[0-9a-f]{8}$/);
      assert.equal(cfg.machineId, "mach_obs_1");
      assert.equal(cfg.volumeId, "vol_test_1gb");
      assert.equal(cfg.orgSlug, "studio-org");
      assert.equal(cfg.baseUrl, `https://${cfg.appName}.fly.dev`);
      assert.ok(fs.existsSync(path.join(tmpCfg, "obs-overlay-machine.json")));

      // Verify zero Authorization headers sent to Fly Sprites Gateway
      assert.ok(gatewayAuthHeaders.length >= 5);
      assert.ok(gatewayAuthHeaders.every((h) => h === null));

      // Verify 1 GB Fly Volume & zero-Docker auto-stop Bun Machine config
      assert.deepEqual(capturedVolumePayload, { name: "overlay_data", size_gb: 1, region: "sin" });
      const machinePayload = capturedMachinePayload as Record<string, unknown> | null;
      assert.ok(machinePayload);
      const mCfg = machinePayload.config as {
        image: string;
        guest: { memory_mb: number };
        files: Array<{ guest_path: string; raw_value: string }>;
        services: Array<{ autostart: boolean; autostop: string; min_machines_running: number }>;
      };
      assert.equal(mCfg.image, "oven/bun:1-alpine");
      assert.equal(mCfg.guest.memory_mb, 256);
      assert.equal(mCfg.files[0].guest_path, "/app/server.ts");
      const decodedServer = Buffer.from(mCfg.files[0].raw_value, "base64").toString("utf8");
      assert.match(decodedServer, /Bun\.serve/);
      assert.equal(mCfg.services[0].autostart, true);
      assert.equal(mCfg.services[0].autostop, "stop");
      assert.equal(mCfg.services[0].min_machines_running, 0);
    } finally {
      fs.rmSync(tmpCfg, { recursive: true, force: true });
    }
  });
});

describe("Hardened HTTPS SSRF guard (agent/lib/ssrf-guard.ts)", () => {
  it("classifies private, loopback, metadata, CGNAT, NAT64, IPv4-mapped, and ULA IPs as reserved", () => {
    for (const blocked of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.50",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::10.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "not-an-ip",
    ]) {
      assert.equal(isPrivateOrReservedIp(blocked), true, `Expected ${blocked} to be blocked`);
    }

    for (const allowed of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      assert.equal(isPrivateOrReservedIp(allowed), false, `Expected ${allowed} to be public`);
    }
  });

  it("blocks http://, credentials, internal hostnames, private literals, and DNS rebinding to private IPs", async () => {
    await assert.rejects(() => assertSafePublicHttpsUrl("http://example.com/img.png"), /https:\/\//i);
    await assert.rejects(() => assertSafePublicHttpsUrl("https://user:pass@example.com/img.png"), /credentials/i);
    await assert.rejects(() => assertSafePublicHttpsUrl("https://localhost/a.png"), /private\/internal/i);
    await assert.rejects(() => assertSafePublicHttpsUrl("https://metadata.google.internal/a.png"), /private\/internal/i);
    await assert.rejects(() => assertSafePublicHttpsUrl("https://169.254.169.254/latest/meta-data"), /private\/reserved/i);
    await assert.rejects(() => assertSafePublicHttpsUrl("https://[::1]/a.png"), /private\/reserved/i);

    // DNS rebinding to AWS/GCP metadata IP must be blocked
    await assert.rejects(
      () =>
        assertSafePublicHttpsUrl("https://rebind.attacker.example/thumb.jpg", async () => [
          { address: "169.254.169.254" },
        ]),
      /Refused private\/reserved resolved IP/i
    );

    // Clean public resolution succeeds
    const safe = await assertSafePublicHttpsUrl("https://cdn.example.com/thumb.jpg", async () => [
      { address: "93.184.216.34" },
    ]);
    assert.equal(safe.hostname, "cdn.example.com");
  });
});
