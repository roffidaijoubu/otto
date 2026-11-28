# Agent-First Setup Guide — LMA (Livestreamer Manager Agent) Sprites Connectors (`docs/setup/`)

> **Audience:** AI coding agents setting up **LMA (`lma` — Livestreamer Manager Agent)** on a fresh Fly.io Sprite for a user (with human fallback steps where OAuth or API key retrieval is needed).
> **For humans & judges looking for architectural design rationale:** Read [`docs/architecture.md`](../architecture.md).
`lma` uses **zero raw API keys inside the Sprite VM or repository**. Every **key-bearing** external integration routes through `https://api.sprites.dev/v1/gateway/...` and auto-discovers its `gateway_base_url` via `GET /v1/gateway/list` at runtime. (Anonymous public-VOD tooling — `yt-dlp`/InnerTube inside the Sprite — needs no key and never touches the gateway.)

---

## 1. Check Already-Connected Sprites Connectors First
Inside the Sprite, check which connectors are already provisioned and authorized:
```bash
sprite exec -- curl -s https://api.sprites.dev/v1/gateway/list | jq '.connections[] | {provider, display_name, gateway_base_url}'
```

---

## 2. Built-In BYOK Connectors (Provision via Fly.io Sprites Dashboard)
Open **[Fly.io Sprites Dashboard](https://sprites.dev) → Connectors → Add Connector**, paste each key once (stored encrypted at the org level, never inside the Sprite), and grant access to your `lma` Sprite:

| Connector | Required? | Purpose in `lma` | Setup Location |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | **Required** | LLM brain (`omp` RPC) + multimodal `watch_clip` & `critique_thumbnail` | Sprites Dashboard → **Google Gemini** (BYOK) |
| **Ollama Cloud** | Recommended | Primary low-latency endpoint for smol/memory/widget roles via Hybrid LLM Router | Sprites Dashboard → **Custom API** (`ollama.com`) |
| **Neon Postgres** | Recommended | Cloud-persistent 10-table Studio DB + `MEMORY.md` sync (SQLite fallback) | Sprites Dashboard → **Custom API** (Neon Data API / SQL-over-HTTP) |
| **Pinecone** | Recommended | `otto-creator-archive` (`multilingual-e5-large`) & `otto-memory` semantic RAG | Sprites Dashboard → **Custom API** (`api.pinecone.io` + index host) |
| **Box** | Recommended | Incremental `Otto Assets/` pull + `Otto Handoffs/` push (48 MiB guard) | Sprites Dashboard → **Box** (OAuth) or **Custom API** |
| **Fly Machines** | Recommended | Zero-Docker provisioning of dedicated `256 MB` auto-stop OBS Overlay host + `1 GB` Volume | Sprites Dashboard → **Custom API** (`api.machines.dev`, `Authorization: Bearer`) |
| **Exa** | Recommended | Semantic web research (`exa_search`, `exa_get_contents`) | Sprites Dashboard → **Exa** (BYOK) |
| **Firecrawl** | Recommended | Clean Markdown scraping (`firecrawl_scrape`) | Sprites Dashboard → **Firecrawl** (BYOK) |

After connecting Google Gemini, run `bash /home/sprite/lma/setup.sh` inside the Sprite — it automatically discovers the Gemini connector URL and writes `~/.omp/agent/models.yml` **if that file does not exist yet** (delete it first to force a rewrite).

---

## 3. Custom API Connectors (1-Command CLI Provisioning via `sprite api`)
Run `sprite api /oauth/connections/custom_api` from a directory **without** `.sprite` (e.g. `/tmp`) so the path resolves at the org level (`/v1/oauth/connections/custom_api`):

| Connector | Required? | Purpose in `lma` | Detailed Playbook |
| :--- | :--- | :--- | :--- |
| **Composio v3 (YouTube & Google Calendar)** | Recommended | Live channel stats, recent videos, captions, human-approved packaging updates, 2-way GCal sync | [`docs/setup/composio-youtube.md`](composio-youtube.md) |
| **Buffer (X / TikTok / IG)** | Recommended | Cross-platform social promos saved safely as drafts (`saveToDraft: true`) | [`docs/setup/buffer.md`](buffer.md) |
| **Upstash QStash** | Recommended | Proactive self-scheduling wake-ups on a $0-idle sleeping Sprite | [`docs/setup/qstash-scheduler.md`](qstash-scheduler.md) |
| **ElevenLabs** | Recommended | Scribe v3 word-level `.srt` transcription for VOD clips | [`docs/setup/elevenlabs.md`](elevenlabs.md) |
| **Pixabay** | Recommended | Royalty-free, strictly non-AI human photography backgrounds for Thumbnail Studio | [`docs/setup/pixabay.md`](pixabay.md) |
| **Apify** | Optional | Credit-capped TikTok, Instagram & X research + multi-platform analytics sync | `sprite api /oauth/connections/custom_api` (`api.apify.com`, `Bearer`) |

---

## 4. Private Web Chat UI Passcode & Webhook Signing Keys (`/home/sprite/.config/lma/web.env`)
When enabling Upstash QStash wake-ups, make the Sprite URL reachable for QStash webhooks (`sprite url update --auth public`) while locking `/` and all `/api/*` routes behind a passcode cookie gate — with three intentional exceptions: `GET /api/health` (public liveness probe) and `POST /api/auth/login` (the gate itself), plus `POST /api/wakeup`, which is not passcode-gated but requires a valid Upstash QStash signature:
```bash
sprite exec -- bash -c '
mkdir -p /home/sprite/.config/lma
cat > /home/sprite/.config/lma/web.env << "EOF"
LMA_PUBLIC_URL=https://<your-sprite>.sprites.app
LMA_WEB_PASSWORD=<choose-a-strong-passcode>
QSTASH_CURRENT_SIGNING_KEY=<from-upstash-console>
QSTASH_NEXT_SIGNING_KEY=<from-upstash-console>
EOF
chmod 600 /home/sprite/.config/lma/web.env
bash /home/sprite/lma/setup.sh
'
```

---

## 5. Verify Everything End-to-End
### Prerequisites
- Local `web/` dependencies installed (`cd web && bun install` or `npm install`) for TypeScript & Vite build checks.
- Authenticated `sprite` CLI (`sprite login`) and active `.sprite` binding (`sprite use <name>`).
- `LMA_VERIFY_PIN=<6-digit-pin>` exported in your shell when `~/.config/lma/web.env` uses hashed `LMA_WEB_PASSWORD_HASH`.

Run the deterministic **28-check** suite (`+ live probes` with `--live`) from your local workstation — covering the `web/` build, all **9 skills** and **22 extensions** symlinked by `setup.sh`, Python clipper syntax, Tasks API hold, security gates, Hybrid LLM Router checks, workspace/DB/playbook APIs, and calendar export:
```bash
bash scripts/verify-all.sh          # Fast deterministic suite (~10s, 28 checks)
bash scripts/verify-all.sh --live   # Adds live zero-key connector probes
```
