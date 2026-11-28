import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  buildPresetHookSpec,
  cancelQStashJob,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  execGoogleCalendarTool,
  extractGCalPayload,
  getGoogleCalendarContext,
  inferEventTypeFromTitle,
  loadCalendar,
  makeEventId,
  patchGoogleCalendarEvent,
  publishQStashWakeup,
  saveCalendar,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarWakeupHook,
  type GoogleReminderOverride,
  type LifecycleHookPreset,
} from "../lib/scheduler-core.ts";

export default function (pi: ExtensionAPI) {
  // 4. Calendar: Add Event with Google Calendar Reminders & Proactive Lifecycle Hooks (Tier 2)
  pi.registerTool({
    name: "calendar_add_event",
    label: "Add Calendar Event & Reminder",
    description:
      "Add a stream, collab, upload, reminder, or deadline to the persistent Schedule calendar and Google Calendar with custom push/email notifications (`reminders`), plus optional proactive QStash wake-up hooks for Otto's own background work. IMPORTANT: Whenever the creator asks 'remind me...' or 'ingetin aku...', ALWAYS use this tool with type='reminder' and Google Calendar `reminders` (defaults to 0-minute popup so their phone & desktop notify right on time).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event or reminder title (e.g. 'Friday Night Collab: Horror Co-op' or 'Upload thumbnail before stream').",
        },
        type: {
          type: "string",
          enum: ["stream", "collab", "upload", "reminder", "deadline"],
          description: "Category of calendar event. Use 'reminder' whenever the creator asks to be reminded.",
        },
        startAt: {
          type: "string",
          description: "ISO-8601 start timestamp with timezone (e.g. '2026-11-27T20:00:00+07:00').",
        },
        durationMinutes: {
          type: "number",
          description: "Duration in minutes (defaults to 180 for stream/collab, 15 for reminder, 60 otherwise).",
        },
        notes: {
          type: "string",
          description: "Optional context: collab partner, game/topic, or prep notes.",
        },
        reminders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              method: {
                type: "string",
                enum: ["popup", "email"],
                description: "Notification channel: 'popup' (phone/desktop push) or 'email'. Default: 'popup'.",
              },
              minutes: {
                type: "number",
                description: "Minutes before startAt to trigger notification (0 = exact time, 15 = 15m before, 60 = 1h before, 1440 = 24h before).",
              },
            },
            required: ["minutes"],
          },
          description:
            "Custom Google Calendar notifications. Defaults automatically: 0m popup for 'reminder', 60m + 15m popup for 'stream'/'collab', 60m + 10m popup for 'deadline'/'upload'.",
        },
        hooks: {
          type: "array",
          items: {
            type: "string",
            enum: ["promo_24h", "pre_stream_1h", "post_stream_vod_30m", "at_start"],
          },
          description:
            "Optional proactive QStash wake-up presets for Otto's autonomous background work. Past trigger times are skipped safely.",
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
        reminders?: Array<{ method?: "popup" | "email"; minutes: number }>;
        hooks?: LifecycleHookPreset[];
      }
    ) {
      const startMs = Date.parse(params.startAt);
      if (Number.isNaN(startMs)) {
        throw new Error(`Invalid startAt ISO timestamp: ${params.startAt}`);
      }
      const defaultDur =
        params.type === "stream" || params.type === "collab"
          ? 180
          : params.type === "reminder"
            ? 15
            : 60;
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
        reminders: params.reminders,
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
      const store = await loadCalendar();
      store.events.push(evt);
      await saveCalendar(store);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                event: evt,
                googleSynced: Boolean(gcal.googleEventId),
                googleReminders: gcal.appliedReminders ?? null,
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
      const store = await loadCalendar();
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
      const store = await loadCalendar();
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
      await saveCalendar(store);

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
      const store = await loadCalendar();
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
      await saveCalendar(store);

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

      const store = await loadCalendar();
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

      await saveCalendar(store);
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

