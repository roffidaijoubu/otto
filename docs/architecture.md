# Architecture Deep Dive — How Otto OS (`lma`) Combines `omp` RPC, Multi-Window Studio OS &amp; Native Fly.io Sprites Primitives

This document explains the core engineering decisions behind **Otto OS (`lma` — Livestreamer Manager Agent)** — specifically why we run **`omp` (`@oh-my-pi/pi-coding-agent`)** as a persistent RPC daemon, how **Otto Studio OS** coordinates 7 live-synced desktop apps and right-side Desktop Widgets over one SSE channel, how **proactive self-scheduling survives $0-idle auto-sleep**, and how every external API runs with **zero outbound API keys or session cookies inside the VM**.

---

## 1. Why `omp --mode rpc --no-ui` Instead of a Custom Agent Loop

Most hackathon agents reinvent a brittle `while (toolCalls)` loop in Python or TypeScript, then spend 80% of their time fighting context compaction, tool-call retries, session persistence, and streaming bugs.

Otto OS takes the opposite approach: treat **`omp`** as the battle-tested agent runtime inside the Sprite, and wrap it with a Bun supervisor (`web/server.ts`) speaking **`omp --mode rpc --no-ui`** over newline-delimited JSON (JSONL) stdin/stdout.

```mermaid
flowchart LR
    B["Otto Studio OS (Vue 3 + Vite + shadcn-vue + Reka UI + Tailwind v4)<br/>7 Wired Apps · Desktop Widgets · Spotlight · ThoughtTrace"] <-->|"HTTPS · SSE"| S["Bun Supervisor (web/server.ts)<br/>Port 8080 · Passcode Gate · Tasks Hold"]
    S <-->|"Persistent JSONL stdin/stdout"| O["omp --mode rpc --no-ui<br/>(google/gemini-4-hydrogen · Mnemopi · 11 Extensions · 8 Skills)"]
    O -->|"Zero local keys"| G["Fly.io Sprites Gateway<br/>(7 Auto-Discovering Connectors)"]
```

### What `omp` RPC Gives Us Out of the Box

| Capability | How Otto OS Uses It |
| :--- | :--- |
| **Zero per-message cold start** | One persistent `omp` RPC worker stays warm inside `lma-web` (auto-restarts on exit) instead of spawning a new CLI process per turn. |
| **Model role routing** | `agent/config.yml` defaults primary reasoning, vision, audio, and video roles to `google/gemini-4-hydrogen:auto` (with `high` for planning/vision) and lightweight roles (`smol`, `memory`, `autorename`) to `google/gemini-3.5-flash-lite`. |
| **First-class streaming events** | `thinking_delta`, `text_delta`, `tool_execution_start`, and `tool_execution_end` stream straight to the Vue 3 `<ThoughtTrace>` and `TodoChecklistCard` components over SSE. |
| **Native session management** | `get_messages`, `new_session`, `switch_session`, and `abort` power multi-chat history and instant stop controls without a custom chat database. |
| **Dual-layer persistent memory** | Structured `MEMORY.md` talent dossier (handles, timezone, team credits, OPSEC rules, schedule notes) paired with built-in **Mnemopi** SQLite memory (`noEmbeddings: true` for fast CPU-only FTS recall). |
| **Modular extensions &amp; skills** | **11 extensions** registering **38 tools** (+ `--new` CLI flag) in `agent/extensions/*.ts`, paired with **8 Markdown skills** (7 ops/craft + 1 opt-in `streaming-coaching` skill) in `agent/skills/`. |
| **Runtime-enforced guardrails** | `generate_image: deny` and `generate_image.enabled: false` enforce the **strictly no AI-generated art/video** rule at the tool-permission layer, not just in prose. |

---

## 2. Otto Studio OS Multi-Window Workstation

Instead of a single-column chat box with a cramped slide-over drawer, `web/` renders **Otto Studio OS** — a full multi-window cloud desktop built on **Vue 3 + Vite + `shadcn-vue` + Reka UI + Tailwind CSS v4**:

```mermaid
flowchart TB
    Shell["DesktopShell.vue + useWindowManager.ts<br/>Pointer-Capture Drag/Resize · Edge-Snap Ghosts · localStorage Geometry"]
    Top["TopMenuBar.vue + SpotlightCommand.vue (Cmd+K)<br/>App Launcher · Layout Presets"]
    Dock["DesktopDock.vue (Alt+1..7) + DesktopSurface.vue<br/>YouTube Metrics · Next Stream Countdown · Pure-SVG 3D OttoMascot.vue"]
    SSE["Single Authenticated /api/events SSE Stream<br/>ThoughtTrace · TodoChecklistCard · workspace_changed · db_changed"]

    Top --> Shell
    Dock --> Shell
    SSE --> Shell

    Shell --> A1["Otto Chat &amp; Studio Files"]
    Shell --> A2["OBS Overlays &amp; Studio DB"]
    Shell --> A3["Calendar (3-View) &amp; Contacts CRM"]
    Shell --> A4["System Settings (General, Profile &amp; Connectors)"]
```

