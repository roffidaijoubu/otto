import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  addChannelMetric,
  deleteChannelMetric,
  deleteClipJob,
  deleteClipRecord,
  deleteContact,
  deletePipelineItem,
  getStudioDbOverview,
  getStudioMeta,
  listCalendarEvents,
  listChannelMetrics,
  listClipJobs,
  listClipRecords,
  listContacts,
  listPipelineItems,
  saveCalendarEventsBatch,
  setStudioMeta,
  updateClipBoxUrl,
  upsertContact,
  upsertPipelineItem,
  type CalendarEvent,
  type CalendarWakeupHook,
  type ContactRole,
  type ContactStatus,
  type PipelineFormat,
  type PipelineStatus,
} from "../agent/lib/studio-db.ts";
import {
  cancelBackgroundClipJob,
  getActiveClipWorkerIds,
  isClipWorkerBusy,
  startBackgroundClipJob,
} from "./lib/clip-worker.ts";
import {
  deleteCustomStudioApp,
  getCustomStudioApp,
  getCustomStudioAppState,
  listCustomStudioApps,
  saveCustomStudioAppState,
  updateCustomStudioAppCode,
} from "../agent/lib/studio-apps.ts";
import {
  deleteHostedObsOverlay,
  listHostedObsOverlays,
  updateObsOverlayState,
} from "../agent/lib/obs-overlays.ts";
import {
  getYouTubeMetricsWidgetState,
  shouldAutoSyncYouTubeMetrics,
  syncDailyMetricsQStashSchedule,
  syncYouTubeMetrics,
} from "../agent/lib/youtube-metrics.ts";
import {
  exportWorkspaceEntryToBox,
  resolveBoxGatewayUrl,
} from "../agent/lib/box.ts";
import {
  classifyFile,
  createWorkspaceZip,
  ensureWorkspaceScaffold,
  listWorkspaceDirectory,
  MAX_TEXT_PREVIEW_BYTES,
  MAX_UPLOAD_BYTES,
  resolveSafeWorkspacePath,
  sanitizeSegment,
  uniqueDestinationPath,
  WORKSPACE_CLIPS_DIR,
  WORKSPACE_ROOT,
} from "./lib/workspace.ts";

const LMA_INTERNAL_SECRET = crypto.randomBytes(24).toString("hex");

const PORT = Number(process.env.PORT || 8080);
const DIST_DIR = path.join(import.meta.dir, "dist");
const HOME_DIR = process.env.HOME || "/home/sprite";
const LOCAL_BIN = path.join(HOME_DIR, ".local", "bin");
if (!String(process.env.PATH || "").includes(LOCAL_BIN)) {
  process.env.PATH = `${LOCAL_BIN}:${process.env.PATH || ""}`;
}
const WORK_DIR = process.env.LMA_WORKDIR || HOME_DIR;
const OMP_BIN =
  process.env.OMP_BIN ||
  (fs.existsSync(path.join(LOCAL_BIN, "omp")) ? path.join(LOCAL_BIN, "omp") : "omp");

