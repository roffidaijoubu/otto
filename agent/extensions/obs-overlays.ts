import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  deleteHostedObsOverlay,
  deployObsOverlay,
  listHostedObsOverlays,
  updateObsOverlayState,
  type OverlayControlField,
} from "../lib/obs-overlays.ts";

const HOME_DIR = process.env.HOME || "/home/sprite";
const WORKSPACE_ROOT = path.resolve(HOME_DIR, "workspace");

function resolveJailedWorkspaceFile(relPath: string): { absPath: string; relPath: string } {
  const cleaned = relPath.trim().replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Asset workspace path is required.");
  }
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(WORKSPACE_ROOT);
  const candidate = path.resolve(rootReal, cleaned);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error(`Asset path escapes /home/sprite/workspace: ${relPath}`);
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(`Asset file not found in workspace: ${relPath}`);
  }
  const real = fs.realpathSync(candidate);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(`Asset symlink escapes /home/sprite/workspace: ${relPath}`);
  }
  return { absPath: real, relPath: path.relative(rootReal, real).replace(/\\/g, "/") };
}

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function notifyStudioObsOverlay(
  endpoint: "/api/internal/obs-overlay/open" | "/api/internal/obs-overlay/changed",
  payload: Record<string, unknown>
): Promise<{ notified: boolean; note?: string }> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) {
    return { notified: false, note: "LMA_INTERNAL_SECRET unavailable (headless CLI mode)." };
  }
  try {
    const res = await fetch(`${getInternalBaseUrl()}${endpoint}`, {
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
    return { notified: false, note: err instanceof Error ? err.message : String(err) };
  }
}

const ControlFieldSchema = Type.Object({
  key: Type.String({ description: "State property key (e.g. 'headline', 'showLowerThird', 'theme')." }),
  label: Type.String({ description: "Short human label shown in the Remote Control deck." }),
  type: Type.Union([
    Type.Literal("text"),
    Type.Literal("textarea"),
    Type.Literal("number"),
    Type.Literal("toggle"),
    Type.Literal("select"),
    Type.Literal("timer_action"),
  ]),
  options: Type.Optional(Type.Array(Type.String(), { description: "Options for 'select' fields." })),
  placeholder: Type.Optional(Type.String()),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  step: Type.Optional(Type.Number()),
  action: Type.Optional(
    Type.Union([
      Type.Literal("start"),
      Type.Literal("pause"),
      Type.Literal("reset"),
      Type.Literal("add_seconds"),
    ])
  ),
  seconds: Type.Optional(Type.Number({ description: "Delta seconds for 'add_seconds' timer action." })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "obs_overlay_start_job",
    label: "Start Background OBS Overlay Job (Isolated Worker)",
    description:
      "Dispatch OBS overlay creation or layout/style refinement to an isolated background OMP worker so main Otto Chat stays free while OBS Overlays displays a live in-progress card. ALWAYS prefer this from main Otto Chat whenever the creator asks to create or redesign an OBS overlay (pass a detailed brief + any uploaded workspace image paths in attachedImages). For quick live state tweaks (text/timer/visibility), use obs_overlay_control directly.",
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "Detailed creative brief written by Otto (overlay type, layout, brand logo/character from Otto Assets, matching visual style/palette, controls needed, timer duration, etc.).",
      }),
      attachedImages: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional workspace-relative image paths under /home/sprite/workspace/ (e.g. ['uploads/logo.png']) attached by the creator in chat.",
        })
      ),
      slug: Type.Optional(
        Type.String({ description: "Optional existing overlay slug to refine instead of creating a new one." })
      ),
      label: Type.Optional(
        Type.String({ description: "Short progress title shown on the in-progress card (e.g. 'Building Starting Soon Overlay...')." })
      ),
    }),
    async execute(_id, params) {
      const secret = process.env.LMA_INTERNAL_SECRET;
      if (!secret) {
        throw new Error("LMA_INTERNAL_SECRET unavailable — cannot dispatch background OBS overlay job.");
      }
      const res = await fetch(`${getInternalBaseUrl()}/api/internal/obs-overlays/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          prompt: params.prompt,
          attachedImages: params.attachedImages || [],
          slug: params.slug,
          label: params.label,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Failed to start OBS overlay job (HTTP ${res.status})`);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                jobId: data.jobId,
                dispatchedTo: "OBS Overlays (isolated background worker)",
                note: "The OBS overlay is now building & deploying in the background. Main Otto Chat is free immediately.",
              },
              null,
              2
            ),
          },
        ],
        details: { jobId: data.jobId },
      };
    },
  });

  pi.registerTool({
    name: "obs_overlay_deploy",
    label: "Deploy Live OBS Overlay to Fly Machine",
    description:
      "Deploy or update a public, transparent 1920x1080 OBS Browser Source overlay hosted on the dedicated auto-stop Fly Machine (256 MB + 1 GB persistent Volume via zero-key Fly Machines connector) with realtime SSE Remote Control sync. Opens the OBS Overlays window inside Otto Studio OS.",
    parameters: Type.Object({
      slug: Type.String({
        description: "URL-safe overlay slug (e.g. 'starting-soon', 'lower-third', 'brb', 'sub-goal').",
      }),
      title: Type.String({
        description: "Short display title (e.g. 'Starting Soon', 'Lower Third').",
      }),
      description: Type.Optional(Type.String({ description: "One-line description of what this overlay shows." })),
      html: Type.String({
        description:
          "Complete transparent 1920x1080 OBS Browser Source HTML (NO control buttons inside the overlay!). Subscribe to live state via `window.OBS_OVERLAY.subscribe((state) => { ... })`. Follow the obs-overlay-craft skill.",
      }),
      controlHtml: Type.Optional(
        Type.String({
          description:
            "Optional custom full-bleed Live Remote Controller HTML served at /c/<slug> (use whenever the creator wants tabs, looping prev/next arrows, repeatable add/remove lists, scene buttons, or custom deck layouts). Automatically receives `window.OBS_CONTROL` (`subscribe(fn)`, `patch(obj)`, `getState()`, `meta`). Follow Section 5 of obs-overlay-craft (full-bleed native UI, no outer cards/margins).",
        })
      ),
      controls: Type.Optional(
        Type.Array(ControlFieldSchema, {
          description:
            "Declarative Remote Control deck fields synced live to the OBS overlay via SSE (text inputs, toggles, selects, timer_action buttons).",
        })
      ),
      initialState: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description: "Initial live JSON state (e.g. { headline: 'Starting Soon', durationSec: 300, remainingSec: 300, running: false }).",
        })
      ),
      resetState: Type.Optional(
        Type.Boolean({ description: "Reset existing live state to initialState on redeploy (default false)." })
      ),
      assets: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional workspace-relative image paths under /home/sprite/workspace/ (e.g. ['assets/logos/logo-full.png']) to upload to the Fly Machine so the overlay HTML can render them cleanly via <img src=\"/assets/<basename>\" />.",
        })
      ),
      autoOpen: Type.Optional(
        Type.Boolean({ description: "Open the OBS Overlays OS window automatically (default true)." })
      ),
    }),
    async execute(_id, params) {
      const resolvedAssets = (params.assets || []).map((rel) => {
        const { absPath } = resolveJailedWorkspaceFile(rel);
        return { absPath, name: path.basename(absPath) };
      });
      const { machine, overlay, uploadedAssets } = await deployObsOverlay({
        slug: params.slug,
        title: params.title,
        description: params.description,
        html: params.html,
        controlHtml: params.controlHtml,
        controls: (params.controls || []) as OverlayControlField[],
        initialState: (params.initialState || {}) as Record<string, unknown>,
        resetState: params.resetState === true,
        assets: resolvedAssets,
      });

      const notify =
        params.autoOpen === false
          ? await notifyStudioObsOverlay("/api/internal/obs-overlay/changed", { slug: overlay.slug })
          : await notifyStudioObsOverlay("/api/internal/obs-overlay/open", {
              slug: overlay.slug,
              title: overlay.title,
              autoFocus: true,
            });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                appName: machine.appName,
                region: machine.region,
                slug: overlay.slug,
                title: overlay.title,
                obsBrowserSourceUrl: overlay.overlayUrl,
                remoteControlUrl: overlay.controlUrl,
                hostedAssets: uploadedAssets,
                openedInStudio: notify.notified,
                chatCardMarkdown: `[${overlay.title}](obs-overlay:${overlay.slug})`,
              },
              null,
              2
            ),
          },
        ],
        details: { slug: overlay.slug, overlayUrl: overlay.overlayUrl },
      };
    },
  });

  pi.registerTool({
    name: "obs_overlay_control",
    label: "Update Live OBS Overlay State",
    description:
      "Send a live state update to a deployed OBS overlay on the Fly Machine (pushes immediately via SSE to OBS Browser Source and Remote Control decks).",
    parameters: Type.Object({
      slug: Type.String({ description: "Overlay slug to control (e.g. 'starting-soon')." }),
      patch: Type.Record(Type.String(), Type.Any(), {
        description: "Partial state fields to merge into the live overlay state (e.g. { headline: 'Boss Fight #12', running: true }).",
      }),
      replace: Type.Optional(
        Type.Boolean({ description: "Replace entire state instead of merging (default false)." })
      ),
    }),
    async execute(_id, params) {
      const result = await updateObsOverlayState(
        params.slug,
        params.patch as Record<string, unknown>,
        params.replace === true
      );
      await notifyStudioObsOverlay("/api/internal/obs-overlay/changed", { slug: params.slug });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, slug: params.slug, state: result.state }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "obs_overlay_list",
    label: "List Hosted OBS Overlays",
    description: "List all live OBS overlays hosted on the Fly Machine along with their public OBS Browser Source URLs and current states.",
    parameters: Type.Object({}),
    async execute() {
      const { status, overlays } = await listHostedObsOverlays();
      return {
        content: [{ type: "text", text: JSON.stringify({ status, count: overlays.length, overlays }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "obs_overlay_delete",
    label: "Delete Hosted OBS Overlay",
    description: "Delete a hosted OBS overlay from the Fly Machine volume.",
    parameters: Type.Object({
      slug: Type.String({ description: "Overlay slug to delete." }),
    }),
    async execute(_id, params) {
      const deleted = await deleteHostedObsOverlay(params.slug);
      if (!deleted) {
        throw new Error(`OBS overlay '${params.slug}' was not found or machine is not provisioned.`);
      }
      await notifyStudioObsOverlay("/api/internal/obs-overlay/changed", { slug: params.slug, deleted: true });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, deleted: params.slug }, null, 2) }],
      };
    },
  });
}
