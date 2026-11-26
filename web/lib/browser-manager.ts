import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface PlatformPreset {
  site: string;
  label: string;
  defaultUrl: string;
  domains: string[];
  expectedCookies: string[];
  loginPathPattern?: RegExp;
}

export const PLATFORM_PRESETS: Record<string, PlatformPreset> = {
  x: {
    site: "x",
    label: "X (Twitter)",
    defaultUrl: "https://x.com/i/flow/login",
    domains: ["x.com", "twitter.com"],
    expectedCookies: ["auth_token", "ct0"],
    loginPathPattern: /\/(login|i\/flow\/login)/i,
  },
  tiktok: {
    site: "tiktok",
    label: "TikTok",
    defaultUrl: "https://www.tiktok.com/login",
    domains: ["tiktok.com"],
    expectedCookies: ["sessionid", "sid_tt"],
    loginPathPattern: /\/login/i,
  },
  youtube: {
    site: "youtube",
    label: "YouTube / Google",
    defaultUrl: "https://studio.youtube.com/",
    domains: ["youtube.com", "google.com"],
    expectedCookies: ["SID", "HSID", "SAPISID"],
    loginPathPattern: /accounts\.google\.com/i,
  },
  instagram: {
    site: "instagram",
    label: "Instagram",
    defaultUrl: "https://www.instagram.com/accounts/login/",
    domains: ["instagram.com"],
    expectedCookies: ["sessionid", "ds_user_id"],
    loginPathPattern: /\/accounts\/login/i,
  },
  reddit: {
    site: "reddit",
    label: "Reddit",
    defaultUrl: "https://www.reddit.com/login/",
    domains: ["reddit.com"],
    expectedCookies: ["token_v2"],
    loginPathPattern: /\/login/i,
  },
  notebooklm: {
    site: "notebooklm",
    label: "Google NotebookLM",
    defaultUrl: "https://notebooklm.google.com/",
    domains: ["google.com", "notebooklm.google.com"],
    expectedCookies: ["SID", "HSID", "SAPISID"],
    loginPathPattern: /accounts\.google\.com/i,
  },
};

export interface SavedSessionMeta {
  site: string;
  label: string;
  url: string;
  capturedAt: string;
  cookieCount: number;
  domains: string[];
  files: {
    json: string;
    netscape: string;
    storageState: string;
  };
}

export interface BrowserLoginRequestState {
  requestId: string;
  site: string;
  label: string;
  url: string;
  reason?: string;
  expectedCookies: string[];
  successUrlRegex?: string;
  status: "pending" | "completed" | "cancelled" | "timeout";
  createdAt: string;
  completedAt?: string;
  error?: string;
  session?: SavedSessionMeta;
}

export interface BrowserStatusSnapshot {
  running: boolean;
  display: string;
  vncPort: number;
  cdpPort: number;
  activeVncClients: number;
  activeLogin: BrowserLoginRequestState | null;
  chromeBinary: string | null;
  currentUrl?: string;
  pageTitle?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loading?: boolean;
  lastError?: string | null;
  sessions: SavedSessionMeta[];
}

export interface BrowserManagerCallbacks {
  onLoginRequired?: (req: BrowserLoginRequestState) => void;
  onLoginDone?: (req: BrowserLoginRequestState) => void;
  onLoginCancelled?: (req: BrowserLoginRequestState) => void;
  onStatusChanged?: (status: BrowserStatusSnapshot) => void;
}

const HOME_DIR = process.env.HOME || "/home/sprite";
const LMA_CONFIG_DIR = path.join(HOME_DIR, ".config", "lma");
export const CHROME_PROFILE_DIR = path.join(LMA_CONFIG_DIR, "chrome-profile");
export const COOKIES_DIR = path.join(LMA_CONFIG_DIR, "cookies");

