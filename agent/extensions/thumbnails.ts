import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  deleteThumbnailProject,
  getThumbnailProject,
  listThumbnailProjects,
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
            "Workspace-relative paths under /home/sprite/workspace/ (e.g. ['assets/characters/light-closeup-gloom-horrified.png', 'assets/backgrounds/dark-library.jpg', 'assets/logos/logo-lion-emblem.png']) to copy into the thumbnail project.",
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
