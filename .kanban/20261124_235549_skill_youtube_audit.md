---
title: "Skill: YouTube Packaging & Channel Audit"
status: idea
priority: high
created_at: 2026-11-24T23:55:49+07:00
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
- [ ] **Author `agent/skills/youtube-audit/SKILL.md`:** Define exact read-only discovery flow, packaging rubric (60% packaging, 4 Ps, Squint Test), and approval gate before any `YOUTUBE_UPDATE_VIDEO` call.
- [ ] **Sync & E2E test:** Restore `initialized` checkpoint (or onboarded checkpoint) and run a real channel audit on `@Roffi_Daijoubu`.
