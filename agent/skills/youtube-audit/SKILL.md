---
name: youtube-audit
description: Pull live YouTube channel statistics and recent uploads via Composio YouTube tools, audit titles and thumbnails (with visual multimodal inspection via critique_thumbnail), benchmark niche formats via Exa, and deliver concrete title rewrites plus human-artist thumbnail revision briefs (strictly zero AI art).
---

# YouTube Channel & Packaging Audit

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `youtube_tool`, `exa_search`, `omp`) to the creator. Stay in character as **Otto**.

---

## 1. Pull Live Channel Data (Read-Only)
1. Silently read `~/.omp/agent/MEMORY.md` to get the creator's YouTube handle / Channel ID, niche, and OPSEC boundaries.
2. If Channel ID is missing, resolve it via `youtube_tool` (`YOUTUBE_GET_CHANNEL_ID_BY_HANDLE` with leading `@`, or `YOUTUBE_LIST_USER_PLAYLISTS` with `{}`).
3. Fetch live numbers and recent uploads using `youtube_tool`:
   - `YOUTUBE_GET_CHANNEL_STATISTICS` (subscribers, total views, video count)
   - `YOUTUBE_LIST_CHANNEL_VIDEOS` (last 10–15 uploads)
   - `YOUTUBE_VIDEO_DETAILS` (views, likes, comments, durations, titles, descriptions)
4. Optionally log a snapshot with `studio_metrics_log` so growth history stays tracked in **Studio DB**.
5. Optionally call `exa_search` to benchmark high-performing title structures in the creator's niche.
6. For the top 1–3 recent videos, call `critique_thumbnail("https://i.ytimg.com/vi/<videoId>/hqdefault.jpg", videoTitle)` so your feedback is grounded in actually *seeing* the live thumbnail.

---

## 2. Diagnose Clearly From the Data
- **Outliers & Baselines:** Compare each upload's views against the channel's recent median — highlight what's outperforming (worth doubling down on) and what's underperforming (likely title/thumbnail/topic packaging leaks).
- **Title Clarity:** Flag titles that are too long, cut off on mobile, vague, or buried under episode/VOD numbers.
- **Thumbnail Readability:** Call out clutter, low contrast, tiny text, or text that repeats the title.

---

## 3. Deliver Actionable Packaging Fixes (Strictly Human-Made)
For the top **3–5 highest-leverage videos**:
1. **What's leaking clicks** (1 clear sentence).
2. **3 concrete title rewrites** (concise, curiosity-driven, mobile-readable, zero misleading clickbait).
3. **Human-Artist Thumbnail Revision Brief:**
   - **Focal point:** 1 clear subject (e.g., expressive Live2D screenshot or human-drawn bust-up) + clean background contrast.
   - **Text:** 0–3 bold words max (don't repeat the full title).
   - **Mobile check:** Must read clearly at small phone sizes.
   - **HARD RULE:** NEVER generate or suggest AI thumbnails. Always frame briefs for a human artist or clean DIY screenshots of their existing human-made assets.

---

## 4. Approval Gate for Live Updates
- Ask if the creator wants to apply any of the new titles or descriptions directly to YouTube.
- **NEVER** call `YOUTUBE_UPDATE_VIDEO` or `YOUTUBE_UPDATE_THUMBNAIL` without explicit human confirmation of the exact video ID and final text.
