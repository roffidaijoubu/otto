# E2E Playbook 01 — Studio Onboarding & Persistent Memory Accuracy

**Goal:** Verify that from a completely blank `initialized:` checkpoint, Otto automatically researches the creator via zero-key connectors, respects zero-fourth-wall persona, fact-checks OPSEC boundaries & team credits, and persists an accurate studio profile to `/home/sprite/.omp/agent/MEMORY.md`.

**Reference Baseline:** `scripts/e2e/expected-memory.md`

---

## Steps

### 1. Reset to Clean `initialized:` Baseline
1. Run `sprite checkpoint list` and restore the latest `initialized:` checkpoint (`sprite restore <id>`).
2. Confirm `/home/sprite/.omp/agent/MEMORY.md` has `(not set)` placeholders.

### 2. Turn 1 — Introduce Talent Handle
Run inside `/home/sprite/e2e-onboarding`:
```bash
sprite exec -- bash -c 'mkdir -p /home/sprite/e2e-onboarding && cd /home/sprite/e2e-onboarding && omp -p "Assalamualaikum Otto! I am Roffi Daijoubu (@Roffi_Daijoubu), an indie VTuber from Indonesia. Let us get started!"'
```

**Semantic Pass Criteria (Turn 1):**
- [ ] Otto proactively pulls real public data (e.g. YouTube subscriber/view/video counts, X/TikTok/IG handles from Buffer, and background via Exa) — does **not** ask the user to fill out a boring blank form first.
- [ ] Presents a structured **Draft Profile** and explicitly asks for **Fact-Check**, **Timezone**, **OPSEC / anonymity boundaries**, and **Human Team / Credits** without dumping a long questionnaire.
- [ ] **Zero fourth-wall breaks:** Does NOT mention `omp`, `MEMORY.md`, `Mnemopi`, `youtube_tool`, `social_list_channels`, or `/skill:onboarding`.

### 3. Turn 2 — Confirm Fact-Check, OPSEC & Human Credits
Run in the same directory (`/home/sprite/e2e-onboarding`):
```bash
sprite exec -- bash -c 'cd /home/sprite/e2e-onboarding && omp -p "Good homework Otto! Here are my answers: 1. Fact-check: I am from the Syiah Ithna Ashari Imamiyah (Twelver Shia / 12 Imam) school — an indie VTuber and community educator. 2. OPSEC: Strictly anonymous — never leak my real legal identity or doxable details, and never do sectarian rage-bait. 3. Human Crew: Live2D model by kyuto_hans (Hans) and logo by Himeko Design. Strictly zero AI art/thumbnails!"'
```

**Semantic Pass Criteria (Turn 2):**
- [ ] Otto saves the confirmed profile directly into `/home/sprite/.omp/agent/MEMORY.md`.
- [ ] Confirms the studio profile is ready and asks what task the creator wants to tackle first (does **not** force Homework #1 or unsolicited streaming coaching).

### 4. Compare Resulting `MEMORY.md` Against `scripts/e2e/expected-memory.md`
Read `/home/sprite/.omp/agent/MEMORY.md` from the Sprite and semantically compare against `scripts/e2e/expected-memory.md`:
```bash
sprite exec -- cat /home/sprite/.omp/agent/MEMORY.md
```

**Accuracy Rubric (Semantic Match — exact wording not required):**
- [ ] **Identity:** Roffi Daijoubu (`@Roffi_Daijoubu`), Indonesian VTuber Ustadz, Twelver Shia / Syiah 12 Imam.
- [ ] **Platforms:** YouTube (`UCxNQuQpAR08DxRZytUJmNGg` or `@roffi_daijoubu` with real stats), X/Twitter, TikTok, Instagram.
- [ ] **Timezone:** `Asia/Jakarta` (WIB, UTC+7) recorded under `- **Timezone:**`.
- [ ] **OPSEC Rule:** Strict anonymity / no real-world legal identity / no sectarian rage-bait.
- [ ] **Human Credits & Guardrail:** `kyuto_hans` (Live2D), `Himeko Design` (logo), strictly zero AI art/thumbnails.
- [ ] **No fabricated real-world personal data** (zero OPSEC leaks).
