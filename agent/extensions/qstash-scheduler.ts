import crypto from "node:crypto";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  listCalendarEvents,
  saveCalendarEventsBatch,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarWakeupHook,
} from "../lib/studio-db.ts";
import { normalizeQStashCron } from "../lib/qstash-cron.ts";

export type { CalendarEvent, CalendarEventType, CalendarWakeupHook };
export type LifecycleHookPreset = "promo_24h" | "pre_stream_1h" | "post_stream_vod_30m" | "at_start";

interface CalendarStore {
  version: 1;
  events: CalendarEvent[];
}

interface GoogleCalComposioCtx {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

let cachedGatewayUrl: string | null = null;
let cachedGCalCtx: GoogleCalComposioCtx | null | undefined = undefined;

function loadCalendar(): CalendarStore {
  return { version: 1, events: listCalendarEvents() };
}

function saveCalendar(store: CalendarStore): void {
  saveCalendarEventsBatch(store.events);
}
async function getGoogleCalendarContext(): Promise<GoogleCalComposioCtx | null> {
  if (cachedGCalCtx !== undefined) return cachedGCalCtx;
  try {
    let baseUrl = process.env.SPRITES_COMPOSIO_GATEWAY_URL?.trim()?.replace(/\/$/, "");
    if (!baseUrl) {
      const gwRes = await fetch("https://api.sprites.dev/v1/gateway/list", {
        signal: AbortSignal.timeout(8000),
      });
      if (!gwRes.ok) return null;
      const gwData = (await gwRes.json()) as {
        connections?: Array<{ provider?: string; display_name?: string; gateway_base_url?: string }>;
      };
      const conn = gwData.connections?.find(
        (c) =>
          c.provider === "composio" ||
          (c.provider === "custom_api" && /composio/i.test(c.display_name ?? ""))
      );
      if (!conn?.gateway_base_url) {
        cachedGCalCtx = null;
        return null;
      }
      baseUrl = conn.gateway_base_url.replace(/\/$/, "");
    }
    const accRes = await fetch(
      `${baseUrl}/api/v3/connected_accounts?toolkit_slugs=googlecalendar&limit=20`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!accRes.ok) return null;
    const accData = (await accRes.json()) as {
      items?: Array<{ id: string; status: string; user_id?: string; userId?: string }>;
    };
    const active = accData.items?.find((a) => a.status === "ACTIVE");
    if (!active) {
      cachedGCalCtx = null;
      return null;
    }
    cachedGCalCtx = {
      baseUrl,
      connectedAccountId: active.id,
      userId: active.user_id || active.userId || "default",
    };
    return cachedGCalCtx;
  } catch {
    return null;
  }
}

async function execGoogleCalendarTool(
  ctx: GoogleCalComposioCtx,
  slug: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connected_account_id: ctx.connectedAccountId,
      user_id: ctx.userId,
      arguments: args,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Composio ${slug} error (${res.status}): ${err}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function toNaiveUtcDatetime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

function extractGCalPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
  if (data.response_data && typeof data.response_data === "object") {
    return data.response_data as Record<string, unknown>;
  }
  return data;
}

async function createGoogleCalendarEvent(evt: {
  title: string;
  type: CalendarEventType;
  startMs: number;
  durationMinutes: number;
  notes: string;
}): Promise<{ googleEventId: string | null; googleHtmlLink: string | null; error?: string }> {
  const ctx = await getGoogleCalendarContext();
  if (!ctx) return { googleEventId: null, googleHtmlLink: null };
  try {
    const hours = Math.min(24, Math.floor(evt.durationMinutes / 60));
    const mins = evt.durationMinutes % 60;
    const raw = await execGoogleCalendarTool(ctx, "GOOGLECALENDAR_CREATE_EVENT", {
      calendar_id: "primary",
      summary: `[${evt.type.toUpperCase()}] ${evt.title}`,
      description: evt.notes || `Scheduled via Otto (${evt.type})`,
      start_datetime: toNaiveUtcDatetime(evt.startMs),
      timezone: "UTC",
      event_duration_hour: hours,
      event_duration_minutes: mins,
    });
    const payload = extractGCalPayload(raw);
    const id = typeof payload.id === "string" ? payload.id : null;
    const link = typeof payload.htmlLink === "string" ? payload.htmlLink : null;
    return { googleEventId: id, googleHtmlLink: link };
  } catch (err: unknown) {
    return {
      googleEventId: null,
      googleHtmlLink: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function patchGoogleCalendarEvent(evt: CalendarEvent): Promise<void> {
  if (!evt.googleEventId) return;
  const ctx = await getGoogleCalendarContext();
  if (!ctx) return;
  const args: Record<string, unknown> = {
    calendar_id: "primary",
    event_id: evt.googleEventId,
    summary: evt.source === "google" ? evt.title : `[${evt.type.toUpperCase()}] ${evt.title}`,
    description: evt.notes,
    start_time: new Date(Date.parse(evt.startAt)).toISOString(),
  };
  if (evt.endAt) {
    args.end_time = new Date(Date.parse(evt.endAt)).toISOString();
  }
  await execGoogleCalendarTool(ctx, "GOOGLECALENDAR_PATCH_EVENT", args).catch(() => {});
}

async function deleteGoogleCalendarEvent(googleEventId: string | null | undefined): Promise<boolean> {
  if (!googleEventId) return false;
  const ctx = await getGoogleCalendarContext();
  if (!ctx) return false;
  try {
    await execGoogleCalendarTool(ctx, "GOOGLECALENDAR_DELETE_EVENT", {
      calendar_id: "primary",
      event_id: googleEventId,
    });
    return true;
  } catch {
    return false;
  }
}

function inferEventTypeFromTitle(title: string): CalendarEventType {
  if (/collab/i.test(title)) return "collab";
  if (/stream|live/i.test(title)) return "stream";
  if (/upload|video|premiere/i.test(title)) return "upload";
  if (/deadline|due/i.test(title)) return "deadline";
  return "reminder";
}


function makeEventId(): string {
  return `evt_${crypto.randomBytes(5).toString("hex")}`;
}

async function getQStashGatewayUrl(): Promise<string> {
  if (cachedGatewayUrl) return cachedGatewayUrl;
  const fromEnv = process.env.SPRITES_QSTASH_GATEWAY_URL?.trim();
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
      "No authorized QStash Sprites Connector found. Add a Custom API connector named 'QStash' (see docs/setup/qstash-scheduler.md)."
    );
  }
  cachedGatewayUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedGatewayUrl;
}

function getWakeupTargetUrl(): string {
  const base = process.env.LMA_PUBLIC_URL?.trim();
  if (!base) {
    throw new Error(
      "LMA_PUBLIC_URL is not set in environment (set it in ~/.config/lma/web.env for lma-web or export LMA_PUBLIC_URL for CLI sessions)."
    );
  }
  return `${base.replace(/\/$/, "")}/api/wakeup`;
}

async function publishQStashWakeup(opts: {
  label: string;
  prompt: string;
  runAtMs?: number;
  delaySeconds?: number;
  cron?: string;
  eventId?: string;
  silent?: boolean;
  jobType?: string;
}): Promise<{ qstashId: string; kind: "one_shot" | "recurring_cron"; cron?: string; raw: unknown }> {
  const gw = await getQStashGatewayUrl();
  const targetUrl = getWakeupTargetUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Upstash-Retries": "3",
  };

  let endpoint: string;
  let kind: "one_shot" | "recurring_cron";
  let normalizedCron: string | undefined;
  if (opts.cron) {
    normalizedCron = normalizeQStashCron(opts.cron);
    endpoint = `${gw}/v2/schedules/${encodeURIComponent(targetUrl)}`;
    headers["Upstash-Cron"] = normalizedCron;
    kind = "recurring_cron";
  } else {
    endpoint = `${gw}/v2/publish/${encodeURIComponent(targetUrl)}`;
    kind = "one_shot";
    if (typeof opts.runAtMs === "number") {
      headers["Upstash-Not-Before"] = String(Math.floor(opts.runAtMs / 1000));
    } else if (typeof opts.delaySeconds === "number" && opts.delaySeconds > 0) {
      headers["Upstash-Delay"] = `${Math.round(opts.delaySeconds)}s`;
    } else {
      throw new Error("Provide either runAt, delaySeconds, or cron.");
    }
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      label: opts.label,
      prompt: opts.prompt,
      eventId: opts.eventId ?? null,
      silent: Boolean(opts.silent),
      mode: opts.silent ? "background" : "chat",
      jobType: opts.jobType ?? (opts.silent ? "background_job" : "wakeup"),
      scheduledAt: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QStash schedule error (${res.status}): ${err}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const qstashId = String(raw.messageId || raw.scheduleId || "");
  if (!qstashId) {
    throw new Error(`QStash response missing messageId/scheduleId: ${JSON.stringify(raw)}`);
  }
  return { qstashId, kind, cron: normalizedCron, raw };
}

async function cancelQStashJob(id: string, kind: "one_shot" | "recurring_cron"): Promise<boolean> {
  const gw = await getQStashGatewayUrl();
  const pathSeg = kind === "recurring_cron" ? "schedules" : "messages";
  const res = await fetch(`${gw}/v2/${pathSeg}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QStash cancel error (${res.status}): ${err}`);
  }
  return true;
}

function buildPresetHookSpec(
  preset: LifecycleHookPreset,
  title: string,
  startMs: number,
  endMs: number,
  startIso: string,
  notes: string
): { offsetMinutes: number; triggerMs: number; label: string; prompt: string } {
  const noteSuffix = notes ? ` Notes: ${notes}` : "";
  switch (preset) {
    case "promo_24h":
      return {
        offsetMinutes: -1440,
        triggerMs: startMs - 24 * 60 * 60 * 1000,
        label: `T-24h Promo: ${title}`,
        prompt: `24 hours before "${title}" (${startIso}). Check if Buffer promo drafts for X, TikTok, and Instagram are queued, and offer tailored drafts if anything is missing.${noteSuffix}`,
      };
    case "pre_stream_1h":
      return {
        offsetMinutes: -60,
        triggerMs: startMs - 60 * 60 * 1000,
        label: `T-1h Pre-stream: ${title}`,
        prompt: `1 hour before "${title}" (${startIso}). Run a crisp pre-stream readiness check (OBS/mic, stream title, thumbnail, and going-live Buffer drafts).${noteSuffix}`,
      };
    case "post_stream_vod_30m": {
      const triggerMs = endMs + 30 * 60 * 1000;
      const offsetMinutes = Math.round((triggerMs - startMs) / 60000);
      return {
        offsetMinutes,
        triggerMs,
        label: `Post-stream VOD scan: ${title}`,
        prompt: `Post-stream follow-up for "${title}" (started ${startIso}). Check recent YouTube uploads or ask the creator for the VOD link so we can scan hype spikes and cut raw clips.${noteSuffix}`,
      };
    }
    case "at_start":
      return {
        offsetMinutes: 0,
        triggerMs: startMs,
        label: `Starting now: ${title}`,
        prompt: `Scheduled event starting now: "${title}" (${startIso}).${noteSuffix}`,
      };
  }
}

export default function (pi: ExtensionAPI) {
  // 1. Standalone wake-up (auto-logged into calendar.json so nothing is invisible)
  pi.registerTool({
    name: "schedule_wakeup",
    label: "Schedule Wake-Up",
    description:
      "Schedule a future one-shot (using runAt ISO-8601 timestamp or delaySeconds) or recurring cron wake-up job via Upstash QStash Sprites Connector. Automatically logs a reminder entry in the Mission Control Schedule calendar.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Short human-readable label (e.g. 'Pre-stream check for Friday collab').",
        },
        prompt: {
          type: "string",
          description:
            "Exact instruction for Otto to execute when woken up (e.g. 'Remind the streamer their collab starts in 1 hour and check their Buffer drafts').",
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
            "Optional 5-field cron expression for recurring wake-ups, with optional IANA timezone prefix (e.g. 'CRON_TZ=Asia/Jakarta 0 0 * * *' for midnight WIB, or '0 2 * * 1' in UTC). Omit for one-shot.",
        },
        silent: {
          type: "boolean",
          description:
            "When true, executes in an isolated silent background pass without injecting messages into the main Web Chat UI.",
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
        silent?: boolean;
      }
    ) {
      let runAtMs: number | undefined;
      let startAtIso = new Date().toISOString();
      if (params.runAt) {
        const ms = Date.parse(params.runAt);
        if (Number.isNaN(ms)) {
          throw new Error(`Invalid runAt ISO timestamp: ${params.runAt}`);
        }
        runAtMs = ms;
        startAtIso = params.runAt;
      } else if (typeof params.delaySeconds === "number" && params.delaySeconds > 0) {
        startAtIso = new Date(Date.now() + Math.round(params.delaySeconds) * 1000).toISOString();
      } else if (!params.cron) {
        throw new Error("Provide either runAt, delaySeconds, or cron.");
      }

      const eventId = makeEventId();
      const published = await publishQStashWakeup({
        label: params.label,
        prompt: params.prompt,
        runAtMs,
        delaySeconds: params.delaySeconds,
        cron: params.cron,
        eventId,
        silent: params.silent,
      });
      const nowIso = new Date().toISOString();
      const store = loadCalendar();
      const evt: CalendarEvent = {
        id: eventId,
        title: params.label,
        type: "reminder",
        startAt: startAtIso,
        endAt: null,
        cron: published.cron ?? params.cron ?? null,
        notes: params.prompt,
        status: "planned",
        wakeups: [
          {
            qstashId: published.qstashId,
            kind: published.kind,
            label: params.label,
            triggerAt: published.kind === "one_shot" ? startAtIso : null,
            cron: published.cron ?? params.cron ?? null,
            offsetMinutes: 0,
            prompt: params.prompt,
            status: "armed",
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.events.push(evt);
      saveCalendar(store);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                eventId,
                kind: published.kind,
                label: params.label,
                runAt: params.runAt ?? (published.kind === "one_shot" ? startAtIso : null),
                delaySeconds: params.delaySeconds ?? null,
                cron: published.cron ?? params.cron ?? null,
                qstash: published.raw,
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

  // 2. List wakeups (combines QStash recurring schedules + local armed one-shot calendar hooks)
  pi.registerTool({
    name: "list_wakeups",
    label: "List Scheduled Wake-Ups",
    description:
      "List active recurring QStash wake-up schedules and armed one-shot wake-up hooks tracked in the Schedule calendar.",
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
      const recurringSchedules = await res.json();
      const store = loadCalendar();
      const nowMs = Date.now();
      const armedOneShots = store.events
        .filter((e) => e.status === "planned")
        .flatMap((e) =>
          e.wakeups
            .filter(
              (w) =>
                w.status === "armed" &&
                w.kind === "one_shot" &&
                (!w.triggerAt || Date.parse(w.triggerAt) > nowMs - 60_000)
            )
            .map((w) => ({
              eventId: e.id,
              eventTitle: e.title,
              qstashId: w.qstashId,
              label: w.label,
              triggerAt: w.triggerAt,
            }))
        );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ recurringSchedules, armedOneShots }, null, 2),
          },
        ],
        details: {},
      };
    },
  });

  // 3. Cancel standalone wakeup (syncs calendar.json too)
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
      await cancelQStashJob(params.id, params.kind);
      const store = loadCalendar();
      let touched = false;
      for (const evt of store.events) {
        for (const w of evt.wakeups) {
          if (w.qstashId === params.id && w.status !== "cancelled") {
            w.status = "cancelled";
            evt.updatedAt = new Date().toISOString();
            touched = true;
          }
        }
        if (
          evt.type === "reminder" &&
          evt.wakeups.length > 0 &&
          evt.wakeups.every((w) => w.status === "cancelled")
        ) {
          evt.status = "cancelled";
        }
      }
      if (touched) saveCalendar(store);

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, cancelled: params.id }) }],
        details: {},
      };
    },
  });

  // 4. Calendar: Add Event with Proactive Lifecycle Hooks (Tier 2)
  pi.registerTool({
    name: "calendar_add_event",
    label: "Add Calendar Event",
    description:
      "Add a stream, collab, upload, reminder, or deadline to the persistent Schedule calendar and automatically arm proactive QStash wake-up hooks (e.g. promo_24h, pre_stream_1h, post_stream_vod_30m, at_start) so the sleeping Sprite wakes up at the right moments.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event title (e.g. 'Friday Night Collab: Horror Co-op').",
        },
        type: {
          type: "string",
          enum: ["stream", "collab", "upload", "reminder", "deadline"],
          description: "Category of calendar event.",
        },
        startAt: {
          type: "string",
          description: "ISO-8601 start timestamp with timezone (e.g. '2026-11-27T20:00:00+07:00').",
        },
        durationMinutes: {
          type: "number",
          description: "Duration in minutes (defaults to 180 for stream/collab, 60 otherwise).",
        },
        notes: {
          type: "string",
          description: "Optional context: collab partner, game/topic, or prep notes.",
        },
        hooks: {
          type: "array",
          items: {
            type: "string",
            enum: ["promo_24h", "pre_stream_1h", "post_stream_vod_30m", "at_start"],
          },
          description:
            "Proactive QStash wake-up presets to arm automatically. Past trigger times are skipped safely.",
        },
      },
      required: ["title", "type", "startAt"],
    },
    async execute(
      _toolCallId,
      params: {
        title: string;
        type: CalendarEventType;
        startAt: string;
        durationMinutes?: number;
        notes?: string;
        hooks?: LifecycleHookPreset[];
      }
    ) {
      const startMs = Date.parse(params.startAt);
      if (Number.isNaN(startMs)) {
        throw new Error(`Invalid startAt ISO timestamp: ${params.startAt}`);
      }
      const defaultDur = params.type === "stream" || params.type === "collab" ? 180 : 60;
      const durationMinutes =
        typeof params.durationMinutes === "number" && params.durationMinutes > 0
          ? Math.round(params.durationMinutes)
          : defaultDur;
      const endMs = startMs + durationMinutes * 60 * 1000;
      const endAt = new Date(endMs).toISOString();
      const notes = (params.notes || "").trim();
      const eventId = makeEventId();

      const wakeups: CalendarWakeupHook[] = [];
      const skippedHooks: Array<{ preset: string; reason: string }> = [];
      const nowMs = Date.now();
      const uniqueHooks = Array.from(new Set(params.hooks || []));

      for (const preset of uniqueHooks) {
        const spec = buildPresetHookSpec(preset, params.title, startMs, endMs, params.startAt, notes);
        if (spec.triggerMs <= nowMs + 15_000) {
          skippedHooks.push({
            preset,
            reason: `Trigger time (${new Date(spec.triggerMs).toISOString()}) is already in the past`,
          });
          continue;
        }
        try {
          const published = await publishQStashWakeup({
            label: spec.label,
            prompt: spec.prompt,
            runAtMs: spec.triggerMs,
            eventId,
          });
          wakeups.push({
            qstashId: published.qstashId,
            kind: "one_shot",
            label: spec.label,
            triggerAt: new Date(spec.triggerMs).toISOString(),
            cron: null,
            offsetMinutes: spec.offsetMinutes,
            prompt: spec.prompt,
            status: "armed",
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("412") || /maxDelay/i.test(msg)) {
            skippedHooks.push({
              preset,
              reason: "Trigger time exceeds QStash plan maxDelay (7 days on free tier); event still saved on calendar.",
            });
            continue;
          }
          throw err;
        }
      }

      const gcal = await createGoogleCalendarEvent({
        title: params.title.trim(),
        type: params.type,
        startMs,
        durationMinutes,
        notes,
      });

      const nowIso = new Date().toISOString();
      const evt: CalendarEvent = {
        id: eventId,
        title: params.title.trim(),
        type: params.type,
        startAt: params.startAt,
        endAt,
        cron: null,
        notes,
        status: "planned",
        source: "local",
        googleEventId: gcal.googleEventId,
        googleHtmlLink: gcal.googleHtmlLink,
        wakeups,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const store = loadCalendar();
      store.events.push(evt);
      saveCalendar(store);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                event: evt,
                googleSynced: Boolean(gcal.googleEventId),
                googleSyncError: gcal.error ?? null,
                skippedHooks,
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

  // 5. Calendar: List Events
  pi.registerTool({
    name: "calendar_list_events",
    label: "List Calendar Events",
    description:
      "List scheduled streams, collabs, uploads, reminders, and deadlines from the persistent Schedule calendar along with their armed QStash wake-up hooks.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Optional ISO-8601 start filter (inclusive).",
        },
        to: {
          type: "string",
          description: "Optional ISO-8601 end filter (inclusive).",
        },
        type: {
          type: "string",
          enum: ["stream", "collab", "upload", "reminder", "deadline"],
          description: "Optional event category filter.",
        },
        includeCancelled: {
          type: "boolean",
          description: "Include cancelled events (default false).",
        },
      },
    },
    async execute(
      _toolCallId,
      params: {
        from?: string;
        to?: string;
        type?: CalendarEventType;
        includeCancelled?: boolean;
      }
    ) {
      const store = loadCalendar();
      const fromMs = params.from ? Date.parse(params.from) : null;
      const toMs = params.to ? Date.parse(params.to) : null;

      const filtered = store.events
        .filter((e) => {
          if (!params.includeCancelled && e.status === "cancelled") return false;
          if (params.type && e.type !== params.type) return false;
          const t = Date.parse(e.startAt);
          if (fromMs !== null && !Number.isNaN(fromMs) && !Number.isNaN(t) && t < fromMs) return false;
          if (toMs !== null && !Number.isNaN(toMs) && !Number.isNaN(t) && t > toMs) return false;
          return true;
        })
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: filtered.length, events: filtered }, null, 2),
          },
        ],
        details: {},
      };
    },
  });

  // 6. Calendar: Update / Reschedule Event (auto re-arms shifted QStash hooks!)
  pi.registerTool({
    name: "calendar_update_event",
    label: "Update Calendar Event",
    description:
      "Update a calendar event's title, start time, duration, notes, or status. If startAt changes, automatically cancels old armed one-shot QStash hooks and re-arms them at the new shifted times.",
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "Calendar event ID (e.g. 'evt_...').",
        },
        title: { type: "string" },
        startAt: {
          type: "string",
          description: "New ISO-8601 start timestamp with timezone.",
        },
        durationMinutes: { type: "number" },
        notes: { type: "string" },
        status: {
          type: "string",
          enum: ["planned", "done", "cancelled"],
        },
      },
      required: ["eventId"],
    },
    async execute(
      _toolCallId,
      params: {
        eventId: string;
        title?: string;
        startAt?: string;
        durationMinutes?: number;
        notes?: string;
        status?: "planned" | "done" | "cancelled";
      }
    ) {
      const store = loadCalendar();
      const evt = store.events.find((e) => e.id === params.eventId);
      if (!evt) {
        throw new Error(`Calendar event not found: ${params.eventId}`);
      }

      const oldStartMs = Date.parse(evt.startAt);
      let newStartMs = oldStartMs;
      if (params.startAt) {
        const parsed = Date.parse(params.startAt);
        if (Number.isNaN(parsed)) {
          throw new Error(`Invalid startAt ISO timestamp: ${params.startAt}`);
        }
        newStartMs = parsed;
        evt.startAt = params.startAt;
      }
      if (params.title) evt.title = params.title.trim();
      if (typeof params.notes === "string") evt.notes = params.notes.trim();
      if (params.durationMinutes && params.durationMinutes > 0) {
        evt.endAt = new Date(newStartMs + Math.round(params.durationMinutes) * 60 * 1000).toISOString();
      } else if (params.startAt && evt.endAt && !Number.isNaN(oldStartMs)) {
        const oldDur = Math.max(60_000, Date.parse(evt.endAt) - oldStartMs);
        evt.endAt = new Date(newStartMs + oldDur).toISOString();
      }

      if (params.status === "cancelled") {
        for (const w of evt.wakeups) {
          if (w.status === "armed") {
            await cancelQStashJob(w.qstashId, w.kind).catch(() => {});
            w.status = "cancelled";
          }
        }
        evt.status = "cancelled";
      } else {
        if (params.status) evt.status = params.status;
        // Re-arm armed one-shot hooks if startAt changed
        if (params.startAt && newStartMs !== oldStartMs) {
          const nowMs = Date.now();
          for (const w of evt.wakeups) {
            if (w.status !== "armed" || w.kind !== "one_shot") continue;
            await cancelQStashJob(w.qstashId, "one_shot").catch(() => {});
            const offsetMs = (w.offsetMinutes ?? 0) * 60 * 1000;
            const nextTriggerMs = newStartMs + offsetMs;
            if (nextTriggerMs <= nowMs + 15_000) {
              w.status = "cancelled";
              continue;
            }
            const republished = await publishQStashWakeup({
              label: w.label,
              prompt: w.prompt,
              runAtMs: nextTriggerMs,
              eventId: evt.id,
            });
            w.qstashId = republished.qstashId;
            w.triggerAt = new Date(nextTriggerMs).toISOString();
          }
        }
      }

      if (evt.status === "cancelled") {
        await deleteGoogleCalendarEvent(evt.googleEventId);
      } else {
        await patchGoogleCalendarEvent(evt);
      }
      evt.updatedAt = new Date().toISOString();
      saveCalendar(store);

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, event: evt }, null, 2) }],
        details: {},
      };
    },
  });

  // 7. Calendar: Cancel Event (atomic QStash revoke)
  pi.registerTool({
    name: "calendar_cancel_event",
    label: "Cancel Calendar Event",
    description:
      "Cancel a calendar event and automatically revoke every armed QStash wake-up hook attached to it.",
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "Calendar event ID (e.g. 'evt_...').",
        },
      },
      required: ["eventId"],
    },
    async execute(_toolCallId, params: { eventId: string }) {
      const store = loadCalendar();
      const evt = store.events.find((e) => e.id === params.eventId);
      if (!evt) {
        throw new Error(`Calendar event not found: ${params.eventId}`);
      }
      const revoked: string[] = [];
      for (const w of evt.wakeups) {
        if (w.status === "armed") {
          await cancelQStashJob(w.qstashId, w.kind).catch(() => {});
          w.status = "cancelled";
          revoked.push(w.qstashId);
        }
      }
      const googleDeleted = await deleteGoogleCalendarEvent(evt.googleEventId);
      evt.status = "cancelled";
      evt.updatedAt = new Date().toISOString();
      saveCalendar(store);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: true, eventId: evt.id, revokedQStashIds: revoked, googleDeleted },
              null,
              2
            ),
          },
        ],
        details: {},
      };
    },
  });

  // 8. Calendar: 2-Way Sync with Google Calendar via Composio v3
  pi.registerTool({
    name: "calendar_sync_google",
    label: "Sync Google Calendar",
    description:
      "Pull upcoming events from the creator's connected Google Calendar via the zero-key Composio v3 Sprites Connector and merge them into the persistent Schedule calendar so conflicts and existing commitments are visible.",
    parameters: {
      type: "object",
      properties: {
        daysAhead: {
          type: "number",
          description: "How many days ahead to sync from now (default 30, max 90).",
        },
      },
    },
    async execute(_toolCallId, params: { daysAhead?: number }) {
      const ctx = await getGoogleCalendarContext();
      if (!ctx) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  connected: false,
                  message:
                    "Google Calendar is not connected in Composio yet. Local Schedule calendar + .ics export still work normally.",
                },
                null,
                2
              ),
            },
          ],
          details: {},
        };
      }
      const days = Math.min(90, Math.max(1, Math.round(params.daysAhead ?? 30)));
      const now = new Date();
      const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

      const raw = await execGoogleCalendarTool(ctx, "GOOGLECALENDAR_EVENTS_LIST", {
        calendarId: "primary",
        singleEvents: true,
        orderBy: "startTime",
        timeMin,
        timeMax,
        maxResults: 50,
      });
      const payload = extractGCalPayload(raw);
      const items = (Array.isArray(payload.items) ? payload.items : []) as Array<{
        id?: string;
        summary?: string;
        description?: string;
        status?: string;
        htmlLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;

      const store = loadCalendar();
      const nowIso = new Date().toISOString();
      let added = 0;
      let updated = 0;

      for (const item of items) {
        if (!item.id || item.status === "cancelled") continue;
        const startRaw = item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00Z` : null);
        if (!startRaw) continue;
        const endRaw = item.end?.dateTime || (item.end?.date ? `${item.end.date}T23:59:59Z` : null);
        const rawTitle = (item.summary || "(Untitled Google Event)").trim();
        const cleanTitle = rawTitle.replace(/^\[(STREAM|COLLAB|UPLOAD|REMINDER|DEADLINE)\]\s*/i, "");
        const existing = store.events.find((e) => e.googleEventId === item.id);
        if (existing) {
          existing.title = cleanTitle;
          existing.startAt = startRaw;
          existing.endAt = endRaw;
          if (item.description) existing.notes = item.description.trim();
          if (item.htmlLink) existing.googleHtmlLink = item.htmlLink;
          existing.updatedAt = nowIso;
          updated++;
        } else {
          store.events.push({
            id: makeEventId(),
            title: cleanTitle,
            type: inferEventTypeFromTitle(rawTitle),
            startAt: startRaw,
            endAt: endRaw,
            cron: null,
            notes: (item.description || "").trim(),
            status: "planned",
            source: "google",
            googleEventId: item.id,
            googleHtmlLink: item.htmlLink ?? null,
            wakeups: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          added++;
        }
      }

      saveCalendar(store);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: true, connected: true, syncedWindowDays: days, added, updated, totalGoogleItems: items.length },
              null,
              2
            ),
          },
        ],
        details: {},
      };
    },
  });
}
