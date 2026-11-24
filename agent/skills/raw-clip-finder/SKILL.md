---
name: raw-clip-finder
description: Pull YouTube VOD subtitles with yt-dlp, identify the top 3-5 clip-worthy moments, download only those exact timestamp windows, cut clean raw .mp4 + .srt files with ffmpeg on the Sprite, and produce a human-editor handoff brief (strictly zero AI video editing/generation).
---

# Raw Clip Finder for Human Clippers & Editors

Never mention internal files, tool names, or agent commands (`MEMORY.md`, `yt-dlp`, `ffmpeg`, `omp`) unless the talent asks for technical details. Stay 100% in character as **Professor L**.

**Core principle:** You are NOT replacing human clippers or editors with AI slop. Your job is to save human editors hours of scrubbing a 4-hour VOD by handing them clean, timestamped **raw `.mp4` clips + `.srt` captions** and a sharp editing brief.

---

## 1. Fetch VOD Transcript First (Zero Heavy Download)
1. Get the target YouTube VOD URL (from the talent, or look up recent uploads via `youtube_tool` if they say *"my latest stream"*).
2. Create a clean workspace directory: `/home/sprite/clips/<video-id>/`.
3. Download **only** the subtitles first via `bash`:
   ```bash
   yt-dlp --skip-download --write-auto-subs --write-subs --sub-lang "id,en" --sub-format vtt -o "/home/sprite/clips/<video-id>/vod.%(ext)s" "<VOD_URL>"
   ```
4. Convert the `.vtt` into compact timestamped text (removing duplicate rolling VTT lines) using Python so you can scan the entire VOD quickly and accurately.

---

## 2. Hunt for the Top 3–5 Clip-Worthy Moments
Scan the transcript with a sharp producer's eye. Look for **3–5 standalone 30–90 second arcs** that have:
- **Immediate 3-second hook:** A bold claim, funny reaction, sharp Q&A question, or relatable story opener.
- **Clean payoff / punchline:** Ends cleanly without needing 20 minutes of prior context.
- **Zero OPSEC leaks:** Double-check against `~/.omp/agent/MEMORY.md` anonymity boundaries—skip any moment with accidental personal info or out-of-context rage-bait.

---

## 3. Cut Clean Raw `.mp4` + `.srt` Clips on the Sprite
For each selected clip (add ~2 seconds of breathing room before start and after end so a human editor has clean handles):
1. Download ONLY that exact section (never download the whole 4-hour VOD unless necessary):
   ```bash
   yt-dlp --download-sections "*HH:MM:SS-HH:MM:SS" --force-keyframes-at-cuts -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" --merge-output-format mp4 -o "/home/sprite/clips/<video-id>/clip_01_raw.mp4" "<VOD_URL>"
   ```
2. Extract a matching `.srt` caption file sliced and time-shifted to `00:00:00` for that clip window (via `ffmpeg` or Python VTT-to-SRT slicer) saved alongside as `/home/sprite/clips/<video-id>/clip_01_raw.srt`.
3. Verify every output file exists and has non-zero size (`ls -lh /home/sprite/clips/<video-id>/`).

---

## 4. Deliver the Human-Editor Handoff Brief
Present a crisp handoff sheet ready to forward straight to a human clipper/editor:
- **Clip # / Filename** (`.mp4` + `.srt` paths)
- **Exact VOD Timestamp & Duration**
- **Why this clip works** (1 sentence)
- **Suggested Opening Hook / On-Screen Title** (3–6 words)
- **Human Editor Notes:** Pacing cue, where the punchline lands, and any sensitivity/OPSEC note.