const DISPLAY_NUM = process.env.LMA_BROWSER_DISPLAY || ":99";
const VNC_PORT = Number(process.env.LMA_BROWSER_VNC_PORT || 5900);
const CDP_PORT = Number(process.env.LMA_BROWSER_CDP_PORT || 9222);
const BROWSER_WIDTH = Number(process.env.LMA_BROWSER_WIDTH || 1280);
const BROWSER_HEIGHT = Number(process.env.LMA_BROWSER_HEIGHT || 720);
const IDLE_SHUTDOWN_MS = Number(process.env.LMA_BROWSER_IDLE_MS || 2 * 60 * 1000);

export function normalizeBrowserUrl(raw?: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (/^about:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (!/\s/.test(trimmed) && trimmed.includes(".")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function sanitizeSiteSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "custom";
}

function findExecutable(candidates: string[]): string | null {
  for (const name of candidates) {
    const found = Bun.which(name);
    if (found) return found;
  }
  return null;
}

function isTcpPortOpen(port: number, host = "127.0.0.1", timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTcpPortOpen(port)) return true;
    await Bun.sleep(200);
  }
  return false;
}

function formatNetscapeCookies(cookies: CdpCookie[]): string {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by Otto (LMA) Embedded Browser Cookie Auth",
    "",
  ];
  for (const c of cookies) {
    const domain = c.domain || "";
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const cookiePath = c.path || "/";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires = Number.isFinite(c.expires) && c.expires > 0 ? Math.floor(c.expires) : 0;
    const prefix = c.httpOnly ? "#HttpOnly_" : "";
    lines.push(`${prefix}${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
  }
  return lines.join("\n") + "\n";
}

function formatPlaywrightStorageState(
  cookies: CdpCookie[],
  origin?: string,
  localStorageEntries?: Array<{ name: string; value: string }>
) {
  return {
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      expires: Number.isFinite(c.expires) ? c.expires : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: c.sameSite || "Lax",
    })),
    origins:
      origin && localStorageEntries && localStorageEntries.length > 0
        ? [{ origin, localStorage: localStorageEntries }]
        : [],
  };
}

export class BrowserManager {
  private xvfbProc: Bun.Subprocess | null = null;
  private wmProc: Bun.Subprocess | null = null;
  private vncProc: Bun.Subprocess | null = null;
  private chromeProc: Bun.Subprocess | null = null;

  private startingPromise: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private watcherTimer: NodeJS.Timeout | null = null;
  private activeVncClients = 0;

  private activeLogin: BrowserLoginRequestState | null = null;
  private lastNavigationError: string | null = null;
  private loginWaiters = new Map<string, Array<() => void>>();
  private loginHistory = new Map<string, BrowserLoginRequestState>();
  private callbacks: BrowserManagerCallbacks;
  constructor(callbacks: BrowserManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getVncPort(): number {
    return VNC_PORT;
  }

  public getCdpPort(): number {
    return CDP_PORT;
  }

  public isRunning(): boolean {
    return Boolean(this.chromeProc && this.vncProc && this.xvfbProc);
  }

  public getStatus(): BrowserStatusSnapshot {
    return {
      running: this.isRunning(),
      display: DISPLAY_NUM,
      vncPort: VNC_PORT,
      cdpPort: CDP_PORT,
      activeVncClients: this.activeVncClients,
      activeLogin: this.activeLogin ? { ...this.activeLogin } : null,
      lastError: this.lastNavigationError,
      chromeBinary: findExecutable([
        "google-chrome-stable",
        "google-chrome",
        "chromium",
        "chromium-browser",
      ]),
      sessions: this.listSavedSessions(),
    };
  }

  public registerVncClient() {
    this.activeVncClients += 1;
    this.clearIdleTimer();
  }

  public unregisterVncClient() {
    this.activeVncClients = Math.max(0, this.activeVncClients - 1);
    this.scheduleIdleShutdownIfEligible();
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleShutdownIfEligible() {
    this.clearIdleTimer();
    if (!this.isRunning()) return;
    if (this.activeVncClients > 0 || this.activeLogin?.status === "pending") return;
    this.idleTimer = setTimeout(() => {
      if (this.activeVncClients === 0 && this.activeLogin?.status !== "pending") {
        void this.stop();
      }
    }, IDLE_SHUTDOWN_MS);
  }

  public async ensureStarted(initialUrl?: string): Promise<void> {
    const normalizedUrl = normalizeBrowserUrl(initialUrl);
    if (this.isRunning()) {
      this.clearIdleTimer();
      if (normalizedUrl) {
        await this.navigateToUrl(normalizedUrl).catch(() => {});
      }
      return;
    }
    if (this.startingPromise) {
      await this.startingPromise;
      if (normalizedUrl) {
        await this.navigateToUrl(normalizedUrl).catch(() => {});
      }
      return;
    }
    // Clean stale Chrome profile singleton locks left by abrupt Sprite stops/restarts
    for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const lockPath = path.join(CHROME_PROFILE_DIR, lockName);
      try {
        if (fs.lstatSync(lockPath)) fs.unlinkSync(lockPath);
      } catch {
        // ignore if absent
      }
    }
    // Clean stale Xvfb lock for our display if no Xvfb is running
    const dispNum = DISPLAY_NUM.replace(/^:/, "");
    try {
      fs.unlinkSync(`/tmp/.X${dispNum}-lock`);
    } catch {
      // ignore
    }

    this.lastNavigationError = null;
    this.startingPromise = this.startInternal(normalizedUrl || undefined);
    try {
      await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  private async startInternal(initialUrl?: string): Promise<void> {
    const xvfbBin = findExecutable(["Xvfb"]);
    const vncBin = findExecutable(["x11vnc"]);
    const chromeBin = findExecutable([
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
    ]);
    const openboxBin = findExecutable(["openbox"]);

    if (!xvfbBin || !vncBin || !chromeBin) {
      const missing = [
        !xvfbBin ? "Xvfb" : null,
        !vncBin ? "x11vnc" : null,
        !chromeBin ? "google-chrome-stable/chromium" : null,
      ].filter(Boolean);
      throw new Error(
        `Embedded browser dependencies missing (${missing.join(", ")}). Run bash ~/lma/setup.sh on the Sprite first.`
      );
    }

    fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true, mode: 0o700 });
    fs.mkdirSync(COOKIES_DIR, { recursive: true, mode: 0o700 });

    const env = { ...process.env, DISPLAY: DISPLAY_NUM };

    // 1. Virtual X11 framebuffer
    this.xvfbProc = Bun.spawn(
      [xvfbBin, DISPLAY_NUM, "-screen", "0", `${BROWSER_WIDTH}x${BROWSER_HEIGHT}x24`, "-nolisten", "tcp", "-ac"],
      { stdout: "ignore", stderr: "ignore", env }
    );
    await Bun.sleep(450);

    // 2. Lightweight window manager so Chrome fills viewport cleanly
    if (openboxBin) {
      this.wmProc = Bun.spawn([openboxBin], {
        stdout: "ignore",
        stderr: "ignore",
        env,
      });
      await Bun.sleep(200);
    }

    // 3. Loopback-only VNC server (-shared allows smooth handoff between tab and modal)
    this.vncProc = Bun.spawn(
      [
        vncBin,
        "-display",
        DISPLAY_NUM,
        "-localhost",
        "-nopw",
        "-forever",
        "-shared",
        "-rfbport",
        String(VNC_PORT),
        "-noxdamage",
      ],
      { stdout: "ignore", stderr: "ignore", env }
    );

    // 4. Real Chrome in kiosk fullscreen without Playwright --enable-automation flags
    //    so Chrome's own chrome/tabs/omnibox/infobars stay hidden behind our browser UI.
    const chromeArgs = [
      chromeBin,
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--noerrdialogs",
      "--disable-infobars",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-features=Translate,TranslateUI",
      "--test-type",
      "--kiosk",
      "--window-position=0,0",
      `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
      initialUrl || "about:blank",
    ];
    this.chromeProc = Bun.spawn(chromeArgs, {
      stdout: "ignore",
      stderr: "ignore",
      env,
    });

    const [vncReady, cdpReady] = await Promise.all([
      waitForPort(VNC_PORT, 15000),
      waitForPort(CDP_PORT, 20000),
    ]);

    if (!vncReady || !cdpReady) {
      await this.stop();
      throw new Error(
        `Embedded browser failed to become ready (vnc=${vncReady}, cdp=${cdpReady}).`
      );
    }

    this.callbacks.onStatusChanged?.(this.getStatus());
  }

  public async stop(): Promise<void> {
    this.clearIdleTimer();
    this.stopWatcher();
    this.lastNavigationError = null;
    const procs = [this.chromeProc, this.vncProc, this.wmProc, this.xvfbProc];
    this.chromeProc = null;
    this.vncProc = null;
    this.wmProc = null;
    this.xvfbProc = null;

    for (const p of procs) {
      if (!p) continue;
      try {
        p.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await Bun.sleep(200);
    for (const p of procs) {
      if (!p) continue;
      try {
        p.kill("SIGKILL");
      } catch {
        // ignore
      }
    }

    this.callbacks.onStatusChanged?.(this.getStatus());
  }

  private async getCdpTargets(): Promise<
    Array<{ id: string; type: string; url: string; title?: string; webSocketDebuggerUrl?: string }>
  > {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data)
      ? (data as Array<{
          id: string;
          type: string;
          url: string;
          title?: string;
          webSocketDebuggerUrl?: string;
        }>)
      : [];
  }
  public async captureActiveTab(siteOverride?: string): Promise<SavedSessionMeta> {
    const { activeUrl } = await this.getAllCdpCookies();
    if (!activeUrl) {
      throw new Error("Chrome has no active page — open the site you want to capture in Embedded Chrome first.");
    }
    const effectiveUrl = activeUrl;
    let inferredSite = siteOverride?.trim() || "";
    if (!inferredSite) {
      for (const [slug, preset] of Object.entries(PLATFORM_PRESETS)) {
        if (preset.domains.some((d) => effectiveUrl.toLowerCase().includes(d))) {
          inferredSite = slug;
          break;
        }
      }
    }
    if (!inferredSite) {
      try {
        inferredSite = new URL(effectiveUrl).hostname.replace(/^www\./, "").split(".")[0] || "custom";
      } catch {
        inferredSite = "custom";
      }
    }
    const meta = await this.captureAndSaveCookies(inferredSite, effectiveUrl);
    this.callbacks.onStatusChanged?.(this.getStatus());
    return meta;
  }

  private sendCdpCommand<T = unknown>(
    wsUrl: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 5000
  ): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          result?: T;
          error?: { message?: string };
        };
        if (msg.id === id) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message || `CDP ${method} failed`));
          else resolve(msg.result as T);
        }
      } catch {
        // ignore parse errors
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket error during ${method}`));
    });
    return promise;
  }

  private async getActivePageTarget() {
    const targets = await this.getCdpTargets();
    return (
      targets.find(
        (t) =>
          t.type === "page" &&
          t.webSocketDebuggerUrl &&
          !t.url.startsWith("devtools://")
      ) || targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    );
  }

  public async getStatusAsync(): Promise<BrowserStatusSnapshot> {
    const base = this.getStatus();
    if (!base.running) return base;
    try {
      const page = await this.getActivePageTarget();
      if (!page?.webSocketDebuggerUrl) return base;
      base.currentUrl = page.url || undefined;
      base.pageTitle = page.title || undefined;
      const [history, docState] = await Promise.all([
        this.sendCdpCommand<{
          currentIndex?: number;
          entries?: Array<{ id: number; url: string; title: string }>;
        }>(page.webSocketDebuggerUrl, "Page.getNavigationHistory", {}, 2000).catch(() => null),
        this.sendCdpCommand<{ result?: { value?: string } }>(
          page.webSocketDebuggerUrl,
          "Runtime.evaluate",
          {
            expression: "JSON.stringify({ href: location.href, readyState: document.readyState })",
            returnByValue: true,
          },
          1500
        ).catch(() => null),
      ]);
      if (history && typeof history.currentIndex === "number" && Array.isArray(history.entries)) {
        base.canGoBack = history.currentIndex > 0;
        base.canGoForward = history.currentIndex < history.entries.length - 1;
        const currentEntry = history.entries[history.currentIndex];
        if (currentEntry?.url) base.currentUrl = currentEntry.url;
        if (currentEntry?.title) base.pageTitle = currentEntry.title;
      }
      if (typeof docState?.result?.value === "string") {
        try {
          const parsed = JSON.parse(docState.result.value) as { href?: string; readyState?: string };
          const targetIsHttp = Boolean(base.currentUrl && /^https?:\/\//i.test(base.currentUrl));
          const stuckOnBlank = targetIsHttp && (!parsed.href || parsed.href === "about:blank");
          base.loading = parsed.readyState !== "complete" || stuckOnBlank;
          if (!base.loading && parsed.href && /^https?:\/\//i.test(parsed.href)) {
            this.lastNavigationError = null;
            base.lastError = null;
          }
        } catch {
          // ignore parse error
        }
      } else {
        base.loading = true;
      }
    } catch {
      // ignore transient CDP errors during startup/shutdown
    }
    return base;
  }

  public async navigateToUrl(targetUrl: string): Promise<void> {
    const normalized = normalizeBrowserUrl(targetUrl);
    if (!normalized) return;
    this.lastNavigationError = null;
    const page = await this.getActivePageTarget();
    if (page?.webSocketDebuggerUrl) {
      const navRes = await this.sendCdpCommand<{ errorText?: string }>(
        page.webSocketDebuggerUrl,
        "Page.navigate",
        { url: normalized },
        12000
      );
      if (navRes?.errorText && navRes.errorText !== "net::ERR_ABORTED") {
        this.lastNavigationError = `Navigation failed (${navRes.errorText})`;
      }
      return;
    }
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(normalized)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
  public async performAction(action: "back" | "forward" | "reload"): Promise<boolean> {
    const page = await this.getActivePageTarget();
    if (!page?.webSocketDebuggerUrl) return false;
    if (action === "reload") {
      await this.sendCdpCommand(page.webSocketDebuggerUrl, "Page.reload");
      return true;
    }
    const history = await this.sendCdpCommand<{
      currentIndex?: number;
      entries?: Array<{ id: number }>;
    }>(page.webSocketDebuggerUrl, "Page.getNavigationHistory");
    const idx = history?.currentIndex;
    const entries = history?.entries;
    if (typeof idx !== "number" || !Array.isArray(entries)) return false;
    const nextIdx = action === "back" ? idx - 1 : idx + 1;
    const target = entries[nextIdx];
    if (!target) return false;
    await this.sendCdpCommand(page.webSocketDebuggerUrl, "Page.navigateToHistoryEntry", {
      entryId: target.id,
    });
    return true;
  }

  public async getAllCdpCookies(): Promise<{ cookies: CdpCookie[]; activeUrl: string }> {
    const page = await this.getActivePageTarget();
    if (!page?.webSocketDebuggerUrl) {
      return { cookies: [], activeUrl: "" };
    }
    const result = await this.sendCdpCommand<{ cookies?: CdpCookie[] }>(
      page.webSocketDebuggerUrl,
      "Network.getAllCookies"
    );
    return {
      cookies: Array.isArray(result?.cookies) ? result.cookies : [],
      activeUrl: page.url || "",
    };
  }
  private async readPageLocalStorage(): Promise<{
    origin: string;
    entries: Array<{ name: string; value: string }>;
  }> {
    try {
      const targets = await this.getCdpTargets();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (!page?.webSocketDebuggerUrl) return { origin: "", entries: [] };
      const res = await this.sendCdpCommand<{ result?: { value?: string } }>(
        page.webSocketDebuggerUrl,
        "Runtime.evaluate",
        {
          expression:
            "JSON.stringify({ origin: location.origin, entries: Object.keys(localStorage).map(k => ({ name: k, value: localStorage.getItem(k) || '' })) })",
          returnByValue: true,
        }
      );
      if (typeof res?.result?.value === "string") {
        const parsed = JSON.parse(res.result.value) as {
          origin?: string;
          entries?: Array<{ name: string; value: string }>;
        };
        return {
          origin: parsed.origin || "",
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
      }
    } catch {
      // ignore cross-origin or empty page errors
    }
    return { origin: "", entries: [] };
  }

  /** Domains a capture may touch: the platform preset's domains plus the requested URL host. */
  private resolveCaptureDomains(site: string, url: string): string[] {
    const domains = new Set<string>();
    for (const d of PLATFORM_PRESETS[site]?.domains || []) {
      const normalized = d.replace(/^\./, "").toLowerCase();
      if (normalized) domains.add(normalized);
    }
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      if (host && host.includes(".")) domains.add(host);
    } catch {
      // Unparseable URL: the preset domains (if any) are all we may use.
    }
    return [...domains];
  }

  private matchesDomains(hostOrUrl: string, domains: string[]): boolean {
    let host = hostOrUrl;
    try {
      host = new URL(hostOrUrl).hostname;
    } catch {
      // Cookie domains arrive as bare hosts such as ".youtube.com"; use them as-is.
    }
    host = host.replace(/^www\./, "").replace(/^\./, "").toLowerCase();
    if (!host) return false;
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  /** Strictly scoped: never falls back to the whole cookie jar. */
  private filterCookiesForSite(cookies: CdpCookie[], domains: string[]): CdpCookie[] {
    if (domains.length === 0) return [];
    return cookies.filter((c) => this.matchesDomains(c.domain || "", domains));
  }

  public async captureAndSaveCookies(siteRaw: string, url: string, label?: string): Promise<SavedSessionMeta> {
    const site = sanitizeSiteSlug(siteRaw);
    const { cookies: allCookies, activeUrl } = await this.getAllCdpCookies();
    const effectiveUrl = activeUrl || url;
    const domains = this.resolveCaptureDomains(site, effectiveUrl);
    if (domains.length === 0) {
      throw new Error(
        `Refusing to capture cookies for "${site}": no domain is known yet. Open the site in Embedded Chrome, finish logging in, then capture again.`
      );
    }
    const siteCookies = this.filterCookiesForSite(allCookies, domains);
    if (siteCookies.length === 0) {
      throw new Error(
        `Refusing to save a session for "${site}": Chrome holds no cookies for ${domains.join(", ")}. Finish logging in on that tab first — cookies from unrelated sites are never exported.`
      );
    }
    // localStorage belongs to whichever tab is active: keep it only when that
    // origin is inside the captured domain set, so one site's storage cannot
    // ride along in another site's session file.
    const pageStorage = await this.readPageLocalStorage();
    const storage =
      pageStorage.origin && this.matchesDomains(pageStorage.origin, domains)
        ? pageStorage
        : { origin: "", entries: [] as Array<{ name: string; value: string }> };

    fs.mkdirSync(COOKIES_DIR, { recursive: true, mode: 0o700 });

    const jsonPath = path.join(COOKIES_DIR, `${site}.json`);
    const netscapePath = path.join(COOKIES_DIR, `${site}.cookies.txt`);
    const statePath = path.join(COOKIES_DIR, `${site}.state.json`);

    const cookieDomains = Array.from(
      new Set(siteCookies.map((c) => (c.domain || "").replace(/^\./, "")).filter(Boolean))
    );
    const meta: SavedSessionMeta = {
      site,
      label: label || PLATFORM_PRESETS[site]?.label || site,
      url: effectiveUrl,
      capturedAt: new Date().toISOString(),
      cookieCount: siteCookies.length,
      domains: cookieDomains,
      files: {
        json: jsonPath,
        netscape: netscapePath,
        storageState: statePath,
      },
    };

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ meta, cookies: siteCookies }, null, 2),
      { mode: 0o600 }
    );
    fs.writeFileSync(netscapePath, formatNetscapeCookies(siteCookies), { mode: 0o600 });
    fs.writeFileSync(
      statePath,
      JSON.stringify(formatPlaywrightStorageState(siteCookies, storage.origin, storage.entries), null, 2),
      { mode: 0o600 }
    );

    return meta;
  }

  public listSavedSessions(): SavedSessionMeta[] {
    if (!fs.existsSync(COOKIES_DIR)) return [];
    const out: SavedSessionMeta[] = [];
    for (const file of fs.readdirSync(COOKIES_DIR)) {
      if (!file.endsWith(".json") || file.endsWith(".state.json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(COOKIES_DIR, file), "utf8")) as {
          meta?: SavedSessionMeta;
        };
        if (raw.meta?.site) out.push(raw.meta);
      } catch {
        // ignore malformed cookie files
      }
    }
    return out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  public deleteSavedSession(siteRaw: string): boolean {
    const site = sanitizeSiteSlug(siteRaw);
    const targets = [
      path.join(COOKIES_DIR, `${site}.json`),
      path.join(COOKIES_DIR, `${site}.cookies.txt`),
      path.join(COOKIES_DIR, `${site}.state.json`),
    ];
    let removed = false;
    for (const file of targets) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed = true;
      }
    }
    if (removed) {
      this.callbacks.onStatusChanged?.(this.getStatus());
    }
    return removed;
  }

  public getLoginRequest(requestId: string): BrowserLoginRequestState | null {
    if (this.activeLogin?.requestId === requestId) return { ...this.activeLogin };
    const prev = this.loginHistory.get(requestId);
    return prev ? { ...prev } : null;
  }

  public async waitForLoginUpdate(requestId: string, waitMs = 20000): Promise<BrowserLoginRequestState | null> {
    const current = this.getLoginRequest(requestId);
    if (!current || current.status !== "pending") return current;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, Math.min(Math.max(waitMs, 1000), 60000));

      const wake = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        const list = this.loginWaiters.get(requestId);
        if (list) {
          const idx = list.indexOf(wake);
          if (idx >= 0) list.splice(idx, 1);
          if (list.length === 0) this.loginWaiters.delete(requestId);
        }
      };

      const list = this.loginWaiters.get(requestId) || [];
      list.push(wake);
      this.loginWaiters.set(requestId, list);
    });

    return this.getLoginRequest(requestId);
  }

  private notifyWaiters(requestId: string) {
    const list = this.loginWaiters.get(requestId);
    if (!list) return;
    this.loginWaiters.delete(requestId);
    for (const wake of list) wake();
  }

  private stopWatcher() {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
  }

  public async startLoginRequest(params: {
    site: string;
    url?: string;
    reason?: string;
    expectedCookies?: string[];
    successUrlRegex?: string;
    timeoutSec?: number;
  }): Promise<BrowserLoginRequestState> {
    const site = sanitizeSiteSlug(params.site);
    const preset = PLATFORM_PRESETS[site];
    const url = params.url?.trim() || preset?.defaultUrl;
    if (!url) {
      throw new Error(
        `browser_login needs an explicit url for custom site "${site}" — no platform preset provides a default login page.`
      );
    }
    const expectedCookies =
      params.expectedCookies && params.expectedCookies.length > 0
        ? params.expectedCookies
        : preset?.expectedCookies || [];

    // Cancel any previous pending login request
    if (this.activeLogin?.status === "pending") {
      this.cancelLoginRequest(this.activeLogin.requestId, "Superseded by a newer login request");
    }

    await this.ensureStarted(url);

    const requestId = `login-${crypto.randomBytes(6).toString("hex")}`;
    const state: BrowserLoginRequestState = {
      requestId,
      site,
      label: preset?.label || params.site,
      url,
      reason: params.reason,
      expectedCookies,
      successUrlRegex: params.successUrlRegex,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.activeLogin = state;
    this.loginHistory.set(requestId, state);
    this.callbacks.onLoginRequired?.({ ...state });
    this.callbacks.onStatusChanged?.(this.getStatus());

    const deadline = Date.now() + Math.min(Math.max(params.timeoutSec || 600, 30), 1200) * 1000;
    this.stopWatcher();
    this.watcherTimer = setInterval(() => {
      void this.pollLoginCompletion(requestId, deadline);
    }, 1200);

    return { ...state };
  }

  private async pollLoginCompletion(requestId: string, deadline: number): Promise<void> {
    const req = this.activeLogin;
    if (!req || req.requestId !== requestId || req.status !== "pending") {
      this.stopWatcher();
      return;
    }

    if (Date.now() > deadline) {
      this.stopWatcher();
      req.status = "timeout";
      req.completedAt = new Date().toISOString();
      req.error = "Login timed out before cookies were detected.";
      this.loginHistory.set(requestId, { ...req });
      this.activeLogin = null;
      this.notifyWaiters(requestId);
      this.callbacks.onLoginCancelled?.({ ...req });
      this.callbacks.onStatusChanged?.(this.getStatus());
      this.scheduleIdleShutdownIfEligible();
      return;
    }

    if (req.expectedCookies.length === 0 && !req.successUrlRegex) {
      return; // Manual "Done (Capture Cookies)" click required for unknown custom sites
    }

    try {
      const { cookies, activeUrl } = await this.getAllCdpCookies();
      const siteCookies = this.filterCookiesForSite(cookies, this.resolveCaptureDomains(req.site, req.url));
      const cookieNames = new Set(siteCookies.filter((c) => Boolean(c.value)).map((c) => c.name));

      const hasAllCookies =
        req.expectedCookies.length === 0 ||
        req.expectedCookies.every((name) => cookieNames.has(name));

      const preset = PLATFORM_PRESETS[req.site];
      const stillOnLoginPage = Boolean(preset?.loginPathPattern && activeUrl && preset.loginPathPattern.test(activeUrl));

      let matchesSuccessUrl = true;
      if (req.successUrlRegex) {
        try {
          matchesSuccessUrl = new RegExp(req.successUrlRegex, "i").test(activeUrl);
        } catch {
          matchesSuccessUrl = true;
        }
      }

      if (hasAllCookies && matchesSuccessUrl && !stillOnLoginPage) {
        await this.completeLoginRequest(requestId);
      }
    } catch {
      // Transient CDP poll error; retry on next tick
    }
  }

  public async completeLoginRequest(requestId?: string): Promise<BrowserLoginRequestState | null> {
    const req = this.activeLogin;
    if (!req || req.status !== "pending") return null;
    if (requestId && req.requestId !== requestId) return null;

    this.stopWatcher();
    const session = await this.captureAndSaveCookies(req.site, req.url, req.label);
    req.status = "completed";
    req.completedAt = new Date().toISOString();
    req.session = session;

    this.loginHistory.set(req.requestId, { ...req });
    this.activeLogin = null;
    this.notifyWaiters(req.requestId);
    this.callbacks.onLoginDone?.({ ...req });
    this.callbacks.onStatusChanged?.(this.getStatus());
    this.scheduleIdleShutdownIfEligible();
    return { ...req };
  }

  public cancelLoginRequest(requestId?: string, reason = "Cancelled by user"): BrowserLoginRequestState | null {
    const req = this.activeLogin;
    if (!req || req.status !== "pending") return null;
    if (requestId && req.requestId !== requestId) return null;

    this.stopWatcher();
    req.status = "cancelled";
    req.completedAt = new Date().toISOString();
    req.error = reason;

    this.loginHistory.set(req.requestId, { ...req });
    this.activeLogin = null;
    this.notifyWaiters(req.requestId);
    this.callbacks.onLoginCancelled?.({ ...req });
    this.callbacks.onStatusChanged?.(this.getStatus());
    this.scheduleIdleShutdownIfEligible();
    return { ...req };
  }
}
