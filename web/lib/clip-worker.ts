/**
 * Isolated Background VOD Clipper Worker (`web/lib/clip-worker.ts`).
 *
 * Runs autonomous VOD clipping jobs in a dedicated `omp --no-session` subprocess
 * completely separate from the main Otto Chat RPC thread, holding the Sprite awake
 * via Tasks API until completion and streaming live status into SQLite (`clip_jobs`, `clips`).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createClipJob,
  createStudioJob,
  getClipJob,
  listClipJobs,
  listClipRecords,
  updateClipJob,
  updateStudioJob,
  type ClipJob,
  type ClipPlanEntry,
  type ClipRecord,
} from "../../agent/lib/studio-db.ts";
import { cancelManagedWorker, runManagedRpcWorker } from "./rpc-worker.ts";

export interface ClipWorkerHooks {
  ompBin: string;
  workDir: string;
  port: number;
  internalSecret: string;
  onBroadcast: (payload: Record<string, unknown>) => void;
  onBusyChange: (busy: boolean) => void;
}

const activeWorkers = new Map<string, ReturnType<typeof Bun.spawn>>();
const cancelledJobs = new Set<string>();

export function extractYouTubeVideoId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") {
      const seg = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(seg)) return seg;
    }
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  } catch {
    // fall through
  }
  throw new Error(`Invalid YouTube VOD URL or 11-character video ID: ${urlOrId}`);
}

export function isClipWorkerBusy(): boolean {
  return activeWorkers.size > 0;
}

export function getActiveClipWorkerIds(): string[] {
  return Array.from(activeWorkers.keys());
}

/**
 * Mark any clip jobs left in `running`/`queued` from a previous server process as interrupted
 * so the UI never displays a permanently stuck spinner after a restart or deploy.
 */
export async function reconcileOrphanedClipJobs(): Promise<number> {
  let fixed = 0;
  for (const job of await listClipJobs(50)) {
    if ((job.status === "running" || job.status === "queued") && !activeWorkers.has(job.id)) {
      await updateClipJob(job.id, {
        status: "failed",
        stage: "Interrupted",
        error: "Server restarted while this background clip job was running. Cached chat/transcript data is preserved — re-run to resume fast.",
        logMessage: "Marked as interrupted after server restart (worker process no longer active).",
      });
      fixed += 1;
    }
  }
  return fixed;
}

export async function cancelBackgroundClipJob(
  jobId: string,
  onBroadcast: (payload: Record<string, unknown>) => void,
  onBusyChange: (busy: boolean) => void
): Promise<ClipJob | null> {
  cancelledJobs.add(jobId);
  await cancelManagedWorker(jobId).catch(() => {});
  const proc = activeWorkers.get(jobId);
  if (proc) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
    activeWorkers.delete(jobId);
  }
  const updated = await updateClipJob(jobId, {
    status: "cancelled",
    stage: "Cancelled",
    logMessage: "Background clip job cancelled by creator.",
  });
  await updateStudioJob(jobId, {
    status: "cancelled",
    stage: "Cancelled",
    logMessage: "Background clip job cancelled by creator.",
  }).catch(() => {});
  onBusyChange(activeWorkers.size > 0);
  onBroadcast({ type: "clips_changed", jobId });
  onBroadcast({ type: "jobs_changed", jobId });
  return updated;
}

