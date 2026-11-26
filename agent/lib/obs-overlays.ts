import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HOME_DIR = process.env.HOME || "/home/sprite";
const CONFIG_DIR = path.join(HOME_DIR, ".config", "lma");
const MACHINE_CONFIG_PATH = path.join(CONFIG_DIR, "obs-overlay-machine.json");
const GATEWAY_LIST_URL = "https://api.sprites.dev/v1/gateway/list";

export interface OverlayControlField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "toggle" | "select" | "timer_action";
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  action?: "start" | "pause" | "reset" | "add_seconds";
  seconds?: number;
}

export interface ObsOverlaySummary {
  slug: string;
  title: string;
  description: string;
  controls: OverlayControlField[];
  state: Record<string, unknown>;
  overlayUrl: string;
  controlUrl: string;
  controlToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObsOverlayMachineConfig {
  appName: string;
  machineId: string;
  volumeId: string;
  region: string;
  baseUrl: string;
  adminToken: string;
  orgSlug: string;
  serverVersion: number;
  createdAt: string;
}

export interface FlyConnectorInfo {
  gatewayBaseUrl: string;
  orgSlug: string;
  displayName: string;
}

let cachedConnector: { info: FlyConnectorInfo; fetchedAt: number } | null = null;

export async function discoverFlyMachinesConnector(forceRefresh = false): Promise<FlyConnectorInfo | null> {
  if (!forceRefresh && cachedConnector && Date.now() - cachedConnector.fetchedAt < 60_000) {
    return cachedConnector.info;
  }
  try {
    const res = await fetch(GATEWAY_LIST_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{
        base_api_url?: string;
        gateway_base_url?: string;
        display_name?: string;
        provider_info?: { base_api_url?: string; test_url?: string };
      }>;
    };
    const match = (data.connections || []).find((c) => {
      const api = c.base_api_url || c.provider_info?.base_api_url || "";
      return api.replace(/\/+$/, "") === "https://api.machines.dev";
    });
    if (!match || !match.gateway_base_url) return null;

    let orgSlug = process.env.LMA_FLY_ORG || "personal";
    const testUrl = match.provider_info?.test_url || "";
    if (testUrl) {
      try {
        const parsed = new URL(testUrl);
        const qOrg = parsed.searchParams.get("org_slug");
        if (qOrg) orgSlug = qOrg;
      } catch {
        // keep default
      }
    }
    const info: FlyConnectorInfo = {
      gatewayBaseUrl: match.gateway_base_url.replace(/\/+$/, ""),
      orgSlug,
      displayName: match.display_name || "Fly Machines",
    };
    cachedConnector = { info, fetchedAt: Date.now() };
    return info;
  } catch {
    return null;
  }
}

export function readSavedMachineConfig(): ObsOverlayMachineConfig | null {
  if (!fs.existsSync(MACHINE_CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(MACHINE_CONFIG_PATH, "utf8")) as ObsOverlayMachineConfig;
    if (raw && raw.appName && raw.machineId && raw.baseUrl && raw.adminToken) {
      return raw;
    }
  } catch {
    // ignore corrupt config
  }
  return null;
}

function saveMachineConfig(cfg: ObsOverlayMachineConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${MACHINE_CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, MACHINE_CONFIG_PATH);
}

export function sanitizeOverlaySlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!cleaned || !/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
    throw new Error("Invalid overlay slug. Use lowercase letters, numbers, and hyphens.");
  }
  return cleaned;
}

const SERVER_VERSION = 1;

