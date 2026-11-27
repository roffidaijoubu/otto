import { getWebPassword, buildAuthCookieHeader } from "../lib/auth.ts";
import { getClientKey, isLoginRateLimited, recordLoginFailure } from "../lib/qstash.ts";
import { timingSafeStrEqual } from "../lib/secure-compare.ts";
import { rpc } from "../lib/rpc-bridge.ts";

export async function handlePublicRoutes(
  req: Request,
  url: URL,
  server?: any
): Promise<Response | null> {
  // Public health check
  if (req.method === "GET" && url.pathname === "/api/health") {
    return Response.json({ ok: true, busy: rpc.busy });
  }

  // Passcode login endpoint
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const webPassword = getWebPassword();
    if (!webPassword) {
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
    if (!timingSafeStrEqual(pw, webPassword)) {
      recordLoginFailure(clientKey);
      return Response.json({ error: "Invalid passcode" }, { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildAuthCookieHeader(req, url, webPassword),
      },
    });
  }

  return null;
}
