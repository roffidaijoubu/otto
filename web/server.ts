import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 8080);
const DIST_DIR = path.join(import.meta.dir, "dist");
const WORK_DIR = process.env.LMA_WORKDIR || process.env.HOME || "/home/sprite";
const OMP_BIN = process.env.OMP_BIN || "omp";

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
  public busy = false;
  public activity = "Thinking...";

  constructor() {
    this.spawn();
  }

  private spawn() {
    this.ready = false;
    this.proc = Bun.spawn([OMP_BIN, "--mode", "rpc", "--no-ui"], {
      cwd: WORK_DIR,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    this.readStdout(this.proc.stdout);
    this.readStderr(this.proc.stderr);

    this.proc.exited.then((code) => {
      console.error(`[lma-web] omp rpc exited with code ${code}; restarting in 1s...`);
      this.ready = false;
      this.busy = false;
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
    broadcast({ type: "user_message", text: message });
    broadcast({ type: "activity", label: this.activity });
    try {
      await this.sendCommand("prompt", { message });
    } catch (err) {
      this.busy = false;
      throw err;
    }
  }

  async abort() {
    await this.sendCommand("abort").catch(() => {});
    this.busy = false;
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
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true, busy: rpc.busy });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      let ctrlRef: SSEClient | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrlRef = ctrl;
          sseClients.add(ctrl);
          ctrl.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "status", busy: rpc.busy, activity: rpc.activity })}\n\n`
            )
          );
        },
        cancel() {
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