// Self-contained Bun HTTP + SSE overlay server injected directly into oven/bun:1-alpine via Fly Machines config.files
const FLY_OVERLAY_SERVER_TS = `
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "/data";
const OVERLAYS_DIR = path.join(DATA_DIR, "overlays");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SERVER_VERSION = ${SERVER_VERSION};

fs.mkdirSync(OVERLAYS_DIR, { recursive: true });

const sseClients = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const encoder = new TextEncoder();

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function safeSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(s)) return null;
  return s;
}

function overlayDir(slug: string): string {
  return path.join(OVERLAYS_DIR, slug);
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + Date.now() + ".tmp";
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file: string, fallback: any): any {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function broadcast(slug: string, eventName: string, data: unknown): void {
  const clients = sseClients.get(slug);
  if (!clients || clients.size === 0) return;
  const chunk = encoder.encode("event: " + eventName + "\\ndata: " + JSON.stringify(data) + "\\n\\n");
  for (const ctrl of Array.from(clients)) {
    try { ctrl.enqueue(chunk); } catch { clients.delete(ctrl); }
  }
}

function isAdmin(req: Request): boolean {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return Boolean(token) && timingSafeEqualStr(token, ADMIN_TOKEN);
}

function isControlAuthorized(req: Request, url: URL, meta: any): boolean {
  if (isAdmin(req)) return true;
  const token =
    req.headers.get("x-control-token") ||
    url.searchParams.get("token") ||
    "";
  return Boolean(token && meta?.controlToken && timingSafeEqualStr(token, String(meta.controlToken)));
}

function injectOverlayClientScript(html: string, slug: string, state: Record<string, unknown>): string {
  const safeState = JSON.stringify(state ?? {}).replace(/</g, "\\\\u003c").replace(/>/g, "\\\\u003e");
  const safeSlugJson = JSON.stringify(slug);
  const script = \`<script>
(function(){
  const SLUG = \${safeSlugJson};
  let current = \${safeState};
  const listeners = new Set();
  function notify(next){
    current = next && typeof next === "object" ? next : {};
    if (typeof window.onOverlayState === "function") { try { window.onOverlayState(current); } catch(e){} }
    listeners.forEach(function(fn){ try { fn(current); } catch(e){} });
  }
  window.OBS_OVERLAY = {
    slug: SLUG,
    get state(){ return current; },
    subscribe: function(fn){
      listeners.add(fn);
      try { fn(current); } catch(e){}
      return function(){ listeners.delete(fn); };
    }
  };
  function connect(){
    const es = new EventSource("/o/" + encodeURIComponent(SLUG) + "/events");
    es.addEventListener("state", function(ev){
      try { notify(JSON.parse(ev.data)); } catch(e){}
    });
    es.addEventListener("reload", function(){ location.reload(); });
    es.onerror = function(){
      es.close();
      setTimeout(connect, 2000);
    };
  }
  window.addEventListener("DOMContentLoaded", function(){ notify(current); connect(); });
})();
</script>\`;
  if (/<\\/head>/i.test(html)) return html.replace(/<\\/head>/i, script + "\\n</head>");
  if (/<\\/body>/i.test(html)) return html.replace(/<\\/body>/i, script + "\\n</body>");
  return script + html;
}

function buildRemoteDeckHtml(meta: any, state: Record<string, unknown>, token: string): string {
  const metaJson = JSON.stringify({
    slug: meta.slug,
    title: meta.title || meta.slug,
    description: meta.description || "",
    controls: Array.isArray(meta.controls) ? meta.controls : [],
  }).replace(/</g, "\\\\u003c");
  const stateJson = JSON.stringify(state ?? {}).replace(/</g, "\\\\u003c");
  const tokenJson = JSON.stringify(token);
  const titleEsc = String(meta.title || meta.slug).replace(/</g, "&lt;");

  return \`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>\${titleEsc} · Remote Control</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; padding: 14px; background: #FAFAFA; color: #303030; font-family: 'Inter', -apple-system, sans-serif; font-size: 13px; }
  .deck { max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .card { background: #FFFFFF; border: 1px solid #EDEDED; border-radius: 14px; padding: 14px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .title { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; }
  .status { font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #E6F7EE; color: #166534; }
  .status.off { background: #F2F2F2; color: #808080; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
  label { display: flex; flex-direction: column; gap: 5px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #666; }
  input[type=text], input[type=number], textarea, select {
    width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid #D9D9D9; background: #FFFFFF;
    color: #303030; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; outline: none;
  }
  input:focus, textarea:focus, select:focus { border-color: #303030; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 8px; }
  button {
    padding: 7px 14px; border-radius: 999px; border: 1px solid #D9D9D9; background: #F2F2F2; color: #303030;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 500; cursor: pointer;
  }
  button.primary { background: #303030; color: #FFFFFF; border-color: #303030; }
  button:active { transform: scale(0.98); }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border: 1px solid #EDEDED; border-radius: 10px; }
</style>
</head>
<body>
<div class="deck">
  <div class="card row">
    <div>
      <div class="title" id="deck-title"></div>
      <div style="font-size:11.5px;color:#808080;margin-top:2px" id="deck-desc"></div>
    </div>
    <span class="status" id="conn">Connected</span>
  </div>
  <div class="card" id="controls-wrap"></div>
</div>
<script>
const META = \${metaJson};
const TOKEN = \${tokenJson};
let state = \${stateJson};

document.getElementById("deck-title").textContent = META.title;
document.getElementById("deck-desc").textContent = META.description || ("Live remote for /o/" + META.slug);

async function pushPatch(patch) {
  state = Object.assign({}, state, patch);
  renderControls();
  await fetch("/o/" + encodeURIComponent(META.slug) + "/state?token=" + encodeURIComponent(TOKEN), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch })
  });
}

function renderControls() {
  const wrap = document.getElementById("controls-wrap");
  wrap.innerHTML = "";
  const controls = META.controls || [];

  if (controls.length === 0) {
    const lbl = document.createElement("label");
    lbl.textContent = "Live state (JSON)";
    const ta = document.createElement("textarea");
    ta.rows = 6;
    ta.value = JSON.stringify(state, null, 2);
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.style.marginTop = "8px";
    btn.textContent = "Apply state";
    btn.onclick = () => {
      try { pushPatch(JSON.parse(ta.value)); } catch (e) { alert("Invalid JSON: " + e.message); }
    };
    lbl.appendChild(ta);
    wrap.appendChild(lbl);
    wrap.appendChild(btn);
    return;
  }

  const actions = controls.filter(c => c.type === "timer_action");
  const fields = controls.filter(c => c.type !== "timer_action");

  if (actions.length > 0) {
    const bar = document.createElement("div");
    bar.className = "btn-row";
    bar.style.marginBottom = fields.length ? "12px" : "0";
    actions.forEach(a => {
      const btn = document.createElement("button");
      if (a.action === "start") btn.className = "primary";
      btn.textContent = a.label;
      btn.onclick = () => {
        const now = Date.now();
        const curSec = typeof state.remainingSec === "number" ? state.remainingSec : (typeof state.durationSec === "number" ? state.durationSec : 300);
        if (a.action === "start") {
          pushPatch({ running: true, targetEpochMs: now + Math.max(0, curSec) * 1000 });
        } else if (a.action === "pause") {
          const left = state.running && state.targetEpochMs ? Math.max(0, Math.round((state.targetEpochMs - now) / 1000)) : curSec;
          pushPatch({ running: false, remainingSec: left, targetEpochMs: null });
        } else if (a.action === "reset") {
          const defSec = typeof state.durationSec === "number" ? state.durationSec : 300;
          pushPatch({ running: false, remainingSec: defSec, targetEpochMs: null });
        } else if (a.action === "add_seconds") {
          const delta = Number(a.seconds || 60);
          if (state.running && state.targetEpochMs) {
            const nextEpoch = Math.max(now, state.targetEpochMs + delta * 1000);
            pushPatch({ targetEpochMs: nextEpoch, remainingSec: Math.max(0, Math.round((nextEpoch - now) / 1000)) });
          } else {
            pushPatch({ remainingSec: Math.max(0, curSec + delta) });
          }
        } else {
          pushPatch({ [a.key]: Date.now() });
        }
      };
      bar.appendChild(btn);
    });
    wrap.appendChild(bar);
  }

  const grid = document.createElement("div");
  grid.className = "grid";
  fields.forEach(f => {
    if (f.type === "toggle") {
      const row = document.createElement("div");
      row.className = "toggle-row";
      const sp = document.createElement("span");
      sp.style.fontFamily = "'IBM Plex Mono', monospace";
      sp.style.fontSize = "12px";
      sp.textContent = f.label;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(state[f.key]);
      cb.onchange = () => pushPatch({ [f.key]: cb.checked });
      row.appendChild(sp);
      row.appendChild(cb);
      grid.appendChild(row);
      return;
    }

    const lbl = document.createElement("label");
    lbl.textContent = f.label;
    let input;
    if (f.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
      input.value = String(state[f.key] ?? "");
    } else if (f.type === "select") {
      input = document.createElement("select");
      (f.options || []).forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(state[f.key] ?? "") === opt) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = f.type === "number" ? "number" : "text";
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
      if (f.step !== undefined) input.step = String(f.step);
      if (f.placeholder) input.placeholder = f.placeholder;
      input.value = String(state[f.key] ?? "");
    }
    input.onchange = () => {
      const val = f.type === "number" ? Number(input.value) : input.value;
      pushPatch({ [f.key]: val });
    };
    lbl.appendChild(input);
    grid.appendChild(lbl);
  });
  if (fields.length > 0) wrap.appendChild(grid);
}

renderControls();

const connEl = document.getElementById("conn");
const es = new EventSource("/o/" + encodeURIComponent(META.slug) + "/events");
es.addEventListener("state", (ev) => {
  try {
    state = JSON.parse(ev.data);
    renderControls();
    connEl.textContent = "Live";
    connEl.className = "status";
  } catch {}
});
es.onerror = () => {
  connEl.textContent = "Reconnecting";
  connEl.className = "status off";
};
</script>
</body>
</html>\`;
}

function listAllOverlays(origin: string) {
  const dirs = fs.readdirSync(OVERLAYS_DIR, { withFileTypes: true });
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const slug = safeSlug(d.name);
    if (!slug) continue;
    const dir = overlayDir(slug);
    const meta = readJson(path.join(dir, "meta.json"), null);
    if (!meta) continue;
    const state = readJson(path.join(dir, "state.json"), {});
    out.push({
      slug,
      title: meta.title || slug,
      description: meta.description || "",
      controls: Array.isArray(meta.controls) ? meta.controls : [],
      state,
      controlToken: meta.controlToken,
      overlayUrl: origin + "/o/" + slug,
      controlUrl: origin + "/c/" + slug + "?token=" + encodeURIComponent(meta.controlToken || ""),
      createdAt: meta.createdAt || "",
      updatedAt: meta.updatedAt || "",
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    const host = req.headers.get("host") || url.host;
    const origin = proto + "://" + host;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Control-Token",
        },
      });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, serverVersion: SERVER_VERSION, overlays: listAllOverlays(origin).length });
    }

    // Admin API
    if (url.pathname === "/admin/overlays" && req.method === "GET") {
      if (!isAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ ok: true, overlays: listAllOverlays(origin) });
    }

    const adminMatch = url.pathname.match(/^\\/admin\\/overlays\\/([a-z0-9-]+)$/);
    if (adminMatch) {
      if (!isAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const slug = safeSlug(adminMatch[1]);
      if (!slug) return Response.json({ error: "Invalid slug" }, { status: 400 });
      const dir = overlayDir(slug);

      if (req.method === "PUT") {
        const body = (await req.json().catch(() => ({}))) as any;
        const html = typeof body.html === "string" ? body.html : "";
        if (!html.trim()) return Response.json({ error: "Missing overlay html" }, { status: 400 });
        const existingMeta = readJson(path.join(dir, "meta.json"), null);
        const existingState = readJson(path.join(dir, "state.json"), {});
        const now = new Date().toISOString();
        const controlToken = existingMeta?.controlToken || crypto.randomBytes(16).toString("hex");
        const meta = {
          slug,
          title: String(body.title || existingMeta?.title || slug).trim(),
          description: String(body.description ?? existingMeta?.description ?? "").trim(),
          controls: Array.isArray(body.controls) ? body.controls : (existingMeta?.controls || []),
          controlToken,
          createdAt: existingMeta?.createdAt || now,
          updatedAt: now,
        };
        const nextState = body.resetState === true
          ? (body.initialState && typeof body.initialState === "object" ? body.initialState : {})
          : Object.assign({}, body.initialState && typeof body.initialState === "object" ? body.initialState : {}, existingState);

        atomicWrite(path.join(dir, "overlay.html"), html);
        atomicWrite(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
        atomicWrite(path.join(dir, "state.json"), JSON.stringify(nextState, null, 2));
        if (typeof body.controlHtml === "string" && body.controlHtml.trim()) {
          atomicWrite(path.join(dir, "control.html"), body.controlHtml);
        }

        broadcast(slug, "reload", { updatedAt: now });
        broadcast(slug, "state", nextState);

        return Response.json({
          ok: true,
          overlay: {
            ...meta,
            state: nextState,
            overlayUrl: origin + "/o/" + slug,
            controlUrl: origin + "/c/" + slug + "?token=" + encodeURIComponent(controlToken),
          },
        });
      }

      if (req.method === "DELETE") {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        return Response.json({ ok: true, deleted: slug });
      }
    }

    // Public OBS Browser Source + SSE + State API
    const oMatch = url.pathname.match(/^\\/o\\/([a-z0-9-]+)(?:\\/(events|state))?$/);
    if (oMatch) {
      const slug = safeSlug(oMatch[1]);
      const sub = oMatch[2] || "";
      if (!slug) return new Response("Invalid slug", { status: 400 });
      const dir = overlayDir(slug);
      const meta = readJson(path.join(dir, "meta.json"), null);
      if (!meta) return new Response("Overlay not found", { status: 404 });

      if (!sub && req.method === "GET") {
        const rawHtml = fs.readFileSync(path.join(dir, "overlay.html"), "utf8");
        const state = readJson(path.join(dir, "state.json"), {});
        return new Response(injectOverlayClientScript(rawHtml, slug, state), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "frame-ancestors *",
          },
        });
      }

      if (sub === "state" && req.method === "GET") {
        const state = readJson(path.join(dir, "state.json"), {});
        return Response.json({ slug, state, updatedAt: meta.updatedAt }, {
          headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
        });
      }

      if (sub === "state" && req.method === "POST") {
        if (!isControlAuthorized(req, url, meta)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = (await req.json().catch(() => ({}))) as any;
        const prev = readJson(path.join(dir, "state.json"), {});
        let next = prev;
        if (body && typeof body.replace === "object" && !Array.isArray(body.replace)) {
          next = body.replace;
        } else if (body && typeof body.patch === "object" && !Array.isArray(body.patch)) {
          next = Object.assign({}, prev, body.patch);
        } else if (body && typeof body === "object" && !Array.isArray(body)) {
          next = Object.assign({}, prev, body);
        }
        atomicWrite(path.join(dir, "state.json"), JSON.stringify(next, null, 2));
        broadcast(slug, "state", next);
        return Response.json({ ok: true, state: next }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (sub === "events" && req.method === "GET") {
        const initial = readJson(path.join(dir, "state.json"), {});
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
        let pingTimer: any = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller;
            if (!sseClients.has(slug)) sseClients.set(slug, new Set());
            sseClients.get(slug)!.add(controller);
            controller.enqueue(encoder.encode("event: state\\ndata: " + JSON.stringify(initial) + "\\n\\n"));
            pingTimer = setInterval(() => {
              try { controller.enqueue(encoder.encode(": keepalive\\n\\n")); } catch {}
            }, 15000);
          },
          cancel() {
            clearInterval(pingTimer);
            if (controllerRef) sseClients.get(slug)?.delete(controllerRef);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // Remote Control Deck
    const cMatch = url.pathname.match(/^\\/c\\/([a-z0-9-]+)$/);
    if (cMatch && req.method === "GET") {
      const slug = safeSlug(cMatch[1]);
      if (!slug) return new Response("Invalid slug", { status: 400 });
      const dir = overlayDir(slug);
      const meta = readJson(path.join(dir, "meta.json"), null);
      if (!meta) return new Response("Overlay not found", { status: 404 });
      if (!isControlAuthorized(req, url, meta)) {
        return new Response("Missing or invalid remote control token.", { status: 401 });
      }
      const state = readJson(path.join(dir, "state.json"), {});
      const token = url.searchParams.get("token") || meta.controlToken;
      const customControlPath = path.join(dir, "control.html");
      const html = fs.existsSync(customControlPath)
        ? fs.readFileSync(customControlPath, "utf8")
        : buildRemoteDeckHtml(meta, state, token);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "frame-ancestors *",
        },
      });
    }

    return new Response("Otto OBS Overlay Server", { status: 200 });
  },
});

console.log("[otto-obs-overlay] listening on :" + PORT);
`;

