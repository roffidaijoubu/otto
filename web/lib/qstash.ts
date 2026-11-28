import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { HOME_DIR } from "./config.ts";
import { buildAgentChildEnv } from "./child-env.ts";
import { timingSafeStrEqual } from "./secure-compare.ts";

const seenQStashTokens = new Map<string, number>();
const MAX_SEEN_QSTASH_TOKENS = 2048;

export function resetSeenQStashTokens(): void {
  seenQStashTokens.clear();
}

function isLocalOrPrivateSocketIp(rawIp: string): boolean {
  const clean = rawIp.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const kind = net.isIP(clean);
  if (kind === 4) {
    const [a, b] = clean.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (kind === 6) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("::ffff:")) {
      return isLocalOrPrivateSocketIp(clean.slice(7));
    }
    if (clean.startsWith("fc") || clean.startsWith("fd") || clean.startsWith("fe80:")) return true;
    return false;
  }
  return true;
}

export interface VerifiedQStashToken {
  ok: true;
  replayKey: string;
  expiresAtSec: number;
}

export function commitQStashReplayToken(replayKey: string, expiresAtSec: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (seenQStashTokens.size >= MAX_SEEN_QSTASH_TOKENS) {
    for (const [k, expSec] of seenQStashTokens) {
      if (expSec <= now) seenQStashTokens.delete(k);
    }
    while (seenQStashTokens.size >= MAX_SEEN_QSTASH_TOKENS) {
      const oldest = seenQStashTokens.keys().next().value;
      if (oldest === undefined) break;
      seenQStashTokens.delete(oldest);
    }
  }
  seenQStashTokens.set(replayKey, expiresAtSec);
}

