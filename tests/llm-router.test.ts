import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const {
  handleHybridChatCompletions,
  getLlmRouterStatus,
  probeOllamaNow,
  resetLlmRouterState,
} = await import("../web/lib/llm-router.ts");

const GATEWAY_FIXTURE = {
  connections: [
    {
      provider: "ollama",
      display_name: "Ollama Cloud",
      gateway_base_url: "https://api.sprites.dev/v1/gateway/ollama/conn_ollama_1",
    },
    {
      provider: "gemini",
      display_name: "Google Gemini",
      gateway_base_url: "https://api.sprites.dev/v1/gateway/gemini/conn_gemini_1",
    },
  ],
};

describe("Hybrid LLM Router (Ollama-first + 10m circuit breaker -> Gemini v1beta failover)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetLlmRouterState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetLlmRouterState();
  });

  it("routes to Ollama primary with zero Authorization headers when healthy", async () => {
    const calls: Array<{ url: string; headers?: RequestInit["headers"] }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, headers: init?.headers });
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json(GATEWAY_FIXTURE);
      }
      if (url.startsWith("https://api.sprites.dev/v1/gateway/ollama/")) {
        return Response.json({
          id: "chatcmpl-ollama-1",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "OK from Ollama" }, finish_reason: "stop" }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const req = new Request("http://127.0.0.1:8080/api/internal/llm/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "ollama-auto", messages: [{ role: "user", content: "Ping" }] }),
    });
    const res = await handleHybridChatCompletions(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-otto-llm-provider"), "ollama");
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    assert.equal(json.choices[0].message.content, "OK from Ollama");

    // Verify zero Authorization headers sent to Sprites Gateway
    for (const c of calls) {
      const h = new Headers(c.headers);
      assert.equal(h.get("authorization"), null);
    }

    const status = await getLlmRouterStatus(false);
    assert.equal(status.activeProvider, "ollama");
    assert.equal(status.circuitOpen, false);
    assert.equal(status.stats.ollamaSuccesses, 1);
  });

  it("trips 10-minute circuit breaker on Ollama HTTP 402 and translates request to Gemini v1beta", async () => {
    let ollamaHits = 0;
    let capturedGeminiBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.sprites.dev/v1/gateway/list") {
        return Response.json(GATEWAY_FIXTURE);
      }
      if (url.startsWith("https://api.sprites.dev/v1/gateway/ollama/")) {
        ollamaHits += 1;
        return new Response(JSON.stringify({ error: { message: "Payment Required" } }), { status: 402 });
      }
      if (url.includes(":generateContent")) {
        capturedGeminiBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return Response.json({
          candidates: [{ content: { parts: [{ text: "Fallback reply from Gemini" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const req1 = new Request("http://127.0.0.1:8080/api/internal/llm/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "ollama-auto",
        temperature: 0.2,
        max_tokens: 128,
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Summarize" },
          { role: "assistant", content: "Ready" },
          { role: "user", content: "Go" },
        ],
      }),
    });
    const res1 = await handleHybridChatCompletions(req1);
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get("x-otto-llm-provider"), "gemini-fallback");
    const json1 = (await res1.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number };
    };
    assert.equal(json1.choices[0].message.content, "Fallback reply from Gemini");
    assert.equal(json1.usage.total_tokens, 17);
    assert.equal(ollamaHits, 1);

    // Verify OpenAI -> Gemini v1beta systemInstruction & role translation
    const gemBody = capturedGeminiBody as Record<string, unknown> | null;
    assert.ok(gemBody);
    assert.deepEqual(gemBody.systemInstruction, { parts: [{ text: "You are concise." }] });
    assert.deepEqual(gemBody.generationConfig, { temperature: 0.2, maxOutputTokens: 128 });
    const contents = gemBody.contents as Array<{ role: string }>;
    assert.deepEqual(
      contents.map((c) => c.role),
      ["user", "model", "user"]
    );

    // Second request during open circuit must skip Ollama completely (0ms retry overhead)
    const req2 = new Request("http://127.0.0.1:8080/api/internal/llm/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "ollama-auto", stream: true, messages: [{ role: "user", content: "Stream" }] }),
    });
    const res2 = await handleHybridChatCompletions(req2);
    assert.equal(res2.status, 200);
    assert.equal(res2.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const sseText = await res2.text();
    assert.match(sseText, /Fallback reply from Gemini/);
    assert.match(sseText, /data: \[DONE\]/);
    assert.equal(ollamaHits, 1);

    const status = await getLlmRouterStatus(false);
    assert.equal(status.circuitOpen, true);
    assert.equal(status.activeProvider, "gemini-fallback");
    assert.equal(status.lastFailureStatus, 402);
    assert.equal(status.stats.fallbackSuccesses, 2);
  });

  it("probeOllamaNow closes the circuit when Ollama recovers and returns 503 when no providers exist", async () => {
    let ollamaHealthy = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.sprites.dev/v1/gateway/list") return Response.json(GATEWAY_FIXTURE);
      if (url.startsWith("https://api.sprites.dev/v1/gateway/ollama/")) {
        return ollamaHealthy
          ? Response.json({ choices: [{ message: { content: "OK" } }] })
          : new Response("quota", { status: 429 });
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    }) as typeof fetch;

    const failedProbe = await probeOllamaNow();
    assert.equal(failedProbe.ok, false);
    assert.equal(failedProbe.status.circuitOpen, true);

    ollamaHealthy = true;
    const recoveredProbe = await probeOllamaNow();
    assert.equal(recoveredProbe.ok, true);
    assert.equal(recoveredProbe.status.circuitOpen, false);
    assert.equal(recoveredProbe.status.activeProvider, "ollama");

    // Empty connector list -> HTTP 503
    resetLlmRouterState();
    globalThis.fetch = (async () => Response.json({ connections: [] })) as unknown as typeof fetch;
    const res503 = await handleHybridChatCompletions(
      new Request("http://127.0.0.1:8080/api/internal/llm/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      })
    );
    assert.equal(res503.status, 503);
  });
});
