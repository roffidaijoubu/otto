# E2E Playbook 04 — VOD Hype Clipper, `-14 LUFS` Prep & Multimodal Review

**Goal:** Verify the full local-compute clipping pipeline on Sprite `lma`:
1. `vod_scan_hype` (parallel InnerTube live-chat + `yt-dlp` `json3` transcript + 4-signal Z-score detector, or transcript fallback)
2. `vod_cut_clip` (exact `.mp4` + time-shifted `.srt` saved in `/home/sprite/workspace/clips/<video_id>/`)
3. `vod_prep_clip` (H.264 `yuv420p` CFR 30fps + `-14 LUFS` loudness normalization)
4. `watch_clip` (multimodal visual/audio 3-second hook & pacing critique via zero-key Gemini Connector)
5. Mission Control **Files & Clips** view (`GET /api/clips` lists the cut `.mp4` + `.srt` for human-editor download)

---

## Steps

### 1. Scan a Real VOD & Cut + Prep + Watch 1 Short Clip
Pick a short/medium public YouTube VOD URL `<VOD_URL>` (e.g. one of `@roffi_daijoubu`'s streams) and run:
```bash
sprite exec -- bash -c 'mkdir -p /home/sprite/e2e-clip && cd /home/sprite/e2e-clip && omp -p "Scan this VOD for clippable moments: <VOD_URL>. Pick the single best 30-45 second moment, cut the raw clip as clip_01_test, normalize it for my human editor (-14 LUFS CFR), then watch the cut clip and give me a human-editor handoff brief with 3-second hook notes."'
```

### 2. Verify Artifacts on Sprite & Mission Control API
```bash
sprite exec -- ls -lh /home/sprite/workspace/clips/*/
```
Also verify authenticated `GET /api/clips` returns the `.mp4`, `_prepped.mp4`, and `.srt` URLs (and `HEAD` / `GET` on `mp4Url` returns `200 video/mp4`).

### 3. Semantic Pass Criteria
- [ ] `vod_scan_hype` ran without rewriting parsers in bash.
- [ ] Both `clip_01_test.mp4`, `clip_01_test.srt` (if transcript existed), and `clip_01_test_prepped.mp4` exist with non-zero byte sizes in `/home/sprite/workspace/clips/<video_id>/`.
- [ ] `watch_clip` produced real visual/audio pacing feedback (3-second hook, framing, dead air).
- [ ] Handoff brief includes timestamp, `youtu.be/<id>?t=<startSec>` jump link, hook suggestion, and zero AI video editing claims.
- [ ] Clip appears in Mission Control → **Files & Clips** view (`GET /api/clips`, a backwards-compatible alias for workspace clips).
