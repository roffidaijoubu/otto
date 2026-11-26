import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(
  process.env.LMA_WORKSPACE_DIR || path.join(HOME_DIR, "workspace")
);
const ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, "artifacts");

const ALLOWED_EXTS = new Set([
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".svg",
  ".mmd",
  ".mermaid",
  ".md",
  ".markdown",
]);

type ArtifactKind = "html" | "react" | "svg" | "mermaid" | "markdown";

function kindToDefaultExt(kind?: string): string {
  if (kind === "react") return ".jsx";
  if (kind === "svg") return ".svg";
  if (kind === "mermaid") return ".mmd";
  if (kind === "markdown") return ".md";
  return ".html";
}

function extToKind(filename: string): ArtifactKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jsx" || ext === ".tsx") return "react";
  if (ext === ".svg") return "svg";
  if (ext === ".mmd" || ext === ".mermaid") return "mermaid";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "html";
}

function sanitizeFilename(raw: string, fallbackKind?: string): string {
  const base = raw
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  const name = base || `artifact-${Date.now()}`;
  const ext = path.extname(name).toLowerCase();
  if (ext && ALLOWED_EXTS.has(ext)) {
    return name;
  }
  return `${name}${kindToDefaultExt(fallbackKind)}`;
}

function resolveWorkspaceRelPath(rawRel: string): { absPath: string; relPath: string } {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const cleaned = rawRel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Invalid workspace path");
  }
  for (const seg of cleaned.split("/")) {
    if (!seg || seg === "." || seg === ".." || seg.startsWith(".")) {
      throw new Error("Hidden segments and path traversal are not allowed");
    }
  }
  const absPath = path.resolve(rootReal, cleaned);
  if (absPath !== rootReal && !absPath.startsWith(rootReal + path.sep)) {
    throw new Error("Path escapes workspace root");
  }
  return { absPath, relPath: cleaned };
}

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function notifyStudioOpenArtifact(payload: {
  path: string;
  title: string;
  kind: ArtifactKind;
  autoFocus?: boolean;
}): Promise<{ notified: boolean; note?: string }> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) {
    return { notified: false, note: "LMA_INTERNAL_SECRET unavailable (headless CLI mode)." };
  }
  try {
    const res = await fetch(`${getInternalBaseUrl()}/api/internal/artifact/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { notified: false, note: `Studio UI returned HTTP ${res.status}` };
    }
    return { notified: true };
  } catch (err) {
    return {
      notified: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "artifact_create",
    label: "Create & Open Live Artifact",
    description:
      "Create or update a live interactive artifact in /home/sprite/workspace/artifacts/ (HTML/CSS/JS, React JSX/TSX, SVG, Mermaid diagram, or Markdown document) and immediately open/refresh it in the Otto Studio OS Artifacts window.",
    parameters: Type.Object({
      filename: Type.String({
        description:
          "Filename inside workspace/artifacts/ (e.g. 'stream-countdown.html', 'sponsor-calc.jsx', 'channel-flow.mmd', 'overlay-badge.svg', 'media-kit.md').",
      }),
      title: Type.String({
        description: "Short human-friendly title shown in the Artifacts window header and chat card.",
      }),
      content: Type.String({
        description:
          "Full source content of the artifact. For HTML: complete self-contained HTML document. For React JSX/TSX: export default a React component (React, hooks, lucide-react, and Tailwind CSS are available in the sandbox). For SVG: complete <svg> markup. For Mermaid: Mermaid diagram definition.",
      }),
      kind: Type.Optional(
        Type.Union([
          Type.Literal("html"),
          Type.Literal("react"),
          Type.Literal("svg"),
          Type.Literal("mermaid"),
          Type.Literal("markdown"),
        ])
      ),
      autoFocus: Type.Optional(
        Type.Boolean({
          description: "Whether to open and focus the Artifacts window immediately (default true).",
        })
      ),
    }),
    async execute(_id, params) {
      const safeFile = sanitizeFilename(params.filename, params.kind);
      const relPath = `artifacts/${safeFile}`;
      const { absPath } = resolveWorkspaceRelPath(relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, params.content, "utf8");
      fs.renameSync(tmp, absPath);

      const kind = params.kind || extToKind(safeFile);
      const notify = await notifyStudioOpenArtifact({
        path: relPath,
        title: params.title.trim() || safeFile,
        kind,
        autoFocus: params.autoFocus !== false,
      });

      const cardLink = `[${params.title.trim() || safeFile}](artifact:${relPath})`;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                path: relPath,
                absPath,
                title: params.title.trim() || safeFile,
                kind,
                openedInStudio: notify.notified,
                note: notify.note,
                chatCardMarkdown: cardLink,
              },
              null,
              2
            ),
          },
        ],
        details: { path: relPath, kind, openedInStudio: notify.notified },
      };
    },
  });

  pi.registerTool({
    name: "artifact_present",
    label: "Open Existing Workspace Artifact",
    description:
      "Open an existing HTML, React JSX/TSX, SVG, Mermaid, or Markdown file from /home/sprite/workspace/ in the live Artifacts window.",
    parameters: Type.Object({
      path: Type.String({
        description: "Workspace-relative path (e.g. 'artifacts/stream-countdown.html' or 'scripts/rundown.md').",
      }),
      title: Type.Optional(Type.String({ description: "Optional display title." })),
      autoFocus: Type.Optional(Type.Boolean({ description: "Focus the Artifacts window (default true)." })),
    }),
    async execute(_id, params) {
      const { absPath, relPath } = resolveWorkspaceRelPath(params.path);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        throw new Error(`Artifact file not found: ${relPath}`);
      }
      const ext = path.extname(absPath).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) {
        throw new Error(`Unsupported artifact extension '${ext}'. Use .html, .jsx, .tsx, .svg, .mmd, or .md.`);
      }
      const kind = extToKind(absPath);
      const title = (params.title || "").trim() || path.basename(absPath);
      const notify = await notifyStudioOpenArtifact({
        path: relPath,
        title,
        kind,
        autoFocus: params.autoFocus !== false,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                path: relPath,
                title,
                kind,
                openedInStudio: notify.notified,
                chatCardMarkdown: `[${title}](artifact:${relPath})`,
              },
              null,
              2
            ),
          },
        ],
        details: { path: relPath, kind, openedInStudio: notify.notified },
      };
    },
  });
}
