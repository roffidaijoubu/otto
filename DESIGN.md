# LMA (Livestreamer Manager Agent) Design System — Otto Studio Bento OS

Adapted from the **School Personal Desktop** aesthetic for **LMA (`lma` — Livestreamer Manager Agent, Otto)** (`web/`).

---

## 1. Visual Philosophy & Identity

Instead of a generic dark-mode SaaS dashboard or a chat-only wrapper, **Otto Studio Bento OS** treats the streamer's operations workspace as a **calm, tactile, indie creative-studio desktop**:

- **Atmospheric Canvas + Crisp Floating Widgets:** Generously rounded `#FFFFFF` widget cards (`20px` radius, soft `0 3px 6px rgba(0, 0, 0, 0.14)` + `0 1px 2px rgba(0, 0, 0, 0.06)` lift) float over a serene studio backdrop wash (cool silver-mist melting into soft warm terracotta/peach — or optional flat `#DBDBDB` concrete canvas).
- **Mono-First Studio Chrome (`IBM Plex Mono`):** Every widget caption, tab, pill button, input, timestamp, KPI numeral, file-tree entry, and database badge speaks in **`IBM Plex Mono`**, giving the studio the crisp honesty of a producer's desk and terminal scratchpad.
- **Humanist Restraint for Hero & Long Prose (`Inter` / `Helvetica Neue`):** The top studio greeting (`Hi <Creator>, Otto is (y)our stream manager.`) uses light/regular sans (`300`/`400`), and multi-paragraph replies in Otto Chat / Profile Markdown remain effortless to read without wall-of-mono fatigue.
- **Parenthetical Micro-Headers:** Every widget card opens with a centered `11px` `IBM Plex Mono` header strip separated by a hairline `#EDEDED` rule using the signature **`(Y)our <noun>.`** convention — `(Y)our schedule.`, `(Y)our next stream.`, `(Y)our profile.`, `(Y)our workspace.`, `(Y)our co-pilot.`, `(Y)our connectors.`, `(Y)our playbooks.`.
- **The Highlighted-Letter Marker:** Flat zero-radius `#F9F5A2` (Highlight Yellow) or `#C7F6FF` (Highlight Cyan) marker blocks sit tightly behind emphasized characters/words like **`(y)our`** — signaling *"this studio belongs to you"* without loud neon gradients.
- **100% Human-Crafted Code Mascot (Zero AI Art):** Otto's mascot is a **simple geometric circle with simple expressive eyes**, rendered as pure inline SVG (`OttoMascot.vue`) — reinforcing `lma`'s hard **Strictly Zero AI-Generated Art or Video** guardrail.

---

## 2. Otto Mascot Specification (Pure Inline SVG — Zero AI Art)

Otto is represented exclusively by a minimalist geometric `<svg>` component (`web/src/components/OttoMascot.vue`):

- **Base Geometry:**
  - A clean circular head (`cx="24" cy="23.5" r="20.6"`) filled with customizable solid studio ink (default Charcoal `#303030`, or soft pastel swatch options like Mint `#7CC6A5`, Butter `#F9F5A2`, Sky `#A7D8F0`, Peach `#E89B7E`, Lavender `#C9B8E8`).
  - Two simple vertical oval eyes (`rx="4.5" ry="5.7"`, fill `#FFFFFF`) with crisp round dark pupils (`r="2.35"`, fill `#1F1F1F`). The standalone "eyes mark" variant uses slightly larger ovals (`rx="5.2" ry="6.6"`) with a `#303030` `1.6px` stroke.
  - **No mouth, no nose, no 3D raster renders, no AI illustrations** — pure deadpan expressive eyes that carry Otto's blunt-yet-caring personality.
- **Live Agent States (CSS/SVG pupil shift — zero heavy animation):**
  - `ready`: Pupils centered, calm deadpan gaze (optional gentle CSS blink every `6.5s`, disabled under `prefers-reduced-motion`).
  - `busy`: Pupils follow a smooth cursor-linked 3D parallax offset while Otto thinks or runs tools.
  - `error`: Crossed-out alert eyes (an `X` drawn over each eye) for reconnecting/error states.
- **Top-Bar Eyes Mark:** A compact pill badge on the far left of the header containing just Otto's two simple eyes (`[ 👀 ]` rendered as crisp vector ovals, not platform-inconsistent emoji).

---

## 3. Color Tokens

### Core Monochrome & Canvas Palette

