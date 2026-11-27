import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";

export type BuiltinAppId =
  | "otto-chat"
  | "mission-control"
  | "files"
  | "obs-overlays"
  | "studio-db"
  | "playbooks"
  | "calendar"
  | "contacts"
  | "settings";

export type CustomAppId = `custom:${string}`;
export type StudioAppId = BuiltinAppId | CustomAppId;

export type StudioAppIconName =
  | "message"
  | "layout"
  | "folder"
  | "layers"
  | "tv"
  | "app"
  | "globe"
  | "database"
  | "sparkles"
  | "calendar"
  | "contacts"
  | "settings";

export type SnapZone = "left" | "right" | "maximize";

export type LayoutPreset =
  | "tile-2up"
  | "focus-chat"
  | "cascade"
  | "show-desktop"
  | "reset";

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioAppDefinition {
  id: StudioAppId;
  title: string;
  shortLabel: string;
  icon: StudioAppIconName;
  minWidth: number;
  minHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  dockSection: "primary" | "utility" | "custom";
  shortcutDigit?: string;
}

export interface StudioWindowState extends WindowRect {
  id: StudioAppId;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  snapZone: SnapZone | null;
  restoreRect: WindowRect | null;
  zIndex: number;
  attention: boolean;
  badgeText: string;
  subtitle: string;
}

export interface OpenWindowOptions {
  focus?: boolean;
  subtitle?: string;
  attention?: boolean;
  badgeText?: string;
  snapZone?: SnapZone | null;
}

export interface WindowManagerOptions {
  storageKey?: string;
  persist?: boolean;
}

export interface DesktopShortcut {
  id: string;
  label: string;
  sublabel?: string;
  icon: StudioAppIconName;
  appId: StudioAppId;
  filesPath?: string;
}

export interface DesktopShellExposed {
  wm: WindowManagerInstance;
  openSpotlight: () => void;
}

export type WindowControlsMode = "auto" | "mac" | "windows";
export type ResolvedPlatform = "mac" | "windows";

export interface ShortcutLabels {
  spotlight: string;
  altPrefix: string;
  tile: string;
  desktop: string;
}

interface NavigatorWithUAData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

export function detectHostPlatform(): ResolvedPlatform {
  if (typeof navigator === "undefined") return "mac";
  const nav = navigator as NavigatorWithUAData;
  const uaPlatform = nav.userAgentData?.platform || "";
  const fallbackPlatform = navigator.platform || navigator.userAgent || "";
  const combined = `${uaPlatform} ${fallbackPlatform}`;
  return /mac|iphone|ipad|ipod/i.test(combined) ? "mac" : "windows";
}

export interface WindowManagerInstance {
  apps: StudioAppDefinition[];
  appMap: Record<string, StudioAppDefinition>;
  viewport: { width: number; height: number };
  windows: Record<string, StudioWindowState>;
  isMobile: ComputedRef<boolean>;
  isInteracting: ComputedRef<boolean>;
  interactingWindowId: Ref<StudioAppId | null>;
  activeSnapPreview: Ref<SnapZone | null>;
  visibleWindows: ComputedRef<StudioWindowState[]>;
  openWindows: ComputedRef<StudioWindowState[]>;
  focusedWindowId: ComputedRef<StudioAppId | null>;
  focusedApp: ComputedRef<StudioAppDefinition | null>;
  detectedPlatform: ResolvedPlatform;
  controlsMode: Ref<WindowControlsMode>;
  effectivePlatform: ComputedRef<ResolvedPlatform>;
  shortcutLabels: ComputedRef<ShortcutLabels>;
  setControlsMode: (mode: WindowControlsMode) => void;
  registerCustomApp: (def: StudioAppDefinition) => void;
  unregisterCustomApp: (id: CustomAppId) => void;
  openWindow: (id: StudioAppId, opts?: OpenWindowOptions) => void;
  closeWindow: (id: StudioAppId) => void;
  minimizeWindow: (id: StudioAppId) => void;
  restoreWindow: (id: StudioAppId) => void;
  toggleMaximize: (id: StudioAppId) => void;
  focusWindow: (id: StudioAppId) => void;
  toggleFromDock: (id: StudioAppId) => void;
  moveWindow: (id: StudioAppId, x: number, y: number) => void;
  detachFromSnapForDrag: (id: StudioAppId, pointerX: number, pointerY: number) => WindowRect;
  resizeWindow: (id: StudioAppId, rect: WindowRect) => void;
  snapWindow: (id: StudioAppId, zone: SnapZone) => void;
  getSnapRect: (zone: SnapZone) => WindowRect;
  detectSnapZone: (clientX: number, clientY: number) => SnapZone | null;
  applyPreset: (preset: LayoutPreset) => void;
  setWindowMeta: (
    id: StudioAppId,
    patch: { subtitle?: string; attention?: boolean; badgeText?: string }
  ) => void;
  clearAttention: (id: StudioAppId) => void;
  mountListeners: () => void;
  unmountListeners: () => void;
}

