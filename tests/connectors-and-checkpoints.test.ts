import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LMA_FORCE_SQLITE = "1";

const { fetchGatewayList, resolveGatewayBaseUrl } = await import("../web/lib/gateway.ts");
const { handleConnectorsRoutes } = await import("../web/routes/connectors.ts");
const {
  parseCheckpointIdFromResponse,
  createSpriteCheckpoint,
  restoreSpriteCheckpoint,
} = await import("../web/lib/checkpoints.ts");
const {
  CURATED_APIFY_ACTORS,
  clampApifyLimit,
  runCuratedApifyActor,
  resetApifyGatewayCache,
} = await import("../agent/lib/apify.ts");
const {
  boxItemUrl,
  listBoxFolder,
  ensureBoxFolder,
  uploadLocalFileToBox,
  downloadBoxFileToLocal,
  resetBoxGatewayCache,
} = await import("../agent/lib/box.ts");
const { discoverFlyMachinesConnector } = await import("../agent/lib/obs-overlays.ts");
const { bufferGraphQL } = await import("../agent/lib/buffer.ts");

describe("Sprites Gateway discovery & /api/connectors diagnostics", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("discovers connectors without Authorization headers and surfaces explicit warning on empty list", async () => {
    let sawAuthHeader = false;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).get("authorization")) sawAuthHeader = true;
      return Response.json({ connections: [] });
    }) as typeof fetch;

    const gw = await fetchGatewayList();
    assert.equal(gw.ok, true);
    assert.equal(sawAuthHeader, false);

    const req = new Request("http://localhost:8080/api/connectors");
    const res = await handleConnectorsRoutes(req, new URL(req.url));
    assert.ok(res);
    const body = (await res.json()) as { connectors: unknown[]; warning?: string; zeroOutboundApiKeys: boolean };
    assert.deepEqual(body.connectors, []);
    assert.match(body.warning || "", /No Sprites Connectors returned/i);
    assert.equal(typeof body.zeroOutboundApiKeys, "boolean");
  });

  it("resolves matching provider gateway URLs and strips trailing slash", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        connections: [
          { provider: "box", gateway_base_url: "https://api.sprites.dev/v1/gateway/box/conn_1/" },
        ],
      })) as typeof fetch;

    const url = await resolveGatewayBaseUrl((c) => c.provider === "box");
    assert.equal(url, "https://api.sprites.dev/v1/gateway/box/conn_1");
  });
});

describe("Fly.io Sprites Checkpoints parsing & fail-closed validation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses checkpoint IDs from JSON, NDJSON, and human-readable text, and returns null on junk", () => {
    assert.equal(parseCheckpointIdFromResponse('{"id":"v12"}'), "v12");
    assert.equal(parseCheckpointIdFromResponse('{"status":"creating"}\n{"checkpoint_id":"v44"}'), "v44");
    assert.equal(parseCheckpointIdFromResponse('{"data":{"id":"v9"}}'), "v9");
    assert.equal(parseCheckpointIdFromResponse("Checkpoint v7 created successfully"), "v7");
    assert.equal(parseCheckpointIdFromResponse("Status: ok\nID: v103\n"), "v103");
    assert.equal(parseCheckpointIdFromResponse("Checkpoint created with no id"), null);
    assert.equal(parseCheckpointIdFromResponse('{"id":"../v1"}'), null);
    assert.equal(parseCheckpointIdFromResponse(""), null);
  });

  it("fails closed if checkpoint HTTP 200 response contains no parseable ID and blocks invalid restore IDs", async () => {
    globalThis.fetch = (async () => new Response("OK but format changed", { status: 200 })) as typeof fetch;
    const bad = await createSpriteCheckpoint("pre-deploy");
    assert.equal(bad.ok, false);
    assert.equal(bad.id, null);
    assert.match(bad.error || "", /no parseable checkpoint ID/i);

    globalThis.fetch = (async () => new Response('{"id":"v25"}', { status: 200 })) as typeof fetch;
    const good = await createSpriteCheckpoint("pre-deploy");
    assert.equal(good.ok, true);
    assert.equal(good.id, "v25");

    await assert.rejects(() => restoreSpriteCheckpoint("../v1"), /Invalid checkpoint ID/i);
    await assert.rejects(() => restoreSpriteCheckpoint("Current"), /Invalid checkpoint ID/i);
    await assert.rejects(() => restoreSpriteCheckpoint("v1; rm -rf /"), /Invalid checkpoint ID/i);

    globalThis.fetch = (async () => new Response("restored", { status: 200 })) as typeof fetch;
    const restored = await restoreSpriteCheckpoint("v25");
    assert.deepEqual(restored, { ok: true, id: "v25" });
  });
});

