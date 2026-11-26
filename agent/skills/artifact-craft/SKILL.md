---
name: artifact-craft
description: Design and build non-slop, tactile, object-grounded interactive artifacts (HTML/CSS/JS, React/JSX, SVG, Mermaid) for Otto Studio OS using `artifact_create`. Activate whenever creating a visual or interactive artifact so the UI looks crafted rather than generic AI output.
---

# Artifact Craft — Zero-Slop UI Design for Otto Studio OS

Whenever you build an interactive artifact with `artifact_create` (OBS overlays, stream countdowns, sponsor rate calculators, media kits, interactive rundowns, analytics dashboards, channel widgets), **never ship the generic AI average**. Ground every artifact in a concrete physical object and block the 10 AI-slop patterns before writing code.

---

## 1. The 10 AI-Slop Patterns (Hard Ban)

Avoid all ten unless the user explicitly asks for them:
1. **Purple-to-blue / neon-pink gradients** and **gradient text**.
2. **Repeated identical rounded shadow cards** (4+ cards with the same soft drop shadow).
3. **Glassmorphism (`backdrop-filter: blur`)** on 2+ elements.
4. **Stock-only typefaces** (plain Inter / system-ui / Roboto / Poppins everywhere) with no typographic voice.
5. **Emoji used as UI icons** — use crisp inline `<svg>` or `lucide-react` icons instead.
6. **Stock AI copy** (*"Welcome back"*, *"seamless"*, *"unlock"*, *"all-in-one"*, *"elevate"*, *"supercharge"*).
7. **3+ decorative pill badges** or status dots scattered across headers.
8. **Over-centered layouts** (>60% of text centered).
9. **Uniform large `border-radius`** on >70% of elements.
10. **Decorative shaders/auroras** (drifting MeshGradient / glowing orbs chasing the cursor).

Also always obey Otto's core studio rules:
- **Strictly NO AI-generated images or video** inside artifacts.
- **Never invent fake reviews, awards, official marks, or real people's private data.**

---

## 2. Start With a Real Physical Object (Not Adjectives)

Adjectives (*"clean, modern, premium, techy"*) produce generic templates. Before writing code, pick **one concrete real-world object** that fits the creator's task and borrow its rules:

| Creator Artifact | Real-World Object to Borrow From | Visual & Structural Rules |
| :--- | :--- | :--- |
| Stream countdown / OBS overlay | **Broadcast tally monitor / studio slate / clapperboard** | Sharp 1px hairlines, tabular condensed numerals, single red/amber "ON AIR" accent, timecode strip |
| Stream rundown / show notes | **Producer's clipboard / cue sheet / receipt strip** | Monospace timestamps, ruled rows, checkable tear-off or stamped cues, warm paper or crisp off-white |
| Sponsor rate-card calculator | **Studio invoice / rate sheet / print spec card** | Structured ledger grid, heavy top rule, live-updating tabular totals, zero floating SaaS cards |
| Analytics / VOD breakdown | **Telemetry strip / mixing console / newspaper sports table** | Dense scannable columns, strong typographic hierarchy, one hero metric, restrained ink + 1 accent |
| Media kit / channel one-pager | **Editorial press sheet / magazine masthead / concert poster** | Strong display headline, asymmetric column grid, real whitespace, crisp dividers |
| Interactive checklist / tracker | **Index card / flight departure board / punch card** | Mechanical state transitions, tactile toggles, clear done/pending contrast |

**Four-point sanity check:**
1. Hide the title — does the layout still communicate what it is?
2. Did you borrow type, color, and layout from the object instead of inventing random SaaS boxes?
3. Does one real action become a tactile interaction (toggling ON AIR, stamping a cue done, sliding a sponsor tier)?
4. Is every control actually operable (buttons respond, inputs recalculate, tabs/filters work)?

---

## 3. Typography, Color & Layout Floor

- **Typography:** Pair **one display face with character** (e.g., Google Fonts condensed/editorial/mono like `Space Grotesk`, `Instrument Serif`, `Archivo Black`, `JetBrains Mono`, `IBM Plex Mono`, `Bebas Neue` for big numbers) with **one readable body face**. Use `font-variant-numeric: tabular-nums` for timers, counters, and calculators.
- **Color:** Take the palette from the object. Use **one accent color for one meaning only** (live, active, selected, or primary CTA). Keep contrast high on the smallest text.
- **Layout:** Generous whitespace, strong size contrast, **one clear hero** per view, left-aligned scannable text, zero horizontal overflow.

---

## 4. Optional Material Texture (WebGPU Shaders — Only When Material Fits)

If the chosen object has a distinct physical surface (paper, newsprint, CRT monitor, brushed metal, frosted glass), you may optionally add **at most one** subtle static material canvas behind the surface using `shaders@4.0.2` (MIT) with a solid CSS fallback:

| Material | Components |
| :--- | :--- |
| Paper / cue sheet / receipt | `SolidColor` + `Paper` + subtle `FilmGrain` |
| Broadcast CRT / retro gaming | `SolidColor` + `CRTScreen` or `Dither` |
| Studio hardware / metal | `SolidColor` + `BrushedMetal` |

Rules:
- Always provide a matching CSS `background` fallback (in case WebGPU is unavailable).
- Keep it **mostly still** and subtle — never sacrifice text contrast.
- Respect `prefers-reduced-motion` (`shader.pause()`).
- If removing the shader doesn't make the object feel less real, **delete it**.

---

## 5. Self-Critique Before Calling `artifact_create`

Before finalizing the artifact, check these 5 questions (aim for 7+/10 on each):
1. **Concept:** Without the title, is the real-world object still recognizable?
2. **Hierarchy:** Is there one clear hero and strong size contrast?
3. **Zero Slop:** Zero purple gradients, zero emoji icons, zero stock AI copy, zero cookie-cutter SaaS cards?
4. **Operability:** Do all buttons, inputs, and interactive states actually work?
5. **Readability:** Is the smallest/faintest text clearly legible with no overflow?