export const TOP_BAR_HEIGHT = 36;
export const DOCK_SAFE_BOTTOM = 78;
export const WINDOW_GAP = 12;
export const MOBILE_BREAKPOINT = 1024;
export const Z_INDEX_MIN = 10;
export const Z_INDEX_MAX = 40;
export const STORAGE_KEY = "otto-studio-os-layout-v1";
export const CONTROLS_MODE_STORAGE_KEY = "otto-studio-os-controls-mode";

export const STUDIO_APPS: readonly StudioAppDefinition[] = [
  {
    id: "otto-chat",
    title: "Otto Chat",
    shortLabel: "Otto",
    icon: "message",
    minWidth: 360,
    minHeight: 360,
    defaultWidth: 520,
    defaultHeight: 680,
    dockSection: "primary",
    shortcutDigit: "1",
  },
  {
    id: "files",
    title: "Studio Files",
    shortLabel: "Files",
    icon: "folder",
    minWidth: 480,
    minHeight: 360,
    defaultWidth: 780,
    defaultHeight: 600,
    dockSection: "primary",
    shortcutDigit: "2",
  },
  {
    id: "obs-overlays",
    title: "OBS Overlays",
    shortLabel: "OBS",
    icon: "tv",
    minWidth: 520,
    minHeight: 420,
    defaultWidth: 900,
    defaultHeight: 660,
    dockSection: "primary",
    shortcutDigit: "3",
  },
  {
    id: "mission-control",
    title: "Mission Control",
    shortLabel: "Mission",
    icon: "layout",
    minWidth: 440,
    minHeight: 360,
    defaultWidth: 720,
    defaultHeight: 680,
    dockSection: "primary",
    shortcutDigit: "4",
  },
  {
    id: "studio-db",
    title: "Studio DB",
    shortLabel: "Studio DB",
    icon: "database",
    minWidth: 460,
    minHeight: 360,
    defaultWidth: 760,
    defaultHeight: 580,
    dockSection: "primary",
    shortcutDigit: "5",
  },
  {
    id: "playbooks",
    title: "Playbooks",
    shortLabel: "Playbooks",
    icon: "sparkles",
    minWidth: 420,
    minHeight: 340,
    defaultWidth: 640,
    defaultHeight: 540,
    dockSection: "primary",
    shortcutDigit: "6",
  },
  {
    id: "calendar",
    title: "Calendar",
    shortLabel: "Calendar",
    icon: "calendar",
    minWidth: 540,
    minHeight: 420,
    defaultWidth: 960,
    defaultHeight: 640,
    dockSection: "primary",
    shortcutDigit: "7",
  },
  {
    id: "contacts",
    title: "Contacts",
    shortLabel: "Contacts",
    icon: "contacts",
    minWidth: 520,
    minHeight: 400,
    defaultWidth: 880,
    defaultHeight: 580,
    dockSection: "primary",
    shortcutDigit: "8",
  },
  {
    id: "settings",
    title: "System Settings",
    shortLabel: "Settings",
    icon: "settings",
    minWidth: 420,
    minHeight: 380,
    defaultWidth: 620,
    defaultHeight: 560,
    dockSection: "utility",
    shortcutDigit: "9",
  },
] as const;

export const STUDIO_APP_MAP: Record<string, StudioAppDefinition> = STUDIO_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app;
    return acc;
  },
  {} as Record<string, StudioAppDefinition>
);

interface PersistedWindowSnapshot {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  snapZone: SnapZone | null;
  x: number;
  y: number;
  width: number;
  height: number;
  restoreRect: WindowRect | null;
  zIndex: number;
}

interface PersistedLayoutPayload {
  version: 1;
  windows: Partial<Record<StudioAppId, PersistedWindowSnapshot>>;
}

