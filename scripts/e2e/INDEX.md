# E2E Agent Index — How to Talk to Professor L Programmatically (Multi-Turn)

Read this file first in any fresh coding-agent session before running E2E tests against Sprite **`lma`**. No trial-and-error needed — pick **Method A** (CLI multi-turn) or **Method B** (Web UI HTTP/SSE against live `omp --mode rpc --no-ui`).

---

## Method A — Directory-Scoped Multi-Turn CLI (`omp -p`, Recommended for Playbooks 01–04)

`agent/config.yml` sets `autoResume: true`. Every `omp -p "..."` command run in the **same working directory** automatically continues that exact conversation thread (preserving full history + tool calls).

### Multi-Turn Example
```bash
# Turn 1 — creates a new session bound to /home/sprite/e2e-run1
sprite exec -- bash -c 'mkdir -p /home/sprite/e2e-run1 && cd /home/sprite/e2e-run1 && omp -p "Turn 1 message here"'

# Turn 2 — resumes the exact same conversation automatically
sprite exec -- bash -c 'cd /home/sprite/e2e-run1 && omp -p "Turn 2 follow-up here"'

# Turn 3 — continues again
sprite exec -- bash -c 'cd /home/sprite/e2e-run1 && omp -p "Turn 3 confirmation here"'
```

### Useful CLI Controls
- **Stateless 1-shot test** *(does not create/pollute a session)*:
  ```bash
  sprite exec -- omp -p "reply with just: OK" --no-session
  ```
- **Force a fresh thread in an existing directory** *(via `agent/extensions/new-session.ts`)*:
  ```bash
  sprite exec -- bash -c 'cd /home/sprite/e2e-run1 && omp --new -p "Fresh conversation"'
  ```
- **Restrict to specific tools for isolated extension testing:**
  ```bash
  sprite exec -- omp --tools buffer_list_channels,youtube_tool -p "..." --no-session
  ```
- **Inspect exact tool calls & JSONL session transcript after a run:**
  ```bash
  sprite exec -- bash -c '
  LATEST=$(ls -t /home/sprite/.omp/agent/sessions/*/*.jsonl | head -n 1)
  echo "SESSION: $LATEST"
  grep -oE "\"toolName\":\"[^\"]+\"" "$LATEST" | sort | uniq -c
  '
  ```

---

## Method B — Live Web UI HTTP/SSE API (`lma-web` Port 8080, Recommended for Playbook 05 & Web UI Tests)

`lma-web` wraps one persistent `omp --mode rpc --no-ui` subprocess over JSONL stdin/stdout and exposes authenticated HTTP + SSE endpoints on `http://127.0.0.1:8080` (inside the Sprite) and `https://lma-bicns.sprites.app` (public HTTPS).

### Complete Multi-Turn Script (Login → New Chat → Send Turn 1 → Wait → Send Turn 2)
```bash
sprite exec -- bash -c '
PASS=$(grep ^LMA_WEB_PASSWORD= /home/sprite/.config/lma/web.env | cut -d= -f2- | tr -d "\r\n")
curl -s -c /tmp/e2e_ck.txt -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" -d "{\"password\":\"${PASS}\"}" >/dev/null

# Start a clean web chat session
curl -s -b /tmp/e2e_ck.txt -X POST http://127.0.0.1:8080/api/new >/dev/null

send_and_wait() {
  local msg="$1"
  curl -s -b /tmp/e2e_ck.txt -X POST http://127.0.0.1:8080/api/chat \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg m "$msg" "{message: \$m}")" >/dev/null
  for i in $(seq 1 60); do
    sleep 2
    local busy
    busy=$(curl -s -b /tmp/e2e_ck.txt http://127.0.0.1:8080/api/messages | jq -r ".busy")
    if [ "$busy" = "false" ]; then break; fi
  done
  curl -s -b /tmp/e2e_ck.txt http://127.0.0.1:8080/api/messages | jq -r ".messages[-1].text"
}

echo "=== TURN 1 ==="
send_and_wait "Hello Prof! Reply in 1 sentence."
echo "=== TURN 2 ==="
send_and_wait "Now summarize what I just asked."

rm -f /tmp/e2e_ck.txt
'
```

### Other Authenticated Endpoints
- `GET /api/messages` — `{ messages: [{ role, text, thinking }], busy, activity }`
- `GET /api/events` — SSE stream (`status`, `activity`, `tool_start`, `tool_end`, `thinking_delta`, `text_delta`, `assistant_end`, `done`, `session_changed`)
- `GET /api/sessions` & `POST /api/sessions/switch` (`{"path":"..."}`)
- `POST /api/abort` — interrupt an active turn
- `GET /api/dossier` — live `/home/sprite/.omp/agent/MEMORY.md`
- `GET /api/connectors` — live zero-key Sprites Connectors list
- `GET /api/clips` — live raw `.mp4`/`.srt` clips in `/home/sprite/clips/`

---

## Method C — Direct `omp --mode rpc --no-ui` JSONL Protocol (Low-Level Reference)

If you ever need to probe `omp`'s raw JSONL RPC protocol directly without `lma-web`:
```bash
sprite exec -- bash -c '
printf "{\"id\":\"1\",\"type\":\"get_state\"}\n{\"id\":\"2\",\"type\":\"prompt\",\"message\":\"reply with just: OK\"}\n" \
  | timeout 25 omp --mode rpc --no-ui --no-session
'
```
- **Commands (JSONL on stdin):** `get_state`, `get_messages`, `prompt` (`{ message }`), `abort`, `new_session`, `switch_session` (`{ sessionPath }`).
- **Key Events (JSONL on stdout):** `ready`, `response`, `agent_start`, `tool_execution_start`, `tool_execution_end`, `message_update` (`thinking_delta`, `text_delta`), `agent_end` / `session_settled`.

---

## Playbooks & Deterministic Pre-Flight
1. **Fast deterministic suite (~11s):** `bash scripts/verify-all.sh` (`--live` for live connector round-trip)
2. **Checkpoint Time-Travel Wrapper & Playbook Index:** [`scripts/e2e/README.md`](README.md)
3. **Golden Reference Dossier:** [`scripts/e2e/expected-memory.md`](expected-memory.md)
4. **Feature Playbooks:**
   - [`01-onboarding.md`](01-onboarding.md)
   - [`02-youtube-audit-and-squint-test.md`](02-youtube-audit-and-squint-test.md)
   - [`03-social-promo-buffer-drafts.md`](03-social-promo-buffer-drafts.md)
   - [`04-vod-hype-clipper-and-review.md`](04-vod-hype-clipper-and-review.md)
   - [`05-qstash-proactive-wakeup.md`](05-qstash-proactive-wakeup.md)
