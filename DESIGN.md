# LMA (Livestreamer Manager Agent) Design System — Otto Studio Bento OS

Adapted from the **School Personal Desktop** aesthetic for **LMA (`lma` — Livestreamer Manager Agent, Otto)** (`web/`).

---

## 1. Visual Philosophy & Identity

Instead of a generic dark-mode SaaS dashboard or a chat-only wrapper, **Otto Studio Bento OS** treats the streamer's operations workspace as a **calm, tactile, indie creative-studio desktop**:

- **Atmospheric Canvas + Crisp Floating Widgets:** Generously rounded `#FFFFFF` widget cards (`20px` radius, soft `0 3px 6px rgba(0, 0, 0, 0.16)` lift) float over a serene studio backdrop wash (cool silver-mist melting into soft warm terracotta/peach — or optional flat `#DBDBDB` concrete canvas).
- **Mono-First Studio Chrome (`IBM Plex Mono`):** Every widget caption, tab, pill button, input, timestamp, KPI numeral, file-tree entry, and database badge speaks in **`IBM Plex Mono`**, giving the studio the crisp honesty of a producer's desk and terminal scratchpad.
- **Humanist Restraint for Hero & Long Coaching Prose (`Inter` / `Helvetica Neue`):** The top studio greeting (`Hi <Creator>, Otto is (y)our stream manager.`) uses light/regular sans (`300`/`400`), and multi-paragraph coaching replies in Co-Pilot Chat / Dossier Markdown remain effortless to read without wall-of-mono fatigue.
- **Parenthetical Micro-Headers:** Every widget card opens with a centered `11px` `IBM Plex Mono` header strip separated by a hairline `#EDEDED` rule using the signature **`(Y)our <noun>.`** convention — `(Y)our schedule.`, `(Y)our next stream.`, `(Y)our dossier.`, `(Y)our workspace.`, `(Y)our 3+1.`, `(Y)our co-pilot.`, `(Y)our connectors.`.
- **The Highlighted-Letter Marker:** Flat zero-radius `#F9F5A2` (Highlight Yellow) or `#C7F6FF` (Highlight Cyan) marker blocks sit tightly behind emphasized characters/words like **`(y)our`** — signaling *"this studio belongs to you"* without loud neon gradients.
- **100% Human-Crafted Code Mascot (Zero AI Art):** Otto's mascot is a **simple geometric circle with simple expressive eyes**, rendered as pure inline SVG (`OttoMascot.vue`) — reinforcing `lma`'s hard **Strictly Zero AI-Generated Art or Video** guardrail.

---

## 2. Otto Mascot Specification (Pure Inline SVG — Zero AI Art)

Otto is represented exclusively by a minimalist geometric `<svg>` component (`web/src/components/OttoMascot.vue`):

- **Base Geometry:**
  - A clean circular head (`cx="24" cy="24" r="21"`) filled with customizable solid studio ink (default Charcoal `#303030`, or soft pastel swatch options like Mint `#7CC6A5`, Butter `#F9F5A2`, Sky `#A7D8F0`, Peach `#E89B7E`, Lavender `#C9B8E8`).
  - Two simple vertical oval eyes (`rx="4.2" ry="5.6"`, fill `#FFFFFF`, subtle `#303030` `1.2px` stroke on light fills) with crisp round dark pupils (`r="2.1"`, fill `#1A1A1A`).
  - **No mouth, no nose, no 3D raster renders, no AI illustrations** — pure deadpan expressive eyes that carry Otto's blunt-yet-caring personality.
- **Live Agent States (CSS pupil shift — zero heavy animation):**
  - `idle` / `ready`: Pupils centered, calm deadpan gaze (optional gentle CSS blink every ~6s, disabled under `prefers-reduced-motion`).
  - `working` / `busy`: Pupils glance slightly up-right (`translate(1.5px, -1.2px)`) while Otto thinks or runs tools.
  - `error` / `reconnecting`: Slightly wider sclera / centered alert pupils.
- **Top-Bar Eyes Mark:** A compact pill badge on the far left of the header containing just Otto's two simple eyes (`[ 👀 ]` rendered as crisp vector ovals, not platform-inconsistent emoji).

---

## 3. Color Tokens

### Core Monochrome & Canvas Palette