function buildWorkerPrompt(job: ClipJob, resumeRemaining?: ClipPlanEntry[], alreadySaved?: ClipRecord[]): string {
  const focusLine = job.focusNotes
    ? `Creator focus instructions: ${job.focusNotes}`
    : "Creator focus instructions: Pick the highest-energy, funniest, most quotable, or most shareable standalone moments. Capture the full natural story arc (typically 45-210 seconds / up to ~3.5 minutes) — NEVER artificially cut a strong moment short at 60s, because Shorts support up to 3 minutes and a human editor will cut down the raw footage.";

  const isAuto = job.maxClips <= 0;
  const topK = isAuto ? 30 : Math.max(12, Math.min(40, job.maxClips * 2));
  const targetLine = isAuto
    ? "Target clip count: FULL AUTO — extract EVERY genuinely strong, distinct, clip-worthy moment across the full VOD (no arbitrary low cap; only skip weak/repetitive filler)."
    : `Target clip count: up to ${job.maxClips} clips (quality over quantity; skip weak moments).`;

  if (resumeRemaining && resumeRemaining.length > 0) {
    const savedSummary = (alreadySaved || [])
      .map((c) => `- "${c.title}" (${c.startSec ?? "?"}s-${c.endSec ?? "?"}s, saved at ${c.filePath})`)
      .join("\n");
    const remainingJson = JSON.stringify(resumeRemaining, null, 2);
    return [
      `RESUMED BACKGROUND VOD CLIPPING JOB (jobId: ${job.id}).`,
      `Target VOD: ${job.vodUrl} (videoId: ${job.videoId})`,
      `Already completed & saved clips (DO NOT re-cut these):`,
      savedSummary || "(none yet)",
      ``,
      `Remaining planned clips to process NOW (SKIP vod_scan_hype — the plan is already curated!):`,
      remainingJson,
      ``,
      `For EACH remaining clip above in order:`,
      `1. Call vod_update_job_progress(jobId="${job.id}", stage="Cutting clip <index>/<total>", message="Downloading and cutting <title>...")`,
      `2. Call vod_cut_clip(url="${job.vodUrl}", startSec=<startSec>, endSec=<endSec>, name="clip_<index>_<slug>").`,
      `3. Call vod_update_job_progress(jobId="${job.id}", stage="Normalizing clip <index>/<total>", message="Normalizing to CFR 30fps and -14 LUFS...")`,
      `4. Call vod_prep_clip(inputPath=<mp4_path from cut>).`,
      `5. Call vod_update_job_progress(jobId="${job.id}", stage="Reviewing clip <index>/<total>", message="Watching clip for 3-second hook and editor notes...")`,
      `6. Call watch_clip(target=<output_path from prep>).`,
      `7. Call vod_save_clip(jobId="${job.id}", videoId="${job.videoId}", title=<title>, filePath=<output_path from prep>, srtPath=<srt_path from prep (ElevenLabs Scribe) or srt_path from cut>, startSec=<startSec>, endSec=<endSec>, hookScore=<1-10>, editorNotes=<concise notes>, youtubeUrl=<youtube_url from cut>).`,
      `When all remaining clips are saved, call vod_update_job_progress(jobId="${job.id}", stage="Completed", message="Resumed job finished extracting all remaining clips.") and reply concisely.`,
    ].join("\n");
  }

  return [
    `AUTONOMOUS BACKGROUND VOD CLIPPING JOB (jobId: ${job.id}).`,
    `You are running in an isolated background worker outside the main chat. Complete the full pipeline end-to-end without asking questions.`,
    `Target VOD: ${job.vodUrl} (videoId: ${job.videoId})`,
    targetLine,
    focusLine,
    ``,
    `Execute these steps strictly in order:`,
    `1. Call vod_update_job_progress(jobId="${job.id}", stage="Scanning hype", message="Pulling live chat replay and transcript to detect hype peaks...")`,
    `2. Call vod_scan_hype(url="${job.vodUrl}", topK=${topK}). Inspect ALL returned candidate cards and select ${isAuto ? "every distinct, high-potential moment" : `up to ${job.maxClips} distinct, high-potential moments`} with clean, complete start/end boundaries (typically 45-210s / up to ~3.5 min — NEVER artificially cap at 60s; include 3-5s pre-roll setup and let the full payoff/reaction land so a human editor can cut it down cleanly).`,
    `2b. IMPORTANT (Resumable Checkpoint): Immediately call vod_save_clip_plan(jobId="${job.id}", clips=[{ index: 1, title: "...", startSec: ..., endSec: ..., reason: "..." }, ...]) BEFORE cutting clip #1 so progress can be resumed if anything interrupts the run!`,
    `3. For each selected clip (1..N):`,
    `   a. Call vod_update_job_progress(jobId="${job.id}", stage="Cutting clip i/N", message="Downloading and cutting <short title>...")`,
    `   b. Call vod_cut_clip(url="${job.vodUrl}", startSec=..., endSec=..., name="clip_0i_<slug>").`,
    `   c. Call vod_update_job_progress(jobId="${job.id}", stage="Normalizing clip i/N", message="Normalizing to CFR 30fps and -14 LUFS for human editor...")`,
    `   d. Call vod_prep_clip(inputPath=<mp4_path from cut>).`,
    `   e. Call vod_update_job_progress(jobId="${job.id}", stage="Reviewing clip i/N", message="Watching clip for 3-second hook and editor notes...")`,
    `   f. Call watch_clip(target=<output_path from prep>) to inspect the actual hook, framing, and audio.`,
    `   g. Call vod_save_clip(jobId="${job.id}", videoId="${job.videoId}", title=<punchy title>, filePath=<output_path from prep>, srtPath=<srt_path from prep (ElevenLabs Scribe) or srt_path from cut>, startSec=..., endSec=..., hookScore=<1-10>, editorNotes=<concise actionable notes for human editor>, youtubeUrl=<youtube_url from cut>).`,
    `4. When all clips are saved, call vod_update_job_progress(jobId="${job.id}", stage="Completed", message="Finished extracting and reviewing clips for human editor handoff.")`,
    `5. Reply with a single concise line summarizing how many clips were saved.`,
  ].join("\n");
}

