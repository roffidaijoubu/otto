import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  cancelQStashJob,
  getQStashGatewayUrl,
  loadCalendar,
  makeEventId,
  publishQStashWakeup,
  saveCalendar,
  type CalendarEvent,
} from "../lib/scheduler-core.ts";
export type { CalendarEvent, CalendarEventType, CalendarWakeupHook, GoogleReminderOverride, LifecycleHookPreset } from "../lib/scheduler-core.ts";

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
      const store = await loadCalendar();
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
      await saveCalendar(store);

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
      const store = await loadCalendar();
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
      const store = await loadCalendar();
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
      if (touched) await saveCalendar(store);

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, cancelled: params.id }) }],
        details: {},
      };
    },
  });

}
