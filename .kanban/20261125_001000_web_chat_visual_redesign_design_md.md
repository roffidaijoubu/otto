---
title: "Web Chat UI Visual Redesign (Apply DESIGN.md)"
status: todo
priority: medium
created_at: 2026-11-25T00:10:00+07:00
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
- [ ] **Request `DESIGN.md` from the user:** Confirm palette, typography, dark/light mode, and brand accents.
- [ ] **Update `web/tokens.css`:** Map all `DESIGN.md` design tokens cleanly into CSS custom properties.
- [ ] **Polish `web/index.html` layout & micro-states:** Refine typography hierarchy, spacing, message cards, streaming indicator, and mobile ergonomics.
- [ ] **Visual verification in browser:** Capture and verify desktop + mobile views against `DESIGN.md`.