async function flyApiFetch(
  connector: FlyConnectorInfo,
  apiPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${connector.gatewayBaseUrl}${apiPath.startsWith("/") ? apiPath : "/" + apiPath}`;
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return true;
    } catch {
      // machine waking up
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

export async function getObsOverlayMachineStatus(): Promise<{
  connectorAvailable: boolean;
  connectorName: string;
  provisioned: boolean;
  appName?: string;
  machineId?: string;
  region?: string;
  baseUrl?: string;
  machineState?: string;
}> {
  const connector = await discoverFlyMachinesConnector();
  const saved = readSavedMachineConfig();
  if (!saved) {
    return {
      connectorAvailable: Boolean(connector),
      connectorName: connector?.displayName || "Fly Machines",
      provisioned: false,
    };
  }
  let machineState = "unknown";
  if (connector) {
    try {
      const res = await flyApiFetch(
        connector,
        `/v1/apps/${encodeURIComponent(saved.appName)}/machines/${encodeURIComponent(saved.machineId)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { state?: string };
        machineState = data.state || "unknown";
      }
    } catch {
      // ignore transient errors
    }
  }
  return {
    connectorAvailable: Boolean(connector),
    connectorName: connector?.displayName || "Fly Machines",
    provisioned: true,
    appName: saved.appName,
    machineId: saved.machineId,
    region: saved.region,
    baseUrl: saved.baseUrl,
    machineState,
  };
}

