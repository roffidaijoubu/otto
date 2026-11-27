import fs from "node:fs";
import path from "node:path";
import { runThumbnailWorker } from "../lib/background-job.ts";
import { errorMessage } from "../lib/http.ts";
import { broadcast } from "../lib/sse.ts";
import {
  deleteThumbnailProject,
  getThumbnailAssetPath,
  getThumbnailProject,
  getThumbnailProjectDir,
  listThumbnailProjects,
  saveThumbnailExportBytes,
} from "../../agent/lib/thumbnails.ts";
import { exportWorkspaceEntryToBox } from "../../agent/lib/box.ts";

export async function handleThumbnailsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/thumbnails") {
    const thumbnails = listThumbnailProjects();
    return Response.json({ ok: true, thumbnails });
  }

  // Isolated background creation of a new non-AI 1280x720 thumbnail (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/thumbnails/create") {
    try {
      const body = (await req.json().catch(() => ({}))) as { prompt?: string };
      const userPrompt = String(body.prompt || "").trim();
      if (!userPrompt) {
        return Response.json({ error: "Thumbnail prompt is required" }, { status: 400 });
      }

      const beforeSlugs = new Set(listThumbnailProjects().map((t) => t.slug));

      const prompt = [
        `ISOLATED NON-AI THUMBNAIL CREATION TASK (never asks questions; builds and saves directly).`,
        `Creator request: ${userPrompt}`,
        ``,
        `Instructions:`,
        `1. STRICTLY ZERO AI-GENERATED IMAGES. Follow the thumbnail-craft skill.`,
        `2. Discover real creator cutouts & logos in Box using box_list_assets (e.g. subpath "Characters", "Characters/White_Light", "Characters/Black_Dark", "Logos") and download the best matching PNG(s) with box_download_file into "assets/..." inside /home/sprite/workspace/.`,
        `3. If a photographic background fits the concept, call pixabay_search_backgrounds (already hard-filtered to isAiGenerated=false) and download a clean horizontal photo with pixabay_download_image into "assets/backgrounds/...".`,
        `4. Call read on your downloaded PNG/photo assets so you visually confirm expression, framing, and brand colors before styling.`,
        `5. Compose a punchy 1280x720 HTML/CSS thumbnail (2-4 word bold hook text, large expressive character cutout, high-contrast scrim, keep bottom-right YouTube duration corner clear) referencing assets via <img src="/assets/<basename>" />.`,
        `6. Call thumbnail_save with a clean lowercase kebab-case slug, title, description, html, and assets (array of downloaded workspace-relative paths).`,
        `7. Reply concisely (1-2 plain sentences) summarizing the thumbnail concept and its slug.`,
      ].join("\n");

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
          `ISOLATED NON-AI THUMBNAIL REFINEMENT TASK (never asks unnecessary questions; executes directly).`,
          `Target thumbnail slug: "${slug}"${body.title ? ` (title: "${body.title}")` : ""}.`,
          historyLines ? `\nRecent refinement context for this thumbnail:\n${historyLines}\n` : "",
          `Creator request: ${instruction}`,
          ``,
          `Instructions:`,
          `1. Call thumbnail_get(slug="${slug}") first to inspect the current 1280x720 HTML and assets.`,
          `2. If the creator wants a different character pose/expression, logo, or photo background, use box_list_assets + box_download_file or pixabay_search_backgrounds + pixabay_download_image, and inspect new assets with read.`,
          `3. Update the 1280x720 HTML/CSS (strictly NO AI-generated images, keep bottom-right duration safe zone clear, optimize for 120px mobile readability) and call thumbnail_save with the EXACT same slug "${slug}" and any newly added workspace asset paths in assets.`,
          `4. Reply concisely (1-2 plain sentences) summarizing what you refined on "${slug}".`,
        ]
          .filter(Boolean)
          .join("\n");

        return await runThumbnailWorker(slug, prompt);
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
