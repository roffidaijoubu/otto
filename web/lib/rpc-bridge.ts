import fs from "node:fs";
import path from "node:path";
import { OMP_BIN, WORK_DIR } from "./config.ts";
import { broadcast } from "./sse.ts";
import { buildAgentChildEnv } from "./child-env.ts";
import { isClipWorkerBusy } from "./clip-worker.ts";
import { hasActiveManagedWorkers } from "./rpc-worker.ts";

export interface TodoPhase {
  name: string;
  tasks: Array<{ content: string; status: string }>;
}

export interface RpcEvent {
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

export interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}

export function friendlyToolLabel(toolName: string): string {
  if (/youtube/i.test(toolName)) return "Checking YouTube...";
  if (/buffer/i.test(toolName)) return "Checking social channels...";
  if (/wakeup|schedule|calendar/i.test(toolName)) return "Managing schedule...";
  if (/^todo/i.test(toolName)) return "Updating checklist...";
  if (/studio_job_dispatch/i.test(toolName)) return "Dispatching background job...";
  if (/studio_job_nudge/i.test(toolName)) return "Steering background worker...";
  if (/studio_job/i.test(toolName)) return "Checking background jobs...";
  if (/^studio_/i.test(toolName)) return "Updating studio database...";
  if (/vod_scan_hype/i.test(toolName)) return "Scanning VOD live chat & hype spikes...";
  if (/vod_cut_clip/i.test(toolName)) return "Cutting raw clip (.mp4 + .srt)...";
  if (/vod_prep_clip/i.test(toolName)) return "Normalizing clip for editor (CFR + -14 LUFS)...";
  if (/watch_clip/i.test(toolName)) return "Watching clip for visual & pacing critique...";
  if (/thumbnail_render/i.test(toolName)) return "Rendering 1280×720 thumbnail for visual check...";
  if (/thumbnail_save/i.test(toolName)) return "Saving thumbnail layout...";
  if (/thumbnail_get|thumbnail_list/i.test(toolName)) return "Reading current thumbnail...";
  if (/obs_overlay_deploy/i.test(toolName)) return "Deploying OBS overlay...";
  if (/obs_overlay_control/i.test(toolName)) return "Updating overlay state...";
  if (/obs_overlay_/i.test(toolName)) return "Checking OBS overlays...";
  if (/pixabay/i.test(toolName)) return "Fetching Pixabay photography...";
  if (/critique_thumbnail/i.test(toolName)) return "Inspecting thumbnail...";
  if (/^box_/i.test(toolName)) return "Syncing files with Box...";
  if (/exa|firecrawl|web_search/i.test(toolName)) return "Researching...";
  if (/edit|write/i.test(toolName)) return "Updating workspace files...";
  if (/read/i.test(toolName)) return "Reviewing dossier & files...";
  if (/bash/i.test(toolName)) return "Running workspace tools...";
  return "Working on it...";
}

export function stripHiddenTags(text: string): string {
  return text.replace(/<hidden>[\s\S]*?<\/hidden>/gi, "").trim();
}

export function normalizeTodoPhases(raw: unknown): TodoPhase[] {
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

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; text?: string } => Boolean(p && typeof p === "object"))
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("");
}

export function extractThinkingContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; thinking?: string } => Boolean(p && typeof p === "object"))
    .filter((p) => p.type === "thinking" && typeof p.thinking === "string")
    .map((p) => p.thinking!)
    .join("\n\n");
}

