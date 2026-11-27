---
name: obs-overlay-craft
description: Design and deploy live, transparent 1920x1080 OBS Browser Source overlays to the dedicated Fly Machine using `obs_overlay_deploy` and `obs_overlay_control`. Enforces strict broadcast hygiene, realtime SSE remote sync, and `unslop-ui` discipline.
---

# OBS Overlay Craft — Broadcast-Grade Overlays on Fly Machines

Use `obs_overlay_deploy` whenever the creator asks for a **live OBS Browser Source overlay** (Starting Soon countdown, Lower Third, BRB slate, Sub/Follower Goal bar, Now Playing / Topic ticker, Stream Schedule card).

All overlays deploy to the creator's dedicated auto-stop **Fly Machine (`shared-cpu-1x`, 256 MB + 1 GB persistent Volume)** and expose:
- Public OBS Browser Source URL: `https://<app>.fly.dev/o/<slug>`
- Live Remote Control Deck URL: `https://<app>.fly.dev/c/<slug>?token=<token>` (also embedded live inside the **OBS Overlays** window in Otto Studio OS!)

---

## 1. Strict Separation: Zero Controls Inside the OBS Overlay

- **`html` is ONLY the clean broadcast output** meant for OBS Browser Source (`1920x1080` responsive viewport, `background: transparent` by default unless it is a full-screen slate like Starting Soon / BRB).
- **NEVER put buttons, settings panels, theme pickers, or "Download HTML" links inside `html`!**
- Put every controllable parameter into `controls` (which automatically builds the mobile/desktop Remote Control Deck at `/c/<slug>`) and `initialState`!

---

## 2. Realtime SSE State Sync (`window.OBS_OVERLAY`)

The Fly Machine server automatically injects `window.OBS_OVERLAY` into every overlay page. Always bind your overlay DOM to it so Remote Control clicks and Otto chat commands (`obs_overlay_control`) update OBS in `<50ms`:

```html
<script>
  let timerId = null;

  function render(state) {
    document.getElementById("headline").textContent = state.headline || "Starting soon";
    document.getElementById("panel").style.opacity = state.visible === false ? "0" : "1";

    // For countdown overlays, drive from server-synced targetEpochMs + running + remainingSec:
    clearInterval(timerId);
    const updateClock = () => {
      let sec = typeof state.remainingSec === "number" ? state.remainingSec : 300;
      if (state.running && state.targetEpochMs) {
        sec = Math.max(0, Math.ceil((state.targetEpochMs - Date.now()) / 1000));
      }
      const m = String(Math.floor(sec / 60)).padStart(2, "0");
      const s = String(sec % 60).padStart(2, "0");
      document.getElementById("clock").textContent = `${m}:${s}`;
    };
    updateClock();
    if (state.running) timerId = setInterval(updateClock, 250);
  }

  window.OBS_OVERLAY.subscribe(render);
</script>
```

Available declarative `controls` field types:
- `text`, `textarea`, `number`, `toggle`, `select` (with `options: [...]`)
- `timer_action` with `action: "start" | "pause" | "reset" | "add_seconds"` (and optional `seconds: 60` / `-60`), automatically updating `running`, `remainingSec`, `durationSec`, and `targetEpochMs`!

---

## 3. Broadcast Design & Zero-Slop Discipline (`unslop-ui`)

- **Ground in a real broadcast object** (e.g. clean TV lower-third chyron, studio tally clock, minimal editorial title card) — never purple neon gaming slop, glassmorphism blur boxes, or fake sci-fi telemetry (`FEED ALPHA-05`, `LIVE SYNC`, `SYS OK`).
- **Typography:** Crisp Google Fonts display face + `IBM Plex Mono` with `font-variant-numeric: tabular-nums` so countdowns never jitter horizontally.
- **Cut all decorative chrome:**
  - No uppercase eyebrow captions above headings (`PRE-SHOW SLATE`, `MASTER TIMER`).
  - No decorative `01 / 02 / 03` numbering on checklists.
  - No fake status badges or dots not bound to real state (e.g. a tally dot is ONLY shown when `state.running === true`).
  - No decorative edge accent stripes (`border-l-4`) unless encoding real broadcast tally state.
  - No emoji icons, no em dashes (`—`), no stock AI copy.