export async function ensureOverlayMachine(): Promise<ObsOverlayMachineConfig> {
  const connector = await discoverFlyMachinesConnector();
  if (!connector) {
    throw new Error(
      "Fly Machines connector (https://api.machines.dev) is not authorized for this Sprite. Connect it in Sprites Dashboard first."
    );
  }

  const saved = readSavedMachineConfig();
  if (saved) {
    // Verify machine still exists; if stopped, Fly Proxy auto-starts it on /health
    const check = await flyApiFetch(
      connector,
      `/v1/apps/${encodeURIComponent(saved.appName)}/machines/${encodeURIComponent(saved.machineId)}`
    );
    if (check.ok) {
      const m = (await check.json()) as { state?: string };
      if (m.state !== "started") {
        await flyApiFetch(
          connector,
          `/v1/apps/${encodeURIComponent(saved.appName)}/machines/${encodeURIComponent(saved.machineId)}/start`,
          { method: "POST" }
        );
      }
      const healthy = await waitForHealth(saved.baseUrl, 25_000);
      if (healthy) return saved;
    }
  }

  // Provision a fresh shared Fly app + 1 GB Volume + 256 MB auto-stop Bun Machine
  const suffix = crypto.randomBytes(4).toString("hex");
  const appName = `otto-obs-${suffix}`;
  const region = (process.env.LMA_FLY_REGION || "sin").trim();
  const adminToken = crypto.randomBytes(24).toString("hex");

  const appRes = await flyApiFetch(connector, "/v1/apps", {
    method: "POST",
    body: JSON.stringify({ app_name: appName, org_slug: connector.orgSlug }),
  });
  if (!appRes.ok) {
    const errText = await appRes.text();
    throw new Error(`Failed to create Fly app '${appName}' (HTTP ${appRes.status}): ${errText}`);
  }

  // Allocate public shared IPv4 + dedicated IPv6 so https://<app>.fly.dev is immediately reachable
  const ip4Res = await flyApiFetch(connector, `/v1/apps/${encodeURIComponent(appName)}/ip_assignments`, {
    method: "POST",
    body: JSON.stringify({ type: "shared_v4" }),
  });
  if (!ip4Res.ok) {
    const errText = await ip4Res.text();
    throw new Error(`Failed to allocate shared IPv4 for '${appName}': ${errText}`);
  }
  await flyApiFetch(connector, `/v1/apps/${encodeURIComponent(appName)}/ip_assignments`, {
    method: "POST",
    body: JSON.stringify({ type: "v6" }),
  }).catch(() => {});

  // Create persistent 1 GB Fly Volume ($0.15/mo)
  const volRes = await flyApiFetch(connector, `/v1/apps/${encodeURIComponent(appName)}/volumes`, {
    method: "POST",
    body: JSON.stringify({
      name: "overlay_data",
      size_gb: 1,
      region,
    }),
  });
  if (!volRes.ok) {
    const errText = await volRes.text();
    throw new Error(`Failed to create 1 GB Fly Volume in '${region}': ${errText}`);
  }
  const volData = (await volRes.json()) as { id: string; region?: string };

  // Create 256 MB shared-cpu-1x Machine with Bun overlay server injected via config.files (zero Docker build)
  const serverBase64 = Buffer.from(FLY_OVERLAY_SERVER_TS, "utf8").toString("base64");
  const machineRes = await flyApiFetch(connector, `/v1/apps/${encodeURIComponent(appName)}/machines`, {
    method: "POST",
    body: JSON.stringify({
      name: "otto-obs-overlay-host",
      region: volData.region || region,
      config: {
        image: "oven/bun:1-alpine",
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
        mounts: [{ volume: volData.id, path: "/data" }],
        files: [{ guest_path: "/app/server.ts", raw_value: serverBase64 }],
        init: { cmd: ["bun", "run", "/app/server.ts"] },
        env: {
          PORT: "8080",
          DATA_DIR: "/data",
          ADMIN_TOKEN: adminToken,
        },
        services: [
          {
            protocol: "tcp",
            internal_port: 8080,
            autostart: true,
            autostop: "stop",
            min_machines_running: 0,
            ports: [
              { port: 80, handlers: ["http"], force_https: true },
              { port: 443, handlers: ["tls", "http"] },
            ],
          },
        ],
      },
    }),
  });
  if (!machineRes.ok) {
    const errText = await machineRes.text();
    throw new Error(`Failed to create Fly Machine: ${errText}`);
  }
  const machineData = (await machineRes.json()) as { id: string; instance_id?: string };

  // Wait for Machine to start
  await flyApiFetch(
    connector,
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineData.id)}/wait?state=started&timeout=60`
  ).catch(() => {});

  const baseUrl = `https://${appName}.fly.dev`;
  const cfg: ObsOverlayMachineConfig = {
    appName,
    machineId: machineData.id,
    volumeId: volData.id,
    region: volData.region || region,
    baseUrl,
    adminToken,
    orgSlug: connector.orgSlug,
    serverVersion: SERVER_VERSION,
    createdAt: new Date().toISOString(),
  };
  saveMachineConfig(cfg);

  const healthy = await waitForHealth(baseUrl, 30_000);
  if (!healthy) {
    throw new Error(`Fly Machine '${appName}' booted but ${baseUrl}/health did not respond in time.`);
  }
  return cfg;
}

