---
name: artifact-craft
description: Design and build non-slop, tactile, object-grounded interactive artifacts (HTML/CSS/JS, React/JSX, SVG, Mermaid) for Otto Studio OS using `artifact_create`. Combines physical-object design direction with strict `unslop-ui` copy, chrome, and chart cleanup rules.
---

# Artifact Craft — Zero-Slop UI Design for Otto Studio OS

Whenever you build an interactive artifact with `artifact_create` (OBS overlays, stream countdowns, sponsor rate calculators, media kits, interactive rundowns, analytics dashboards, channel widgets), **never ship the generic AI average** and **never leave decorative AI chrome**. A good interface is used, not read: keep the words and controls a person needs to act, and cut the rest.

---

## 1. Visual & Layout Slop Patterns (Hard Ban)

Avoid all ten unless the user explicitly asks for them:
1. **Purple-to-blue / neon-pink gradients** and **gradient text**.
2. **Repeated identical rounded shadow cards** (4+ cards with the same soft drop shadow).
3. **Glassmorphism (`backdrop-filter: blur`)** on 2+ elements.
4. **Stock-only typefaces** (plain Inter / system-ui / Roboto / Poppins everywhere) with no typographic voice.
5. **Emoji used as UI icons** — use crisp inline `<svg>` or `lucide-react` icons only where an icon carries meaning or sits in an action toolbar.
6. **Decorative edge accent stripes (`border-l-4`, `border-t-[3px]`, colored `::before` bars)** — looks semantic but encodes nothing. Use a 1px border all round or a neutral tint instead (keep colored bars only for real `role="alert"` error/warning states).
7. **Over-centered layouts** (>60% of text centered).
8. **Uniform large `border-radius`** on >70% of elements.
9. **Equal stat cards** — never put 3–4 identical KPI boxes with the same visual weight; give the primary figure the weight and make secondary numbers quieter.
10. **Decorative shaders/auroras** (drifting MeshGradient / glowing orbs chasing the cursor).

Also always obey Otto's core studio rules:
- **Strictly NO AI-generated images or video** inside artifacts.
- **Never invent fake reviews, awards, official marks, or real people's private data.**

---

## 2. Copy, Chrome & Chart Cleanup (`unslop-ui` Rules)

Apply these strictly to every visible string, label, badge, and chart inside the artifact:

### Interface Copy
- **No eyebrow labels:** Cut small uppercase/letter-spaced captions above headings or panels (`MASTER TIMER`, `MONITOR THEME`, `PRE-SHOW SLATE`, `FEATURES`). Let the heading or controls speak for themselves.
- **No decorative numbering:** Cut `01`, `02`, `03`, `01 //`, `§` prefixes on checklists, cards, or feature lists. Only number real sequential steps where order matters.
- **No subtitle reflex or botsplaining:** Don't put a filler subtitle under every heading or narrate what a control visibly does (*"Click Start to begin"*, *"This chart shows..."*). Keep a subtitle only if it states a concrete fact not already visible.
- **No leaked design notes:** Cut parentheticals like `(updates in real time)`, `(powered by AI)`, or fake metadata labels (`FEED ALPHA-05`, `LIVE SYNC`).
- **No chained status strings:** Don't chain facts with `·` or `|` (`TC 00:05:00 / SET 05:00`, `12 items · Synced · v2.1`). Keep the one fact the user acts on.
- **No redundant labels:** Pick one cue per control (visible label OR placeholder format, never both repeating the same word).
- **Sentence case & short headings:** Use sentence case; keep section headings and card titles to ≤5 words.
- **No AI vocabulary or em dashes:** Cut *seamless, unlock, elevate, leverage, showcase, robust, all-in-one*; replace em dashes (`—`) with a period or comma.

### Decoration & Links
- **Real-state test for badges & dots:** Only render a badge (`LIVE`, `PAUSED`, `OBS`) or colored/pulsing dot if it is bound to **real reactive state** that changes. Static fixed-text badges and decorative colored dots are banned.
- **No arrows on buttons/links:** Don't append `→` or `<ArrowRight />` to button or link labels (keep `↗` only for external links).
- **Specific button/link labels:** Never use generic *"Submit"*, *"Click here"*, *"Learn more"* — name the actual action (*"Start timer"*, *"Download OBS HTML"*).

### Charts & Data Views
- **Neutral titles:** Never name the chart type (*"Bar chart of viewers"* → *"Peak viewers"*).
- **No reading instructions:** Cut *"Hover for details"* or *"Each bar represents..."*.
- **Encode each value once:** Don't stack bar height + printed value + gridline + axis tick + redundant progress bar for the same number.
- **Minimal scaffolding:** No plot frame boxes, dark/dense gridlines, 3D, or drop shadows on marks. Use direct series labels instead of a separate legend box whenever ≤4 series.

---

## 3. Start With a Real Physical Object (Not Adjectives)

Adjectives (*"clean, modern, premium, techy"*) produce generic templates. Pick **one concrete real-world object** that fits the creator's task and borrow its rules:

| Creator Artifact | Real-World Object | Structural & Visual Rules |
| :--- | :--- | :--- |
| Stream countdown / OBS overlay | **Broadcast tally monitor / studio slate** | Sharp 1px hairlines, tabular condensed numerals, single red/amber accent bound to real running/live state |
| Stream rundown / show notes | **Producer's cue sheet / receipt strip** | Monospace timestamps, ruled rows, checkable cues, warm paper or crisp off-white |
| Sponsor rate-card calculator | **Studio invoice / print spec sheet** | Structured ledger grid, heavy top rule, live-updating tabular totals, zero floating SaaS cards |
| Analytics / VOD breakdown | **Telemetry strip / newspaper sports table** | Dense scannable columns, one hero metric, restrained ink + 1 accent |
| Media kit / channel one-pager | **Editorial press sheet / concert poster** | Strong display headline, asymmetric column grid, real whitespace, crisp dividers |

---

## 4. Typography, Color & Optional Material Shaders

- **Typography:** Pair **one display face with character** (e.g. `Archivo Black`, `Instrument Serif`, `Space Grotesk`, `IBM Plex Mono`, `Bebas Neue` for big numerals) with **one readable body face**. Always use `font-variant-numeric: tabular-nums` for timers, counters, and calculators.
- **Color:** Take the palette from the object. Use **one accent color for one meaning only** (live, active, or primary CTA).
- **Optional WebGPU Material (`shaders@4.0.2` MIT):** Only when the physical object has a real surface (`Paper`, `FilmGrain`, `CRTScreen`, `BrushedMetal`), at most 1 static canvas with a matching CSS fallback and `prefers-reduced-motion` pause. If removing it doesn't make the surface feel less real, delete it.

---

## 5. Final Unslop Pass Before Calling `artifact_create`

Before saving the artifact, strip it down:
1. Delete every uppercase eyebrow, `01/02/03` decorative number, fake badge (`LIVE SYNC`, `FEED ALPHA-05`), and chained `·` status string.
2. Delete every decorative edge stripe, dot, or emoji icon not bound to real state.
3. Verify one clear hero, high text contrast, zero horizontal overflow, and that every button/input actually works.