// Load optional private runtime config (~/.config/lma/web.env, chmod 600, outside git)
function loadPrivateEnv() {
  const home = process.env.HOME || "/home/sprite";
  const envFile = path.join(home, ".config", "lma", "web.env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  }
}
loadPrivateEnv();

let webPassword = process.env.LMA_WEB_PASSWORD || "";
const AUTH_COOKIE_NAME = "lma_session";

function computeSessionToken(password: string): string {
  return crypto.createHmac("sha256", password).update("lma-web-session-v1").digest("base64url");
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function buildAuthCookieHeader(req: Request, url: URL, password: string): string {
  const token = computeSessionToken(password);
  const isHttps =
    url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const secureAttr = isHttps ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureAttr}`;
}

function updatePrivateWebPassword(newPassword: string): void {
  const home = process.env.HOME || "/home/sprite";
  const envDir = path.join(home, ".config", "lma");
  const envFile = path.join(envDir, "web.env");
  fs.mkdirSync(envDir, { recursive: true, mode: 0o700 });
  const lines = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    : [];
  let replaced = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*LMA_WEB_PASSWORD\s*=/.test(line)) {
      out.push(`LMA_WEB_PASSWORD=${newPassword}`);
      replaced = true;
    } else if (line.length > 0 || out.length > 0) {
      out.push(line);
    }
  }
  if (!replaced) {
    out.push(`LMA_WEB_PASSWORD=${newPassword}`);
  }
  const content = out.join("\n").replace(/\n*$/, "\n");
  const tmpFile = `${envFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmpFile, 0o600);
  fs.renameSync(tmpFile, envFile);
  webPassword = newPassword;
  process.env.LMA_WEB_PASSWORD = newPassword;
}

function readSetupIdentity(): { creatorName: string; timezone: string } {
  const home = process.env.HOME || "/home/sprite";
  const memPath = path.join(home, ".omp", "agent", "MEMORY.md");
  if (!fs.existsSync(memPath)) return { creatorName: "", timezone: "" };
  const md = fs.readFileSync(memPath, "utf8");
  const cleanVal = (raw: string): string => {
    const cleaned = raw.replace(/[*`]/g, "").trim();
    if (!cleaned || /^\(not set|\(pending/i.test(cleaned)) return "";
    return cleaned;
  };
  const nameMatch = md.match(/-\s*\*\*Name\s*\/\s*Persona:\*\*\s*(.+)/i);
  const tzMatch = md.match(/-\s*\*\*Timezone:\*\*\s*(.+)/i);
  return {
    creatorName: nameMatch ? cleanVal(nameMatch[1]) : "",
    timezone: tzMatch ? cleanVal(tzMatch[1]) : "",
  };
}

function writeIdentityToMemoryMd(creatorName: string, timezone: string): void {
  const home = process.env.HOME || "/home/sprite";
  const memDir = path.join(home, ".omp", "agent");
  const memPath = path.join(memDir, "MEMORY.md");
  fs.mkdirSync(memDir, { recursive: true });
  let md = "";
  if (fs.existsSync(memPath)) {
    md = fs.readFileSync(memPath, "utf8");
  } else {
    const examplePath = path.resolve(import.meta.dir, "..", "agent", "MEMORY.md.example");
    md = fs.existsSync(examplePath)
      ? fs.readFileSync(examplePath, "utf8")
      : `# Talent Dossier\n\n## Profile\n- **Name / Persona:** (not set)\n- **Timezone:** (not set)\n`;
  }
  const safeName = creatorName.replace(/[\r\n]+/g, " ").trim();
  const safeTz = timezone.replace(/[\r\n]+/g, " ").trim();
  if (safeName) {
    if (/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i.test(md)) {
      md = md.replace(/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i, `- **Name / Persona:** ${safeName}`);
    } else {
      md = `- **Name / Persona:** ${safeName}\n` + md;
    }
  }
  if (safeTz) {
    if (/-\s*\*\*Timezone:\*\*.*/i.test(md)) {
      md = md.replace(/-\s*\*\*Timezone:\*\*.*/i, `- **Timezone:** ${safeTz}`);
    } else if (/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i.test(md)) {
      md = md.replace(/(-\s*\*\*Name\s*\/\s*Persona:\*\*.*)/i, `$1\n- **Timezone:** ${safeTz}`);
    } else {
      md = `- **Timezone:** ${safeTz}\n` + md;
    }
  }
  const tmp = `${memPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, md, "utf8");
  fs.renameSync(tmp, memPath);
}

function isAuthenticated(req: Request): boolean {
  // Fail-closed: never expose the agent without LMA_WEB_PASSWORD configured in ~/.config/lma/web.env
  if (!webPassword) return false;
  const cookieHeader = req.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rest] = part.trim().split("=");
    if (rawK === AUTH_COOKIE_NAME) {
      const val = rest.join("=");
      return timingSafeStrEqual(val, computeSessionToken(webPassword));
    }
  }
  return false;
}
function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function verifyQStashJwtWithKey(token: string, rawBody: string, key: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (!timingSafeStrEqual(sigB64, expectedSig)) return false;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== "Upstash") return false;
  if (typeof payload.exp === "number" && now > payload.exp + 30) return false;
  if (typeof payload.nbf === "number" && now < payload.nbf - 30) return false;
  if (typeof payload.body !== "string") return false;
  const expectedSub = process.env.LMA_PUBLIC_URL
    ? `${process.env.LMA_PUBLIC_URL.replace(/\/+$/, "")}/api/wakeup`
    : null;
  if (expectedSub && typeof payload.sub === "string" && payload.sub !== expectedSub) {
    return false;
  }
  const actualHashB64Url = crypto.createHash("sha256").update(rawBody).digest("base64url");
  const actualHashB64 = crypto.createHash("sha256").update(rawBody).digest("base64");
  const claimed = payload.body.replace(/=+$/, "");
  if (
    !timingSafeStrEqual(claimed, actualHashB64Url) &&
    !timingSafeStrEqual(payload.body, actualHashB64)
  ) {
    return false;
  }
  return true;
}

const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;

function getClientKey(req: Request, server?: { requestIP(r: Request): { address: string } | null }): string {
  const flyIp = req.headers.get("fly-client-ip")?.trim();
  if (flyIp) return flyIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Use the rightmost proxy-appended hop rather than the client-spoofable leftmost hop
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return server?.requestIP(req)?.address || "local";
}

function isLoginRateLimited(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  if (loginFailures.size > 500) {
    for (const [k, v] of loginFailures) {
      if (now > v.resetAt) loginFailures.delete(k);
    }
  }
  const entry = loginFailures.get(key);
  if (!entry || now > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function computeGuardrailStatus(): { zeroLocalKeys: boolean; aiMediaDisabled: boolean } {
  const outboundKeyNames = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "EXA_API_KEY",
    "FIRECRAWL_API_KEY",
    "COMPOSIO_API_KEY",
    "BUFFER_API_KEY",
    "QSTASH_TOKEN",
  ];
  const zeroLocalKeys = outboundKeyNames.every((k) => !process.env[k]);

  let aiMediaDisabled = false;
  try {
    const home = process.env.HOME || "/home/sprite";
    const cfgPath = path.join(home, ".omp", "agent", "config.yml");
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, "utf8");
      aiMediaDisabled = /generate_image:\s*deny/i.test(cfg);
    }
  } catch {
    aiMediaDisabled = false;
  }
  return { zeroLocalKeys, aiMediaDisabled };
}

function verifyUpstashSignature(req: Request, rawBody: string): boolean {
  const sig = req.headers.get("upstash-signature") || "";
  if (!sig) return false;
  const keys = [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((k): k is string => Boolean(k));
  if (keys.length === 0) return false;
  return keys.some((k) => verifyQStashJwtWithKey(sig, rawBody, k));
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Otto — Sign In</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; color: #303030;
      background-color: #dbdbdb;
      position: relative; isolation: isolate; overflow: hidden;
      font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
      display: grid; place-items: center; padding: 16px;
    }
    body::before, body::after {
      content: ""; position: fixed; inset: -28%; z-index: -1;
      pointer-events: none; will-change: transform;
    }
    body::before {
      background-image:
        radial-gradient(circle at 10% 8%, #cfd5df 0%, rgba(207,213,223,0) 48%),
        radial-gradient(circle at 94% 10%, #dc6b46 0%, rgba(220,107,70,0) 52%),
        radial-gradient(circle at 90% 92%, #df7a59 0%, rgba(223,122,89,0) 50%),
        radial-gradient(circle at 8% 92%, #e59d81 0%, rgba(229,157,129,0) 52%),
        linear-gradient(135deg, #d7d5d6 0%, #dcd4d2 48%, #e6b29a 100%);
      animation: otto-drift-a 24s ease-in-out infinite;
    }
    body::after {
      background-image:
        radial-gradient(circle at 22% 72%, rgba(220,107,70,0.34) 0%, rgba(220,107,70,0) 46%),
        radial-gradient(circle at 76% 24%, rgba(188,204,226,0.42) 0%, rgba(188,204,226,0) 48%),
        radial-gradient(circle at 52% 52%, rgba(249,245,162,0.14) 0%, rgba(249,245,162,0) 44%);
      animation: otto-drift-b 32s ease-in-out infinite;
    }
    @keyframes otto-drift-a {
      0% { transform: translate3d(0%, 0%, 0) scale(1) rotate(0deg); }
      33% { transform: translate3d(4%, -3%, 0) scale(1.06) rotate(3deg); }
      66% { transform: translate3d(-3%, 4%, 0) scale(1.03) rotate(-2deg); }
      100% { transform: translate3d(0%, 0%, 0) scale(1) rotate(0deg); }
    }
    @keyframes otto-drift-b {
      0% { transform: translate3d(0%, 0%, 0) scale(1.02) rotate(0deg); }
      35% { transform: translate3d(-5%, 4%, 0) scale(1.08) rotate(-4deg); }
      70% { transform: translate3d(5%, 2%, 0) scale(0.98) rotate(3deg); }
      100% { transform: translate3d(0%, 0%, 0) scale(1.02) rotate(0deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      body::before, body::after { animation: none; }
    }
    .card {
      width: min(92vw, 390px); background: #ffffff;
      border-radius: 20px; box-shadow: 0 3px 6px rgba(0,0,0,0.16);
      overflow: hidden;
    }
    .head {
      text-align: center; padding: 9px 16px;
      border-bottom: 1px solid #ededed;
      font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #303030;
    }
    .body { padding: 26px 26px 28px; text-align: center; }
    .mascot { margin: 0 auto 14px; display: block; }
    h1 {
      margin: 0 0 8px 0; font-weight: 400; font-size: 24px;
      letter-spacing: -0.02em; color: #303030; line-height: 1.25;
    }
    .mark { background: #f9f5a2; padding: 0 2px; }
    p {
      margin: 0 0 18px 0; font-family: "IBM Plex Mono", monospace;
      font-size: 11.5px; color: #808080; line-height: 1.5;
    }
    input {
      width: 100%; padding: 11px 16px; border: none; border-radius: 25px;
      background: #ededed; color: #303030;
      font-family: "IBM Plex Mono", monospace; font-size: 13px;
      margin-bottom: 12px; outline: none; text-align: center;
    }
    input:focus { box-shadow: 0 0 0 2px #303030; }
    button {
      width: 100%; padding: 11px 16px; border: none; border-radius: 9999px;
      background: #303030; color: #ffffff;
      font-family: "IBM Plex Mono", monospace; font-size: 12.5px; font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #141414; }
    .err { color: #991b1b; font-family: "IBM Plex Mono", monospace; font-size: 11.5px; margin-top: 10px; }
  </style>
</head>
<body>
  <form class="card" id="f">
    <div class="head">(Y)our studio.</div>
    <div class="body">
      <svg class="mascot" id="otto-login" width="60" height="60" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Otto mascot">
        <defs>
          <clipPath id="lg-clip"><circle cx="24" cy="23.5" r="20.6" /></clipPath>
          <radialGradient id="lg-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.28" />
            <stop offset="65%" stop-color="#000" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#000" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="lg-shade" cx="66%" cy="72%" r="74%" fx="33%" fy="27%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.44" />
            <stop offset="42%" stop-color="#fff" stop-opacity="0" />
            <stop offset="76%" stop-color="#000" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#000" stop-opacity="0.48" />
          </radialGradient>
          <radialGradient id="lg-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.56" />
            <stop offset="55%" stop-color="#fff" stop-opacity="0.14" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="lg-rim" cx="76%" cy="82%" r="48%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="24" cy="44.8" rx="14.5" ry="2.6" fill="url(#lg-shadow)" />
        <circle cx="24" cy="23.5" r="20.6" fill="#303030" />
        <circle cx="24" cy="23.5" r="20.6" fill="url(#lg-shade)" />
        <circle cx="24" cy="23.5" r="20.6" fill="url(#lg-rim)" />
        <ellipse id="lg-glint" cx="16.4" cy="14.2" rx="6.2" ry="3.9" transform="rotate(-28 16.4 14.2)" fill="url(#lg-spec)" />
        <g clip-path="url(#lg-clip)">
          <g id="lg-face">
            <ellipse cx="18.2" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />
            <ellipse cx="29.8" cy="24.2" rx="4.6" ry="5.6" fill="rgba(0,0,0,0.14)" />
            <ellipse cx="18.2" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />
            <ellipse cx="29.8" cy="23.2" rx="4.5" ry="5.7" fill="#FFFFFF" />
            <circle id="lg-pl" cx="18.2" cy="23.2" r="2.35" fill="#1F1F1F" />
            <circle id="lg-pr" cx="29.8" cy="23.2" r="2.35" fill="#1F1F1F" />
            <circle id="lg-cl" cx="17.4" cy="22.1" r="0.82" fill="#FFFFFF" />
            <circle id="lg-cr" cx="29.0" cy="22.1" r="0.82" fill="#FFFFFF" />
          </g>
        </g>
      </svg>
      <h1>Otto is <span class="mark">(y)</span>our stream manager.</h1>
      <p>Enter your passcode to unlock this private Sprite studio.</p>
      <input type="password" id="pw" placeholder="Input your passcode." autocomplete="current-password" autofocus required />
      <button type="submit">Unlock Studio</button>
      <div class="err" id="err"></div>
    </div>
  </form>
  <script>
    (function () {
      const svg = document.getElementById("otto-login");
      const face = document.getElementById("lg-face");
      const shade = document.getElementById("lg-shade");
      const glint = document.getElementById("lg-glint");
      const pl = document.getElementById("lg-pl");
      const pr = document.getElementById("lg-pr");
      const cl = document.getElementById("lg-cl");
      const cr = document.getElementById("lg-cr");
      let lx = 0.12, ly = 0.06, tx = 0.12, ty = 0.06, raf = null;
      function draw() {
        raf = null;
        const dx = tx - lx, dy = ty - ly;
        if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) { lx = tx; ly = ty; }
        else { lx += dx * 0.16; ly += dy * 0.16; raf = requestAnimationFrame(draw); }
        const mx = lx * 6.4, my = ly * 5.6;
        const sx = 1 - Math.abs(lx) * 0.16, sy = 1 - Math.abs(ly) * 0.13, rot = lx * ly * -6;
        face.setAttribute("transform", "translate(" + mx.toFixed(2) + "," + my.toFixed(2) + ") translate(24,23.2) rotate(" + rot.toFixed(2) + ") scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ") translate(-24,-23.2)");
        shade.setAttribute("fx", (33 - lx * 6.5).toFixed(1) + "%");
        shade.setAttribute("fy", (27 - ly * 6.5).toFixed(1) + "%");
        const gx = (16.4 - lx * 1.6).toFixed(1), gy = (14.2 - ly * 1.4).toFixed(1);
        glint.setAttribute("cx", gx); glint.setAttribute("cy", gy);
        glint.setAttribute("transform", "rotate(-28 " + gx + " " + gy + ")");
        const px = lx * 1.45, py = ly * 1.25;
        pl.setAttribute("cx", (18.2 + px).toFixed(2)); pl.setAttribute("cy", (23.2 + py).toFixed(2));
        pr.setAttribute("cx", (29.8 + px).toFixed(2)); pr.setAttribute("cy", (23.2 + py).toFixed(2));
        cl.setAttribute("cx", (17.4 + px).toFixed(2)); cl.setAttribute("cy", (22.1 + py).toFixed(2));
        cr.setAttribute("cx", (29.0 + px).toFixed(2)); cr.setAttribute("cy", (22.1 + py).toFixed(2));
      }
      window.addEventListener("pointermove", (e) => {
        const r = svg.getBoundingClientRect();
        const vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(vx, vy);
        const mag = Math.tanh(d / 200);
        tx = d > 0.5 ? (vx / d) * mag : 0;
        ty = d > 0.5 ? (vy / d) * mag : 0;
        if (!raf) raf = requestAnimationFrame(draw);
      }, { passive: true });
    })();
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("err");
      err.textContent = "";
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: document.getElementById("pw").value }),
      });
      if (res.ok) location.reload();
      else {
        const data = await res.json().catch(() => ({}));
        err.textContent = data.error || "Invalid passcode.";
      }
    });
  </script>
</body>
</html>`;

type SSEClient = ReadableStreamDefaultController<Uint8Array>;

interface TodoPhase {
  name: string;
  tasks: Array<{ content: string; status: string }>;
}

interface RpcEvent {
  type?: string;
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
  toolName?: string;
  result?: { details?: { phases?: unknown } };
  message?: { role?: string; content?: unknown };
  assistantMessageEvent?: { type?: string; delta?: unknown };
}
interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

interface SessionSummary {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}

const encoder = new TextEncoder();
const sseClients = new Set<SSEClient>();

function broadcast(payload: Record<string, unknown>) {
  const frame = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(frame);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}

function friendlyToolLabel(toolName: string): string {
  if (/youtube/i.test(toolName)) return "Checking YouTube...";
  if (/buffer/i.test(toolName)) return "Checking social channels...";
  if (/wakeup|schedule|calendar/i.test(toolName)) return "Managing schedule...";
  if (/^todo/i.test(toolName)) return "Updating checklist...";
  if (/^studio_/i.test(toolName)) return "Updating studio database...";
  if (/vod_scan_hype/i.test(toolName)) return "Scanning VOD live chat & hype spikes...";
  if (/vod_cut_clip/i.test(toolName)) return "Cutting raw clip (.mp4 + .srt)...";
  if (/vod_prep_clip/i.test(toolName)) return "Normalizing clip for editor (CFR + -14 LUFS)...";
  if (/watch_clip/i.test(toolName)) return "Watching clip for visual & pacing critique...";
  if (/critique_thumbnail/i.test(toolName)) return "Inspecting thumbnail...";
  if (/^box_/i.test(toolName)) return "Syncing files with Box...";
  if (/exa|firecrawl|web_search/i.test(toolName)) return "Researching...";
  if (/edit|write/i.test(toolName)) return "Updating workspace files...";
  if (/read/i.test(toolName)) return "Reviewing dossier & files...";
  if (/bash/i.test(toolName)) return "Running workspace tools...";
  return "Working on it...";
}

function stripHiddenTags(text: string): string {
  return text.replace(/<hidden>[\s\S]*?<\/hidden>/gi, "").trim();
}

function normalizeTodoPhases(raw: unknown): TodoPhase[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoPhase[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const pObj = p as Record<string, unknown>;
    const name = typeof pObj.name === "string" ? pObj.name : "Tasks";
    const rawTasks = Array.isArray(pObj.tasks) ? pObj.tasks : [];
    const tasks: Array<{ content: string; status: string }> = [];
    for (const t of rawTasks) {
      if (!t || typeof t !== "object") continue;
      const tObj = t as Record<string, unknown>;
      if (typeof tObj.content !== "string") continue;
      tasks.push({
        content: tObj.content,
        status: typeof tObj.status === "string" ? tObj.status : "pending",
      });
    }
    if (tasks.length > 0) out.push({ name, tasks });
  }
  return out;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; text?: string } => Boolean(p && typeof p === "object"))
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("");
}

function extractThinkingContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; thinking?: string } => Boolean(p && typeof p === "object"))
    .filter((p) => p.type === "thinking" && typeof p.thinking === "string")
    .map((p) => p.thinking!)
    .join("\n\n");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeSessionFile(filePath: string, activePath: string | null): SessionSummary | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    let title = "";
    let messageCount = 0;
    let id = path.basename(filePath, ".jsonl");

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      if (obj.type === "session" && typeof obj.id === "string") {
        id = obj.id;
        if (typeof obj.title === "string" && obj.title.trim()) {
          title = obj.title.trim();
        }
      } else if (obj.type === "session_info" && typeof obj.name === "string" && obj.name.trim()) {
        title = obj.name.trim();
      } else if (obj.type === "message" && obj.message && typeof obj.message === "object") {
        const msg = obj.message as { role?: string; content?: unknown };
        if (msg.role === "user" || msg.role === "assistant") {
          const rawText = extractTextContent(msg.content).trim();
          const text = msg.role === "user" ? stripHiddenTags(rawText) : rawText;
          if (text) {
            messageCount++;
            if (!title && msg.role === "user") {
              title = text.replace(/\s+/g, " ").slice(0, 64);
            }
          }
        }
      }
    }

    const active = activePath !== null && path.resolve(filePath) === path.resolve(activePath);
    if (messageCount === 0 && !active) return null;

    return {
      id,
      path: filePath,
      title: title || "New conversation",
      updatedAt: stat.mtime.toISOString(),
      messageCount,
      active,
    };
  } catch {
    return null;
  }
}

