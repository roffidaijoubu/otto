import path from "node:path";

const PORT = Number(process.env.PORT || 8080);
const WEB_DIR = import.meta.dir;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      broadcast({ type: "activity", label: this.activity });
      return;
    }

    if (ev.type === "message_start" && ev.message?.role === "assistant") {
      broadcast({ type: "assistant_start" });
      return;
    }

    if (ev.type === "message_update") {
      const ame = ev.assistantMessageEvent;
      if (ame?.type === "text_delta" && typeof ame.delta === "string") {
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

  async getMessages(): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
    const data = await this.sendCommand("get_messages");
    const raw =
      data && typeof data === "object" && "messages" in data && Array.isArray(data.messages)
        ? data.messages
        : [];
    const out: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const role = "role" in item ? item.role : undefined;
      if (role !== "user" && role !== "assistant") continue;
      const text = extractTextContent("content" in item ? item.content : undefined).trim();
      if (!text) continue;
      out.push({ role, text });
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
    broadcast({ type: "reset" });
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

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(Bun.file(path.join(WEB_DIR, "index.html")), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "GET" && url.pathname === "/tokens.css") {
      return new Response(Bun.file(path.join(WEB_DIR, "tokens.css")), {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
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

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[lma-web] Professor L Web Chat UI listening on http://0.0.0.0:${PORT}`);
