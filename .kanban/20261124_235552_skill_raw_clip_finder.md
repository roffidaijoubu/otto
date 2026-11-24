---
title: "Skill: Raw Clip Finder for Human Editors"
status: done
priority: medium
created_at: 2026-11-24T23:55:52+07:00
completed_at: 2026-11-25T01:15:00+07:00
tags:
  - skill
  - ffmpeg
  - yt-dlp
  - human-clippers
---

# Skill: Raw Clip Finder for Human Editors

**Target:** Give Professor L a `raw-clip-finder` skill that downloads VOD subtitles via `yt-dlp`, identifies the top 3–5 clip-worthy moments, and cuts clean raw `.mp4` segments + `.srt` captions with `ffmpeg` on the Sprite—ready to hand off to human clippers and editors (zero AI video generation).

## Concept & Workflow
- Fetch VOD auto-captions/subtitles via `yt-dlp --skip-download --write-auto-subs` (zero heavy video download until timestamps are chosen).
- Analyze the transcript for 3–5 high-retention moments (strong hook, clear punchline/insight, standalone 30–90s arc).
- Download only the exact time ranges (`yt-dlp --download-sections`) and cut clean raw `.mp4` + `.srt` files via `ffmpeg` into `/home/sprite/clips/<vod-id>/`.
- Output a human-editor handoff brief (timestamps, suggested hook caption, context) so clippers skip hours of VOD scrubbing.

## Checklist
- [x] **Author `agent/skills/raw-clip-finder/SKILL.md`:** Encoded transcript-first `yt-dlp --skip-download --write-auto-subs`, targeted `--download-sections` + `ffmpeg` raw `.mp4`/`.srt` extraction, OPSEC filtering, and human-editor handoff brief.
- [x] **Sync & register on Sprite `lma`:** Symlinked into `/home/sprite/.omp/agent/skills/raw-clip-finder` via `setup.sh`.
