/**
 * SSE stream client for isolated studio Refine endpoints (`/refine?stream=1`).
 * Feeds live thinking deltas, text deltas, and tool steps into `StudioRefineChat.vue`.
 */

import type { TraceStep } from "@/types/chat";

export interface RefineChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  steps?: TraceStep[];
}

export interface StreamRefineHandlers {
  onThinkingDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolName: string, label: string) => void;
  onToolEnd?: (toolName: string) => void;
}

export async function streamRefineRequest(
  url: string,
  body: Record<string, unknown>,
  handlers: StreamRefineHandlers
): Promise<{ reply: string }> {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errJson.error || `Refine failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return { reply: data.reply || "Updated." };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let finalReply = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const rawLine of frame.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        let ev: {
          type?: string;
          delta?: string;
          toolName?: string;
          label?: string;
          reply?: string;
          error?: string;
        };
        try {
          ev = JSON.parse(jsonStr);
        } catch {
          continue;
        }
        if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
          handlers.onThinkingDelta?.(ev.delta);
        } else if (ev.type === "text_delta" && typeof ev.delta === "string") {
          accumulatedText += ev.delta;
          handlers.onTextDelta?.(ev.delta);
        } else if (ev.type === "tool_start" && typeof ev.toolName === "string") {
          handlers.onToolStart?.(ev.toolName, ev.label || "Working...");
        } else if (ev.type === "tool_end" && typeof ev.toolName === "string") {
          handlers.onToolEnd?.(ev.toolName);
        } else if (ev.type === "error") {
          throw new Error(ev.error || "Refinement failed");
        } else if (ev.type === "done" && typeof ev.reply === "string") {
          finalReply = ev.reply;
        }
      }
    }
  }

  return { reply: (finalReply || accumulatedText).trim() || "Updated." };
}
