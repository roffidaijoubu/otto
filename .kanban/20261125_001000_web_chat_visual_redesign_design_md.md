---
title: "Web Chat UI Visual Redesign (Apply DESIGN.md)"
status: done
priority: medium
created_at: 2026-11-25T00:10:00+07:00
completed_at: 2026-11-25T10:20:00+07:00
tags:
  - web-ui
  - design-system
  - polish
---

# Web Chat UI Visual Redesign (Apply `DESIGN.md`)

**Target:** Replace the monochrome zero-radius wireframe styling of `web/index.html` and `web/tokens.css` with a cohesive visual design system once the user supplies `DESIGN.md`.

## Notes
- The wireframe intentionally isolates all colors, typography, radii, and spacing in `web/tokens.css` so visual theming can be swapped cleanly without touching `web/server.ts` or the SSE/RPC client logic.
- Ask the user for `DESIGN.md` (palette, typography, surface elevation, radius rules, brand motifs) before starting this pass.

## Checklist
- [x] **Adapt `DESIGN.md`:** Created CafeBlend Studio `DESIGN.md` at repo root (warm cream `#FDF6EC`, espresso `#3E2723`, `#8B5E3C` primary, DM Serif Display + Work Sans + IBM Plex Mono, neumorphic raised/inset shadows).
- [x] **Update DaisyUI v5 theme & tokens:** Replaced wireframe tokens with `lma-cafe` theme in `web/src/styles/daisy.css`, `tokens.css`, `base.css`, and Google Fonts in `web/index.html`.
- [x] **Polish all Vue components & Passcode Gate:** Applied CafeBlend raised cards, inset composer/login inputs, pill status chips, and sidebar selection indicators across `ChatHeader`, `SessionSidebar`, `MessageBubble`, `ThoughtTrace`, `ChatComposer`, `MissionControlDrawer`, `App.vue`, and `web/server.ts`.
- [x] **Build & deploy to Sprite `lma`:** Verified `tsc --noEmit`, Vite build, and live restart on the Sprite HTTPS URL.
