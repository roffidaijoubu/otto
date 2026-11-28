# Agent Setup Guide: Buffer (X, TikTok & Instagram) via Sprites Custom API Connector

> **Audience:** AI coding agent setting up `lma` for a user. Execute the CLI steps directly; only interrupt the human to obtain their Buffer API key if it is not already exported in the shell environment (the repo `.env` is **not** auto-loaded at runtime).

`lma` drafts and schedules social posts across **X (Twitter), TikTok, and Instagram** using Buffer's GraphQL API (`https://api.buffer.com`) through a **Fly.io Sprites Custom API Connector** — with **zero API keys stored inside the Sprite**.

---

## 1. Check if Already Connected

Run inside the Sprite first — skip setup if a `buffer` connector already exists:

```bash
sprite exec -- bash -c 'curl -s https://api.sprites.dev/v1/gateway/list | jq ".connections[] | select((.provider==\"buffer\") or (.provider==\"custom_api\" and (.display_name | test(\"buffer\"; \"i\")))) | .gateway_base_url"'
```

---

## 2. Obtain `BUFFER_API_KEY` (Only if Missing)

Check if `BUFFER_API_KEY` is already **exported in your current shell** (`[ -n "$BUFFER_API_KEY" ]`) — the repo `.env` is workstation-side only and is never read by the Sprite nor at runtime, so copy from it into the shell if needed (never print or commit it). If missing, ask the human to:
1. Connect their X, TikTok, and/or Instagram channels at [publish.buffer.com](https://publish.buffer.com).
2. Generate an API key at [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api), then export it for this shell session:
   ```bash
   export BUFFER_API_KEY=...   # or: set -a; . ./.env; set +a
   ```

---

## 3. Provision the Connector via `sprite api` (Primary Method)

Run from a directory **without** a `.sprite` file (e.g. `/tmp` on Linux/macOS, `/c/Windows/Temp` on Windows) so `sprite api` targets the org-level `/v1/` endpoint:

```bash
cd /tmp
sprite api /oauth/connections/custom_api -- -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Buffer",
    "base_api_url": "https://api.buffer.com",
    "access_token": "'"$BUFFER_API_KEY"'",
    "auth_method": "header",
    "auth_header_prefix": "Bearer",
    "description": "Buffer GraphQL API for X, TikTok, and Instagram",
    "access_policy": { "allow_all": true }
  }'
```

### Fallback (Only if `sprite api` fails)

If the command above fails, tell the human to add it manually in the [Fly.io Sprites Dashboard](https://sprites.dev) (**Connectors → Add connector → Custom API**) with these exact fields and grant access to the `lma` Sprite:

| Field | Value |
| :--- | :--- |
| **Base API URL** | `https://api.buffer.com` |
| **Connection name** | `Buffer` *(must contain `buffer` for auto-discovery)* |
| **Access token** | Their Buffer API key |
| **Authentication method** | `Header` (`Bearer`) |

---

## 4. Verify End-to-End Inside the Sprite

`agent/lib/buffer.ts` (used by `agent/extensions/social-channels.ts`, `x-twitter.ts`, `tiktok.ts`, and `instagram.ts`) auto-discovers the `Buffer` connector and all connected channels at runtime. `social_list_channels` returns each channel's `id` (plus `name`/`displayName`/`service`), and `x_post`, `tiktok_post`, and `instagram_post` default to `saveToDraft: true` so nothing publishes publicly without human approval. Verify with a read-only call:

```bash
sprite exec -- omp -e /home/sprite/.omp/agent/extensions/social-channels.ts --tools social_list_channels -p "Use social_list_channels and list my connected channels." --no-session
```
