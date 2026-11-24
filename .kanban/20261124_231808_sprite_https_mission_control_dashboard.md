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

# Sprite HTTPS Web Chat & Mission Control UI

**Target:** Serve a clean, zero-build Bun web app on the Sprite's built-in authenticated HTTPS URL (`https://<sprite>.sprites.app`, port `8080`) as the **primary end-user interface** for Professor L—so the streamer never needs a terminal or Discord bot, wakes the Sprite natively on HTTP, and keeps all `omp` internals hidden.

## Concept & Architecture
- **Runtime:** Single-file Bun HTTP server (`web/server.ts`) registered as a durable Sprite service via `sprite-env services create` on port `8080` (no React/Next.js build pipeline).
- **Agent Brain Stays 100% `omp`:** No duplicated agent loop; interactive chat invokes `omp -p` directly inside the Sprite.
- **Core Panels:**
  - **Talent Dossier & 3+1 Tracker:** Live read of `~/.omp/agent/MEMORY.md` (3 Concrete Goals, Ideal Schedule, 3 GOATs, Upcoming "Christmas", and 3+1 stream ratio).
  - **Sprites Connectors Status:** Live health badges from `GET https://api.sprites.dev/v1/gateway/list` proving zero local API keys inside the VM.
  - **Raw Clip Hand-off Shelf:** List, preview, and download `.mp4` + `.srt` raw clips prepared for human clippers/editors (reinforcing the strictly-no-AI-video rule).
  - **Quick Ask Professor L:** Browser/mobile chat box to wake the Sprite on demand and talk to Professor L.
- **Decision:** Discord bridge/webhook scrapped for MVP to avoid WebSocket sleep jank; the Sprite HTTPS Web Chat UI is the single clean surface (native wake-on-HTTP + built-in Fly.io `sprite` auth).

## Checklist
- [ ] **Scaffold `web/server.ts`:** Serve static dark-mode HTML/CSS/JS + JSON endpoints for `MEMORY.md`, `/v1/gateway/list`, and raw clips directory.
- [ ] **Wire `omp` chat endpoint:** Add authenticated `POST /api/chat` invoking `omp -p` inside the Sprite.
- [ ] **Register durable Sprite service:** Add optional `sprite-env services create lma-dashboard` step in `setup.sh` on port `8080`.
- [ ] **Verify wake-on-HTTP:** Open `https://<sprite>.sprites.app` from a browser and confirm all panels render live data.
