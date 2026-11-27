/**
 * Isolated Background VOD Clipper Worker (`web/lib/clip-worker.ts`).
 *
 * Runs autonomous VOD clipping jobs in a dedicated `omp --no-session` subprocess
 * completely separate from the main Otto Chat RPC thread, holding the Sprite awake
 * via Tasks API until completion and streaming live status into SQLite (`clip_jobs`, `clips`).
 */

import {
  createClipJob,
  getClipJob,
  listClipJobs,
  listClipRecords,
  updateClipJob,
  type ClipJob,
} from "../../agent/lib/studio-db.ts";

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
export function reconcileOrphanedClipJobs(): number {
  let fixed = 0;
  for (const job of listClipJobs(50)) {
    if ((job.status === "running" || job.status === "queued") && !activeWorkers.has(job.id)) {
      updateClipJob(job.id, {
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

export function cancelBackgroundClipJob(
  jobId: string,
  onBroadcast: (payload: Record<string, unknown>) => void,
  onBusyChange: (busy: boolean) => void
): ClipJob | null {
  cancelledJobs.add(jobId);
  const proc = activeWorkers.get(jobId);
  if (proc) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
    activeWorkers.delete(jobId);
  }
  const updated = updateClipJob(jobId, {
    status: "cancelled",
    stage: "Cancelled",
    logMessage: "Background clip job cancelled by creator.",
  });
  onBusyChange(activeWorkers.size > 0);
  onBroadcast({ type: "clips_changed", jobId });
  return updated;
}

function buildWorkerPrompt(job: ClipJob): string {
  const focusLine = job.focusNotes
    ? `Creator focus instructions: ${job.focusNotes}`
    : "Creator focus instructions: Pick the highest-energy, funniest, most quotable, or most shareable standalone moments (30-75 seconds each).";

  const isAuto = job.maxClips <= 0;
  const topK = isAuto ? 30 : Math.max(12, Math.min(40, job.maxClips * 2));
  const targetLine = isAuto
    ? "Target clip count: FULL AUTO — extract EVERY genuinely strong, distinct, clip-worthy moment across the full VOD (no arbitrary low cap; only skip weak/repetitive filler)."
    : `Target clip count: up to ${job.maxClips} clips (quality over quantity; skip weak moments).`;

  return [
    `AUTONOMOUS BACKGROUND VOD CLIPPING JOB (jobId: ${job.id}).`,
    `You are running in an isolated background worker outside the main chat. Complete the full pipeline end-to-end without asking questions.`,
    `Target VOD: ${job.vodUrl} (videoId: ${job.videoId})`,
    targetLine,
    focusLine,
    ``,
    `Execute these steps strictly in order:`,
    `1. Call vod_update_job_progress(jobId="${job.id}", stage="Scanning hype", message="Pulling live chat replay and transcript to detect hype peaks...")`,
    `2. Call vod_scan_hype(url="${job.vodUrl}", topK=${topK}). Inspect ALL returned candidate cards and select ${isAuto ? "every distinct, high-potential moment" : `up to ${job.maxClips} distinct, high-potential moments`} with clean start/end boundaries (30-75s each, with pre-roll context).`,
    `3. For each selected clip (1..N):`,
    `   a. Call vod_update_job_progress(jobId="${job.id}", stage="Cutting clip i/N", message="Downloading and cutting <short title>...")`,
    `   b. Call vod_cut_clip(url="${job.vodUrl}", startSec=..., endSec=..., name="clip_0i_<slug>").`,
    `   c. Call vod_update_job_progress(jobId="${job.id}", stage="Normalizing clip i/N", message="Normalizing to CFR 30fps and -14 LUFS for human editor...")`,
    `   d. Call vod_prep_clip(inputPath=<mp4_path from cut>).`,
    `   e. Call vod_update_job_progress(jobId="${job.id}", stage="Reviewing clip i/N", message="Watching clip for 3-second hook and editor notes...")`,
    `   f. Call watch_clip(target=<output_path from prep>) to inspect the actual hook, framing, and audio.`,
    `   g. Call vod_save_clip(jobId="${job.id}", videoId="${job.videoId}", title=<punchy title>, filePath=<output_path from prep>, srtPath=<srt_path from cut if present>, startSec=..., endSec=..., hookScore=<1-10>, editorNotes=<concise actionable notes for human editor>, youtubeUrl=<youtube_url from cut>).`,
    `4. When all clips are saved, call vod_update_job_progress(jobId="${job.id}", stage="Completed", message="Finished extracting and reviewing clips for human editor handoff.")`,
    `5. Reply with a single concise line summarizing how many clips were saved.`,
  ].join("\n");
}

export function startBackgroundClipJob(
  input: {
    vodUrl: string;
    videoId?: string;
    title?: string;
    maxClips?: number;
    focusNotes?: string;
  },
  hooks: ClipWorkerHooks
): ClipJob {
  const videoId = input.videoId?.trim() || extractYouTubeVideoId(input.vodUrl);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const job = createClipJob({
    vodUrl: canonicalUrl,
    videoId,
    title: input.title?.trim() || `VOD ${videoId}`,
    maxClips: input.maxClips ?? 0,
    focusNotes: input.focusNotes ?? "",
  });

  const runningJob =
    updateClipJob(job.id, {
      status: "running",
      stage: "Preflight check",
      logMessage: "Checking VOD availability and downloadability with yt-dlp before scanning...",
    }) ?? job;

  hooks.onBusyChange(true);
  hooks.onBroadcast({ type: "clips_changed", jobId: job.id });

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
      updateClipJob(job.id, {
        status: "failed",
        stage: "Preflight blocked",
        error: friendly,
        logMessage: friendly,
      });
      hooks.onBusyChange(activeWorkers.size > 0);
      hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
      return;
    }

    const discoveredTitle = pfOut.trim().split("\n")[0]?.trim();
    const effectiveJob =
      updateClipJob(job.id, {
        ...(discoveredTitle && (!input.title || !input.title.trim()) ? { title: discoveredTitle } : {}),
        stage: "Starting worker",
        logMessage: `Preflight OK${discoveredTitle ? ` ("${discoveredTitle}")` : ""}. Launching isolated background clipper worker...`,
      }) ?? runningJob;
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });

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
      "vod_cut_clip",
      "vod_prep_clip",
      "watch_clip",
      "vod_update_job_progress",
      "vod_save_clip",
    ].join(",");

    const prompt = buildWorkerPrompt(effectiveJob);

    const proc = Bun.spawn(
      [hooks.ompBin, "--no-session", "--tools", workerTools, "-p", prompt],
      {
        cwd: hooks.workDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      }
    );

    activeWorkers.set(job.id, proc);
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });

    // Periodically notify connected Clips windows while the worker writes SQLite progress
    const pollTimer = setInterval(() => {
      hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
    }, 2500);

    let stderrTail = "";
    (async () => {
      if (!proc.stderr) return;
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stderrTail = (stderrTail + decoder.decode(value, { stream: true })).slice(-1600);
        }
      } catch {
        // ignore
      }
    })();

    const code = await proc.exited;
    clearInterval(pollTimer);
    activeWorkers.delete(job.id);
    const wasCancelled = cancelledJobs.delete(job.id);
    const current = getClipJob(job.id);

    if (!wasCancelled && current && current.status === "running") {
      const savedForJob = listClipRecords({ jobId: job.id, limit: 1 });
      if (code === 0 && savedForJob.length > 0) {
        updateClipJob(job.id, {
          status: "done",
          stage: "Completed",
          logMessage: "Background clipper worker finished.",
        });
      } else if (code === 0 && savedForJob.length === 0) {
        updateClipJob(job.id, {
          status: "failed",
          stage: "No clips produced",
          error:
            current.progressLog[current.progressLog.length - 1]?.message ||
            "Worker finished without saving any clips.",
          logMessage: "Worker exited with 0 saved clips.",
        });
      } else {
        updateClipJob(job.id, {
          status: "failed",
          stage: "Failed",
          error: stderrTail.trim() || `Worker exited with code ${code}`,
          logMessage: `Background clipper worker exited with code ${code}.`,
        });
      }
    }

    hooks.onBusyChange(activeWorkers.size > 0);
    hooks.onBroadcast({ type: "clips_changed", jobId: job.id });
    hooks.onBroadcast({ type: "workspace_changed" });
  })();

  return runningJob;
}
