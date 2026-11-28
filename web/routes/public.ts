import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasConfiguredAuth,
  verifyWebPassword,
  buildAuthCookieHeader,
  isAuthenticated,
} from "../lib/auth.ts";
import {
  getClientKey,
  isLoginRateLimited,
  recordLoginFailure,
  recordLoginSuccess,
} from "../lib/qstash.ts";
import { rpc } from "../lib/rpc-bridge.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let cachedBuildSha: string | null | undefined = undefined;

export function getBuildSha(): string | null {
  const envSha = process.env.LMA_BUILD_SHA?.trim();
  if (envSha) return envSha;
  if (cachedBuildSha !== undefined) return cachedBuildSha;
  const shaFile = path.join(REPO_ROOT, ".build-sha");
  if (fs.existsSync(shaFile)) {
    const raw = fs.readFileSync(shaFile, "utf8").trim();
    if (/^[0-9a-f]{7,40}$/i.test(raw)) {
      cachedBuildSha = raw;
      return cachedBuildSha;
    }
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    cachedBuildSha = /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    cachedBuildSha = null;
  }
  return cachedBuildSha;
}

export async function handlePublicRoutes(
  req: Request,
  url: URL,
  server?: any
): Promise<Response | null> {
  // Public health check: return minimal liveness unauthenticated; include hold/worker/build internals only when authenticated
  if (req.method === "GET" && url.pathname === "/api/health") {
    if (isAuthenticated(req)) {
      return Response.json({
        ok: true,
        status: "healthy",
        buildSha: getBuildSha(),
        busy: rpc.busy,
        activeBackgroundJobs: rpc.activeBackgroundJobCount,
        hold: rpc.getHoldHealth(),
      });
    }
    return Response.json({ ok: true, status: "healthy" });
  }

  // Passcode login endpoint
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!hasConfiguredAuth()) {
      return Response.json(
        { error: "LMA_WEB_PASSWORD is not configured. Run bash ~/lma/setup.sh first." },
        { status: 503 }
      );
    }
    const clientKey = getClientKey(req, server);
    if (isLoginRateLimited(clientKey)) {
      return Response.json(
        { error: "Too many login attempts. Try again in 1 minute." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    const body: unknown = await req.json().catch(() => ({}));
    const pw =
      body && typeof body === "object" && "password" in body && typeof body.password === "string"
        ? body.password
        : "";
    if (!verifyWebPassword(pw)) {
      recordLoginFailure(clientKey);
      return Response.json({ error: "Invalid PIN" }, { status: 401 });
    }
    recordLoginSuccess(clientKey);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildAuthCookieHeader(req, url),
      },
    });
  }

  return null;
}
