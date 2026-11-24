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

# 1b. Install ffmpeg and yt-dlp for VOD/clip/transcript workflows
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "==> Installing ffmpeg..."
  sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends ffmpeg
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "==> Installing latest yt-dlp..."
  mkdir -p "${HOME}/.local/bin"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${HOME}/.local/bin/yt-dlp"
  chmod +x "${HOME}/.local/bin/yt-dlp"
fi

# 2. Symlink agent persona, config, and extensions
mkdir -p "${OMP_AGENT_DIR}/extensions"
ln -sf "${REPO_DIR}/agent/APPEND_SYSTEM.md" "${OMP_AGENT_DIR}/APPEND_SYSTEM.md"
ln -sf "${REPO_DIR}/agent/config.yml" "${OMP_AGENT_DIR}/config.yml"
for ext in "${REPO_DIR}"/agent/extensions/*.ts; do
  [ -e "$ext" ] && ln -sf "$ext" "${OMP_AGENT_DIR}/extensions/$(basename "$ext")"
done
if [ -d "${REPO_DIR}/agent/skills" ]; then
  mkdir -p "${OMP_AGENT_DIR}/skills"
  for skill in "${REPO_DIR}"/agent/skills/*; do
    [ -e "$skill" ] && ln -sf "$skill" "${OMP_AGENT_DIR}/skills/$(basename "$skill")"
  done
fi

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

# 5. Build Vue 3 + Vite frontend & register durable Sprite HTTP service (port 8080)
if [ -f "${REPO_DIR}/web/package.json" ]; then
  echo "==> Building lma-web frontend..."
  (cd "${REPO_DIR}/web" && /.sprite/bin/bun install --frozen-lockfile 2>/dev/null || /.sprite/bin/bun install)
  (cd "${REPO_DIR}/web" && /.sprite/bin/bun run build)
fi
if command -v sprite-env >/dev/null 2>&1 && [ -f "${REPO_DIR}/web/server.ts" ]; then
  echo "==> Registering lma-web service on port 8080..."
  sprite-env services delete lma-web >/dev/null 2>&1 || true
  sprite-env services create lma-web \
    --cmd /.sprite/bin/bun \
    --args "run,${REPO_DIR}/web/server.ts" \
    --http-port 8080 \
    --dir "${HOME}"
fi

echo "==> Done! Open your Sprite HTTPS URL for Web Chat UI, or run: omp"
