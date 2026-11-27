/**
 * Hybrid LLM Router: Ollama-First with Circuit-Breaker Failover to Google Gemini.
 *
 * Exposes an OpenAI-compatible `/v1/chat/completions` handler for lightweight `omp` roles
 * (`smol`, `memory`, `autorename`, `tiny`, `commit`, `widget`):
 * 1. Tries the connected zero-key Ollama Sprites Connector first (`glm-5.3-flash`).
 * 2. On HTTP 401/402/403/429/5xx or timeout, trips a 10-minute circuit breaker so
 *    subsequent turns incur 0ms retry overhead, and transparently replays the request
 *    to the native Google Gemini Sprites Connector (`gemini-3.5-flash-lite` via `v1beta`).
 * 3. If a creator or judge attaches a funded Ollama account, requests immediately run
 *    live on Ollama Cloud with zero code or config changes.
 */

import crypto from "node:crypto";
import { fetchGatewayList } from "./gateway.ts";

export const DEFAULT_OLLAMA_MODEL = process.env.LMA_OLLAMA_MODEL?.trim() || "glm-5.3-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL =
  process.env.LMA_GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash-lite";
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;

interface RouterState {
  ollamaConnected: boolean;
  ollamaBaseUrl: string | null;
  geminiBaseUrl: string | null;
  discoveredAt: number;
  circuitOpenUntil: number;
  lastFailureReason: string | null;
  lastFailureStatus: number | null;
  lastProviderUsed: "ollama" | "gemini-fallback" | "gemini" | null;
  ollamaAttempts: number;
  ollamaSuccesses: number;
  fallbackSuccesses: number;
}

const state: RouterState = {
  ollamaConnected: false,
  ollamaBaseUrl: null,
  geminiBaseUrl: null,
  discoveredAt: 0,
  circuitOpenUntil: 0,
  lastFailureReason: null,
  lastFailureStatus: null,
  lastProviderUsed: null,
  ollamaAttempts: 0,
  ollamaSuccesses: 0,
  fallbackSuccesses: 0,
};

async function ensureGateways(forceRefresh = false): Promise<void> {
  if (!forceRefresh && Date.now() - state.discoveredAt < 60_000 && (state.ollamaBaseUrl || state.geminiBaseUrl)) {
    return;
  }
  const gw = await fetchGatewayList(8_000);
  if (!gw.ok) return;

  const ollama = gw.connections.find(
    (c) => c.provider === "ollama" || /ollama/i.test(c.display_name || "")
  );
  const gemini = gw.connections.find((c) => c.provider === "gemini");

  state.ollamaConnected = Boolean(ollama?.gateway_base_url);
  state.ollamaBaseUrl = ollama?.gateway_base_url ? ollama.gateway_base_url.replace(/\/+$/, "") : null;
  state.geminiBaseUrl = gemini?.gateway_base_url ? gemini.gateway_base_url.replace(/\/+$/, "") : null;
  state.discoveredAt = Date.now();
}

export async function getLlmRouterStatus(forceRefresh = false) {
  await ensureGateways(forceRefresh);
  const now = Date.now();
  const circuitOpen = state.circuitOpenUntil > now;
  const cooldownRemainingSec = circuitOpen ? Math.ceil((state.circuitOpenUntil - now) / 1000) : 0;

  let activeProvider: "ollama" | "gemini-fallback" | "gemini" = "gemini";
  if (state.ollamaConnected) {
    activeProvider = circuitOpen ? "gemini-fallback" : "ollama";
  }

  return {
    ollamaConnected: state.ollamaConnected,
    geminiConnected: Boolean(state.geminiBaseUrl),
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    geminiFallbackModel: DEFAULT_GEMINI_FALLBACK_MODEL,
    activeProvider,
    circuitOpen,
    cooldownRemainingSec,
    lastFailureStatus: state.lastFailureStatus,
    lastFailureReason: state.lastFailureReason,
    lastProviderUsed: state.lastProviderUsed,
    stats: {
      ollamaAttempts: state.ollamaAttempts,
      ollamaSuccesses: state.ollamaSuccesses,
      fallbackSuccesses: state.fallbackSuccesses,
    },
  };
}

