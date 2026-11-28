import fs from "node:fs";
import path from "node:path";
import { runThumbnailWorker } from "../lib/background-job.ts";
import { errorMessage } from "../lib/http.ts";
import { rpc } from "../lib/rpc-bridge.ts";
import { runManagedRpcWorker } from "../lib/rpc-worker.ts";
import { broadcast } from "../lib/sse.ts";
import {
  WORKSPACE_ROOT,
  deleteThumbnailProject,
  getThumbnailAssetPath,
  getThumbnailProject,
  getThumbnailProjectDir,
  listThumbnailProjects,
  sanitizeThumbnailAssetName,
  saveThumbnailExportBytes,
} from "../../agent/lib/thumbnails.ts";
import { exportWorkspaceEntryToBox } from "../../agent/lib/box.ts";
import { createStudioJob, updateStudioJob } from "../../agent/lib/studio-db.ts";

export function dispatchThumbnailBackgroundJob(opts: {
  prompt: string;
  attachedImages?: string[];
  slug?: string;
  label?: string;
  existingJobId?: string;
}): { jobId: string } {
  const jobId = opts.existingJobId?.trim() || `thumb_${Date.now().toString(36)}`;
  const targetSlug = (opts.slug || "").trim();
  const label = (opts.label || (targetSlug ? `Refining ${targetSlug}...` : "Composing 1280×720 thumbnail...")).trim();
  const attached = (opts.attachedImages || []).map((s) => String(s || "").trim()).filter(Boolean);

  void createStudioJob({
    id: jobId,
    kind: "thumbnail",
    targetSlug,
    title: label,
    stage: targetSlug ? "Refining thumbnail" : "Composing thumbnail",
    status: "running",
    payload: {
      prompt: opts.prompt,
      slug: targetSlug,
      attachedImages: attached,
      label,
    },
    logMessage: label,
  })
    .then(() => broadcast({ type: "jobs_changed", jobId }))
    .catch(() => {});

  broadcast({
    type: "thumbnail_job_started",
    jobId,
    slug: targetSlug,
    label,
  });

  void (async () => {
    try {
      const beforeSlugs = targetSlug ? new Set<string>() : new Set(listThumbnailProjects().map((t) => t.slug));
      const workerPrompt = targetSlug
        ? [
            `ISOLATED NON-AI THUMBNAIL REFINEMENT TASK (never asks unnecessary questions; executes directly).`,
            `Target thumbnail slug: "${targetSlug}".`,
            attached.length > 0
              ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, pass its workspace path in assets: [...] when calling thumbnail_save, and reference it in HTML as <img src="/assets/<basename>" />.`
              : "",
            `Creator request: ${opts.prompt}`,
            ``,
            `Instructions:`,
            `1. Call thumbnail_get(slug="${targetSlug}") first to inspect the current 1280x720 HTML and assets.`,
            `2. If needed, fetch assets from box_list_assets + box_download_file or pixabay_search_backgrounds + pixabay_download_image and inspect with read.`,
            `3. Update the 1280x720 HTML/CSS (strictly NO AI-generated images; keep headline text strictly in its own clear column so it NEVER overlaps the character's face/eyes) and call thumbnail_save with the EXACT same slug "${targetSlug}" and any newly added workspace asset paths in assets.`,
            `4. MANDATORY VISUAL SELF-CHECK: Call thumbnail_render(slug="${targetSlug}", format="jpg") and then call read on the rendered JPG filePath to visually inspect the actual rendered thumbnail with your own eyes. Check for: (a) ANY text/badge overlapping the character's face, eyes, or head, (b) awkward cropping or off-balance framing, (c) weak contrast or unreadable text at 120px mobile size, (d) anything inside the bottom-right 220x90px YouTube duration safe zone. If ANY defect is visible, fix the HTML/CSS, call thumbnail_save, and re-verify with thumbnail_render + read (up to 2 fix passes) until clean.`,
            `5. Reply concisely (1-2 plain sentences) summarizing what you refined.`,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            `ISOLATED NON-AI THUMBNAIL CREATION TASK (never asks questions; builds and saves directly).`,
            `Creator request: ${opts.prompt}`,
            attached.length > 0
              ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, include them in assets: [...] when calling thumbnail_save, and use them in HTML via <img src="/assets/<basename>" />.`
              : "",
            ``,
            `Instructions:`,
            `1. STRICTLY ZERO AI-GENERATED IMAGES. Follow the thumbnail-craft skill.`,
            `2. Discover real creator cutouts & logos in Box using box_list_assets and download with box_download_file into "assets/..." (unless the creator already provided replacement images above).`,
            `3. Background can be either a crisp code-crafted CSS/SVG backdrop (studio gradients, radial spotlights, split color blocks, subtle geometric/halftone patterns) OR a real Pixabay photo via pixabay_search_backgrounds (isAiGenerated=false) + pixabay_download_image if a photographic scene adds context.`,
            `4. Inspect downloaded/uploaded images with read before styling.`,
            `5. Compose a punchy 1280x720 HTML/CSS thumbnail (2-4 word bold hook, keep headline strictly in its own side column so it NEVER overlaps the character's face/eyes, and keep the bottom-right 220x90px YouTube duration corner clear) referencing assets via <img src="/assets/<basename>" />.`,
            `6. Call thumbnail_save with a clean lowercase kebab-case slug, title, description, html, and assets.`,
            `7. MANDATORY VISUAL SELF-CHECK: Immediately call thumbnail_render(slug="<your-slug>", format="jpg") and then call read on the rendered JPG filePath to visually inspect your actual rendered thumbnail! Verify with your own eyes that: (a) NO text, badge, or logo overlaps the character's face/eyes, (b) the character is cleanly framed and not awkwardly clipped, (c) text contrast is crisp at 120px mobile size, and (d) the bottom-right 220x90px duration safe zone is clear. If you spot ANY overlap or framing flaw, fix the HTML/CSS, call thumbnail_save, and re-verify with thumbnail_render + read (up to 2 fix passes) before finishing.`,
            `8. Reply concisely (1-2 plain sentences) summarizing the thumbnail and its slug.`,
          ]
            .filter(Boolean)
            .join("\n");

      void rpc.holdSpriteActive();
      const workerResult = await runManagedRpcWorker({
        jobId,
        kind: "thumbnail",
        tools:
          "thumbnail_save,thumbnail_list,thumbnail_get,thumbnail_delete,thumbnail_render,box_list_assets,box_download_file,pixabay_search_backgrounds,pixabay_download_image,critique_thumbnail,read",
        prompt: workerPrompt,
        timeoutMs: 8 * 60 * 1000,
        onToolStart: (_toolName, toolLabel) => {
          void updateStudioJob(jobId, { stage: toolLabel }).catch(() => {});
          broadcast({ type: "jobs_changed", jobId });
        },
        onBusyChange: (busy) => {
          if (!busy) rpc.releaseSpriteHold();
        },
      });

      if (workerResult.aborted) {
        broadcast({
          type: "thumbnail_job_finished",
          jobId,
          slug: targetSlug,
          ok: false,
          error: "Cancelled",
        });
        broadcast({ type: "jobs_changed", jobId });
        return;
      }

      let resolvedSlug = targetSlug;
      if (!resolvedSlug) {
        const after = listThumbnailProjects();
        const created =
          after.find((t) => !beforeSlugs.has(t.slug)) ||
          after.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
        resolvedSlug = created?.slug || "";
      }

      const errMsg = workerResult.ok ? "" : workerResult.error || "Thumbnail job failed";
      await updateStudioJob(jobId, {
        targetSlug: resolvedSlug || targetSlug,
        status: workerResult.ok ? "done" : "failed",
        stage: workerResult.ok ? "Completed" : "Failed",
        error: errMsg,
        logMessage: workerResult.ok ? (workerResult.reply || "Thumbnail saved.") : errMsg,
      }).catch(() => {});

      broadcast({
        type: "thumbnail_job_finished",
        jobId,
        slug: resolvedSlug,
        ok: workerResult.ok,
        reply: workerResult.reply || "",
        error: errMsg,
      });
      broadcast({ type: "jobs_changed", jobId });
      if (resolvedSlug) {
        broadcast({ type: "thumbnails_changed", slug: resolvedSlug });
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
        type: "thumbnail_job_finished",
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

export async function handleThumbnailsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/thumbnails") {
    const thumbnails = listThumbnailProjects();
    return Response.json({ ok: true, thumbnails });
  }

  // Upload local image attachment for Create or Refine ("ganti sama gambar ini")
  if (req.method === "POST" && url.pathname === "/api/thumbnails/upload") {
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "Image file is required" }, { status: 400 });
      }
      if (file.size === 0 || file.size > 10 * 1024 * 1024) {
        return Response.json({ error: "Image must be between 1 B and 10 MiB" }, { status: 400 });
      }
      const cleanOrig = sanitizeThumbnailAssetName(file.name || "upload.png");
      const uniqueName = `thumb-${Date.now()}-${cleanOrig}`;
      const uploadsDir = path.join(WORKSPACE_ROOT, "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const destAbs = path.join(uploadsDir, uniqueName);
      const bytes = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(destAbs, bytes);
      const workspacePath = `uploads/${uniqueName}`;
      return Response.json({
        ok: true,
        name: uniqueName,
        originalName: cleanOrig,
        workspacePath,
        size: bytes.length,
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  // Isolated background creation of a new non-AI 1280x720 thumbnail (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/thumbnails/create") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        prompt?: string;
        attachedImages?: string[];
      };
      const userPrompt = String(body.prompt || "").trim();
      if (!userPrompt) {
        return Response.json({ error: "Thumbnail prompt is required" }, { status: 400 });
      }
      const attached = Array.isArray(body.attachedImages)
        ? body.attachedImages.map((s) => String(s || "").trim()).filter(Boolean)
        : [];

      const beforeSlugs = new Set(listThumbnailProjects().map((t) => t.slug));

      const prompt = [
        `ISOLATED NON-AI THUMBNAIL CREATION TASK (never asks questions; builds and saves directly).`,
        `Creator request: ${userPrompt}`,
        attached.length > 0
          ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, include them in assets: [...] when calling thumbnail_save, and use them in HTML via <img src="/assets/<basename>" />.`
          : "",
        ``,
        `Instructions:`,
        `1. STRICTLY ZERO AI-GENERATED IMAGES. Follow the thumbnail-craft skill.`,
        `2. Discover real creator cutouts & logos in Box using box_list_assets (e.g. subpath "Characters", "Characters/White_Light", "Characters/Black_Dark", "Logos") and download the best matching PNG(s) with box_download_file into "assets/..." inside /home/sprite/workspace/ (unless the creator already uploaded their own replacement image above).`,
        `3. Background can be either a crisp code-crafted CSS/SVG backdrop (studio gradients, radial spotlights, split color blocks, subtle geometric/halftone patterns) OR a real Pixabay photo via pixabay_search_backgrounds (already hard-filtered to isAiGenerated=false) + pixabay_download_image if a photographic scene genuinely adds context.`,
        `4. Call read on your downloaded/uploaded PNG & photo assets so you visually confirm expression, framing, and brand colors before styling.`,
        `5. Compose a punchy 1280x720 HTML/CSS thumbnail (2-4 word bold hook text, large expressive character cutout, high-contrast scrim, keep bottom-right YouTube duration corner clear) referencing assets via <img src="/assets/<basename>" />.`,
        `6. Call thumbnail_save with a clean lowercase kebab-case slug, title, description, html, and assets (array of downloaded/uploaded workspace-relative paths).`,
        `7. Reply concisely (1-2 plain sentences) summarizing the thumbnail concept and its slug.`,
      ]
        .filter(Boolean)
        .join("\n");

      const workerRes = await runThumbnailWorker("new", prompt);
      if (!workerRes.ok) return workerRes;
      const workerJson = (await workerRes.json().catch(() => ({}))) as { reply?: string };

      const after = listThumbnailProjects();
      const created =
        after.find((t) => !beforeSlugs.has(t.slug)) ||
        after.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];

      if (created?.slug) {
        broadcast({ type: "thumbnails_changed", slug: created.slug });
      }
      return Response.json({
        ok: true,
        slug: created?.slug || "",
        reply: workerJson.reply || "Created new thumbnail.",
      });
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  // Serve project assets: GET /api/thumbnails/:slug/assets/:name
  const assetMatch = url.pathname.match(/^\/api\/thumbnails\/([^/]+)\/assets\/([^/]+)$/);
  if (assetMatch && req.method === "GET") {
    try {
      const slug = decodeURIComponent(assetMatch[1]);
      const name = decodeURIComponent(assetMatch[2]);
      const found = getThumbnailAssetPath(slug, name);
      if (!found) return new Response("Asset not found", { status: 404 });
      return new Response(Bun.file(found.absPath), {
        headers: {
          "Content-Type": found.mimeType,
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (err: unknown) {
      return new Response(errorMessage(err), { status: 400 });
    }
  }

  // Serve exported PNG/JPG: GET /api/thumbnails/:slug/exported/:name
  const exportedMatch = url.pathname.match(/^\/api\/thumbnails\/([^/]+)\/exported\/([^/]+)$/);
  if (exportedMatch && req.method === "GET") {
    try {
      const slug = decodeURIComponent(exportedMatch[1]);
      const name = path.basename(decodeURIComponent(exportedMatch[2]));
      if (!/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg)$/i.test(name)) {
        return new Response("Invalid export filename", { status: 400 });
      }
      const absPath = path.join(getThumbnailProjectDir(slug), name);
      if (!fs.existsSync(absPath)) return new Response("Export not found", { status: 404 });
      const mime = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const download = url.searchParams.get("download") === "1";
      return new Response(Bun.file(absPath), {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "no-store",
          ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
        },
      });
    } catch (err: unknown) {
      return new Response(errorMessage(err), { status: 400 });
    }
  }

  // Project-level routes: /api/thumbnails/:slug[/preview|/refine|/export|/box-handoff]
  const thumbMatch = url.pathname.match(/^\/api\/thumbnails\/([^/]+)(?:\/(preview|refine|export|box-handoff))?$/);
  if (thumbMatch) {
    const slug = decodeURIComponent(thumbMatch[1]).trim();
    const sub = thumbMatch[2] || "";
    try {
      if (!sub && req.method === "GET") {
        const detail = getThumbnailProject(slug);
        if (!detail) return Response.json({ error: "Thumbnail not found" }, { status: 404 });
        return Response.json({ ok: true, thumbnail: detail });
      }

      if (sub === "preview" && req.method === "GET") {
        const detail = getThumbnailProject(slug);
        if (!detail) return new Response("Thumbnail not found", { status: 404 });
        return new Response(detail.html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
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
        const attached = Array.isArray(body.attachedImages)
          ? body.attachedImages.map((s) => String(s || "").trim()).filter(Boolean)
          : [];
        const historyLines = Array.isArray(body.history)
          ? body.history
              .slice(-6)
              .map((h) => `${h.role === "user" ? "Creator" : "Otto"}: ${String(h.text || "").slice(0, 400)}`)
              .join("\n")
          : "";

        const prompt = [
          `ISOLATED NON-AI THUMBNAIL REFINEMENT TASK (never asks unnecessary questions; executes directly).`,
          `Target thumbnail slug: "${slug}"${body.title ? ` (title: "${body.title}")` : ""}.`,
          historyLines ? `\nRecent refinement context for this thumbnail:\n${historyLines}\n` : "",
          attached.length > 0
            ? `\nCreator uploaded image attachment(s) in /home/sprite/workspace/:\n${attached.map((p) => `- ${p}`).join("\n")}\nIMPORTANT: Inspect each uploaded image with read, pass its workspace path in assets: [...] when calling thumbnail_save, and reference it in HTML as <img src="/assets/<basename>" />.`
            : "",
          `Creator request: ${instruction}`,
          ``,
          `Instructions:`,
          `1. Call thumbnail_get(slug="${slug}") first to inspect the current 1280x720 HTML and assets.`,
          `2. If the creator wants a different character pose/expression, logo, or photo background, use box_list_assets + box_download_file or pixabay_search_backgrounds + pixabay_download_image, and inspect new assets with read.`,
          `3. Update the 1280x720 HTML/CSS (strictly NO AI-generated images, keep headline strictly in its own side column so it NEVER overlaps the character's face/eyes, keep bottom-right 220x90px duration safe zone clear, optimize for 120px mobile readability) and call thumbnail_save with the EXACT same slug "${slug}" and any newly added workspace asset paths in assets.`,
          `4. MANDATORY VISUAL SELF-CHECK: Call thumbnail_render(slug="${slug}", format="jpg") and then call read on the rendered JPG filePath to visually inspect the actual rendered thumbnail. Verify NO text overlaps the character's face/eyes and framing is clean; if any defect is visible, fix HTML/CSS, call thumbnail_save, and re-verify (up to 2 passes).`,
          `5. Reply concisely (1-2 plain sentences) summarizing what you refined on "${slug}".`,
        ]
          .filter(Boolean)
          .join("\n");

        const wantStream =
          url.searchParams.get("stream") === "1" ||
          (req.headers.get("accept") || "").includes("text/event-stream");
        return await runThumbnailWorker(slug, prompt, wantStream);
      }

      if (sub === "export" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as {
          dataUrl?: string;
          format?: "png" | "jpg";
        };
        const dataUrl = String(body.dataUrl || "");
        const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) {
          return Response.json({ error: "Invalid base64 image dataUrl" }, { status: 400 });
        }
        const format: "png" | "jpg" = body.format === "png" || match[1] === "png" ? "png" : "jpg";
        const bytes = Buffer.from(match[2], "base64");
        if (bytes.length > 10 * 1024 * 1024) {
          return Response.json({ error: "Exported image exceeds 10 MiB limit" }, { status: 413 });
        }
        const saved = saveThumbnailExportBytes(slug, bytes, format);
        broadcast({ type: "thumbnails_changed", slug });
        broadcast({ type: "workspace_changed" });
        return Response.json({
          ok: true,
          project: saved.project,
          workspacePath: saved.workspacePath,
          size: saved.size,
        });
      }

      if (sub === "box-handoff" && req.method === "POST") {
        const detail = getThumbnailProject(slug);
        if (!detail) return Response.json({ error: "Thumbnail not found" }, { status: 404 });
        if (!detail.exportedFile) {
          return Response.json({ error: "Export the thumbnail to PNG/JPG first before Box handoff." }, { status: 400 });
        }
        const absPath = path.join(getThumbnailProjectDir(slug), detail.exportedFile);
        const relPath = `thumbnails/${slug}/${detail.exportedFile}`;
        const result = await exportWorkspaceEntryToBox(absPath, relPath);
        return Response.json({ ok: true, ...result });
      }

      if (!sub && req.method === "DELETE") {
        const ok = deleteThumbnailProject(slug);
        if (!ok) return Response.json({ error: "Thumbnail not found" }, { status: 404 });
        broadcast({ type: "thumbnails_changed", slug, deleted: true });
        return Response.json({ ok: true, deleted: slug });
      }
    } catch (err: unknown) {
      return Response.json({ error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
