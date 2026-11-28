export type CustomStudioAppKind = "react" | "html" | "svg";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const OTTO_DESIGN_STYLES = `
  :root {
    --fg: #171717;
    --fg-strong: #000000;
    --fg-muted: #737373;
    --fg-subtle: #A3A3A3;
    --surface: #FFFFFF;
    --surface-bar: #FAF9F6;
    --surface-alt: #F2F2F2;
    --surface-inset: #EDEDED;
    --border: rgba(0, 0, 0, 0.08);
    --border-strong: rgba(0, 0, 0, 0.12);
    --highlight-yellow: #F9F5A2;
    --highlight-cyan: #C7F6FF;
    --error: #991B1B;
    --error-bg: #FDE8E8;
    --success: #166534;
    --success-bg: #E6F7EE;
    --radius-card: 12px;
    --radius-input: 8px;
    --radius-pill: 8px;
    --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; min-height: 100%; background: #FFFFFF; color: var(--fg); }
  body {
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .font-mono, code, kbd, pre { font-family: var(--font-mono); font-feature-settings: "liga" 0, "calt" 0; }
  .tabular-nums { font-variant-numeric: tabular-nums; }
  .otto-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  }
  .otto-card-header {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
    text-align: center;
    padding: 7px 14px;
    border-bottom: 1px solid var(--border);
  }
  .otto-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--fg);
    background: var(--fg);
    color: #FFFFFF;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .otto-btn:hover { opacity: 0.9; }
  .otto-btn:active { transform: scale(0.98); }
  .otto-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .otto-btn-secondary {
    border: 1px solid var(--border-strong);
    background: var(--surface-alt);
    color: var(--fg);
  }
  .otto-btn-secondary:hover { background: var(--surface-inset); opacity: 1; }
  .otto-input {
    width: 100%;
    padding: 8px 14px;
    border-radius: 12px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 13px;
    outline: none;
  }
  .otto-input:focus { border-color: var(--fg); box-shadow: 0 0 0 2px rgba(48, 48, 48, 0.14); }
  .otto-mark-y { background: var(--highlight-yellow); padding: 0 3px; }
  .otto-mark-c { background: var(--highlight-cyan); padding: 0 3px; }
  .otto-err {
    margin: 16px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid #fecaca;
    background: var(--error-bg);
    color: var(--error);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
  }
`;

function buildBridgeScript(slug: string, bridgeToken: string, initialState: Record<string, unknown>): string {
  return `
  <script>
    (function () {
      const TOKEN = ${safeJson(bridgeToken)};
      const SLUG = ${safeJson(slug)};
      let cachedState = ${safeJson(initialState)};
      const pending = new Map();
      let seq = 1;

      window.addEventListener("message", function (ev) {
        const msg = ev.data;
        if (!msg || msg.__ottoAppBridgeReply !== true || msg.token !== TOKEN) return;
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.ok) {
          if (msg.state && typeof msg.state === "object") cachedState = msg.state;
          entry.resolve(msg.state ?? true);
        } else {
          entry.reject(new Error(msg.error || "Bridge request failed"));
        }
      });

      function callHost(type, payload) {
        return new Promise(function (resolve, reject) {
          const id = seq++;
          pending.set(id, { resolve, reject });
          window.parent.postMessage(
            Object.assign({ __ottoAppBridge: true, token: TOKEN, id: id, type: type }, payload || {}),
            "*"
          );
          setTimeout(function () {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error("Studio app state bridge timeout"));
            }
          }, 8000);
        });
      }

      window.ottoApp = {
        slug: SLUG,
        get initialState() {
          return cachedState;
        },
        loadState: function () {
          return callHost("loadState");
        },
        saveState: function (nextState) {
          if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
            return Promise.reject(new Error("State must be a plain object"));
          }
          cachedState = nextState;
          return callHost("saveState", { state: nextState });
        },
      };
    })();
  </script>`;
}

const OTTO_FONTS_AND_TAILWIND = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
            mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
          },
          colors: {
            ink: '#303030',
            muted: '#808080',
            mist: '#F2F2F2',
            hairline: '#EDEDED',
            butter: '#F9F5A2',
            aqua: '#C7F6FF',
          },
        },
      },
    };
  </script>