- **7 genuinely wired apps (`useWindowManager.ts` `StudioAppId`):** `otto-chat` (Otto Chat), `files` (2-way Studio Workspace + `/clips` HTTP 206 media player), `obs-overlays` (Fly Machine-hosted overlay host: 16:9 iframe preview, copyable OBS Browser Source + mobile Remote Control Deck URLs, machine status &amp; delete), `studio-db` (`StudioDatabaseView.vue` with Content Pipeline &amp; Channel Metrics synced programmatically at 0 LLM tokens; read-only SQL queries run via the agent's `studio_db_query` tool), `calendar` (Month/Week/Agenda views with live QStash wake-up badges `T-2h`/`T-15m` + `.ics` export), `contacts` (3-pane Creator Rolodex CRM for human artists, riggers, clippers, editors &amp; sponsors with 1-click "Draft outreach with Otto"), and `settings` (`SystemSettingsApp.vue` with `General`, `Profile` dossier, and `Connectors` + zero-key security telemetry tabs) — paired with live right-side **Desktop Widgets** (`ChannelMetricsWidget.vue`, `NextStreamWidget.vue`, and `OttoMascot.vue`).
- **Desktop ergonomics:** Pointer-capture drag and 8-edge resize, dashed yellow edge-snap ghosts (`left`, `right`, `maximize`), one-key layout presets (`tile-2up`, `focus-chat`, `cascade`, `show-desktop`, `reset`), macOS/Windows auto-adaptive traffic-light or caption controls, persistent `localStorage` window rects, and an automatic `<1024px` responsive single-app mode.
- **Spotlight (`SpotlightCommand.vue`):** `Cmd+K` / `Ctrl+K` searches apps, quick workspace folders, and layout presets.
- **Zero-cold-start onboarding &amp; zero-AI-art craft:** First run opens the 3-step `StudioSetupWizard.vue` (413 IANA timezones, atomic `0600` passcode rotation, live connector readiness) paired with headless `scripts/bootstrap-dossier.sh` (`omp --no-session` scanning YouTube, Buffer, 30-day Google Calendar, and Exa to pre-fill `MEMORY.md` before turn #1). `OttoMascot.vue` is a 100% pure-SVG 3D sphere using `requestAnimationFrame` damped yaw/pitch projection and dynamic specular keylight — zero AI-generated assets.

---

## 3. Proactive Self-Scheduling on a Sleeping Sprite (Upstash QStash + Tasks API)

Fly.io Sprites pause automatically after **~30 seconds of idle time** (warm suspend → cold stop), which keeps idle compute at **$0** — but also pauses any local Linux `cron` daemon inside the VM.

To let Otto be genuinely **proactive**, Otto OS combines **Upstash QStash** with Fly.io's **`/.sprite/api.sock` Tasks API**:

```mermaid
sequenceDiagram
    participant U as Streamer
    participant L as Otto (omp RPC)
    participant Q as Upstash QStash (via Sprites Connector)
    participant W as web/server.ts (Port 8080)
    participant T as /.sprite/api.sock (Tasks API)

    U->>L: "Stream with Hans is confirmed for Dec 17 at 15:30 WIB"
    L->>Q: schedule_wakeup(runAt, prompt) [zero local keys]
    Note over L,W: Sprite goes idle -> pauses at $0

    Note over Q: Dec 17, 14:30 WIB arrives
    Q->>W: POST /api/wakeup (HS256 Upstash-Signature + SHA-256 body hash)
    Note over W: Sprite wakes in <1s
    W->>W: Verify Upstash-Signature (dual rotating keys)
    W->>T: PUT /v1/tasks/lma-agent-turn { expire: "10m" }
    W-->>Q: 200 OK (immediate ACK)
    W->>L: Inject [SCHEDULED WAKE-UP] prompt
    L->>L: Execute task (Buffer draft, YouTube check, or chat briefing)
    L-->>W: agent_end / session_settled
    W->>T: DELETE /v1/tasks/lma-agent-turn
    Note over L,W: 30s later -> Sprite sleeps at $0 again
```

### Tasks API Keep-Alive Hold, Reschedule Delta Auto-Re-Arming &amp; RFC 5545 `.ics`

- **Keep-alive hold without leaked billing:** Because `POST /api/wakeup` ACKs QStash immediately and executes `omp` asynchronously without an open browser SSE stream, `web/server.ts` holds `PUT /v1/tasks/lma-agent-turn` (`expire: "10m"`) on `agent_start` (refreshed every 5 minutes while `rpc.busy` is active, capped at a hard 30-minute ceiling) and releases `DELETE /v1/tasks/lma-agent-turn` on `agent_end`/`abort`.
- **Reschedule delta auto-re-arming (`agent/extensions/qstash-scheduler.ts`):** When a stream moves via `calendar_update_event`, Otto computes the exact time delta between the old and new start timestamps, revokes existing QStash message IDs attached to that event, re-arms shifted lifecycle triggers (`promo_24h`, `pre_stream_1h`, `post_stream_vod_30m`), persists updated hook IDs in `studio.db`, and syncs the change 2-way with Google Calendar.
- **RFC 5545 `.ics` export with `VALARM` (`GET /api/calendar/export.ics`):** Generates standards-compliant iCalendar feeds from `calendar_events`, attaching `BEGIN:VALARM` / `TRIGGER:-PT15M` reminders so creators can subscribe from Apple Calendar, Google Calendar, or mobile devices.

---

## 4. Deterministic VOD Hype Pipeline &amp; Multimodal Media Reviewer

Rather than feeding 4-hour VOD transcripts into an expensive LLM and hoping it guesses where chat popped off, Otto OS splits clip discovery into **deterministic signal processing** followed by **bounded multimodal review**:

- **12-thread InnerTube parallel chat pull (`agent/skills/raw-clip-finder/scripts/fetch_chat_fast.py`):** Extracts YouTube's internal `playerSeekContinuationData` random-access token and fans out **12 concurrent threads** across 10-minute timeline chunks — pulling a **4-hour VOD's live chat replay in ~30 seconds** (versus 30–60 minutes of linear pagination) with zero API keys, alongside `yt-dlp` captions.
- **Chat-lag compensation &amp; 4-signal Z-score hype math (`detect_hype_candidates.py`):** Buckets chat into 10-second windows and scores 4 rolling Z-score signals (velocity `0.40`, unique-author burst `0.30`, reaction ratio `0.15`, emote burst `0.15`) with indie-channel adaptive `min_authors` thresholding and bilingual EN/ID hype + emote regexes. Because real stream ingest + CDN latency delays viewer chat reactions by 10–25 seconds, every candidate window applies a **35-second pre-roll** (+15s post-roll) so the setup and punchline are captured intact.
- **Broadcast-ready raw cut &amp; prep (`cut_raw_clip.py` + `vod_prep_clip`):** `cut_raw_clip.py` (`vod_cut_clip`) slices the exact raw `.mp4` + time-shifted `.srt`, and `vod_prep_clip` (`agent/extensions/vod-clipper.ts`) normalizes it via `ffmpeg` to CFR 30fps H.264 `yuv420p` `+faststart` at **-14 LUFS**, saved directly into `/home/sprite/workspace/clips/` for inline HTTP 206 playback and human editor handoff.
- **Dynamic 480p/2fps FFmpeg proxy + hardened SSRF guard (`agent/extensions/media-reviewer.ts`):**
  - `watch_clip` inspects file size; clips exceeding **14 MB** are automatically transcoded on the fly via `ffmpeg` (`scale=-2:480 -r 2`) into a lightweight proxy for inline Gemini multimodal critique with **zero external object storage**.
  - `critique_thumbnail` enforces HTTPS-only SSRF protection — rejecting `localhost`, `::1`, `.local`, `.internal`, `169.254.*`, `10.*`, `192.168.*`, and `172.16-31.*`, performing manual redirect validation (max 4 hops), and capping response streams at 14 MB.

---

## 5. Zero Outbound API Keys (7 Auto-Discovering Sprites Connectors)

Every key-bearing external API routes through `https://api.sprites.dev/v1/gateway/...`:

- **Built-in BYOK Connectors:** Google Gemini (`models.yml`), Exa (`exa-gateway.ts`), Firecrawl (`firecrawl-gateway.ts`).
- **Custom API Connectors (provisioned via `sprite api /oauth/connections/custom_api`):**
  - **Composio v3 (`https://backend.composio.dev`, `x-api-key`)** — handles YouTube channel stats, video metadata, captions, human-approved packaging updates, and 2-way Google Calendar sync (`composio-youtube.ts`).
  - **Buffer (`https://api.buffer.com`, `Bearer`)** — single GraphQL API covering **X (Twitter), TikTok, and Instagram**, defaulting to `saveToDraft: true` so nothing publishes publicly without human sign-off (`buffer-gateway.ts`).
  - **Upstash QStash (`Bearer`)** — agent self-scheduled one-shot, lifecycle, and `CRON_TZ` recurring wake-ups (`qstash-scheduler.ts`).
  - **Fly Machines (`https://api.machines.dev`)** — zero-Docker provisioning of a dedicated `256 MB` auto-stop Machine + `1 GB` Volume for public, transparent OBS Browser Sources and SSE Remote Control Decks (`agent/lib/obs-overlays.ts`, `obs-overlays.ts`).

Across the **11 extensions** (**38 registered tools** + `--new`), all **7 connector extensions** (`buffer-gateway`, `composio-youtube`, `exa-gateway`, `firecrawl-gateway`, `media-reviewer`, `qstash-scheduler`, `obs-overlays`) query `GET https://api.sprites.dev/v1/gateway/list` at runtime and cache their authorized `gateway_base_url` — leaving **zero hardcoded connector IDs** in the repo. The **4 local-only extensions** (`studio-apps`, `studio-db`, `vod-clipper`, `new-session`) never require gateway secrets.

---

## 6. Unified 2-Way Studio Workspace &amp; 5-Table SQLite WAL DB

Because Otto OS runs on a single persistent NVMe Sprite powered by Bun, the Web UI (`web/server.ts`) and the `omp` agent share **both** a two-way filesystem workspace and a **5-table native SQLite WAL database** with zero external database servers:

```mermaid
flowchart LR
    UI["Otto Studio OS<br/>(Studio Files · Studio DB · Calendar · Contacts · Chat 📎)"] <-->|"REST + SSE live refresh"| S["web/server.ts (Bun)"]
    S <-->|"web/lib/workspace.ts<br/>(realpathSync jail)"| WS["/home/sprite/workspace/<br/>clips · thumbnails · scripts · briefs · uploads · exports"]
    S <-->|"agent/lib/studio-db.ts<br/>(SQLite WAL · 5 tables)"| DB["~/.omp/agent/studio.db<br/>calendar_events · content_pipeline · contacts · channel_metrics · studio_meta"]
    OMP["omp Agent (Otto)"] <-->|"read/write/media-reviewer/vod-clipper"| WS
    OMP <-->|"studio-db.ts · qstash-scheduler.ts"| DB
```

| Layer | Backing Store | Shared By | Live Sync Mechanism |
| :--- | :--- | :--- | :--- |
| **Unified Workspace** | `/home/sprite/workspace/` | Studio Files app + Chat `📎` uploads + `omp` (`read`/`write`/`vod-clipper`/`media-reviewer`) | `tool_execution_end` + debounced `fs.watch` → SSE `workspace_changed` |
| **Unified Studio DB** | `~/.omp/agent/studio.db` (`bun:sqlite`, `WAL`, `busy_timeout=5000`, 5 tables) | Web `/api/db/*`, `/api/calendar/*` + `omp` (10 DB tools + QStash) | `tool_execution_end` + API mutations → SSE `db_changed` |
| **Talent Dossier** | `~/.omp/agent/MEMORY.md` | Mission Control Dossier view + `omp` system prompt memory | Reloaded on turn completion |
| **Chat Memory** | `~/.omp/agent/mnemopi.db` | Managed internally by `omp` | Automatic across sessions (cleared by clean-checkpoint reset) |

---

## 7. Checkpoint Time-Travel &amp; Reproducible Verification

Stateful personal agents are notoriously painful to test end-to-end: persistent memory (`MEMORY.md`, Mnemopi SQLite) and conversation history bleed across runs, and LLM replies are non-deterministic. **Fly.io Sprites' immutable copy-on-write checkpoints** turn that bottleneck into a 1-second reset loop:

```mermaid
flowchart LR
    C["git commit"] --> H["post-commit hook<br/>sync-initialized-checkpoint.sh"]
    H --> I["Clean 'initialized: &lt;sha&gt;'<br/>Checkpoint (blank MEMORY.md)"]
    I -->|"sprite restore &lt;id&gt; (~1s)"| T["Blank-Slate Testing Agent<br/>(reads scripts/e2e/INDEX.md)"]
    T -->|"Multi-turn omp -p + JSONL inspection"| G["Semantic Rubric Grade<br/>(vs expected-memory.md)"]
    G -->|"sprite restore &lt;prod-id&gt;"| P["Live Prod State<br/>(Zero Data Loss)"]
```

1. **Perpetually Fresh Clean Baseline (`scripts/sync-initialized-checkpoint.sh` + `scripts/install-hooks.sh`):** On every code commit, `.git/hooks/post-commit` backs up live `MEMORY.md` (`prod: auto-backup`) if modified, syncs the repo to the Sprite, clears runtime sessions/memories/`mnemopi.db`/`studio.db`/`studio-apps`/`workspace/`, seeds `MEMORY.md` from the gitignored live dossier by default (`--no-memory` restores the blank `MEMORY.md.example`), rebuilds `web/`, restarts `lma-web`, creates a fresh `initialized: <sha>` checkpoint, and prunes only older `initialized:` checkpoints.
2. **Deterministic Fast Gate (`scripts/verify-all.sh`):** Runs **24 deterministic fast checks** in ~10 seconds (**25** with `--live` adding a zero-key Gemini + Buffer round-trip) — TypeScript/Vite build, all **8 skill** &amp; **11 extension** symlinks, Python clipper compilation, `/.sprite/api.sock` Tasks API hold, `401` passcode &amp; QStash signature gates, path-traversal rejections, `CRON_TZ` validation, Unified Workspace PUT/GET/ZIP/DELETE round-trips, and Unified Studio DB SQLite CRUD checks.
3. **Agentic Multi-Turn E2E Playbooks (`scripts/e2e/`):** Behavioral tests live as **5 Markdown playbooks** (`01-onboarding.md` … `05-qstash-proactive-wakeup.md`) paired with [`scripts/e2e/INDEX.md`](../scripts/e2e/INDEX.md) and a golden reference dossier ([`scripts/e2e/expected-memory.md`](../scripts/e2e/expected-memory.md)).

---

## 8. Defense-in-Depth Security

- **Zero outbound API keys or session cookies + live runtime audit:** All 7 external API credentials stay inside Fly.io's encrypted org gateway. `GET /api/connectors` dynamically inspects `process.env` (`zeroLocalKeys: true`) and `agent/config.yml` (`aiMediaDisabled: true`) on every load. Inbound verification secrets (`LMA_WEB_PASSWORD` and Upstash QStash signing keys) live in `chmod 600 ~/.config/lma/web.env` outside git and are stripped from the `omp` subprocess environment (`qstash-scheduler.ts` reads only non-secret routing vars and never opens `web.env`).
- **Ephemeral internal IPC auth:** Loopback `/api/internal/*` endpoints (used by `studio-apps` and `obs-overlays` to open windows in the desktop UI) require the per-boot 24-byte `LMA_INTERNAL_SECRET` bearer token; external callers cannot invoke them.
- **Fail-closed Web UI gate &amp; QStash signature verification:** `setup.sh` auto-generates `LMA_WEB_PASSWORD`; if unset, `web/server.ts` fails closed (`401` on `/` and `/api/*`, `503` on `/api/auth/login`), rate-limits brute-force attempts (5/min `429` keyed on `fly-client-ip` / rightmost proxy hop / socket IP), and issues `HttpOnly; SameSite=Lax` cookies (`Secure` over HTTPS) verified via `crypto.timingSafeEqual`. `POST /api/wakeup` validates dual rotating QStash HS256 JWT keys plus a constant-time SHA-256 raw-body digest.
- **Headless RPC containment &amp; tool guardrails:** Because `omp` runs headlessly inside a single-tenant Sprite VM, `agent/config.yml` pairs `approvalMode: yolo` (autonomy for research, clipping, and scheduling) with hard tool-layer bans (`generate_image: deny`), strict `realpathSync` confinement under `/home/sprite/workspace/` on `vod-clipper.ts` &amp; `media-reviewer.ts`, HTTPS-only SSRF guards on `critique_thumbnail`, read-only SQL allowlist (`SELECT`/`WITH`/`PRAGMA table_info` only, single statement, mutation-keyword denylist, 100-row cap) on `studio_db_query`, and prompt-injection rules for untrusted web/chat data.
- **Workspace root jail &amp; anti-stored-XSS (`web/lib/workspace.ts`):** Enforces `path.resolve` + `fs.realpathSync` confinement inside `/home/sprite/workspace/`, rejects symlinks, dotfiles, and `..` traversal, caps uploads at 100 MB and pre-flight ZIP exports at 500 MB (`followlinks=False`), and serves downloads/HTML/SVG/binaries with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.
- **Database separation &amp; parameterized queries:** `~/.omp/agent/studio.db` lives outside `/home/sprite/workspace/` so file-manager operations cannot delete or corrupt it, and every API and tool mutation uses parameterized SQLite queries.
