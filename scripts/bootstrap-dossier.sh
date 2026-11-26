#!/usr/bin/env bash
set -euo pipefail

# One-time headless bootstrap: silently inspect already-connected zero-key Sprites Connectors
# (Buffer, YouTube, Google Calendar, Exa) and populate a Draft Talent Dossier in ~/.omp/agent/MEMORY.md
# so Otto already knows the creator before their very first chat message.
#
# Usage:
#   bash scripts/bootstrap-dossier.sh           # Runs only if MEMORY.md still has "(not set — run onboarding)"
#   bash scripts/bootstrap-dossier.sh --force   # Re-runs discovery even if MEMORY.md is already populated

FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

OMP_AGENT_DIR="${HOME}/.omp/agent"
MEM_FILE="${OMP_AGENT_DIR}/MEMORY.md"
MODELS_FILE="${OMP_AGENT_DIR}/models.yml"
OMP_BIN="${HOME}/.local/bin/omp"
if [ ! -x "${OMP_BIN}" ]; then
  OMP_BIN="$(command -v omp || true)"
fi

if [ -z "${OMP_BIN}" ] || [ ! -f "${MODELS_FILE}" ] || [ ! -f "${MEM_FILE}" ]; then
  echo "==> Skipping dossier bootstrap (omp, models.yml, or MEMORY.md not ready)."
  exit 0
fi

if [ "${FORCE}" -ne 1 ] && ! grep -q "(not set — run onboarding)" "${MEM_FILE}"; then
  echo "==> Dossier already populated in ${MEM_FILE}; skipping auto-bootstrap (use --force to refresh)."
  exit 0
fi

echo "==> Bootstrapping Draft Talent Dossier from connected Sprites Connectors..."
"${OMP_BIN}" --no-session \
  --tools read,write,edit,buffer_list_channels,youtube_tool,calendar_sync_google,exa_search \
  -p "Silent first-provision bootstrap task (no user is reading this reply).
1. Call buffer_list_channels (ignore errors if Buffer is not connected).
2. Call youtube_tool with slug YOUTUBE_LIST_USER_PLAYLISTS (arguments: {}) to discover the authenticated YouTube channelId and title; if found, call YOUTUBE_GET_CHANNEL_STATISTICS (arguments: {id: <channelId>}) and YOUTUBE_LIST_CHANNEL_VIDEOS (arguments: {channelId: <channelId>, maxResults: 5}). Ignore errors if YouTube is not connected.
3. Call calendar_sync_google (daysAhead: 30) to pull any existing Google Calendar commitments. Ignore errors if Google Calendar is not connected.
4. If you discovered a creator name or handle, run 1 quick exa_search query for their public bio/niche/branding.
5. Update ~/.omp/agent/MEMORY.md with a clean **Draft Talent Dossier**:
   - Fill the Profile section (Name/Persona, Niche & Core Vibe, Timezone — infer from synced Google Calendar event offsets if present, otherwise mark '(pending — ask talent)', Platforms + handles/channel ID + live subscriber/video/view baseline, Recent Uploads summary).
   - Mark Profile status clearly as '(Auto-discovered draft — verify facts, timezone & OPSEC boundaries with creator when helpful)'.
   - Leave unknown fields as '(not set)'.
   - If NO social/YouTube connectors returned data, leave MEMORY.md untouched.
6. Reply with a single line: BOOTSTRAP_OK or BOOTSTRAP_NO_DATA." || echo "WARNING: Dossier bootstrap did not complete; Otto will auto-discover on first chat."
