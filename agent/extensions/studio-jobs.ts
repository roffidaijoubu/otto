import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function callInternalJobsApi<T = Record<string, unknown>>(
  endpoint: string,
  opts: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
): Promise<T> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) {
    throw new Error("LMA_INTERNAL_SECRET is unavailable — Studio Jobs control requires the lma-web supervisor.");
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
    signal: AbortSignal.timeout(25_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) {
    throw new Error(
      (typeof data.error === "string" && data.error) ||
        `Studio Jobs API ${opts.method ?? "GET"} ${endpoint} failed (HTTP ${res.status})`
    );
  }
  return data as T;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "studio_job_dispatch",
    label: "Dispatch Background Studio Job",
    description:
      "Unified dispatcher for launching any isolated background job (clip, thumbnail, obs_overlay, or archive_sync) so main Otto Chat stays free while the worker runs in the background with live RPC telemetry and nudging support.",
    parameters: Type.Object({
      kind: Type.Union([
        Type.Literal("clip"),
        Type.Literal("thumbnail"),
        Type.Literal("obs_overlay"),
        Type.Literal("archive_sync"),
      ]),
      prompt: Type.Optional(
        Type.String({
          description: "Detailed creative/technical brief (required for kind='thumbnail' and kind='obs_overlay').",
        })
      ),
      slug: Type.Optional(
        Type.String({
          description: "Optional existing slug to refine (for kind='thumbnail' or kind='obs_overlay').",
        })
      ),
      attachedImages: Type.Optional(
        Type.Array(Type.String(), {
          description: "Optional workspace-relative image paths under /home/sprite/workspace/ (e.g. ['uploads/img.png']).",
        })
      ),
      label: Type.Optional(
        Type.String({ description: "Short human-friendly progress title shown in the Jobs UI." })
      ),
      vodUrl: Type.Optional(
        Type.String({ description: "YouTube VOD URL or 11-char video ID (required for kind='clip')." })
      ),
      title: Type.Optional(
        Type.String({ description: "Optional display title for a clip job." })
      ),
      maxClips: Type.Optional(
        Type.Number({ description: "Clip count cap for kind='clip' (0 = full auto)." })
      ),
      focusNotes: Type.Optional(
        Type.String({ description: "Optional focus notes for kind='clip' (topic, timestamp, energy)." })
      ),
      channelUrl: Type.Optional(
        Type.String({ description: "Optional YouTube channel URL for kind='archive_sync'." })
      ),
      includeShorts: Type.Optional(
        Type.Boolean({ description: "Include Shorts in kind='archive_sync' (default true)." })
      ),
      limit: Type.Optional(
        Type.Number({ description: "Optional max video count for kind='archive_sync'." })
      ),
    }),
    async execute(_id, params) {
      const data = await callInternalJobsApi<{ jobId?: string }>("/api/internal/jobs/dispatch", {
        method: "POST",
        body: params as Record<string, unknown>,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { kind: params.kind, jobId: data.jobId },
      };
    },
  });

  pi.registerTool({
    name: "studio_jobs_list",
    label: "List Background Studio Jobs",
    description:
      "List active, queued, completed, failed, or cancelled background jobs across Clips, Thumbnails, OBS Overlays, and Channel Archive Sync — including whether each job has a live nudgeable RPC worker.",
    parameters: Type.Object({
      kind: Type.Optional(
        Type.Union([
          Type.Literal("clip"),
          Type.Literal("thumbnail"),
          Type.Literal("obs_overlay"),
          Type.Literal("archive_sync"),
        ])
      ),
      status: Type.Optional(
        Type.Union([
          Type.Literal("queued"),
          Type.Literal("running"),
          Type.Literal("done"),
          Type.Literal("failed"),
          Type.Literal("cancelled"),
        ])
      ),
      limit: Type.Optional(Type.Number({ description: "Max jobs to return (default 20)." })),
    }),
    async execute(_id, params) {
      const qs = new URLSearchParams();
      if (params.kind) qs.set("kind", params.kind);
      if (params.status) qs.set("status", params.status);
      if (typeof params.limit === "number") qs.set("limit", String(Math.max(1, Math.min(100, params.limit))));
      const query = qs.toString() ? `?${qs.toString()}` : "";
      const data = await callInternalJobsApi<{ jobs?: unknown[] }>(`/api/internal/jobs${query}`);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      return {
        content: [{ type: "text", text: JSON.stringify({ count: jobs.length, jobs }, null, 2) }],
        details: { count: jobs.length },
      };
    },
  });

  pi.registerTool({
    name: "studio_job_inspect",
    label: "Inspect Background Studio Job",
    description:
      "Peek inside a specific background job by jobId: returns full database state (status, stage, error, progress logs, original payload, clip plan if applicable) plus real-time live RPC worker telemetry (currentTool, elapsedSec, recent tool/output events) if currently running.",
    parameters: Type.Object({
      jobId: Type.String({ description: "The background job ID (from studio_jobs_list or job dispatch)." }),
    }),
    async execute(_id, params) {
      const data = await callInternalJobsApi(`/api/internal/jobs/${encodeURIComponent(params.jobId.trim())}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { jobId: params.jobId.trim() },
      };
    },
  });

  pi.registerTool({
    name: "studio_job_nudge",
    label: "Nudge Running Background Worker (RPC)",
    description:
      "Send a live mid-flight instruction or course-correction message directly into a currently running background OMP worker (clip, thumbnail, or obs_overlay) over its RPC stdin pipe without restarting it.",
    parameters: Type.Object({
      jobId: Type.String({ description: "The running job ID to nudge." }),
      message: Type.String({
        description:
          "Clear, actionable steering instruction for the running worker (e.g. 'Make the headline bigger and move it left', 'Skip weak filler clips and wrap up after clip 3').",
      }),
      mode: Type.Optional(
        Type.Union([Type.Literal("steer"), Type.Literal("follow_up")], {
          description:
            "'steer' (default) interrupts/steers the worker on its next step; 'follow_up' queues the instruction right after the current turn.",
        })
      ),
    }),
    async execute(_id, params) {
      const data = await callInternalJobsApi(
        `/api/internal/jobs/${encodeURIComponent(params.jobId.trim())}/nudge`,
        {
          method: "POST",
          body: {
            message: params.message,
            mode: params.mode ?? "steer",
          },
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { jobId: params.jobId.trim() },
      };
    },
  });

  pi.registerTool({
    name: "studio_job_resume",
    label: "Resume / Retry Failed Studio Job",
    description:
      "Restart or resume a failed, interrupted, or cancelled background job (clip jobs resume from their saved clip plan; thumbnail & OBS overlay jobs re-dispatch with their saved prompt & attachments; archive_sync restarts).",
    parameters: Type.Object({
      jobId: Type.String({ description: "The failed/interrupted/cancelled job ID to resume or retry." }),
    }),
    async execute(_id, params) {
      const data = await callInternalJobsApi(
        `/api/internal/jobs/${encodeURIComponent(params.jobId.trim())}/resume`,
        { method: "POST" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { jobId: params.jobId.trim() },
      };
    },
  });

  pi.registerTool({
    name: "studio_job_cancel",
    label: "Cancel Running Studio Job",
    description:
      "Abort and cancel a currently running or stuck background job (clip, thumbnail, obs_overlay, or archive_sync).",
    parameters: Type.Object({
      jobId: Type.String({ description: "The job ID to cancel." }),
    }),
    async execute(_id, params) {
      const data = await callInternalJobsApi(
        `/api/internal/jobs/${encodeURIComponent(params.jobId.trim())}/cancel`,
        { method: "POST" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { jobId: params.jobId.trim() },
      };
    },
  });
}