export async function probeOllamaNow() {
  state.circuitOpenUntil = 0;
  await ensureGateways(true);
  if (!state.ollamaBaseUrl) {
    state.lastFailureStatus = null;
    state.lastFailureReason = "Ollama connector not connected";
    return { ok: false, status: await getLlmRouterStatus(false) };
  }

  state.ollamaAttempts += 1;
  try {
    const res = await fetch(`${state.ollamaBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_OLLAMA_MODEL,
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      state.ollamaSuccesses += 1;
      state.lastFailureStatus = null;
      state.lastFailureReason = null;
      state.lastProviderUsed = "ollama";
      return { ok: true, status: await getLlmRouterStatus(false) };
    }
    const errText = await res.text().catch(() => "");
    tripCircuit(res.status, extractErrorMessage(errText, `HTTP ${res.status}`));
    return { ok: false, status: await getLlmRouterStatus(false) };
  } catch (err) {
    tripCircuit(null, err instanceof Error ? err.message : String(err));
    return { ok: false, status: await getLlmRouterStatus(false) };
  }
}

function tripCircuit(status: number | null, reason: string): void {
  state.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  state.lastFailureStatus = status;
  state.lastFailureReason = reason.slice(0, 180);
  console.log(
    `[llm-router] Ollama unavailable (${status ?? "network"}: ${state.lastFailureReason}) -> circuit open 10m, falling back to Gemini (${DEFAULT_GEMINI_FALLBACK_MODEL})`
  );
}

function extractErrorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // plain text
  }
  return raw.trim().slice(0, 180) || fallback;
}

interface OpenAiMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

function messageText(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function callGeminiFallback(body: {
  messages?: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
}): Promise<Response> {
  if (!state.geminiBaseUrl) {
    return Response.json(
      { error: { message: "Neither Ollama nor Google Gemini connector is available.", type: "api_error" } },
      { status: 503 }
    );
  }

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: Array<{ text: string }> = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const m of msgs) {
    const text = messageText(m.content);
    if (!text) continue;
    if (m.role === "system" || m.role === "developer") {
      systemParts.push({ text });
    } else if (m.role === "assistant") {
      contents.push({ role: "model", parts: [{ text }] });
    } else {
      contents.push({ role: "user", parts: [{ text }] });
    }
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (typeof maxTokens === "number" && maxTokens > 0) generationConfig.maxOutputTokens = maxTokens;

  const geminiPayload: Record<string, unknown> = { contents };
  if (systemParts.length > 0) {
    geminiPayload.systemInstruction = { parts: systemParts };
  }
  if (Object.keys(generationConfig).length > 0) {
    geminiPayload.generationConfig = generationConfig;
  }

  const geminiRes = await fetch(
    `${state.geminiBaseUrl}/v1beta/models/${encodeURIComponent(DEFAULT_GEMINI_FALLBACK_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text().catch(() => "");
    return Response.json(
      {
        error: {
          message: `Gemini fallback failed (${geminiRes.status}): ${extractErrorMessage(errText, "upstream error")}`,
          type: "api_error",
        },
      },
      { status: geminiRes.status }
    );
  }

  const data = (await geminiRes.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens = data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;
  const id = `chatcmpl-${crypto.randomBytes(10).toString("hex")}`;
  const created = Math.floor(Date.now() / 1000);

  state.fallbackSuccesses += 1;
  state.lastProviderUsed = state.ollamaConnected ? "gemini-fallback" : "gemini";

  if (body.stream) {
    const chunk1 = {
      id,
      object: "chat.completion.chunk",
      created,
      model: DEFAULT_GEMINI_FALLBACK_MODEL,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    };
    const chunk2 = {
      id,
      object: "chat.completion.chunk",
      created,
      model: DEFAULT_GEMINI_FALLBACK_MODEL,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
    const sse = `data: ${JSON.stringify(chunk1)}\n\ndata: ${JSON.stringify(chunk2)}\n\ndata: [DONE]\n\n`;
    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Otto-LLM-Provider": state.lastProviderUsed,
      },
    });
  }

  return Response.json(
    {
      id,
      object: "chat.completion",
      created,
      model: DEFAULT_GEMINI_FALLBACK_MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    },
    {
      headers: {
        "X-Otto-LLM-Provider": state.lastProviderUsed,
      },
    }
  );
}

export async function handleHybridChatCompletions(req: Request): Promise<Response> {
  await ensureGateways();
  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    messages?: OpenAiMessage[];
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    stream?: boolean;
  };

  // 1. Try Ollama primary when connected and circuit breaker is closed
  if (state.ollamaBaseUrl && Date.now() >= state.circuitOpenUntil) {
    state.ollamaAttempts += 1;
    try {
      const ollamaBody = {
        ...body,
        model: DEFAULT_OLLAMA_MODEL,
      };
      const ollamaRes = await fetch(`${state.ollamaBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaBody),
        signal: AbortSignal.timeout(20_000),
      });

      if (ollamaRes.ok) {
        state.ollamaSuccesses += 1;
        state.lastFailureStatus = null;
        state.lastFailureReason = null;
        state.lastProviderUsed = "ollama";
        const headers = new Headers(ollamaRes.headers);
        headers.set("X-Otto-LLM-Provider", "ollama");
        return new Response(ollamaRes.body, { status: ollamaRes.status, headers });
      }

      const errText = await ollamaRes.text().catch(() => "");
      if (
        ollamaRes.status === 401 ||
        ollamaRes.status === 402 ||
        ollamaRes.status === 403 ||
        ollamaRes.status === 429 ||
        ollamaRes.status >= 500
      ) {
        tripCircuit(ollamaRes.status, extractErrorMessage(errText, `HTTP ${ollamaRes.status}`));
      }
    } catch (err) {
      tripCircuit(null, err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Transparent failover to native Google Gemini v1beta
  return callGeminiFallback(body);
}
