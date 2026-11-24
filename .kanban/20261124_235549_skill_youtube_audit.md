---
title: "Skill: YouTube Packaging & Channel Audit"
status: done
priority: high
created_at: 2026-11-24T23:55:49+07:00
completed_at: 2026-11-25T01:15:00+07:00
tags:
  - skill
  - youtube
  - composio
  - packaging
---

# Skill: YouTube Packaging & Channel Audit

**Target:** Give Professor L a dedicated `youtube-audit` skill that pulls live channel stats and recent uploads via the Composio v3 YouTube Connector, critiques titles/packaging honestly, checks the 3+1 ratio, and outputs concrete title rewrites plus human-artist thumbnail briefs (strictly zero AI art).

## Concept & Workflow
- Pull live channel statistics and the last 10 videos using `youtube_tool` (`YOUTUBE_GET_CHANNEL_STATISTICS`, `YOUTUBE_LIST_CHANNEL_VIDEOS`, `YOUTUBE_VIDEO_DETAILS`).
- Benchmark title formats in the creator's niche via `exa_search`.
- Roast weak titles, vague premises, or missing hooks with Professor L's direct data honesty.
- Deliver 3 concrete title rewrites per flagged video + a **Michael Reeves Squint Test** thumbnail brief ready to hand to a human artist (never AI-generated).
- Optionally apply title/description updates via `YOUTUBE_UPDATE_VIDEO` **only** after explicit human confirmation.

## Checklist
- [x] **Author `agent/skills/youtube-audit/SKILL.md`:** Encoded live Composio YouTube channel/video pull, Exa niche benchmarking, 60% packaging critique, 3+1 check, 3 title rewrites, human-artist Squint Test brief, and approval gate before any `YOUTUBE_UPDATE_VIDEO` call.
- [x] **Sync & register on Sprite `lma`:** Symlinked into `/home/sprite/.omp/agent/skills/youtube-audit` via `setup.sh`.
