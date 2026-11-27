import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { HOME_DIR } from "./config.ts";
import { timingSafeStrEqual } from "./secure-compare.ts";

let webPassword = process.env.LMA_WEB_PASSWORD || "";
export const AUTH_COOKIE_NAME = "lma_session";

export function getWebPassword(): string {
  return webPassword;
}

export function setWebPassword(pw: string): void {
  webPassword = pw;
}

export function initWebPassword(): void {
  webPassword = process.env.LMA_WEB_PASSWORD || "";
}

export function computeSessionToken(password: string): string {
  return crypto.createHmac("sha256", password).update("lma-web-session-v1").digest("base64url");
}

export function buildAuthCookieHeader(req: Request, url: URL, password: string): string {
  const token = computeSessionToken(password);
  const isHttps =
    url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const secureAttr = isHttps ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureAttr}`;
}

export function updatePrivateWebPassword(newPassword: string): void {
  const envDir = path.join(HOME_DIR, ".config", "lma");
  const envFile = path.join(envDir, "web.env");
  fs.mkdirSync(envDir, { recursive: true, mode: 0o700 });
  const lines = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)
    : [];
  let replaced = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*LMA_WEB_PASSWORD\s*=/.test(line)) {
      out.push(`LMA_WEB_PASSWORD=${newPassword}`);
      replaced = true;
    } else if (line.length > 0 || out.length > 0) {
      out.push(line);
    }
  }
  if (!replaced) {
    out.push(`LMA_WEB_PASSWORD=${newPassword}`);
  }
  const content = out.join("\n").replace(/\n*$/, "\n");
  const tmpFile = `${envFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmpFile, 0o600);
  fs.renameSync(tmpFile, envFile);
  webPassword = newPassword;
  process.env.LMA_WEB_PASSWORD = newPassword;
}

export function isAuthenticated(req: Request): boolean {
  // Fail-closed: never expose the agent without LMA_WEB_PASSWORD configured in ~/.config/lma/web.env
  if (!webPassword) return false;
  const cookieHeader = req.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rest] = part.trim().split("=");
    if (rawK === AUTH_COOKIE_NAME) {
      const val = rest.join("=");
      return timingSafeStrEqual(val, computeSessionToken(webPassword));
    }
  }
  return false;
}
