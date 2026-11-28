import {
  commitQStashReplayToken,
  verifyUpstashSignatureWithReceipt,
} from "../lib/qstash.ts";
import { syncAllMetrics, resolveTimezone } from "../lib/metrics-service.ts";
import { runScheduledAutoSnapshot } from "../lib/checkpoints.ts";
import { startSilentBackgroundJob } from "../lib/background-job.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { broadcast } from "../lib/sse.ts";
import { errorMessage } from "../lib/http.ts";

// Synchronous in-flight claims prevent concurrent QStash redeliveries from double-executing
// slow deterministic jobs (`checkpoint`, `metrics_sync`) or racing before commit.
const inFlightReplayKeys = new Set<string>();
const inFlightDeterministicModes = new Set<"checkpoint" | "metrics_sync">();

export async function handleWakeupRoutes(req: Request, url: URL): Promise<Response | null> {
  // Cryptographically signed Upstash QStash wake-up webhook
  if (req.method === "POST" && url.pathname === "/api/wakeup") {
    const rawBody = await req.text();
    const receipt = verifyUpstashSignatureWithReceipt(req, rawBody);
    if (!receipt) {
      return Response.json({ error: "Invalid Upstash-Signature" }, { status: 401 });
    }
    if (inFlightReplayKeys.has(receipt.replayKey)) {
      return Response.json(
        { error: "Wake-up delivery already in progress; retry shortly" },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const label = typeof payload.label === "string" ? payload.label : "Scheduled Wake-Up";

    // Deterministic zero-LLM daily workspace snapshot (Fly.io Sprite Checkpoint)
    if (payload.mode === "checkpoint") {
      if (inFlightDeterministicModes.has("checkpoint")) {
        return Response.json(
          { error: "Checkpoint snapshot already in progress; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }
      inFlightReplayKeys.add(receipt.replayKey);
      inFlightDeterministicModes.add("checkpoint");
      const releaseBg = rpc.beginBackgroundJob("wakeup-checkpoint");
      void rpc.holdSpriteActive();
      try {
        const res = await runScheduledAutoSnapshot();
        if (res.ok) {
          commitQStashReplayToken(receipt.replayKey, receipt.expiresAtSec);
        }
        return Response.json(
          { ok: res.ok, mode: "checkpoint", label, id: res.id, comment: res.comment, error: res.error },
          { status: res.ok ? 200 : 500 }
        );
      } finally {
        inFlightDeterministicModes.delete("checkpoint");
        inFlightReplayKeys.delete(receipt.replayKey);
        releaseBg();
      }
    }

    // Deterministic zero-LLM daily multi-platform metrics sync (YouTube + TikTok + IG + X)
    if (payload.mode === "metrics_sync") {
      if (inFlightDeterministicModes.has("metrics_sync")) {
        return Response.json(
          { error: "Metrics sync already in progress; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }
      inFlightReplayKeys.add(receipt.replayKey);
      inFlightDeterministicModes.add("metrics_sync");
      const releaseBg = rpc.beginBackgroundJob("wakeup-metrics");
      void rpc.holdSpriteActive();
      try {
        const { ytRes, socialRes } = await syncAllMetrics(resolveTimezone());
        const anyOk = ytRes.ok || socialRes.some((r) => r.ok);
        const allOk = ytRes.ok && socialRes.every((r) => r.ok);
        if (anyOk) {
          broadcast({ type: "db_changed" });
        }
        // Only commit replay token when every attempted leg succeeded so partial failures remain retryable
        if (allOk) {
          commitQStashReplayToken(receipt.replayKey, receipt.expiresAtSec);
        }
        return Response.json(
          {
            ok: allOk,
            partial: anyOk && !allOk,
            mode: "metrics_sync",
            label,
            error: ytRes.error,
            socials: socialRes.map((r) => ({ platform: r.platform, ok: r.ok, error: r.error })),
          },
          { status: allOk ? 200 : anyOk ? 503 : 500, headers: allOk ? {} : { "Retry-After": "15" } }
        );
      } finally {
        inFlightDeterministicModes.delete("metrics_sync");
        inFlightReplayKeys.delete(receipt.replayKey);
        releaseBg();
      }
    }

    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      return Response.json({ error: "Missing prompt" }, { status: 400 });
    }
    const isSilent = payload.silent === true || payload.mode === "background";
    const jobType =
      typeof payload.jobType === "string"
        ? payload.jobType
        : isSilent
          ? "background"
          : "wakeup";

    // Do NOT consume replay token when busy: QStash retries after Retry-After with the same jti
    if (rpc.isAnyBusy()) {
      return Response.json(
        { error: "Agent busy; retry shortly" },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }

    if (isSilent) {
      // Claim replay key + background job slot synchronously before awaiting Tasks API hold
      inFlightReplayKeys.add(receipt.replayKey);
      const releaseBg = rpc.beginBackgroundJob("wakeup-silent");
      try {
        await rpc.holdSpriteActive();
        commitQStashReplayToken(receipt.replayKey, receipt.expiresAtSec);
        startSilentBackgroundJob({ label, prompt, jobType, releaseBg });
        return Response.json({ ok: true, mode: "background", silent: true, label, jobType });
      } catch (err) {
        releaseBg();
        throw err;
      } finally {
        inFlightReplayKeys.delete(receipt.replayKey);
      }
    }

    // Claim replay key + busy synchronously before awaiting Tasks API hold and keep lock held into rpc.prompt()
    inFlightReplayKeys.add(receipt.replayKey);
    rpc.busy = true;
    const wakeupMsg = `[SCHEDULED WAKE-UP: ${label}]\n${prompt}`;
    try {
      await rpc.holdSpriteActive();
      if (!rpc.busy) {
        rpc.releaseSpriteHold();
        return Response.json(
          { error: "Wake-up cancelled before dispatch; retry shortly" },
          { status: 503, headers: { "Retry-After": "15" } }
        );
      }
      await rpc.prompt(wakeupMsg, { lockAlreadyHeld: true });
      commitQStashReplayToken(receipt.replayKey, receipt.expiresAtSec);
      return Response.json({ ok: true, mode: "chat", label });
    } catch (err) {
      console.error("[lma-web] wakeup prompt error:", errorMessage(err));
      rpc.busy = false;
      rpc.releaseSpriteHold();
      // Do NOT consume replay token on 503 dispatch failure so QStash retry succeeds
      return Response.json(
        { error: "Failed to dispatch wake-up; retry shortly" },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    } finally {
      inFlightReplayKeys.delete(receipt.replayKey);
    }
  }

  return null;
}