export async function startBackgroundClipJob(
  input: {
    vodUrl: string;
    videoId?: string;
    title?: string;
    maxClips?: number;
    focusNotes?: string;
  },
  hooks: ClipWorkerHooks
): Promise<ClipJob> {
  const videoId = input.videoId?.trim() || extractYouTubeVideoId(input.vodUrl);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const job = await createClipJob({
    vodUrl: canonicalUrl,
    videoId,
    title: input.title?.trim() || `VOD ${videoId}`,
    maxClips: input.maxClips ?? 0,
    focusNotes: input.focusNotes ?? "",
  });

  const runningJob =
    (await updateClipJob(job.id, {
      status: "running",
      stage: "Preflight check",
      logMessage: "Checking VOD availability and downloadability with yt-dlp before scanning...",
    })) ?? job;

  await createStudioJob({
    id: job.id,
    kind: "clip",
    targetSlug: videoId,
    title: runningJob.title,
    stage: "Preflight check",
    status: "running",
    payload: {
      vodUrl: canonicalUrl,
      videoId,
      title: runningJob.title,
      maxClips: runningJob.maxClips,
      focusNotes: runningJob.focusNotes,
    },
    logMessage: "Checking VOD availability and downloadability...",
  }).catch(() => {});

  hooks.onBusyChange(true);
  hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
  hooks.onBroadcast({ type: "jobs_changed", jobId: job.id });

  launchClipWorkerLoop(runningJob, input.title, hooks);
  return runningJob;
}

