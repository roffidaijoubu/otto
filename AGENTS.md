# AGENTS.md — LMA (`lma` — Livestreamer Manager Agent)

> If `WORKSTATION.md` exists in the repo root (gitignored; copy from [`WORKSTATION.md.example`](WORKSTATION.md.example)), read it first for private workstation, git identity, and Fly.io org bindings.

## Project Overview
**LMA (`lma` — Livestreamer Manager Agent)** is a **Fly.io Hacksgiving 2026** personal Talent Manager & Ops Agent for indie livestreamers and VTubers (**Otto**), running persistently inside a Fly.io Sprite with **zero outbound API keys in the VM or repository**.

- **Agent Runtime:** `omp` (`@oh-my-pi/pi-coding-agent`) running as a persistent `--mode rpc --no-ui` subprocess supervised by Bun (`web/server.ts`), paired with Mnemopi SQLite memory + structured `~/.omp/agent/MEMORY.md` talent dossier.
- **Architecture Deep Dive:** Read [`docs/architecture.md`](docs/architecture.md) for why we chose `omp` RPC, how **Upstash QStash + `/.sprite/api.sock` Tasks API** powers proactive wake-ups on a $0-idle sleeping Sprite, and how zero-key Sprites Connectors auto-discover at runtime.
- **Visual Design System:** Read [`DESIGN.md`](DESIGN.md) (*Otto Studio Bento OS*, implemented via `shadcn-vue` + Reka UI + Tailwind CSS v4 in `web/src/styles/globals.css` & `web/src/styles/tokens.css`).

---

## Non-Negotiable Engineering & Product Rules
1. **Strictly NO AI-generated images or video.** Never generate or recommend AI thumbnails, AI art, AI rigging, or AI video edits — enforced at both prompt level (`agent/APPEND_SYSTEM.md`) and tool-permission level (`generate_image: deny` in `agent/config.yml`).
2. **Zero Raw API Keys in Repo or Sprite VM.** Every key-bearing external API (Gemini, Exa, Firecrawl, Composio v3 YouTube/GCal, Buffer, Apify, Box, Upstash QStash, Fly Machines) routes through `https://api.sprites.dev/v1/gateway/...` and auto-discovers its `gateway_base_url` via `GET /v1/gateway/list` at runtime. Never hardcode connector IDs or secrets. (Anonymous public-VOD fetching via `yt-dlp`/InnerTube is keyless and goes direct.)
3. **Draft-First & Human-Approval Guardrails.** Social posts (`x_post`, `tiktok_post`, `instagram_post`) default to `saveToDraft: true`; YouTube mutations (`YOUTUBE_UPDATE_VIDEO`, `YOUTUBE_UPDATE_THUMBNAIL`) require explicit human confirmation.
4. **Zero Fourth-Wall Breaks.** Otto speaks like a real, practical studio manager — never expose raw tool slugs, file paths, or VM internals to the creator unless explicitly asked.
5. **Proactive Kanban Tracking for Ad-Hoc Features:** The author frequently comes up with spur-of-the-moment feature ideas directly in chat without creating a `.kanban/` card first. Whenever you finish implementing a new ad-hoc feature or notable capability that isn't tracked in `.kanban/`, **proactively nudge the author** to create a `.kanban/` card with `status: done` (capturing what was built and key file paths) so shipped features stay tracked and can be used later to bulk-update `README.md` and submission docs.

---

## Repository Structure
Do **not** turn `/home/sprite/.omp/` directly into a git repo (it holds runtime `sessions/`, `logs/`, and persistent memory). Keep this repository clean and reproducible, and symlink `agent/` into `/home/sprite/.omp/agent/` via `setup.sh`:

