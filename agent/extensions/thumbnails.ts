import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exportWorkspaceEntryToBox } from "../lib/box.ts";
import {
  deleteThumbnailProject,
  getThumbnailProject,
  getThumbnailProjectDir,
  listThumbnailProjects,
  renderThumbnailHeadless,
  saveThumbnailProject,
} from "../lib/thumbnails.ts";

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function notifyStudioThumbnail(
  endpoint: "/api/internal/thumbnail/open" | "/api/internal/thumbnail/changed",
  payload: Record<string, unknown>
): Promise<{ notified: boolean }> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) return { notified: false };
  try {
    const res = await fetch(`${getInternalBaseUrl()}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    return { notified: res.ok };
  } catch {
    return { notified: false };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "thumbnail_export_box",
    label: "Export Thumbnail to Box (1-Click Handoff)",
    description:
      "Render (if not yet exported) and upload a 1280×720 Thumbnail Studio project to Box with a shareable handoff link.",
    parameters: Type.Object({
      slug: Type.String({ description: "Thumbnail project slug." }),
      format: Type.Optional(
        Type.Union([Type.Literal("jpg"), Type.Literal("png")], {
          description: "Output image format if rendering is needed (default 'jpg').",
        })
      ),
    }),
    async execute(_id, params) {
      let detail = getThumbnailProject(params.slug);
      if (!detail) throw new Error(`Thumbnail "${params.slug}" not found.`);
      if (!detail.exportedFile) {
        renderThumbnailHeadless(params.slug, params.format ?? "jpg");
        detail = getThumbnailProject(params.slug);
      }
      if (!detail?.exportedFile) {
        throw new Error(`Could not export thumbnail "${params.slug}" before Box handoff.`);
      }
      const absPath = path.join(getThumbnailProjectDir(params.slug), detail.exportedFile);
      const relPath = `thumbnails/${params.slug}/${detail.exportedFile}`;
      const result = await exportWorkspaceEntryToBox(absPath, relPath);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, slug: params.slug, ...result }, null, 2) }],
        details: { slug: params.slug, url: result.url },
      };
    },
  });

  pi.registerTool({
    name: "thumbnail_save",
    label: "Save Non-AI Thumbnail Project (1280x720)",
    description:
      "Create or update a 1280x720 non-AI-generated HTML/CSS YouTube/stream thumbnail project in Thumbnail Studio. Copies referenced workspace image assets (character PNGs from Otto Assets, logos, Pixabay stock backgrounds) into the project so they render cleanly at /assets/<basename>.",
    parameters: Type.Object({
      slug: Type.String({
        description: "URL-safe lowercase kebab-case slug (e.g. 'ep12-boss-fight-thumb').",
      }),
      title: Type.String({
        description: "Short display title shown in Thumbnail Studio.",
      }),
      description: Type.Optional(Type.String({ description: "Short note on concept, mood, or video topic." })),
      html: Type.String({
        description:
          "Complete self-contained 1280x720 HTML/CSS thumbnail composition (strictly NO AI-generated images). Reference copied workspace assets via <img src=\"/assets/<basename>\" />.",
      }),
      assets: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Workspace-relative paths under /home/sprite/workspace/ (e.g. ['assets/Characters/White_Light/light-closeup-gloom-horrified.png', 'assets/Backgrounds/dark-library.jpg', 'assets/Logos/logo-lion-emblem.png']) to copy into the thumbnail project.",
        })
      ),
      autoOpen: Type.Optional(
        Type.Boolean({ description: "Open Thumbnail Studio automatically in Otto Studio OS (default true)." })
      ),
    }),
    async execute(_id, params) {
      const { project, copiedAssets } = saveThumbnailProject({
        slug: params.slug,
        title: params.title,
        description: params.description,
        html: params.html,
        assets: params.assets,
      });

      const notify =
        params.autoOpen === false
          ? await notifyStudioThumbnail("/api/internal/thumbnail/changed", { slug: project.slug })
          : await notifyStudioThumbnail("/api/internal/thumbnail/open", {
              slug: project.slug,
              title: project.title,
            });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                slug: project.slug,
                title: project.title,
                previewUrl: project.previewUrl,
                copiedAssets,
                openedInStudio: notify.notified,
              },
              null,
              2
            ),
          },
        ],
        details: { slug: project.slug, assetCount: copiedAssets.length },
      };
    },
  });

  pi.registerTool({
    name: "thumbnail_list",
    label: "List Thumbnail Studio Projects",
    description: "List all saved 1280x720 non-AI thumbnail projects in Thumbnail Studio.",
    parameters: Type.Object({}),
    async execute() {
      const thumbnails = listThumbnailProjects();
      return {
        content: [{ type: "text", text: JSON.stringify({ count: thumbnails.length, thumbnails }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "thumbnail_get",
    label: "Read Thumbnail Project HTML & Metadata",
    description: "Inspect a saved thumbnail project's current metadata, asset list, and 1280x720 HTML/CSS before refining it.",
    parameters: Type.Object({
      slug: Type.String({ description: "Thumbnail project slug." }),
    }),
    async execute(_id, params) {
      const detail = getThumbnailProject(params.slug);
      if (!detail) {
        throw new Error(`Thumbnail project "${params.slug}" not found.`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "thumbnail_render",
    label: "Render Thumbnail Project to JPG/PNG (Headless Chrome)",
    description:
      "Autonomously render a saved 1280x720 Thumbnail Studio HTML project into a YouTube-ready JPG (< 2 MB) or PNG image inside /home/sprite/workspace/thumbnails/<slug>/ using headless Chrome. Use this whenever you need the final image file (for YouTube upload, Box handoff, or critique_thumbnail) without asking the user to click Export manually.",
    parameters: Type.Object({
      slug: Type.String({ description: "Thumbnail project slug to render." }),
      format: Type.Optional(
        Type.Union([Type.Literal("jpg"), Type.Literal("png")], {
          description: "Output image format (default 'jpg' for guaranteed < 2 MB YouTube compatibility).",
        })
      ),
    }),
    async execute(_id, params) {
      const format = params.format === "png" ? "png" : "jpg";
      const out = renderThumbnailHeadless(params.slug, format);
      await notifyStudioThumbnail("/api/internal/thumbnail/changed", { slug: params.slug });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                slug: params.slug,
                format,
                workspacePath: out.workspacePath,
                absPath: out.filePath,
                size: out.size,
                exportedUrl: out.project.exportedUrl,
              },
              null,
              2
            ),
          },
        ],
        details: { slug: params.slug, size: out.size },
      };
    },
  });

  pi.registerTool({
    name: "thumbnail_delete",
    label: "Delete Thumbnail Studio Project",
    description: "Delete a saved thumbnail project from Thumbnail Studio.",
    parameters: Type.Object({
      slug: Type.String({ description: "Thumbnail project slug to delete." }),
    }),
    async execute(_id, params) {
      const deleted = deleteThumbnailProject(params.slug);
      if (!deleted) {
        throw new Error(`Thumbnail project "${params.slug}" not found.`);
      }
      await notifyStudioThumbnail("/api/internal/thumbnail/changed", { slug: params.slug, deleted: true });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, deleted: params.slug }, null, 2) }],
      };
    },
  });
}
