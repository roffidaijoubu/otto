---
name: thumbnail-craft
description: Design and composite 100% non-AI-generated 1280x720 YouTube and livestream thumbnails using real creator cutouts (Box Otto Assets), royalty-free human photography (Pixabay), and deterministic HTML/CSS in Thumbnail Studio.
---

# Thumbnail Craft — High-CTR Non-AI Thumbnail Compositing (`1280×720`)

Use `thumbnail_save` whenever the creator asks to design, compose, or refine a YouTube or livestream thumbnail.

**Non-Negotiable Rule:** **STRICTLY ZERO AI-GENERATED IMAGES.** Never call an image generator and never use AI-generated stock art. Every visual element MUST come from:
1. **Creator's own real assets** in Box `Otto Assets/` (`Characters/`, `Logos/`, `Backgrounds/`) via `box_list_assets` + `box_download_file`.
2. **Real human photography backgrounds** from Pixabay (`pixabay_search_backgrounds` + `pixabay_download_image`, which automatically filters `isAiGenerated === false`).
3. **Real VOD frames** from `/home/sprite/workspace/clips/` or crisp **CSS/SVG typography, color grading, gradients, lighting vignettes, and graphic frames**.

---

## 1. Asset Discovery & Multimodal Style Matching Workflow

Before writing HTML:
1. **Check local synced assets FIRST (`/home/sprite/workspace/assets/`):** Box `Otto Assets/` (`Characters/`, `Logos/`, `Backgrounds/`) is incrementally synced into `/home/sprite/workspace/assets/`. Check local files first with `read` / `ls` for instant zero-API access; only fall back to `box_list_assets` + `box_download_file` if the folder is empty or a newly uploaded file isn't synced yet.
2. **Pick the right character pose & logo:** Pick the expression that best matches the video's emotional hook (e.g., `gloom-horrified` for drama/shock, `wink-left-smug` for hot takes, `serious-stare` for deep dives, `laughing-open` for fun/collab). Avoid `solidbg` files unless intentionally placed inside a framed box.
3. **Pick a real photo background:** Call `pixabay_search_backgrounds(query=..., limit=6)` for a high-contrast, uncluttered horizontal photo matching the topic mood, then download the best fit with `pixabay_download_image` to `assets/backgrounds/<slug>.jpg`.
4. **Visually inspect with `read`:** Call `read` on your chosen character/logo/background files so you visually confirm expression, framing, lighting direction, and brand palette before styling.

---

## 2. High-CTR Composition Rules (The 120px Mobile Squint Test)

YouTube thumbnails are viewed mostly on mobile phones at ~120–160px wide. Enforce these rules strictly:
- **Exact Canvas:** `html, body { margin: 0; padding: 0; width: 1280px; height: 720px; overflow: hidden; }`
- **3-Element Maximum Rule:**
  1. **Subject (Character Cutout):** Large, expressive, anchored left or right (45%–58% of frame width), crisp rim light / subtle drop-shadow (`filter: drop-shadow(...)`) to separate cleanly from the background.
  2. **Hook Text (2–4 words MAX):** Huge, bold display typography (`88px–140px`, uppercase or punchy mixed case, thick dark stroke/shadow or solid high-contrast highlight block). **Never repeat the full YouTube title** — complement it with a curiosity gap or emotional punch!
  3. **Background / Context:** Atmospheric, depth-blurred (`filter: blur(3px–6px) brightness(0.55–0.75)`) with a directional dark scrim gradient behind the text side so text contrast is always > 10:1.
- **YouTube Safe Zone:** Keep critical text and logos **out of the bottom-right corner** (`right: 0..220px, bottom: 0..90px`), where YouTube places the video duration badge.
- **Zero Slop Chrome:** No fake UI telemetry, no cluttered bullet lists, no tiny unreadable subtitles, no generic purple AI-slop gradients unless explicitly requested.

---

## 3. Saving & Asset Referencing

Pass every downloaded workspace asset path in `assets: [...]` to `thumbnail_save`, and reference them cleanly in HTML as:
```html
<img src="/assets/dark-library.jpg" class="bg" />
<img src="/assets/light-closeup-gloom-horrified.png" class="character" />
```
`thumbnail_save` automatically copies them into the thumbnail project and rewrites `/assets/<basename>` to same-origin project URLs so live preview and PNG/JPEG export work reliably with zero CORS issues.

---

## 4. Mandatory 120px Mobile Squint-Test Self-Check Loop

Before finishing any thumbnail creation or refinement, run a strict **Squint-Test Self-Check** inside your agent loop:
1. **120px Legibility:** Would the 2–4 word hook still be instantly readable when shrunk to `120×68px` on a mobile YouTube feed? If font size is `< 84px`, word count > 4, or letter-spacing/stroke is thin, tighten the copy and increase weight/size immediately.
2. **Contrast & Separation:** Does the text sit over a dark scrim/highlight block with > 10:1 contrast, and does the character cutout pop from the background via rim-light / drop-shadow + background blur/dimming?
3. **YouTube Duration Safe Zone:** Confirm NO headline text, badge, or logo enters the bottom-right `220×90px` corner (`right <= 220px && bottom <= 90px`).
4. **Auto-Fix Before Returning:** If any check fails (or if an exported PNG exists and `critique_thumbnail` flags readability issues), immediately fix the HTML/CSS and call `thumbnail_save` again on the same slug before replying to the creator.