function getWorkArea(vw: number, vh: number) {
  const safeW = Math.max(320, vw);
  const safeH = Math.max(320, vh);
  const left = WINDOW_GAP;
  const top = TOP_BAR_HEIGHT + WINDOW_GAP;
  const width = Math.max(300, safeW - WINDOW_GAP * 2);
  const height = Math.max(240, safeH - TOP_BAR_HEIGHT - DOCK_SAFE_BOTTOM - WINDOW_GAP);
  return { left, top, width, height, viewportWidth: safeW, viewportHeight: safeH };
}

function clampRectToViewport(
  id: StudioAppId,
  rect: WindowRect,
  vw: number,
  vh: number,
  appLookup: Record<string, StudioAppDefinition> = STUDIO_APP_MAP
): WindowRect {
  const def = appLookup[id] ?? { minWidth: 380, minHeight: 340, defaultWidth: 680, defaultHeight: 580 };
  const area = getWorkArea(vw, vh);

  const maxW = Math.max(280, area.viewportWidth - WINDOW_GAP * 2);
  const maxH = Math.max(220, area.viewportHeight - TOP_BAR_HEIGHT - DOCK_SAFE_BOTTOM);
  const minW = Math.min(def.minWidth, maxW);
  const minH = Math.min(def.minHeight, maxH);

  const width = Math.min(maxW, Math.max(minW, Math.round(rect.width)));
  const height = Math.min(maxH, Math.max(minH, Math.round(rect.height)));

  // Keep at least 120px of titlebar horizontally grabbable and never above top bar
  const minVisibleX = 120;
  const minX = -width + minVisibleX;
  const maxX = area.viewportWidth - minVisibleX;
  const minY = TOP_BAR_HEIGHT + 4;
  const maxY = Math.max(minY, area.viewportHeight - DOCK_SAFE_BOTTOM - 44);

  const x = Math.min(maxX, Math.max(minX, Math.round(rect.x)));
  const y = Math.min(maxY, Math.max(minY, Math.round(rect.y)));

  return { x, y, width, height };
}

function buildDefaultCenteredRect(
  id: StudioAppId,
  vw: number,
  vh: number,
  indexOffset = 0,
  appLookup: Record<string, StudioAppDefinition> = STUDIO_APP_MAP
): WindowRect {
  const def = appLookup[id] ?? { minWidth: 380, minHeight: 340, defaultWidth: 680, defaultHeight: 580 };
  const area = getWorkArea(vw, vh);
  const width = Math.min(def.defaultWidth, area.width);
  const height = Math.min(def.defaultHeight, area.height);
  const x = area.left + Math.round((area.width - width) / 2) + indexOffset * 26;
  const y = area.top + Math.round((area.height - height) / 2) + indexOffset * 22;
  return clampRectToViewport(id, { x, y, width, height }, vw, vh, appLookup);
}

function createInitialWindows(vw: number, vh: number): Record<StudioAppId, StudioWindowState> {
  const area = getWorkArea(vw, vh);
  const leftWidth = Math.max(
    STUDIO_APP_MAP["otto-chat"].minWidth,
    Math.round((area.width - WINDOW_GAP) * 0.42)
  );
  const rightWidth = Math.max(
    STUDIO_APP_MAP["mission-control"].minWidth,
    area.width - WINDOW_GAP - leftWidth
  );

  const result = {} as Record<StudioAppId, StudioWindowState>;

  STUDIO_APPS.forEach((app, idx) => {
    const centered = buildDefaultCenteredRect(app.id, vw, vh, idx % 4);
    result[app.id] = {
      id: app.id,
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      snapZone: null,
      restoreRect: null,
      x: centered.x,
      y: centered.y,
      width: centered.width,
      height: centered.height,
      zIndex: Z_INDEX_MIN + idx,
      attention: false,
      badgeText: "",
      subtitle: "",
    };
  });

  // Clean default Studio OS layout: Otto Chat (left) + Mission Control (right)
  result["otto-chat"].isOpen = true;
  result["otto-chat"].x = area.left;
  result["otto-chat"].y = area.top;
  result["otto-chat"].width = Math.min(leftWidth, area.width);
  result["otto-chat"].height = area.height;
  result["otto-chat"].zIndex = Z_INDEX_MIN + 2;

  result["mission-control"].isOpen = true;
  result["mission-control"].x = area.left + Math.min(leftWidth, area.width) + WINDOW_GAP;
  result["mission-control"].y = area.top;
  result["mission-control"].width = Math.max(320, rightWidth);
  result["mission-control"].height = area.height;
  result["mission-control"].zIndex = Z_INDEX_MIN + 1;

  return result;
}

