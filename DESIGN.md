# `lma` Design System — CafeBlend Studio

Adapted from the **CafeBlend Design System** for **Professor L — Livestreamer Manager Agent** (`web/`).

## Overview
Instead of another generic dark-mode neon AI dashboard, `lma` uses a **warm, tactile, coffee-toned studio aesthetic** ("Professor L's Green Room"). Warm cream surfaces (`#FDF6EC`), espresso ink (`#3E2723`), roasted brown accents (`#8B5E3C`), and soft neumorphic `raised`/`inset` elevation make long coaching sessions, stream planning, and clip reviews feel calm, focused, and unmistakably human.

---

## Colors
- **Primary (`--accent`)**: `#8B5E3C` (hover `#6B4226`) — Primary CTAs, active indicators, selected sidebar accent
- **Secondary**: `#C4956A` — Decorative accents, subtle tags
- **Background (`--bg`)**: `#FDF6EC` — Warm cream canvas (required base for neumorphic shadows)
- **Surface (`--surface`)**: `#FFFFFF` — Raised assistant cards, Mission Control cards, login card
- **Surface Tint (`--surface-alt`)**: `#FAF0E1` — Hover states, filter chips, table headers
- **Surface Inset (`--surface-inset`)**: `#F0E6D6` — Chat composer, passcode input, user bubble wash
- **Text Primary (`--fg`)**: `#3E2723` — Espresso ink
- **Text Muted (`--fg-muted`)**: `#6D4C41` — Secondary labels, metadata, ThoughtTrace body
- **Divider (`--border`)**: `#E8DDD0` — Subtle 1px dividers
- **Semantic Status Chips (Pill):**
  - **Success / Live**: `#DCFCE7` bg / `#059669` text
  - **Warning / Working**: `#FEF3C7` bg / `#D97706` text
  - **Error / Disabled AI**: `#FEE2E2` bg / `#EF4444` text
  - **Info**: `#EDE9FE` bg / `#6366F1` text

---

## Typography
Loaded via Google Fonts in `web/index.html`:
- **Headline Font (`--font-serif`)**: `DM Serif Display` — Used sparingly for brand title ("Professor L"), empty-state hero heading, Mission Control title, and Login Gate heading (never for body copy)
- **Body Font (`--font-sans`)**: `Work Sans` — Chat messages, lists, buttons, controls
- **Mono Font (`--font-mono`)**: `IBM Plex Mono` — Status pills, timestamps, connector badges, clip sizes, code blocks

---

## Border Radius & Elevation
- **Radius:** `6px` (`--radius-sm` tags), `12px` (`--radius` buttons/cards/inputs), `16px` (`--radius-lg` modals/panels), `9999px` (`--radius-pill` avatars/status chips)
- **Neumorphic Shadows (applied ONLY on `#FDF6EC` warm cream background):**
  - `--shadow-raised`: `6px 6px 12px #D5C9B8, -6px -6px 12px #FFFFFF`
  - `--shadow-raised-sm`: `3px 3px 7px #D5C9B8, -3px -3px 7px #FFFFFF`
  - `--shadow-inset`: `inset 4px 4px 8px #D5C9B8, inset -4px -4px 8px #FFFFFF`
  - `--shadow-focus`: `0 0 0 3px rgba(139, 94, 60, 0.25)`

---

## Component Mapping in `web/`
- **DaisyUI v5 Theme (`web/src/styles/daisy.css`):** Custom `@plugin "daisyui/theme" { name: "lma-cafe"; ... }` maps the exact CafeBlend palette to DaisyUI tokens (`base-100`, `primary`, `success`, `warning`, `error`, `radius-box: 0.75rem`).
- **Chat Bubbles (`MessageBubble.vue`):** Assistant messages sit on `#FFFFFF` raised cards (`12px` radius); user messages sit on soft `#FAF0E1` tinted cards with `#8B5E3C` meta label.
- **Chat Composer (`ChatComposer.vue`):** Inset `#F0E6D6` textarea with `--shadow-inset` and `--shadow-focus` ring; `#8B5E3C` raised primary Send button.
- **Session Sidebar (`SessionSidebar.vue`):** `#FDF6EC` rail with `#E8DDD0` dividers; hover `#FAF0E1`; active chat `#F0E6D6` with `3px` left `#8B5E3C` border.
- **Mission Control Drawer (`MissionControlDrawer.vue`):** Warm cream slide-over with raised `#FFFFFF` cards for Talent Dossier, Zero-Key Connectors, and Raw Clips Shelf.
- **Passcode Gate (`web/server.ts` `LOGIN_HTML`):** Centered `#FFFFFF` raised card on `#FDF6EC` cream background with DM Serif Display title and inset passcode field.
