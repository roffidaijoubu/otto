---
name: studio-app-craft
description: Design and build native-feeling local Custom Studio Apps inside Otto Studio OS using `studio_app_create`. Aligns strictly with Otto Studio Bento OS (`DESIGN.md`) tokens, persistent `window.ottoApp` state, and `unslop-ui` copy/chrome/chart rules.
---

# Studio App Craft — Native Local Apps for Otto Studio OS

Use `studio_app_create` when the creator wants a **local tool or mini-app** that lives on their **Otto Studio OS Desktop** and opens in its own native OS window (e.g., Sponsor Rate Calculator, Stream Rundown Tracker, Subathon Goal Ledger, Title/Hook Tester, Collab Checklist, Analytics Scratchpad).

Do **NOT** use `studio_app_create` for live OBS Browser Source overlays — use `obs_overlay_deploy` (see `obs-overlay-craft`) for anything going into OBS.

---

## 1. Otto Studio OS Design System (Native Visual Cohesion)

Every Custom Studio App runs inside its own native Otto Studio OS window with `IBM Plex Mono`, `Inter`, Tailwind CSS, and Otto CSS tokens **already pre-injected**. Make every app feel like a first-party desktop application built by the Otto OS team — **never** like a marketing webpage embedded in an iframe:

- **Palette (strict monochrome studio ink + paper, zero dark neon SaaS slop):**
  - Primary app surface (full-bleed): `#FFFFFF` (`bg-white`)
  - Toolbar / tab bar / sidebar surface: `#FAF9F6` (`bg-[#FAF9F6]`)
  - Secondary subtle surface / hover fills: `#F2F2F2` (`bg-[#F2F2F2]`)
  - Hairline dividers: `rgba(0, 0, 0, 0.08)` (`border-black/[0.08]` or `#EDEDED`), input borders `rgba(0, 0, 0, 0.12)` (`#D9D9D9`)
  - Primary ink & primary action buttons: `#171717` (`text-[#171717]`, primary button `bg-[#171717] text-white rounded-lg`)
  - Secondary actions: `#FFFFFF` with `1px solid rgba(0, 0, 0, 0.12)` border (`rounded-lg`)
  - Secondary / muted text: `#737373` / `#808080`
  - Signature micro-accents (use sparingly for active emphasis / highlighted word only):
    - Highlight Yellow `#F9F5A2` (`.otto-mark-y` or active emphasis)
    - Highlight Cyan `#C7F6FF` (`.otto-mark-c`)
  - Semantic status pills (only when bound to real state):
    - Success `#E6F7EE` / `#166534`
    - Warning `#F9F5A2` / `#854D0E`
    - Destructive `#FDE8E8` / `#991B1B`
- **Typography:**
  - `font-mono` (`IBM Plex Mono`) with `tabular-nums` (`font-variant-numeric: tabular-nums`): controls, buttons, inputs, table headers, KPI numerals, timers, counters, timestamps, tags, section titles.
  - `font-sans` (`Inter`): body prose and longer descriptions.
- **Pre-injected Otto Utility Classes available immediately:**
  - `.otto-btn`, `.otto-btn-secondary`, `.otto-input`, `.otto-mark-y`, `.otto-mark-c`, `.tabular-nums`.

---

## 2. Full-Bleed Native Desktop App Layout (Edge-to-Edge OS Window)

The Otto Studio OS window **IS** the container. Design the app edge-to-edge like a real macOS / native studio utility (Linear, Raycast, Apple Notes, Things):

- **NEVER** wrap the app in a centered `max-w-xl` / `max-w-3xl` webpage container, outer grey page margin (`bg-[#FAFAFA] p-6`), floating `.card`, or drop shadow.
- Use a full-viewport flex shell (`h-screen w-full flex flex-col bg-white text-[#171717] overflow-hidden`) so the app fills 100% of the window cleanly at any resize width/height.
- **Top toolbar / segmented tab bar:** `#FAF9F6` surface with `border-b border-black/[0.08]` containing compact view tabs, search/filter, and primary action button (never a big marketing hero banner or giant page title — the window title bar already shows the app name).
- **Main workspace:** Pure `#FFFFFF` using **full-width `1px` hairline dividers** (`divide-y divide-black/[0.08]`, `border-r border-black/[0.08]` for split panes/sidebars) to separate sections and rows instead of nested rounded cards inside cards.
- **Primary actions immediately reachable:** Put key controls, live counters, and quick-add inputs at the top or docked cleanly in a sticky footer/toolbar so the creator never has to scroll to trigger the main action.

Reference native app shell snippet (React/JSX):

```jsx
export default function App() {
  const [state, setState] = window.useOttoState({ tab: "main", items: [] });

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-white text-[#171717]">
      {/* Native Top Toolbar (#FAF9F6 + 1px hairline) */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.08] bg-[#FAF9F6] px-4 py-2.5">
        <div className="inline-flex rounded-lg border border-black/[0.08] bg-white p-0.5">
          {["main", "data"].map((t) => (
            <button
              key={t}
              onClick={() => setState((s) => ({ ...s, tab: t }))}
              className={`rounded-md px-3 py-1 font-mono text-xs transition-colors ${
                state.tab === t ? "bg-[#171717] text-white" : "text-[#737373] hover:text-[#171717]"
              }`}
            >
              {t === "main" ? "Workspace" : "Data"}
            </button>
          ))}
        </div>
        <button className="rounded-lg bg-[#171717] px-3 py-1.5 font-mono text-xs font-medium text-white hover:opacity-90">
          Add item
        </button>
      </header>

      {/* Full-Bleed Scrollable Surface (hairline dividers, zero floating cards) */}
      <main className="min-h-0 flex-1 overflow-y-auto divide-y divide-black/[0.08]">
        {/* Sections / rows separated by 1px hairline dividers */}
      </main>
    </div>
  );
}
```

For plain HTML/JS apps (`kind: "html"`), enforce the same edge-to-edge root CSS:
`html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #FFFFFF; color: #171717; }` with a `min-height: 100vh; display: flex; flex-direction: column;` shell.

---

## 3. Persistent Local State (`window.useOttoState` / `window.ottoApp`)

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

## 4. Strict `unslop-ui` Cleanup Rules (Zero AI Slop)

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
