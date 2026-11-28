import crypto from "node:crypto";

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

export interface CalendarStore {
  version: 1;
  events: CalendarEvent[];
}

export interface GoogleCalComposioCtx {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

let cachedGatewayUrl: string | null = null;
let cachedGCalCtx: GoogleCalComposioCtx | null | undefined = undefined;

export async function loadCalendar(): Promise<CalendarStore> {
  return { version: 1, events: await listCalendarEvents() };
}

export async function saveCalendar(store: CalendarStore): Promise<void> {
  await saveCalendarEventsBatch(store.events);
}
export async function getGoogleCalendarContext(): Promise<GoogleCalComposioCtx | null> {
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

export async function execGoogleCalendarTool(
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

export function toNaiveUtcDatetime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export function extractGCalPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
  if (data.response_data && typeof data.response_data === "object") {
    return data.response_data as Record<string, unknown>;
  }
  return data;
}

export interface GoogleReminderOverride {
  method: "popup" | "email";
  minutes: number;
}

export function resolveGoogleReminders(
  type: CalendarEventType,
  explicit?: Array<{ method?: string; minutes?: number }>
): GoogleReminderOverride[] {
  if (Array.isArray(explicit) && explicit.length > 0) {
    const cleaned: GoogleReminderOverride[] = [];
    for (const r of explicit.slice(0, 5)) {
      if (typeof r?.minutes !== "number" || !Number.isFinite(r.minutes)) continue;
      const mins = Math.min(40320, Math.max(0, Math.round(r.minutes)));
      const method: "popup" | "email" = r.method === "email" ? "email" : "popup";
      cleaned.push({ method, minutes: mins });
    }
    if (cleaned.length > 0) return cleaned;
  }
  if (type === "reminder") {
    return [{ method: "popup", minutes: 0 }];
  }
  if (type === "stream" || type === "collab") {
    return [
      { method: "popup", minutes: 60 },
      { method: "popup", minutes: 15 },
    ];
  }
  return [
    { method: "popup", minutes: 60 },
    { method: "popup", minutes: 10 },
  ];
}

export async function createGoogleCalendarEvent(evt: {
  title: string;
  type: CalendarEventType;
  startMs: number;
  durationMinutes: number;
  notes: string;
  reminders?: Array<{ method?: string; minutes?: number }>;
}): Promise<{
  googleEventId: string | null;
  googleHtmlLink: string | null;
  appliedReminders?: GoogleReminderOverride[];
  error?: string;
}> {
  const ctx = await getGoogleCalendarContext();
  if (!ctx) return { googleEventId: null, googleHtmlLink: null };
  const reminderOverrides = resolveGoogleReminders(evt.type, evt.reminders);
  const startIso = new Date(evt.startMs).toISOString();
  const endIso = new Date(evt.startMs + evt.durationMinutes * 60 * 1000).toISOString();
  const summary =
    evt.type === "reminder"
      ? `Reminder: ${evt.title}`
      : `[${evt.type.toUpperCase()}] ${evt.title}`;
  const description = evt.notes || `Scheduled via Otto (${evt.type})`;

  // Primary path: Composio v3 Proxy -> native Google Calendar Events API (supports custom reminders.overrides!)
  try {
    const proxyRes = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected_account_id: ctx.connectedAccountId,
        user_id: ctx.userId,
        endpoint: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        method: "POST",
        body: {
          summary,
          description,
          start: { dateTime: startIso },
          end: { dateTime: endIso },
          reminders: {
            useDefault: false,
            overrides: reminderOverrides,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (proxyRes.ok) {
      const proxyData = (await proxyRes.json().catch(() => ({}))) as Record<string, unknown>;
      const payload = extractGCalPayload(proxyData);
      const id = typeof payload.id === "string" ? payload.id : null;
      const link = typeof payload.htmlLink === "string" ? payload.htmlLink : null;
      if (id) {
        return { googleEventId: id, googleHtmlLink: link, appliedReminders: reminderOverrides };
      }
    }
  } catch {
    // fall through to Composio wrapper fallback
  }

  // Fallback: Composio GOOGLECALENDAR_CREATE_EVENT wrapper (uses calendar default reminders)
  try {
    const hours = Math.min(24, Math.floor(evt.durationMinutes / 60));
    const mins = evt.durationMinutes % 60;
    const raw = await execGoogleCalendarTool(ctx, "GOOGLECALENDAR_CREATE_EVENT", {
      calendar_id: "primary",
      summary,
      description,
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

export async function patchGoogleCalendarEvent(evt: CalendarEvent): Promise<void> {
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

export async function deleteGoogleCalendarEvent(googleEventId: string | null | undefined): Promise<boolean> {
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

export function inferEventTypeFromTitle(title: string): CalendarEventType {
  if (/collab/i.test(title)) return "collab";
  if (/stream|live/i.test(title)) return "stream";
  if (/upload|video|premiere/i.test(title)) return "upload";
  if (/deadline|due/i.test(title)) return "deadline";
  return "reminder";
}


export function makeEventId(): string {
  return `evt_${crypto.randomBytes(5).toString("hex")}`;
}

export async function getQStashGatewayUrl(): Promise<string> {
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

export function getWakeupTargetUrl(): string {
  const base = process.env.LMA_PUBLIC_URL?.trim();
  if (!base) {
    throw new Error(
      "LMA_PUBLIC_URL is not set in environment (set it in ~/.config/lma/web.env for lma-web or export LMA_PUBLIC_URL for CLI sessions)."
    );
  }
  return `${base.replace(/\/$/, "")}/api/wakeup`;
}

export async function publishQStashWakeup(opts: {
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

export async function cancelQStashJob(id: string, kind: "one_shot" | "recurring_cron"): Promise<boolean> {
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

export function buildPresetHookSpec(
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

