# Agentic E2E Test Playbooks (`scripts/e2e/`)

Because **Otto** is a conversational AI agent, his responses are non-deterministic and cannot be verified with brittle exact-string assertions. Instead, these Markdown playbooks are **agentic test instructions** meant to be executed by a coding agent (`omp`) on the local workstation against the live Fly.io Sprite (`lma`).

---

## Standard Time-Travel Wrapper (Run Before & After Any Playbook)

1. **Snapshot live state (if you want to preserve current prod data):**
   ```bash
   sprite checkpoint create --comment "prod: before e2e run"
   ```
2. **Prepare a clean-slate baseline** *(for blank-memory tests like `01-onboarding.md`, run with `--no-memory`; normal `git commit` checkpoints pre-seed `MEMORY.md` from gitignored `agent/MEMORY.md` for faster daily dev testing)*:
   ```bash
   bash scripts/sync-initialized-checkpoint.sh --no-memory
   # or restore an existing blank initialized checkpoint:
   sprite checkpoint list
   sprite restore <initialized-id>
   ```
3. **Run fast deterministic pre-flight:**
   ```bash
   bash scripts/verify-all.sh
   ```
4. **Execute the chosen playbook** (`01-onboarding.md` … `05-qstash-proactive-wakeup.md`) using multi-turn `omp` commands in a dedicated test directory (e.g. `/home/sprite/e2e-test`, where `autoResume: true` maintains the exact conversation thread across turns):
   ```bash
   sprite exec -- bash -c 'mkdir -p /home/sprite/e2e-test && cd /home/sprite/e2e-test && omp -p "<Turn 1>"'
   sprite exec -- bash -c 'cd /home/sprite/e2e-test && omp -p "<Turn 2>"'
   ```
5. **Restore your saved prod checkpoint (or `initialized:` baseline) when finished** — restoring an older checkpoint never deletes newer checkpoints:
   ```bash
   sprite restore <prod-or-initialized-id>
   ```

---

## Playbook Index

| Playbook | Feature / Tools Tested | Estimated Time |
| :--- | :--- | :--- |
| [`01-onboarding.md`](01-onboarding.md) | 2-phase `onboarding` skill, `social_list_channels`, `youtube_tool`, `exa_search`, `MEMORY.md` persistence vs `expected-memory.md` | ~60s |
| [`02-youtube-audit-and-squint-test.md`](02-youtube-audit-and-squint-test.md) | `youtube-audit` skill, `youtube_tool` live stats/uploads, `critique_thumbnail` multimodal Squint Test, no-AI-art guardrail | ~45s |
| [`03-social-promo-buffer-drafts.md`](03-social-promo-buffer-drafts.md) | `social-promo` skill, `social_list_channels`, `x_post`/`tiktok_post`/`instagram_post` draft-first guardrail (`saveToDraft: true`) | ~30s |
| [`04-vod-hype-clipper-and-review.md`](04-vod-hype-clipper-and-review.md) | `raw-clip-finder` skill, `vod_scan_hype`, `vod_cut_clip`, `vod_prep_clip` (`-14 LUFS` CFR), `watch_clip`, Mission Control `/api/clips` | ~90s |
| [`05-qstash-proactive-wakeup.md`](05-qstash-proactive-wakeup.md) | `schedule_wakeup` via QStash Connector, signed `POST /api/wakeup`, `/.sprite/api.sock` Tasks API hold, proactive reply in `/api/messages` | ~40s |
