---
title: "Post-Hackathon Self-Hosted VPS (Persistent Chromium noVNC + Codex OAuth)"
status: idea
priority: low
created_at: 2026-11-25T10:09:21+07:00
tags:
  - infra
  - vps
  - browser-session
  - oauth
---

# Post-Hackathon Self-Hosted VPS (Persistent Chromium noVNC + Codex OAuth)

**Target:** Run `lma` long-term outside the hackathon on a dedicated Ubuntu/Debian VPS (recommended **8 vCPU / 8 GB RAM / 60 GB NVMe**, avoiding Wayland/Hyprland/Omarchy headless GPU issues) with a persistent GUI Chromium session for cookie-authenticated platforms (`x.com`, YouTube Studio, TikTok Studio) and OpenAI Codex OAuth support in `omp`.

## Architecture Notes
- **VPS Sizing:**
  - `lma` alone (`bun web/server.ts` + `omp` RPC + `ffmpeg` 1080p `-14 LUFS`): 4 vCPU / 4 GB RAM minimum.
  - `lma` + persistent GUI Chromium (noVNC + CDP): **8 vCPU / 8 GB RAM** recommended to avoid OOM when Chromium + `ffmpeg` run concurrently.
- **Persistent Authenticated Browser (`linuxserver/chromium` or `Xvfb + openbox + noVNC`):**
  - Mount persistent `--user-data-dir` volume so manual human logins (2FA/captcha on `x.com`, YouTube Studio, TikTok Studio) persist across restarts.
  - Bind `--remote-debugging-port=9222` to `127.0.0.1` only; expose noVNC **strictly over Tailscale** (never public internet).
- **LLM Provider Flexibility (`omp` OAuth):**
  - Since `lma` speaks `omp --mode rpc --no-ui`, switching from Gemini Sprites Connector to OpenAI Codex OAuth requires zero changes to `web/server.ts`, Vue 3 UI, or skills (only adapt `media-reviewer.ts` if running outside Fly.io Sprites).

## Checklist
- [ ] **Provision Ubuntu/Debian VPS (8 vCPU / 8 GB RAM)** and install Tailscale + Docker + Bun + `omp` + `ffmpeg` + `yt-dlp`.
- [ ] **Deploy persistent Chromium + noVNC container** behind Tailscale with `127.0.0.1:9222` CDP enabled for `omp` browser/Playwright tools.
- [ ] **Configure `omp` Codex OAuth login** and adapt `media-reviewer.ts` fallback for non-Sprite environments.