```text
lma/
├── AGENTS.md                   # Public agentic engineering guide (this file)
├── WORKSTATION.md.example      # Template for private local bindings (copy to gitignored WORKSTATION.md)
├── DESIGN.md                   # Otto Studio Bento OS design system tokens & rules
├── README.md                   # Project overview + 1-prompt agent-first setup
├── setup.sh                    # Idempotent Sprite bootstrap (omp, ffmpeg, yt-dlp, web build, lma-web service)
├── docs/                       # Human architecture deep dive (architecture.md) + agent-first setup guides (setup/)
├── agent/
│   ├── APPEND_SYSTEM.md        # Otto persona, guardrails, cutoff-proof VM & tool map
│   ├── config.yml              # Gemini model roles, Mnemopi SQLite, generate_image: deny
│   ├── models.yml.example      # Gemini Sprites Connector template
│   ├── MEMORY.md.example       # Blank talent dossier starter template
│   ├── extensions/             # 14 extensions: per-channel socials (tiktok, instagram, x-twitter) + youtube + box + exa + firecrawl + qstash + vod-clipper + media-reviewer + studio-db + new-session + studio-apps + obs-overlays (46 tools)
│   ├── lib/                    # Shared SQLite (studio-db.ts), QStash cron helpers (qstash-cron.ts), apify.ts, buffer.ts, box.ts, youtube-metrics.ts, studio-apps.ts, obs-overlays.ts
│   └── skills/                 # 8 streamer skills (onboarding, youtube-audit, stream-planner, social-promo, raw-clip-finder, studio-app-craft, obs-overlay-craft + opt-in streaming-coaching)
├── web/                        # Bun RPC supervisor (server.ts) + Vue 3 / Vite / shadcn-vue / Reka UI Otto Studio OS multi-window desktop shell (8 apps + Desktop Widgets + Spotlight)
└── scripts/
    ├── sync-initialized-checkpoint.sh  # Auto-syncs repo & refreshes clean `initialized:` Sprite checkpoint
    ├── verify-all.sh                   # Deterministic 24-check verification suite (25 with --live)
    └── e2e/                            # Agentic multi-turn E2E test playbooks (INDEX.md, README.md, 01..05-*.md, expected-memory.md)
```

---

## Local-to-Sprite Dev Loop & Auto-Checkpointing
1. Edit files locally, verify frontend changes with `cd web && npm run typecheck && npm run build`.
2. Fast ad-hoc sync to Sprite without committing:
   ```bash
   tar --exclude=web/node_modules --exclude=web/dist --exclude=agent/MEMORY.md --exclude=agent/models.yml -czf - agent web docs setup.sh README.md scripts | sprite exec --stdin -- bash -c "tar xzf - -C /home/sprite/lma && bash /home/sprite/lma/setup.sh"
   ```
3. **Auto-Checkpoint on Commit:** `.git/hooks/post-commit` calls `scripts/sync-initialized-checkpoint.sh` to sync the commit to Sprite, reset runtime state (`sessions/`, `memories/`, `mnemopi.db`, `studio.db`, `studio-apps/`, `workspace/`, `MEMORY.md`), rebuild `web/`, restart `lma-web`, create a fresh `initialized: <sha>` checkpoint, and prune only older `initialized:` checkpoints (never touching live/prod checkpoints). Bypass for docs-only commits with `LMA_SKIP_CHECKPOINT=1 git commit ...`.
4. **Org-level `sprite api` calls** (e.g. provisioning Custom API connectors) MUST run from a directory without `.sprite` (e.g. `/tmp`) so paths resolve under `/v1/` instead of `/v1/sprites/<name>/`.

---

## Testing & Verification Workflow

### 1. Fast Deterministic Suite (`scripts/verify-all.sh`)
Runs in ~10 seconds — 24 deterministic checks (25 with `--live`) verifying `web/` TypeScript + Vite build, all 8 skill & 12 extension symlinks, Python clipper syntax, `/.sprite/api.sock` Tasks API keep-alive hold, passcode & QStash signature `401` gates, path-traversal rejections, `CRON_TZ` validation, and authenticated Mission Control APIs:
```bash
bash scripts/verify-all.sh          # Fast deterministic suite
bash scripts/verify-all.sh --live   # Adds live zero-key Gemini + Buffer round-trip
```

### 2. Agentic Multi-Turn E2E Playbooks (`scripts/e2e/`)
Because conversational agents are non-deterministic, multi-turn behavioral tests are authored as **agentic Markdown playbooks** with semantic rubrics and **Checkpoint Time-Travel** isolation:
- **Start here:** Read [`scripts/e2e/INDEX.md`](scripts/e2e/INDEX.md) for exact programmatic multi-turn communication methods (Method A: directory-scoped `omp -p` with `autoResume`, Method B: `lma-web` HTTP/SSE API, Method C: raw `omp --mode rpc --no-ui` JSONL protocol).
- **Playbook Runner & Index:** Read [`scripts/e2e/README.md`](scripts/e2e/README.md) for the Checkpoint Time-Travel wrapper (`sprite checkpoint create` → `sprite restore <initialized-id>` → run playbook → `sprite restore <prod-id>`) and all 5 playbooks (`01-onboarding.md` vs `expected-memory.md`, `02-youtube-audit-and-squint-test.md`, `03-social-promo-buffer-drafts.md`, `04-vod-hype-clipper-and-review.md`, `05-qstash-proactive-wakeup.md`).
