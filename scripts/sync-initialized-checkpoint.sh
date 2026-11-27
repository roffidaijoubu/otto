#!/usr/bin/env bash
set -euo pipefail

NO_MEMORY="${LMA_NO_MEMORY:-0}"
CLEAN_WORKSPACE="${LMA_CLEAN_WORKSPACE:-0}"
for arg in "$@"; do
  case "$arg" in
    --no-memory)
      NO_MEMORY="1"
      ;;
    --clean-workspace)
      CLEAN_WORKSPACE="1"
      ;;
  esac
done

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

# Determine MEMORY.md seed source:
# - Default: local gitignored agent/MEMORY.md (fallback to scripts/e2e/expected-memory.md, then blank template)
# - --no-memory (for E2E onboarding): blank agent/MEMORY.md.example
SEED_MEMORY_LOCAL="agent/MEMORY.md.example"
SEED_LABEL="blank"
if [ "${NO_MEMORY}" != "1" ]; then
  if [ -f "agent/MEMORY.md" ]; then
    SEED_MEMORY_LOCAL="agent/MEMORY.md"
    SEED_LABEL="seeded (agent/MEMORY.md)"
  elif [ -f "scripts/e2e/expected-memory.md" ]; then
    SEED_MEMORY_LOCAL="scripts/e2e/expected-memory.md"
    SEED_LABEL="seeded (expected-memory.md)"
  fi
fi

COMMENT="${SHA} | initialized [${SEED_LABEL}] — ${MSG}"
echo "[lma-checkpoint] Syncing repo (${SHA}) to Sprite (${SEED_LABEL})..."

# 0. Protect live prod data: if MEMORY.md on Sprite differs from both the blank template and current seed, snapshot it first!
HAS_LIVE_DATA="$(sprite exec -- bash -c '
if [ -f /home/sprite/.omp/agent/MEMORY.md ]; then
  if [ -f /home/sprite/lma/agent/MEMORY.md.example ] && cmp -s /home/sprite/.omp/agent/MEMORY.md /home/sprite/lma/agent/MEMORY.md.example; then
    echo "clean"
  elif [ -f /home/sprite/lma/scripts/e2e/expected-memory.md ] && cmp -s /home/sprite/.omp/agent/MEMORY.md /home/sprite/lma/scripts/e2e/expected-memory.md; then
    echo "clean"
  else
    echo "modified"
  fi
else
  echo "clean"
fi
' 2>/dev/null | tr -d "\r\n" || echo "clean")"
if [ "${HAS_LIVE_DATA}" = "modified" ]; then
  echo "[lma-checkpoint] Live MEMORY.md detected — creating safety backup checkpoint first..."
  sprite checkpoint create --comment "prod: auto-backup before ${SHA}"
fi

# 1. Record existing initialized checkpoints (both legacy 'initialized:' and '<sha> | initialized') so we only prune old baselines
OLD_INIT_IDS="$(sprite checkpoint list 2>/dev/null | awk '$0 ~ /(initialized:| \| initialized )/ { print $1 }' || true)"

# 2. Sync tracked files (excluding node_modules, dist, .git, .docs, .tests, agent/models.yml)
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
      /home/sprite/.omp/agent/extensions /home/sprite/.omp/agent/skills \
      /home/sprite/.omp/agent/calendar.json* /home/sprite/.omp/agent/studio.db* /home/sprite/.omp/agent/mnemopi.db* \
      /home/sprite/.omp/agent/studio-apps
    if [ "'"${CLEAN_WORKSPACE}"'" = "1" ]; then
      rm -rf /home/sprite/workspace
    fi
    mkdir -p /home/sprite/.omp/agent
  '

# 2b. Seed /home/sprite/.omp/agent/MEMORY.md from chosen local file (gitignored agent/MEMORY.md by default, or blank with --no-memory)
sprite exec --stdin -- bash -c 'cat > /home/sprite/.omp/agent/MEMORY.md' < "${SEED_MEMORY_LOCAL}"

# 2c. Run setup.sh (skipping OAuth bootstrap when blank/E2E or already seeded) and verify health
sprite exec -- bash -c '
  set -e
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