`;

export function buildStudioAppSrcdoc(opts: {
  slug: string;
  title: string;
  kind: CustomStudioAppKind;
  code: string;
  initialState: Record<string, unknown>;
  bridgeToken: string;
}): string {
  const { slug, title, kind, code, initialState, bridgeToken } = opts;
  const bridgeScript = buildBridgeScript(slug, bridgeToken, initialState);

  if (kind === "svg") {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${OTTO_DESIGN_STYLES}
    body { display: flex; align-items: center; justify-content: center; padding: 20px; background: #FFFFFF; }
    svg { max-width: 100%; max-height: 100%; height: auto; display: block; }
  </style>
</head>
<body>${code}</body>
</html>`;
  }

  if (kind === "html") {
    const trimmed = code.trim();
    const headInject = `${OTTO_FONTS_AND_TAILWIND}<style>${OTTO_DESIGN_STYLES}</style>${bridgeScript}`;
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${headInject}`);
    }
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${headInject}</head>`);
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${headInject}
</head>
<body>${trimmed}</body>
</html>`;
  }

  // React / JSX runtime with Otto DESIGN.md tokens + window.ottoApp state bridge
  const sourceJson = safeJson(code);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${OTTO_FONTS_AND_TAILWIND}
  <style>${OTTO_DESIGN_STYLES}</style>
  ${bridgeScript}
  <script src="https://unpkg.com/@babel/standalone@7.26.9/babel.min.js"></script>
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19.0.0",
        "react-dom": "https://esm.sh/react-dom@19.0.0",
        "react-dom/client": "https://esm.sh/react-dom@19.0.0/client",
        "lucide-react": "https://esm.sh/lucide-react@0.475.0?deps=react@19.0.0",
        "recharts": "https://esm.sh/recharts@2.15.1?deps=react@19.0.0,react-dom@19.0.0"
      }
    }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React, { useState, useEffect, useRef } from "react";
    import { createRoot } from "react-dom/client";

    const rootEl = document.getElementById("root");
    function showError(label, err) {
      rootEl.innerHTML = "";
      const div = document.createElement("div");
      div.className = "otto-err";
      div.textContent = label + "\\n" + (err?.stack || err?.message || String(err));
      rootEl.appendChild(div);
    }

    // Convenience persistent React hook backed by window.ottoApp.saveState
    window.useOttoState = function useOttoState(defaultState) {
      const [state, setState] = useState(() => {
        const init = window.ottoApp?.initialState;
        if (init && typeof init === "object" && Object.keys(init).length > 0) {
          return Object.assign({}, defaultState, init);
        }
        return defaultState;
      });
      const timerRef = useRef(null);
      const setPersisted = (updater) => {
        setState((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            window.ottoApp?.saveState(next).catch(() => {});
          }, 250);
          return next;
        });
      };
      useEffect(() => () => clearTimeout(timerRef.current), []);
      return [state, setPersisted];
    };

    window.addEventListener("error", (ev) => showError("Runtime error:", ev.error || ev.message));
    window.addEventListener("unhandledrejection", (ev) => showError("Unhandled rejection:", ev.reason));

    try {
      let rawSource = ${sourceJson};
      if (!/import\\s+React\\b/.test(rawSource)) {
        rawSource = 'import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";\\n' + rawSource;
      }
      const transformed = window.Babel.transform(rawSource, {
        filename: "studio-app.tsx",
        presets: [
          ["typescript", { isTSX: true, allExtensions: true }],
          ["react", { runtime: "classic" }],
        ],
      }).code;

      const blob = new Blob([transformed], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        const mod = await import(url);
        const Component = mod.default || mod.App || Object.values(mod).find((v) => typeof v === "function");
        if (!Component) {
          showError("App error:", "No default React component exported.");
        } else {
          createRoot(rootEl).render(React.createElement(Component));
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      showError("Compile/Render error:", err);
    }
  </script>
</body>
</html>`;
}
