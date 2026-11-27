import crypto from "node:crypto";
import {
  buildCalendarIcs,
  readCalendarEvents,
  writeCalendarEvents,
  type ServerCalendarEvent,
} from "../lib/calendar-service.ts";
import { resolveGatewayBaseUrl } from "../lib/gateway.ts";
import { execServerGCalTool, resolveServerGoogleCalendar } from "../lib/gcal.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleCalendarRoutes(
  req: Request,
  url: URL
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/calendar") {
    const events = readCalendarEvents().sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
    );
    return Response.json({ events });
  }

  if (req.method === "GET" && url.pathname === "/api/calendar/export.ics") {
    const events = readCalendarEvents().sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
    );
    const ics = buildCalendarIcs(events);
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lma-schedule.ics"',
        "Cache-Control": "no-cache",
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/calendar/sync") {
    const ctx = await resolveServerGoogleCalendar();
    if (!ctx) {
      return Response.json({ ok: false, connected: false, added: 0, updated: 0 });
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
      return Response.json({
        ok: true,
        connected: true,
        added,
        updated,
        events: events.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
      });
    } catch (err: unknown) {
      return Response.json({ ok: false, connected: true, error: errorMessage(err) }, { status: 502 });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/calendar") {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      type?: string;
      startAt?: string;
      endAt?: string | null;
      notes?: string;
    };
    const title = (body.title || "").trim();
    const startAtRaw = (body.startAt || "").trim();
    if (!title) {
      return Response.json({ error: "Event title is required" }, { status: 400 });
    }
    const parsedStart = Date.parse(startAtRaw);
    if (!startAtRaw || Number.isNaN(parsedStart)) {
      return Response.json({ error: "Valid startAt timestamp is required" }, { status: 400 });
    }
    const VALID_EVENT_TYPES: Record<string, true> = {
      stream: true,
      collab: true,
      upload: true,
      reminder: true,
      deadline: true,
    };
    const evtType = VALID_EVENT_TYPES[body.type || ""]
      ? (body.type as ServerCalendarEvent["type"])
      : "stream";
    const nowIso = new Date().toISOString();
    const newEvent: ServerCalendarEvent = {
      id: `evt_${crypto.randomBytes(5).toString("hex")}`,
      title,
      type: evtType,
      startAt: new Date(parsedStart).toISOString(),
      endAt:
        body.endAt && !Number.isNaN(Date.parse(body.endAt))
          ? new Date(Date.parse(body.endAt)).toISOString()
          : null,
      cron: null,
      notes: (body.notes || "").trim(),
      status: "planned",
      source: "local",
      googleEventId: null,
      googleHtmlLink: null,
      wakeups: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const events = readCalendarEvents();
    events.push(newEvent);
    writeCalendarEvents(events);
    return Response.json({ ok: true, event: newEvent });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/calendar/")) {
    const eventId = decodeURIComponent(url.pathname.slice("/api/calendar/".length)).trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(eventId)) {
      return Response.json({ error: "Invalid event ID" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      status?: string;
      title?: string;
      notes?: string;
      type?: string;
      startAt?: string;
    };
    const events = readCalendarEvents();
    const evt = events.find((e) => e.id === eventId);
    if (!evt) {
      return Response.json({ error: "Calendar event not found" }, { status: 404 });
    }
    if (body.status === "planned" || body.status === "done" || body.status === "cancelled") {
      evt.status = body.status;
    }
    if (typeof body.title === "string" && body.title.trim()) {
      evt.title = body.title.trim();
    }
    if (typeof body.notes === "string") {
      evt.notes = body.notes.trim();
    }
    if (
      body.type === "stream" ||
      body.type === "collab" ||
      body.type === "upload" ||
      body.type === "reminder" ||
      body.type === "deadline"
    ) {
      evt.type = body.type;
    }
    if (typeof body.startAt === "string" && !Number.isNaN(Date.parse(body.startAt))) {
      evt.startAt = new Date(Date.parse(body.startAt)).toISOString();
    }
    evt.updatedAt = new Date().toISOString();
    writeCalendarEvents(events);
    return Response.json({ ok: true, event: evt });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/calendar/")) {
    const eventId = decodeURIComponent(url.pathname.slice("/api/calendar/".length)).trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(eventId)) {
      return Response.json({ error: "Invalid event ID" }, { status: 400 });
    }
    const events = readCalendarEvents();
    const evt = events.find((e) => e.id === eventId);
    if (!evt) {
      return Response.json({ error: "Calendar event not found" }, { status: 404 });
    }
    const gw = await resolveGatewayBaseUrl((g) => /qstash|upstash/i.test(String(g.provider || "")));
    const revoked: string[] = [];
    for (const w of evt.wakeups || []) {
      if (w.status !== "armed") continue;
      if (gw) {
        const seg = w.kind === "recurring_cron" ? "schedules" : "messages";
        await fetch(`${gw}/v2/${seg}/${encodeURIComponent(w.qstashId)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
      w.status = "cancelled";
      revoked.push(w.qstashId);
    }
    let googleDeleted = false;
    if (evt.googleEventId) {
      const gCtx = await resolveServerGoogleCalendar();
      if (gCtx) {
        await execServerGCalTool(gCtx, "GOOGLECALENDAR_DELETE_EVENT", {
          calendar_id: "primary",
          event_id: evt.googleEventId,
        })
          .then(() => {
            googleDeleted = true;
          })
          .catch(() => {});
      }
    }
    evt.status = "cancelled";
    evt.updatedAt = new Date().toISOString();
    writeCalendarEvents(events);
    return Response.json({ ok: true, event: evt, revokedQStashIds: revoked, googleDeleted });
  }

  return null;
}
