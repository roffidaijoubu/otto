import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otto-ws-test-"));
const outsideFile = path.join(os.tmpdir(), `otto-outside-${Date.now()}.txt`);
fs.writeFileSync(outsideFile, "TOP_SECRET_OUTSIDE");
process.env.LMA_WORKSPACE_DIR = tmpRoot;

const {
  WORKSPACE_ROOT,
  STARTER_DIRS,
  ensureWorkspaceScaffold,
  sanitizeSegment,
  normalizeRelPath,
  resolveSafeWorkspacePath,
  classifyFile,
} = await import("../web/lib/workspace.ts");

describe("workspace realpath jail & path sanitization", () => {
  before(() => {
    ensureWorkspaceScaffold();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  });

  it("creates all 6 starter directories inside WORKSPACE_ROOT", () => {
    assert.equal(path.resolve(WORKSPACE_ROOT), path.resolve(tmpRoot));
    for (const dir of STARTER_DIRS) {
      assert.equal(fs.statSync(path.join(WORKSPACE_ROOT, dir)).isDirectory(), true);
    }
  });

  it("normalizes clean relative paths and rejects traversal, dotfiles, and null bytes", () => {
    assert.equal(normalizeRelPath("scripts/intro.md"), "scripts/intro.md");
    assert.equal(normalizeRelPath("clips\\ep1\\cut.mp4"), "clips/ep1/cut.mp4");
    assert.equal(normalizeRelPath("/briefs/sponsor.txt/"), "briefs/sponsor.txt");
    assert.equal(normalizeRelPath(""), "");

    assert.throws(() => normalizeRelPath("../../etc/passwd"), /not allowed/i);
    assert.throws(() => normalizeRelPath("scripts/../secret.txt"), /not allowed/i);
    assert.throws(() => normalizeRelPath(".env"), /not allowed/i);
    assert.throws(() => normalizeRelPath("scripts/.hidden"), /not allowed/i);
    assert.throws(() => normalizeRelPath("scripts/a\0b.md"), /Invalid path/i);
    assert.throws(() => normalizeRelPath("scripts/a\nb.md"), /control character/i);
  });

  it("resolves valid existing and allowMissing paths inside workspace", () => {
    const filePath = path.join(WORKSPACE_ROOT, "scripts", "plan.md");
    fs.writeFileSync(filePath, "# Plan");

    const resolved = resolveSafeWorkspacePath("scripts/plan.md");
    assert.equal(resolved.relPath, "scripts/plan.md");
    assert.equal(fs.realpathSync(resolved.absPath), fs.realpathSync(filePath));

    assert.throws(() => resolveSafeWorkspacePath("scripts/missing.md"), /Path not found/i);
    const allowed = resolveSafeWorkspacePath("scripts/new-dir/draft.md", { allowMissing: true });
    assert.equal(allowed.relPath, "scripts/new-dir/draft.md");
  });

  it("rejects symlinks escaping or inside workspace", (t) => {
    const linkPath = path.join(WORKSPACE_ROOT, "scripts", "evil-link.txt");
    try {
      fs.symlinkSync(outsideFile, linkPath);
    } catch {
      t.skip("Symlink creation requires elevated privileges on this Windows host");
      return;
    }
    assert.throws(() => resolveSafeWorkspacePath("scripts/evil-link.txt"), /Symlink/i);
  });

  it("sanitizes dangerous path segments and classifies file types accurately", () => {
    assert.equal(sanitizeSegment("..//hello/world.md"), "_hello_world.md");
    assert.throws(() => sanitizeSegment("..."), /Invalid/i);

    assert.deepEqual(classifyFile("thumb.png"), {
      kind: "image",
      editable: false,
      previewable: true,
      inlineMime: "image/png",
    });
    assert.equal(classifyFile("clip.mp4").kind, "video");
    assert.equal(classifyFile("voice.wav").kind, "audio");
    assert.equal(classifyFile("notes.md").editable, true);
    assert.equal(classifyFile("captions.srt").editable, true);
    assert.equal(classifyFile("archive.zip").kind, "other");
  });
});
