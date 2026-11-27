import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  listClipJobs,
  updateClipJob,
  upsertClipRecord,
} from "../lib/studio-db.ts";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/home/sprite";
const SCRIPTS_DIR = path.join(HOME, ".omp", "agent", "skills", "raw-clip-finder", "scripts");
const WORKSPACE_ROOT = path.resolve(process.env.LMA_WORKSPACE_DIR || path.join(HOME, "workspace"));
const CLIPS_ROOT = path.join(WORKSPACE_ROOT, "clips");

function extractVideoId(urlOrId: string): string {
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
  throw new Error(`Could not extract 11-character YouTube video ID from: ${urlOrId}`);
}

async function runPy(scriptName: string, args: string[], timeoutMs = 300_000): Promise<string> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Missing clipper script: ${scriptPath}`);
  }
  const { stdout } = await execFileAsync("python3", [scriptPath, ...args], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "vod_scan_hype",
    label: "Scan VOD Hype Moments",
    description:
      "Scan a YouTube livestream VOD using parallel InnerTube live-chat replay + yt-dlp json3 transcript + 4-signal rolling Z-score hype detection (zero extra LLM keys). Returns compact Candidate Cards with chat spikes and timestamped transcript snippets ready for curation. Automatically falls back to transcript-only outline if the VOD has no live chat replay.",
    parameters: Type.Object({
      url: Type.String({ description: "YouTube VOD URL or 11-character video ID" }),
      topK: Type.Optional(
        Type.Number({ description: "Maximum number of hype candidate windows to return (default: 12)" })
      ),
      langs: Type.Optional(
        Type.String({ description: "Comma-separated transcript language preference (default: 'id-orig,id,en-orig,en')" })
      ),
    }),
    async execute(_id, params) {
      const videoId = extractVideoId(params.url);
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const workDir = path.join(CLIPS_ROOT, videoId);
      fs.mkdirSync(workDir, { recursive: true });

      const chatPath = path.join(workDir, `${videoId}.chat.json`);
      const transcriptPath = path.join(workDir, `${videoId}.transcript.json`);
      const langs = params.langs || "id-orig,id,en-orig,en";
      const topK = Math.min(40, Math.max(3, params.topK ?? 20));

      // Run live chat fetch & transcript fetch in parallel (reuse cached files if already scanned)
      let chatError: string | null = null;
      let transcriptError: string | null = null;

      await Promise.all([
        fs.existsSync(chatPath)
          ? Promise.resolve()
          : runPy("fetch_chat_fast.py", [canonicalUrl, "--workers", "12", "--out-dir", workDir], 300_000).catch(
              (err) => {
                chatError = err instanceof Error ? err.message : String(err);
              }
            ),
        fs.existsSync(transcriptPath)
          ? Promise.resolve()
          : runPy("fetch_transcript.py", [canonicalUrl, "--langs", langs, "--out-dir", workDir], 120_000).catch(
              (err) => {
                transcriptError = err instanceof Error ? err.message : String(err);
              }
            ),
      ]);

      // Primary path: live chat replay available -> 4-signal Stage 1 hype candidate cards
      if (fs.existsSync(chatPath)) {
        const detectArgs = ["--chat", chatPath, "--out-dir", workDir, "--top-k", String(topK)];
        if (fs.existsSync(transcriptPath)) {
          detectArgs.push("--transcript", transcriptPath);
        }
        const summaryRaw = await runPy("detect_hype_candidates.py", detectArgs, 60_000);
        const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
        const cardsPath = String(summary.cards_path || path.join(workDir, `${videoId}.cards.txt`));
        const cardsText = fs.existsSync(cardsPath) ? fs.readFileSync(cardsPath, "utf8") : "";

        return {
          content: [
            {
              type: "text",
              text:
                `VOD_HYPE_SCAN_SUMMARY:\n${JSON.stringify({ ...summary, mode: "chat+transcript", transcript_warning: transcriptError }, null, 2)}\n\n` +
                `CANDIDATE_CARDS:\n${cardsText || "(No spikes crossed threshold — try inspecting transcript directly.)"}`,
            },
          ],
          details: summary,
        };
      }

      // Fallback path: no live chat replay -> return compact grouped transcript timeline
      if (fs.existsSync(transcriptPath)) {
        const tData = JSON.parse(fs.readFileSync(transcriptPath, "utf8")) as {
          metadata?: Record<string, unknown>;
          segments?: Array<{ start_ms: number; start_str: string; text: string }>;
        };
        const segs = tData.segments || [];
        const lines: string[] = [];
        let bucketStart = -1;
        let bucketTexts: string[] = [];
        for (const s of segs) {
          const sec = Math.floor(s.start_ms / 1000);
          if (bucketStart < 0) bucketStart = sec;
          if (sec - bucketStart >= 20 && bucketTexts.length > 0) {
            lines.push(`[${s.start_str} / ${bucketStart}s] ${bucketTexts.join(" ")}`);
            bucketStart = sec;
            bucketTexts = [];
          }
          bucketTexts.push(s.text);
        }
        if (bucketTexts.length > 0) {
          lines.push(`[${bucketStart}s] ${bucketTexts.join(" ")}`);
        }
        const preview = lines.join("\n").slice(0, 32_000);
        return {
          content: [
            {
              type: "text",
              text:
                `VOD_HYPE_SCAN_SUMMARY:\n${JSON.stringify({ video_id: videoId, mode: "transcript_only_fallback", chat_unavailable_reason: chatError, transcript_segments: segs.length, work_dir: workDir }, null, 2)}\n\n` +
                `TRANSCRIPT_TIMELINE:\n${preview}`,
            },
          ],
          details: { video_id: videoId, mode: "transcript_only_fallback" },
        };
      }

      throw new Error(
        `Could not fetch live chat (${chatError || "unknown"}) or auto-transcript (${transcriptError || "unknown"}) for ${canonicalUrl}`
      );
    },
  });

  pi.registerTool({
    name: "vod_cut_clip",
    label: "Cut Raw VOD Clip (.mp4 + .srt)",
    description:
      "Download and cut an exact raw .mp4 clip plus time-shifted .srt captions from a YouTube VOD using yt-dlp --download-sections and ffmpeg, saved cleanly in /home/sprite/workspace/clips/<video_id>/ for human clippers/editors (zero AI video editing).",
    parameters: Type.Object({
      url: Type.String({ description: "YouTube VOD URL or 11-character video ID" }),
      startSec: Type.Number({ description: "Exact clip start timestamp in seconds" }),
      endSec: Type.Number({ description: "Exact clip end timestamp in seconds (max 300s duration)" }),
      name: Type.String({ description: "Short descriptive filename slug (e.g., 'clip_01_plot_twist')" }),
    }),
    async execute(_id, params) {
      const videoId = extractVideoId(params.url);
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const workDir = path.join(CLIPS_ROOT, videoId);
      const transcriptPath = path.join(workDir, `${videoId}.transcript.json`);

      const cutArgs = [
        "--url",
        canonicalUrl,
        "--start-sec",
        String(Math.max(0, Math.floor(params.startSec))),
        "--end-sec",
        String(Math.floor(params.endSec)),
        "--name",
        params.name,
        "--out-dir",
        workDir,
      ];
      if (fs.existsSync(transcriptPath)) {
        cutArgs.push("--transcript", transcriptPath);
      }

      const outRaw = await runPy("cut_raw_clip.py", cutArgs, 180_000);
      const result = JSON.parse(outRaw) as Record<string, unknown>;
      const youtubeJumpUrl = `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(params.startSec))}`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...result, video_id: videoId, youtube_url: youtubeJumpUrl }, null, 2),
          },
        ],
        details: { ...result, video_id: videoId, youtube_url: youtubeJumpUrl },
      };
    },
  });

  pi.registerTool({
    name: "vod_prep_clip",
    label: "Prep Raw Clip for Human Editor (CFR + -14 LUFS)",
    description:
      "Normalize an existing raw .mp4 clip inside /home/sprite/workspace/ (including clips/ and uploads/) for Premiere/DaVinci/CapCut human editors: converts to constant frame rate (CFR 30fps), H.264 yuv420p, +faststart, EBU R128 -14 LUFS social/broadcast audio loudness, and optional start/end trim. Pure local ffmpeg, zero AI video generation.",
    parameters: Type.Object({
      inputPath: Type.String({
        description: "Path to an existing .mp4 clip inside /home/sprite/workspace/",
      }),
      trimStartSec: Type.Optional(
        Type.Number({ description: "Optional trim offset from start of clip in seconds" })
      ),
      trimEndSec: Type.Optional(
        Type.Number({ description: "Optional trim end timestamp in seconds" })
      ),
      targetLufs: Type.Optional(
        Type.Number({ description: "Target integrated loudness in LUFS (default: -14)" })
      ),
    }),
    async execute(_id, params) {
      const resolvedIn = path.resolve(params.inputPath.trim());
      if (!fs.existsSync(resolvedIn)) {
        throw new Error(`Input clip not found: ${resolvedIn}`);
      }
      const realIn = fs.realpathSync(resolvedIn);
      const allowedRoots = [WORKSPACE_ROOT, path.resolve(HOME, "clips")]
        .filter((r) => fs.existsSync(r))
        .map((r) => fs.realpathSync(r));
      if (!allowedRoots.some((root) => realIn.startsWith(root + path.sep))) {
        throw new Error(`Input clip must exist inside ${WORKSPACE_ROOT}`);
      }
      const dir = path.dirname(resolvedIn);
      const base = path.basename(resolvedIn, path.extname(resolvedIn)).replace(/_prepped$/, "");
      const outPath = path.join(dir, `${base}_prepped.mp4`);
      const tmpOut = path.join(dir, `${base}_prepped.tmp.${Date.now()}.mp4`);
      const lufs = Math.min(-8, Math.max(-24, params.targetLufs ?? -14));

      const ffArgs: string[] = ["-y"];
      if (typeof params.trimStartSec === "number" && params.trimStartSec > 0) {
        ffArgs.push("-ss", String(params.trimStartSec));
      }
      if (typeof params.trimEndSec === "number" && params.trimEndSec > 0) {
        ffArgs.push("-to", String(params.trimEndSec));
      }
      ffArgs.push(
        "-i",
        resolvedIn,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-vsync",
        "cfr",
        "-r",
        "30",
        "-af",
        `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        tmpOut
      );

      try {
        await execFileAsync("ffmpeg", ffArgs, { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
        fs.renameSync(tmpOut, outPath);
      } catch (err) {
        fs.rmSync(tmpOut, { force: true });
        throw err;
      }
      const stat = fs.statSync(outPath);
      const result = {
        input_path: resolvedIn,
        output_path: outPath,
        output_bytes: stat.size,
        target_lufs: lufs,
        format: "H.264 yuv420p CFR 30fps + AAC 192k +faststart",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "vod_start_clip_job",
    label: "Start Background VOD Clipping Job",
    description:
      "Launch an isolated background VOD clipping job in the Clips app (never blocks or clutters the main Otto Chat thread). The background worker scans chat hype, cuts the best raw .mp4 + .srt clips, normalizes them to -14 LUFS CFR 30fps, watches each clip to write hook scores and human-editor notes, and saves them to the Clips gallery. Use this whenever the creator asks to clip a YouTube VOD.",
    parameters: Type.Object({
      url: Type.String({ description: "YouTube VOD URL or 11-character video ID" }),
      title: Type.Optional(Type.String({ description: "Optional human-friendly stream/VOD title" })),
      maxClips: Type.Optional(
        Type.Number({ description: "0 = Full Auto (all worthy moments, default), or explicit cap 1-30" })
      ),
      focusNotes: Type.Optional(
        Type.String({
          description: "Optional focus instructions (e.g. 'funny moments', 'boss fight reactions', 'Q&A answers')",
        })
      ),
    }),
    async execute(_id, params) {
      const videoId = extractVideoId(params.url);
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const port = process.env.PORT || "8080";
      const secret = process.env.LMA_INTERNAL_SECRET || "";
      const res = await fetch(`http://127.0.0.1:${port}/api/internal/clip-jobs/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "X-LMA-Internal-Secret": secret } : {}),
        },
        body: JSON.stringify({
          vodUrl: canonicalUrl,
          videoId,
          title: params.title || "",
          maxClips: params.maxClips ?? 0,
          focusNotes: params.focusNotes || "",
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to start background clip job (${res.status}): ${err}`);
      }
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "vod_update_job_progress",
    label: "Update Background Clip Job Progress",
    description:
      "Update the live stage and progress log of an active background VOD clip job in studio.db so the Clips app reflects realtime progress.",
    parameters: Type.Object({
      jobId: Type.String({ description: "Clip job ID (e.g. job_a1b2c3d4e5)" }),
      stage: Type.String({ description: "Short stage label (e.g. 'Scanning chat hype', 'Cutting clip 1/3', 'Reviewing hook')" }),
      message: Type.String({ description: "Concise status update for the Clips app log" }),
      title: Type.Optional(Type.String({ description: "Optional discovered VOD title" })),
    }),
    async execute(_id, params) {
      const isFailureStage = /^(failed|blocked|error)/i.test(params.stage.trim());
      const updated = updateClipJob(params.jobId, {
        stage: params.stage,
        logMessage: params.message,
        ...(isFailureStage ? { status: "failed", error: params.message } : {}),
        ...(params.title ? { title: params.title } : {}),
      });
      if (!updated) throw new Error(`Clip job not found: ${params.jobId}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, job: updated }, null, 2) }],
        details: { ok: true, jobId: updated.id },
      };
    },
  });

  pi.registerTool({
    name: "vod_save_clip",
    label: "Save Clip to Clips Gallery",
    description:
      "Save a finished raw/prepped clip (.mp4 + optional .srt) with title, timestamps, hook score (1-10), and human-editor notes into studio.db so it appears in the Clips app ready for preview, download, and 1-click Box handoff.",
    parameters: Type.Object({
      jobId: Type.Optional(Type.String({ description: "Optional parent clip job ID" })),
      videoId: Type.Optional(Type.String({ description: "11-character YouTube VOD video ID" })),
      title: Type.String({ description: "Punchy clip title for the gallery" }),
      filePath: Type.String({
        description: "Workspace-relative or absolute path to the final .mp4 clip (e.g. 'clips/<id>/clip_01_prepped.mp4')",
      }),
      srtPath: Type.Optional(
        Type.String({ description: "Workspace-relative or absolute path to the matching .srt caption file" })
      ),
      startSec: Type.Optional(Type.Number({ description: "Original VOD start timestamp in seconds" })),
      endSec: Type.Optional(Type.Number({ description: "Original VOD end timestamp in seconds" })),
      hookScore: Type.Optional(Type.Number({ description: "Hook strength score from 1 to 10" })),
      editorNotes: Type.Optional(
        Type.String({ description: "Concise notes for the human editor (hook timing, pacing, punchline, captions)" })
      ),
      youtubeUrl: Type.Optional(Type.String({ description: "Timestamped YouTube jump URL (https://youtu.be/<id>?t=...)" })),
    }),
    async execute(_id, params) {
      const clip = upsertClipRecord({
        jobId: params.jobId ?? null,
        videoId: params.videoId,
        title: params.title,
        filePath: params.filePath,
        srtPath: params.srtPath,
        startSec: params.startSec ?? null,
        endSec: params.endSec ?? null,
        hookScore: params.hookScore ?? null,
        editorNotes: params.editorNotes,
        youtubeUrl: params.youtubeUrl,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, clip }, null, 2) }],
        details: { ok: true, clipId: clip.id },
      };
    },
  });

  pi.registerTool({
    name: "vod_list_clip_jobs",
    label: "List Background Clip Jobs",
    description: "List recent background VOD clipping jobs and their current status/progress.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max jobs to return (default: 10)" })),
    }),
    async execute(_id, params) {
      const jobs = listClipJobs(params.limit ?? 10);
      return {
        content: [{ type: "text", text: JSON.stringify({ jobs }, null, 2) }],
        details: { count: jobs.length },
      };
    },
  });
}
