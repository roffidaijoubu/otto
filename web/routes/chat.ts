import { sseClients, encoder, type SSEClient } from "../lib/sse.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleChatRoutes(req: Request, url: URL): Promise<Response | null> {
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

  return null;
}
