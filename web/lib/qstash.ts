import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { HOME_DIR } from "./config.ts";
import { timingSafeStrEqual } from "./secure-compare.ts";

export function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function verifyQStashJwtWithKey(token: string, rawBody: string, key: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (!timingSafeStrEqual(sigB64, expectedSig)) return false;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== "Upstash") return false;
  if (typeof payload.exp === "number" && now > payload.exp + 30) return false;
  if (typeof payload.nbf === "number" && now < payload.nbf - 30) return false;
  if (typeof payload.body !== "string") return false;
  const expectedSub = process.env.LMA_PUBLIC_URL
    ? `${process.env.LMA_PUBLIC_URL.replace(/\/+$/, "")}/api/wakeup`
    : null;
  if (expectedSub && typeof payload.sub === "string" && payload.sub !== expectedSub) {
    return false;
  }
  const actualHashB64Url = crypto.createHash("sha256").update(rawBody).digest("base64url");
  const actualHashB64 = crypto.createHash("sha256").update(rawBody).digest("base64");
  const claimed = payload.body.replace(/=+$/, "");
  if (
    !timingSafeStrEqual(claimed, actualHashB64Url) &&
    !timingSafeStrEqual(payload.body, actualHashB64)
  ) {
    return false;
  }
  return true;
}

const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;

export function getClientKey(
  req: Request,
  server?: { requestIP(r: Request): { address: string } | null }
): string {
  const flyIp = req.headers.get("fly-client-ip")?.trim();
  if (flyIp) return flyIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Use the rightmost proxy-appended hop rather than the client-spoofable leftmost hop
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return server?.requestIP(req)?.address || "local";
}

export function isLoginRateLimited(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
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

export function computeGuardrailStatus(): { zeroLocalKeys: boolean; aiMediaDisabled: boolean } {
  const outboundKeyNames = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "EXA_API_KEY",
    "FIRECRAWL_API_KEY",
    "COMPOSIO_API_KEY",
    "BUFFER_API_KEY",
    "QSTASH_TOKEN",
  ];
  const zeroLocalKeys = outboundKeyNames.every((k) => !process.env[k]);

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
  return { zeroLocalKeys, aiMediaDisabled };
}

export function verifyUpstashSignature(req: Request, rawBody: string): boolean {
  const sig = req.headers.get("upstash-signature") || "";
  if (!sig) return false;
  const keys = [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((k): k is string => Boolean(k));
  if (keys.length === 0) return false;
  return keys.some((k) => verifyQStashJwtWithKey(sig, rawBody, k));
}
