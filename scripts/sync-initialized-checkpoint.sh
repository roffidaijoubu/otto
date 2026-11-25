#!/usr/bin/env bash
set -euo pipefail

if [ "${LMA_SKIP_CHECKPOINT:-0}" = "1" ]; then
  echo "[lma-checkpoint] Skipped (LMA_SKIP_CHECKPOINT=1)."
  exit 0
fi

if ! command -v sprite >/dev/null 2>&1; then
  echo "[lma-checkpoint] sprite CLI not found; skipping."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}"

if [ ! -f ".sprite" ]; then
  echo "[lma-checkpoint] No .sprite file in repo root; skipping."
  exit 0
fi

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'local')"
MSG="$(git log -1 --pretty=%s 2>/dev/null || echo 'manual sync')"
COMMENT="initialized: ${SHA} — ${MSG}"

echo "[lma-checkpoint] Syncing repo (${SHA}) to Sprite and resetting clean initialized state..."
# 0. Protect live prod data: if MEMORY.md on Sprite differs from MEMORY.md.example, snapshot it first!
HAS_LIVE_DATA="$(sprite exec -- bash -c '
if [ -f /home/sprite/.omp/agent/MEMORY.md ] && [ -f /home/sprite/lma/agent/MEMORY.md.example ]; then
  cmp -s /home/sprite/.omp/agent/MEMORY.md /home/sprite/lma/agent/MEMORY.md.example && echo "clean" || echo "modified"
else
  echo "clean"
fi
' 2>/dev/null | tr -d "\r\n" || echo "clean")"
if [ "${HAS_LIVE_DATA}" = "modified" ]; then
  echo "[lma-checkpoint] Live MEMORY.md detected — creating safety backup checkpoint first..."
  sprite checkpoint create --comment "prod: auto-backup before ${SHA}"
fi

# 1. Record existing 'initialized:' checkpoints so we only clean up old initialized baselines (never prod checkpoints)
OLD_INIT_IDS="$(sprite checkpoint list 2>/dev/null | awk '$4 ~ /^initialized:/ { print $1 }' || true)"

# 2. Sync tracked files (excluding node_modules, dist, .git, .docs, .tests, live MEMORY.md)
tar \
  --exclude=web/node_modules \
  --exclude=web/dist \
  --exclude=agent/MEMORY.md \
  --exclude=agent/models.yml \
  -czf - agent web docs setup.sh README.md scripts \
  | sprite exec --stdin -- bash -c '
    set -e
    sprite-env services delete lma-web >/dev/null 2>&1 || true
    rm -rf /home/sprite/lma/web /home/sprite/lma/agent/extensions /home/sprite/lma/agent/skills /home/sprite/lma/agent/lib
    mkdir -p /home/sprite/lma
    tar xzf - -C /home/sprite/lma
    rm -rf /home/sprite/.omp/agent/sessions/* /home/sprite/.omp/agent/memories/* /home/sprite/.omp/logs/* \
      /home/sprite/.omp/agent/calendar.json* /home/sprite/.omp/agent/studio.db* \
      /home/sprite/.omp/agent/learned-skills /home/sprite/workspace
    cp /home/sprite/lma/agent/MEMORY.md.example /home/sprite/.omp/agent/MEMORY.md
    LMA_SKIP_BOOTSTRAP=1 bash /home/sprite/lma/setup.sh
    curl -sf http://127.0.0.1:8080/api/health >/dev/null
  '

# 3. Create new initialized checkpoint
echo "[lma-checkpoint] Creating checkpoint: ${COMMENT}"
sprite checkpoint create --comment "${COMMENT}"

# 4. Delete previous initialized:* checkpoints only
for id in ${OLD_INIT_IDS}; do
  if [ -n "${id}" ] && [ "${id}" != "ID" ]; then
    sprite checkpoint delete "${id}" || true
  fi
done

echo "[lma-checkpoint] Active checkpoints:"
sprite checkpoint list
