import fs from "node:fs";
import path from "node:path";
import { readSetupIdentity, writeIdentityToMemoryMd } from "../lib/identity.ts";
import { getStudioMeta, setStudioMeta } from "../../agent/lib/studio-db.ts";
import { updatePrivateWebPassword, buildAuthCookieHeader } from "../lib/auth.ts";
import { broadcast } from "../lib/sse.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleSetupRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/dossier") {
    const home = process.env.HOME || "/home/sprite";
    const memPath = path.join(home, ".omp", "agent", "MEMORY.md");
    if (!fs.existsSync(memPath)) {
      return Response.json({ exists: false, updatedAt: null, content: "" });
    }
    const stat = fs.statSync(memPath);
    const content = fs.readFileSync(memPath, "utf8");
    return Response.json({
      exists: true,
      updatedAt: stat.mtime.toISOString(),
      content,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/setup/status") {
    const identity = readSetupIdentity();
    const metaDone = (await getStudioMeta("setup_completed")) === "1";
    const completed = metaDone || Boolean(identity.creatorName && identity.timezone);
    return Response.json({
      completed,
      creatorName: identity.creatorName,
      timezone: identity.timezone,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/setup/complete") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        creatorName?: string;
        timezone?: string;
        newPassword?: string;
        skip?: boolean;
      };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      let passwordChanged = false;

      if (!body.skip) {
        const creatorName = typeof body.creatorName === "string" ? body.creatorName.trim() : "";
        const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
        if (creatorName || timezone) {
          writeIdentityToMemoryMd(creatorName, timezone);
        }
        const newPw = typeof body.newPassword === "string" ? body.newPassword.trim() : "";
        if (newPw) {
          if (newPw.length < 8) {
            return Response.json(
              { error: "Passcode must be at least 8 characters long." },
              { status: 400 }
            );
          }
          if (/[\r\n\0]/.test(newPw)) {
            return Response.json(
              { error: "Passcode cannot contain line breaks." },
              { status: 400 }
            );
          }
          updatePrivateWebPassword(newPw);
          headers["Set-Cookie"] = buildAuthCookieHeader(req, url, newPw);
          passwordChanged = true;
        }
      }

      await setStudioMeta("setup_completed", "1");
      broadcast({ type: "db_changed" });
      return new Response(
        JSON.stringify({ ok: true, completed: true, passwordChanged }),
        { headers }
      );
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
