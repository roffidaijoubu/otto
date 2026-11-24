---
title: "Skill: Cross-Platform Social Promo (Buffer Drafts)"
status: done
priority: medium
created_at: 2026-11-24T23:55:51+07:00
completed_at: 2026-11-25T01:15:00+07:00
tags:
  - skill
  - buffer
  - social-ops
---

# Skill: Cross-Platform Social Promo (Buffer Drafts)

**Target:** Give Professor L a `social-promo` skill that converts a planned stream, weekly schedule, or new YouTube upload into tailored copy for X, TikTok, and Instagram and saves them safely into Buffer Drafts (`saveToDraft: true`) via the Buffer Sprites Connector.

## Concept & Workflow
- Discover connected social channels via `buffer_list_channels`.
- Adapt tone, length, and hashtags per platform (e.g. punchy X announcement with `#RoffiLIVE`, short hook for TikTok/Reels, clean caption for Instagram) while respecting OPSEC boundaries.
- Save posts directly to Buffer Drafts (`saveToDraft: true`) so the creator can review and publish with one click; never publish live (`saveToDraft: false` / `shareNow`) without explicit confirmation.

## Checklist
- [x] **Author `agent/skills/social-promo/SKILL.md`:** Encoded `buffer_list_channels` discovery, platform-tailored copy for X/TikTok/IG, OPSEC guardrails, and draft-first `buffer_create_post` (`saveToDraft: true`).
- [x] **Sync & register on Sprite `lma`:** Symlinked into `/home/sprite/.omp/agent/skills/social-promo` via `setup.sh`.