export function summarizeSessionFile(filePath: string, activePath: string | null): SessionSummary | null {
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

export class OmpRpcBridge {
  private proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private ready = false;
  private readyResolvers: Array<() => void> = [];
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private holdHeartbeat: NodeJS.Timeout | null = null;
  private holdStartedAt = 0;
  private inFlightWatchdog: NodeJS.Timeout | null = null;
  private inFlightWatchdogMs = 0;
  private static readonly MAX_HOLD_MS = 30 * 60 * 1000;
  public busy = false;
  public activity = "Thinking...";
  public todos: TodoPhase[] = [];
  private activeBackgroundJobs = new Set<string>();
  private bgJobSeq = 0;
  private holdOpChain: Promise<void> = Promise.resolve();
  private lastHoldOk: boolean | null = null;
  private lastHoldError: string | null = null;
  private lastHoldAt: string | null = null;

  constructor(opts: { autoSpawn?: boolean } = {}) {
    if (opts.autoSpawn !== false) {
      this.spawn();
    }
  }

  private enqueueHoldOp(fn: () => Promise<void>): Promise<void> {
    const next = this.holdOpChain.then(fn, fn);
    this.holdOpChain = next.catch(() => {});
    return next;
  }

  private async putSpriteHold(): Promise<void> {
    if (!fs.existsSync("/.sprite/api.sock")) return;
    await this.enqueueHoldOp(async () => {
      try {
        const res = await fetch("http://sprite/v1/tasks/lma-agent-turn", {
          unix: "/.sprite/api.sock",
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expire: "10m" }),
        });
        this.lastHoldAt = new Date().toISOString();
        if (!res.ok) {
          const msg = `PUT /v1/tasks/lma-agent-turn returned ${res.status}`;
          this.lastHoldOk = false;
          this.lastHoldError = msg;
          console.warn(`[lma-web] Sprite hold failed: ${msg}`);
        } else {
          this.lastHoldOk = true;
          this.lastHoldError = null;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastHoldAt = new Date().toISOString();
        this.lastHoldOk = false;
        this.lastHoldError = msg;
        console.warn(`[lma-web] Sprite hold error: ${msg}`);
      }
    });
  }

  public beginBackgroundJob(label = "bg"): () => void {
    const token = `${label}:${++this.bgJobSeq}`;
    this.activeBackgroundJobs.add(token);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeBackgroundJobs.delete(token);
      this.releaseSpriteHold();
    };
  }

  public get backgroundBusy(): boolean {
    return this.activeBackgroundJobs.size > 0;
  }

  public get activeBackgroundJobCount(): number {
    return this.activeBackgroundJobs.size;
  }

  public getHoldHealth(): {
    active: boolean;
    lastOk: boolean | null;
    lastError: string | null;
    lastAt: string | null;
  } {
    return {
      active: this.holdStartedAt > 0,
      lastOk: this.lastHoldOk,
      lastError: this.lastHoldError,
      lastAt: this.lastHoldAt,
    };
  }

  public isAnyBusy(): boolean {
    return this.busy || this.backgroundBusy || isClipWorkerBusy() || hasActiveManagedWorkers();
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
    void this.enqueueHoldOp(async () => {
      try {
        const res = await fetch("http://sprite/v1/tasks/lma-agent-turn", {
          unix: "/.sprite/api.sock",
          method: "DELETE",
        });
        this.lastHoldAt = new Date().toISOString();
        if (!res.ok && res.status !== 404) {
          const msg = `DELETE /v1/tasks/lma-agent-turn returned ${res.status}`;
          this.lastHoldOk = false;
          this.lastHoldError = msg;
          console.warn(`[lma-web] Sprite hold release failed: ${msg}`);
        } else {
          this.lastHoldOk = true;
          this.lastHoldError = null;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastHoldAt = new Date().toISOString();
        this.lastHoldOk = false;
        this.lastHoldError = msg;
        console.warn(`[lma-web] Sprite hold release error: ${msg}`);
      }
    });
  }
  private clearInFlightWatchdog() {
    if (this.inFlightWatchdog) {
      clearTimeout(this.inFlightWatchdog);
      this.inFlightWatchdog = null;
    }
    this.inFlightWatchdogMs = 0;
  }

  private armInFlightWatchdog(ms = OmpRpcBridge.MAX_HOLD_MS) {
    if (this.inFlightWatchdog) {
      clearTimeout(this.inFlightWatchdog);
      this.inFlightWatchdog = null;
    }
    this.inFlightWatchdogMs = ms;
    this.inFlightWatchdog = setTimeout(() => {
      this.inFlightWatchdog = null;
      this.inFlightWatchdogMs = 0;
      if (!this.busy) return;
      console.warn("[lma-web] In-flight RPC turn watchdog expired without agent_end; clearing busy flag.");
      this.busy = false;
      this.activity = "Thinking...";
      this.releaseSpriteHold();
      broadcast({
        type: "error",
        message: "Assistant turn timed out without completing; ready for next message.",
      });
      broadcast({ type: "done" });
    }, ms);
    this.inFlightWatchdog.unref?.();
  }

  private touchInFlightWatchdog() {
    if (this.inFlightWatchdog && this.inFlightWatchdogMs > 0) {
      this.armInFlightWatchdog(this.inFlightWatchdogMs);
    }
  }

  private spawn() {
    this.ready = false;
    const childEnv = buildAgentChildEnv();
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
      this.clearInFlightWatchdog();
      this.releaseSpriteHold();
      for (const [, p] of this.pending) {
        if (p.timer) clearTimeout(p.timer);
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
      if (p.timer) clearTimeout(p.timer);
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
      this.touchInFlightWatchdog();
      this.activity = friendlyToolLabel(String(ev.toolName || ""));
      broadcast({ type: "tool_start", label: this.activity });
      return;
    }

    if (ev.type === "tool_execution_end") {
      this.touchInFlightWatchdog();
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
      this.touchInFlightWatchdog();
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
      this.clearInFlightWatchdog();
      this.activity = "Thinking...";
      this.releaseSpriteHold();
      broadcast({ type: "done" });
      return;
    }
  }

  private async waitReady() {
    if (this.ready) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const resolver = () => done(resolve);
    this.readyResolvers.push(resolver);
    const timer = setTimeout(() => {
      const idx = this.readyResolvers.indexOf(resolver);
      if (idx !== -1) this.readyResolvers.splice(idx, 1);
      if (this.ready || (this.proc && this.proc.exitCode === null)) {
        this.ready = true;
        done(resolve);
      } else {
        done(() => reject(new Error("Main RPC worker failed to become ready in time")));
      }
    }, 10_000);
    await promise;
  }

  async sendCommand(
    type: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<unknown> {
    await this.waitReady();
    if (!this.proc?.stdin) throw new Error("RPC stdin unavailable");
    const id = `req-${++this.reqCounter}`;
    const line = JSON.stringify({ id, type, ...extra }) + "\n";
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        reject(new Error(`RPC command ${type} timed out`));
      }
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timer });
    this.proc.stdin.write(line);
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

  async prompt(
    message: string,
    opts: { lockAlreadyHeld?: boolean; ackTimeoutMs?: number; watchdogMs?: number } = {}
  ): Promise<{ accepted: true; inFlight?: boolean }> {
    if (!opts.lockAlreadyHeld) {
      if (this.busy) {
        throw new Error("Otto is still responding. Wait or click Stop.");
      }
      this.busy = true;
    }
    this.activity = "Thinking...";
    void this.holdSpriteActive();
    broadcast({ type: "user_message", text: stripHiddenTags(message) });
    broadcast({ type: "activity", label: this.activity });
    try {
      await this.sendCommand("prompt", { message }, opts.ackTimeoutMs ?? 30_000);
      return { accepted: true };
    } catch (err) {
      const isTimeout = err instanceof Error && /timed out/i.test(err.message);
      const procAlive = this.proc ? this.proc.exitCode === null : false;
      if (isTimeout && procAlive) {
        // Long multi-tool turns (e.g. VOD clipping) can exceed the initial RPC ack window while
        // still streaming normally over SSE; keep busy + Sprite hold active and arm a silent-hang watchdog.
        console.warn("[lma-web] prompt RPC ack window elapsed while turn is still active; continuing via SSE");
        this.armInFlightWatchdog(opts.watchdogMs ?? OmpRpcBridge.MAX_HOLD_MS);
        return { accepted: true, inFlight: true };
      }
      this.busy = false;
      this.clearInFlightWatchdog();
      this.releaseSpriteHold();
      throw err;
    }
  }

  async abort() {
    await this.sendCommand("abort").catch(() => {});
    this.busy = false;
    this.clearInFlightWatchdog();
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

export const rpc = new OmpRpcBridge({
  autoSpawn: process.env.LMA_DISABLE_AUTO_SPAWN !== "1",
});
