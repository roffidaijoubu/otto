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
const IDLE_SHUTDOWN_MS = Number(process.env.LMA_BROWSER_IDLE_MS || 2 * 60 * 1000);

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
    if (this.isRunning()) {
      this.clearIdleTimer();
      if (initialUrl) {
        await this.navigateToUrl(initialUrl).catch(() => {});
      }
      return;
    }
    if (this.startingPromise) {
      await this.startingPromise;
      if (initialUrl) {
        await this.navigateToUrl(initialUrl).catch(() => {});
      }
      return;
    }

    this.startingPromise = this.startInternal(initialUrl);
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
      [xvfbBin, DISPLAY_NUM, "-screen", "0", "1280x720x24", "-nolisten", "tcp", "-ac"],
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

    // 4. Real Chrome without Playwright --enable-automation flags
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
      "--window-position=0,0",
      "--window-size=1280,720",
      "--start-maximized",
      initialUrl || "about:blank",
    ];
    this.chromeProc = Bun.spawn(chromeArgs, {
      stdout: "ignore",
      stderr: "ignore",
      env,
    });

    const [vncReady, cdpReady] = await Promise.all([
      waitForPort(VNC_PORT, 10000),
      waitForPort(CDP_PORT, 12000),
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

  private async sendCdpCommand<T = unknown>(
    wsUrl: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const id = 1;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error(`CDP ${method} timed out`));
      }, 5000);

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
    });
  }

  public async navigateToUrl(targetUrl: string): Promise<void> {
    const targets = await this.getCdpTargets();
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl) {
      await this.sendCdpCommand(page.webSocketDebuggerUrl, "Page.navigate", { url: targetUrl });
      return;
    }
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(targetUrl)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }

  public async getAllCdpCookies(): Promise<{ cookies: CdpCookie[]; activeUrl: string }> {
    const targets = await this.getCdpTargets();
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
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

  private filterCookiesForSite(cookies: CdpCookie[], site: string, url: string): CdpCookie[] {
    const preset = PLATFORM_PRESETS[site];
    const domains = new Set<string>(preset?.domains || []);
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host) domains.add(host);
    } catch {
      // ignore invalid URL
    }
    if (domains.size === 0) return cookies;
    const filtered = cookies.filter((c) => {
      const cd = (c.domain || "").replace(/^\./, "").toLowerCase();
      for (const d of domains) {
        if (cd === d || cd.endsWith(`.${d}`)) return true;
      }
      return false;
    });
    return filtered.length > 0 ? filtered : cookies;
  }

  public async captureAndSaveCookies(siteRaw: string, url: string, label?: string): Promise<SavedSessionMeta> {
    const site = sanitizeSiteSlug(siteRaw);
    const { cookies: allCookies, activeUrl } = await this.getAllCdpCookies();
    const effectiveUrl = activeUrl || url;
    const siteCookies = this.filterCookiesForSite(allCookies, site, effectiveUrl);
    const storage = await this.readPageLocalStorage();

    fs.mkdirSync(COOKIES_DIR, { recursive: true, mode: 0o700 });

    const jsonPath = path.join(COOKIES_DIR, `${site}.json`);
    const netscapePath = path.join(COOKIES_DIR, `${site}.cookies.txt`);
    const statePath = path.join(COOKIES_DIR, `${site}.state.json`);

    const domains = Array.from(
      new Set(siteCookies.map((c) => (c.domain || "").replace(/^\./, "")).filter(Boolean))
    );
    const meta: SavedSessionMeta = {
      site,
      label: label || PLATFORM_PRESETS[site]?.label || site,
      url: effectiveUrl,
      capturedAt: new Date().toISOString(),
      cookieCount: siteCookies.length,
      domains,
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
    const url = params.url?.trim() || preset?.defaultUrl || "https://google.com";
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
      const siteCookies = this.filterCookiesForSite(cookies, req.site, req.url);
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
