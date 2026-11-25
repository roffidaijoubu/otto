# E2E Playbook 05 — Proactive Self-Scheduling Wake-Up (Upstash QStash + Tasks API)

**Goal:** Verify that Professor L can schedule his own future wake-up via the zero-key Upstash QStash Custom API Connector, that unsigned `POST /api/wakeup` requests are rejected (`401`), and that QStash's cryptographically signed webhook wakes the Sprite, acquires the `/.sprite/api.sock` Tasks API hold, and triggers a proactive message visible in Web Chat UI (`/api/messages`).

---

## Steps

### 1. Confirm Unsigned Spoof Rejection (`401`)
```bash
# Replace with your Sprite URL from `sprite info` (or LMA_PUBLIC_URL)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<your-sprite>.sprites.app/api/wakeup" \
  -H "Content-Type: application/json" \
  -d '{"label":"spoof","prompt":"hack"}'
```
Expected: **`401`**

### 2. Ask Professor L to Schedule a 10-Second Wake-Up
```bash
sprite exec -- omp --tools schedule_wakeup -p "Schedule a one-shot wake-up in 10 seconds labeled 'E2E Wakeup Check' with prompt: 'Reply with just: PROACTIVE_WAKEUP_E2E_OK'" --no-session
```

### 3. Wait ~20 Seconds & Verify Proactive Reply in Web Chat (`/api/messages`)
```bash
sleep 20
sprite exec -- bash -c '
PASS=$(grep ^LMA_WEB_PASSWORD= /home/sprite/.config/lma/web.env | cut -d= -f2- | tr -d "\r\n")
curl -s -c /tmp/w_ck.txt -X POST http://127.0.0.1:8080/api/auth/login -H "Content-Type: application/json" -d "{\"password\":\"${PASS}\"}" >/dev/null
curl -s -b /tmp/w_ck.txt http://127.0.0.1:8080/api/messages | jq ".messages[-2:]"
rm -f /tmp/w_ck.txt
'
```

### 4. Semantic Pass Criteria
- [ ] Unsigned `POST /api/wakeup` returned `401`.
- [ ] `schedule_wakeup` returned a valid QStash `messageId` (zero local QStash tokens inside VM).
- [ ] `/api/messages` contains `[SCHEDULED WAKE-UP: E2E Wakeup Check]` followed by Professor L's proactive reply **`PROACTIVE_WAKEUP_E2E_OK`**.
