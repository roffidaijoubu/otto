# Agent Setup Guide: YouTube via Composio v3 + Sprites Custom API Connector

> **Audience:** AI coding agent setting up `lma` for a user. Execute the CLI steps directly; only interrupt the human for the OAuth click and Project API Key (`ak_...`).

`lma` accesses YouTube (channel stats, recent videos, metadata, captions, and human-approved packaging updates) through a **Fly.io Sprites Custom API Connector** pointing at Composio v3 — with **zero API keys or OAuth tokens stored inside the Sprite**.

> **Why Custom API instead of Sprites' built-in Composio connector?**
> Sprites' built-in Composio validator currently rejects Composio's v3.1 tool catalog response (`"Composio returned an unexpected tool catalog"`). Using a Sprites **Custom API Connector** routes through the same encrypted Sprites Gateway and works immediately against Composio v3.

---

## 1. Check if Already Connected

Run inside the Sprite first — skip setup if a `composio` connector already exists:

```bash
sprite exec -- bash -c 'curl -s https://api.sprites.dev/v1/gateway/list | jq ".connections[] | select((.provider==\"composio\") or (.provider==\"custom_api\" and (.display_name | test(\"composio\"; \"i\")))) | .gateway_base_url"'
```

---

## 2. Collect Prerequisites From the Human (Only if Missing)

Ask the human to do **only** these two things if they haven't already:
1. In [dashboard.composio.dev](https://dashboard.composio.dev), select their **Project** (not Organization settings) → **Auth Configs** → create a **YouTube** Managed OAuth2 Auth Config → click **+ Connect Account** and authorize their YouTube channel (status must be **Active**). Also authorize **Google Calendar** in Composio (in the same Project) so `calendar_sync_google` / two-way calendar sync works out of the box.
2. In the same Project → **API Keys** → create a **Project API Key** (`ak_...`, **not** an org/user key `uak_...`) and **export it in your shell** for the provisioning command: `export COMPOSIO_API_KEY=ak_...` (or `set -a; . ./.env; set +a` — the repo `.env` is not auto-loaded at runtime).

---

## 3. Provision the Connector via `sprite api` (Primary Method)

Run from a directory **without** a `.sprite` file (e.g. `/tmp` on Linux/macOS, `/c/Windows/Temp` on Windows) so `sprite api` targets the org-level `/v1/` endpoint instead of `/v1/sprites/<name>/`:

```bash
cd /tmp
sprite api /oauth/connections/custom_api -- -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Composio v3",
    "base_api_url": "https://backend.composio.dev",
    "access_token": "'"$COMPOSIO_API_KEY"'",
    "auth_method": "custom_header",
    "auth_custom_header_name": "x-api-key",
    "test_url": "https://backend.composio.dev/api/v3/connected_accounts?limit=1",
    "access_policy": { "allow_all": true }
  }'
```

### Fallback (Only if `sprite api` fails)

If the command above fails, tell the human to add it manually in the [Fly.io Sprites Dashboard](https://sprites.dev) (**Connectors → Add connector → Custom API**) with these exact fields and grant access to the `lma` Sprite:

| Field | Value |
| :--- | :--- |
| **Base API URL** | `https://backend.composio.dev` |
| **Connection name** | `Composio v3` *(must contain `composio` for auto-discovery)* |
| **Access token** | Their `ak_...` Composio Project API Key |
| **Authentication method** | `Custom header` → Header name: `x-api-key` |
| **Test URL** | `https://backend.composio.dev/api/v3/connected_accounts?limit=1` |

---

## 4. Verify End-to-End Inside the Sprite

`agent/extensions/composio-youtube.ts` auto-discovers the gateway URL, active YouTube `connected_account_id`, and `user_id` at runtime. Verify with a read-only call:

```bash
sprite exec -- omp -e /home/sprite/.omp/agent/extensions/composio-youtube.ts --tools youtube_list_tools -p "Use youtube_list_tools and list available YouTube tool slugs." --no-session
```