| Name | Hex / Value | CSS Token | Role |
| :--- | :--- | :--- | :--- |
| Charcoal Ink | `#303030` | `--fg` | Primary text, headings, icons, active pill fills, primary ink |
| Pure Black | `#000000` | `--fg-strong` | High-contrast icons, Otto pupils, active emphasis |
| Graphite | `#808080` | `--fg-muted` | Secondary labels, timestamps, metadata, inactive captions |
| Subtle Gray | `#A3A3A3` | `--fg-subtle` | Disabled text, faint timestamps |
| Paper White | `#FFFFFF` | `--surface` | Primary floating widget cards, chat assistant cards, login card |
| Fog Mist | `#F2F2F2` | `--surface-alt` | Pill buttons, secondary surfaces, hover washes, user message tint |
| Ash Border | `#EDEDED` | `--surface-inset` / `--border` | Recessed input fills (`25px` pill inputs), hairline card header dividers |
| Border Strong | `#D9D9D9` | `--border-strong` | Hover/pressed outlines on inset controls |
| Concrete Gray | `#DBDBDB` | `--bg` / `--bg-flat` | Flat monochrome desktop fallback canvas |
| Studio Backdrop | Multi-stop soft radial/linear wash (`#CFD5DF` / `#DC6B46` / `#DF7A59` / `#E59D81` + `#D7D5D6 → #DCD4D2 → #E6B29A`) | `--bg-canvas` | Ambient studio desktop backdrop behind floating white cards |

### Functional & Atmospheric Accents (Used Sparingly)

| Name | Hex | CSS Token | Role |
| :--- | :--- | :--- | :--- |
| Highlight Yellow | `#F9F5A2` | `--highlight-yellow` | Signature flat highlighter behind `(y)our` and active micro-emphasis |
| Highlight Cyan | `#C7F6FF` | `--highlight-cyan` | Secondary flat highlighter for swapped/editable tags & `+1 Experiment` |
| Sand Wash | `#E2CEB8` | `--surface-sand` | Optional warm atmospheric card wash (defined; not currently consumed by components) |
| Slate Veil | `#6A728E` | `--surface-slate` | Cool atmospheric accent (defined in `tokens.css`; `#6A728E` is also mapped to `--chart-2` in `globals.css`) |
| Sky Soft | `#B8DCFA` | `--surface-sky` | Soft sky tint (defined; the sprite tile currently hardcodes its own sky gradient) |

### Restrained Semantic Status Pills

| State | Background | Text | Usage |
| :--- | :--- | :--- | :--- |
| Success / Online | `#E6F7EE` | `#166534` | `online`, `GCal ↗`, `Complete`, saved-playbook badges |
| Warning / Pending | `#F9F5A2` | `#854D0E` | `working`, `pending review`, armed wake-ups |
| Error / Disabled AI / Destructive | `#FDE8E8` | `#991B1B` | `Stop`, `Cancel`, error banners, destructive actions |
| Neutral / Info | `#F2F2F2` (neutral) / `#C7F6FF` (`--info-bg`) | `#303030` | format badges, file sizes, storage counter, `Fly.io Sprite · $0 idle` |

---

## 4. Typography

Loaded via Google Fonts in `web/index.html`:

- **`--font-mono` (`IBM Plex Mono`, weights `400`, `500`, `600`):**
  - Universal OS voice: widget captions (`11px`), top bar pills (`11px–12px`), buttons (`12px–13px`), inputs (`13px–14px`), KPI & countdown numerals (`28px–36px` via `clamp()`, weight `400`), timestamps, file manager rows, Studio DB badges, code blocks.
  - OpenType features: `"liga" 0, "calt" 0` for clean terminal rhythm.
- **`--font-sans` (`Inter`, `'Helvetica Neue'`, `Helvetica`, `Arial`, `system-ui`, weights `300`, `400`, `500`, `600`):**
  - Hero studio greeting (`clamp(24px, 2.2vw, 33px)`, weight `400`, tight `-0.02em` tracking): `Hi <Creator>, Otto is (y)our stream manager.`
  - Long-form chat replies (`MessageBubble.vue`, `13.5px`), Dossier Markdown body, and Markdown document previews for comfortable reading.

### Type Scale

