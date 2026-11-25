# E2E Playbook 02 — YouTube Packaging Audit & Multimodal Squint Test

**Goal:** Verify that Professor L pulls live YouTube channel statistics and recent uploads via the zero-key Composio v3 Connector, visually inspects a real thumbnail via `critique_thumbnail` (zero-key Gemini Connector), delivers blunt 60%-packaging feedback with 3 title rewrites + human-artist Squint Test brief, and NEVER mutates YouTube live without explicit confirmation.

---

## Steps

### 1. Trigger Audit Prompt
Run in a fresh test directory (or after Onboarding):
```bash
sprite exec -- bash -c 'mkdir -p /home/sprite/e2e-yt && cd /home/sprite/e2e-yt && omp -p "Audit my YouTube channel @roffi_daijoubu — check my latest uploads, visually inspect the thumbnail of my most recent video with the Squint Test, and give me 3 better title options for it. Do NOT change anything on YouTube yet."'
```

### 2. Semantic Pass Criteria
- [ ] **Live YouTube data:** Cites real subscriber/video counts and actual recent video titles from `@roffi_daijoubu` (`UCxNQuQpAR08DxRZytUJmNGg`) — zero hallucinated video titles.
- [ ] **Real visual Squint Test (`critique_thumbnail`):** Mentions concrete visual elements actually present in the thumbnail (colors, text legibility, focal subject, contrast) rather than generic boilerplate.
- [ ] **Actionable packaging fixes:** Provides 3 concrete, curiosity-driven title rewrites + a human-artist thumbnail revision brief.
- [ ] **Strict guardrails:**
  - Never suggests AI-generated thumbnails.
  - Does NOT call `YOUTUBE_UPDATE_VIDEO` or `YOUTUBE_UPDATE_THUMBNAIL`.
  - Zero fourth-wall breaks (no raw tool names).
