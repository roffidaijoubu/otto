# Agent-First Setup Guide — Fly.io Sprites Connectors (`docs/setup/`)

> **Audience:** AI coding agents setting up `lma` on a fresh Fly.io Sprite for a user (with human fallback steps where OAuth or API key retrieval is needed).
> **For humans & judges looking for architectural design rationale:** Read [`docs/architecture.md`](../architecture.md).

`lma` uses **zero raw API keys inside the Sprite VM or repository**. Every external integration routes through `https://api.sprites.dev/v1/gateway/...` and auto-discovers its `gateway_base_url` via `GET /v1/gateway/list` at runtime.

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
| **Exa** | Recommended | Semantic web research (`exa_search`, `exa_get_contents`) | Sprites Dashboard → **Exa** (BYOK) |
| **Firecrawl** | Recommended | Clean Markdown scraping (`firecrawl_scrape`) | Sprites Dashboard → **Firecrawl** (BYOK) |

After connecting Google Gemini, run `bash /home/sprite/lma/setup.sh` inside the Sprite — it automatically discovers the Gemini connector URL and writes `~/.omp/agent/models.yml`.

---

## 3. Custom API Connectors (1-Command CLI Provisioning via `sprite api`)
Run `sprite api /oauth/connections/custom_api` from a directory **without** `.sprite` (e.g. `/tmp`) so the path resolves at the org level (`/v1/oauth/connections/custom_api`):

| Connector | Required? | Purpose in `lma` | Detailed Playbook |
| :--- | :--- | :--- | :--- |
| **Composio v3 (YouTube)** | Recommended | Live channel stats, recent videos, captions, human-approved packaging updates | [`docs/setup/composio-youtube.md`](composio-youtube.md) |
| **Buffer (X / TikTok / IG)** | Recommended | Cross-platform social promos saved safely as drafts (`saveToDraft: true`) | [`docs/setup/buffer.md`](buffer.md) |
| **Upstash QStash** | Recommended | Proactive self-scheduling wake-ups on a $0-idle sleeping Sprite | [`docs/setup/qstash-scheduler.md`](qstash-scheduler.md) |

---

## 4. Private Web Chat UI Passcode & Webhook Signing Keys (`/home/sprite/.config/lma/web.env`)
When enabling Upstash QStash wake-ups, make the Sprite URL reachable for QStash webhooks (`sprite url update --auth public`) while locking `/` and all `/api/*` routes behind a passcode cookie gate:
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
Run the deterministic 14-check suite from your local workstation:
```bash
bash scripts/verify-all.sh          # Fast deterministic suite (~11s)
bash scripts/verify-all.sh --live   # Adds live zero-key Gemini + Buffer round-trip
```
