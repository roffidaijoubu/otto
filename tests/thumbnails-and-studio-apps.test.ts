import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otto-creative-test-"));
const wsDir = path.join(tmpRoot, "workspace");
const appsDir = path.join(tmpRoot, "studio-apps");
fs.mkdirSync(path.join(wsDir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(wsDir, "uploads", "hero-cutout.png"), Buffer.from("FAKEPNG"));
fs.writeFileSync(path.join(wsDir, "uploads", "evil.sh"), "#!/bin/sh\necho nope");

process.env.LMA_WORKSPACE_DIR = wsDir;
process.env.LMA_STUDIO_APPS_DIR = appsDir;

const thumbs = await import("../agent/lib/thumbnails.ts");
const apps = await import("../agent/lib/studio-apps.ts");

describe("Zero-AI Thumbnail Studio project store (agent/lib/thumbnails.ts)", () => {
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("sanitizes slugs and asset filenames while rejecting traversal and non-image extensions", () => {
    assert.equal(thumbs.sanitizeThumbnailSlug("  Friday Boss Rush!!  "), "friday-boss-rush");
    assert.throws(() => thumbs.sanitizeThumbnailSlug("!!!"), /Invalid thumbnail slug/i);
    assert.equal(thumbs.sanitizeThumbnailAssetName("dir/hero cutout.png"), "hero-cutout.png");
    assert.throws(() => thumbs.sanitizeThumbnailAssetName("script.sh"), /Invalid thumbnail asset/i);
  });

  it("saves 1280x720 HTML project, copies workspace cutout, rewrites relative asset URLs, exports bytes & deletes", () => {
    const saved = thumbs.saveThumbnailProject({
      slug: "friday-stream",
      title: "Friday Boss Rush",
      description: "High-contrast 3-word composition",
      html: '<html><body><img src="./assets/hero-cutout.png" /><img src="/assets/hero-cutout.png" /></body></html>',
      assets: ["uploads/hero-cutout.png"],
    });

    assert.equal(saved.project.slug, "friday-stream");
    assert.equal(saved.project.width, 1280);
    assert.equal(saved.project.height, 720);
    assert.deepEqual(saved.project.assets, ["hero-cutout.png"]);
    assert.equal(saved.copiedAssets.length, 1);

    const detail = thumbs.getThumbnailProject("friday-stream");
    assert.ok(detail);
    assert.match(detail.html, /\/api\/thumbnails\/friday-stream\/assets\/hero-cutout\.png/);
    assert.equal(detail.html.includes("./assets/"), false);
    assert.equal(thumbs.listThumbnailProjects().length, 1);

    const exported = thumbs.saveThumbnailExportBytes("friday-stream", Buffer.from("JPGDATA"), "jpg");
    assert.equal(exported.workspacePath, "thumbnails/friday-stream/friday-stream.jpg");
    assert.equal(exported.size, 7);
    assert.equal(fs.existsSync(exported.filePath), true);

    assert.equal(thumbs.deleteThumbnailProject("friday-stream"), true);
    assert.equal(thumbs.getThumbnailProject("friday-stream"), null);
  });

  it("blocks workspace traversal and disallowed asset types during thumbnail save", () => {
    assert.throws(
      () =>
        thumbs.saveThumbnailProject({
          slug: "escape-test",
          title: "Escape",
          html: "<div/>",
          assets: ["../../etc/passwd"],
        }),
      /escapes/i
    );
    assert.throws(
      () =>
        thumbs.saveThumbnailProject({
          slug: "bad-ext",
          title: "Bad Ext",
          html: "<div/>",
          assets: ["uploads/evil.sh"],
        }),
      /Invalid thumbnail asset/i
    );
  });
});

describe("Custom Studio Apps store (agent/lib/studio-apps.ts)", () => {
  it("creates, persists state, lists, enforces 1 MB cap, and deletes custom studio apps", () => {
    const meta = apps.saveCustomStudioApp({
      slug: "stream-checklist",
      title: "Pre-Stream Checklist",
      kind: "html",
      code: "<div>Mic check</div>",
      initialState: { micChecked: true },
    });
    assert.equal(meta.slug, "stream-checklist");
    assert.equal(meta.entryFile, "app.html");

    const loaded = apps.getCustomStudioApp("stream-checklist");
    assert.ok(loaded);
    assert.equal(loaded.code, "<div>Mic check</div>");
    assert.deepEqual(loaded.state, { micChecked: true });
    assert.equal(apps.listCustomStudioApps().length, 1);

    const nextState = apps.saveCustomStudioAppState("stream-checklist", { micChecked: true, obsReady: true });
    assert.deepEqual(nextState, { micChecked: true, obsReady: true });

    const oversized = "x".repeat(apps.MAX_APP_CODE_BYTES + 10);
    assert.throws(
      () =>
        apps.saveCustomStudioApp({
          slug: "too-big",
          title: "Too Big",
          kind: "html",
          code: oversized,
        }),
      /1 MB limit/i
    );

    assert.equal(apps.deleteCustomStudioApp("stream-checklist"), true);
    assert.equal(apps.getCustomStudioApp("stream-checklist"), null);
  });
});