class OmpRpcBridge {
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private ready = false;
  private readyResolvers: Array<() => void> = [];
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private holdHeartbeat: NodeJS.Timeout | null = null;
  private holdStartedAt = 0;
  private static readonly MAX_HOLD_MS = 30 * 60 * 1000;
  public busy = false;
  public activity = "Thinking...";
  public todos: TodoPhase[] = [];

  constructor() {
    this.spawn();
  }

  private async putSpriteHold(): Promise<void> {
    if (!fs.existsSync("/.sprite/api.sock")) return;
    await fetch("http://sprite/v1/tasks/lma-agent-turn", {
      unix: "/.sprite/api.sock",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expire: "10m" }),
    }).catch(() => {});
  }

  public backgroundBusy = false;

  public isAnyBusy(): boolean {
    return this.busy || this.backgroundBusy || isClipWorkerBusy();
  }

  public async holdSpriteActive(): Promise<void> {
    if (!this.holdStartedAt) this.holdStartedAt = Date.now();
    await this.putSpriteHold();
    if (!this.holdHeartbeat && fs.existsSync("/.sprite/api.sock")) {
      // Refresh 10m TTL every 5 minutes during long multi-tool / ffmpeg / reflection turns,
      // capped at MAX_HOLD_MS (30m) so a hung turn can never renew indefinitely.
      this.holdHeartbeat = setInterval(() => {
        if (!this.isAnyBusy()) return;
        if (Date.now() - this.holdStartedAt >= OmpRpcBridge.MAX_HOLD_MS) {
          console.warn("[lma-web] Tasks API hold reached 30m ceiling; stopping renewals.");
          if (this.holdHeartbeat) {
            clearInterval(this.holdHeartbeat);
            this.holdHeartbeat = null;
          }
          return;
        }
        void this.putSpriteHold();
      }, 5 * 60 * 1000);
    }
  }

  public releaseSpriteHold() {
    if (this.isAnyBusy()) return;
    this.holdStartedAt = 0;
    if (this.holdHeartbeat) {
      clearInterval(this.holdHeartbeat);
      this.holdHeartbeat = null;
    }
    if (!fs.existsSync("/.sprite/api.sock")) return;
    fetch("http://sprite/v1/tasks/lma-agent-turn", {
      unix: "/.sprite/api.sock",
      method: "DELETE",
    }).catch(() => {});
  }
  private spawn() {
    this.ready = false;
    // Never inherit inbound UI passcode or QStash webhook signing keys into the agent subprocess
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      LMA_INTERNAL_SECRET,
      LMA_WEB_PORT: String(PORT),
    };
    delete childEnv.LMA_WEB_PASSWORD;
    delete childEnv.QSTASH_CURRENT_SIGNING_KEY;
    delete childEnv.QSTASH_NEXT_SIGNING_KEY;
    this.proc = Bun.spawn([OMP_BIN, "--mode", "rpc", "--no-ui"], {
      cwd: WORK_DIR,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv,
    });
    this.readStdout(this.proc.stdout);
    this.readStderr(this.proc.stderr);

    this.proc.exited.then((code) => {
      console.error(`[lma-web] omp rpc exited with code ${code}; restarting in 1s...`);
      this.ready = false;
      this.busy = false;
      this.releaseSpriteHold();
      for (const [, p] of this.pending) {
        p.reject(new Error(`omp rpc exited (${code})`));
      }
      this.pending.clear();
      broadcast({ type: "error", message: "Assistant reconnecting..." });
      setTimeout(() => this.spawn(), 1000);
    });
  }

  private async readStderr(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const txt = dec.decode(value, { stream: true }).trim();
        if (txt) console.error("[omp-stderr]", txt);
      }
    } catch {
      // ignore stream close
    }
  }

  private async readStdout(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const parsed: unknown = JSON.parse(line);
            if (parsed && typeof parsed === "object") {
              this.handleEvent(parsed as RpcEvent);
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    } catch {
      // ignore stream close
    }
  }

  private handleEvent(ev: RpcEvent) {
    if (ev.type === "ready") {
      this.ready = true;
      for (const r of this.readyResolvers) r();
      this.readyResolvers = [];
      broadcast({ type: "status", busy: this.busy, activity: this.activity, todos: this.todos });
      return;
    }

    if (ev.type === "response" && ev.id && this.pending.has(ev.id)) {
      const p = this.pending.get(ev.id)!;
      this.pending.delete(ev.id);
      if (ev.success === false) {
        p.reject(new Error(ev.error || `Command ${ev.command ?? "unknown"} failed`));
      } else {
        p.resolve(ev.data);
      }
      return;
    }

    if (ev.type === "agent_start") {
      this.busy = true;
      this.activity = "Thinking...";
      this.holdSpriteActive();
      broadcast({ type: "activity", label: this.activity });
      return;
    }

    if (ev.type === "tool_execution_start") {
      this.busy = true;
      this.activity = friendlyToolLabel(String(ev.toolName || ""));
      broadcast({ type: "tool_start", label: this.activity });
      return;
    }

    if (ev.type === "tool_execution_end") {
      const tName = String(ev.toolName || "");
      if ((tName === "todo" || tName === "todo_write") && ev.result?.details) {
        this.todos = normalizeTodoPhases(ev.result.details.phases);
        broadcast({ type: "todos", phases: this.todos });
      }
      if (/^(write|edit|bash|vod_cut_clip|vod_prep_clip|vod_scan_hype)$/i.test(tName)) {
        broadcast({ type: "workspace_changed" });
      }
      if (/^(studio_|calendar_|schedule_wakeup|cancel_wakeup)/i.test(tName)) {
        broadcast({ type: "db_changed" });
      }
      broadcast({ type: "tool_end" });
      return;
    }

    if (ev.type === "message_start" && ev.message?.role === "assistant") {
      broadcast({ type: "assistant_start" });
      return;
    }

    if (ev.type === "message_update") {
      const ame = ev.assistantMessageEvent;
      if (ame?.type === "thinking_delta" && typeof ame.delta === "string") {
        broadcast({ type: "thinking_delta", delta: ame.delta });
      } else if (ame?.type === "text_delta" && typeof ame.delta === "string") {
        broadcast({ type: "text_delta", delta: ame.delta });
      }
      return;
    }

    if (ev.type === "message_end" && ev.message?.role === "assistant") {
      const text = extractTextContent(ev.message.content);
      if (text.trim()) {
        broadcast({ type: "assistant_end", text });
      }
      return;
    }

    if (ev.type === "agent_end" || ev.type === "session_settled") {
      this.busy = false;
      this.activity = "Thinking...";
      this.releaseSpriteHold();
      broadcast({ type: "done" });
      return;
    }
  }

  private async waitReady() {
    if (this.ready) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.readyResolvers.push(resolve);
    await promise;
  }

  async sendCommand(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    await this.waitReady();
    if (!this.proc?.stdin) throw new Error("RPC stdin unavailable");
    const id = `req-${++this.reqCounter}`;
    const line = JSON.stringify({ id, type, ...extra }) + "\n";
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(id, { resolve, reject });
    this.proc.stdin.write(line);
    setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        reject(new Error(`RPC command ${type} timed out`));
      }
    }, 30000);
    return promise;
  }

  async getState(): Promise<{ sessionFile: string | null; sessionId: string | null }> {
    const data = await this.sendCommand("get_state");
    if (!data || typeof data !== "object") {
      return { sessionFile: null, sessionId: null };
    }
    const obj = data as Record<string, unknown>;
    return {
      sessionFile: typeof obj.sessionFile === "string" ? obj.sessionFile : null,
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : null,
    };
  }

  async getSessionsDir(): Promise<{ sessionsDir: string; activeFile: string | null }> {
    const state = await this.getState();
    if (state.sessionFile) {
      return { sessionsDir: path.dirname(state.sessionFile), activeFile: state.sessionFile };
    }
    const home = process.env.HOME || "/home/sprite";
    const slug = WORK_DIR.replace(/[\\/]/g, "-");
    return {
      sessionsDir: path.join(home, ".omp", "agent", "sessions", slug),
      activeFile: null,
    };
  }

  async listSessions(): Promise<SessionSummary[]> {
    const { sessionsDir, activeFile } = await this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];
    const entries = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const list: SessionSummary[] = [];
    for (const file of entries) {
      const fullPath = path.join(sessionsDir, file);
      const summary = summarizeSessionFile(fullPath, activeFile);
      if (summary) list.push(summary);
    }
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }

  async switchSession(sessionPath: string) {
    if (this.busy) {
      throw new Error("Wait for the current reply to finish or click Stop before switching chats.");
    }
    const { sessionsDir } = await this.getSessionsDir();
    const resolvedDir = path.resolve(sessionsDir);
    const resolvedTarget = path.resolve(sessionPath);
    if (
      !resolvedTarget.startsWith(resolvedDir + path.sep) ||
      !resolvedTarget.endsWith(".jsonl") ||
      !fs.existsSync(resolvedTarget)
    ) {
      throw new Error("Invalid session path.");
    }
    await this.sendCommand("switch_session", { sessionPath: resolvedTarget });
    this.todos = [];
    broadcast({ type: "session_changed" });
  }

  async getMessages(): Promise<
    Array<{ role: "user" | "assistant"; text: string; thinking?: string }>
  > {
    const data = await this.sendCommand("get_messages");
    const raw =
      data && typeof data === "object" && "messages" in data && Array.isArray(data.messages)
        ? data.messages
        : [];
    const out: Array<{ role: "user" | "assistant"; text: string; thinking?: string }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const role = "role" in item ? item.role : undefined;
      if (role !== "user" && role !== "assistant") continue;
      const content = "content" in item ? item.content : undefined;
      const rawText = extractTextContent(content).trim();
      const text = role === "user" ? stripHiddenTags(rawText) : rawText;
      if (!text) continue;
      const thinking = role === "assistant" ? extractThinkingContent(content).trim() : "";
      out.push(thinking ? { role, text, thinking } : { role, text });
    }
    return out;
  }

  async prompt(message: string) {
    if (this.busy) {
      throw new Error("Otto is still responding. Wait or click Stop.");
    }
    this.busy = true;
    this.activity = "Thinking...";
    this.holdSpriteActive();
    broadcast({ type: "user_message", text: stripHiddenTags(message) });
    broadcast({ type: "activity", label: this.activity });
    try {
      await this.sendCommand("prompt", { message });
    } catch (err) {
      const isTimeout = err instanceof Error && /timed out/i.test(err.message);
      if (!isTimeout) {
        this.busy = false;
        this.releaseSpriteHold();
      }
      throw err;
    }
  }

  async abort() {
    await this.sendCommand("abort").catch(() => {});
    this.busy = false;
    this.releaseSpriteHold();
    broadcast({ type: "done" });
  }

  async newSession() {
    if (this.busy) {
      await this.abort();
    }
    await this.sendCommand("new_session");
    this.todos = [];
    broadcast({ type: "session_changed" });
  }
}

