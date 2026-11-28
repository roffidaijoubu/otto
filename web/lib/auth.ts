import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { HOME_DIR } from "./config.ts";
import { timingSafeStrEqual } from "./secure-compare.ts";

let webPassword = process.env.LMA_WEB_PASSWORD || "";
let webPasswordHash = process.env.LMA_WEB_PASSWORD_HASH || "";
export const AUTH_COOKIE_NAME = "lma_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 64;
const activeSessions = new Map<string, number>();

export function hasConfiguredAuth(): boolean {
  return Boolean(webPasswordHash || webPassword);
}

export function getWebPassword(): string {
  return webPassword;
}

export function setWebPassword(pw: string): void {
  webPassword = pw;
}

export function initWebPassword(): void {
  webPassword = process.env.LMA_WEB_PASSWORD || "";
  webPasswordHash = process.env.LMA_WEB_PASSWORD_HASH || "";
}

export function hashWebPassword(pin: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyWebPassword(candidate: string): boolean {
  if (!candidate) return false;
  if (webPasswordHash) {
    const parts = webPasswordHash.split("$");
    if (
      parts.length === 3 &&
      parts[0] === "scrypt" &&
      /^[0-9a-f]{32}$/i.test(parts[1]) &&
      /^[0-9a-f]{64}$/i.test(parts[2])
    ) {
      const salt = Buffer.from(parts[1], "hex");
      const expectedHex = parts[2].toLowerCase();
      const derivedHex = crypto
        .scryptSync(candidate, salt, 32, { N: 16384, r: 8, p: 1 })
        .toString("hex");
      return timingSafeStrEqual(derivedHex, expectedHex);
    }
    return false;
  }
  if (!webPassword) return false;
  return timingSafeStrEqual(candidate, webPassword);
}

export function buildAuthCookieHeader(req: Request, url: URL): string {
  const now = Date.now();
  for (const [existingToken, expiresAt] of activeSessions) {
    if (expiresAt <= now) activeSessions.delete(existingToken);
  }
  while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldest = activeSessions.keys().next().value;
    if (oldest === undefined) break;
    activeSessions.delete(oldest);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  activeSessions.set(token, now + SESSION_TTL_MS);
  const isHttps =
    url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const secureAttr = isHttps ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureAttr}`;
}

export function updatePrivateWebPassword(newPassword: string): void {
  const hash = hashWebPassword(newPassword);
  const targetHome = process.env.HOME || HOME_DIR;
  const envDir = path.join(targetHome, ".config", "lma");
  const envFile = path.join(envDir, "web.env");
  fs.mkdirSync(envDir, { recursive: true, mode: 0o700 });
  const lines = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    : [];
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:LMA_WEB_PASSWORD|LMA_WEB_PASSWORD_HASH)\s*=/.test(line)) {
      continue;
    }
    if (line.length > 0 || out.length > 0) {
      out.push(line);
    }
  }
  out.push(`LMA_WEB_PASSWORD_HASH=${hash}`);
  const content = out.join("\n").replace(/\n*$/, "\n");
  const tmpFile = `${envFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmpFile, 0o600);
  fs.renameSync(tmpFile, envFile);
  webPassword = "";
  delete process.env.LMA_WEB_PASSWORD;
  webPasswordHash = hash;
  process.env.LMA_WEB_PASSWORD_HASH = hash;
  activeSessions.clear();
}

export function clearActiveSessions(): void {
  activeSessions.clear();
}

export function getActiveSessionCount(): number {
  const now = Date.now();
  for (const [token, expiresAt] of activeSessions) {
    if (expiresAt <= now) activeSessions.delete(token);
  }
  return activeSessions.size;
}

export function isAuthenticated(req: Request): boolean {
  // Fail-closed: never expose the agent without LMA_WEB_PASSWORD_HASH or LMA_WEB_PASSWORD configured
  if (!hasConfiguredAuth()) return false;
  const cookieHeader = req.headers.get("cookie") || "";
  let candidate = "";
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rest] = part.trim().split("=");
    if (rawK === AUTH_COOKIE_NAME) {
      candidate = rest.join("=");
      break;
    }
  }
  if (!candidate) return false;
  const now = Date.now();
  let matchedToken: string | null = null;
  let matchedExpiry = 0;
  for (const [token, expiresAt] of activeSessions) {
    if (expiresAt <= now) {
      activeSessions.delete(token);
      continue;
    }
    if (timingSafeStrEqual(candidate, token)) {
      matchedToken = token;
      matchedExpiry = expiresAt;
    }
  }
  if (matchedToken !== null) {
    // True LRU touch: refresh recency so an actively used owner session is never evicted by idle entries
    activeSessions.delete(matchedToken);
    activeSessions.set(matchedToken, matchedExpiry);
    return true;
  }
  return false;
}