- **Safe margins:** Keep broadcast elements inside OBS title-safe margins (`padding: 48px–64px`) and readable at 720p mobile stream resolution.
- **Strictly NO AI-generated images or video.**

---

## 4. Brand Assets & Multimodal Style Matching (`Otto Assets/`)

Whenever the creator asks to include their **logo**, **character PNG**, or wants an overlay whose **visual style matches their brand**:

1. **Check local synced assets FIRST (`/home/sprite/workspace/assets/`):** Box `Otto Assets/` (`Logos/`, `Characters/`, `Backgrounds/`) is incrementally synced into `/home/sprite/workspace/assets/`. Read directly from there if present; only fall back to `box_list_assets` + `box_download_file` if an asset is missing locally.
2. **Visually inspect before designing:** Call `read` on `/home/sprite/workspace/assets/Logos/<filename>.png` (or `Characters/...`) so you actually **see** the logo/character's colors, contrast, motif, and line weight. Extract 2–4 real brand hex tokens (`--brand-bg`, `--brand-primary`, `--brand-accent`, `--brand-ink`) directly from the image instead of guessing generic colors.
3. **Host cleanly on the Fly Machine:** Pass `assets: ["assets/Logos/<filename>.png"]` to `obs_overlay_deploy`. Never inline megabyte base64 data URIs into HTML — reference the hosted file directly via `<img src="/assets/<filename>.png" alt="" />` so OBS caches it cleanly and refinements stay fast.

---

## 5. Native Full-Bleed Live Controller UI (`controlHtml` & `controls`)

The Live Controller (`/c/<slug>`) is embedded directly inside the **OBS Overlays** desktop window (and opened on mobile during live streams).

- **When to pass custom `controlHtml` to `obs_overlay_deploy`:**
  - Use declarative `controls` ONLY for ultra-simple 2–4 field overlays.
  - **ALWAYS craft a custom `controlHtml`** whenever the creator asks for **tabs** (e.g. `Control` + `Data`), **big prev/next looping arrows**, **repeatable add/remove rows** (e.g. dynamic speaker/person list, queue, polls, checklists), **preset scene buttons**, or any tailored live deck!
  - The Fly Machine automatically injects **`window.OBS_CONTROL`** into custom `controlHtml`:
    ```html
    <script>
      // Subscribe to live state (initial + realtime SSE from OBS/Otto/other tabs):
      window.OBS_CONTROL.subscribe((state) => {
        render(state);
      });
      // Push partial or nested array updates (e.g. { activeIndex: 2 } or { people: [...] }):
      await window.OBS_CONTROL.patch({ visible: true, activeIndex: 0 });
      // Read current state or overlay metadata:
      const current = window.OBS_CONTROL.getState(); // { ... }
      const { slug, title } = window.OBS_CONTROL.meta;
    </script>
    ```
  - Never say "the built-in controller doesn't support tabs / arrows / repeatable fields" — you HAVE full `controlHtml` power via `obs_overlay_deploy`!

- **Full-Bleed Native Desktop Style (Otto Studio OS):**
  - Use `html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #FFFFFF; color: #171717; }` with a full-height flex column (`min-height: 100vh`). **NEVER** wrap the controller in a centered `max-width` box, floating `.card`, drop shadow, or outer grey page margin.
  - Top toolbar / tab bar: `#FAF9F6` surface with `border-bottom: 1px solid rgba(0, 0, 0, 0.08)` containing the compact title or segmented tabs (`Control` | `Data`) and live connection badge.
  - Main control surface: pure `#FFFFFF` with full-width hairline dividers (`1px solid rgba(0, 0, 0, 0.08)`) separating logical groups instead of nested rounded cards.
  - Primary actions: solid `#171717` fill with `#FFFFFF` text (`border-radius: 8px`); secondary actions: `#FFFFFF` with `1px solid rgba(0, 0, 0, 0.12)` border.
  - Use `IBM Plex Mono` with `font-variant-numeric: tabular-nums` for live timers, speaker indices (`2 / 5`), and counters so values never jitter.
  - Keep primary live triggers (big Prev/Next looping arrows, Show/Hide, Start/Pause/Reset) immediately reachable at the top with zero scrolling, and zero decorative AI chrome.
