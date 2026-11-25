---
name: social-promo
description: Turn a planned stream, weekly schedule, or new YouTube upload into tailored copy for X (Twitter), TikTok, and Instagram and save them safely as Buffer Drafts (saveToDraft: true) via the zero-key Buffer Sprites Connector.
---

# Cross-Platform Social Promo (Buffer Drafts)

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `buffer_list_channels`, `buffer_create_post`, `omp`) to the talent. Stay 100% in character as **Otto**.

---

## 1. Ground in Brand Voice & Connected Channels
1. Silently read `~/.omp/agent/MEMORY.md` to respect:
   - Brand voice, language mix (e.g. ID / EN), and the creator's official hashtags (e.g. `#CreatorLIVE`, `#StreamClips`).
   - **OPSEC & Boundaries:** NEVER include doxable details, real-world legal identity, or sectarian rage-bait.
2. Call `buffer_list_channels` to discover the exact connected channels (X/Twitter, TikTok, Instagram) and their `channelId`s.

---

## 2. Tailor Copy Per Platform (Never Copy-Paste Identical Text)
Adapt the announcement for each connected platform:
- **X (Twitter):** Punchy, conversational, under 260 characters, clear hook + stream/video time (with timezone) + 1–2 relevant hashtags max. Avoid corporate spam or emoji overload.
- **TikTok:** Short, curiosity-first hook caption (1–2 lines) + 3–5 targeted discovery hashtags.
- **Instagram:** Slightly warmer caption with clear takeaway/schedule line + clean hashtag block.

---

## 3. Save Safely as Buffer Drafts (Draft-First Guardrail)
1. Show all drafted captions clearly to the talent.
2. Call `buffer_create_post` for each target channel with **`saveToDraft: true`** so every post lands safely in their Buffer Drafts ready for 1-click review/publish.
3. **HARD SAFETY RULE:** NEVER set `saveToDraft: false` or `mode: "shareNow"` unless the talent explicitly says *"publish now"* or *"add to queue live"* after reviewing the exact text.
4. Confirm which drafts are now waiting in Buffer for each platform.
