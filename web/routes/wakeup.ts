import { verifyUpstashSignature } from "../lib/qstash.ts";
import { syncAllMetrics, resolveTimezone } from "../lib/metrics-service.ts";
import { runScheduledAutoSnapshot } from "../lib/checkpoints.ts";
import { startSilentBackgroundJob } from "../lib/background-job.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { broadcast } from "../lib/sse.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleWakeupRoutes(req: Request, url: URL): Promise<Response | null> {
  // Cryptographically signed Upstash QStash wake-up webhook
  if (req.method === "POST" && url.pathname === "/api/wakeup") {
    const rawBody = await req.text();
    if (!verifyUpstashSignature(req, rawBody)) {
      return Response.json({ error: "Invalid Upstash-Signature" }, { status: 401 });
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
      const res = await runScheduledAutoSnapshot();
      return Response.json(
        { ok: res.ok, mode: "checkpoint", label, id: res.id, comment: res.comment, error: res.error },
        { status: res.ok ? 200 : 500 }
      );
    }

    // Deterministic zero-LLM daily multi-platform metrics sync (YouTube + TikTok + IG + X)
    if (payload.mode === "metrics_sync") {
      const { ytRes, socialRes } = await syncAllMetrics(resolveTimezone());
      const anyOk = ytRes.ok || socialRes.some((r) => r.ok);
      if (anyOk) broadcast({ type: "db_changed" });
      return Response.json(
        {
          ok: anyOk,
          mode: "metrics_sync",
          label,
          error: ytRes.error,
          socials: socialRes.map((r) => ({ platform: r.platform, ok: r.ok, error: r.error })),
        },
        { status: anyOk ? 200 : 500 }
      );
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

    if (rpc.isAnyBusy()) {
      return Response.json(
        { error: "Agent busy; retry shortly" },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }

    if (isSilent) {
      // Claim background job slot synchronously before awaiting Tasks API hold so concurrent calls cannot race
      const releaseBg = rpc.beginBackgroundJob("wakeup-silent");
      try {
        await rpc.holdSpriteActive();
      } catch (err) {
        releaseBg();
        throw err;
      }
      startSilentBackgroundJob({ label, prompt, jobType, releaseBg });
      return Response.json({ ok: true, mode: "background", silent: true, label, jobType });
    }

    // Claim busy synchronously before awaiting Tasks API hold and keep lock held into rpc.prompt() (no TOCTOU window)
    rpc.busy = true;
    const wakeupMsg = `[SCHEDULED WAKE-UP: ${label}]\n${prompt}`;
    try {
      await rpc.holdSpriteActive();
      await rpc.prompt(wakeupMsg, { lockAlreadyHeld: true });
    } catch (err) {
      console.error("[lma-web] wakeup prompt error:", errorMessage(err));
      rpc.busy = false;
      rpc.releaseSpriteHold();
      return Response.json(
        { error: "Failed to dispatch wake-up; retry shortly" },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }
    return Response.json({ ok: true, mode: "chat", label });
  }

  return null;
}
