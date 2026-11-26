---
name: studio-app-craft
description: Design and build native-feeling local Custom Studio Apps inside Otto Studio OS using `studio_app_create`. Aligns strictly with Otto Studio Bento OS (`DESIGN.md`) tokens, persistent `window.ottoApp` state, and `unslop-ui` copy/chrome/chart rules.
---

# Studio App Craft — Native Local Apps for Otto Studio OS

Use `studio_app_create` when the creator wants a **local tool or mini-app** that lives on their **Otto Studio OS Desktop** and opens in its own native OS window (e.g., Sponsor Rate Calculator, Stream Rundown Tracker, Subathon Goal Ledger, Title/Hook Tester, Collab Checklist, Analytics Scratchpad).

Do **NOT** use `studio_app_create` for live OBS Browser Source overlays — use `obs_overlay_deploy` (see `obs-overlay-craft`) for anything going into OBS.

---

## 1. Otto Studio Bento OS Design System (`DESIGN.md` — Native Visual Cohesion)

Every Custom Studio App runs inside an Otto OS window with `IBM Plex Mono`, `Inter`, Tailwind CSS, and Otto CSS tokens **already pre-injected**. Make every app feel like it was built by the Otto OS team:

- **Palette (strict monochrome studio ink + paper, zero dark neon SaaS slop):**
  - Canvas background: `#FAFAFA` (`bg-[#FAFAFA]`)
  - Elevated cards / panels: `#FFFFFF` (`bg-white border border-[#EDEDED] rounded-2xl`)
  - Secondary surface / subtle controls: `#F2F2F2` (`bg-[#F2F2F2]`)
  - Hairline borders: `#EDEDED`, input borders `#D9D9D9`
  - Primary text & active pill buttons: `#303030` (`text-[#303030]`, primary button `bg-[#303030] text-white rounded-full`)
  - Secondary / muted text: `#808080`
  - Signature micro-accents (use sparingly for active emphasis / highlighted word only):
    - Highlight Yellow `#F9F5A2` (`.otto-mark-y` or active emphasis)
    - Highlight Cyan `#C7F6FF` (`.otto-mark-c`)
  - Semantic status pills (only when bound to real state):
    - Success `#E6F7EE` / `#166534`
    - Warning `#F9F5A2` / `#854D0E`
    - Destructive `#FDE8E8` / `#991B1B`
- **Typography:**
  - `font-mono` (`IBM Plex Mono`): controls, pill buttons, inputs, table headers, KPI numerals (`tabular-nums`), timestamps, tags, section titles.
  - `font-sans` (`Inter`): body prose and longer descriptions.
- **Pre-injected Otto Utility Classes available immediately:**
  - `.otto-card`, `.otto-card-header`, `.otto-btn`, `.otto-btn-secondary`, `.otto-input`, `.otto-mark-y`, `.otto-mark-c`, `.tabular-nums`.

---

## 2. Persistent Local State (`window.useOttoState` / `window.ottoApp`)

Custom Studio Apps are **real persistent apps**, not stateless toys. Always persist user-entered data (rates, checklist items, goals, notes, filters) so nothing is lost on refresh:

```jsx
export default function App() {
  const [data, setData] = window.useOttoState({
    avgViewers: 120,
    cpm: 25,
    deliverables: ["60s mid-roll", "Pinned chat link"],
  });
  // setData automatically debounces and persists to Sprite state.json!
}
```

For plain HTML/JS apps, read `window.ottoApp.initialState` on load and call `window.ottoApp.saveState(nextState)` on change.

---

## 3. Strict `unslop-ui` Cleanup Rules (Zero AI Slop)

Before calling `studio_app_create`, strip every AI tell:
- **No uppercase eyebrow labels** (`FEATURES`, `CONFIGURATION`, `OVERVIEW`) above headings.
- **No decorative `01 / 02 / 03` numbering** unless it is a real ordered procedure.
- **No subtitle reflex or botsplaining** (*"Calculate your rates easily"*, *"Click Add to create an item"*). Keep only concrete facts the controls don't already show.
- **No leaked design notes or fake metadata** (`(updates in real time)`, `LIVE SYNC`, `v2.1`).
- **No chained `·` / `|` status strings** — keep one actionable fact per place.
- **No badges or pulsing dots without real reactive state.**
- **No purple/blue gradients, glass blur, emoji icons, or decorative left accent stripes (`border-l-4`).** Use `lucide-react` icons only where functional (toolbar/action buttons).
- **No equal stat cards:** give the one primary figure clear typographic weight and keep secondary figures quieter.
- **No `→` arrows on buttons**, no generic *"Submit"* labels, no em dashes (`—`), no AI vocabulary (*seamless, unlock, elevate, leverage*), sentence case everywhere.
- **Strictly NO AI-generated images or video.**
