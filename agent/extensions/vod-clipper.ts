import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/home/sprite";
const SCRIPTS_DIR = path.join(HOME, ".omp", "agent", "skills", "raw-clip-finder", "scripts");
const CLIPS_ROOT = path.join(HOME, "clips");

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
      const topK = Math.min(20, Math.max(3, params.topK ?? 12));

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
      "Download and cut an exact raw .mp4 clip plus time-shifted .srt captions from a YouTube VOD using yt-dlp --download-sections and ffmpeg, saved cleanly in /home/sprite/clips/<video_id>/ for human clippers/editors (zero AI video editing).",
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
      "Normalize an existing raw .mp4 clip inside /home/sprite/clips/ for Premiere/DaVinci/CapCut human editors: converts to constant frame rate (CFR 30fps), H.264 yuv420p, +faststart, EBU R128 -14 LUFS social/broadcast audio loudness, and optional start/end trim. Pure local ffmpeg, zero AI video generation.",
    parameters: Type.Object({
      inputPath: Type.String({
        description: "Path to an existing .mp4 clip inside /home/sprite/clips/",
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
      const resolvedRoot = path.resolve(CLIPS_ROOT);
      const resolvedIn = path.resolve(params.inputPath.trim());
      if (!resolvedIn.startsWith(resolvedRoot + path.sep) || !fs.existsSync(resolvedIn)) {
        throw new Error(`Input clip must exist inside ${resolvedRoot}`);
      }

      const dir = path.dirname(resolvedIn);
      const base = path.basename(resolvedIn, path.extname(resolvedIn)).replace(/_prepped$/, "");
      const outPath = path.join(dir, `${base}_prepped.mp4`);
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
        outPath
      );

      await execFileAsync("ffmpeg", ffArgs, { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
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
}
