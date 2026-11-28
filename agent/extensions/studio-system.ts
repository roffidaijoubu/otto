import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function callInternal<T = Record<string, unknown>>(
  endpoint: string,
  opts: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
): Promise<T> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) {
    throw new Error("LMA_INTERNAL_SECRET is unavailable — requires the lma-web supervisor.");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(opts.body);
  }
  const res = await fetch(`${getInternalBaseUrl()}${endpoint}`, {
    method: opts.method ?? "GET",
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) {
    throw new Error(
      (typeof data.error === "string" && data.error) ||
        `Internal system API ${endpoint} failed (HTTP ${res.status})`
    );
  }
  return data as T;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "system_diagnostics",
    label: "Check Studio System Diagnostics",
    description:
      "Inspect connected Sprites Connectors (YouTube, Box, Buffer, Pinecone, Neon, QStash, etc.), runtime security guardrails, and the Hybrid LLM Router status (Ollama primary vs Gemini circuit-breaker fallback). Set probeOllama=true to actively test Ollama reachability.",
    parameters: Type.Object({
      probeOllama: Type.Optional(
        Type.Boolean({ description: "If true, actively probe the Ollama endpoint to refresh circuit-breaker health." })
      ),
    }),
    async execute(_id, params) {
      if (params.probeOllama) {
        await callInternal("/api/internal/system/probe-ollama", { method: "POST" }).catch(() => {});
      }
      const data = await callInternal("/api/internal/system/status?refresh=1");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "checkpoint_list",
    label: "List Sprite Time-Travel Checkpoints",
    description:
      "List available Fly.io Sprite snapshots/checkpoints and check whether daily automatic QStash snapshots are enabled.",
    parameters: Type.Object({}),
    async execute() {
      const data = await callInternal("/api/internal/checkpoints");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "checkpoint_create",
    label: "Create Sprite Safety Checkpoint",
    description:
      "Create a named Fly.io Sprite snapshot/checkpoint (e.g. before a major workspace reorganization or risky experiment).",
    parameters: Type.Object({
      comment: Type.String({ description: "Short descriptive label for this checkpoint." }),
    }),
    async execute(_id, params) {
      const data = await callInternal("/api/internal/checkpoints", {
        method: "POST",
        body: { comment: params.comment },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "checkpoint_auto_config",
    label: "Configure Daily Auto-Snapshot",
    description:
      "Enable or disable automatic daily Sprite safety snapshots via QStash.",
    parameters: Type.Object({
      enabled: Type.Boolean({ description: "True to enable daily auto-snapshots, false to disable." }),
      timezone: Type.Optional(Type.String({ description: "Optional IANA timezone (defaults to creator's studio timezone)." })),
    }),
    async execute(_id, params) {
      const data = await callInternal("/api/internal/checkpoints/auto-config", {
        method: "POST",
        body: { enabled: params.enabled, timezone: params.timezone },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });
}