export async function resumeBackgroundClipJob(
  jobId: string,
  hooks: ClipWorkerHooks
): Promise<ClipJob> {
  const existing = await getClipJob(jobId);
  if (!existing) throw new Error(`Clip job not found: ${jobId}`);
  if (activeWorkers.has(jobId)) return existing;

  const savedClips = await listClipRecords({ jobId, limit: 100 });
  const wsRoot = path.resolve(process.env.LMA_WORKSPACE_DIR || path.join(process.env.HOME || "/home/sprite", "workspace"));
  const verifiedSaved = savedClips.filter((c) => {
    const abs = path.join(wsRoot, c.filePath.replace(/^\/+/, ""));
    return fs.existsSync(abs);
  });

  let remaining: ClipPlanEntry[] | undefined;
  if (existing.planJson.length > 0) {
    remaining = existing.planJson.filter((plan) => {
      return !verifiedSaved.some((saved) => {
        if (saved.startSec !== null && saved.endSec !== null) {
          return Math.abs(saved.startSec - plan.startSec) <= 8 && Math.abs(saved.endSec - plan.endSec) <= 8;
        }
        return saved.title.toLowerCase() === plan.title.toLowerCase();
      });
    });
    if (remaining.length === 0 && verifiedSaved.length > 0) {
      const done = (await updateClipJob(jobId, {
        status: "done",
        stage: "Completed",
        error: "",
        logMessage: `All ${verifiedSaved.length} planned clips are already saved.`,
      })) ?? existing;
      await updateStudioJob(jobId, {
        status: "done",
        stage: "Completed",
        error: "",
        logMessage: `All ${verifiedSaved.length} planned clips already saved.`,
      }).catch(() => {});
      hooks.onBroadcast({ type: "clips_changed", jobId });
      hooks.onBroadcast({ type: "jobs_changed", jobId });
      return done;
    }
  }

  const resumed = (await updateClipJob(jobId, {
    status: "running",
    stage: remaining ? `Resuming (${verifiedSaved.length}/${existing.planJson.length} done)` : "Resuming...",
    error: "",
    completedAt: null,
    logMessage: remaining
      ? `Resuming clip job — skipping ${verifiedSaved.length} already-saved clip(s), cutting ${remaining.length} remaining.`
      : "Resuming clip job using cached chat/transcript data.",
  })) ?? existing;

  await updateStudioJob(jobId, {
    status: "running",
    stage: resumed.stage,
    error: "",
    completedAt: null,
    logMessage: remaining
      ? `Resuming (${remaining.length} clips remaining).`
      : "Resuming clip job.",
  }).catch(() => {});

  hooks.onBusyChange(true);
  hooks.onBroadcast({ type: "clips_changed", jobId });
  hooks.onBroadcast({ type: "jobs_changed", jobId });

  launchClipWorkerLoop(resumed, resumed.title, hooks, remaining, verifiedSaved);
  return resumed;
}