describe("Curated Apify zero-key connector adapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetApifyGatewayCache();
    delete process.env.SPRITES_APIFY_GATEWAY_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetApifyGatewayCache();
  });

  it("clamps item limits strictly to [1, 25] and blocks non-curated actor IDs", async () => {
    assert.equal(clampApifyLimit(undefined), 8);
    assert.equal(clampApifyLimit(-5), 1);
    assert.equal(clampApifyLimit(999), 25);
    assert.equal(clampApifyLimit(12.9), 12);

    await assert.rejects(
      () => runCuratedApifyActor("attacker~arbitrary-actor" as never, {}),
      /not in Otto's curated Apify allowlist/i
    );
  });

  it("discovers Apify gateway, executes curated actor, caps items, and sends zero Authorization headers", async () => {
    const authHeaders: Array<string | null> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json({
          connections: [{ provider: "apify", gateway_base_url: "https://api.sprites.dev/v1/gateway/apify/conn_a1" }],
        });
      }
      if (url.includes("/v2/actors/") && url.includes("/runs?waitForFinish=60")) {
        return Response.json({ data: { id: "run_99", status: "SUCCEEDED", defaultDatasetId: "ds_99" } });
      }
      if (url.includes("/v2/datasets/ds_99/items?limit=2&clean=true")) {
        return Response.json([{ id: 1 }, { id: 2 }, { id: 3 }]);
      }
      throw new Error(`Unexpected Apify URL: ${url}`);
    }) as typeof fetch;

    const result = await runCuratedApifyActor(CURATED_APIFY_ACTORS.x, { searchTerms: ["test"] }, { limit: 2 });
    assert.equal(result.runId, "run_99");
    assert.equal(result.datasetId, "ds_99");
    assert.equal(result.items.length, 2);
    assert.ok(authHeaders.every((h) => h === null));
  });
});

describe("Box, Fly Machines & Buffer zero-key connector adapters", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetBoxGatewayCache();
    delete process.env.SPRITES_BOX_GATEWAY_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetBoxGatewayCache();
  });

  it("handles Box folder listing, 409 folder conflict resolution, attributes-before-file upload, 409 replace & download", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-box-test-"));
    const srcFile = path.join(tmpDir, "cutout.png");
    const dstFile = path.join(tmpDir, "downloaded.png");
    fs.writeFileSync(srcFile, Buffer.from("PNGDATA"));

    let uploadKeysOrder: string[] = [];
    let uploadAttempt = 0;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json({
          connections: [{ provider: "box", gateway_base_url: "https://api.sprites.dev/v1/gateway/box/conn_b1" }],
        });
      }
      if (url.includes("/2.0/folders/0/items")) {
        return Response.json({
          entries: [{ id: "100", type: "folder", name: "Otto Assets" }],
        });
      }
      if (url.endsWith("/2.0/folders") && init?.method === "POST") {
        return Response.json(
          { context_info: { conflicts: [{ id: "100", name: "Otto Assets" }] } },
          { status: 409 }
        );
      }
      if (url.endsWith("/upload/files/content")) {
        uploadAttempt += 1;
        if (init?.body instanceof FormData) {
          uploadKeysOrder = Array.from(init.body.keys());
        }
        return Response.json({ context_info: { conflicts: { id: "file_77" } } }, { status: 409 });
      }
      if (url.endsWith("/upload/files/file_77/content")) {
        return Response.json({ entries: [{ id: "file_77", name: "cutout.png", size: 7 }] });
      }
      if (url.endsWith("/2.0/files/file_77/content")) {
        return new Response(Buffer.from("PNGDATA"), { status: 200 });
      }
      throw new Error(`Unexpected Box URL: ${url}`);
    }) as typeof fetch;

    try {
      assert.equal(boxItemUrl("folder", "100"), "https://app.box.com/folder/100");
      const items = await listBoxFolder("0");
      assert.equal(items.length, 1);
      assert.equal(items[0].name, "Otto Assets");

      const folder = await ensureBoxFolder("0", "Otto Assets");
      assert.equal(folder.id, "100");

      const uploaded = await uploadLocalFileToBox(srcFile, "100");
      assert.deepEqual(uploadKeysOrder, ["attributes", "file"]);
      assert.equal(uploadAttempt, 1);
      assert.equal(uploaded.id, "file_77");

      const dl = await downloadBoxFileToLocal("file_77", dstFile);
      assert.equal(dl.size, 7);
      assert.equal(fs.readFileSync(dstFile, "utf8"), "PNGDATA");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("discovers Fly Machines connector by base_api_url and extracts org_slug from test_url", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        connections: [
          {
            provider: "custom_api",
            display_name: "Fly Machines",
            gateway_base_url: "https://api.sprites.dev/v1/gateway/custom_api/fly_m1/",
            provider_info: {
              base_api_url: "https://api.machines.dev",
              test_url: "https://api.machines.dev/v1/apps?org_slug=my-studio",
            },
          },
        ],
      })) as typeof fetch;

    const info = await discoverFlyMachinesConnector(true);
    assert.ok(info);
    assert.equal(info.gatewayBaseUrl, "https://api.sprites.dev/v1/gateway/custom_api/fly_m1");
    assert.equal(info.orgSlug, "my-studio");
  });

  it("surfaces Buffer GraphQL errors cleanly via zero-key gateway", async () => {
    process.env.SPRITES_BUFFER_GATEWAY_URL = "https://api.sprites.dev/v1/gateway/custom_api/buf_1";
    globalThis.fetch = (async () =>
      Response.json({ errors: [{ message: "Channel disconnected" }] })) as typeof fetch;
    try {
      await assert.rejects(() => bufferGraphQL("query { account { id } }"), /Channel disconnected/);
    } finally {
      delete process.env.SPRITES_BUFFER_GATEWAY_URL;
    }
  });
});