| Name | Hex / Value | CSS Token | Role |
| :--- | :--- | :--- | :--- |
| Charcoal Ink | `#303030` | `--fg` / `--color-charcoal-ink` | Primary text, headings, icons, active pill fills, primary ink |
| Pure Black | `#000000` | `--color-pure-black` | High-contrast icons, Otto pupils, active emphasis |
| Graphite | `#808080` | `--fg-muted` / `--color-graphite` | Secondary labels, timestamps, metadata, inactive captions |
| Smoke | `#C2C2C2` | `--color-smoke` | Disabled text, subtle dividers, scrollbar thumb |
| Paper White | `#FFFFFF` | `--surface` / `--color-paper-white` | Primary floating widget cards, chat assistant cards, login card |
| Fog Mist | `#F2F2F2` | `--surface-alt` / `--color-fog-mist` | Pill buttons, secondary surfaces, hover washes, user message tint |
| Ash Border | `#EDEDED` | `--surface-inset` / `--border` | Recessed input fills (`25px` pill inputs), hairline card header dividers |
| Concrete Gray | `#DBDBDB` | `--bg-flat` / `--color-concrete-gray` | Flat monochrome desktop fallback canvas |
| Studio Backdrop | Multi-stop soft radial/linear wash (`#CBD2DC` → `#DDD8D6` → `#E5A086` → `#DC6B49`) | `--bg-canvas` | Ambient studio desktop backdrop behind floating white cards |

### Functional & Atmospheric Accents (Used Sparingly)

| Name | Hex | CSS Token | Role |
| :--- | :--- | :--- | :--- |
| Highlight Yellow | `#F9F5A2` | `--highlight-yellow` | Signature flat highlighter behind `(y)our` and active micro-emphasis |
| Highlight Cyan | `#C7F6FF` | `--highlight-cyan` | Secondary flat highlighter for swapped/editable tags & `+1 Experiment` |
| Sand Wash | `#E2CEB8` | `--surface-sand` | Optional warm atmospheric card wash |
| Slate Veil | `#6A728E` | `--surface-slate` | Cool atmospheric accent (e.g., countdown / sky tile header) |
| Sky Soft | `#B8DCFA` | `--surface-sky` | Soft sky tint for live status / sprite wake-up mini-widget |

### Restrained Semantic Status Pills

| State | Background | Text | Usage |
| :--- | :--- | :--- | :--- |
| Success / Online / 0 Keys | `#E6F7EE` | `#166534` | `online`, `0 Keys in VM`, `GCal ↗`, `Complete` |
| Warning / Working / Pending | `#F9F5A2` | `#303030` | `working`, `Homework #1 pending`, `+1 EXP` |
| Error / Disabled AI / Destructive | `#FDE8E8` | `#991B1B` | `No AI Art`, `Stop`, `Cancel`, error banners |
| Neutral / Info | `#F2F2F2` | `#303030` | `CORE`, file sizes, storage counter, `Idle sleep ($0/hr)` |

---

## 4. Typography

Loaded via Google Fonts in `web/index.html`:

- **`--font-mono` (`IBM Plex Mono`, weights `400`, `500`, `600`):**
  - Universal OS voice: widget captions (`11px`), top bar pills (`12px`), buttons (`12px–13px`), inputs (`13px–14px`), KPI & countdown numerals (`32px–40px`, weight `400`), timestamps, file manager rows, Studio DB badges, code blocks.
  - OpenType features: `"liga" 0, "calt" 0` for clean terminal rhythm.
- **`--font-sans` (`Inter`, `'Helvetica Neue'`, `Helvetica`, `Arial`, `system-ui`, weights `300`, `400`, `500`, `600`):**
  - Hero studio greeting (`34px–40px`, weight `400`, tight `-0.02em` tracking): `Hi <Creator>, Otto is (y)our stream manager.`
  - Long-form chat replies (`MessageBubble.vue`), Dossier Markdown body, and Markdown document previews for comfortable reading.

### Type Scale

| Role | Font | Weight | Size | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Widget Caption | `--font-mono` | 400 | `11px` | `1.4` | Centered card header: `(Y)our schedule.` |
| Micro Badge / Pill | `--font-mono` | 400–500 | `11px–12px` | `1.3` | Status pills, tabs, tags, timestamps |
| Control / Button | `--font-mono` | 400–500 | `12.5px–13px` | `1.35` | Pill buttons, inputs, table cells |
| Body (Chat & Notes) | `--font-sans` | 400 | `14px` | `1.55` | Coaching messages, dossier prose |
| Widget Heading | `--font-mono` | 500 | `15px–16px` | `1.35` | Section titles inside detail views |
| Countdown / KPI Numeral | `--font-mono` | 400 | `28px–36px` | `1.15` | Next stream countdown (`18:42:10`), key metrics |
| Hero Greeting | `--font-sans` | 400 | `32px–38px` | `1.18` | `Hi <Creator>, Otto is (y)our stream manager.` |

---

## 5. Spacing, Radii & Elevation

