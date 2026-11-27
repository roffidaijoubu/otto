/**
 * ElevenLabs Scribe v3 Speech-to-Text via Fly.io Sprites Zero-Key Custom API Connector.
 *
 * Extracts compact mono MP3 audio from a video clip via ffmpeg (staying well under the
 * 8 MB Sprites Gateway request limit even for 3-5 minute clips), transcribes via
 * `POST /v1/speech-to-text` (`model_id: "scribe_v3"`), and writes a clean, readable
 * word-aligned `.srt` file for both the Clips Detail caption overlay and human editors.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedGatewayBaseUrl: string | null = null;

interface ScribeWord {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
}

interface ScribeResponse {
  language_code?: string;
  text?: string;
  words?: ScribeWord[];
  detail?: { message?: string };
}

export async function discoverElevenLabsGatewayUrl(): Promise<string | null> {
  if (process.env.SPRITES_ELEVENLABS_GATEWAY_URL) {
    return process.env.SPRITES_ELEVENLABS_GATEWAY_URL.replace(/\/$/, "");
  }
  if (cachedGatewayBaseUrl) return cachedGatewayBaseUrl;

  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{
        provider?: string;
        display_name?: string;
        provider_account_name?: string;
        gateway_base_url?: string;
      }>;
    };
    const conn = data.connections?.find(
      (c) =>
        /elevenlabs/i.test(c.display_name ?? "") ||
        /elevenlabs/i.test(c.provider_account_name ?? "") ||
        c.provider === "elevenlabs"
    );
    if (!conn?.gateway_base_url) return null;
    cachedGatewayBaseUrl = conn.gateway_base_url.replace(/\/$/, "");
    return cachedGatewayBaseUrl;
  } catch {
    return null;
  }
}

function formatSrtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrtFromScribeWords(words: ScribeWord[]): { srt: string; cueCount: number } {
  const tokens = words.filter(
    (w) =>
      w &&
      w.type !== "spacing" &&
      w.type !== "audio_event" &&
      typeof w.text === "string" &&
      w.text.trim().length > 0 &&
      typeof w.start === "number" &&
      typeof w.end === "number"
  );

  if (tokens.length === 0) return { srt: "", cueCount: 0 };

  const MAX_CHARS = 44;
  const MAX_DURATION_SEC = 4.2;
  const PAUSE_BREAK_SEC = 0.65;

  const cues: Array<{ start: number; end: number; text: string }> = [];
  let curWords: string[] = [];
  let curStart = tokens[0].start!;
  let curEnd = tokens[0].end!;

  const flush = () => {
    const text = curWords.join(" ").replace(/\s+([.,!?;:])/g, "$1").trim();
    if (text) {
      cues.push({
        start: curStart,
        end: Math.max(curStart + 0.35, curEnd),
        text,
      });
    }
    curWords = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const word = tok.text!.trim();
    const start = tok.start!;
    const end = tok.end!;

    if (curWords.length === 0) {
      curStart = start;
      curEnd = end;
      curWords.push(word);
    } else {
      const gap = start - curEnd;
      const projectedLen = curWords.join(" ").length + 1 + word.length;
      const projectedDur = end - curStart;
      const prevEndedSentence = /[.!?]$/.test(curWords[curWords.length - 1]);
      const prevEndedClause = /[,;:]$/.test(curWords[curWords.length - 1]);

      const shouldBreak =
        gap >= PAUSE_BREAK_SEC ||
        prevEndedSentence ||
        projectedLen > MAX_CHARS ||
        projectedDur > MAX_DURATION_SEC ||
        (prevEndedClause && projectedLen > 24);

      if (shouldBreak) {
        flush();
        curStart = start;
        curEnd = end;
        curWords.push(word);
      } else {
        curWords.push(word);
        curEnd = Math.max(curEnd, end);
      }
    }
  }
  flush();

  const srt = cues
    .map((c, idx) => `${idx + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`)
    .join("\n");

  return { srt, cueCount: cues.length };
}

export async function transcribeClipToSrt(
  mp4Path: string,
  srtOutPath: string,
  opts?: { languageCode?: string }
): Promise<{
  ok: boolean;
  srtPath?: string;
  cueCount?: number;
  languageCode?: string;
  provider?: string;
  error?: string;
}> {
  const gatewayBaseUrl = await discoverElevenLabsGatewayUrl();
  if (!gatewayBaseUrl) {
    return { ok: false, error: "ElevenLabs Sprites Connector not configured" };
  }

  const tmpAudio = path.join(
    os.tmpdir(),
    `otto-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
  );

  try {
    // Extract compact mono 16kHz 48kbps MP3 (~0.36 MB/min -> fits 8 MB gateway limit easily)
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", mp4Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", tmpAudio],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );

    let audioBytes = fs.readFileSync(tmpAudio);
    if (audioBytes.byteLength > 7.5 * 1024 * 1024) {
      // Re-encode at 24kbps if clip is very long (>20 min)
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", mp4Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "24k", tmpAudio],
        { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
      );
      audioBytes = fs.readFileSync(tmpAudio);
    }

    const form = new FormData();
    form.append("model_id", "scribe_v3");
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    if (opts?.languageCode) {
      form.append("language_code", opts.languageCode);
    }
    form.append(
      "file",
      new Blob([audioBytes], { type: "audio/mpeg" }),
      path.basename(tmpAudio)
    );

    const res = await fetch(`${gatewayBaseUrl}/v1/speech-to-text`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        error: `ElevenLabs Scribe HTTP ${res.status}: ${errText.slice(0, 220)}`,
      };
    }

    const data = (await res.json()) as ScribeResponse;
    const { srt, cueCount } = buildSrtFromScribeWords(data.words ?? []);
    if (cueCount === 0) {
      return { ok: false, error: "ElevenLabs Scribe returned 0 timed words" };
    }

    fs.mkdirSync(path.dirname(srtOutPath), { recursive: true });
    fs.writeFileSync(srtOutPath, srt, "utf8");
    return {
      ok: true,
      srtPath: srtOutPath,
      cueCount,
      languageCode: data.language_code || undefined,
      provider: "elevenlabs-scribe-v3",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tmpAudio, { force: true });
  }
}
