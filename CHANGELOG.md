# Changelog — Otto OS (Fly.io Hacksgiving 2026)

A chronological build log of **Otto OS** (`lma` — Livestreamer Manager Agent) across **138 commits** (Nov 24–28, 2026), showing how a single `$0`-idle Fly.io Sprite evolved from an initial `omp` scaffold into a 10-app Cloud Studio OS with a second auto-stop Fly Machine, Neon + Pinecone persistence, live-nudgeable RPC workers, and zero vendor API keys on disk.

---

## 2026-11-28 — Offline Test Suite, CI, Cloud Brain, Unified RPC Jobs & Audit Hardening

- **Zero-Dependency Offline Test Suite, GitHub Actions CI & Security Hardening** (`48d020b`, `a5b11b9`, `3b3b06f`, `873027c`, `fcbe6c8`, v6 state-machine polish):
  - Added an offline Node `>=22.18` + Python `unittest` regression suite (`tests/`) — directly importing and schema-validating **all 22 `agent/extensions/*.ts` modules (all 85 registered tools)** via `node:module` `registerHooks` and behaviorally exercising core extension handlers, live child-process JSONL RPC worker nudging & cancellation (`web/lib/rpc-worker.ts`), clip-job reconciliation (`web/lib/clip-worker.ts`), pull-only boot Box sync (`agent/lib/box-sync.ts`), concurrent checkpoint wake-up deduplication, turn-generation watchdog abort isolation, and DNS-pinned Pixabay/SSRF downloads — plus SHA-pinned, read-only (`permissions: contents: read`) GitHub Actions CI (`.github/workflows/ci.yml`) running tests, Python compile checks, strict TypeScript typechecking (frontend + server + tests + extensions), and Vite production build on every push.
  - Hardened `/api/wakeup` TOCTOU busy-flag locking and atomic in-flight claims for deterministic `checkpoint` / `metrics_sync` wake-ups (preventing concurrent double execution and partial-failure retry loss), long-turn `prompt()` RPC acknowledgement + turn-generation-guarded aborting watchdog (awaiting `abort` ack before releasing the mutex and absorbing stale `agent_end` events from aborted turns), QStash HS256 JWT `alg` + fail-closed `sub` + retry-safe `jti` replay deduplication (committed only on accepted/terminal delivery so `503 Retry-After` retries succeed cleanly), socket-IP-first (proxy-aware `fly-client-ip`) failed-login & burst throttling, true LRU session retention, atomic `updatePrivateWebPassword()` testing with POSIX `0600` file-mode assertion, minimal unauthenticated `/api/health`, zero-filesystem-tool tag-escaped prompt-injection isolation across both `/api/contacts/draft-outreach` and `/api/analytics/insights`, DNS-pinned connect-time HTTPS SSRF fetch (`fetchSafePublicHttpsBuffer`) eliminating DNS-rebinding TOCTOU on `media-reviewer` and Pixabay downloads, structured `/api/connectors` gateway diagnostics, fail-closed checkpoint ID parsing, honest `zeroOutboundApiKeys` / `inboundKeysIsolatedFromAgent` guardrail telemetry, Fly Machine #2 provisioning tests, Thumbnail Studio & Custom Apps tests, and `web/server.ts` auth-gate ordering tests; published live Sprite URL (`https://lma-bicns.sprites.app`) in `README.md`.
