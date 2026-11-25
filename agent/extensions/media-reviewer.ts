import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

let cachedGeminiBaseUrl: string | null = null;
const REVIEW_MODEL = process.env.LMA_REVIEW_MODEL || "gemini-2.5-flash";
const MAX_INLINE_BYTES = 14 * 1024 * 1024; // 14 MB safe inline base64 cap
const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(process.env.LMA_WORKSPACE_DIR || path.join(HOME_DIR, "workspace"));
const CLIPS_ROOT = path.resolve(HOME_DIR, "clips");

function resolveClipFile(localPath: string): string {
  const candidate = path.resolve(localPath);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Media file not found: ${path.basename(candidate)}`);
  }
  const realTarget = fs.realpathSync(candidate);
  const allowedRoots = [WORKSPACE_ROOT, CLIPS_ROOT]
    .filter((r) => fs.existsSync(r))
    .map((r) => fs.realpathSync(r));
  const inside = allowedRoots.some((root) => realTarget.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(`Local media path must reside inside ${WORKSPACE_ROOT}`);
  }
  if (!fs.statSync(realTarget).isFile()) {
    throw new Error(`Media path is not a regular file: ${path.basename(realTarget)}`);
  }
  return realTarget;
}

function assertSafePublicHttpsUrl(rawUrl: string): URL {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:") {
    throw new Error("Thumbnail URL must use https://");
  }
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    throw new Error(`Refused private/internal thumbnail host: ${h}`);
  }
  return u;
}

async function readStreamWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const contentLen = Number(res.headers.get("content-length") || 0);
  if (contentLen > maxBytes) {
    throw new Error(`Remote image exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`);
  }
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Remote image exceeded ${(maxBytes / 1024 / 1024).toFixed(0)} MB stream cap.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function getGeminiGatewayBaseUrl(): Promise<string> {
  if (cachedGeminiBaseUrl) return cachedGeminiBaseUrl;
  if (process.env.SPRITES_GEMINI_GATEWAY) {
    cachedGeminiBaseUrl = process.env.SPRITES_GEMINI_GATEWAY.replace(/\/+$/, "");
    return cachedGeminiBaseUrl;
  }

  const res = await fetch("https://api.sprites.dev/v1/gateway/list");
  if (!res.ok) {
    throw new Error(`Failed to query Sprites gateway list (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{ provider?: string; gateway_base_url?: string }>;
  };
  const conn = (data.connections || []).find((c) => c.provider === "gemini" && c.gateway_base_url);
  if (!conn?.gateway_base_url) {
    throw new Error("No Google Gemini Sprites Connector found in /v1/gateway/list.");
  }
  cachedGeminiBaseUrl = conn.gateway_base_url.replace(/\/+$/, "");
  return cachedGeminiBaseUrl;
}

async function callGeminiMultimodal(parts: Array<Record<string, unknown>>): Promise<string> {
  const baseUrl = await getGeminiGatewayBaseUrl();
  const endpoint = `${baseUrl}/v1beta/models/${REVIEW_MODEL}:generateContent`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini gateway error (${res.status}): ${errText.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error("Gemini returned an empty multimodal response.");
  }
  return text;
}

function guessMimeType(fileOrUrl: string, fallback: string): string {
  const lower = fileOrUrl.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return fallback;
}

function isYouTubeUrl(value: string): boolean {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(value.trim());
}

