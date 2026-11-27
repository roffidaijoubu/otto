import fs from "node:fs";
import path from "node:path";
import { runOverlayRefine } from "../lib/background-job.ts";
import { errorMessage } from "../lib/http.ts";
import { broadcast } from "../lib/sse.ts";
import { WORKSPACE_ROOT } from "../lib/workspace.ts";
import {
  deleteHostedObsOverlay,
  listHostedObsOverlays,
  sanitizeOverlayAssetName,
  updateObsOverlayState,
} from "../../agent/lib/obs-overlays.ts";
import { createStudioJob, updateStudioJob } from "../../agent/lib/studio-db.ts";

export function buildObsOverlayCreatePrompt(userPrompt: string, attachedImages: string[] = []): string {
  const attached = attachedImages.map((s) => String(s || "").trim()).filter(Boolean);
  return [
    `ISOLATED OBS OVERLAY CREATION TASK (never asks questions; builds and deploys directly).`,
    `Creator request: ${userPrompt}`,
    attached.length > 0
      ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, pass its workspace path in assets: [...] when calling obs_overlay_deploy, and reference it in HTML as <img src="/assets/<basename>" />.`
      : "",
    ``,
    `Instructions:`,
    `1. If the creator mentions their logo, character, brand colors, or matching visual style, call box_list_assets (e.g. subpath "Logos" or "Characters"), download the relevant PNG with box_download_file into "assets/..." inside /home/sprite/workspace/, and call read on that PNG so you can visually inspect its exact colors, motif, and outline style.`,
    `2. Follow obs-overlay-craft best practices: build a crisp, transparent 1920x1080 OBS Browser Source HTML (strictly zero controls inside the OBS HTML, zero AI-generated images). Reference any downloaded/uploaded brand PNG via <img src="/assets/<basename>" /> and derive your CSS palette & typography directly from the inspected asset.`,
    `3. Call obs_overlay_deploy with a clean lowercase kebab-case slug, title, description, html, controls, initialState, and assets (array of workspace-relative paths like ["assets/logos/<file>.png"] whenever using local/Box/uploaded images).`,
    `4. Reply concisely (1-2 plain sentences) summarizing the deployed overlay and its slug.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildObsOverlayRefinePrompt(opts: {
  slug: string;
  instruction: string;
  title?: string;
  attachedImages?: string[];
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}): string {
  const attached = (opts.attachedImages || []).map((s) => String(s || "").trim()).filter(Boolean);
  const historyLines = Array.isArray(opts.history)
    ? opts.history
        .slice(-6)
        .map((h) => `${h.role === "user" ? "Creator" : "Otto"}: ${String(h.text || "").slice(0, 400)}`)
        .join("\n")
    : "";
  return [
    `ISOLATED OBS OVERLAY REFINEMENT TASK (never asks unnecessary questions; executes directly).`,
    `Target overlay slug: "${opts.slug}"${opts.title ? ` (title: "${opts.title}")` : ""}.`,
    historyLines ? `\nRecent refinement context for this overlay:\n${historyLines}\n` : "",
    attached.length > 0
      ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, pass its workspace path in assets: [...] when calling obs_overlay_deploy, and reference it in HTML as <img src="/assets/<basename>" />.`
      : "",
    `Creator request: ${opts.instruction}`,
    ``,
    `Instructions:`,
    `1. Call obs_overlay_list first to inspect the current overlay metadata and live state for slug "${opts.slug}".`,
    `2. If the creator only wants a live state change (text, timer, visibility, counter), call obs_overlay_control(slug="${opts.slug}", patch=...).`,
    `3. If the creator asks to add/swap their logo, character, or match brand style, call box_list_assets + box_download_file into "assets/..." and visually inspect the PNG with read before styling.`,
    `4. If the creator wants a layout, styling, animation, asset, or controller change, call obs_overlay_deploy with the EXACT same slug "${opts.slug}" (transparent 1920x1080 OBS Browser Source HTML + declarative controls, strictly no controls inside the OBS HTML, zero AI-generated images, and pass assets: ["assets/..."] for any images referenced as /assets/<basename>).`,
    `5. Reply concisely (1-2 plain sentences) summarizing what you changed on "${opts.slug}".`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function dispatchObsOverlayBackgroundJob(opts: {
  prompt: string;
  attachedImages?: string[];
  slug?: string;
  label?: string;
  existingJobId?: string;
}): { jobId: string } {
  const jobId = opts.existingJobId?.trim() || `obs_${Date.now().toString(36)}`;
  const targetSlug = (opts.slug || "").trim();
  const label = (opts.label || (targetSlug ? `Refining ${targetSlug}...` : "Building new OBS overlay...")).trim();

  void createStudioJob({
    id: jobId,
    kind: "obs_overlay",
    targetSlug,
    title: label,
    stage: targetSlug ? "Refining overlay" : "Building overlay",
    status: "running",
    payload: {
      prompt: opts.prompt,
      slug: targetSlug,
      attachedImages: (opts.attachedImages || []).map((s) => String(s || "").trim()).filter(Boolean),
      label,
    },
    logMessage: label,
  })
    .then(() => broadcast({ type: "jobs_changed", jobId }))
    .catch(() => {});

  broadcast({
    type: "obs_overlay_job_started",
    jobId,
    slug: targetSlug,
    label,
  });

  void (async () => {
    try {
      const before = targetSlug
        ? null
        : await listHostedObsOverlays().catch(() => ({ overlays: [] as Array<{ slug: string }> }));
      const beforeSlugs = new Set((before?.overlays || []).map((o) => o.slug));

      const workerPrompt = targetSlug
        ? buildObsOverlayRefinePrompt({
            slug: targetSlug,
            instruction: opts.prompt,
            attachedImages: opts.attachedImages,
          })
        : buildObsOverlayCreatePrompt(opts.prompt, opts.attachedImages);

      const res = await runOverlayRefine(targetSlug || "new", workerPrompt);
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };

      let resolvedSlug = targetSlug;
      if (!resolvedSlug) {
        const after = await listHostedObsOverlays().catch(() => ({
          overlays: [] as Array<{ slug: string; updatedAt: string }>,
        }));
        const created =
          (after.overlays || []).find((o) => !beforeSlugs.has(o.slug)) ||
          (after.overlays || []).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
        resolvedSlug = created?.slug || "";
      }

      const errMsg = res.ok ? "" : data.error || "OBS overlay job failed";
      await updateStudioJob(jobId, {
        targetSlug: resolvedSlug || targetSlug,
        status: res.ok ? "done" : "failed",
        stage: res.ok ? "Completed" : "Failed",
        error: errMsg,
        logMessage: res.ok ? (data.reply || "Overlay deployed.") : errMsg,
      }).catch(() => {});

      broadcast({
        type: "obs_overlay_job_finished",
        jobId,
        slug: resolvedSlug,
        ok: res.ok,
        reply: data.reply || "",
        error: errMsg,
      });
      broadcast({ type: "jobs_changed", jobId });
      if (resolvedSlug) {
        broadcast({ type: "obs_overlays_changed", slug: resolvedSlug });
      }
    } catch (err: unknown) {
      const errMsg = errorMessage(err);
      await updateStudioJob(jobId, {
        status: "failed",
        stage: "Failed",
        error: errMsg,
        logMessage: errMsg,
      }).catch(() => {});
      broadcast({
        type: "obs_overlay_job_finished",
        jobId,
        slug: targetSlug,
        ok: false,
        error: errMsg,
      });
      broadcast({ type: "jobs_changed", jobId });
    }
  })();

  return { jobId };
}

export async function handleObsOverlaysRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/obs-overlays") {
    const result = await listHostedObsOverlays();
    return Response.json(result);
  }

  // Upload local image attachment for Create or Refine ("pake gambar ini")
  if (req.method === "POST" && url.pathname === "/api/obs-overlays/upload") {
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "Image file is required" }, { status: 400 });
      }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) {
        return Response.json({ error: "Image must be between 1 B and 10 MiB" }, { status: 400 });
      }
      const cleanOrig = sanitizeOverlayAssetName(file.name || "upload.png");
      const uniqueName = `obs-${Date.now()}-${cleanOrig}`;
      const uploadsDir = path.join(WORKSPACE_ROOT, "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const destAbs = path.join(uploadsDir, uniqueName);
      const bytes = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(destAbs, bytes);
      return Response.json({
        ok: true,
        name: uniqueName,
        originalName: cleanOrig,
        workspacePath: `uploads/${uniqueName}`,
        size: bytes.length,
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  // Isolated background creation of a new OBS overlay (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/obs-overlays/create") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        prompt?: string;
        attachedImages?: string[];
      };
      const userPrompt = String(body.prompt || "").trim();
      if (!userPrompt) {
        return Response.json({ error: "Overlay description is required" }, { status: 400 });
      }

      const before = await listHostedObsOverlays().catch(() => ({ overlays: [] as Array<{ slug: string }> }));
      const beforeSlugs = new Set((before.overlays || []).map((o) => o.slug));
      const prompt = buildObsOverlayCreatePrompt(userPrompt, body.attachedImages || []);

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
          attachedImages?: string[];
          history?: Array<{ role: "user" | "assistant"; text: string }>;
        };
        const instruction = String(body.instruction || "").trim();
        if (!instruction) {
          return Response.json({ error: "Refinement instruction is required" }, { status: 400 });
        }

        const prompt = buildObsOverlayRefinePrompt({
          slug,
          instruction,
          title: body.title,
          attachedImages: body.attachedImages,
          history: body.history,
        });

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
