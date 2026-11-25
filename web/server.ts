import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

const WEB_PASSWORD = process.env.LMA_WEB_PASSWORD || "";
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

function isAuthenticated(req: Request): boolean {
  // Fail-closed: never expose the agent without LMA_WEB_PASSWORD configured in ~/.config/lma/web.env
  if (!WEB_PASSWORD) return false;
  const cookieHeader = req.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rest] = part.trim().split("=");
    if (rawK === AUTH_COOKIE_NAME) {
      const val = rest.join("=");
      return timingSafeStrEqual(val, computeSessionToken(WEB_PASSWORD));
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
  <title>Professor L — Sign In</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; background: #fdf6ec; color: #3e2723;
      font-family: "Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid; place-items: center; padding: 16px;
    }
    .card {
      width: min(92vw, 380px); padding: 28px; background: #ffffff;
      border-radius: 16px; box-shadow: 6px 6px 12px #d5c9b8, -6px -6px 12px #ffffff;
    }
    .avatar {
      width: 40px; height: 40px; border-radius: 9999px; background: #8b5e3c; color: #ffffff;
      display: grid; place-items: center; font-family: "DM Serif Display", Georgia, serif;
      font-size: 20px; margin-bottom: 14px; box-shadow: 3px 3px 7px #d5c9b8, -3px -3px 7px #ffffff;
    }
    h1 {
      margin: 0 0 6px 0; font-family: "DM Serif Display", Georgia, serif;
      font-weight: 400; font-size: 26px; color: #3e2723;
    }
    p { margin: 0 0 18px 0; font-size: 13.5px; color: #6d4c41; line-height: 1.5; }
    input {
      width: 100%; padding: 11px 14px; border: none; border-radius: 12px;
      background: #f0e6d6; box-shadow: inset 4px 4px 8px #d5c9b8, inset -4px -4px 8px #ffffff;
      color: #3e2723; font-family: "Work Sans", sans-serif; font-size: 14px;
      margin-bottom: 14px; outline: none;
    }
    input:focus { box-shadow: inset 4px 4px 8px #d5c9b8, inset -4px -4px 8px #ffffff, 0 0 0 3px rgba(139,94,60,0.25); }
    button {
      width: 100%; padding: 11px 16px; border: none; border-radius: 12px; background: #8b5e3c;
      color: #ffffff; font-family: "Work Sans", sans-serif; font-size: 14px; font-weight: 600;
      cursor: pointer; box-shadow: 3px 3px 7px #d5c9b8, -3px -3px 7px #ffffff;
    }
    button:hover { background: #6b4226; }
    .err { color: #ef4444; font-family: "IBM Plex Mono", monospace; font-size: 12px; margin-top: 10px; }
  </style>
</head>
<body>
  <form class="card" id="f">
    <div class="avatar">L</div>
    <h1>Professor L</h1>
    <p>Enter your passcode to open this private talent studio.</p>
    <input type="password" id="pw" placeholder="Passcode" autocomplete="current-password" autofocus required />
    <button type="submit">Unlock Studio</button>
    <div class="err" id="err"></div>
  </form>
  <script>
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

interface RpcEvent {
  type?: string;
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
  toolName?: string;
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
  if (/wakeup|schedule/i.test(toolName)) return "Managing schedule...";
  if (/vod_scan_hype/i.test(toolName)) return "Scanning VOD live chat & hype spikes...";
  if (/vod_cut_clip/i.test(toolName)) return "Cutting raw clip (.mp4 + .srt)...";
  if (/vod_prep_clip/i.test(toolName)) return "Normalizing clip for editor (CFR + -14 LUFS)...";
  if (/watch_clip/i.test(toolName)) return "Watching clip for visual & pacing critique...";
  if (/critique_thumbnail/i.test(toolName)) return "Inspecting thumbnail (Squint Test)...";
  if (/exa|firecrawl|web_search/i.test(toolName)) return "Researching...";
  if (/edit|write/i.test(toolName)) return "Updating your notes...";
  if (/read/i.test(toolName)) return "Reviewing dossier...";
  if (/bash/i.test(toolName)) return "Running workspace tools...";
  return "Working on it...";
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
          const text = extractTextContent(msg.content).trim();
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

  public async holdSpriteActive(): Promise<void> {
    if (!this.holdStartedAt) this.holdStartedAt = Date.now();
    await this.putSpriteHold();
    if (!this.holdHeartbeat && fs.existsSync("/.sprite/api.sock")) {
      // Refresh 10m TTL every 5 minutes during long multi-tool / ffmpeg turns,
      // capped at MAX_HOLD_MS (30m) so a hung turn can never renew indefinitely.
      this.holdHeartbeat = setInterval(() => {
        if (!this.busy) return;
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

  private releaseSpriteHold() {
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
    const childEnv: Record<string, string | undefined> = { ...process.env };
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
      broadcast({ type: "status", busy: this.busy, activity: this.activity });
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
      const text = extractTextContent(content).trim();
      if (!text) continue;
      const thinking = role === "assistant" ? extractThinkingContent(content).trim() : "";
      out.push(thinking ? { role, text, thinking } : { role, text });
    }
    return out;
  }

  async prompt(message: string) {
    if (this.busy) {
      throw new Error("Professor L is still responding. Wait or click Stop.");
    }
    this.busy = true;
    this.activity = "Thinking...";
    this.holdSpriteActive();
    broadcast({ type: "user_message", text: message });
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
    broadcast({ type: "session_changed" });
  }
}

const rpc = new OmpRpcBridge();

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
      if (!WEB_PASSWORD) {
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
      if (!timingSafeStrEqual(pw, WEB_PASSWORD)) {
        recordLoginFailure(clientKey);
        return Response.json({ error: "Invalid passcode" }, { status: 401 });
      }
      loginFailures.delete(clientKey);
      const token = computeSessionToken(WEB_PASSWORD);
      const isHttps =
        url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
      const secureAttr = isHttps ? "; Secure" : "";
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureAttr}`,
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
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      if (!prompt) {
        return Response.json({ error: "Missing prompt" }, { status: 400 });
      }
      if (rpc.busy) {
        return Response.json(
          { error: "Agent busy; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
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
        return Response.json(
          { error: "Failed to dispatch wake-up; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }
      return Response.json({ ok: true, label });
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
              `data: ${JSON.stringify({ type: "status", busy: rpc.busy, activity: rpc.activity })}\n\n`
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
        return Response.json({ messages, busy: rpc.busy, activity: rpc.activity });
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

    if (req.method === "GET" && url.pathname === "/api/clips") {
      const home = process.env.HOME || "/home/sprite";
      const clipsRoot = path.join(home, "clips");
      if (!fs.existsSync(clipsRoot)) {
        return Response.json({ clips: [] });
      }
      const clips: Array<{
        videoId: string;
        name: string;
        filename: string;
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
      const home = process.env.HOME || "/home/sprite";
      const clipsRoot = path.resolve(home, "clips");
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

console.log(`[lma-web] Professor L Web Chat UI listening on http://0.0.0.0:${PORT}`);