export function createWindowManager(options: WindowManagerOptions = {}): WindowManagerInstance {
  const storageKey = options.storageKey ?? STORAGE_KEY;
  const shouldPersist = options.persist ?? true;

  const viewport = reactive({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  });

  const apps = reactive<StudioAppDefinition[]>([...STUDIO_APPS]);
  const appMap = reactive<Record<string, StudioAppDefinition>>({ ...STUDIO_APP_MAP });

  const windows = reactive<Record<string, StudioWindowState>>(
    createInitialWindows(viewport.width, viewport.height)
  );

  const activeSnapPreview = ref<SnapZone | null>(null);
  const interactingWindowId = ref<StudioAppId | null>(null);
  const isInteracting = computed(() => interactingWindowId.value !== null);
  const isMobile = computed(() => viewport.width < MOBILE_BREAKPOINT);
  const detectedPlatform: ResolvedPlatform = detectHostPlatform();
  const initialControlsMode = (() => {
    if (!shouldPersist || typeof window === "undefined") return "auto" as WindowControlsMode;
    try {
      const saved = window.localStorage.getItem(CONTROLS_MODE_STORAGE_KEY);
      if (saved === "auto" || saved === "mac" || saved === "windows") return saved;
    } catch {
      // ignore storage errors
    }
    return "auto" as WindowControlsMode;
  })();
  const controlsMode = ref<WindowControlsMode>(initialControlsMode);
  const effectivePlatform = computed<ResolvedPlatform>(() =>
    controlsMode.value === "auto" ? detectedPlatform : controlsMode.value
  );
  const shortcutLabels = computed<ShortcutLabels>(() =>
    effectivePlatform.value === "mac"
      ? { spotlight: "⌘K", altPrefix: "⌥", tile: "⌥⇧T", desktop: "⌥⇧D" }
      : { spotlight: "Ctrl+K", altPrefix: "Alt+", tile: "Alt+Shift+T", desktop: "Alt+Shift+D" }
  );

  function setControlsMode(mode: WindowControlsMode) {
    controlsMode.value = mode;
    if (!shouldPersist || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CONTROLS_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }

  function registerCustomApp(def: StudioAppDefinition) {
    const normalized: StudioAppDefinition = {
      ...def,
      dockSection: "custom",
    };
    appMap[normalized.id] = normalized;
    const idx = apps.findIndex((a) => a.id === normalized.id);
    if (idx >= 0) {
      apps[idx] = normalized;
    } else {
      apps.push(normalized);
    }
    if (!windows[normalized.id]) {
      const centered = buildDefaultCenteredRect(
        normalized.id,
        viewport.width,
        viewport.height,
        apps.length % 4,
        appMap
      );
      windows[normalized.id] = {
        id: normalized.id,
        isOpen: false,
        isMinimized: false,
        isMaximized: false,
        snapZone: null,
        restoreRect: null,
        x: centered.x,
        y: centered.y,
        width: centered.width,
        height: centered.height,
        zIndex: Z_INDEX_MIN,
        attention: false,
        badgeText: "",
        subtitle: "",
      };
    }
  }

  function unregisterCustomApp(id: CustomAppId) {
    const idx = apps.findIndex((a) => a.id === id);
    if (idx >= 0) apps.splice(idx, 1);
    delete appMap[id];
    delete windows[id];
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function normalizeZOrder() {
    const ordered = apps
      .map((a) => windows[a.id])
      .filter((w): w is StudioWindowState => Boolean(w))
      .sort((a, b) => a.zIndex - b.zIndex);
    const span = Math.max(1, Z_INDEX_MAX - Z_INDEX_MIN);
    ordered.forEach((win, i) => {
      // Strictly keep every managed window inside [Z_INDEX_MIN..Z_INDEX_MAX] (< 50)
      win.zIndex = Z_INDEX_MIN + Math.min(span, i);
    });
  }

  function schedulePersist() {
    if (!shouldPersist || typeof window === "undefined") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      try {
        const snapshot: PersistedLayoutPayload = { version: 1, windows: {} };
        for (const app of STUDIO_APPS) {
          const w = windows[app.id];
          snapshot.windows[app.id] = {
            isOpen: w.isOpen,
            isMinimized: w.isMinimized,
            isMaximized: w.isMaximized,
            snapZone: w.snapZone,
            x: w.x,
            y: w.y,
            width: w.width,
            height: w.height,
            restoreRect: w.restoreRect ? { ...w.restoreRect } : null,
            zIndex: w.zIndex,
          };
        }
        window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch {
        // Ignore quota / privacy mode storage errors
      }
    }, 180);
  }

  function hydrateFromStorage() {
    if (!shouldPersist || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedLayoutPayload;
      if (!parsed || parsed.version !== 1 || !parsed.windows) return;

      let restoredAnyOpen = false;
      for (const app of STUDIO_APPS) {
        const saved = parsed.windows[app.id];
        if (!saved || typeof saved.x !== "number" || typeof saved.width !== "number") continue;
        const win = windows[app.id];
        const clamped = clampRectToViewport(
          app.id,
          { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
          viewport.width,
          viewport.height
        );
        win.isOpen = Boolean(saved.isOpen);
        win.isMinimized = Boolean(saved.isMinimized);
        win.isMaximized = Boolean(saved.isMaximized);
        win.snapZone =
          saved.snapZone === "left" || saved.snapZone === "right" || saved.snapZone === "maximize"
            ? saved.snapZone
            : null;
        win.x = clamped.x;
        win.y = clamped.y;
        win.width = clamped.width;
        win.height = clamped.height;
        win.restoreRect = saved.restoreRect
          ? clampRectToViewport(app.id, saved.restoreRect, viewport.width, viewport.height)
          : null;
        if (typeof saved.zIndex === "number" && Number.isFinite(saved.zIndex)) {
          win.zIndex = saved.zIndex;
        }
        if (win.isOpen) restoredAnyOpen = true;
      }
      normalizeZOrder();
      if (!restoredAnyOpen) {
        applyPreset("reset");
      }
    } catch {
      // Malformed saved layout; keep clean default
    }
  }

  const visibleWindows = computed(() =>
    apps
      .map((a) => windows[a.id])
      .filter((w): w is StudioWindowState => Boolean(w && w.isOpen && !w.isMinimized))
      .sort((a, b) => a.zIndex - b.zIndex)
  );

  const openWindows = computed(() =>
    apps
      .map((a) => windows[a.id])
      .filter((w): w is StudioWindowState => Boolean(w && w.isOpen))
  );

  const focusedWindowId = computed<StudioAppId | null>(() => {
    const visible = visibleWindows.value;
    if (visible.length === 0) return null;
    return visible[visible.length - 1].id;
  });

  const focusedApp = computed<StudioAppDefinition | null>(() => {
    const id = focusedWindowId.value;
    return id ? (appMap[id] ?? null) : null;
  });

  function getSnapRect(zone: SnapZone): WindowRect {
    const area = getWorkArea(viewport.width, viewport.height);
    if (zone === "maximize") {
      return {
        x: area.left,
        y: area.top,
        width: area.width,
        height: area.height,
      };
    }
    const halfWidth = Math.max(300, Math.floor((area.width - WINDOW_GAP) / 2));
    if (zone === "left") {
      return {
        x: area.left,
        y: area.top,
        width: halfWidth,
        height: area.height,
      };
    }
    return {
      x: area.left + halfWidth + WINDOW_GAP,
      y: area.top,
      width: Math.max(300, area.width - halfWidth - WINDOW_GAP),
      height: area.height,
    };
  }

  function detectSnapZone(clientX: number, clientY: number): SnapZone | null {
    if (isMobile.value) return null;
    if (clientY <= TOP_BAR_HEIGHT + 10) return "maximize";
    if (clientX <= 18) return "left";
    if (clientX >= viewport.width - 18) return "right";
    return null;
  }

  function focusWindow(id: StudioAppId) {
    const win = windows[id];
    if (!win) return;
    if (!win.isOpen) win.isOpen = true;
    if (win.isMinimized) win.isMinimized = false;
    win.attention = false;

    const maxZ = Math.max(
      Z_INDEX_MIN,
      ...apps.map((a) => windows[a.id]?.zIndex ?? Z_INDEX_MIN)
    );
    win.zIndex = maxZ + 1;
    normalizeZOrder();
    schedulePersist();
  }

  function openWindow(id: StudioAppId, opts: OpenWindowOptions = {}) {
    const win = windows[id];
    if (!win) return;

    const wasClosed = !win.isOpen;
    win.isOpen = true;
    win.isMinimized = false;

    if (opts.subtitle !== undefined) win.subtitle = opts.subtitle;
    if (opts.badgeText !== undefined) win.badgeText = opts.badgeText;

    if (wasClosed && !win.isMaximized && !win.snapZone) {
      const openCount = openWindows.value.length;
      const fresh = buildDefaultCenteredRect(
        id,
        viewport.width,
        viewport.height,
        (openCount - 1) % 4,
        appMap
      );
      win.x = fresh.x;
      win.y = fresh.y;
      win.width = fresh.width;
      win.height = fresh.height;
    } else {
      const clamped = clampRectToViewport(id, win, viewport.width, viewport.height, appMap);
      win.x = clamped.x;
      win.y = clamped.y;
      win.width = clamped.width;
      win.height = clamped.height;
    }

    if (opts.snapZone) {
      snapWindow(id, opts.snapZone);
    }

    if (opts.focus !== false) {
      focusWindow(id);
    }

    if (opts.attention !== undefined) {
      win.attention = opts.attention;
    }

    schedulePersist();
  }

  function closeWindow(id: StudioAppId) {
    const win = windows[id];
    if (!win) return;
    win.isOpen = false;
    win.isMinimized = false;
    win.isMaximized = false;
    win.snapZone = null;
    win.attention = false;
    schedulePersist();
  }

  function minimizeWindow(id: StudioAppId) {
    const win = windows[id];
    if (!win || !win.isOpen) return;
    win.isMinimized = true;
    schedulePersist();
  }

  function snapWindow(id: StudioAppId, zone: SnapZone) {
    const win = windows[id];
    if (!win) return;
    if (!win.isOpen) win.isOpen = true;
    win.isMinimized = false;

    if (!win.isMaximized && !win.snapZone) {
      win.restoreRect = { x: win.x, y: win.y, width: win.width, height: win.height };
    }

    const target = getSnapRect(zone);
    win.x = target.x;
    win.y = target.y;
    win.width = target.width;
    win.height = target.height;
    win.snapZone = zone;
    win.isMaximized = zone === "maximize";
    focusWindow(id);
  }

  function restoreWindow(id: StudioAppId) {
    const win = windows[id];
    if (!win) return;
    const base =
      win.restoreRect ?? buildDefaultCenteredRect(id, viewport.width, viewport.height, 0, appMap);
    const clamped = clampRectToViewport(id, base, viewport.width, viewport.height, appMap);
    win.x = clamped.x;
    win.y = clamped.y;
    win.width = clamped.width;
    win.height = clamped.height;
    win.isMaximized = false;
    win.snapZone = null;
    win.restoreRect = null;
    schedulePersist();
  }

  function toggleMaximize(id: StudioAppId) {
    const win = windows[id];
    if (!win) return;
    if (win.isMaximized) {
      restoreWindow(id);
      focusWindow(id);
    } else {
      snapWindow(id, "maximize");
    }
  }

  function toggleFromDock(id: StudioAppId) {
    const win = windows[id];
    if (!win) return;

    if (isMobile.value) {
      openWindow(id, { focus: true });
      return;
    }

    if (!win.isOpen) {
      openWindow(id, { focus: true });
      return;
    }
    if (win.isMinimized) {
      win.isMinimized = false;
      focusWindow(id);
      return;
    }
    if (focusedWindowId.value === id) {
      minimizeWindow(id);
    } else {
      focusWindow(id);
    }
  }

  function moveWindow(id: StudioAppId, x: number, y: number) {
    const win = windows[id];
    if (!win) return;
    const clamped = clampRectToViewport(
      id,
      { x, y, width: win.width, height: win.height },
      viewport.width,
      viewport.height,
      appMap
    );
    win.x = clamped.x;
    win.y = clamped.y;
    schedulePersist();
  }

  function detachFromSnapForDrag(id: StudioAppId, pointerX: number, pointerY: number): WindowRect {
    const win = windows[id];
    const fallback = buildDefaultCenteredRect(id, viewport.width, viewport.height, 0, appMap);
    const def = appMap[id] ?? { defaultWidth: 680, defaultHeight: 580 };
    const targetW =
      win.restoreRect?.width ?? Math.min(def.defaultWidth, fallback.width);
    const targetH =
      win.restoreRect?.height ?? Math.min(def.defaultHeight, fallback.height);

    const clamped = clampRectToViewport(
      id,
      {
        x: Math.round(pointerX - targetW / 2),
        y: Math.max(TOP_BAR_HEIGHT + 4, Math.round(pointerY - 18)),
        width: targetW,
        height: targetH,
      },
      viewport.width,
      viewport.height,
      appMap
    );

    win.x = clamped.x;
    win.y = clamped.y;
    win.width = clamped.width;
    win.height = clamped.height;
    win.isMaximized = false;
    win.snapZone = null;
    win.restoreRect = null;
    return clamped;
  }

  function resizeWindow(id: StudioAppId, rect: WindowRect) {
    const win = windows[id];
    if (!win) return;
    const clamped = clampRectToViewport(id, rect, viewport.width, viewport.height, appMap);
    win.x = clamped.x;
    win.y = clamped.y;
    win.width = clamped.width;
    win.height = clamped.height;
    win.isMaximized = false;
    win.snapZone = null;
    schedulePersist();
  }

  function setWindowMeta(
    id: StudioAppId,
    patch: { subtitle?: string; attention?: boolean; badgeText?: string }
  ) {
    const win = windows[id];
    if (!win) return;
    if (patch.subtitle !== undefined) win.subtitle = patch.subtitle;
    if (patch.attention !== undefined) win.attention = patch.attention;
    if (patch.badgeText !== undefined) win.badgeText = patch.badgeText;
  }

  function clearAttention(id: StudioAppId) {
    const win = windows[id];
    if (win) win.attention = false;
  }

  function applyPreset(preset: LayoutPreset) {
    const area = getWorkArea(viewport.width, viewport.height);

    if (preset === "show-desktop") {
      const anyVisible = visibleWindows.value.length > 0;
      if (anyVisible) {
        for (const app of apps) {
          if (windows[app.id]?.isOpen) windows[app.id].isMinimized = true;
        }
      } else {
        let restored = false;
        for (const app of apps) {
          if (windows[app.id]?.isOpen) {
            windows[app.id].isMinimized = false;
            restored = true;
          }
        }
        if (!restored) applyPreset("tile-2up");
      }
      schedulePersist();
      return;
    }

    if (preset === "focus-chat") {
      for (const app of apps) {
        if (app.id !== "otto-chat" && windows[app.id]?.isOpen) {
          windows[app.id].isMinimized = true;
        }
      }
      const w = Math.min(820, Math.round(area.width * 0.68));
      const h = Math.min(area.height, Math.round(area.height * 0.92));
      const chat = windows["otto-chat"];
      chat.isOpen = true;
      chat.isMinimized = false;
      chat.isMaximized = false;
      chat.snapZone = null;
      chat.restoreRect = null;
      chat.x = area.left + Math.round((area.width - w) / 2);
      chat.y = area.top + Math.round((area.height - h) / 2);
      chat.width = w;
      chat.height = h;
      focusWindow("otto-chat");
      return;
    }

    if (preset === "cascade") {
      const targets =
        openWindows.value.length > 0
          ? openWindows.value
          : [windows["otto-chat"], windows["mission-control"], windows["files"]];
      targets.forEach((win, i) => {
        const def = appMap[win.id] ?? { defaultWidth: 680, defaultHeight: 580 };
        const step = i * 34;
        const clamped = clampRectToViewport(
          win.id,
          {
            x: area.left + 20 + step,
            y: area.top + 12 + step,
            width: Math.min(def.defaultWidth, area.width - 60),
            height: Math.min(def.defaultHeight, area.height - 40),
          },
          viewport.width,
          viewport.height,
          appMap
        );
        win.isOpen = true;
        win.isMinimized = false;
        win.isMaximized = false;
        win.snapZone = null;
        win.restoreRect = null;
        win.x = clamped.x;
        win.y = clamped.y;
        win.width = clamped.width;
        win.height = clamped.height;
        win.zIndex = Z_INDEX_MIN + i + 1;
      });
      normalizeZOrder();
      schedulePersist();
      return;
    }

    if (preset === "reset") {
      if (shouldPersist && typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
      }
      const fresh = createInitialWindows(viewport.width, viewport.height);
      for (const app of STUDIO_APPS) {
        const prevSub = windows[app.id].subtitle;
        const prevAtt = windows[app.id].attention;
        const prevBadge = windows[app.id].badgeText;
        Object.assign(windows[app.id], fresh[app.id], {
          subtitle: prevSub,
          attention: prevAtt,
          badgeText: prevBadge,
        });
      }
      normalizeZOrder();
      schedulePersist();
      return;
    }

    // Default: tile-2up (Otto Chat left 42%, most-recent secondary or Mission Control right 58%)
    const secondaryCandidates = visibleWindows.value
      .filter((w) => w.id !== "otto-chat")
      .sort((a, b) => b.zIndex - a.zIndex);
    const secondaryId: StudioAppId = secondaryCandidates[0]?.id ?? "mission-control";

    for (const app of apps) {
      if (app.id !== "otto-chat" && app.id !== secondaryId && windows[app.id]?.isOpen) {
        windows[app.id].isMinimized = true;
      }
    }

    const leftWidth = Math.max(
      STUDIO_APP_MAP["otto-chat"].minWidth,
      Math.round((area.width - WINDOW_GAP) * 0.42)
    );
    const rightWidth = Math.max(
      (appMap[secondaryId]?.minWidth ?? 380),
      area.width - WINDOW_GAP - leftWidth
    );

    const chat = windows["otto-chat"];
    chat.isOpen = true;
    chat.isMinimized = false;
    chat.isMaximized = false;
    chat.snapZone = "left";
    chat.restoreRect = null;
    chat.x = area.left;
    chat.y = area.top;
    chat.width = Math.min(leftWidth, area.width);
    chat.height = area.height;

    const right = windows[secondaryId];
    right.isOpen = true;
    right.isMinimized = false;
    right.isMaximized = false;
    right.snapZone = "right";
    right.restoreRect = null;
    right.x = area.left + chat.width + WINDOW_GAP;
    right.y = area.top;
    right.width = Math.max(300, rightWidth);
    right.height = area.height;

    focusWindow(secondaryId);
    focusWindow("otto-chat");
  }

  function handleViewportResize() {
    if (typeof window === "undefined") return;
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    for (const app of apps) {
      const win = windows[app.id];
      if (!win) continue;
      if (win.isMaximized) {
        const rect = getSnapRect("maximize");
        win.x = rect.x;
        win.y = rect.y;
        win.width = rect.width;
        win.height = rect.height;
      } else if (win.snapZone) {
        const rect = getSnapRect(win.snapZone);
        win.x = rect.x;
        win.y = rect.y;
        win.width = rect.width;
        win.height = rect.height;
      } else {
        const clamped = clampRectToViewport(app.id, win, viewport.width, viewport.height, appMap);
        win.x = clamped.x;
        win.y = clamped.y;
        win.width = clamped.width;
        win.height = clamped.height;
      }
    }
  }

  function mountListeners() {
    hydrateFromStorage();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleViewportResize, { passive: true });
    }
  }

  function unmountListeners() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleViewportResize);
    }
  }

  watch(
    () => viewport.width,
    () => {
      if (isMobile.value && visibleWindows.value.length === 0) {
        openWindow("otto-chat", { focus: true });
      }
    }
  );

  return {
    apps,
    appMap,
    viewport,
    windows,
    isMobile,
    isInteracting,
    interactingWindowId,
    activeSnapPreview,
    visibleWindows,
    openWindows,
    focusedWindowId,
    focusedApp,
    detectedPlatform,
    controlsMode,
    effectivePlatform,
    shortcutLabels,
    setControlsMode,
    registerCustomApp,
    unregisterCustomApp,
    openWindow,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    toggleMaximize,
    focusWindow,
    toggleFromDock,
    moveWindow,
    detachFromSnapForDrag,
    resizeWindow,
    snapWindow,
    getSnapRect,
    detectSnapZone,
    applyPreset,
    setWindowMeta,
    clearAttention,
    mountListeners,
    unmountListeners,
  };
}

export const WINDOW_MANAGER_KEY: InjectionKey<WindowManagerInstance> = Symbol("otto-window-manager");

export function useWindowManagerLifecycle(options?: WindowManagerOptions): WindowManagerInstance {
  const wm = createWindowManager(options);
  onMounted(() => wm.mountListeners());
  onBeforeUnmount(() => wm.unmountListeners());
  return wm;
}
