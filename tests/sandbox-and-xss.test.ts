import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("Sandbox security, prompt-injection isolation & policy contracts", () => {
  it("enforces generate_image: deny and disabled in agent/config.yml", () => {
    const cfg = fs.readFileSync(path.join(REPO_ROOT, "agent", "config.yml"), "utf8");
    assert.match(cfg, /generate_image:\s*deny/i);
    assert.match(cfg, /generate_image:\s*\r?\n\s+enabled:\s*false/i);
  });

  it("builds sandboxed Custom Studio App iframe HTML with escaped JSON and capability token verification", async () => {
    const sandbox = await import("../web/src/lib/studio-app-sandbox.ts");
    assert.equal(typeof sandbox.buildStudioAppSrcdoc, "function");

    const html = sandbox.buildStudioAppSrcdoc({
      kind: "html",
      slug: "test-app",
      title: 'Evil </title><script>alert(1)</script>',
      code: "<div>Hello Studio</div>",
      bridgeToken: "tok_1234567890abcdef",
      initialState: { note: "</script><img src=x onerror=alert(1)>" },
    });

    assert.equal(html.includes("</script><img"), false);
    assert.match(html, /\\u003c\/script\\u003e/);
    assert.match(html, /&lt;\/title&gt;&lt;script&gt;/);
    assert.match(html, /__ottoAppBridgeReply/);
    assert.match(html, /tok_1234567890abcdef/);
  });

  it("enforces zero filesystem tools (--no-tools) and untrusted delimiters on /api/contacts/draft-outreach", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "web", "routes", "isolated-ai.ts"), "utf8");
    assert.match(src, /noTools:\s*true/);
    assert.match(src, /<untrusted_contact_data>/);
    assert.equal(/runIsolatedQuickTask\(\{\s*tools:\s*"read"/.test(src), false);
  });

  it("keeps CustomStudioAppWindow iframe strictly opaque (sandbox=allow-scripts without allow-same-origin)", () => {
    const vue = fs.readFileSync(
      path.join(REPO_ROOT, "web", "src", "components", "CustomStudioAppWindow.vue"),
      "utf8"
    );
    assert.match(vue, /sandbox="allow-scripts"/);
    assert.equal(vue.includes("allow-same-origin"), false);
  });

  it("verifies all 10 desktop apps, 22 extensions, 85 registered tools, and 9 skills exist on disk", () => {
    const extFiles = fs
      .readdirSync(path.join(REPO_ROOT, "agent", "extensions"))
      .filter((f) => f.endsWith(".ts"));
    assert.equal(extFiles.length, 22);

    let toolCount = 0;
    for (const f of extFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, "agent", "extensions", f), "utf8");
      const matches = content.match(/pi\.registerTool/g);
      toolCount += matches ? matches.length : 0;
    }
    assert.equal(toolCount, 85);

    const skillDirs = fs
      .readdirSync(path.join(REPO_ROOT, "agent", "skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory());
    assert.equal(skillDirs.length, 9);

    const wm = fs.readFileSync(
      path.join(REPO_ROOT, "web", "src", "composables", "useWindowManager.ts"),
      "utf8"
    );
    const appIds = wm.match(/^    id: "/gm) || [];
    assert.equal(appIds.length, 10);
  });
});