export async function listHostedObsOverlays(): Promise<{
  status: Awaited<ReturnType<typeof getObsOverlayMachineStatus>>;
  overlays: ObsOverlaySummary[];
}> {
  const status = await getObsOverlayMachineStatus();
  const saved = readSavedMachineConfig();
  if (!saved) {
    return { status, overlays: [] };
  }
  try {
    const res = await fetch(`${saved.baseUrl}/admin/overlays`, {
      headers: { Authorization: `Bearer ${saved.adminToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status, overlays: [] };
    const data = (await res.json()) as { overlays?: ObsOverlaySummary[] };
    return { status, overlays: Array.isArray(data.overlays) ? data.overlays : [] };
  } catch {
    return { status, overlays: [] };
  }
}

export async function deployObsOverlay(input: {
  slug: string;
  title: string;
  description?: string;
  html: string;
  controlHtml?: string;
  controls?: OverlayControlField[];
  initialState?: Record<string, unknown>;
  resetState?: boolean;
}): Promise<{ machine: ObsOverlayMachineConfig; overlay: ObsOverlaySummary }> {
  const safeSlug = sanitizeOverlaySlug(input.slug);
  const machine = await ensureOverlayMachine();
  const res = await fetch(`${machine.baseUrl}/admin/overlays/${encodeURIComponent(safeSlug)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${machine.adminToken}`,
    },
    body: JSON.stringify({
      title: input.title,
      description: input.description || "",
      html: input.html,
      controlHtml: input.controlHtml,
      controls: input.controls || [],
      initialState: input.initialState || {},
      resetState: input.resetState === true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    overlay?: ObsOverlaySummary;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.overlay) {
    throw new Error(data.error || `Failed to deploy overlay '${safeSlug}' (HTTP ${res.status})`);
  }
  return { machine, overlay: data.overlay };
}

export async function updateObsOverlayState(
  slug: string,
  patch: Record<string, unknown>,
  replace = false
): Promise<{ state: Record<string, unknown> }> {
  const safeSlug = sanitizeOverlaySlug(slug);
  const saved = readSavedMachineConfig();
  if (!saved) {
    throw new Error("No OBS Overlay Fly Machine is provisioned yet.");
  }
  const res = await fetch(`${saved.baseUrl}/o/${encodeURIComponent(safeSlug)}/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${saved.adminToken}`,
    },
    body: JSON.stringify(replace ? { replace: patch } : { patch }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    state?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Failed to update overlay state (HTTP ${res.status})`);
  }
  return { state: data.state || {} };
}

export async function deleteHostedObsOverlay(slug: string): Promise<boolean> {
  const safeSlug = sanitizeOverlaySlug(slug);
  const saved = readSavedMachineConfig();
  if (!saved) return false;
  const res = await fetch(`${saved.baseUrl}/admin/overlays/${encodeURIComponent(safeSlug)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${saved.adminToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}