async function ensureCompactVideoBytes(localPath: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const stat = fs.statSync(localPath);
  if (stat.size <= MAX_INLINE_BYTES) {
    return { bytes: fs.readFileSync(localPath), mimeType: guessMimeType(localPath, "video/mp4") };
  }

  // Downscale to a lightweight 480p review proxy in /tmp so large raw clips still work inline
  const tmpOut = path.join(os.tmpdir(), `lma-review-${Date.now()}.mp4`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        localPath,
        "-vf",
        "scale=-2:480",
        "-r",
        "2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        "320k",
        "-ac",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        tmpOut,
      ],
      { timeout: 120_000 }
    );
    const compressed = fs.readFileSync(tmpOut);
    if (compressed.length > MAX_INLINE_BYTES) {
      throw new Error(
        `Clip is still too large after proxy compression (${(compressed.length / 1024 / 1024).toFixed(1)} MB). Cut a shorter segment (<3 min) first.`
      );
    }
    return { bytes: compressed, mimeType: "video/mp4" };
  } finally {
    fs.rmSync(tmpOut, { force: true });
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "watch_clip",
    label: "Watch Clip / Video (Multimodal Review)",
    description:
      "Visually and aurally watch a local raw .mp4 clip (from /home/sprite/workspace/... including clips/ and uploads/) or a public YouTube video URL using the zero-key Google Gemini Sprites Connector. Critiques the first 3-second hook, dead air, pacing, Live2D/camera framing, audio clarity, and gives concrete human-editor notes (strictly zero AI video generation).",
    parameters: Type.Object({
      pathOrUrl: Type.String({
        description: "Local .mp4 file path inside /home/sprite/workspace/ OR a public YouTube URL",
      }),
      focus: Type.Optional(
        Type.String({
          description:
            "Optional review focus (e.g., 'Check 3-second TikTok hook and dead air' or 'Audit 4 Ps intro')",
        })
      ),
    }),
    async execute(_id, params) {
      const target = params.pathOrUrl.trim();
      const reviewPrompt =
        params.focus?.trim() ||
        "Analyze this video as a sharp livestream & YouTube producer. Give timestamped notes on: (1) First 3-second hook & any dead air to cut, (2) Visual framing / Live2D or camera readability & on-screen clutter, (3) Audio clarity & energy pacing, (4) Exact cut/edit recommendations for a human editor.";

      const parts: Array<Record<string, unknown>> = [];
      if (isYouTubeUrl(target)) {
        parts.push({ fileData: { fileUri: target } });
      } else {
        const safePath = resolveClipFile(target);
        const { bytes, mimeType } = await ensureCompactVideoBytes(safePath);
        parts.push({
          inlineData: {
            mimeType,
            data: bytes.toString("base64"),
          },
        });
      }
      parts.push({ text: reviewPrompt });

      const critique = await callGeminiMultimodal(parts);
      return {
        content: [{ type: "text", text: critique }],
        details: { target, model: REVIEW_MODEL },
      };
    },
  });

  pi.registerTool({
    name: "critique_thumbnail",
    label: "Critique Thumbnail (Squint Test)",
    description:
      "Visually inspect an existing YouTube thumbnail (local image path OR image URL such as https://i.ytimg.com/vi/<videoId>/maxresdefault.jpg) using the zero-key Google Gemini Sprites Connector. Evaluates Michael Reeves' Squint Test, mobile legibility, focal point, text clutter, and gives actionable revision notes for a human artist (strictly zero AI image generation).",
    parameters: Type.Object({
      imagePathOrUrl: Type.String({
        description: "Local image path (.png/.jpg/.webp) OR public https:// thumbnail URL",
      }),
      videoTitle: Type.Optional(
        Type.String({ description: "Optional video title to evaluate title + thumbnail synergy" })
      ),
    }),
    async execute(_id, params) {
      const target = params.imagePathOrUrl.trim();
      let bytes: Buffer;
      let mimeType: string;

      if (/^https?:\/\//i.test(target)) {
        let currentUrl = assertSafePublicHttpsUrl(target);
        let imgRes: Response | null = null;
        for (let hop = 0; hop < 4; hop++) {
          imgRes = await fetch(currentUrl.toString(), {
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
          if (imgRes.status >= 300 && imgRes.status < 400) {
            const loc = imgRes.headers.get("location");
            if (!loc) break;
            currentUrl = assertSafePublicHttpsUrl(new URL(loc, currentUrl).toString());
            continue;
          }
          break;
        }
        if (!imgRes || !imgRes.ok) {
          throw new Error(`Failed to fetch thumbnail URL (${imgRes?.status ?? "no response"}): ${currentUrl.hostname}`);
        }
        const ct = imgRes.headers.get("content-type")?.split(";")[0]?.trim();
        mimeType = ct && ct.startsWith("image/") ? ct : guessMimeType(target, "image/jpeg");
        bytes = await readStreamWithLimit(imgRes, MAX_INLINE_BYTES);
      } else {
        const safePath = resolveClipFile(target);
        const st = fs.statSync(safePath);
        if (st.size > MAX_INLINE_BYTES) {
          throw new Error(`Thumbnail file exceeds ${(MAX_INLINE_BYTES / 1024 / 1024).toFixed(0)} MB limit.`);
        }
        mimeType = guessMimeType(safePath, "image/png");
        bytes = fs.readFileSync(safePath);
      }
      const titleLine = params.videoTitle ? `Paired video title: "${params.videoTitle}"\n\n` : "";
      const prompt =
        `${titleLine}Critique this YouTube thumbnail using Otto's blunt packaging playbook and the Michael Reeves Squint Test:\n` +
        `1. Squint Test Verdict (Pass / Weak / Fail): Does ONE unmistakable focal point read instantly at tiny mobile size?\n` +
        `2. Text Audit: Count the words, check contrast/readability, and flag if it repeats the title.\n` +
        `3. Visual Clutter & Hierarchy: What distracts the eye?\n` +
        `4. Concrete Revision Brief for a Human Artist / Designer (strictly NO AI image generation).`;

      const critique = await callGeminiMultimodal([
        { inlineData: { mimeType, data: bytes.toString("base64") } },
        { text: prompt },
      ]);

      return {
        content: [{ type: "text", text: critique }],
        details: { target, model: REVIEW_MODEL },
      };
    },
  });
}
