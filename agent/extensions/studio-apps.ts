import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  deleteCustomStudioApp,
  getCustomStudioApp,
  getCustomStudioAppState,
  listCustomStudioApps,
  saveCustomStudioApp,
  saveCustomStudioAppState,
} from "../lib/studio-apps.ts";

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

async function notifyStudioAppEvent(
  endpoint: "/api/internal/studio-app/open" | "/api/internal/studio-app/changed",
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
    return {
      notified: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "studio_app_create",
    label: "Install or Update Custom Studio App",
    description:
      "Create or update a local Custom Studio App inside Otto Studio OS (stored outside Studio Files, not downloadable). Immediately adds a Desktop shortcut and opens it in its own native OS window. Supports React/JSX (recommended, with Tailwind CSS, lucide-react, recharts, Otto DESIGN.md tokens, and persistent `window.ottoApp.loadState()` / `saveState(data)` bridge), self-contained HTML/CSS/JS, or SVG.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Lowercase hyphenated app ID (e.g. 'sponsor-calculator', 'stream-rundown', 'subathon-tracker').",
      }),
      title: Type.String({
        description: "Short native window & desktop shortcut title (2-4 words, e.g. 'Sponsor Calculator').",
      }),
      description: Type.Optional(
        Type.String({ description: "One-line subtitle shown under the desktop icon or app info." })
      ),
      kind: Type.Optional(
        Type.Union([Type.Literal("react"), Type.Literal("html"), Type.Literal("svg")], {
          description: "App runtime type: 'react' (default, JSX/TSX default export), 'html', or 'svg'.",
        })
      ),
      code: Type.String({
        description:
          "Full source code. Follow the studio-app-craft skill strictly: full-bleed native desktop app UI (`h-screen w-full flex flex-col bg-white text-[#171717]`, `#FAF9F6` top toolbar/sidebar, `1px` hairline dividers, `#171717` primary actions, `IBM Plex Mono` `tabular-nums`, zero centered `max-w-*` webpage wrappers, outer grey margins, floating cards, or drop shadows; plus `unslop-ui`). Use `window.useOttoState` (React) or `window.ottoApp.initialState` + `window.ottoApp.saveState(nextState)` (HTML/JS) to persist user data across refreshes.",
      }),
      defaultWidth: Type.Optional(Type.Number({ description: "Preferred window width in px (420-1200, default 680)." })),
      defaultHeight: Type.Optional(Type.Number({ description: "Preferred window height in px (360-900, default 580)." })),
      initialState: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description: "Optional default JSON state seeded into state.json if no state exists yet.",
        })
      ),
      autoOpen: Type.Optional(
        Type.Boolean({ description: "Open the app in its own OS window immediately (default true)." })
      ),
    }),
    async execute(_id, params) {
      const meta = saveCustomStudioApp({
        slug: params.slug,
        title: params.title,
        description: params.description,
        kind: params.kind || "react",
        code: params.code,
        defaultWidth: params.defaultWidth,
        defaultHeight: params.defaultHeight,
        initialState: params.initialState as Record<string, unknown> | undefined,
      });

      const notify =
        params.autoOpen === false
          ? await notifyStudioAppEvent("/api/internal/studio-app/changed", { slug: meta.slug })
          : await notifyStudioAppEvent("/api/internal/studio-app/open", {
              slug: meta.slug,
              title: meta.title,
              autoFocus: true,
            });

      const chatCardMarkdown = `[${meta.title}](studio-app:${meta.slug})`;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                app: meta,
                openedInStudio: notify.notified,
                note: notify.note,
                chatCardMarkdown,
              },
              null,
              2
            ),
          },
        ],
        details: { slug: meta.slug, title: meta.title, openedInStudio: notify.notified },
      };
    },
  });

  pi.registerTool({
    name: "studio_app_open",
    label: "Open Custom Studio App Window",
    description: "Open and focus an installed Custom Studio App in its own native Otto Studio OS window.",
    parameters: Type.Object({
      slug: Type.String({ description: "App slug to open." }),
    }),
    async execute(_id, params) {
      const app = getCustomStudioApp(params.slug);
      if (!app) {
        throw new Error(`Custom studio app '${params.slug}' is not installed.`);
      }
      const notify = await notifyStudioAppEvent("/api/internal/studio-app/open", {
        slug: app.meta.slug,
        title: app.meta.title,
        autoFocus: true,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                app: app.meta,
                openedInStudio: notify.notified,
                chatCardMarkdown: `[${app.meta.title}](studio-app:${app.meta.slug})`,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "studio_app_list",
    label: "List Installed Custom Studio Apps",
    description: "List all local Custom Studio Apps installed on the Otto Studio OS Desktop.",
    parameters: Type.Object({}),
    async execute() {
      const apps = listCustomStudioApps();
      return {
        content: [{ type: "text", text: JSON.stringify({ count: apps.length, apps }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "studio_app_delete",
    label: "Uninstall Custom Studio App",
    description: "Remove a Custom Studio App from the Otto Studio OS Desktop and delete its local state.",
    parameters: Type.Object({
      slug: Type.String({ description: "App slug to remove." }),
    }),
    async execute(_id, params) {
      const deleted = deleteCustomStudioApp(params.slug);
      if (!deleted) {
        throw new Error(`Custom studio app '${params.slug}' was not found.`);
      }
      await notifyStudioAppEvent("/api/internal/studio-app/changed", { slug: params.slug, deleted: true });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, deleted: params.slug }, null, 2) }],
      };
    },
  });

  pi.registerTool({
    name: "studio_app_state",
    label: "Read or Update Custom Studio App State",
    description:
      "Read or patch the persistent JSON state of a local Custom Studio App (mirroring GET/PUT /api/studio-apps/:slug/state in the UI).",
    parameters: Type.Object({
      slug: Type.String({ description: "App slug." }),
      patch: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description: "Optional JSON object to merge into (or replace when replace=true) the app's persistent state. Omit to read current state.",
        })
      ),
      replace: Type.Optional(
        Type.Boolean({ description: "If true, replace state wholesale instead of shallow-merging patch (default false)." })
      ),
    }),
    async execute(_id, params) {
      const app = getCustomStudioApp(params.slug);
      if (!app) throw new Error(`Custom studio app '${params.slug}' was not found.`);
      if (params.patch === undefined) {
        const state = getCustomStudioAppState(params.slug);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, slug: params.slug, state }, null, 2) }],
        };
      }
      const next = params.replace
        ? params.patch
        : { ...getCustomStudioAppState(params.slug), ...params.patch };
      const saved = saveCustomStudioAppState(params.slug, next);
      await notifyStudioAppEvent("/api/internal/studio-app/changed", { slug: params.slug });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, slug: params.slug, state: saved }, null, 2) }],
      };
    },
  });
}
