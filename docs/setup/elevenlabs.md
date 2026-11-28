# ElevenLabs Zero-Key Connector Setup (Scribe v3 Accurate `.srt` Subtitles)

Otto uses **ElevenLabs Scribe v3** (`POST /v1/speech-to-text`) through a zero-key Fly.io Sprites Custom API Connector to generate accurate, word-timed Indonesian & English `.srt` subtitles for every prepped VOD clip — replacing noisy YouTube auto-captions.

---

## 1. Provision the Connector via `sprite api`

Run from a directory **without** `.sprite` (e.g., `/tmp` or `C:\Windows\Temp`) so `sprite api` targets the org-level `/v1/` endpoint:

```bash
cd /tmp
sprite api /oauth/connections/custom_api -- -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ElevenLabs",
    "description": "ElevenLabs Scribe v3 Speech-to-Text for accurate Indonesian/English clip SRT subtitles",
    "base_api_url": "https://api.elevenlabs.io",
    "access_token": "'"$ELEVENLABS_API_KEY"'",
    "auth_method": "custom_header",
    "auth_custom_header_name": "xi-api-key",
    "auth_header_prefix": "",
    "test_url": "https://api.elevenlabs.io/v1/user",
    "access_policy": { "allow_all": true }
  }'
```

---

## 2. How It Works at Runtime

1. `agent/lib/elevenlabs-stt.ts` auto-discovers the `ElevenLabs` connector via `GET https://api.sprites.dev/v1/gateway/list`.
2. During `vod_prep_clip`, after normalizing the clip to CFR 30fps & `-14 LUFS`, Otto extracts a compact mono 16kHz 48kbps MP3 (~0.36 MB/min, safely under the 8 MB Sprites Gateway request limit), sends it to `POST /v1/speech-to-text` (`model_id: "scribe_v3"`), and writes a clean, sentence-broken `<clip>_prepped.srt` file.
3. If the ElevenLabs connector is absent or fails, `vod_prep_clip` gracefully falls back to the YouTube auto-transcript `.srt`.
