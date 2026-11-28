import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

let cachedGeminiBaseUrl: string | null = null;
const HOME_DIR = process.env.HOME || "/home/sprite";

/**
 * Resolve the multimodal review model.
 * Priority: LMA_REVIEW_MODEL override -> agent/config.yml `modelRoles.vision`
 * (written by setup.sh) -> built-in Gemini default. Never hardcode a model
 * that the configured Connector may not serve.
 */
function resolveReviewModel(): string {
  const override = process.env.LMA_REVIEW_MODEL?.trim();
  if (override) return override;
  try {
    const cfgPath = path.join(HOME_DIR, ".omp", "agent", "config.yml");
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, "utf8");
      const match = cfg.match(/^\s{2}vision:\s*(\S+)\s*$/m);
      if (match) {
        // "google/gemini-4-hydrogen:high" -> "gemini-4-hydrogen"
        return match[1].replace(/^[^/]+\//, "").replace(/:.*$/, "");
      }
    }
  } catch {
    // Fall through to the default below.
  }
  return "gemini-4-hydrogen";
}

const REVIEW_MODEL = resolveReviewModel();
const MAX_INLINE_BYTES = 14 * 1024 * 1024; // 14 MB safe inline base64 cap
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

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseIpv6Groups(rawIp: string): number[] | null {
  const noZone = rawIp.split("%")[0].toLowerCase();
  const halves = noZone.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes(".")) {
        if (i !== tokens.length - 1) return null;
        const v4 = tok.split(".").map((p) => Number(p));
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(Number.parseInt(tok, 16));
      }
    }
    return out;
  };

  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parseSide(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];
  const kind = net.isIP(clean);
  if (kind === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (kind === 6) {
    const g = parseIpv6Groups(clean);
    if (!g) return true;
    const isAllZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // Unspecified (::) and loopback (::1)
    if (isAllZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    // IPv4-compatible (::/96)
    if (isAllZeroPrefix && g[5] === 0) return true;
    // IPv4-mapped (::ffff:0:0/96) -> validate embedded IPv4
    if (isAllZeroPrefix && g[5] === 0xffff) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      return isPrivateOrReservedIpv4(v4);
    }
    // NAT64 (64:ff9b::/96)
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return true;
    // Unique local (fc00::/7)
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    // Link-local (fe80::/10)
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    // Site-local (fec0::/10)
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    // Multicast (ff00::/8)
    if ((g[0] & 0xff00) === 0xff00) return true;
    // Documentation (2001:db8::/32)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    return false;
  }
  return true;
}

export async function assertSafePublicHttpsUrl(rawUrl: string): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:") {
    throw new Error("Thumbnail URL must use https://");
  }
  if (u.username || u.password) {
    throw new Error("Thumbnail URL must not include credentials");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Refused private/internal thumbnail host: ${host || "(empty)"}`);
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Refused private/reserved thumbnail IP: ${host}`);
    }
    return u;
  }

  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records || records.length === 0) {
    throw new Error(`Thumbnail host resolved to no addresses: ${host}`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Refused private/reserved resolved IP (${rec.address}) for host ${host}`);
    }
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
            "Optional review focus (e.g., 'Check 3-second TikTok hook and dead air' or 'Check intro pacing')",
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
    label: "Critique Thumbnail",
    description:
      "Visually inspect an existing YouTube thumbnail (local image path OR image URL such as https://i.ytimg.com/vi/<videoId>/maxresdefault.jpg) using the zero-key Google Gemini Sprites Connector. Evaluates mobile legibility, focal point clarity, contrast, text clutter, and gives actionable revision notes for a human artist (strictly zero AI image generation).",
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
        let currentUrl = await assertSafePublicHttpsUrl(target);
        let imgRes: Response | null = null;
        for (let hop = 0; hop < 4; hop++) {
          imgRes = await fetch(currentUrl.toString(), {
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
          if (imgRes.status >= 300 && imgRes.status < 400) {
            const loc = imgRes.headers.get("location");
            if (!loc) break;
            currentUrl = await assertSafePublicHttpsUrl(new URL(loc, currentUrl).toString());
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
        `${titleLine}Critique this YouTube thumbnail for click-through clarity and mobile legibility:\n` +
        `1. Mobile Readability Verdict (Pass / Weak / Fail): Does ONE unmistakable focal point read instantly at small phone size?\n` +
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
