# Agent Setup Guide: Proactive Self-Scheduling via Upstash QStash + Sprites Custom API Connector

> **Audience:** AI coding agent setting up `lma` for a user. Execute CLI steps directly; only ask the human for Upstash QStash credentials if not already in `.env`.

Because Fly.io Sprites sleep at $0 when idle, `lma` uses **Upstash QStash** (free tier: 1,000 messages/day) so Otto can autonomously schedule future one-shot or recurring wake-up jobs. When the scheduled time hits, QStash sends a cryptographically signed `POST /api/wakeup` request that wakes the Sprite in <1s and injects the scheduled prompt into Otto.

---

## 1. Check if Already Connected

```bash
sprite exec -- bash -c 'curl -s https://api.sprites.dev/v1/gateway/list | jq ".connections[] | select(.provider==\"custom_api\" and (.display_name | test(\"qstash\"; \"i\"))) | .gateway_base_url"'
```

---

## 2. Obtain QStash Credentials (Only if Missing)

Check if `.env` already has `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY` (never print or commit them). If missing, ask the human to create a free Upstash QStash account and copy those 4 values into `.env`.

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
