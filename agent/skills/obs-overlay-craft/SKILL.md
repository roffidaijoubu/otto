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

1. **Discover assets in Box:** Call `box_list_assets(subpath="Logos")` (or `"Characters"` / `"Backgrounds"`) to find their real uploaded PNGs in `Otto Assets/`.
2. **Download to local workspace:** Call `box_download_file(fileId=..., destWorkspacePath="assets/logos/<filename>.png")`.
3. **Visually inspect before designing:** Call `read` on `/home/sprite/workspace/assets/logos/<filename>.png` so you actually **see** the logo/character's colors, contrast, motif, and line weight. Extract 2–4 real brand hex tokens (`--brand-bg`, `--brand-primary`, `--brand-accent`, `--brand-ink`) directly from the image instead of guessing generic colors.
4. **Host cleanly on the Fly Machine:** Pass `assets: ["assets/logos/<filename>.png"]` to `obs_overlay_deploy`. Never inline megabyte base64 data URIs into HTML — reference the hosted file directly via `<img src="/assets/<filename>.png" alt="" />` so OBS caches it cleanly and refinements stay fast.
