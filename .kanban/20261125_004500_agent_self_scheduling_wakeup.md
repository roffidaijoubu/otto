---
title: "Agent Self-Scheduling Wake-Up Jobs (Proactive Cron on Sleeping Sprite)"
status: done
priority: high
created_at: 2026-11-25T00:45:00+07:00
completed_at: 2026-11-25T01:02:00+07:00
tags:
  - scheduling
  - sprites-connector
  - proactive-agent
  - omp-rpc
---

# Agent Self-Scheduling Wake-Up Jobs (Proactive Cron on Sleeping Sprite)

**Target:** Let Professor L autonomously schedule future one-shot or recurring wake-up jobs (e.g., *"Remind Roffi 1 hour before the Dec 17 15:30 stream with Hans"*, *"After stream, pull VOD and find raw clips"*, *"Send weekly email/briefing"*) so the Sprite stays asleep at $0 until the exact scheduled moment, wakes on HTTP, injects a system prompt into `omp`, executes the action, and goes back to sleep.

## Architecture
- **Tool Extension (`agent/extensions/scheduler.ts`):** Exposes `schedule_wakeup({ runAt, cron?, prompt, label })`, `list_scheduled_wakeups()`, and `cancel_wakeup(id)` via a zero-key Sprites Custom API Connector.
- **External Scheduler Candidates (all work through a Sprites Custom API Connector):**
  1. **Upstash QStash** (recommended — free 500 msgs/day, supports exact future unix timestamps via `Upstash-Not-Before` and recurring `Upstash-Cron`, cryptographic callback signing).
  2. **cron-job.org REST API** (100% free, simple `PUT /jobs`).
  3. **GCP Cloud Tasks / Cloud Scheduler** (one-shot delayed HTTP tasks).
- **Wake-Up Receiver (`POST /api/wakeup` in `web/server.ts`):**
  - Verifies shared HMAC/Bearer secret (or QStash signature).
  - Injects a structured `[SCHEDULED WAKE-UP]` prompt into the persistent `omp --mode rpc --no-ui` session.
  - Professor L executes the scheduled action (e.g., send email, post/draft to Buffer, pull YouTube VOD, or leave a proactive briefing message visible in the Web Chat UI).

## Checklist
- [x] **Pick scheduler provider & provision Sprites Custom API Connector:** Provisioned Upstash QStash (`qstash-eu-central-1.upstash.io`) via `sprite api /oauth/connections/custom_api` (zero local API token; auto-discovered at runtime).
- [x] **Add `POST /api/wakeup` + passcode auth gate in `web/server.ts`:** Implemented HS256 + SHA-256 body-hash `Upstash-Signature` verification (dual-key rotation) and `HttpOnly` passcode login cookie (`LMA_WEB_PASSWORD`) for the Web Chat UI.
- [x] **Build `agent/extensions/qstash-scheduler.ts`:** Registered auto-discovering `schedule_wakeup` (one-shot `runAt`/`delaySeconds` + recurring `cron`), `list_wakeups`, and `cancel_wakeup`.
- [x] **End-to-end live test:** Verified `401` rejection on unsigned `/api/wakeup` and unauthenticated `/`, then scheduled a 10-second live wake-up via Professor L and confirmed Upstash QStash delivered the signed webhook and produced `PROACTIVE_WAKEUP_SUCCESS` in `/api/messages`.
