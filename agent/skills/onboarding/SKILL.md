---
name: onboarding
description: Run Otto's quick studio onboarding: proactively discover who the creator is using connected channels (Buffer, YouTube) and web search (Exa, Firecrawl), verify profile details, timezone, OPSEC boundaries, and human team credits, and save a clean dossier to persistent memory.
---

# Quick Studio Onboarding

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `/skill:...`, `omp`, `Mnemopi`) to the creator. Stay in character as **Otto**.

Check `~/.omp/agent/MEMORY.md` first to see what is already known vs. what still has `(not set)` or `(pending ...)` placeholders. Skip anything already filled in.

---

## 1. Proactive Discovery
1. **Check connected accounts first** before asking for handles:
   - **Connected Socials:** Call `buffer_list_channels` (if available) to discover connected X, TikTok, Instagram, or other handles.
   - **YouTube Channel:** Call `youtube_tool` (`YOUTUBE_LIST_USER_PLAYLISTS` with `{}` first to get the channel ID, then `YOUTUBE_GET_CHANNEL_STATISTICS` with `{ id }`, `YOUTUBE_LIST_CHANNEL_VIDEOS`, or `YOUTUBE_GET_CHANNEL_ID_BY_HANDLE` with a leading `@`).
     - Call shape: `youtube_tool({ slug: "YOUTUBE_...", arguments: {...} })`.
   - **Public Bio & Lore:** If a creator name/handle is found (or provided by the user), use `exa_search` (and `firecrawl_scrape` if useful) to gather public bio, niche, hashtags, and artist/rigger credits.
2. If no connected accounts return data and Profile is still empty, ask simply for their creator name, main handle, or channel URL — never dump a long questionnaire.

---

## 2. Quick Fact-Check & Safety Gate
Present a clean, concise bullet summary of what you found (persona/niche, platforms & baseline stats, timezone if inferred, main topics, credits), then ask a short confirmation covering only what's missing:
1. Anything I got wrong or should adjust about your channel?
2. What's your home **timezone** (so I schedule streams & reminders in your local time)?
3. Any **anonymity / OPSEC rules** or off-limits topics I should always protect?
4. Any human artists, clippers, editors, or collaborators you want me to remember?

---

## 3. Save & Get to Work
- Save confirmed details immediately into `~/.omp/agent/MEMORY.md` (and optional contacts into `studio_contact_upsert` if they share team members).
- Close crisply: confirm their studio profile is set and ask what they want to tackle first (planning a stream, auditing uploads, cutting VOD clips, drafting promos, etc.).
- Only bring up long-term goal-setting or streaming coaching if they ask for advice.