const rpc = new OmpRpcBridge();

// Initialize Unified Workspace scaffold & debounced live watcher for SSE auto-refresh
ensureWorkspaceScaffold();
let workspaceWatchTimer: NodeJS.Timeout | null = null;
try {
  fs.watch(WORKSPACE_ROOT, { recursive: true }, () => {
    clearTimeout(workspaceWatchTimer ?? undefined);
    workspaceWatchTimer = setTimeout(() => {
      broadcast({ type: "workspace_changed" });
    }, 350);
  });
} catch {
  // Recursive fs.watch may be unsupported on some kernels; tool_execution_end + API mutations still broadcast live
}

type ServerCalendarWakeupHook = CalendarWakeupHook;
type ServerCalendarEvent = CalendarEvent;

function readCalendarEvents(): ServerCalendarEvent[] {
  return listCalendarEvents();
}

function writeCalendarEvents(events: ServerCalendarEvent[]): void {
  saveCalendarEventsBatch(events);
  broadcast({ type: "db_changed" });
}

async function resolveQStashGatewayForServer(): Promise<string | null> {
  const fromEnv = process.env.SPRITES_QSTASH_GATEWAY_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{ provider?: string; display_name?: string; gateway_base_url?: string }>;
    };
    const conn = data.connections?.find(
      (c) =>
        c.provider === "qstash" ||
        (c.provider === "custom_api" && /qstash/i.test(c.display_name ?? ""))
    );
    return conn?.gateway_base_url ? conn.gateway_base_url.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function formatIcsUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildCalendarIcs(events: ServerCalendarEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LMA Otto//Stream Ops Schedule//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Otto Stream Schedule",
  ];
  const dtStamp = formatIcsUtc(new Date().toISOString()) || "20260101T000000Z";
  for (const evt of events) {
    if (evt.status === "cancelled") continue;
    const dtStart = formatIcsUtc(evt.startAt);
    if (!dtStart) continue;
    const endIso =
      evt.endAt ||
      new Date(Date.parse(evt.startAt) + 60 * 60 * 1000).toISOString();
    const dtEnd = formatIcsUtc(endIso) || dtStart;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}@lma.sprites.app`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(`[${evt.type.toUpperCase()}] ${evt.title}`)}`);
    if (evt.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(evt.notes)}`);
    }
    for (const w of evt.wakeups || []) {
      if (w.status !== "armed" || typeof w.offsetMinutes !== "number" || w.offsetMinutes > 0) {
        continue;
      }
      const mins = Math.max(0, Math.abs(Math.round(w.offsetMinutes)));
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(w.label)}`);
      lines.push(`TRIGGER:-PT${mins}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
interface ServerGCalCtx {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

async function resolveServerGoogleCalendar(): Promise<ServerGCalCtx | null> {
  try {
    let baseUrl = process.env.SPRITES_COMPOSIO_GATEWAY_URL?.trim()?.replace(/\/$/, "");
    if (!baseUrl) {
      const gwRes = await fetch("https://api.sprites.dev/v1/gateway/list", {
        signal: AbortSignal.timeout(8000),
      });
      if (!gwRes.ok) return null;
      const gwData = (await gwRes.json()) as {
        connections?: Array<{ provider?: string; display_name?: string; gateway_base_url?: string }>;
      };
      const conn = gwData.connections?.find(
        (c) =>
          c.provider === "composio" ||
          (c.provider === "custom_api" && /composio/i.test(c.display_name ?? ""))
      );
      if (!conn?.gateway_base_url) return null;
      baseUrl = conn.gateway_base_url.replace(/\/$/, "");
    }
    const accRes = await fetch(
      `${baseUrl}/api/v3/connected_accounts?toolkit_slugs=googlecalendar&limit=20`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!accRes.ok) return null;
    const accData = (await accRes.json()) as {
      items?: Array<{ id: string; status: string; user_id?: string; userId?: string }>;
    };
    const active = accData.items?.find((a) => a.status === "ACTIVE");
    if (!active) return null;
    return {
      baseUrl,
      connectedAccountId: active.id,
      userId: active.user_id || active.userId || "default",
    };
  } catch {
    return null;
  }
}

async function execServerGCalTool(
  ctx: ServerGCalCtx,
  slug: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connected_account_id: ctx.connectedAccountId,
      user_id: ctx.userId,
      arguments: args,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Composio ${slug} HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ---------- Silent Isolated Background Job Runner ----------

function startSilentBackgroundJob(opts: {
  label: string;
  prompt: string;
  jobType: string;
}): void {
  // Fire-and-forget isolated `omp --no-session -p` turn while Tasks API hold stays active.
  void (async () => {
    try {
      const childEnv: Record<string, string | undefined> = { ...process.env };
      delete childEnv.LMA_WEB_PASSWORD;
      delete childEnv.QSTASH_CURRENT_SIGNING_KEY;
      delete childEnv.QSTASH_NEXT_SIGNING_KEY;

      const proc = Bun.spawn([OMP_BIN, "--no-session", "-p", opts.prompt], {
        cwd: WORK_DIR,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      });

      const timeoutMs = 4 * 60 * 1000;
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      }, timeoutMs);

      const [exitCode, , stderrText] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
      ]);
      clearTimeout(timer);

      if (exitCode !== 0) {
        console.error(
          `[lma-web] background job "${opts.label}" failed (exit ${exitCode}):`,
          stderrText.trim().slice(0, 140)
        );
      }
    } catch (err: unknown) {
      console.error(`[lma-web] background job "${opts.label}" threw:`, err);
    } finally {
      rpc.backgroundBusy = false;
      rpc.releaseSpriteHold();
      broadcast({ type: "db_changed" });
    }
  })();
}


Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Public health check
    if (req.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true, busy: rpc.busy });
    }

    // Passcode login endpoint
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      if (!webPassword) {
        return Response.json(
          { error: "LMA_WEB_PASSWORD is not configured. Run bash ~/lma/setup.sh first." },
          { status: 503 }
        );
      }
      const clientKey = getClientKey(req, server);
      if (isLoginRateLimited(clientKey)) {
        return Response.json(
          { error: "Too many login attempts. Try again in 1 minute." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }
      const body: unknown = await req.json().catch(() => ({}));
      const pw =
        body && typeof body === "object" && "password" in body && typeof body.password === "string"
          ? body.password
          : "";
      if (!timingSafeStrEqual(pw, webPassword)) {
        recordLoginFailure(clientKey);
        return Response.json({ error: "Invalid passcode" }, { status: 401 });
      }
      loginFailures.delete(clientKey);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": buildAuthCookieHeader(req, url, webPassword),
        },
      });
    }

    // Cryptographically signed Upstash QStash wake-up webhook
    if (req.method === "POST" && url.pathname === "/api/wakeup") {
      const rawBody = await req.text();
      if (!verifyUpstashSignature(req, rawBody)) {
        return Response.json({ error: "Invalid Upstash-Signature" }, { status: 401 });
      }
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const label = typeof payload.label === "string" ? payload.label : "Scheduled Wake-Up";

      // Deterministic zero-LLM daily YouTube metrics sync (no omp turn spawned)
      if (payload.mode === "metrics_sync") {
        const identity = readSetupIdentity();
        const res = await syncYouTubeMetrics({ timezone: identity.timezone || "UTC" });
        if (res.ok) broadcast({ type: "db_changed" });
        return Response.json(
          { ok: res.ok, mode: "metrics_sync", label, error: res.error },
          { status: res.ok ? 200 : 500 }
        );
      }

      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      if (!prompt) {
        return Response.json({ error: "Missing prompt" }, { status: 400 });
      }
      const isSilent = payload.silent === true || payload.mode === "background";
      const jobType =
        typeof payload.jobType === "string"
          ? payload.jobType
          : isSilent
            ? "background"
            : "wakeup";

      if (rpc.isAnyBusy()) {
        return Response.json(
          { error: "Agent busy; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }

      if (isSilent) {
        // Claim backgroundBusy synchronously before awaiting Tasks API hold so concurrent calls cannot race
        rpc.backgroundBusy = true;
        await rpc.holdSpriteActive();
        startSilentBackgroundJob({ label, prompt, jobType });
        return Response.json({ ok: true, mode: "background", silent: true, label, jobType });
      }

      // Claim busy synchronously before awaiting Tasks API hold so concurrent calls cannot race
      rpc.busy = true;
      await rpc.holdSpriteActive();
      const wakeupMsg = `[SCHEDULED WAKE-UP: ${label}]\n${prompt}`;
      try {
        rpc.busy = false;
        await rpc.prompt(wakeupMsg);
      } catch (err) {
        console.error("[lma-web] wakeup prompt error:", errorMessage(err));
        rpc.releaseSpriteHold();
        return Response.json(
          { error: "Failed to dispatch wake-up; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }
      return Response.json({ ok: true, mode: "chat", label });
    }

    // Internal-only endpoints for omp subprocess (authenticated via ephemeral LMA_INTERNAL_SECRET)

    // Internal-only Studio App & OBS Overlay presentation endpoints for omp subprocess
    if (
      req.method === "POST" &&
      (url.pathname === "/api/internal/studio-app/open" ||
        url.pathname === "/api/internal/studio-app/changed" ||
        url.pathname === "/api/internal/obs-overlay/open" ||
        url.pathname === "/api/internal/obs-overlay/changed")
    ) {
      const auth = req.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!token || !timingSafeStrEqual(token, LMA_INTERNAL_SECRET)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const body = (await req.json().catch(() => ({}))) as {
        slug?: string;
        title?: string;
        autoFocus?: boolean;
        deleted?: boolean;
      };
      const slug = String(body.slug || "").trim();
      if (url.pathname === "/api/internal/studio-app/open") {
        broadcast({ type: "studio_apps_changed", slug });
        broadcast({
          type: "studio_app_open",
          slug,
          title: body.title || slug,
          autoFocus: body.autoFocus !== false,
        });
      } else if (url.pathname === "/api/internal/studio-app/changed") {
        broadcast({ type: "studio_apps_changed", slug, deleted: body.deleted === true });
      } else if (url.pathname === "/api/internal/obs-overlay/open") {
        broadcast({ type: "obs_overlays_changed", slug });
        broadcast({
          type: "obs_overlay_open",
          slug,
          title: body.title || slug,
          autoFocus: body.autoFocus !== false,
        });
      } else {
        broadcast({ type: "obs_overlays_changed", slug, deleted: body.deleted === true });
      }
      return Response.json({ ok: true, slug });
    }

    // Internal-only endpoint for Otto chat (`vod_start_clip_job`) to dispatch isolated background clip jobs
    if (req.method === "POST" && url.pathname === "/api/internal/clip-jobs/start") {
      const auth = req.headers.get("authorization") || "";
      const headerToken =
        req.headers.get("x-lma-internal-secret") ||
        (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
      if (!headerToken || !timingSafeStrEqual(headerToken, LMA_INTERNAL_SECRET)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      try {
        const body = (await req.json()) as {
          vodUrl?: string;
          videoId?: string;
          title?: string;
          maxClips?: number;
          focusNotes?: string;
        };
        if (!body.vodUrl) {
          return Response.json({ error: "vodUrl is required" }, { status: 400 });
        }
        const job = startBackgroundClipJob(
          {
            vodUrl: String(body.vodUrl),
            videoId: body.videoId ? String(body.videoId) : undefined,
            title: body.title ? String(body.title) : undefined,
            maxClips: typeof body.maxClips === "number" ? body.maxClips : 0,
            focusNotes: body.focusNotes ? String(body.focusNotes) : "",
          },
          {
            ompBin: OMP_BIN,
            workDir: WORK_DIR,
            port: PORT,
            internalSecret: LMA_INTERNAL_SECRET,
            onBroadcast: broadcast,
            onBusyChange: (busy) => {
              if (busy) {
                void rpc.holdSpriteActive();
              } else {
                rpc.releaseSpriteHold();
              }
            },
          }
        );
        return Response.json({ ok: true, job });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 }
        );
      }
    }

    // Public favicon so both login page and Studio OS render the Otto icon
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
      const distIcon = path.join(DIST_DIR, "favicon.svg");
      const pubIcon = path.join(import.meta.dir, "public", "favicon.svg");
      const iconPath = fs.existsSync(distIcon) ? distIcon : fs.existsSync(pubIcon) ? pubIcon : null;
      if (iconPath) {
        const headers = {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        };
        return req.method === "HEAD"
          ? new Response(null, { status: 200, headers })
          : new Response(Bun.file(iconPath), { status: 200, headers });
      }
    }

    // Everything below requires valid passcode session when LMA_WEB_PASSWORD is set
    if (!isAuthenticated(req)) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return new Response(LOGIN_HTML, {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      let ctrlRef: SSEClient | null = null;
      let pingTimer: NodeJS.Timeout | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrlRef = ctrl;
          sseClients.add(ctrl);
          ctrl.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "status", busy: rpc.busy, activity: rpc.activity, todos: rpc.todos })}\n\n`
            )
          );
          // Keep SSE alive during long (>4m) VOD hype-scan / ffmpeg turns
          pingTimer = setInterval(() => {
            try {
              ctrl.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              clearInterval(pingTimer ?? undefined);
              sseClients.delete(ctrl);
            }
          }, 30_000);
        },
        cancel() {
          clearInterval(pingTimer ?? undefined);
          if (ctrlRef) sseClients.delete(ctrlRef);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      try {
        const messages = await rpc.getMessages();
        return Response.json({ messages, busy: rpc.busy, activity: rpc.activity, todos: rpc.todos });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 500 });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      try {
        const sessions = await rpc.listSessions();
        return Response.json({ sessions });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 500 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/switch") {
      try {
        const body: unknown = await req.json();
        const sessionPath =
          body && typeof body === "object" && "path" in body && typeof body.path === "string"
            ? body.path
            : "";
        if (!sessionPath) {
          return Response.json({ error: "Session path is required" }, { status: 400 });
        }
        await rpc.switchSession(sessionPath);
        return Response.json({ ok: true });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body: unknown = await req.json();
        const rawMsg =
          body && typeof body === "object" && "message" in body ? body.message : "";
        const message = String(rawMsg || "").trim();
        if (!message) {
          return Response.json({ error: "Message is required" }, { status: 400 });
        }
        await rpc.prompt(message);
        return Response.json({ ok: true });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/abort") {
      await rpc.abort();
      return Response.json({ ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/new") {
      try {
        await rpc.newSession();
        return Response.json({ ok: true });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 500 });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/dossier") {
      const home = process.env.HOME || "/home/sprite";
      const memPath = path.join(home, ".omp", "agent", "MEMORY.md");
      if (!fs.existsSync(memPath)) {
        return Response.json({ exists: false, updatedAt: null, content: "" });
      }
      const stat = fs.statSync(memPath);
      const content = fs.readFileSync(memPath, "utf8");
      return Response.json({
        exists: true,
        updatedAt: stat.mtime.toISOString(),
        content,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/setup/status") {
      const identity = readSetupIdentity();
      const metaDone = getStudioMeta("setup_completed") === "1";
      const completed = metaDone || Boolean(identity.creatorName && identity.timezone);
      return Response.json({
        completed,
        creatorName: identity.creatorName,
        timezone: identity.timezone,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/setup/complete") {
      try {
        const body = (await req.json().catch(() => ({}))) as {
          creatorName?: string;
          timezone?: string;
          newPassword?: string;
          skip?: boolean;
        };
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        let passwordChanged = false;

        if (!body.skip) {
          const creatorName = typeof body.creatorName === "string" ? body.creatorName.trim() : "";
          const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
          if (creatorName || timezone) {
            writeIdentityToMemoryMd(creatorName, timezone);
          }
          const newPw = typeof body.newPassword === "string" ? body.newPassword.trim() : "";
          if (newPw) {
            if (newPw.length < 8) {
              return Response.json(
                { error: "Passcode must be at least 8 characters long." },
                { status: 400 }
              );
            }
            if (/[\r\n\0]/.test(newPw)) {
              return Response.json(
                { error: "Passcode cannot contain line breaks." },
                { status: 400 }
              );
            }
            updatePrivateWebPassword(newPw);
            headers["Set-Cookie"] = buildAuthCookieHeader(req, url, newPw);
            passwordChanged = true;
          }
        }

        setStudioMeta("setup_completed", "1");
        broadcast({ type: "db_changed" });
        return new Response(
          JSON.stringify({ ok: true, completed: true, passwordChanged }),
          { headers }
        );
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/calendar") {
      const events = readCalendarEvents().sort(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
      );
      return Response.json({ events });
    }

    if (req.method === "GET" && url.pathname === "/api/calendar/export.ics") {
      const events = readCalendarEvents().sort(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
      );
      const ics = buildCalendarIcs(events);
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="lma-schedule.ics"',
          "Cache-Control": "no-cache",
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/calendar/sync") {
      const ctx = await resolveServerGoogleCalendar();
      if (!ctx) {
        return Response.json({ ok: false, connected: false, added: 0, updated: 0 });
      }
      try {
        const now = new Date();
        const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const raw = await execServerGCalTool(ctx, "GOOGLECALENDAR_EVENTS_LIST", {
          calendarId: "primary",
          singleEvents: true,
          orderBy: "startTime",
          timeMin,
          timeMax,
          maxResults: 50,
        });
        const d1 = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
        const payload = (
          d1.response_data && typeof d1.response_data === "object" ? d1.response_data : d1
        ) as Record<string, unknown>;
        const items = (Array.isArray(payload.items) ? payload.items : []) as Array<{
          id?: string;
          summary?: string;
          description?: string;
          status?: string;
          htmlLink?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }>;

        const events = readCalendarEvents();
        const nowIso = new Date().toISOString();
        let added = 0;
        let updated = 0;
        for (const item of items) {
          if (!item.id || item.status === "cancelled") continue;
          const startRaw =
            item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00Z` : null);
          if (!startRaw) continue;
          const endRaw =
            item.end?.dateTime || (item.end?.date ? `${item.end.date}T23:59:59Z` : null);
          const rawTitle = (item.summary || "(Untitled Google Event)").trim();
          const cleanTitle = rawTitle.replace(/^\[(STREAM|COLLAB|UPLOAD|REMINDER|DEADLINE)\]\s*/i, "");
          const existing = events.find((e) => e.googleEventId === item.id);
          if (existing) {
            existing.title = cleanTitle;
            existing.startAt = startRaw;
            existing.endAt = endRaw;
            if (item.description) existing.notes = item.description.trim();
            if (item.htmlLink) existing.googleHtmlLink = item.htmlLink;
            existing.updatedAt = nowIso;
            updated++;
          } else {
            const inferredType: ServerCalendarEvent["type"] = /collab/i.test(rawTitle)
              ? "collab"
              : /stream|live/i.test(rawTitle)
                ? "stream"
                : /upload|video|premiere/i.test(rawTitle)
                  ? "upload"
                  : /deadline|due/i.test(rawTitle)
                    ? "deadline"
                    : "reminder";
            events.push({
              id: `evt_${crypto.randomBytes(5).toString("hex")}`,
              title: cleanTitle,
              type: inferredType,
              startAt: startRaw,
              endAt: endRaw,
              cron: null,
              notes: (item.description || "").trim(),
              status: "planned",
              source: "google",
              googleEventId: item.id,
              googleHtmlLink: item.htmlLink ?? null,
              wakeups: [],
              createdAt: nowIso,
              updatedAt: nowIso,
            });
            added++;
          }
        }
        writeCalendarEvents(events);
        return Response.json({
          ok: true,
          connected: true,
          added,
          updated,
          events: events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
        });
      } catch (err: unknown) {
        return Response.json({ ok: false, connected: true, error: errorMessage(err) }, { status: 502 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/calendar") {
      const body = (await req.json().catch(() => ({}))) as {
        title?: string;
        type?: string;
        startAt?: string;
        endAt?: string | null;
        notes?: string;
      };
      const title = (body.title || "").trim();
      const startAtRaw = (body.startAt || "").trim();
      if (!title) {
        return Response.json({ error: "Event title is required" }, { status: 400 });
      }
      const parsedStart = Date.parse(startAtRaw);
      if (!startAtRaw || Number.isNaN(parsedStart)) {
        return Response.json({ error: "Valid startAt timestamp is required" }, { status: 400 });
      }
      const VALID_EVENT_TYPES: Record<string, true> = {
        stream: true,
        collab: true,
        upload: true,
        reminder: true,
        deadline: true,
      };
      const evtType = VALID_EVENT_TYPES[body.type || ""]
        ? (body.type as ServerCalendarEvent["type"])
        : "stream";
      const nowIso = new Date().toISOString();
      const newEvent: ServerCalendarEvent = {
        id: `evt_${crypto.randomBytes(5).toString("hex")}`,
        title,
        type: evtType,
        startAt: new Date(parsedStart).toISOString(),
        endAt:
          body.endAt && !Number.isNaN(Date.parse(body.endAt))
            ? new Date(Date.parse(body.endAt)).toISOString()
            : null,
        cron: null,
        notes: (body.notes || "").trim(),
        status: "planned",
        source: "local",
        googleEventId: null,
        googleHtmlLink: null,
        wakeups: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const events = readCalendarEvents();
      events.push(newEvent);
      writeCalendarEvents(events);
      return Response.json({ ok: true, event: newEvent });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/calendar/")) {
      const eventId = decodeURIComponent(url.pathname.slice("/api/calendar/".length)).trim();
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(eventId)) {
        return Response.json({ error: "Invalid event ID" }, { status: 400 });
      }
      const body = (await req.json().catch(() => ({}))) as {
        status?: string;
        title?: string;
        notes?: string;
        type?: string;
        startAt?: string;
      };
      const events = readCalendarEvents();
      const evt = events.find((e) => e.id === eventId);
      if (!evt) {
        return Response.json({ error: "Calendar event not found" }, { status: 404 });
      }
      if (body.status === "planned" || body.status === "done" || body.status === "cancelled") {
        evt.status = body.status;
      }
      if (typeof body.title === "string" && body.title.trim()) {
        evt.title = body.title.trim();
      }
      if (typeof body.notes === "string") {
        evt.notes = body.notes.trim();
      }
      if (
        body.type === "stream" ||
        body.type === "collab" ||
        body.type === "upload" ||
        body.type === "reminder" ||
        body.type === "deadline"
      ) {
        evt.type = body.type;
      }
      if (typeof body.startAt === "string" && !Number.isNaN(Date.parse(body.startAt))) {
        evt.startAt = new Date(Date.parse(body.startAt)).toISOString();
      }
      evt.updatedAt = new Date().toISOString();
      writeCalendarEvents(events);
      return Response.json({ ok: true, event: evt });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/calendar/")) {
      const eventId = decodeURIComponent(url.pathname.slice("/api/calendar/".length)).trim();
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(eventId)) {
        return Response.json({ error: "Invalid event ID" }, { status: 400 });
      }
      const events = readCalendarEvents();
      const evt = events.find((e) => e.id === eventId);
      if (!evt) {
        return Response.json({ error: "Calendar event not found" }, { status: 404 });
      }
      const gw = await resolveQStashGatewayForServer();
      const revoked: string[] = [];
      for (const w of evt.wakeups || []) {
        if (w.status !== "armed") continue;
        if (gw) {
          const seg = w.kind === "recurring_cron" ? "schedules" : "messages";
          await fetch(`${gw}/v2/${seg}/${encodeURIComponent(w.qstashId)}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(8000),
          }).catch(() => {});
        }
        w.status = "cancelled";
        revoked.push(w.qstashId);
      }
      let googleDeleted = false;
      if (evt.googleEventId) {
        const gCtx = await resolveServerGoogleCalendar();
        if (gCtx) {
          await execServerGCalTool(gCtx, "GOOGLECALENDAR_DELETE_EVENT", {
            calendar_id: "primary",
            event_id: evt.googleEventId,
          })
            .then(() => {
              googleDeleted = true;
            })
            .catch(() => {});
        }
      }
      evt.status = "cancelled";
      evt.updatedAt = new Date().toISOString();
      writeCalendarEvents(events);
      return Response.json({ ok: true, event: evt, revokedQStashIds: revoked, googleDeleted });
    }

    if (req.method === "GET" && url.pathname === "/api/connectors") {
      const guardrails = computeGuardrailStatus();
      try {
        const gwRes = await fetch("https://api.sprites.dev/v1/gateway/list", {
          signal: AbortSignal.timeout(8000),
        });
        if (!gwRes.ok) {
          return Response.json({
            connectors: [],
            ...guardrails,
            warning: `Gateway HTTP ${gwRes.status}`,
          });
        }
        const gwData = (await gwRes.json()) as {
          connections?: Array<{
            provider?: string;
            display_name?: string;
            connection_type?: string;
            description?: string;
            updated_at?: string;
          }>;
        };
        const connectors = (gwData.connections || []).map((c) => ({
          provider: c.provider || "custom_api",
          displayName: c.display_name || c.provider || "Connector",
          connectionType: c.connection_type || "api_key",
          description: c.description || "",
          updatedAt: c.updated_at || null,
          status: "connected",
        }));
        return Response.json({
          connectors,
          ...guardrails,
        });
      } catch (err: unknown) {
        return Response.json({
          connectors: [],
          ...guardrails,
          warning: errorMessage(err),
        });
      }
    }

    // ---------- Unified Studio Workspace (Tier 3 File Manager + Clips) ----------

    if (req.method === "GET" && url.pathname === "/api/workspace/list") {
      try {
        const relDir = url.searchParams.get("path") || "";
        const q = url.searchParams.get("q") || "";
        const listing = listWorkspaceDirectory(relDir, q);
        return Response.json(listing);
      } catch (err: unknown) {
        const msg = errorMessage(err);
        const status = /not found/i.test(msg) ? 404 : 400;
        return Response.json({ error: msg }, { status });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/upload") {
      try {
        const form = await req.formData();
        const rawDir = typeof form.get("dir") === "string" ? String(form.get("dir")) : "uploads";
        const { absPath: targetDirAbs, relPath: targetDirRel } = resolveSafeWorkspacePath(rawDir, {
          allowMissing: true,
        });
        fs.mkdirSync(targetDirAbs, { recursive: true });
        if (!fs.statSync(targetDirAbs).isDirectory()) {
          return Response.json({ error: "Upload target is not a directory" }, { status: 400 });
        }
        const rawEntries = form.getAll("files");
        const single = form.get("file");
        if (single && rawEntries.length === 0) rawEntries.push(single);
        const files = rawEntries.filter((f): f is Exclude<typeof f, string> => typeof f !== "string");
        if (files.length === 0) {
          return Response.json({ error: "No files uploaded" }, { status: 400 });
        }
        const uploaded: Array<{
          name: string;
          relPath: string;
          absPath: string;
          sizeBytes: number;
          kind: string;
        }> = [];
        for (const file of files) {
          if (file.size > MAX_UPLOAD_BYTES) {
            return Response.json(
              { error: `File '${file.name}' exceeds ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit` },
              { status: 413 }
            );
          }
          const { absPath: destAbs, finalName } = uniqueDestinationPath(targetDirAbs, file.name || "upload.bin");
          await Bun.write(destAbs, file);
          const relPath = targetDirRel ? `${targetDirRel}/${finalName}` : finalName;
          const cls = classifyFile(finalName);
          uploaded.push({
            name: finalName,
            relPath,
            absPath: destAbs,
            sizeBytes: file.size,
            kind: cls.kind,
          });
        }
        broadcast({ type: "workspace_changed" });
        return Response.json({ ok: true, uploaded });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/mkdir") {
      try {
        const body = (await req.json()) as { dir?: string; name?: string };
        const safeName = sanitizeSegment(String(body?.name || ""));
        const parentRel = typeof body?.dir === "string" ? body.dir : "";
        const combined = parentRel ? `${parentRel}/${safeName}` : safeName;
        const { absPath, relPath } = resolveSafeWorkspacePath(combined, { allowMissing: true });
        fs.mkdirSync(absPath, { recursive: true });
        broadcast({ type: "workspace_changed" });
        return Response.json({ ok: true, path: relPath });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/rename") {
      try {
        const body = (await req.json()) as { path?: string; newPath?: string };
        const src = resolveSafeWorkspacePath(String(body?.path || ""));
        if (!src.relPath) {
          return Response.json({ error: "Cannot rename workspace root" }, { status: 400 });
        }
        const dst = resolveSafeWorkspacePath(String(body?.newPath || ""), { allowMissing: true });
        if (!dst.relPath) {
          return Response.json({ error: "Destination path is required" }, { status: 400 });
        }
        if (dst.absPath === src.absPath) {
          return Response.json({ ok: true, path: dst.relPath });
        }
        if (dst.absPath.startsWith(src.absPath + path.sep)) {
          return Response.json({ error: "Cannot move a folder inside itself" }, { status: 400 });
        }
        if (fs.existsSync(dst.absPath)) {
          return Response.json({ error: "Destination already exists" }, { status: 409 });
        }
        fs.mkdirSync(path.dirname(dst.absPath), { recursive: true });
        fs.renameSync(src.absPath, dst.absPath);
        broadcast({ type: "workspace_changed" });
        return Response.json({ ok: true, path: dst.relPath });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "DELETE" && url.pathname === "/api/workspace/entry") {
      try {
        const rel = url.searchParams.get("path") || "";
        const target = resolveSafeWorkspacePath(rel);
        if (!target.relPath) {
          return Response.json({ error: "Cannot delete workspace root" }, { status: 400 });
        }
        fs.rmSync(target.absPath, { recursive: true, force: true });
        broadcast({ type: "workspace_changed" });
        return Response.json({ ok: true, deleted: target.relPath });
      } catch (err: unknown) {
        const msg = errorMessage(err);
        return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/text") {
      try {
        const rel = url.searchParams.get("path") || "";
        const { absPath, relPath } = resolveSafeWorkspacePath(rel);
        const st = fs.statSync(absPath);
        if (!st.isFile()) {
          return Response.json({ error: "Path is not a file" }, { status: 400 });
        }
        if (st.size > MAX_TEXT_PREVIEW_BYTES) {
          return Response.json({ error: "File exceeds 2 MB inline text preview limit" }, { status: 413 });
        }
        const cls = classifyFile(path.basename(absPath));
        if (!cls.editable) {
          return Response.json({ error: "File type is not a plain-text previewable format" }, { status: 415 });
        }
        const content = fs.readFileSync(absPath, "utf8");
        return Response.json({
          path: relPath,
          absPath,
          name: path.basename(absPath),
          kind: cls.kind,
          content,
          sizeBytes: st.size,
          updatedAt: st.mtime.toISOString(),
        });
      } catch (err: unknown) {
        const msg = errorMessage(err);
        return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
      }
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace/text") {
      try {
        const body = (await req.json()) as { path?: string; content?: string };
        const rawPath = String(body?.path || "");
        const content = typeof body?.content === "string" ? body.content : "";
        if (Buffer.byteLength(content, "utf8") > MAX_TEXT_PREVIEW_BYTES) {
          return Response.json({ error: "Content exceeds 2 MB inline editor limit" }, { status: 413 });
        }
        const { absPath, relPath } = resolveSafeWorkspacePath(rawPath, { allowMissing: true });
        if (!relPath) {
          return Response.json({ error: "File path is required" }, { status: 400 });
        }
        const cls = classifyFile(path.basename(absPath));
        if (!cls.editable) {
          return Response.json({ error: "Only text/markdown files can be edited inline" }, { status: 415 });
        }
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, content, "utf8");
        fs.renameSync(tmp, absPath);
        const st = fs.statSync(absPath);
        broadcast({ type: "workspace_changed" });
        return Response.json({
          ok: true,
          path: relPath,
          sizeBytes: st.size,
          updatedAt: st.mtime.toISOString(),
        });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/workspace/file") {
      try {
        const rel = url.searchParams.get("path") || "";
        const { absPath } = resolveSafeWorkspacePath(rel);
        const st = fs.statSync(absPath);
        if (!st.isFile()) {
          return Response.json({ error: "Path is not a file" }, { status: 400 });
        }
        const fileName = path.basename(absPath);
        const cls = classifyFile(fileName);
        const forceDownload = url.searchParams.get("download") === "1" || !cls.inlineMime;
        const contentType = forceDownload ? "application/octet-stream" : cls.inlineMime!;
        const size = st.size;
        const headers: Record<string, string> = {
          "Content-Type": contentType,
          "X-Content-Type-Options": "nosniff",
          "Accept-Ranges": "bytes",
          "Content-Length": String(size),
          "Cache-Control": "no-store",
        };
        if (forceDownload) {
          const safeAscii = fileName.replace(/["\\\r\n]/g, "_");
          headers["Content-Disposition"] = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
        }
        if (req.method === "HEAD") {
          return new Response(null, { status: 200, headers });
        }
        const rangeHeader = req.headers.get("range");
        if (rangeHeader && rangeHeader.startsWith("bytes=")) {
          const [startStr, endStr] = rangeHeader.slice(6).split("-");
          const start = startStr ? Number.parseInt(startStr, 10) : 0;
          const end = endStr ? Math.min(size - 1, Number.parseInt(endStr, 10)) : size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) {
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${size}` },
            });
          }
          headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
          headers["Content-Length"] = String(end - start + 1);
          return new Response(Bun.file(absPath).slice(start, end + 1), { status: 206, headers });
        }
        return new Response(Bun.file(absPath), { headers });
      } catch (err: unknown) {
        const msg = errorMessage(err);
        return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/box-status") {
      const gw = await resolveBoxGatewayUrl();
      return Response.json({ connected: Boolean(gw) });
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/export-box") {
      try {
        const body = (await req.json().catch(() => ({}))) as { path?: string };
        const rawPath = typeof body.path === "string" ? body.path : "";
        const { absPath, relPath } = resolveSafeWorkspacePath(rawPath, { allowMissing: false });
        if (!fs.existsSync(absPath)) {
          return Response.json({ ok: false, error: "File or folder not found" }, { status: 404 });
        }
        const result = await exportWorkspaceEntryToBox(absPath, relPath);
        return Response.json({ ok: true, ...result });
      } catch (err: unknown) {
        const msg = errorMessage(err);
        const status = /not connected/i.test(msg) ? 503 : /not found/i.test(msg) ? 404 : 400;
        return Response.json({ ok: false, error: msg }, { status });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/zip") {
      let zipResult: { zipPath: string; downloadName: string; cleanup: () => void } | null = null;
      try {
        const relDir = url.searchParams.get("path") || "";
        zipResult = await createWorkspaceZip(relDir);
        const bytes = fs.readFileSync(zipResult.zipPath);
        const downloadName = zipResult.downloadName;
        zipResult.cleanup();
        zipResult = null;
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/zip",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename="${downloadName}"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (err: unknown) {
        if (zipResult) zipResult.cleanup();
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    // ---------- Custom Studio Apps API (Local Otto OS Desktop Apps) ----------

    if (req.method === "GET" && url.pathname === "/api/studio-apps") {
      return Response.json({ apps: listCustomStudioApps() });
    }

    const studioAppMatch = url.pathname.match(/^\/api\/studio-apps\/([^/]+)(?:\/(code|state))?$/);
    if (studioAppMatch) {
      const slug = decodeURIComponent(studioAppMatch[1]).trim();
      const sub = studioAppMatch[2] || "";
      try {
        if (!sub && req.method === "GET") {
          const app = getCustomStudioApp(slug);
          if (!app) return Response.json({ error: "App not found" }, { status: 404 });
          return Response.json(app);
        }
        if (!sub && req.method === "DELETE") {
          const ok = deleteCustomStudioApp(slug);
          if (!ok) return Response.json({ error: "App not found" }, { status: 404 });
          broadcast({ type: "studio_apps_changed", slug, deleted: true });
          return Response.json({ ok: true, deleted: slug });
        }
        if (sub === "code" && req.method === "PUT") {
          const body = (await req.json().catch(() => ({}))) as { code?: string };
          if (typeof body.code !== "string") {
            return Response.json({ error: "Missing code" }, { status: 400 });
          }
          const meta = updateCustomStudioAppCode(slug, body.code);
          broadcast({ type: "studio_apps_changed", slug });
          return Response.json({ ok: true, meta });
        }
        if (sub === "state" && req.method === "GET") {
          const state = getCustomStudioAppState(slug);
          return Response.json({ ok: true, state });
        }
        if (sub === "state" && req.method === "PUT") {
          const body = (await req.json().catch(() => ({}))) as { state?: Record<string, unknown> };
          const saved = saveCustomStudioAppState(slug, (body.state || {}) as Record<string, unknown>);
          return Response.json({ ok: true, state: saved });
        }
      } catch (err: unknown) {
        const msg = errorMessage(err);
        return Response.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 400 });
      }
    }

    // ---------- Fly Machine OBS Overlays API ----------

    if (req.method === "GET" && url.pathname === "/api/obs-overlays") {
      const result = await listHostedObsOverlays();
      return Response.json(result);
    }

    const obsOverlayMatch = url.pathname.match(/^\/api\/obs-overlays\/([^/]+)(?:\/(state))?$/);
    if (obsOverlayMatch) {
      const slug = decodeURIComponent(obsOverlayMatch[1]).trim();
      const sub = obsOverlayMatch[2] || "";
      try {
        if (sub === "state" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as {
            patch?: Record<string, unknown>;
            replace?: boolean;
          };
          const out = await updateObsOverlayState(slug, body.patch || {}, body.replace === true);
          broadcast({ type: "obs_overlays_changed", slug });
          return Response.json({ ok: true, state: out.state });
        }
        if (!sub && req.method === "DELETE") {
          const ok = await deleteHostedObsOverlay(slug);
          if (!ok) return Response.json({ error: "Overlay not found" }, { status: 404 });
          broadcast({ type: "obs_overlays_changed", slug, deleted: true });
          return Response.json({ ok: true, deleted: slug });
        }
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    // ---------- Unified Studio Database API (SQLite WAL) ----------

    if (req.method === "GET" && url.pathname === "/api/db/overview") {
      return Response.json(getStudioDbOverview());
    }

    if (req.method === "GET" && url.pathname === "/api/db/pipeline") {
      const status = url.searchParams.get("status") || undefined;
      const format = url.searchParams.get("format") || undefined;
      return Response.json({ items: listPipelineItems({ status, format }) });
    }

    if (req.method === "POST" && url.pathname === "/api/db/pipeline") {
      try {
        const body = (await req.json()) as {
          id?: string;
          title?: string;
          format?: PipelineFormat;
          status?: PipelineStatus;
          hook?: string;
          thumbnailPath?: string;
          scriptPath?: string;
          scheduledFor?: string | null;
          notes?: string;
        };
        const item = upsertPipelineItem(body || {});
        broadcast({ type: "db_changed" });
        return Response.json({ ok: true, item });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/db/pipeline/")) {
      try {
        const id = decodeURIComponent(url.pathname.slice("/api/db/pipeline/".length)).trim();
        const body = (await req.json()) as Record<string, unknown>;
        const item = upsertPipelineItem({ ...(body as Record<string, never>), id });
        broadcast({ type: "db_changed" });
        return Response.json({ ok: true, item });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/db/pipeline/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/db/pipeline/".length)).trim();
      const deleted = deletePipelineItem(id);
      if (deleted) broadcast({ type: "db_changed" });
      return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
    }

    if (req.method === "GET" && url.pathname === "/api/db/contacts") {
      const role = url.searchParams.get("role") || undefined;
      const status = url.searchParams.get("status") || undefined;
      return Response.json({ contacts: listContacts({ role, status }) });
    }

    if (req.method === "POST" && url.pathname === "/api/db/contacts") {
      try {
        const body = (await req.json()) as {
          id?: string;
          name?: string;
          role?: ContactRole;
          handle?: string;
          platform?: string;
          status?: ContactStatus;
          notes?: string;
        };
        const contact = upsertContact(body || {});
        broadcast({ type: "db_changed" });
        return Response.json({ ok: true, contact });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/db/contacts/")) {
      try {
        const id = decodeURIComponent(url.pathname.slice("/api/db/contacts/".length)).trim();
        const body = (await req.json()) as Record<string, unknown>;
        const contact = upsertContact({ ...(body as Record<string, never>), id });
        broadcast({ type: "db_changed" });
        return Response.json({ ok: true, contact });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/db/contacts/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/db/contacts/".length)).trim();
      const deleted = deleteContact(id);
      if (deleted) broadcast({ type: "db_changed" });
      return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
    }

    if (req.method === "GET" && url.pathname === "/api/db/metrics") {
      const limit = Number(url.searchParams.get("limit") || 50);
      return Response.json({ metrics: listChannelMetrics(Number.isFinite(limit) ? limit : 50) });
    }

    if (req.method === "GET" && url.pathname === "/api/db/metrics/widget") {
      const identity = readSetupIdentity();
      const tz = identity.timezone || "UTC";
      const state = getYouTubeMetricsWidgetState(tz);
      let autoSyncStarted = false;
      if (url.searchParams.get("auto") === "1" && shouldAutoSyncYouTubeMetrics()) {
        autoSyncStarted = true;
        void syncYouTubeMetrics({ timezone: tz }).then((res) => {
          if (res.ok) broadcast({ type: "db_changed" });
        });
      }
      return Response.json({ state, autoSyncStarted });
    }

    if (req.method === "POST" && url.pathname === "/api/db/metrics/sync") {
      const identity = readSetupIdentity();
      const res = await syncYouTubeMetrics({ timezone: identity.timezone || "UTC" });
      if (res.ok) broadcast({ type: "db_changed" });
      return Response.json(res, { status: res.ok ? 200 : 502 });
    }

    if (req.method === "POST" && url.pathname === "/api/db/metrics/daily-config") {
      try {
        const body = (await req.json().catch(() => ({}))) as {
          enabled?: boolean;
          timezone?: string;
        };
        const identity = readSetupIdentity();
        const tz =
          typeof body.timezone === "string" && body.timezone.trim()
            ? body.timezone.trim()
            : identity.timezone || "UTC";
        const enabled = Boolean(body.enabled);
        const result = await syncDailyMetricsQStashSchedule({ enabled, timezone: tz });
        broadcast({ type: "db_changed" });
        return Response.json({
          ...result,
          state: getYouTubeMetricsWidgetState(tz),
        });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/db/metrics") {
      try {
        const body = (await req.json()) as {
          recordedAt?: string;
          platform?: string;
          subscribers?: number | null;
          totalViews?: number | null;
          avgCcv?: number | null;
          avgCtr?: number | null;
          notes?: string;
        };
        const metric = addChannelMetric(body || {});
        broadcast({ type: "db_changed" });
        return Response.json({ ok: true, metric });
      } catch (err: unknown) {
        return Response.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/db/metrics/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/db/metrics/".length)).trim();
      const deleted = deleteChannelMetric(id);
      if (deleted) broadcast({ type: "db_changed" });
      return Response.json({ ok: deleted, id }, { status: deleted ? 200 : 404 });
    }

    // ---------- Clips Ecosystem & Background VOD Clipper APIs ----------

    if (req.method === "GET" && url.pathname === "/api/clips/ecosystem") {
      ensureWorkspaceScaffold();
      const jobs = listClipJobs(30);
      const records = listClipRecords({ limit: 80 });
      const trackedPaths = new Set(records.map((r) => r.filePath));
      const untrackedFiles: Array<{
        videoId: string;
        name: string;
        filename: string;
        relPath: string;
        mp4Url: string;
        srtUrl: string | null;
        sizeBytes: number;
        updatedAt: string;
      }> = [];
      if (fs.existsSync(WORKSPACE_CLIPS_DIR)) {
        for (const vidEntry of fs.readdirSync(WORKSPACE_CLIPS_DIR, { withFileTypes: true })) {
          if (!vidEntry.isDirectory() || !/^[A-Za-z0-9_-]{6,32}$/.test(vidEntry.name)) continue;
          const vidDir = path.join(WORKSPACE_CLIPS_DIR, vidEntry.name);
          for (const f of fs.readdirSync(vidDir)) {
            if (!f.endsWith(".mp4")) continue;
            const relPath = `clips/${vidEntry.name}/${f}`;
            if (trackedPaths.has(relPath)) continue;
            const full = path.join(vidDir, f);
            const st = fs.statSync(full);
            if (!st.isFile()) continue;
            const base = f.slice(0, -4);
            const exactSrt = `${base}.srt`;
            const strippedSrt = `${base.replace(/_prepped$/, "")}.srt`;
            const matchedSrt = fs.existsSync(path.join(vidDir, exactSrt))
              ? exactSrt
              : fs.existsSync(path.join(vidDir, strippedSrt))
                ? strippedSrt
                : null;
            untrackedFiles.push({
              videoId: vidEntry.name,
              name: base,
              filename: f,
              relPath,
              mp4Url: `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(f)}`,
              srtUrl: matchedSrt
                ? `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(matchedSrt)}`
                : null,
              sizeBytes: st.size,
              updatedAt: st.mtime.toISOString(),
            });
          }
        }
      }
      untrackedFiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return Response.json({
        jobs,
        records,
        untrackedFiles,
        activeWorkerIds: getActiveClipWorkerIds(),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/clips/jobs") {
      try {
        const body = (await req.json()) as {
          vodUrl?: string;
          title?: string;
          maxClips?: number;
          focusNotes?: string;
        };
        if (!body.vodUrl || !String(body.vodUrl).trim()) {
          return Response.json({ error: "YouTube VOD URL is required" }, { status: 400 });
        }
        const job = startBackgroundClipJob(
          {
            vodUrl: String(body.vodUrl),
            title: body.title ? String(body.title) : undefined,
            maxClips: typeof body.maxClips === "number" ? body.maxClips : 0,
            focusNotes: body.focusNotes ? String(body.focusNotes) : "",
          },
          {
            ompBin: OMP_BIN,
            workDir: WORK_DIR,
            port: PORT,
            internalSecret: LMA_INTERNAL_SECRET,
            onBroadcast: broadcast,
            onBusyChange: (busy) => {
              if (busy) {
                void rpc.holdSpriteActive();
              } else {
                rpc.releaseSpriteHold();
              }
            },
          }
        );
        return Response.json({ ok: true, job });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 }
        );
      }
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/clips/jobs/") && url.pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/clips/jobs/".length, -"/cancel".length)
      );
      const job = cancelBackgroundClipJob(id, broadcast, (busy) => {
        if (!busy) rpc.releaseSpriteHold();
      });
      if (!job) return Response.json({ error: "Clip job not found" }, { status: 404 });
      return Response.json({ ok: true, job });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/clips/jobs/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/clips/jobs/".length));
      const ok = deleteClipJob(id);
      if (ok) broadcast({ type: "clips_changed" });
      return Response.json({ ok });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/clips/records/") && url.pathname.endsWith("/box")) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/clips/records/".length, -"/box".length)
      );
      const all = listClipRecords({ limit: 200 });
      const rec = all.find((c) => c.id === id);
      if (!rec) return Response.json({ error: "Clip record not found" }, { status: 404 });
      try {
        const resolved = resolveSafeWorkspacePath(rec.filePath, { allowMissing: false });
        const uploaded = await exportWorkspaceEntryToBox(resolved.absPath, resolved.relPath);
        const updated = updateClipBoxUrl(rec.id, uploaded.url);
        broadcast({ type: "clips_changed" });
        return Response.json({ ok: true, clip: updated, boxUrl: uploaded.url });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500 }
        );
      }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/clips/records/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/clips/records/".length));
      const ok = deleteClipRecord(id);
      if (ok) broadcast({ type: "clips_changed" });
      return Response.json({ ok });
    }

    // ---------- Backwards-Compatible Raw Clips Endpoints (now unified under workspace/clips) ----------

    if (req.method === "GET" && url.pathname === "/api/clips") {
      ensureWorkspaceScaffold();
      const clipsRoot = WORKSPACE_CLIPS_DIR;
      if (!fs.existsSync(clipsRoot)) {
        return Response.json({ clips: [] });
      }
      const clips: Array<{
        videoId: string;
        name: string;
        filename: string;
        relPath: string;
        mp4Url: string;
        srtUrl: string | null;
        sizeBytes: number;
        updatedAt: string;
      }> = [];
      for (const vidEntry of fs.readdirSync(clipsRoot, { withFileTypes: true })) {
        if (!vidEntry.isDirectory() || !/^[A-Za-z0-9_-]{6,32}$/.test(vidEntry.name)) continue;
        const vidDir = path.join(clipsRoot, vidEntry.name);
        for (const f of fs.readdirSync(vidDir)) {
          if (!f.endsWith(".mp4")) continue;
          const full = path.join(vidDir, f);
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          const base = f.slice(0, -4);
          const exactSrt = `${base}.srt`;
          const strippedSrt = `${base.replace(/_prepped$/, "")}.srt`;
          const matchedSrt = fs.existsSync(path.join(vidDir, exactSrt))
            ? exactSrt
            : fs.existsSync(path.join(vidDir, strippedSrt))
              ? strippedSrt
              : null;
          clips.push({
            videoId: vidEntry.name,
            name: base,
            filename: f,
            relPath: `clips/${vidEntry.name}/${f}`,
            mp4Url: `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(f)}`,
            srtUrl: matchedSrt
              ? `/api/clips/file/${encodeURIComponent(vidEntry.name)}/${encodeURIComponent(matchedSrt)}`
              : null,
            sizeBytes: st.size,
            updatedAt: st.mtime.toISOString(),
          });
        }
      }
      clips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return Response.json({ clips });
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/api/clips/file/")) {
      const relParts = url.pathname.slice("/api/clips/file/".length).split("/").filter(Boolean);
      if (relParts.length !== 2) {
        return Response.json({ error: "Invalid clip path" }, { status: 400 });
      }
      let vidRaw: string;
      let fileRaw: string;
      try {
        [vidRaw, fileRaw] = relParts.map((p) => decodeURIComponent(p));
      } catch {
        return Response.json({ error: "Malformed clip path encoding" }, { status: 400 });
      }
      if (!/^[A-Za-z0-9_-]{6,32}$/.test(vidRaw) || !/^[A-Za-z0-9_.-]+\.(mp4|srt)$/.test(fileRaw)) {
        return Response.json({ error: "Invalid clip filename" }, { status: 400 });
      }
      const clipsRoot = path.resolve(WORKSPACE_CLIPS_DIR);
      const candidate = path.resolve(clipsRoot, vidRaw, fileRaw);
      if (!candidate.startsWith(clipsRoot + path.sep) || !fs.existsSync(candidate)) {
        return Response.json({ error: "Clip not found" }, { status: 404 });
      }
      const isDownload = url.searchParams.get("download") === "1";
      const contentType = fileRaw.endsWith(".mp4") ? "video/mp4" : "text/plain; charset=utf-8";
      const stat = fs.statSync(candidate);
      const size = stat.size;
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      };
      if (isDownload) {
        headers["Content-Disposition"] = `attachment; filename="${fileRaw}"`;
      }
      if (req.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      const rangeHeader = req.headers.get("range");
      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const [startStr, endStr] = rangeHeader.slice(6).split("-");
        const start = startStr ? Number.parseInt(startStr, 10) : 0;
        const end = endStr ? Math.min(size - 1, Number.parseInt(endStr, 10)) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        }
        const chunkSize = end - start + 1;
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        headers["Content-Length"] = String(chunkSize);
        return new Response(Bun.file(candidate).slice(start, end + 1), { status: 206, headers });
      }
      return new Response(Bun.file(candidate), { headers });
    }

    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const resolvedDist = path.resolve(DIST_DIR);
      const candidate = path.resolve(resolvedDist, rel);
      if (
        candidate.startsWith(resolvedDist + path.sep) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        return new Response(Bun.file(candidate));
      }
      const fallback = path.join(resolvedDist, "index.html");
      if (fs.existsSync(fallback)) {
        return new Response(Bun.file(fallback), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Frontend not built yet. Run: cd web && bun run build", { status: 503 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[lma-web] Otto Studio Web UI listening on http://0.0.0.0:${PORT}`);
