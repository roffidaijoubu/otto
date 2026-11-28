import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { downloadPixabayImage, searchPixabayBackgrounds } from "../lib/pixabay.ts";

const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(HOME_DIR, "workspace");

function resolveJailedWorkspacePath(relPath: string): { absPath: string; relPath: string } {
  const cleaned = relPath.trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Destination workspace path is required.");
  }
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const candidate = path.resolve(rootReal, cleaned);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error("Path escapes /home/sprite/workspace.");
  }
  return { absPath: candidate, relPath: path.relative(rootReal, candidate).replace(/\\/g, "/") };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pixabay_search_backgrounds",
    label: "Search Non-AI Stock Backgrounds (Pixabay)",
    description:
      "Search royalty-free horizontal human photography backgrounds on Pixabay (zero local API key via Sprites Connector). Strictly enforces image_type=photo, min_width=1280, safesearch=true, and rejects all AI-generated or low-quality results.",
    parameters: Type.Object({
      query: Type.String({
        description: "Short descriptive search keywords (e.g. 'dark library warm lamp', 'neon arcade room', 'dramatic storm clouds').",
      }),
      limit: Type.Optional(Type.Number({ description: "Max clean results to return (default 8, max 20)." })),
      colors: Type.Optional(
        Type.String({
          description: "Optional Pixabay color filter (e.g. 'black', 'blue', 'red', 'orange', 'green').",
        })
      ),
      editorsChoice: Type.Optional(
        Type.Boolean({ description: "Prefer Pixabay Editor's Choice photos (default false)." })
      ),
    }),
    async execute(_id, params) {
      const result = await searchPixabayBackgrounds({
        query: params.query,
        limit: params.limit,
        colors: params.colors,
        editorsChoice: params.editorsChoice === true,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { count: result.hits.length, filteredOutAi: result.filteredOutAi },
      };
    },
  });

  pi.registerTool({
    name: "pixabay_download_image",
    label: "Download Pixabay Background to Workspace",
    description:
      "Download a Pixabay photo URL (from pixabay_search_backgrounds) into /home/sprite/workspace/ (e.g. 'assets/Backgrounds/dark-library.jpg') so it can be inspected with read and used in thumbnails or OBS overlays.",
    parameters: Type.Object({
      imageUrl: Type.String({ description: "HTTPS largeImageURL or webformatURL returned by pixabay_search_backgrounds." }),
      destWorkspacePath: Type.String({
        description: "Workspace-relative destination path (e.g. 'assets/Backgrounds/dark-library.jpg').",
      }),
    }),
    async execute(_id, params) {
      const { absPath, relPath } = resolveJailedWorkspacePath(params.destWorkspacePath);
      const res = await downloadPixabayImage(params.imageUrl, absPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: true, workspacePath: relPath, absPath: res.destAbsPath, size: res.size, contentType: res.contentType },
              null,
              2
            ),
          },
        ],
        details: { workspacePath: relPath, size: res.size },
      };
    },
  });
}
