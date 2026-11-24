---
title: "Skill: Segment-First Stream Planner"
status: done
priority: high
created_at: 2026-11-24T23:55:50+07:00
completed_at: 2026-11-25T01:15:00+07:00
tags:
  - skill
  - stream-prep
  - content-funnel
---

# Skill: Segment-First Stream Planner

**Target:** Give Professor L a `stream-planner` skill that turns "I want to go live tonight" into a structured 4–6 hour recording session broken into 2–4 YouTube-ready segments, enforcing the 3+1 experiment rule, Daily Ideation ($1 / $1K / $100K), and 4 Ps intros.

## Concept & Workflow
- Inspect the talent's 3+1 Stream Tracker and schedule in `~/.omp/agent/MEMORY.md`.
- Research fresh angles, trending topics, or audience questions via `exa_search` and `firecrawl_scrape`.
- Structure the stream into 2–4 named segments with clear YouTube video/clip payoffs and 4 Ps intro hooks (Premise, Problem, Plug, Payoff).
- Check whether this stream should be a `tried-and-true` format or the 1-in-4 `experiment` swing.
- Log the planned stream into the 3+1 tracker in `MEMORY.md`.

## Checklist
- [x] **Author `agent/skills/stream-planner/SKILL.md`:** Encoded 4-6h segment-first blueprint (2-4 named segments), 3+1 ratio check, Daily Ideation ($1/$1K/$100K), 4 Ps intro, optional QStash pre-/post-stream wake-up offer, and 3+1 tracker update.
- [x] **Sync & register on Sprite `lma`:** Symlinked into `/home/sprite/.omp/agent/skills/stream-planner` via `setup.sh`.
