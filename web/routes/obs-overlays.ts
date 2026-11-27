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

  // Isolated background creation of a new OBS overlay (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/obs-overlays/create") {
    try {
      const body = (await req.json().catch(() => ({}))) as { prompt?: string };
      const userPrompt = String(body.prompt || "").trim();
      if (!userPrompt) {
        return Response.json({ error: "Overlay description is required" }, { status: 400 });
      }

      const before = await listHostedObsOverlays().catch(() => ({ overlays: [] as Array<{ slug: string }> }));
      const beforeSlugs = new Set((before.overlays || []).map((o) => o.slug));

      const prompt = [
        `ISOLATED OBS OVERLAY CREATION TASK (never asks questions; builds and deploys directly).`,
        `Creator request: ${userPrompt}`,
        ``,
        `Instructions:`,
        `1. If the creator mentions their logo, character, brand colors, or matching visual style, call box_list_assets (e.g. subpath "Logos" or "Characters"), download the relevant PNG with box_download_file into "assets/..." inside /home/sprite/workspace/, and call read on that PNG so you can visually inspect its exact colors, motif, and outline style.`,
        `2. Follow obs-overlay-craft best practices: build a crisp, transparent 1920x1080 OBS Browser Source HTML (strictly zero controls inside the OBS HTML, zero AI-generated images). Reference any downloaded brand PNG via <img src="/assets/<basename>" /> and derive your CSS palette & typography directly from the inspected asset.`,
        `3. Call obs_overlay_deploy with a clean lowercase kebab-case slug, title, description, html, controls, initialState, and assets (array of workspace-relative paths like ["assets/logos/<file>.png"] whenever using local/Box images).`,
        `4. Reply concisely (1-2 plain sentences) summarizing the deployed overlay and its slug.`,
      ].join("\n");

      const refineRes = await runOverlayRefine("new", prompt);
      if (!refineRes.ok) return refineRes;
      const refineJson = (await refineRes.json().catch(() => ({}))) as { reply?: string };

      const after = await listHostedObsOverlays().catch(() => ({ overlays: [] as Array<{ slug: string; updatedAt: string }> }));
      const created =
        (after.overlays || []).find((o) => !beforeSlugs.has(o.slug)) ||
        (after.overlays || []).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];

      if (created?.slug) {
        broadcast({ type: "obs_overlays_changed", slug: created.slug });
      }
      return Response.json({
        ok: true,
        slug: created?.slug || "",
        reply: refineJson.reply || "Deployed new OBS overlay.",
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
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
          `3. If the creator asks to add/swap their logo, character, or match brand style, call box_list_assets + box_download_file into "assets/..." and visually inspect the PNG with read before styling.`,
          `4. If the creator wants a layout, styling, animation, asset, or controller change, call obs_overlay_deploy with the EXACT same slug "${slug}" (transparent 1920x1080 OBS Browser Source HTML + declarative controls, strictly no controls inside the OBS HTML, zero AI-generated images, and pass assets: ["assets/..."] for any images referenced as /assets/<basename>).`,
          `5. Reply concisely (1-2 plain sentences) summarizing what you changed on "${slug}".`,
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
