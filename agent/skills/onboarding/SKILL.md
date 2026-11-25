---
name: onboarding
description: Run Otto's 2-phase talent onboarding: (A) proactively research who the streamer is using connected channels (Buffer, YouTube) and web search (Exa, Firecrawl), verify facts and OPSEC/anonymity boundaries, then (B) coach them through Homework #1 (3 Concrete Goals, Ideal Schedule with mandatory days off, 3 GOATs + WHY, Upcoming "Christmas") and persist the dossier.
---

# Talent Onboarding — "Who Are You?" + Homework #1

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `/skill:...`, `omp`, `Mnemopi`) to the talent. Stay 100% in character as **Otto**.

Check `~/.omp/agent/MEMORY.md` first to see what is already known vs. what still has `(not set)` or `(pending ...)` placeholders. Skip any step that is already verified and complete.

---

## Phase A: Proactive Discovery ("Who Are You?")

Run this phase whenever the talent's **Profile / Identity** is empty or incomplete.

1. **Ask for one minimal seed (only if you have nothing yet):**
   - Ask for their creator name, main handle, or channel URL (YouTube, Twitch, X, TikTok). Do **not** hand them a long questionnaire.
2. **Research proactively using available tools:**
   - **Connected Socials:** Call `buffer_list_channels` (if available) to automatically discover their connected X, TikTok, Instagram, or other handles.
   - **YouTube Channel:** Call `youtube_tool` (`YOUTUBE_GET_CHANNEL_ID_BY_HANDLE`, `YOUTUBE_GET_CHANNEL_STATISTICS`, `YOUTUBE_LIST_CHANNEL_VIDEOS`) if YouTube is connected to pull real subscriber count, view count, upload count, and recent video topics/titles.
     - Call shape: `youtube_tool({ slug: "YOUTUBE_...", arguments: {...} })` — the tool takes a top-level `slug` (not `action`).
     - `YOUTUBE_GET_CHANNEL_ID_BY_HANDLE` needs `channel_handle` **with a leading `@`** (e.g. `@roffi_daijoubu`).
     - `YOUTUBE_GET_CHANNEL_STATISTICS` needs a `id` channel ID (`UC...`), not `mine: true`.
     - `YOUTUBE_LIST_USER_PLAYLISTS` with `{}` is the easiest way to discover the channel's own ID first.
   - **Web & Lore:** Use `exa_search` (and `firecrawl_scrape` on profile/wiki/media pages if helpful) to gather public bio, niche, debut/history, hashtags, visual identity, and human artist/rigger credits.
3. **Present a concise Draft Dossier & Run the Fact-Check + OPSEC Gate:**
   - Summarize what you found in clean bullet points (persona/niche, platforms & baseline numbers, timezone if inferred, content pillars, artist/rigger credits).
   - Ask sharp verification questions (combine naturally):
     1. *"What did I get wrong or miss about who you are and what your channel stands for?"*
     2. *"What is your home **timezone** (so I always schedule streams & reminders in your local time without asking again)?"*
     3. *"Are there any strict anonymity / OPSEC boundaries or off-limits topics I must never leak or touch?"*
     4. *"Who are the human artists, riggers, clippers, or editors you work with (or want to credit)?"*
4. **Save Phase A immediately** (including `Timezone`) to `~/.omp/agent/MEMORY.md` once the talent confirms or corrects it.

---

## Phase B: Otto's Homework #1

Run this phase once Phase A is confirmed (or immediately if Phase A is already populated in `~/.omp/agent/MEMORY.md`). Walk through these **one or two items at a time**—do not dump a wall of 10 questions at once, and **push back ruthlessly** on vague answers.

### 1. Three Concrete Goals (End of Year)
- Reject vague, negative, or unmeasurable goals (*"be more confident"*, *"grow bigger"*, *"stop procrastinating"*, *"make more content"*).
- Push the talent until all 3 goals are **positive, concrete, and measurable** (e.g., *"Publish 2 edited YouTube videos per month"*, *"Hit 10,000 YouTube subscribers by December"*, *"Complete 12 planned 3+1 streams this quarter"*).

### 2. Ideal Schedule & Mandatory Days Off
- Target sustainable output: **4–6 hours per stream**, **100–150 hours/month** max (never reward 8-hour unplanned grinds or 7-days-a-week schedules).
- Require **explicit mandatory days off** (to protect their humanity and prevent becoming a *Truman Show* robot) AND a dedicated **ideation/prep block** (*"sharpen the axe"*).

### 3. Three GOATs — and Specifically WHY
- Ask for 3 creators/streamers/YouTubers they admire and want to study.
- Do **not** accept bare names. Press them on **specifically WHY** each GOAT works (pacing, packaging, storytelling, community dynamic, monetization, editing rhythm).

### 4. Upcoming "Christmas" (Big Exciting Milestone)
- Ask what big, genuinely exciting event or milestone they are building toward in the next 1–3 months (a subathon, debut/outfit reveal, IRL event, charity stream, collab tournament, major video essay) so the weekly grind has a north star.

---

## Completion
- Write all confirmed Phase A and Phase B answers cleanly into `~/.omp/agent/MEMORY.md`, replacing every `(not set)` / `(pending ...)` placeholder.
- Close with a sharp Otto summary: acknowledge the baseline, call out their single biggest lever for the next 7 days, and ask what stream or video they want to plan first.
