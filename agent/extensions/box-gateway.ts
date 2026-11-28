import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  downloadBoxFileToLocal,
  ensureBoxAssetsFolder,
  exportWorkspaceEntryToBox,
  listBoxFolder,
} from "../lib/box.ts";

const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(HOME_DIR, "workspace");

function resolveJailedWorkspacePath(relPath: string): { absPath: string; relPath: string } {
  const cleaned = relPath.trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Workspace path is required.");
  }
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const candidate = path.resolve(rootReal, cleaned);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error("Path escapes /home/sprite/workspace.");
  }
  if (fs.existsSync(candidate)) {
    const real = fs.realpathSync(candidate);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error("Symlink target escapes /home/sprite/workspace.");
    }
    return { absPath: real, relPath: path.relative(rootReal, real).replace(/\\/g, "/") };
  }
  return { absPath: candidate, relPath: path.relative(rootReal, candidate).replace(/\\/g, "/") };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "box_list_folder",
    label: "List Box Folder",
    description:
      "List files and folders in the creator's connected Box account (zero local API keys via Box Sprites Connector). Pass folderId='0' for root.",
    parameters: Type.Object({
      folderId: Type.Optional(Type.String({ description: "Box folder ID (default '0' for root)." })),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default 50, max 200)." })),
    }),
    async execute(_id, params) {
      const entries = await listBoxFolder(params.folderId || "0", params.limit ?? 50);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: entries.length, entries }, null, 2) }],
        details: { count: entries.length },
      };
    },
  });

  pi.registerTool({
    name: "box_list_assets",
    label: "List Otto Assets in Box",
    description:
      "Ensure and list the creator's 'Otto Assets/' folder (and optional subfolder like 'Characters', 'Characters/Black_Dark', 'Logos', or 'Backgrounds') in Box for reusable non-AI creator assets (VTuber PNG cutouts, logos, backgrounds). Returns the folder URL and entries.",
    parameters: Type.Object({
      subpath: Type.Optional(
        Type.String({
          description: "Optional subfolder path inside 'Otto Assets/' (e.g. 'Characters' or 'Characters/White_Light').",
        })
      ),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default 100, max 200)." })),
    }),
    async execute(_id, params) {
      const segments = (params.subpath || "")
        .split("/")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const folder = await ensureBoxAssetsFolder(segments);
      const entries = await listBoxFolder(folder.id, params.limit ?? 100);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ folder, count: entries.length, entries }, null, 2),
          },
        ],
        details: { folderId: folder.id, count: entries.length },
      };
    },
  });

  pi.registerTool({
    name: "box_upload_file",
    label: "Upload Workspace File or Folder to Box",
    description:
      "Upload a file or folder from /home/sprite/workspace/ (e.g. 'clips/<id>/clip.mp4', 'briefs/thumb-brief.md', or a whole clip folder) into the creator's Box 'Otto Handoffs/' folder for human editors and artists. Returns the direct Box URL. Max 48 MiB per file.",
    parameters: Type.Object({
      workspacePath: Type.String({
        description: "Workspace-relative path inside /home/sprite/workspace/ (e.g. 'clips/abc/clip_01.mp4' or 'briefs/stream-brief.md').",
      }),
    }),
    async execute(_id, params) {
      const { absPath, relPath } = resolveJailedWorkspacePath(params.workspacePath);
      if (!fs.existsSync(absPath)) {
        throw new Error(`Workspace entry not found: ${relPath}`);
      }
      const result = await exportWorkspaceEntryToBox(absPath, relPath);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }, null, 2) }],
        details: { id: result.id, kind: result.kind, uploadedCount: result.uploadedCount },
      };
    },
  });

  pi.registerTool({
    name: "box_download_file",
    label: "Download File from Box to Workspace",
    description:
      "Download a file from the creator's Box account (e.g. a human artist's thumbnail draft or editor cut) into /home/sprite/workspace/ so it can be inspected with critique_thumbnail, watch_clip, or read.",
    parameters: Type.Object({
      fileId: Type.String({ description: "Box file ID (from box_list_folder)." }),
      destWorkspacePath: Type.String({
        description: "Destination path relative to /home/sprite/workspace/ (e.g. 'thumbnails/draft_v2.png').",
      }),
    }),
    async execute(_id, params) {
      const { absPath, relPath } = resolveJailedWorkspacePath(params.destWorkspacePath);
      const res = await downloadBoxFileToLocal(params.fileId, absPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, workspacePath: relPath, absPath: res.destAbsPath, size: res.size }, null, 2),
          },
        ],
        details: { workspacePath: relPath, size: res.size },
      };
    },
  });

  pi.registerTool({
    name: "box_sync_workspace",
    label: "Incremental Workspace ↔ Box Sync",
    description:
      "Check status or trigger an incremental two-way sync between /home/sprite/workspace/ and the creator's Box folder (with built-in file size guardrails).",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([Type.Literal("sync"), Type.Literal("status")], {
          description: "'sync' (default) runs incremental sync; 'status' checks last sync state without modifying files.",
        })
      ),
    }),
    async execute(_id, params) {
      const secret = process.env.LMA_INTERNAL_SECRET;
      if (!secret) throw new Error("LMA_INTERNAL_SECRET unavailable — requires lma-web supervisor.");
      const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
      const isStatus = params.action === "status";
      const res = await fetch(
        `http://127.0.0.1:${port}${isStatus ? "/api/internal/box-sync/status" : "/api/internal/box-sync"}`,
        {
          method: isStatus ? "GET" : "POST",
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(60_000),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Box sync failed (HTTP ${res.status})`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });
}
