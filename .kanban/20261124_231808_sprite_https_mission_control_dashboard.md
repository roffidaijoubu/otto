---
title: "Sprite HTTPS Mission Control Dashboard"
status: idea
priority: medium
created_at: 2026-11-24T23:18:08+07:00
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
- [ ] **Add read-only JSON APIs to `web/server.ts`:** `GET /api/dossier` (`MEMORY.md`), `GET /api/connectors` (`/v1/gateway/list`), and `GET /api/clips` + static file streaming for `/home/sprite/clips/`.
- [ ] **Build Mission Control drawer/tabs in the Web UI:** Clean side panel or top tabs beside the Web Chat UI without cluttering the primary chat view.
- [ ] **Verify live updates:** Confirm edits made by Professor L to `MEMORY.md` or newly cut clips appear immediately in the dashboard.
