import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const HOME_DIR = process.env.HOME || "/home/sprite";
const COOKIES_DIR = path.join(HOME_DIR, ".config", "lma", "cookies");

const execFileAsync = promisify(execFile);

function resolveOpenCliBin(): string {
  const localBin = path.join(HOME_DIR, ".local", "bin", "opencli");
  if (fs.existsSync(localBin)) return localBin;
  return "opencli";
}

async function ensureBrowserCdp(initialUrl?: string): Promise<string> {
  const secret = process.env.LMA_INTERNAL_SECRET;
  if (!secret) {
    return "http://127.0.0.1:9222";
  }
  const res = await fetch(`${getInternalBaseUrl()}/api/internal/browser/ensure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ url: initialUrl }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    cdpEndpoint?: string;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Failed to start embedded Chrome CDP (HTTP ${res.status})`);
  }
  return data.cdpEndpoint || "http://127.0.0.1:9222";
}

async function runOpenCliExec(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
  signal?: AbortSignal
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(resolveOpenCliBin(), args, {
      env: { ...process.env, ...extraEnv },
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
      signal,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : e.message || "opencli execution failed",
    };
  }
}

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

  pi.registerTool({
    name: "opencli_list",
    label: "List OpenCLI Site Commands",
    description:
      "Discover available OpenCLI commands across 100+ websites (tiktok, twitter, youtube, instagram, reddit, notebooklm, linkedin, etc.) or inspect a specific site/command.",
    parameters: Type.Object({
      site: Type.Optional(Type.String({ description: "Optional site filter, e.g. 'tiktok', 'twitter', 'youtube'." })),
      query: Type.Optional(Type.String({ description: "Optional keyword search filter." })),
      limit: Type.Optional(Type.Number({ description: "Max commands to return (default 50)." })),
    }),
    async execute(_id, params, signal) {
      const cliArgs = ["list"];
      if (params.query) cliArgs.push(params.query);
      if (params.site) cliArgs.push("--site", params.site);
      cliArgs.push("--limit", String(params.limit || 50));
      const res = await runOpenCliExec(cliArgs, {}, signal);
      return {
        content: [{ type: "text", text: res.stdout || res.stderr }],
      };
    },
  });

  pi.registerTool({
    name: "opencli_run",
    label: "Run OpenCLI Site Adapter",
    description:
      "Run an OpenCLI site command (e.g. site='tiktok', command='creator-videos', or site='tiktok', command='search', args=['vtuber']) against the Sprite's logged-in Chrome via CDP. Automatically wakes Chrome CDP if stopped. If exitCode is 77 (AUTH_REQUIRED), call browser_login for that site.",
    parameters: Type.Object({
      site: Type.String({ description: "Site name, e.g. 'tiktok', 'twitter', 'youtube', 'reddit', 'notebooklm'." }),
      command: Type.String({ description: "Subcommand name, e.g. 'creator-videos', 'search', 'explore', 'timeline'." }),
      args: Type.Optional(
        Type.Array(Type.String(), {
          description: "Positional/flag arguments passed after `<site> <command>`, e.g. ['vtuber', '--limit', '5'].",
        })
      ),
      targetDomain: Type.Optional(
        Type.String({
          description:
            "Optional CDP target URL substring filter (OPENCLI_CDP_TARGET), e.g. 'tiktok.com' or 'x.com'. Defaults to `<site>.com` when helpful.",
        })
      ),
    }),
    async execute(_id, params, signal) {
      const site = params.site.trim().toLowerCase();
      const command = params.command.trim();
      const targetDomain =
        params.targetDomain?.trim() ||
        (site === "x" || site === "twitter"
          ? "x.com"
          : site === "youtube"
            ? "youtube.com"
            : site === "notebooklm"
              ? "notebooklm.google.com"
              : `${site}.com`);

      const cdpEndpoint = await ensureBrowserCdp();
      const cliArgs = [site, command, ...(params.args || []), "-f", "json"];
      const res = await runOpenCliExec(
        cliArgs,
        {
          OPENCLI_CDP_ENDPOINT: cdpEndpoint,
          OPENCLI_CDP_TARGET: targetDomain,
        },
        signal
      );

      let parsed: unknown = null;
      try {
        parsed = res.stdout ? JSON.parse(res.stdout) : null;
      } catch {
        parsed = null;
      }

      if (res.exitCode === 77) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  authRequired: true,
                  exitCode: 77,
                  site,
                  command,
                  hint: `Session not authenticated for ${site}. Call browser_login({ site: "${site}" }) to prompt the user to log in.`,
                  raw: parsed || res.stdout || res.stderr,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: parsed
              ? JSON.stringify(parsed, null, 2)
              : JSON.stringify(
                  {
                    ok: res.exitCode === 0,
                    exitCode: res.exitCode,
                    stdout: res.stdout,
                    stderr: res.stderr,
                  },
                  null,
                  2
                ),
          },
        ],
      };
    },
  });
}