| Role | Font | Weight | Size | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Widget Caption | `--font-mono` | 400 | `11px` | `1.4` | Centered card header: `(Y)our schedule.` |
| Micro Badge / Pill | `--font-mono` | 400–500 | `11px–12px` | `1.3` | Status pills, tabs, tags, timestamps |
| Control / Button | `--font-mono` | 400–500 | `12.5px–13px` | `1.35` | Pill buttons, inputs, table cells |
| Body (Chat & Notes) | `--font-sans` | 400 | `13.5px–14px` | `1.55` | Coaching messages, dossier prose |
| Widget Heading | `--font-mono` | 500 | `15px–16px` | `1.35` | Section titles inside detail views |
| Countdown / KPI Numeral | `--font-mono` | 400 | `clamp(26px, 2.3vw, 34px)` | `1.15` | Next stream countdown (`18:42:10`), key metrics |
| Hero Greeting | `--font-sans` | 400 | `clamp(24px, 2.2vw, 33px)` | `1.18` | `Hi <Creator>, Otto is (y)our stream manager.` |

---

## 5. Spacing, Radii & Elevation

- **Base Unit:** `4px` rhythm applied ad hoc (`4`/`8`/`12`/`16`/`20`/`24px`). There is **no** `--space-*` token scale in `tokens.css` — spacing is written directly in component CSS.
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
  |               (Y)our schedule.                   |  <- 11px IBM Plex Mono, centered, 7px 16px,
  +--------------------------------------------------+     border-bottom: 1px solid #EDEDED
  |                                                  |
  |   [Widget Body — padding: 16px 20px]             |
  |                                                  |
  +--------------------------------------------------+
  ```

---

## 6. Layout Architecture & Component Mapping (`web/`)

### Otto Studio OS Multi-Window Desktop Shell (`>= 1024px`)
Implemented by `DesktopShell.vue` and `useWindowManager.ts` on top of the ambient studio backdrop (`--bg-canvas`):
- **Top Menu Bar (`TopMenuBar.vue`, `36px` height):** Translucent white bar (`bg-white/84`, `backdrop-blur-md`) with the `Otto OS` menu (Spotlight, System Settings, Window/Layout actions), active app title, and studio timezone clock.
- **Interactive Desktop Surface (`DesktopSurface.vue`):** Houses desktop shortcuts, live studio status subtitle, and the pure-SVG cursor-tracking `OttoMascot.vue`.
- **Managed Window Stage (`DesktopWindow.vue`):** Pointer-capture draggable & resizable `#FFFFFF` `20px`-radius windows with auto-adaptive macOS/Windows controls (`auto` | `mac` | `windows`), dashed `#F9F5A2` edge-snap preview zones (`left`, `right`, `maximize`), layout presets (`tile-2up`, `focus-chat`, `cascade`, `show-desktop`, `reset`), and `localStorage` geometry persistence. Initial layout opens **Otto Chat** (left) + **Mission Control** (right).
- **9 Wired Studio Apps (`STUDIO_APPS` in `useWindowManager.ts`):**
  1. **Otto Chat (`otto-chat`):** Co-Pilot chat stream (`MessageBubble.vue`), expandable `ThoughtTrace`, `SessionSidebar` drawer, pinned `TodoChecklistCard.vue`, and `ChatComposer.vue` (`#EDEDED` `25px` pill input + workspace upload + `#303030` primary `Send` pill).
  2. **Studio Files (`files`):** Unified 2-way workspace file manager & clip previewer (`WorkspaceFileManager.vue`).
  3. **OBS Overlays (`obs-overlays`):** Fly Machine-hosted overlay workspace (`ObsOverlaysWorkspaceApp.vue`) — live 16:9 transparent preview, copyable OBS Browser Source + mobile Remote Control URLs, machine status, and delete.
  4. **Mission Control (`mission-control`):** Bento workspace (`MissionControlWorkspace.vue` with `Overview` | `Profile` | `Connectors` sub-tabs) featuring `(Y)our sprite.`, `(Y)our next stream.`, `(Y)our schedule.`, `(Y)our workspace.`, `(Y)our connectors.`, and `(Y)our playbooks.` cards.
  5. **Studio DB (`studio-db`):** SQLite studio database explorer (`StudioDatabaseView.vue`).
  6. **Playbooks (`playbooks`):** Human-gated learned SOPs & nightly reflection status (`LearnedPlaybooksCard.vue`).
  7. **Calendar (`calendar`):** Month/Week/Agenda stream calendar with QStash wake-up badges (`CalendarWorkspaceApp.vue`).
  8. **Contacts (`contacts`):** 3-pane creator rolodex CRM for artists, riggers, clippers, editors, and sponsors (`ContactsWorkspaceApp.vue`).
  9. **System Settings (`settings`):** Studio preferences, `OttoMascot` color swatches, and window-control platform mode.
