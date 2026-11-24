#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OMP_AGENT_DIR="${HOME}/.omp/agent"

echo "==> Setting up lma (Professor L Livestreamer Manager Agent) on Sprite..."

# 1. Install omp if not present
if ! command -v omp >/dev/null 2>&1; then
  echo "==> Installing @oh-my-pi/pi-coding-agent..."
  npm install -g @oh-my-pi/pi-coding-agent
  mkdir -p "${HOME}/.local/bin"
  ln -sf "$(npm prefix -g)/bin/omp" "${HOME}/.local/bin/omp"
fi

# 2. Symlink agent persona, config, and extensions
mkdir -p "${OMP_AGENT_DIR}/extensions"
ln -sf "${REPO_DIR}/agent/APPEND_SYSTEM.md" "${OMP_AGENT_DIR}/APPEND_SYSTEM.md"
ln -sf "${REPO_DIR}/agent/config.yml" "${OMP_AGENT_DIR}/config.yml"
for ext in "${REPO_DIR}"/agent/extensions/*.ts; do
  [ -e "$ext" ] && ln -sf "$ext" "${OMP_AGENT_DIR}/extensions/$(basename "$ext")"
done

# 3. Initialize persistent MEMORY.md if absent
if [ ! -f "${OMP_AGENT_DIR}/MEMORY.md" ]; then
  cp "${REPO_DIR}/agent/MEMORY.md.example" "${OMP_AGENT_DIR}/MEMORY.md"
  echo "==> Initialized ${OMP_AGENT_DIR}/MEMORY.md"
fi

# 4. Auto-configure Google Gemini Sprites Connector in models.yml if absent
if [ ! -f "${OMP_AGENT_DIR}/models.yml" ]; then
  GEMINI_URL=$(curl -s https://api.sprites.dev/v1/gateway/list | jq -r '.connections[] | select(.provider=="gemini") | .gateway_base_url' | head -n 1 || true)
  if [ -n "${GEMINI_URL}" ] && [ "${GEMINI_URL}" != "null" ]; then
    cat > "${OMP_AGENT_DIR}/models.yml" <<EOF
providers:
  google:
    baseUrl: ${GEMINI_URL}/v1beta
    apiKey: sprite-gateway
EOF
    echo "==> Configured ${OMP_AGENT_DIR}/models.yml with Gemini Sprites Connector"
  else
    echo "WARNING: No authorized Gemini Sprites Connector found. Copy agent/models.yml.example to ${OMP_AGENT_DIR}/models.yml manually."
  fi
fi

echo "==> Done! Launch your personal agent with: omp"