- **Demo Walkthrough & Visual Showcase** (`21f695e`, `96c53dc`, `ac075f4`): Published the 3-minute YouTube walkthrough with English captions, clickable hero play thumbnail, live Otto Studio OS screenshots, and showcase GIFs in `README.md`.
- **Security Audit Hardening & Reproducibility** (`54ecf82`): Resolved all P1 findings from pre-submission adversarial review, reconciled documentation metrics across `README.md`, `docs/architecture.md`, `AGENTS.md`, and `DESIGN.md`, and hardened reproducibility.
- **Full UI ↔ Otto Parity & Managed Live RPC Workers** (`6131753`, `e85446e`, `fcac039`, `fabfb9a`, `7eb5145`):
  - Unified background execution for Clips, Thumbnails, OBS Overlays, and Archive Sync into a resumable **Neon `studio_jobs`** queue with a TopMenuBar Jobs popover.
  - Added open JSONL RPC pipes so Otto can inspect live worker telemetry, **steer/nudge a running worker mid-flight** without killing it, or resume failed runs from saved checkpoints.
  - Added native Google Calendar reminders via Composio proxy (`34bd2bc`) and consolidated extensions with full UI ↔ Otto parity.
- **Zero-AI Thumbnail Studio + Headless Self-Inspection** (`1d064fb`, `94aca5d`, `c204384`, `42352f4`):
  - Built the dedicated **Thumbnail Studio** app composing `1280×720` HTML/CSS from Box human-drawn cutouts and non-AI Pixabay photography.
  - Added autonomous headless Chrome rendering (`thumbnail_render`) with multimodal visual self-inspection against the mobile squint test and YouTube's duration safe zone, plus `youtube_schedule_live_broadcast`.
- **Clips 3-Page Hierarchy, Live SRT & Pinecone Archive Grid** (`11b7a14`, `dd5b572`, `898d948`, `65c6179`):
  - Added ElevenLabs Scribe v3 transcription with live SRT overlay, full-arc 45–210s clipping at `-14 LUFS`, 3-page `VOD → Clips → Clip Viewer` navigation, and an indexed 80-stream video grid in the Archive tab before search.
- **Neon Postgres, Pinecone Memory, Hybrid Router & Time-Travel Snapshots** (`778f94f`, `fc4703c`, `d6efcc1`, `dea3309`, `4320592`, `5ae4d69`):
  - Migrated all 10 studio tables to zero-key **Neon Serverless Postgres** (with automatic SQLite fallback), added persistent `MEMORY.md` + Pinecone `otto-memory` sync, Ollama-first hybrid model routing, incremental Box `Otto Assets` sync, and a **Time-Travel Checkpoints** UI with daily QStash auto-snapshots.
- **6-Digit PIN Auth & Desktop UX Polish** (`fa4faeb`, `dbffe0c`, `2a4155a`, `56d757c`, `22bc111`, `cab8314`, `83e7f5a`, `ed24a87`, `eaca7af`):
  - Switched studio login to a 6-digit numeric PIN with a 6-box PIN pad, anchored Otto Chat bottom-right beside the mascot, added side-by-side OBS Canvas + Live Controller dock (`window.OBS_CONTROL` SDK), redesigned Analytics/Ideas/System Settings as 2-pane native apps, modularized `web/server.ts`, and defaulted UI sound effects to off.

---

## 2026-11-27 — Multi-Platform Ops, Box Handoff, Dedicated Clips & Architectural Pruning

- **Multi-Platform Analytics & Per-Channel Socials** (`6580afb`, `6f9b20b`, `b367b5f`, `692aa21`, `2f51ecd`):
  - Added programmatic YouTube, TikTok, Instagram, and X metrics widgets with zero-LLM daily QStash snapshots, plus per-channel `tiktok_post`, `instagram_post`, and `x_post` draft-first tools backed by Apify and Buffer connectors.
- **Dedicated Clips App & Box Human-Editor Handoff** (`526aff8`, `7c8ff20`, `c20de77`):
  - Built the standalone **Clips** desktop app with isolated background VOD clipping and fast `yt-dlp` preflight validation.
  - Added the zero-key **Box Sprites Connector** for 1-click file/folder handoff of raw `.mp4` + `.srt` packages to human editors.
- **Deliberate Architectural Pruning** (`9ce9c1a`, `c209a33`, `08c444e`):
  - Pruned embedded Chrome (`noVNC`), browser-cookie scraping (`OpenCLI`), and unused Mission Control drawers in favor of clean desktop widgets, floating Otto mascot, and pure zero-key Sprites Connectors.

