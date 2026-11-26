export type ArtifactKind = "html" | "react" | "svg" | "mermaid" | "markdown";

export function detectArtifactKind(name: string): ArtifactKind | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".jsx" || ext === ".tsx") return "react";
  if (ext === ".svg") return "svg";
  if (ext === ".mmd" || ext === ".mermaid") return "mermaid";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return null;
}

export function isVisualArtifactKind(kind: ArtifactKind | null): boolean {
  return kind === "html" || kind === "react" || kind === "svg" || kind === "mermaid";
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function buildHtmlSrcdoc(content: string, title: string): string {
  const trimmed = content.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1f1f1f;
      background: #ffffff;
      line-height: 1.5;
    }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
}

function buildSvgSrcdoc(content: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #faf9f6;
      background-image:
        linear-gradient(45deg, #efeee9 25%, transparent 25%),
        linear-gradient(-45deg, #efeee9 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #efeee9 75%),
        linear-gradient(-45deg, transparent 75%, #efeee9 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      overflow: auto;
      padding: 16px;
      box-sizing: border-box;
    }
    svg {
      max-width: 100%;
      max-height: 100%;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

function buildMermaidSrcdoc(content: string, title: string): string {
  const codeJson = safeJsonForScript(content);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body {
      margin: 0;
      padding: 24px;
      min-height: 100%;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    #diagram { width: 100%; display: flex; justify-content: center; }
    #diagram svg { max-width: 100%; height: auto; }
    .err {
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 10px;
      padding: 14px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      max-width: 680px;
    }
  </style>
</head>
<body>
  <div id="diagram">Rendering diagram...</div>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    const source = ${codeJson};
    const el = document.getElementById("diagram");
    try {
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      const { svg } = await mermaid.render("otto-mermaid-svg", source);
      el.innerHTML = svg;
    } catch (err) {
      el.innerHTML = "";
      const box = document.createElement("div");
      box.className = "err";
      box.textContent = "Mermaid render error:\\n" + (err?.message || String(err));
      el.appendChild(box);
    }
  </script>
</body>
</html>`;
}

function buildReactSrcdoc(content: string, title: string): string {
  const sourceJson = safeJsonForScript(content);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
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
  <style>
    html, body, #root { margin: 0; min-height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #18181b; }
    .otto-err {
      margin: 20px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid #fecaca;
      background: #fef2f2;
      color: #991b1b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";

    const rootEl = document.getElementById("root");
    function showError(label, err) {
      rootEl.innerHTML = "";
      const div = document.createElement("div");
      div.className = "otto-err";
      div.textContent = label + "\\n" + (err?.stack || err?.message || String(err));
      rootEl.appendChild(div);
    }

    window.addEventListener("error", (ev) => showError("Runtime error:", ev.error || ev.message));
    window.addEventListener("unhandledrejection", (ev) => showError("Unhandled promise rejection:", ev.reason));

    try {
      let rawSource = ${sourceJson};
      // Ensure React is imported if JSX is used without explicit React import
      if (!/import\\s+React\\b/.test(rawSource)) {
        rawSource = 'import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";\\n' + rawSource;
      }
      const transformed = window.Babel.transform(rawSource, {
        filename: "artifact.tsx",
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
          showError("Artifact error:", "No default React component exported. Add 'export default function App() { ... }'.");
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

export function buildArtifactSrcdoc(kind: ArtifactKind, content: string, title = "Artifact"): string {
  if (kind === "react") return buildReactSrcdoc(content, title);
  if (kind === "svg") return buildSvgSrcdoc(content, title);
  if (kind === "mermaid") return buildMermaidSrcdoc(content, title);
  return buildHtmlSrcdoc(content, title);
}
