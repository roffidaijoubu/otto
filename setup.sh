#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OMP_AGENT_DIR="${HOME}/.omp/agent"
OMP_PKG_VERSION="19.1.1"

echo "==> Setting up lma (Otto Livestreamer Manager Agent) on Sprite..."

# 0. Preflight check for required base tools
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for passcode generation and VOD clip scripts. Install python3 and re-run." >&2
  exit 1
fi

# 1. Install pinned omp if not present
if ! command -v omp >/dev/null 2>&1 && [ ! -x "${HOME}/.local/bin/omp" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm is required to install @oh-my-pi/pi-coding-agent. Install Node.js/npm and re-run." >&2
    exit 1
  fi
  echo "==> Installing @oh-my-pi/pi-coding-agent@${OMP_PKG_VERSION}..."
  npm install -g "@oh-my-pi/pi-coding-agent@${OMP_PKG_VERSION}"
  mkdir -p "${HOME}/.local/bin"
  ln -sf "$(npm prefix -g)/bin/omp" "${HOME}/.local/bin/omp"
fi

# 1b. Install jq, ffmpeg, and yt-dlp for gateway discovery & VOD/clip workflows
if ! command -v jq >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: jq and ffmpeg are required, and apt-get is unavailable. Install jq and ffmpeg manually and re-run." >&2
    exit 1
  fi
  echo "==> Installing jq and ffmpeg..."
  SUDO=""; command -v sudo >/dev/null 2>&1 && SUDO="sudo"
  ${SUDO} apt-get update -qq && ${SUDO} apt-get install -y -qq --no-install-recommends jq ffmpeg
fi

if ! command -v yt-dlp >/dev/null 2>&1 && [ ! -x "${HOME}/.local/bin/yt-dlp" ]; then
  echo "==> Installing yt-dlp..."
  mkdir -p "${HOME}/.local/bin"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${HOME}/.local/bin/yt-dlp"
  chmod +x "${HOME}/.local/bin/yt-dlp"
fi

# 2. Symlink agent persona, config, extensions, and skills
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

# 2b. Ensure Unified Studio Workspace folders exist (and migrate legacy ~/clips once)
mkdir -p "${HOME}/workspace/clips" "${HOME}/workspace/thumbnails" "${HOME}/workspace/scripts" \
  "${HOME}/workspace/briefs" "${HOME}/workspace/uploads" "${HOME}/workspace/exports"
if [ -d "${HOME}/clips" ] && [ ! -L "${HOME}/clips" ]; then
  cp -rn "${HOME}/clips/." "${HOME}/workspace/clips/" 2>/dev/null || true
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
    echo "WARNING: No authorized Gemini Sprites Connector found. Add Google Gemini in Sprites Dashboard and re-run bash ~/lma/setup.sh."
  fi
fi

# 5. Ensure fail-closed Web UI passcode exists in ~/.config/lma/web.env (chmod 600)
WEB_ENV_DIR="${HOME}/.config/lma"
WEB_ENV_FILE="${WEB_ENV_DIR}/web.env"
mkdir -p "${WEB_ENV_DIR}"
if [ ! -f "${WEB_ENV_FILE}" ] || ! grep -q '^LMA_WEB_PASSWORD=' "${WEB_ENV_FILE}"; then
  GEN_PASS=$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')
  echo "LMA_WEB_PASSWORD=${GEN_PASS}" >> "${WEB_ENV_FILE}"
  chmod 600 "${WEB_ENV_FILE}"
  echo "==> Generated Web Chat UI passcode in ${WEB_ENV_FILE} (chmod 600). View it with: cat ${WEB_ENV_FILE}"
fi

# 6. Build Vue 3 + Vite frontend & register durable Sprite HTTP service (port 8080)
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

# 7. One-time auto-bootstrap Draft Talent Dossier from connected OAuth accounts (if MEMORY.md is still blank)
if [ "${LMA_SKIP_BOOTSTRAP:-0}" != "1" ] && [ -f "${REPO_DIR}/scripts/bootstrap-dossier.sh" ]; then
  bash "${REPO_DIR}/scripts/bootstrap-dossier.sh" || true
fi

echo "==> Done! Open your Sprite HTTPS URL for Web Chat UI, or run: omp"