- **Base Unit:** `4px` (`--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`)
- **Border Radii:**
  - Widget cards & panels (`--radius-card`): `20px`
  - Embedded media / previews (`--radius-media`): `10px`
  - Pill buttons & badges (`--radius-pill`): `9999px` (or `20px`)
  - Recessed text inputs (`--radius-input`): `25px`
- **Elevation (Clean Soft Floating Shadows — Replacing CafeBlend Neumorphism):**
  - `--shadow-card`: `0 3px 6px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.06)`
  - `--shadow-pill`: `0 1px 4px rgba(0, 0, 0, 0.14)`
  - `--shadow-focus`: `0 0 0 2px #303030` (crisp monochrome focus ring, high accessibility contrast)
- **Card Anatomy (Standardized Widget Frame):**
  ```text
  +--------------------------------------------------+
  |               (Y)our schedule.                   |  <- 11px IBM Plex Mono, centered, 8px 16px,
  +--------------------------------------------------+     border-bottom: 1px solid #EDEDED
  |                                                  |
  |   [Widget Body — padding: 16px 20px]             |
  |                                                  |
  +--------------------------------------------------+
  ```

---

## 6. Layout Architecture & Component Mapping (`web/`)

### Desktop Layout (`>= 1024px`)
- **Floating Top Bar (`ChatHeader.vue`):**
  - Transparent over the studio backdrop (`padding: 12px 20px`), with floating `#FFFFFF` pill clusters (`box-shadow: var(--shadow-pill)`):
  - **Left cluster:** `[Otto Eyes SVG Pill]` + segmented view switcher pill (`Overview` | `Schedule` | `Files & Clips` | `Studio DB` | `Dossier` | `Connectors`) + tiny `i` guardrail popover/badges.
  - **Right cluster:** Guardrail pills (`0 Keys in VM`, `No AI Art`, `● online`) + mini circular **Otto Avatar** (`OttoMascot.vue`).
- **Two-Column Studio Desktop (`App.vue`):**
  - **Left Primary Desktop (`flex: 1`, scrollable):**
    - **Overview View (Studio Bento Mosaic):**
      - Top row left: **Studio Greeting Block** directly on the ambient canvas — `Hi <Creator>, [Otto SVG]` / `Otto is [y]our stream manager.` (`(y)our` highlighted in `#F9F5A2`) + two `#F2F2F2` monospace metadata pills (handle/timezone + `0 Keys · No AI Art`).
      - Top row right: Two compact floating widgets side-by-side inspired directly by the reference:
        1. **`(Y)our sprite.`** (soft sky/slate atmospheric mini-tile: `Idle sleep ($0/hr)` + `8 connectors live` + armed wake-ups count).
        2. **`(Y)our next stream.`** (oversized `IBM Plex Mono` live countdown `HH:MM:SS` to next scheduled stream + `#F2F2F2` pill button `Prep with Otto`!).
      - Main Bento Grid (`2 columns`):
        - **`(Y)our schedule.`** — Quick-add pill input (`25px` radius, `#EDEDED` fill) + upcoming events with `GCal ↗`, QStash wake-up pills, `Prep`, `✕`.
        - **`(Y)our dossier.`** — Persona, Timezone, YouTube baseline, Homework #1 status pill, `Audit Dossier` & `Audit YouTube` pill buttons.
        - **`(Y)our workspace.`** — Unified 2-way files & clips preview, quick `Upload` & `Scan VOD` pills, live 3+1 Studio DB footer bar.
        - **`(Y)our connectors.`** — `0 Outbound Keys in VM`, `AI Art & Video: Disabled`, live gateway connector chips.
    - **Detail Views (`Schedule`, `Files & Clips`, `Studio DB`, `Dossier`, `Connectors`):** Each framed in crisp `#FFFFFF` `20px` widget cards with centered `(Y)our ...` monospace header strips.
  - **Right Docked Co-Pilot Card (`430px` floating `#FFFFFF` card, `20px` radius, `var(--shadow-card)`):**
    - Centered `(Y)our co-pilot.` header strip with `Chats (N)` and `+ New` pill buttons.
    - Clean chat stream (`MessageBubble.vue`): Otto messages with mini `OttoMascot` SVG avatar + readable sans prose; user messages in soft `#F2F2F2` rounded bubbles (`16px` radius).
    - Pinned `TodoChecklistCard.vue` above `ChatComposer.vue` (`#EDEDED` `25px` pill textarea + `📎` workspace upload pill + `#303030` Charcoal primary `Send` pill).
- **Mobile (`< 1024px`):** Clean segmented toggle pill in the top bar (`Studio | Otto Chat`) switching cleanly between the desktop bento and Co-Pilot Chat.

