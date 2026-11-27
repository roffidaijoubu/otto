import crypto from "node:crypto";
import {
  type CalendarEvent,
  listCalendarEvents,
  saveCalendarEventsBatch,
} from "../../agent/lib/studio-db.ts";
import { execServerGCalTool, resolveServerGoogleCalendar } from "./gcal.ts";
import { errorMessage } from "./http.ts";
import { broadcast } from "./sse.ts";

export type ServerCalendarEvent = CalendarEvent;

export function readCalendarEvents(): ServerCalendarEvent[] {
  return listCalendarEvents();
}

export function writeCalendarEvents(events: ServerCalendarEvent[]): void {
  saveCalendarEventsBatch(events);
  broadcast({ type: "db_changed" });
}

function formatIcsUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildCalendarIcs(events: ServerCalendarEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LMA Otto//Stream Ops Schedule//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Otto Stream Schedule",
  ];
  const dtStamp = formatIcsUtc(new Date().toISOString()) || "20260101T000000Z";
  for (const evt of events) {
    if (evt.status === "cancelled") continue;
    const dtStart = formatIcsUtc(evt.startAt);
    if (!dtStart) continue;
    const endIso =
      evt.endAt ||
      new Date(Date.parse(evt.startAt) + 60 * 60 * 1000).toISOString();
    const dtEnd = formatIcsUtc(endIso) || dtStart;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}@lma.sprites.app`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(`[${evt.type.toUpperCase()}] ${evt.title}`)}`);
    if (evt.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(evt.notes)}`);
    }
    for (const w of evt.wakeups || []) {
      if (w.status !== "armed" || typeof w.offsetMinutes !== "number" || w.offsetMinutes > 0) {
        continue;
      }
      const mins = Math.max(0, Math.abs(Math.round(w.offsetMinutes)));
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeIcsText(w.label)}`);
      lines.push(`TRIGGER:-PT${mins}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export type SyncGoogleCalendarResult =
  | { ok: false; connected: false; added: 0; updated: 0 }
  | { ok: true; connected: true; added: number; updated: number; events: ServerCalendarEvent[] }
  | { ok: false; connected: true; error: string };

export async function syncGoogleCalendar(): Promise<SyncGoogleCalendarResult> {
  const ctx = await resolveServerGoogleCalendar();
  if (!ctx) {
    return { ok: false, connected: false, added: 0, updated: 0 };
  }
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const raw = await execServerGCalTool(ctx, "GOOGLECALENDAR_EVENTS_LIST", {
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: 50,
    });
    const d1 = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
    const payload = (
      d1.response_data && typeof d1.response_data === "object" ? d1.response_data : d1
    ) as Record<string, unknown>;
    const items = (Array.isArray(payload.items) ? payload.items : []) as Array<{
      id?: string;
      summary?: string;
      description?: string;
      status?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;

    const events = readCalendarEvents();
    const nowIso = new Date().toISOString();
    let added = 0;
    let updated = 0;
    for (const item of items) {
      if (!item.id || item.status === "cancelled") continue;
      const startRaw =
        item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00Z` : null);
      if (!startRaw) continue;
      const endRaw =
        item.end?.dateTime || (item.end?.date ? `${item.end.date}T23:59:59Z` : null);
      const rawTitle = (item.summary || "(Untitled Google Event)").trim();
      const cleanTitle = rawTitle.replace(/^\[(STREAM|COLLAB|UPLOAD|REMINDER|DEADLINE)\]\s*/i, "");
      const existing = events.find((e) => e.googleEventId === item.id);
      if (existing) {
        existing.title = cleanTitle;
        existing.startAt = startRaw;
        existing.endAt = endRaw;
        if (item.description) existing.notes = item.description.trim();
        if (item.htmlLink) existing.googleHtmlLink = item.htmlLink;
        existing.updatedAt = nowIso;
        updated++;
      } else {
        const inferredType: ServerCalendarEvent["type"] = /collab/i.test(rawTitle)
          ? "collab"
          : /stream|live/i.test(rawTitle)
            ? "stream"
            : /upload|video|premiere/i.test(rawTitle)
              ? "upload"
              : /deadline|due/i.test(rawTitle)
                ? "deadline"
                : "reminder";
        events.push({
          id: `evt_${crypto.randomBytes(5).toString("hex")}`,
          title: cleanTitle,
          type: inferredType,
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
    writeCalendarEvents(events);
    return {
      ok: true,
      connected: true,
      added,
      updated,
      events: events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    };
  } catch (err: unknown) {
    return { ok: false, connected: true, error: errorMessage(err) };
  }
}
