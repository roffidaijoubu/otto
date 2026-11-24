# Connecting YouTube via Composio v3 + Fly.io Custom API Connector

`lma` accesses your YouTube channel (channel stats, recent uploads, video metadata, captions, and human-approved packaging updates) through a **Fly.io Sprites Custom API Connector** pointing at Composio v3 — with **zero API keys or OAuth tokens stored inside the Sprite**.

> **Why Custom API instead of the built-in Sprites Composio connector?**
> As of late 2026, Sprites' built-in Composio connector validator rejects Composio's latest v3.1 tool catalog schema (`"Composio returned an unexpected tool catalog"`). Using a Sprites **Custom API Connector** routes through the exact same encrypted Sprites Gateway with zero local credentials and works immediately against Composio v3.

---

## Step 1: Connect YouTube in Composio

1. Sign in to [dashboard.composio.dev](https://dashboard.composio.dev) and select your **Project** (not Organization settings).
2. Open **Auth Configs** in the left sidebar → create an Auth Config for **YouTube** (Composio Managed OAuth2).
3. Click **+ Connect Account** and authorize your YouTube channel. Confirm its status shows **Active**.
4. Open **API Keys** (inside the same Project) → click **+ Create API Key** to generate a **Project API Key** (`ak_...`).
   - Do **not** use an Organization/User key (`uak_...`).

---

## Step 2: Add a Custom API Connector in Fly.io Sprites

### Option A: One Command via `sprite api` (Fastest — Agent-Friendly)

Set `COMPOSIO_API_KEY` in your local shell (your `ak_...` Project API Key) and run:

```bash
sprite api /v1/oauth/connections/custom_api -X POST \
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

### Option B: Via the Fly.io Sprites Dashboard (Web UI)

1. Open your [Fly.io Sprites Dashboard](https://sprites.dev) → **Connectors → Add connector → Custom API**.
2. Fill in the form:

| Field | Value |
| :--- | :--- |
| **Base API URL** | `https://backend.composio.dev` |
| **Connection name** | `Composio v3` *(must include `composio` for auto-discovery)* |
| **Access token** | Your Composio Project API Key (`ak_...`) |
| **Authentication method** | `Custom header` |
| **Custom header name** | `x-api-key` |
| **Test URL** *(optional)* | `https://backend.composio.dev/api/v3/connected_accounts?limit=1` |

3. Click **Test connection** (should return `HTTP 200 — Connection OK`), then click **Add connector**.
4. Grant your `lma` Sprite access to the `Composio v3` connector.
---

## Step 3: Verify Inside the Sprite

`agent/extensions/composio-youtube.ts` automatically discovers both the `Composio v3` gateway URL (from `GET /v1/gateway/list`) and your active YouTube `connected_account_id` + `user_id` (from `GET /api/v3/connected_accounts`). No hardcoded IDs or `.env` files are needed.

Run a quick read-only test inside your Sprite:

```bash
sprite exec -- omp -p "Use youtube_tool to check my channel statistics and list my last 3 videos" --no-session
```