export function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function checkQStashJwtWithKey(
  token: string,
  rawBody: string,
  key: string,
  opts: { expectedSub?: string | null } = {}
): VerifiedQStashToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // Validate JWT header algorithm explicitly before trusting HMAC verification
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (!timingSafeStrEqual(sigB64, expectedSig)) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== "Upstash") return null;
  if (typeof payload.exp === "number" && now > payload.exp + 30) return null;
  if (typeof payload.nbf === "number" && now < payload.nbf - 30) return null;
  if (typeof payload.body !== "string") return null;

  // Enforce destination binding (fail-closed on missing or mismatched `sub`)
  const configuredPublicUrl = process.env.LMA_PUBLIC_URL?.trim();
  const expectedSub =
    opts.expectedSub !== undefined
      ? opts.expectedSub
      : configuredPublicUrl
        ? `${configuredPublicUrl.replace(/\/+$/, "")}/api/wakeup`
        : null;
  if (expectedSub) {
    if (typeof payload.sub !== "string" || payload.sub !== expectedSub) {
      return null;
    }
  } else if (typeof payload.sub === "string") {
    // Even without LMA_PUBLIC_URL configured, block tokens minted for non-wakeup endpoints
    try {
      const subUrl = new URL(payload.sub);
      if (subUrl.pathname.replace(/\/+$/, "") !== "/api/wakeup") return null;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const actualHashB64Url = crypto.createHash("sha256").update(rawBody).digest("base64url");
  const actualHashB64 = crypto.createHash("sha256").update(rawBody).digest("base64");
  const claimed = payload.body.replace(/=+$/, "");
  if (
    !timingSafeStrEqual(claimed, actualHashB64Url) &&
    !timingSafeStrEqual(payload.body, actualHashB64)
  ) {
    return null;
  }

  // Check single-use replay deduplication via `jti` (or token SHA-256 fallback)
  // without consuming yet so retryable 503/500 responses do not poison legitimate QStash retries.
  const replayKey =
    typeof payload.jti === "string" && payload.jti.trim()
      ? `jti:${payload.jti.trim()}`
      : `tok:${crypto.createHash("sha256").update(token).digest("hex")}`;
  const existingExp = seenQStashTokens.get(replayKey);
  if (existingExp !== undefined) {
    if (existingExp > now) {
      return null;
    }
    seenQStashTokens.delete(replayKey);
  }
  const expiresAtSec = typeof payload.exp === "number" ? payload.exp + 30 : now + 300;
  return { ok: true, replayKey, expiresAtSec };
}

export function verifyQStashJwtWithKey(
  token: string,
  rawBody: string,
  key: string,
  opts: { expectedSub?: string | null; consume?: boolean } = {}
): boolean {
  const verified = checkQStashJwtWithKey(token, rawBody, key, opts);
  if (!verified) return false;
  if (opts.consume !== false) {
    commitQStashReplayToken(verified.replayKey, verified.expiresAtSec);
  }
  return true;
}

const loginFailures = new Map<string, { count: number; resetAt: number }>();
const loginSuccesses = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_MAX_SUCCESSES_PER_MIN = 20;

export function resetLoginRateLimits(): void {
  loginFailures.clear();
  loginSuccesses.clear();
}

export function getClientKey(
  req: Request,
  server?: { requestIP(r: Request): { address: string } | null }
): string {
  const socketIp = server?.requestIP(req)?.address?.trim() || "";
  // Direct public socket peers cannot spoof proxy headers; only trust Fly/XFF headers
  // when the peer socket is a local/private edge proxy (or unavailable in unit tests).
  if (socketIp && !isLocalOrPrivateSocketIp(socketIp)) {
    return socketIp;
  }
  const flyIp = req.headers.get("fly-client-ip")?.trim();
  if (flyIp) return flyIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Use the rightmost proxy-appended hop rather than the client-spoofable leftmost hop
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return socketIp || "local";
}

export function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (entry) {
    if (now > entry.resetAt) {
      loginFailures.delete(key);
    } else if (entry.count >= LOGIN_MAX_FAILURES) {
      return true;
    }
  }
  const succ = loginSuccesses.get(key);
  if (succ) {
    if (now > succ.resetAt) {
      loginSuccesses.delete(key);
    } else if (succ.count >= LOGIN_MAX_SUCCESSES_PER_MIN) {
      return true;
    }
  }
  return false;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  if (loginFailures.size > 500) {
    for (const [k, v] of loginFailures) {
      if (now > v.resetAt) loginFailures.delete(k);
    }
  }
  const entry = loginFailures.get(key);
  if (!entry || now > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function recordLoginSuccess(key: string): void {
  const now = Date.now();
  if (loginSuccesses.size > 500) {
    for (const [k, v] of loginSuccesses) {
      if (now > v.resetAt) loginSuccesses.delete(k);
    }
  }
  const entry = loginSuccesses.get(key);
  if (!entry || now > entry.resetAt) {
    loginSuccesses.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function computeGuardrailStatus(): {
  zeroLocalKeys: boolean;
  zeroOutboundApiKeys: boolean;
  inboundSigningKeysConfigured: boolean;
  inboundKeysIsolatedFromAgent: boolean;
  aiMediaDisabled: boolean;
} {
  const outboundKeyNames = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "EXA_API_KEY",
    "FIRECRAWL_API_KEY",
    "COMPOSIO_API_KEY",
    "BUFFER_API_KEY",
    "QSTASH_TOKEN",
    "LMA_NEON_DATABASE_URL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
    "PINECONE_API_KEY",
    "APIFY_TOKEN",
    "BOX_DEVELOPER_TOKEN",
    "PIXABAY_API_KEY",
    "FLY_API_TOKEN",
    "NEON_API_KEY",
  ];
  const zeroOutboundApiKeys = outboundKeyNames.every((k) => !process.env[k]);
  const inboundSigningKeysConfigured = Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY || process.env.QSTASH_NEXT_SIGNING_KEY
  );
  // Honestly reflects BOTH outbound API keys AND inbound webhook signing keys on disk
  const zeroLocalKeys = zeroOutboundApiKeys && !inboundSigningKeysConfigured;

  // Dynamically verify child-env allowlist strips inbound/auth/DB secrets from the omp subprocess
  const sanitizedChildEnv = buildAgentChildEnv();
  const inboundKeysIsolatedFromAgent = [
    "LMA_WEB_PASSWORD",
    "LMA_WEB_PASSWORD_HASH",
    "QSTASH_CURRENT_SIGNING_KEY",
    "QSTASH_NEXT_SIGNING_KEY",
    "LMA_NEON_DATABASE_URL",
  ].every((k) => sanitizedChildEnv[k] === undefined);

  let aiMediaDisabled = false;
  try {
    const cfgPath = path.join(HOME_DIR, ".omp", "agent", "config.yml");
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, "utf8");
      aiMediaDisabled = /generate_image:\s*deny/i.test(cfg);
    }
  } catch {
    aiMediaDisabled = false;
  }
  return {
    zeroLocalKeys,
    zeroOutboundApiKeys,
    inboundSigningKeysConfigured,
    inboundKeysIsolatedFromAgent,
    aiMediaDisabled,
  };
}

export function verifyUpstashSignatureWithReceipt(
  req: Request,
  rawBody: string
): VerifiedQStashToken | null {
  const sig = req.headers.get("upstash-signature") || "";
  if (!sig) return null;
  const keys = [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((k): k is string => Boolean(k));
  if (keys.length === 0) return null;
  for (const k of keys) {
    const verified = checkQStashJwtWithKey(sig, rawBody, k);
    if (verified) return verified;
  }
  return null;
}

/**
 * Non-consuming convenience check for callers that only verify signature validity.
 * Callers enforcing replay protection must use `verifyUpstashSignatureWithReceipt()`
 * and invoke `commitQStashReplayToken()` only after terminal acceptance.
 */
export function verifyUpstashSignature(req: Request, rawBody: string): boolean {
  return verifyUpstashSignatureWithReceipt(req, rawBody) !== null;
}
