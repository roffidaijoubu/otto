import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

let cachedGatewayUrl: string | null = null;

function readWebEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const home = process.env.HOME || "/home/sprite";
  const envFile = path.join(home, ".config", "lma", "web.env");
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) {
      return m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  }
  return undefined;
}

async function getQStashGatewayUrl(): Promise<string> {
  if (cachedGatewayUrl) return cachedGatewayUrl;
  const fromEnv = readWebEnvValue("SPRITES_QSTASH_GATEWAY_URL");
  if (fromEnv) {
    cachedGatewayUrl = fromEnv.replace(/\/$/, "");
    return cachedGatewayUrl;
  }
  const res = await fetch("https://api.sprites.dev/v1/gateway/list");
  if (!res.ok) {
    throw new Error(`Failed to query Sprites gateway/list (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{
      provider: string;
      display_name?: string;
      gateway_base_url: string;
    }>;
  };
  const conn = data.connections?.find(
    (c) =>
      c.provider === "qstash" ||
      (c.provider === "custom_api" && /qstash/i.test(c.display_name ?? ""))
  );
  if (!conn) {
    throw new Error(
      "No authorized QStash Sprites Connector found. Add a Custom API connector named 'QStash' (see docs/qstash-scheduler-setup.md)."
    );
  }
  cachedGatewayUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedGatewayUrl;
}

function getWakeupTargetUrl(): string {
  const base = readWebEnvValue("LMA_PUBLIC_URL");
  if (!base) {
    throw new Error(
      "LMA_PUBLIC_URL is not configured in ~/.config/lma/web.env (e.g. https://<sprite>.sprites.app)."
    );
  }
  return `${base.replace(/\/$/, "")}/api/wakeup`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "schedule_wakeup",
    label: "Schedule Wake-Up",
    description:
      "Schedule a future one-shot (using runAt ISO-8601 timestamp or delaySeconds) or recurring cron wake-up job via Upstash QStash Sprites Connector. When the time arrives, the sleeping Sprite wakes automatically and delivers your prompt to Professor L so you can execute reminders, Buffer drafts/posts, YouTube checks, or proactive messages.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Short human-readable label (e.g. 'Pre-stream check for Hans collab').",
        },
        prompt: {
          type: "string",
          description:
            "Exact instruction for Professor L to execute when woken up (e.g. 'Remind Roffi his stream with Hans starts in 1 hour and check his Buffer drafts').",
        },
        runAt: {
          type: "string",
          description:
            "ISO-8601 timestamp with timezone for a one-shot wake-up (e.g. '2026-12-17T14:30:00+07:00').",
        },
        delaySeconds: {
          type: "number",
          description: "Alternative to runAt: delay in seconds from now for a one-shot wake-up.",
        },
        cron: {
          type: "string",
          description:
            "Optional 5-field UTC cron expression for recurring wake-ups (e.g. '0 2 * * 1' = Mondays 09:00 WIB). Omit for one-shot.",
        },
      },
      required: ["label", "prompt"],
    },
    async execute(
      _toolCallId,
      params: {
        label: string;
        prompt: string;
        runAt?: string;
        delaySeconds?: number;
        cron?: string;
      }
    ) {
      const gw = await getQStashGatewayUrl();
      const targetUrl = getWakeupTargetUrl();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      let endpoint: string;
      if (params.cron) {
        endpoint = `${gw}/v2/schedules/${encodeURIComponent(targetUrl)}`;
        headers["Upstash-Cron"] = params.cron;
      } else {
        endpoint = `${gw}/v2/publish/${encodeURIComponent(targetUrl)}`;
        if (params.runAt) {
          const ms = Date.parse(params.runAt);
          if (Number.isNaN(ms)) {
            throw new Error(`Invalid runAt ISO timestamp: ${params.runAt}`);
          }
          headers["Upstash-Not-Before"] = String(Math.floor(ms / 1000));
        } else if (typeof params.delaySeconds === "number" && params.delaySeconds > 0) {
          headers["Upstash-Delay"] = `${Math.round(params.delaySeconds)}s`;
        } else {
          throw new Error("Provide either runAt, delaySeconds, or cron.");
        }
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          label: params.label,
          prompt: params.prompt,
          scheduledAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`QStash schedule error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                kind: params.cron ? "recurring_cron" : "one_shot",
                label: params.label,
                runAt: params.runAt ?? null,
                delaySeconds: params.delaySeconds ?? null,
                cron: params.cron ?? null,
                qstash: data,
              },
              null,
              2
            ),
          },
        ],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "list_wakeups",
    label: "List Scheduled Wake-Ups",
    description: "List active recurring QStash wake-up schedules configured for this Sprite.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const gw = await getQStashGatewayUrl();
      const res = await fetch(`${gw}/v2/schedules`);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`QStash list schedules error (${res.status}): ${err}`);
      }
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "cancel_wakeup",
    label: "Cancel Scheduled Wake-Up",
    description: "Cancel a previously scheduled one-shot message or recurring cron in QStash.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "QStash messageId (for one-shot) or scheduleId (for recurring).",
        },
        kind: {
          type: "string",
          enum: ["one_shot", "recurring_cron"],
          description: "Whether the ID is a one-shot messageId or recurring scheduleId.",
        },
      },
      required: ["id", "kind"],
    },
    async execute(_toolCallId, params: { id: string; kind: "one_shot" | "recurring_cron" }) {
      const gw = await getQStashGatewayUrl();
      const pathSeg = params.kind === "recurring_cron" ? "schedules" : "messages";
      const res = await fetch(`${gw}/v2/${pathSeg}/${encodeURIComponent(params.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`QStash cancel error (${res.status}): ${err}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, cancelled: params.id }) }],
        details: {},
      };
    },
  });
}
