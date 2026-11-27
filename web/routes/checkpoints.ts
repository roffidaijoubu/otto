import {
  configureAutoSnapshotSchedule,
  createSpriteCheckpoint,
  getAutoSnapshotConfig,
  listSpriteCheckpoints,
  restoreSpriteCheckpoint,
} from "../lib/checkpoints.ts";
import { readSetupIdentity } from "../lib/identity.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleCheckpointsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/checkpoints") {
    const tz = readSetupIdentity().timezone || "UTC";
    const [listed, autoSnapshot] = await Promise.all([
      listSpriteCheckpoints(),
      getAutoSnapshotConfig(tz),
    ]);
    return Response.json({
      ok: true,
      available: listed.available,
      checkpoints: listed.checkpoints,
      autoSnapshot,
      error: listed.error,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/checkpoints") {
    try {
      const body = (await req.json().catch(() => ({}))) as { comment?: string };
      const created = await createSpriteCheckpoint(String(body.comment ?? ""));
      if (!created.ok) {
        return Response.json({ ok: false, error: created.error || "Failed to create snapshot" }, { status: 500 });
      }
      const listed = await listSpriteCheckpoints();
      return Response.json({
        ok: true,
        id: created.id,
        comment: created.comment,
        checkpoints: listed.checkpoints,
      });
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/checkpoints/auto-config") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        enabled?: boolean;
        timezone?: string;
      };
      const identity = readSetupIdentity();
      const tz =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : identity.timezone || "UTC";
      const result = await configureAutoSnapshotSchedule({
        enabled: Boolean(body.enabled),
        timezone: tz,
      });
      const autoSnapshot = await getAutoSnapshotConfig(tz);
      return Response.json({ ...result, autoSnapshot });
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/checkpoints/") &&
    url.pathname.endsWith("/restore")
  ) {
    try {
      const id = decodeURIComponent(
        url.pathname.slice("/api/checkpoints/".length, -"/restore".length)
      ).trim();
      const restored = await restoreSpriteCheckpoint(id);
      return Response.json(restored, { status: restored.ok ? 200 : 500 });
    } catch (err) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
