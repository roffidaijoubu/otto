---
title: "Sprite HTTPS Web Chat UI (omp RPC Wrapper)"
status: done
priority: high
created_at: 2026-11-24T23:59:44+07:00
completed_at: 2026-11-25T00:15:00+07:00
tags:
  - web-ui
  - chat
  - omp-rpc
  - sprites-service
---

# Sprite HTTPS Web Chat UI (omp RPC Wrapper)

**Target:** Serve a clean, zero-build Bun Web Chat UI on the Sprite's built-in authenticated HTTPS URL (`https://<sprite>.sprites.app`, port `8080`) wrapping a persistent **`omp --mode rpc --no-ui`** subprocess—giving the streamer a fast, mobile- and desktop-friendly chat interface with Professor L, native wake-on-HTTP, and zero terminal or `omp` jargon exposed.

## Technical Design
- **Runtime:** Single-file Bun HTTP server (`web/server.ts`) registered as a durable Sprite service via `sprite-env services create` on port `8080` (no React/Next.js build pipeline).
- **Persistent RPC Bridge:** Spawn one persistent **`omp --mode rpc --no-ui`** subprocess (auto-restarting on crash) and bridge its newline-delimited JSON (JSONL) events to the browser via SSE (`GET /api/events` or streaming `POST /api/chat`) so tokens and tool-execution indicators stream in real time with zero per-message cold-start delay.
- **Session Controls:** Load conversation history on page refresh; provide a clean **"New Conversation"** button (`new_session` RPC command) and **"Stop"** button (`abort` RPC command).
- **Security & Auth:** Rely on Fly.io Sprites' built-in `sprite` URL auth (`https://<sprite>.sprites.app`)—no public exposure or Discord bot tokens needed.
- **Zero Fourth-Wall Breaks:** Branded cleanly as **Professor L — Talent Manager**; show friendly activity states (e.g. *"Checking YouTube..."*, *"Researching..."*) instead of raw `omp` internals.

## Checklist
- [x] **Inspect `omp --mode rpc --no-ui` protocol:** Verified JSONL commands (`get_state`, `get_messages`, `prompt`, `abort`, `new_session`) and streaming events (`agent_start`, `tool_execution_start`, `message_start`, `message_update`/`text_delta`, `message_end`, `agent_end`, `session_settled`) on `omp 19.1.1`.
- [x] **Build `web/server.ts` + wireframe UI (`web/index.html`, `web/tokens.css`):** Implemented persistent `omp --mode rpc --no-ui` supervisor, SSE streaming, history/abort/new endpoints, and monochrome zero-radius wireframe UI with swappable CSS tokens in `web/tokens.css`.
- [x] **Wire into `setup.sh` & register durable Sprite service:** Registered `lma-web` on port `8080` via `sprite-env services create` (`status: running`).
- [x] **End-to-end verification:** Verified `/api/health`, `/`, `/tokens.css`, live SSE streaming (`text_delta` + `done`), `/api/messages` persistence, and `/api/new` session reset inside Sprite `lma`.
