---
name: thumbnail-craft
description: Design and composite 100% non-AI-generated 1280x720 YouTube and livestream thumbnails using real creator cutouts (Box Otto Assets), royalty-free human photography (Pixabay), and deterministic HTML/CSS in Thumbnail Studio.
---

# Thumbnail Craft — High-CTR Non-AI Thumbnail Compositing (`1280×720`)

Use `thumbnail_save` whenever the creator asks to design, compose, or refine a YouTube or livestream thumbnail.

**Non-Negotiable Rule:** **STRICTLY ZERO AI-GENERATED IMAGES.** Never call an image generator and never use AI-generated stock art. Every visual element MUST come from:
1. **Creator's own real assets** in `/home/sprite/workspace/assets/` (synced from Box `Otto Assets/`: `Characters/`, `Logos/`, `Backgrounds/`) or uploaded attachments.
2. **Code-crafted CSS/SVG backgrounds (First-Class Choice):** Rich directional gradients, dramatic studio radial spotlights, high-contrast split-color blocks, subtle halftone/grid/grain patterns, or clean editorial dark backdrops — fast, ultra-crisp at 120px, and often cleaner than busy photos.
3. **Real human photography backgrounds (Optional):** From Pixabay (`pixabay_search_backgrounds` + `pixabay_download_image`, strictly `isAiGenerated === false`) or real VOD frames from `/home/sprite/workspace/clips/` whenever a specific photographic scene adds story context.

---

## 1. Asset Discovery & Multimodal Style Matching Workflow

Before writing HTML:
1. **Check local synced assets FIRST (`/home/sprite/workspace/assets/`):** Box `Otto Assets/` (`Characters/`, `Logos/`, `Backgrounds/`) is incrementally synced into `/home/sprite/workspace/assets/`. Check local files first with `read` / `ls` for instant zero-API access; only fall back to `box_list_assets` + `box_download_file` if the folder is empty or a newly uploaded file isn't synced yet.
2. **Pick the right character pose & logo:** Pick the expression that best matches the video's emotional hook (e.g., `gloom-horrified` for drama/shock, `wink-left-smug` for hot takes, `serious-stare` for deep dives, `laughing-open` for fun/collab). Avoid `solidbg` files unless intentionally placed inside a framed box.
3. **Choose the best background style (Code vs Photo):** You do **NOT** need a photo background for every thumbnail. Use a **code-crafted CSS/SVG background** (bold studio gradients, radial rim-light glows, split color blocks, subtle geometric/halftone textures) whenever clean visual punch works best — or call `pixabay_search_backgrounds(query=..., limit=6)` + `pixabay_download_image` to `assets/backgrounds/<slug>.jpg` when a real photographic scene genuinely strengthens the hook.
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

## 4. Mandatory Visual Render & Inspection Loop (`thumbnail_render` → `read`)

**NEVER ship a thumbnail blind from code alone.** Before finishing any thumbnail creation or refinement, you MUST visually inspect the real rendered `1280×720` image:
1. **Render to JPG:** Call `thumbnail_render(slug="<slug>", format="jpg")` to render the exact `1280×720` image via headless Chrome.
2. **Inspect Visually with `read`:** Call `read` on the returned `filePath` so you literally **see** the rendered thumbnail.
3. **Check 4 Hard Gates:**
   - **Zero Face/Subject Overlap:** Text, badges, and logos MUST NEVER cover the character's face, eyes, or mouth. Keep the headline strictly inside its own side column (e.g., left `max-width: 560px–600px`) and anchor the character cleanly on the opposite side (e.g., right `44%–54%` of frame) with clear visual separation.
   - **Clean Framing:** No awkward head/chin clipping, no floating torso gap at the bottom edge.
   - **120px Legibility & Contrast:** Would the 2–4 word hook still read instantly at `120×68px` on a phone? (> 10:1 contrast over a dark scrim/highlight block, `>= 84px` bold display font).
   - **YouTube Duration Safe Zone:** Confirm NO headline text, badge, or logo enters the bottom-right `220×90px` corner (`right <= 220px && bottom <= 90px`).
4. **Auto-Fix Before Returning:** If ANY gate fails when you look at the rendered JPG, immediately fix the HTML/CSS, call `thumbnail_save` on the same slug, and run `thumbnail_render` + `read` again (up to 2 fix passes) until visually clean.
