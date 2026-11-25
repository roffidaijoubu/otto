#!/usr/bin/env bash
set -euo pipefail

# Installs the local git post-commit hook that auto-refreshes the clean
# `initialized: <sha>` Fly.io Sprite checkpoint on every commit.
# Usage: bash scripts/install-hooks.sh

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="${REPO_ROOT}/.git/hooks/post-commit"

cat > "${HOOK_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
if [ -f "${REPO_ROOT}/scripts/sync-initialized-checkpoint.sh" ]; then
  bash "${REPO_ROOT}/scripts/sync-initialized-checkpoint.sh"
fi
EOF

chmod +x "${HOOK_PATH}"
echo "[lma] Installed post-commit hook -> ${HOOK_PATH}"
echo "      (Bypass for docs-only commits with: LMA_SKIP_CHECKPOINT=1 git commit ...)"