function launchClipWorkerLoop(
  job: ClipJob,
  explicitTitle: string | undefined,
  hooks: ClipWorkerHooks,
  resumeRemaining?: ClipPlanEntry[],
  alreadySaved?: ClipRecord[]
): void {
  const videoId = job.videoId;
  const canonicalUrl = job.vodUrl;
  const runningJob = job;

  // Run fast yt-dlp preflight check asynchronously (2-4s) before burning LLM tokens or chat-scan time
  void (async () => {
    const ytDlpBin = `${process.env.HOME || "/home/sprite"}/.local/bin/yt-dlp`;
    const bin = await Bun.file(ytDlpBin).exists() ? ytDlpBin : "yt-dlp";
    const preflight = Bun.spawn(
      [bin, "--simulate", "--no-warnings", "--no-playlist", "--print", "%(title)s", canonicalUrl],
      {
        cwd: hooks.workDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    activeWorkers.set(job.id, preflight);

    const [pfOut, pfErr, pfCode] = await Promise.all([
      new Response(preflight.stdout).text(),
      new Response(preflight.stderr).text(),
      preflight.exited,
    ]);

    if (cancelledJobs.has(job.id)) {
      activeWorkers.delete(job.id);
      cancelledJobs.delete(job.id);
      hooks.onBusyChange(activeWorkers.size > 0);
      hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
      return;
    }

    if (pfCode !== 0) {
      activeWorkers.delete(job.id);
      const rawErr = (pfErr || pfOut || "").trim();
      let friendly = rawErr.split("\n").filter(Boolean).slice(-2).join(" — ") || `yt-dlp preflight failed (exit ${pfCode})`;
      if (/sign in to confirm your age|age-restricted/i.test(rawErr)) {
        friendly = `VOD ${videoId} is age-restricted on YouTube — yt-dlp cannot download or cut clips without authenticated cookies (Otto stays zero-cookie). Try a non-age-restricted public VOD.`;
      } else if (/members-only|join this channel/i.test(rawErr)) {
        friendly = `VOD ${videoId} is members-only and cannot be downloaded anonymously.`;
      } else if (/private video|unavailable/i.test(rawErr)) {
        friendly = `VOD ${videoId} is private or unavailable on YouTube.`;
      }
      await updateClipJob(job.id, {
        status: "failed",
        stage: "Preflight blocked",
        error: friendly,
        logMessage: friendly,
      });
      await updateStudioJob(job.id, {
        status: "failed",
        stage: "Preflight blocked",
        error: friendly,
        logMessage: friendly,
      }).catch(() => {});
      hooks.onBusyChange(activeWorkers.size > 0);
      hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
      hooks.onBroadcast({ type: "jobs_changed", jobId: job.id });
      return;
    }

    const discoveredTitle = pfOut.trim().split("\n")[0]?.trim();
    const effectiveJob =
      (await updateClipJob(job.id, {
        ...(discoveredTitle && (!explicitTitle || !explicitTitle.trim()) ? { title: discoveredTitle } : {}),
        stage: resumeRemaining ? "Resuming worker" : "Starting worker",
        logMessage: `Preflight OK${discoveredTitle ? ` ("${discoveredTitle}")` : ""}. Launching isolated background clipper worker...`,
      })) ?? runningJob;
    await updateStudioJob(job.id, {
      title: effectiveJob.title,
      stage: effectiveJob.stage,
    }).catch(() => {});
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
    hooks.onBroadcast({ type: "jobs_changed", jobId: job.id });

    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      LMA_INTERNAL_SECRET: hooks.internalSecret,
      LMA_WEB_PORT: String(hooks.port),
    };
    delete childEnv.LMA_WEB_PASSWORD;
    delete childEnv.QSTASH_CURRENT_SIGNING_KEY;
    delete childEnv.QSTASH_NEXT_SIGNING_KEY;

    const workerTools = [
      "vod_scan_hype",
      "vod_save_clip_plan",
      "vod_cut_clip",
      "vod_prep_clip",
      "watch_clip",
      "vod_update_job_progress",
      "vod_save_clip",
    ].join(",");

    const prompt = buildWorkerPrompt(effectiveJob, resumeRemaining, alreadySaved);

    // Periodically notify connected Clips windows while the worker writes progress
    const pollTimer = setInterval(() => {
      hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
    }, 2500);

    // Release preflight proc placeholder from activeWorkers — managed RPC registry now owns lifecycle
    activeWorkers.delete(job.id);
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });

    const workerRes = await runManagedRpcWorker({
      jobId: job.id,
      kind: "clip",
      tools: workerTools,
      prompt,
      env: childEnv,
      ompBin: hooks.ompBin,
      workDir: hooks.workDir,
      timeoutMs: 30 * 60 * 1000,
      onToolStart: () => {
        hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
        hooks.onBroadcast({ type: "jobs_changed", jobId: job.id });
      },
    });

    clearInterval(pollTimer);
    activeWorkers.delete(job.id);
    const wasCancelled = cancelledJobs.delete(job.id) || workerRes.aborted;
    const current = await getClipJob(job.id);

    if (!wasCancelled && current && current.status === "running") {
      const savedForJob = await listClipRecords({ jobId: job.id, limit: 1 });
      if (workerRes.ok && savedForJob.length > 0) {
        await updateClipJob(job.id, {
          status: "done",
          stage: "Completed",
          logMessage: "Background clipper worker finished.",
        });
        await updateStudioJob(job.id, { status: "done", stage: "Completed", logMessage: "Clips ready." }).catch(() => {});
      } else if (workerRes.ok && savedForJob.length === 0) {
        const msg =
          current.progressLog[current.progressLog.length - 1]?.message ||
          "Worker finished without saving any clips.";
        await updateClipJob(job.id, {
          status: "failed",
          stage: "No clips produced",
          error: msg,
          logMessage: "Worker exited with 0 saved clips.",
        });
        await updateStudioJob(job.id, { status: "failed", stage: "No clips produced", error: msg }).catch(() => {});
      } else {
        const errText = workerRes.error || `Worker exited with code ${workerRes.exitCode}`;
        await updateClipJob(job.id, {
          status: "failed",
          stage: "Failed",
          error: errText,
          logMessage: `Background clipper worker exited with error: ${errText.slice(0, 180)}`,
        });
        await updateStudioJob(job.id, { status: "failed", stage: "Failed", error: errText }).catch(() => {});
      }
    }

    hooks.onBusyChange(activeWorkers.size > 0);
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
    hooks.onBroadcast({ type: "jobs_changed", jobId: job.id });
    hooks.onBroadcast({ type: "workspace_changed" });
  })();
}
