# Pixabay Zero-Key Connector Setup (Non-AI Stock Photography Backgrounds)

Otto uses **Pixabay** strictly for **royalty-free human photography backgrounds** (`image_type=photo`, `orientation=horizontal`, `isAiGenerated === false`, `isLowQuality === false`) inside **Thumbnail Studio** and **OBS Overlays**, with **zero API keys stored inside the Sprite VM**.

---

## 1. Get a Free Pixabay API Key

1. Sign in at [pixabay.com/api/docs/](https://pixabay.com/api/docs/).
2. Copy your personal API key shown on the docs page and export it in your local shell:
   ```bash
   export PIXABAY_API_KEY="your-pixabay-api-key"
   ```

---

## 2. Provision the Connector via `sprite api`

Run from a directory **without** `.sprite` (e.g., `/tmp` or `C:\Windows\Temp`) so `sprite api` targets the org-level `/v1/` endpoint:

```bash
cd /tmp
sprite api /oauth/connections/custom_api -- -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pixabay",
    "base_api_url": "https://pixabay.com/api",
    "access_token": "'"$PIXABAY_API_KEY"'",
    "auth_method": "query_param",
    "auth_query_param_name": "key",
    "auth_header_prefix": "",
    "test_url": "https://pixabay.com/api/?q=studio&per_page=3",
    "access_policy": { "allow_all": true }
  }'
```

---

## 3. Verify Inside the Sprite

`agent/lib/pixabay.ts` auto-discovers the Pixabay connector from `GET https://api.sprites.dev/v1/gateway/list` at runtime and always sends `Accept-Encoding: identity` (required for Sprites query-parameter auth). Verify with:

```bash
sprite exec -- bun -e 'import { searchPixabayBackgrounds } from "/home/sprite/lma/agent/lib/pixabay.ts"; console.log(await searchPixabayBackgrounds({ query: "dark studio", limit: 3 }));'
```
