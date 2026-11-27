# Agent Setup Guide: Proactive Self-Scheduling via Upstash QStash + Sprites Custom API Connector

> **Audience:** AI coding agent setting up `lma` for a user. Execute CLI steps directly; only ask the human for Upstash QStash credentials if they are not already exported in your shell. Signing keys belong in the Sprite's `~/.config/lma/web.env` (see §4), **not** the repo `.env`.

Because Fly.io Sprites sleep at $0 when idle, `lma` uses **Upstash QStash** (free tier: 1,000 messages/day) so Otto can autonomously schedule future one-shot or recurring wake-up jobs. When the scheduled time hits, QStash sends a cryptographically signed `POST /api/wakeup` request that wakes the Sprite in <1s and injects the scheduled prompt into Otto.

---

## 1. Check if Already Connected

```bash
sprite exec -- bash -c 'curl -s https://api.sprites.dev/v1/gateway/list | jq ".connections[] | select((.provider==\"qstash\") or (.provider==\"custom_api\" and (.display_name | test(\"qstash\"; \"i\")))) | .gateway_base_url"'
```

---

## 2. Obtain QStash Credentials (Only if Missing)

You need four values, and they are read from **two different places**:
- **`QSTASH_URL` + `QSTASH_TOKEN`** — only used once, by the `sprite api` provisioning call below. **Export them in your shell** for that command; no application code reads them later.
- **`QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY`** — read at runtime by `web/server.ts` to verify inbound webhooks, so they must live in `/home/sprite/.config/lma/web.env` on the Sprite (see §4).

Never print or commit any of them. If missing, ask the human to create a free Upstash QStash account and copy the 4 values, then export the first two:
```bash
export QSTASH_URL=https://qstash-....upstash.io
export QSTASH_TOKEN=...
```

---

## 3. Provision the QStash Custom API Connector via `sprite api`

Run from a directory **without** a `.sprite` file (e.g. `/tmp` or `C:\Windows\Temp`):

```bash
cd /tmp
sprite api /oauth/connections/custom_api -- -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QStash",
    "base_api_url": "'"${QSTASH_URL%/}"'",
    "access_token": "'"$QSTASH_TOKEN"'",
    "auth_method": "header",
    "auth_header_prefix": "Bearer",
    "description": "Upstash QStash for agent self-scheduled wake-up jobs and recurring crons",
    "access_policy": { "allow_all": true }
  }'
```

---

## 4. Configure Webhook Verification & Web Passcode on the Sprite

Because QStash must reach `https://<sprite>.sprites.app/api/wakeup`, configure:
1. `/home/sprite/.config/lma/web.env` (`chmod 600`, outside git) with:
   - `LMA_PUBLIC_URL=https://<your-sprite>.sprites.app`
   - `LMA_WEB_PASSWORD=<strong-passcode>` (protects the Web Chat UI with an `HttpOnly` signed session cookie)
   - `QSTASH_CURRENT_SIGNING_KEY=...` and `QSTASH_NEXT_SIGNING_KEY=...` (verifies `Upstash-Signature` HS256 JWT + SHA-256 body hash on `/api/wakeup`)
2. Set the Sprite URL to public so QStash can deliver signed webhooks:
   ```bash
   sprite url update --auth public
   ```

---

## 5. Verify End-to-End

Ask Otto in the Web Chat UI:
> *"Schedule a wake-up 30 seconds from now to remind me to check my microphone."*

Confirm QStash delivers the signed `POST /api/wakeup` and Otto posts the proactive reminder automatically in the chat.

### Recurring & silent wake-ups

- **Recurring jobs** use `schedule_wakeup` with a cron expression. Prefix it with `CRON_TZ=<IANA zone>` so "every Monday 20:00" means the talent's local time, e.g. `CRON_TZ=Asia/Jakarta 0 20 * * 1` (invalid zones are rejected before publishing).
- **Silent / background jobs** (`mode: "background"`) run the agent turn without posting a chat message — used for nightly reflection and other housekeeping. Pass `silent: true` (or `mode: "background"`) plus a `jobType` when you don't want a visible chat reply.