- **Floating Pill Dock (`DesktopDock.vue`):** Centered translucent bottom dock grouping **8 primary apps** (OBS Overlays included) plus utility `System Settings` (`Alt+1..9`), with running/minimized indicators, context menus, and `#F9F5A2` attention dots.
- **Spotlight Command Palette (`SpotlightCommand.vue`, `Cmd+K` / `Ctrl+K`):** Reka UI dialog searching apps, quick workspace folders, and layout presets.
- **First-Run Setup (`StudioSetupWizard.vue`):** 3-step modal (`(Y)our studio setup · step N/3`) covering Identity, Passcode, and Connectors before the desktop shell is unlocked.
- **Responsive Single-App Mode (`< 1024px`):** `useWindowManager` enters `isMobile`, rendering only the focused window full-bleed between the `36px` top menu bar and `78px` dock safe area so switching apps from the dock stays clean on narrow screens.

### Passcode Gate (`web/server.ts` `LOGIN_HTML`)
- Centered `#FFFFFF` `20px`-radius widget card floating on the exact **Otto Studio backdrop gradient**, opening with the `(Y)our studio.` `11px` monospace header strip, centered `OttoMascot` SVG circle-with-eyes, `"Otto is (y)our stream manager."` (`(y)our` in `#F9F5A2`), `#EDEDED` `25px` passcode input, and `#303030` Charcoal pill button `Unlock Studio`.

### shadcn-vue Theme (`web/src/styles/globals.css`)
Styled on `reka-nova` (Reka UI + Tailwind CSS v4 + `@lucide/vue`) mapped directly to Otto Studio Bento OS tokens:
- `--background` / `--card` / `--popover`: `#FFFFFF` (`--foreground`: `#303030`)
- `--primary`: `#303030` (`--primary-foreground`: `#FFFFFF`)
- `--secondary` / `--muted`: `#F2F2F2` (`--muted-foreground`: `#808080`)
- `--accent`: `#EDEDED` (`--accent-foreground`: `#303030`)
- `--highlight-yellow`: `#F9F5A2`, `--highlight-cyan`: `#C7F6FF`
- `--destructive`: `#991B1B`, `--border`: `#EDEDED`, `--input`: `#D9D9D9`, `--ring`: `#303030`
- `--radius`: `0.875rem` (`14px`; `rounded-xl` ≈ `20px` bento card); buttons use `rounded-full` monochrome pills
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
  --bg: #DBDBDB;
  --bg-flat: #DBDBDB;
  --bg-canvas:
    radial-gradient(circle at 10% 8%, #CFD5DF 0%, rgba(207, 213, 223, 0) 48%),
    radial-gradient(circle at 94% 10%, #DC6B46 0%, rgba(220, 107, 70, 0) 52%),
    radial-gradient(circle at 90% 92%, #DF7A59 0%, rgba(223, 122, 89, 0) 50%),
    radial-gradient(circle at 8% 92%, #E59D81 0%, rgba(229, 157, 129, 0) 52%),
    linear-gradient(135deg, #D7D5D6 0%, #DCD4D2 48%, #E6B29A 100%);

  /* Interactive & Highlighter Accents */
  --otto-primary: #303030;
  --otto-primary-hover: #141414;
  --otto-primary-fg: #FFFFFF;
  --highlight-yellow: #F9F5A2;
  --highlight-cyan: #C7F6FF;

  /* Semantic */
  --success: #166534;
  --success-bg: #E6F7EE;
  --warning: #854D0E;
  --warning-bg: #F9F5A2;
  --error: #991B1B;
  --error-bg: #FDE8E8;
  --info: #303030;
  --info-bg: #C7F6FF;

  /* Typography */
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: "Inter", "Helvetica Neue", Helvetica, Arial, -apple-system, BlinkMacSystemFont, sans-serif;

  /* Layout */
  --max-width: 820px;
  --header-height: 58px;
  --sidebar-width: 280px;

  /* Radii & Elevation */
  --radius-card: 20px;
  --radius-media: 10px;
  --radius-input: 25px;
  --radius-pill: 9999px;
  --shadow-card: 0 3px 6px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-pill: 0 1px 4px rgba(0, 0, 0, 0.14);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 10px 28px rgba(0, 0, 0, 0.16);
  --shadow-focus: 0 0 0 2px #303030;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 140ms;
  --duration-base: 220ms;
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
- Do not leak developer jargon (`omp`, `QStash`, `MEMORY.md`, `SQLite`) in user-facing widget captions — keep every caption cheeky, minimal, and studio-native (`(Y)our schedule.`, `(Y)our profile.`, `(Y)our workspace.`, `(Y)our db.`).
