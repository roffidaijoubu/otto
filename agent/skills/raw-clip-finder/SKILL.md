---
name: raw-clip-finder
description: Scan a YouTube livestream VOD with vod_scan_hype (parallel InnerTube live-chat replay + 4-signal Z-score hype detector + json3 transcript), curate the top 3-5 clippable moments with exact snapped timestamps and OPSEC filtering, cut clean raw .mp4 + .srt files via vod_cut_clip, and produce a human-editor handoff brief (strictly zero AI video editing).
---

# Raw Clip Finder for Human Clippers & Editors

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `vod_scan_hype`, `vod_cut_clip`, `omp`) unless the talent asks for technical details. Stay 100% in character as **Otto**.

**Core principle:** You are NOT replacing human clippers or editors with AI slop. Your job is to save human editors hours of scrubbing a 4-hour VOD by using chat-spike + transcript hype detection to hand them clean, timestamped **raw `.mp4` clips + synced `.srt` captions** and a sharp editing brief.

---

## 1. Scan the VOD Using `vod_scan_hype`
1. Get the target YouTube VOD URL (from the talent, or look up their latest stream VOD via `youtube_tool` if they say *"my latest stream"*).
2. **ALWAYS** call `vod_scan_hype(url)` first — do NOT rewrite chat/transcript parsers in bash.
   - `vod_scan_hype` fetches live chat replay in parallel + auto-transcript, runs the 4-signal rolling Z-score detector (chat velocity, unique author burst, reaction ratio, emote spam), and returns compact **Candidate Cards** (or a transcript timeline fallback if live chat replay is disabled).

---

## 2. Curate the Top 3–5 Clippable Moments
Remember: **YouTube live chat lags 10–25 seconds behind what happens on screen**, so the real hook/setup happens *before* the chat spike peak.

Review every Candidate Card and:
1. **Filter out false positives:** Skip stream intro/absen, tech issues, ads, generic chatter, outro, or moments without a clear funny/dramatic/insightful payoff.
2. **Enforce OPSEC boundaries:** Silently check `~/.omp/agent/MEMORY.md` — reject any candidate containing accidental personal/doxable info or out-of-context rage-bait.
3. **Snap exact boundaries:** Pick `startSec` and `endSec` (typically **30–90 seconds**, plus ~2s breathing handles) snapped cleanly to the transcript timestamps so both the **3-second opening hook** and the **payoff/reaction** are complete.

---

## 3. Cut Clean Raw `.mp4` + `.srt` Files (`vod_cut_clip`)
- If the talent asked you to **cut the clips** (or after they pick which candidates they want), call `vod_cut_clip(url, startSec, endSec, name)` for each selected moment (e.g. `clip_01_plot_twist`).
- Each call saves a clean raw `.mp4` and a time-shifted `.srt` starting at `00:00:00,000` inside `/home/sprite/workspace/clips/<video_id>/`.

- Optionally call `watch_clip("/home/sprite/workspace/clips/<video_id>/<name>.mp4")` on the #1 cut clip to visually verify the 3-second hook, framing, and dead air before handing off to the human editor.
---

## 4. Deliver the Human-Editor Handoff Brief
Present a crisp handoff sheet ready to forward straight to a human clipper/editor:
- **Rank & Clip Title** (punchy, curiosity-driven)
- **Exact VOD Timestamp, Duration & Direct Jump Link** (`https://youtu.be/<id>?t=<startSec>`)
- **Saved Raw Files** (`.mp4` + `.srt` paths, if cut)
- **Why this moment hits** (1 sentence grounded in chat/transcript reaction)
- **Suggested Opening Hook / On-Screen Caption** (3–6 words)
- **Human Editor Notes:** Pacing cue, where the punchline lands, and any sensitivity/OPSEC note.
