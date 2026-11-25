---
title: "Sprite HTTPS Mission Control Dashboard"
status: done
priority: medium
created_at: 2026-11-24T23:18:08+07:00
completed_at: 2026-11-25T02:25:00+07:00
tags:
  - web-ui
  - sprites-service
  - hacksgiving
---

# Sprite HTTPS Mission Control Dashboard Panels

**Target:** Layer read-only Mission Control panels onto `web/server.ts` (`https://<sprite>.sprites.app`) alongside the Web Chat UI so the streamer and Hacksgiving judges can visually inspect Professor L's persistent memory, live zero-key connector health, and downloadable raw clips in one place.

## Concept & Panels
- **Talent Dossier & 3+1 Tracker:** Live rendered view of `~/.omp/agent/MEMORY.md` (3 Concrete Goals, Ideal Schedule, 3 GOATs, Upcoming "Christmas", and 3+1 stream ratio).
- **Sprites Connectors Status:** Live health badges from `GET https://api.sprites.dev/v1/gateway/list` proving zero local API keys inside the VM (Gemini, Exa, Firecrawl, Composio YouTube, Buffer).
- **Raw Clip Hand-off Shelf:** List, preview, and download `.mp4` + `.srt` raw clips prepared by `raw-clip-finder` for human clippers and editors (visually reinforcing the strictly-no-AI-video rule).

## Checklist
- [x] **Add read-only JSON APIs to `web/server.ts`:** Implemented authenticated `GET /api/dossier`, `GET /api/connectors`, `GET /api/clips`, and path-traversal-safe `GET /api/clips/file/:videoId/:filename`.
- [x] **Build Mission Control drawer/tabs in the Web UI:** Built `web/src/components/MissionControlDrawer.vue` using **Tailwind CSS v4 + DaisyUI v5** (`lma-wire` swappable monochrome theme) with Dossier, Zero-Key Connectors, and Raw Clips Shelf tabs (inline `<video>` preview + `.mp4`/`.srt` downloads).
- [x] **Verify live updates:** Verified `tsc --noEmit`, Bun/Vite production build (`1.73s` on Sprite), and live authenticated JSON responses on Sprite `lma` (`/api/dossier`, `/api/connectors`, `/api/clips`).