---

## 2026-11-26 — Otto Studio OS Shell, Fly Machine #2 OBS Overlays & Sandboxed Custom Apps

- **Two Machines, One Studio — Fly Machine OBS Overlays** (`ecacb14`, `95e7c98`):
  - Split interactive outputs into **Custom Studio Apps** (sandboxed `srcdoc` iframe with `event.source` bridge) and **OBS Overlays** hosted on a second auto-stop 256 MB Fly Machine + 1 GB Volume provisioned directly via the Fly Machines API (`config.files`, zero Dockerfile or image build).
- **Otto Studio OS Multi-Window Desktop** (`acd8f72`, `1e3f474`, `aff0a80`, `ecdc6e3`, `42a6a72`, `fb7de79`):
  - Migrated UI from DaisyUI to `shadcn-vue` + Reka UI + Tailwind CSS v4.
  - Launched the multi-window desktop shell with draggable/resizable windows, floating dock, `Cmd+K` Spotlight, standalone Studio Files, Calendar, and Contacts apps, plus `unslop-ui` visual cleanup (`8fd140a`, `51b0bf8`).
- **Debloat & Brand Identity** (`f953053`, `729b726`, `a589b01`, `04218fa`):
  - Added the OTTO OS wordmark and SVG favicon, offloaded optional coaching into an opt-in skill, and streamlined the core agent prompt.

---

## 2026-11-25 — Otto Bento Design System, Proactive QStash Wake-Ups, VOD Clipper & Hardening

- **Rebrand to Otto Studio Bento OS** (`d5d8c70`, `b0e3f88`, `c8e9660`, `8166f59`, `b9628be`):
  - Rebranded persona to **Otto** with the warm studio backdrop, `IBM Plex Mono` + `Inter` typography, pure inline SVG cursor-tracking mascot, 3-step first-run Setup Wizard (413 IANA timezones), and unified Studio DB + 2-way Google Calendar sync (`7356129`, `ad8f4e7`).
- **Proactive `$0`-Idle Wake-Ups & Tasks API Keep-Alive** (`4a21455`, `6bf07bd`, `8c393ab`):
  - Implemented signed Upstash QStash `/api/wakeup` webhooks and `/.sprite/api.sock` Tasks API keep-alive holds (5-minute heartbeat, hard 30-minute billing ceiling) so the Sprite sleeps to `$0` when idle yet wakes on schedule.
- **Deterministic VOD Hype Clipper & Multimodal Reviewer** (`8d534ad`, `5d58527`, `b46cf69`):
  - Built the 12-thread InnerTube chat-hype detector (4-signal rolling Z-scores), `-14 LUFS` FFmpeg clip prep, zero-key Gemini `media-reviewer` (`watch_clip`, `critique_thumbnail`), and core streamer skills.
- **Verification Harness & Security Hardening** (`90da03d`, `49b8553`, `af2ca9c`, `b30830b`, `3fef185`, `c9a9088`, `c0b089a`):
  - Added `scripts/verify-all.sh` deterministic security/runtime suite, Sprite Checkpoint Time-Travel E2E playbooks, fail-closed auth, QStash JWT + SHA-256 body verification, and workspace path-traversal confinement.
  - Migrated Web UI to Vue 3 + Vite (`fa57cd4`, `173da52`, `25715ba`).

---

## 2026-11-24 — Foundation & Zero-Key Connectors

- **Initial Sprite Agent Scaffold** (`81755b0`, `13eb645`, `f976f99`, `d675c67`):
  - Bootstrapped the `lma` Sprite repository with `omp`, `ffmpeg`, `yt-dlp`, Composio v3 YouTube and Buffer zero-key Sprites Connectors, 2-phase onboarding skill, and agent-first setup guides.
