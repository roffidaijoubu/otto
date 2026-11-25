import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const HOME_DIR = process.env.HOME || "/home/sprite";
const COOKIES_DIR = path.join(HOME_DIR, ".config", "lma", "cookies");

function sanitizeSite(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom"
  );
}

function getInternalBaseUrl(): string {
  const port = process.env.LMA_WEB_PORT || process.env.PORT || "8080";
  return `http://127.0.0.1:${port}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_login",
    label: "Prompt User Browser Login",
    description:
      "Open an interactive non-headless Chrome modal in the user's Otto dashboard so the user can log into a platform (e.g., x, tiktok, youtube, instagram, reddit, notebooklm, or custom site) and pass 2FA/CAPTCHA. Automatically captures session cookies via CDP once login completes, auto-closes the modal, and saves cookies to ~/.config/lma/cookies/.",
    parameters: Type.Object({
      site: Type.String({
        description:
          "Platform slug: 'x', 'tiktok', 'youtube', 'instagram', 'reddit', 'notebooklm', or a custom slug.",
      }),
      url: Type.Optional(
        Type.String({
          description: "Optional login URL override (defaults to platform preset URL).",
        })
      ),
      reason: Type.Optional(
        Type.String({
          description: "Short explanation shown in the modal header telling the user why login is needed.",
        })
      ),
      expectedCookies: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional cookie names that indicate login succeeded (e.g. ['auth_token', 'ct0']).",
        })
      ),
      successUrlRegex: Type.Optional(
        Type.String({
          description: "Optional regex matched against the active tab URL to confirm login succeeded.",
        })
      ),
      timeoutSec: Type.Optional(
        Type.Number({
          description: "Max seconds to wait for user login (default 600, max 1200).",
        })
      ),
    }),
    async execute(_id, params, signal) {
      const secret = process.env.LMA_INTERNAL_SECRET;
      if (!secret) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  error:
                    "LMA_INTERNAL_SECRET is not set. browser_login must be invoked from the Otto Web UI server.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const baseUrl = getInternalBaseUrl();
      const startRes = await fetch(`${baseUrl}/api/internal/browser-login/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(params),
        signal,
      });

      const startData = (await startRes.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        error?: string;
        request?: { requestId: string; status: string };
      };

      if (!startRes.ok || !startData.ok || !startData.request?.requestId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  reason: startData.reason || "request_failed",
                  error: startData.error || `HTTP ${startRes.status}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const requestId = startData.request.requestId;

      // Short long-poll loop (20s chunks) to stay well below Bun's 255s idleTimeout
      while (true) {
        if (signal?.aborted) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, status: "aborted", requestId }, null, 2),
              },
            ],
          };
        }

        const pollRes = await fetch(
          `${baseUrl}/api/internal/browser-login/status?id=${encodeURIComponent(requestId)}&wait=20000`,
          {
            headers: { Authorization: `Bearer ${secret}` },
            signal,
          }
        );

        const pollData = (await pollRes.json().catch(() => ({}))) as {
          ok?: boolean;
          request?: {
            requestId: string;
            site: string;
            status: string;
            error?: string;
            session?: unknown;
          };
        };

        const req = pollData.request;
        if (!req) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { ok: false, error: "Lost track of browser login request", requestId },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (req.status !== "pending") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: req.status === "completed",
                    status: req.status,
                    site: req.site,
                    session: req.session,
                    error: req.error,
                  },
                  null,
                  2
                ),
              },
            ],
            details: { ok: req.status === "completed", site: req.site, status: req.status },
          };
        }
      }
    },
  });

  pi.registerTool({
    name: "browser_sessions_list",
    label: "List Saved Browser Cookie Sessions",
    description:
      "List all saved browser cookie sessions in ~/.config/lma/cookies/ along with their captured timestamps, cookie counts, and export file paths.",
    parameters: Type.Object({}),
    async execute() {
      if (!fs.existsSync(COOKIES_DIR)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ count: 0, sessions: [] }, null, 2) }],
        };
      }
      const sessions: unknown[] = [];
      for (const file of fs.readdirSync(COOKIES_DIR)) {
        if (!file.endsWith(".json") || file.endsWith(".state.json")) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(COOKIES_DIR, file), "utf8")) as {
            meta?: unknown;
          };
          if (parsed.meta) sessions.push(parsed.meta);
        } catch {
          // ignore malformed file
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: sessions.length, sessions }, null, 2),
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "browser_cookie_export",
    label: "Get Saved Cookie File Path",
    description:
      "Return the local file path for a saved site's cookies in the requested format ('netscape' for yt-dlp/tiktok-uploader/gallery-dl, 'storageState' for Playwright/XActions/opencli, or 'json' for raw metadata+cookies).",
    parameters: Type.Object({
      site: Type.String({ description: "Platform slug (e.g. 'x', 'tiktok', 'youtube')." }),
      format: Type.Union([
        Type.Literal("netscape"),
        Type.Literal("storageState"),
        Type.Literal("json"),
      ]),
    }),
    async execute(_id, params) {
      const site = sanitizeSite(params.site);
      const ext =
        params.format === "netscape"
          ? ".cookies.txt"
          : params.format === "storageState"
            ? ".state.json"
            : ".json";
      const filePath = path.join(COOKIES_DIR, `${site}${ext}`);
      const exists = fs.existsSync(filePath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: exists, site, format: params.format, path: filePath }, null, 2),
          },
        ],
      };
    },
  });
}
