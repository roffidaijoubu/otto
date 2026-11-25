#!/usr/bin/env bash
set -euo pipefail

# End-to-end feature verification suite for `lma` on Fly.io Sprite.
# Usage:
#   bash scripts/verify-all.sh          # Fast deterministic suite (~10s)
#   bash scripts/verify-all.sh --live   # Full suite including live zero-key LLM + Buffer connector test

MODE="fast"
if [ "${1:-}" = "--live" ]; then
  MODE="live"
fi

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

echo "=== lma Feature Verification Suite (mode: ${MODE}) ==="

echo ""
echo "1. Local Web Typecheck & Build"
if (cd web && npm run typecheck >/dev/null 2>&1 && npm run build >/dev/null 2>&1); then
  ok "web/ tsc --noEmit + vite build"
else
  fail "web/ typecheck or build failed"
fi

echo ""
echo "2. Sprite Runtime, Symlinks, Python Clipper, Tasks API & Security Gates"
REMOTE_OUT=$(sprite exec -- bash -c '
echo "CHECK_SKILLS:$(ls /home/sprite/.omp/agent/skills/ | tr "\n" ",")"
echo "CHECK_EXTS:$(ls /home/sprite/.omp/agent/extensions/ | tr "\n" ",")"
python3 -m py_compile /home/sprite/.omp/agent/skills/raw-clip-finder/scripts/*.py && echo "CHECK_PY:OK"

# Tasks API keep-alive hold
/.sprite/bin/bun -e '\''
const r1 = await fetch("http://sprite/v1/tasks/lma-verify-hold", {
  unix: "/.sprite/api.sock", method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ expire: "1m" }),
});
const r2 = await fetch("http://sprite/v1/tasks/lma-verify-hold", {
  unix: "/.sprite/api.sock", method: "DELETE",
});
console.log("CHECK_TASKS:" + r1.status + ":" + r2.status);
'\''

# Health & unauthenticated security checks
HEALTH_OK=$(curl -s http://127.0.0.1:8080/api/health | jq -r ".ok")
echo "CHECK_HEALTH:${HEALTH_OK}"

UNAUTH_DOSSIER=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/dossier)
echo "CHECK_UNAUTH_DOSSIER:${UNAUTH_DOSSIER}"

SPOOF_WAKEUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/api/wakeup -H "Content-Type: application/json" -d "{\"label\":\"spoof\",\"prompt\":\"hi\"}")
echo "CHECK_SPOOF_WAKEUP:${SPOOF_WAKEUP}"

# Authenticated Mission Control & path-traversal checks
PASS=$(grep ^LMA_WEB_PASSWORD= /home/sprite/.config/lma/web.env | cut -d= -f2- | tr -d "\r\n")
curl -s -c /tmp/lma_v_cookie.txt -X POST http://127.0.0.1:8080/api/auth/login -H "Content-Type: application/json" -d "{\"password\":\"${PASS}\"}" >/dev/null

DOSSIER_EXISTS=$(curl -s -b /tmp/lma_v_cookie.txt http://127.0.0.1:8080/api/dossier | jq -r ".exists")
echo "CHECK_DOSSIER:${DOSSIER_EXISTS}"
CONN_INFO=$(curl -s -b /tmp/lma_v_cookie.txt http://127.0.0.1:8080/api/connectors | jq -r "[(.connectors|length), .zeroLocalKeys, .aiMediaDisabled] | map(tostring) | join(\":\")")
echo "CHECK_CONNECTORS:${CONN_INFO}"

CLIPS_TYPE=$(curl -s -b /tmp/lma_v_cookie.txt http://127.0.0.1:8080/api/clips | jq -r ".clips | type")
echo "CHECK_CLIPS:${CLIPS_TYPE}"

SESS_TYPE=$(curl -s -b /tmp/lma_v_cookie.txt http://127.0.0.1:8080/api/sessions | jq -r ".sessions | type")
echo "CHECK_SESSIONS:${SESS_TYPE}"

TRAV_SESS=$(curl -s -b /tmp/lma_v_cookie.txt -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/api/sessions/switch -H "Content-Type: application/json" -d "{\"path\":\"/etc/passwd\"}")
echo "CHECK_TRAV_SESS:${TRAV_SESS}"

TRAV_CLIP=$(curl -s --path-as-is -b /tmp/lma_v_cookie.txt -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/clips/file/../../etc/passwd)
echo "CHECK_TRAV_CLIP:${TRAV_CLIP}"

rm -f /tmp/lma_v_cookie.txt
' 2>&1 || true)

check_grep() {
  local label="$1"
  local pattern="$2"
  if echo "$REMOTE_OUT" | grep -qE "$pattern"; then
    ok "$label"
  else
    fail "$label (expected pattern: $pattern)"
  fi
}

check_grep "All 5 skills symlinked" "CHECK_SKILLS:.*onboarding.*raw-clip-finder.*social-promo.*stream-planner.*youtube-audit"
check_grep "All 8 extensions symlinked" "CHECK_EXTS:.*buffer-gateway\.ts.*composio-youtube\.ts.*exa-gateway\.ts.*firecrawl-gateway\.ts.*media-reviewer\.ts.*new-session\.ts.*qstash-scheduler\.ts.*vod-clipper\.ts"
check_grep "Python clipper scripts compile cleanly" "CHECK_PY:OK"
check_grep "Tasks API keep-alive hold (PUT 200 / DELETE 204)" "CHECK_TASKS:200:204"
check_grep "GET /api/health returns ok:true" "CHECK_HEALTH:true"
check_grep "Unauthenticated /api/dossier blocked (401)" "CHECK_UNAUTH_DOSSIER:401"
check_grep "Unsigned spoofed /api/wakeup blocked (401)" "CHECK_SPOOF_WAKEUP:401"
check_grep "Authenticated /api/dossier readable" "CHECK_DOSSIER:true"
check_grep "Authenticated /api/connectors live (zeroLocalKeys=true, aiMediaDisabled=true)" "CHECK_CONNECTORS:[1-9][0-9]*:true:true"
check_grep "Authenticated /api/clips returns array" "CHECK_CLIPS:array"
check_grep "Authenticated /api/sessions returns array" "CHECK_SESSIONS:array"
check_grep "Session switch path traversal blocked (400)" "CHECK_TRAV_SESS:400"
check_grep "Clip file path traversal blocked (400/404)" "CHECK_TRAV_CLIP:(400|404)"

if [ "$MODE" = "live" ]; then
  echo ""
  echo "3. Live Zero-Key Agent & Connector Smoke Tests (--live)"
  LIVE_OUT=$(sprite exec -- bash -c '
  omp --tools youtube_tool,buffer_list_channels,schedule_wakeup,vod_scan_hype,vod_cut_clip,vod_prep_clip,watch_clip,critique_thumbnail \
    -p "Call buffer_list_channels once, then reply with: LIVE_OK followed by the number of connected Buffer channels." --no-session 2>&1 || true
  ')
  if echo "$LIVE_OUT" | grep -q "LIVE_OK"; then
    ok "Live zero-key Gemini + Buffer connector tool round-trip"
  else
    fail "Live zero-key Gemini + Buffer connector round-trip"
    echo "$LIVE_OUT" | tail -n 10
  fi
fi

echo ""
echo "=== Summary: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ]