### Passcode Gate (`web/server.ts` `LOGIN_HTML`)
- Centered `#FFFFFF` `20px`-radius widget card floating on the exact **Otto Studio backdrop gradient**, opening with the `(Y)our studio.` `11px` monospace header strip, centered `OttoMascot` SVG circle-with-eyes, `"Otto is (y)our stream manager."` (`(y)our` in `#F9F5A2`), `#EDEDED` `25px` passcode input, and `#303030` Charcoal pill button `Unlock Studio`.

### DaisyUI v5 Theme (`web/src/styles/daisy.css`)
Replace `lma-cafe` with custom theme `lma-otto`:
- `base-100: #FFFFFF`
- `base-200: #F2F2F2`
- `base-300: #EDEDED`
- `base-content: #303030`
- `primary: #303030` (`primary-content: #FFFFFF`)
- `secondary: #F2F2F2` (`secondary-content: #303030`)
- `accent: #F9F5A2` (`accent-content: #303030`)
- `success: #16A34A`, `warning: #D97706`, `error: #DC2626`
- `--radius-box: 1.25rem` (`20px`), `--radius-field: 1.5625rem` (`25px`), `--radius-selector: 9999px`

---

## 7. CSS Custom Properties Reference (`web/src/styles/tokens.css`)

```css
:root {
  /* Palette */
  --fg: #303030;
  --fg-strong: #000000;
  --fg-muted: #808080;
  --fg-subtle: #A3A3A3;
  --surface: #FFFFFF;
  --surface-alt: #F2F2F2;
  --surface-inset: #EDEDED;
  --surface-inset-hover: #E5E5E5;
  --surface-sand: #E2CEB8;
  --surface-slate: #6A728E;
  --surface-sky: #B8DCFA;
  --border: #EDEDED;
  --border-strong: #D9D9D9;
  --bg-flat: #DBDBDB;
  --bg-canvas:
    radial-gradient(circle at 12% 10%, #D3D7DF 0%, rgba(211, 215, 223, 0) 48%),
    radial-gradient(circle at 92% 14%, #DF6F48 0%, rgba(223, 111, 72, 0) 52%),
    radial-gradient(circle at 86% 88%, #E17F5E 0%, rgba(225, 127, 94, 0) 50%),
    radial-gradient(circle at 14% 88%, #E49A7B 0%, rgba(228, 154, 123, 0) 52%),
    linear-gradient(135deg, #D9D6D5 0%, #DDD5D3 50%, #E7B39C 100%);

  /* Accents & Highlights */
  --accent: #303030;
  --accent-hover: #141414;
  --accent-fg: #FFFFFF;
  --highlight-yellow: #F9F5A2;
  --highlight-cyan: #C7F6FF;

  /* Semantic */
  --success: #166534;
  --success-bg: #E6F7EE;
  --warning: #854D0E;
  --warning-bg: #F9F5A2;
  --error: #991B1B;
  --error-bg: #FDE8E8;

  /* Typography */
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: "Inter", "Helvetica Neue", Helvetica, Arial, -apple-system, sans-serif;

  /* Radii & Elevation */
  --radius-card: 20px;
  --radius-media: 10px;
  --radius-input: 25px;
  --radius-pill: 9999px;
  --shadow-card: 0 3px 6px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-pill: 0 1px 4px rgba(0, 0, 0, 0.14);
  --shadow-focus: 0 0 0 2px #303030;
}
```

---

## 8. Do's & Don'ts

### Do
- Frame every dashboard widget in a `#FFFFFF` `20px`-radius card with a centered `11px` `IBM Plex Mono` `(Y)our <noun>.` caption strip and hairline `#EDEDED` divider.
- Keep buttons calm `#F2F2F2` monochrome pills (`#303030` text) and reserve solid Charcoal `#303030` pills strictly for the single primary action per card (`Send`, `+ Upload`, `+ Add`, `Audit Dossier`).
- Use `#F9F5A2` Highlight Yellow strictly as a flat typographic marker (`(y)our`, pending nudges) — never as a loud button fill.
- Render **Otto** strictly as the pure-code geometric circle + simple expressive SVG eyes (`OttoMascot.vue`), never AI-generated art.

### Don't
- Do not use neumorphic double-shadows (`#D5C9B8`) or coffee-brown (`#8B5E3C`) leftovers from CafeBlend.
- Do not add dark-mode neon gradients, glowing borders, or cluttered marketing hero banners.
- Do not leak developer jargon (`omp`, `QStash`, `MEMORY.md`, `SQLite`) in user-facing widget captions — keep every caption cheeky, minimal, and studio-native (`(Y)our schedule.`, `(Y)our dossier.`, `(Y)our workspace.`, `(Y)our 3+1.`).
