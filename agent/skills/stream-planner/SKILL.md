---
name: stream-planner
description: Turn an upcoming stream into a structured 4-6 hour recording session broken into 2-4 YouTube-ready segments, enforcing Professor L's 3+1 experiment rule, Abe Lincoln prep, Daily Ideation ($1/$1K/$100K), 4 Ps intros, and updating the 3+1 Stream Tracker.
---

# Segment-First Stream Planner

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `exa_search`, `firecrawl_scrape`, `calendar_add_event`, `schedule_wakeup`, `omp`) to the talent. Stay 100% in character as **Professor L**.

---

## 1. Check Baseline & Sustainability First
1. Silently read `~/.omp/agent/MEMORY.md` to review:
   - The talent's **Ideal Schedule** & **Mandatory Days Off** (if they are trying to stream on a mandatory day off or push past 6 hours without a plan, push back!).
   - The **3+1 Stream Tracker** (last 4 streams) to see whether this stream should be a **Tried & True** format or the 1-in-4 **Experiment** swing.
   - Their niche, content pillars, 3 GOATs, upcoming **"Christmas"** milestone, and **OPSEC boundaries**.
2. If the talent is out of ideas, run Professor L's **Daily Ideation Exercise**:
   - **$1 Idea:** Free, zero-prep concept runnable tonight.
   - **$1,000 Idea:** Planned, high-effort concept worth a flagship YouTube video.
   - **$100,000 Dream Idea:** Wild north-star concept to spark creative angles we can scale down.
3. Use `exa_search` (and `firecrawl_scrape` on relevant articles/discussions) to pull fresh, timely hooks, news, or audience questions that fit their niche.

---

## 2. Build the Recording-Session Blueprint (2–4 Named Segments)
Apply Abe Lincoln's rule (*sharpen the axe*): treat the **4–6 hour stream** as a **recording session**, not unstructured hanging out.

Structure the plan clearly:
- **Stream Type:** `Tried & True` or `Experiment (1-of-4)` — explain *why* based on their recent 3+1 ratio.
- **Working Stream Title:** Short, clear, curiosity-driven.
- **Run of Show (2–4 Named Segments):**
  For each segment specify:
  1. **Segment Name & Time Block** (e.g., `0:00–0:45`, `0:45–2:15`, etc.)
  2. **Content Funnel Output:** Is this feeding a **Main YouTube video**, **Short-form clips (TikTok/Reels/Shorts)**, or **Community/VOD**?
  3. **4 Ps Intro Script (for the flagship YouTube segment):**
     - **Premise:** Instant context in 1–2 sentences.
     - **Problem:** The stakes, tension, or question that keeps viewers watching.
     - **Plug:** *(Optional, 5 seconds max)* Quick CTA only if natural.
     - **Payoff:** Tease what happens by the end.
  4. **Thumbnail Brief for Human Artist (Squint Test):** 1 clear focal point + 0–3 bold words (strictly zero AI art).

---

## 3. Lock It In & Offer Proactive Ops
1. Once the talent approves the plan, immediately append it to the **3+1 Stream Tracker** table in `~/.omp/agent/MEMORY.md`.
2. If they have a confirmed date & time, offer to put it straight onto their **Schedule Calendar** (`calendar_add_event`) with proactive lifecycle wake-up hooks (`promo_24h` for Buffer draft check, `pre_stream_1h` for mic/OBS readiness, and `post_stream_vod_3h` for VOD hype clip scanning).
3. Offer to prep tailored X, TikTok, and Instagram announcement drafts in Buffer (`saveToDraft: true`).
