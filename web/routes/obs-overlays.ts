import { runOverlayRefine } from "../lib/background-job.ts";
import { errorMessage } from "../lib/http.ts";
import { broadcast } from "../lib/sse.ts";
import {
  deleteHostedObsOverlay,
  listHostedObsOverlays,
  updateObsOverlayState,
} from "../../agent/lib/obs-overlays.ts";

export async function handleObsOverlaysRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/obs-overlays") {
    const result = await listHostedObsOverlays();
    return Response.json(result);
  }

  const obsOverlayMatch = url.pathname.match(/^\/api\/obs-overlays\/([^/]+)(?:\/(state|refine))?$/);
  if (obsOverlayMatch) {
    const slug = decodeURIComponent(obsOverlayMatch[1]).trim();
    const sub = obsOverlayMatch[2] || "";
    try {
      if (sub === "state" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as {
          patch?: Record<string, unknown>;
          replace?: boolean;
        };
        const out = await updateObsOverlayState(slug, body.patch || {}, body.replace === true);
        broadcast({ type: "obs_overlays_changed", slug });
        return Response.json({ ok: true, state: out.state });
      }
      if (sub === "refine" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as {
          instruction?: string;
          title?: string;
          history?: Array<{ role: "user" | "assistant"; text: string }>;
        };
        const instruction = String(body.instruction || "").trim();
        if (!instruction) {
          return Response.json({ error: "Refinement instruction is required" }, { status: 400 });
        }

        const historyLines = Array.isArray(body.history)
          ? body.history
              .slice(-6)
              .map((h) => `${h.role === "user" ? "Creator" : "Otto"}: ${String(h.text || "").slice(0, 400)}`)
              .join("\n")
          : "";

        const prompt = [
          `ISOLATED OBS OVERLAY REFINEMENT TASK (never asks unnecessary questions; executes directly).`,
          `Target overlay slug: "${slug}"${body.title ? ` (title: "${body.title}")` : ""}.`,
          historyLines ? `\nRecent refinement context for this overlay:\n${historyLines}\n` : "",
          `Creator request: ${instruction}`,
          ``,
          `Instructions:`,
          `1. Call obs_overlay_list first to inspect the current overlay metadata and live state for slug "${slug}".`,
          `2. If the creator only wants a live state change (text, timer, visibility, counter), call obs_overlay_control(slug="${slug}", patch=...).`,
          `3. If the creator wants a layout, styling, animation, or controller change, call obs_overlay_deploy with the EXACT same slug "${slug}" (transparent 1920x1080 OBS Browser Source HTML + matching Live Remote Control Deck HTML, strictly no controls inside the OBS HTML and zero AI-generated images).`,
          `4. Reply concisely (1-2 plain sentences) summarizing what you changed on "${slug}".`,
        ]
          .filter(Boolean)
          .join("\n");

        return await runOverlayRefine(slug, prompt);
      }
      if (!sub && req.method === "DELETE") {
        const ok = await deleteHostedObsOverlay(slug);
        if (!ok) return Response.json({ error: "Overlay not found" }, { status: 404 });
        broadcast({ type: "obs_overlays_changed", slug, deleted: true });
        return Response.json({ ok: true, deleted: slug });
      }
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
