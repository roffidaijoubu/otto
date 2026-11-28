/**
 * ElevenLabs Scribe v3 Speech-to-Text + Direct Gemini 3.5 Flash-Lite Context Typo-Fix Pass
 * via Fly.io Sprites Zero-Key Connectors (NO `omp` subprocess required).
 *
 * Pipeline:
 * 1. Extracts compact mono 16kHz 48kbps MP3 from the video clip via ffmpeg (<8 MB Sprites Gateway cap).
 * 2. Transcribes word-level audio via ElevenLabs `POST /v1/speech-to-text` (`model_id: "scribe_v3"`).
 * 3. Runs a fast direct `gemini-3.5-flash-lite` pass via the zero-key Gemini Sprites Connector using
 *    `~/.omp/agent/MEMORY.md` + `~/.omp/agent/APPEND_SYSTEM.md` context to fix proper nouns, Islamic/VTuber
 *    terminology, and Indonesian/English code-switching typos while preserving exact Scribe v3 timestamps.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOME = process.env.HOME || "/home/sprite";
const GEMINI_TYPO_MODEL = process.env.LMA_GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash-lite";

let cachedElevenLabsUrl: string | null = null;
let cachedGeminiUrl: string | null = null;

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

export interface TimedSrtCue {
  start: number;
  end: number;
  text: string;
}

interface GatewayConnection {
  provider?: string;
  display_name?: string;
  provider_account_name?: string;
  gateway_base_url?: string;
}

async function fetchSpritesConnections(): Promise<GatewayConnection[]> {
  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { connections?: GatewayConnection[] };
    return data.connections ?? [];
  } catch {
    return [];
  }
}

export async function discoverElevenLabsGatewayUrl(): Promise<string | null> {
  if (process.env.SPRITES_ELEVENLABS_GATEWAY_URL) {
    return process.env.SPRITES_ELEVENLABS_GATEWAY_URL.replace(/\/$/, "");
  }
  if (cachedElevenLabsUrl) return cachedElevenLabsUrl;
  const conns = await fetchSpritesConnections();
  const conn = conns.find(
    (c) =>
      /elevenlabs/i.test(c.display_name ?? "") ||
      /elevenlabs/i.test(c.provider_account_name ?? "") ||
      c.provider === "elevenlabs"
  );
  if (!conn?.gateway_base_url) return null;
  cachedElevenLabsUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedElevenLabsUrl;
}

export async function discoverGeminiGatewayUrl(): Promise<string | null> {
  if (process.env.SPRITES_GEMINI_GATEWAY_URL) {
    return process.env.SPRITES_GEMINI_GATEWAY_URL.replace(/\/$/, "");
  }
  if (cachedGeminiUrl) return cachedGeminiUrl;
  const conns = await fetchSpritesConnections();
  const conn = conns.find((c) => c.provider === "gemini");
  if (!conn?.gateway_base_url) return null;
  cachedGeminiUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedGeminiUrl;
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

export function buildCuesFromScribeWords(words: ScribeWord[]): TimedSrtCue[] {
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

  if (tokens.length === 0) return [];

  const MAX_CHARS = 44;
  const MAX_DURATION_SEC = 4.2;
  const PAUSE_BREAK_SEC = 0.65;

  const cues: TimedSrtCue[] = [];
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
  return cues;
}

export function serializeCuesToSrt(cues: TimedSrtCue[]): string {
  return cues
    .map((c, idx) => `${idx + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

function readAgentContextSnippet(): string {
  const agentDir = path.join(HOME, ".omp", "agent");
  const parts: string[] = [];
  for (const [filename, maxChars] of [
    ["MEMORY.md", 4500],
    ["APPEND_SYSTEM.md", 3000],
  ] as const) {
    const p = path.join(agentDir, filename);
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8").trim();
        if (content) {
          parts.push(`--- ${filename} ---\n${content.slice(0, maxChars)}`);
        }
      } catch {
        // ignore
      }
    }
  }
  return parts.join("\n\n");
}

async function polishCuesWithGemini(cues: TimedSrtCue[]): Promise<{
  cues: TimedSrtCue[];
  polished: boolean;
  error?: string;
}> {
  if (cues.length === 0) return { cues, polished: false };
  const geminiBaseUrl = await discoverGeminiGatewayUrl();
  if (!geminiBaseUrl) {
    return { cues, polished: false, error: "Gemini Sprites Connector not available" };
  }

  const contextText = readAgentContextSnippet();
  const indexed = cues.map((c, idx) => ({ i: idx + 1, text: c.text }));

  const prompt = [
    `You are a subtitle proofreader for a livestream clip. Fix speech-to-text typos, misheard proper nouns, brand/creator names, religious/cultural terms, and Indonesian/English code-switching errors using the creator context below.`,
    ``,
    `STRICT RULES:`,
    `1. Keep the EXACT same array length (${indexed.length} items) and exact same index "i" (1..${indexed.length}).`,
    `2. Do NOT merge, split, drop, or reorder cues. Each cue maps 1-to-1 to a timed video subtitle line.`,
    `3. Keep the speaker's natural spoken language (Indonesian/English slang/code-switching). Do NOT translate or rewrite phrasing unless fixing an obvious ASR mishearing/typo or punctuation.`,
    `4. Return ONLY valid JSON: { "cues": [{ "i": 1, "text": "..." }, ...] }`,
    ``,
    contextText ? `CREATOR CONTEXT:\n${contextText}\n` : "",
    `INPUT CUES JSON:\n${JSON.stringify({ cues: indexed })}`,
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const endpoint = `${geminiBaseUrl}/v1beta/models/${encodeURIComponent(GEMINI_TYPO_MODEL)}:generateContent`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        cues,
        polished: false,
        error: `Gemini ${GEMINI_TYPO_MODEL} HTTP ${res.status}: ${errText.slice(0, 180)}`,
      };
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (!rawText) {
      return { cues, polished: false, error: "Gemini returned empty response" };
    }

    const parsed = JSON.parse(rawText) as { cues?: Array<{ i?: number; text?: string }> };
    if (!Array.isArray(parsed.cues) || parsed.cues.length !== cues.length) {
      return { cues, polished: false, error: "Gemini cue count mismatch" };
    }

    const updated: TimedSrtCue[] = cues.map((orig, idx) => {
      const candidate = parsed.cues?.[idx];
      const nextText = typeof candidate?.text === "string" ? candidate.text.trim() : "";
      return {
        start: orig.start,
        end: orig.end,
        text: nextText || orig.text,
      };
    });
    return { cues: updated, polished: true };
  } catch (err) {
    return {
      cues,
      polished: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeClipToSrt(
  mp4Path: string,
  srtOutPath: string,
  opts?: { languageCode?: string; skipGeminiPolish?: boolean }
): Promise<{
  ok: boolean;
  srtPath?: string;
  cueCount?: number;
  languageCode?: string;
  provider?: string;
  geminiPolished?: boolean;
  geminiWarning?: string;
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
    const rawCues = buildCuesFromScribeWords(data.words ?? []);
    if (rawCues.length === 0) {
      return { ok: false, error: "ElevenLabs Scribe returned 0 timed words" };
    }

    let finalCues = rawCues;
    let geminiPolished = false;
    let geminiWarning: string | undefined;

    if (!opts?.skipGeminiPolish) {
      const polish = await polishCuesWithGemini(rawCues);
      finalCues = polish.cues;
      geminiPolished = polish.polished;
      geminiWarning = polish.error;
    }

    const srt = serializeCuesToSrt(finalCues);
    fs.mkdirSync(path.dirname(srtOutPath), { recursive: true });
    fs.writeFileSync(srtOutPath, srt, "utf8");
    return {
      ok: true,
      srtPath: srtOutPath,
      cueCount: finalCues.length,
      languageCode: data.language_code || undefined,
      provider: geminiPolished
        ? `elevenlabs-scribe-v3+${GEMINI_TYPO_MODEL}`
        : "elevenlabs-scribe-v3",
      geminiPolished,
      geminiWarning,
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
