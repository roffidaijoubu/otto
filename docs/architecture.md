# Architecture Deep Dive — Why LMA (`lma`, Livestreamer Manager Agent) Uses `omp` RPC + Native Fly.io Sprites Primitives

This document explains the key engineering decisions behind **LMA (`lma` — Livestreamer Manager Agent)** — specifically why we chose **`omp` (`@oh-my-pi/pi-coding-agent`)** as the persistent agent engine, how we solved **proactive self-scheduling on a $0-idle sleeping Sprite**, and how we use **Sprites Connectors, Tasks API, and Checkpoints** together with zero outbound API keys inside the VM.

---

## 1. Why `omp --mode rpc --no-ui` Instead of a Custom Agent Loop

Most hackathon agents reinvent a brittle `while (toolCalls)` loop in Python or TypeScript, then spend 80% of their time fighting context compaction, tool-call retries, session persistence, and streaming bugs.

`lma` takes the opposite approach: treat **`omp`** as the real, battle-tested agent runtime inside the Sprite, and wrap it with a thin Bun supervisor (`web/server.ts`) speaking **`omp --mode rpc --no-ui`** over newline-delimited JSON (JSONL) stdin/stdout.

```mermaid
flowchart LR
    B["Vue 3 + Vite Web Chat UI<br/>(ThoughtTrace · Session Switcher)"] <-->|"HTTP + SSE"| S["Bun Supervisor (web/server.ts)<br/>Port 8080 · Passcode Gate · Tasks Hold"]
    S <-->|"Persistent JSONL stdin/stdout"| O["omp --mode rpc --no-ui<br/>(Gemini 4 Neon · Mnemopi SQLite · Skills)"]
    O -->|"Zero local keys"| G["Fly.io Sprites Gateway<br/>(6 Connectors)"]
```

### What `omp` RPC gives us out of the box
| Capability | How `lma` Uses It |
| :--- | :--- |
| **Zero per-message cold start** | One persistent `omp` RPC worker stays warm inside `lma-web` (auto-restarts on exit) instead of spawning a new CLI process per turn. |
| **First-class streaming events** | `thinking_delta`, `text_delta`, `tool_execution_start`, and `tool_execution_end` stream straight to the Vue 3 `<ThoughtTrace>` component over SSE. |
| **Native session management** | `get_messages`, `new_session`, `switch_session`, and `abort` power multi-chat history and instant stop controls without a custom chat database. |
| **Dual-layer persistent memory** | Structured `MEMORY.md` talent dossier (Goals, Schedule, 3 GOATs, 3+1 tracker) paired with built-in **Mnemopi** SQLite memory (`noEmbeddings: true` for fast CPU-only FTS recall). |
| **Clean `ExtensionAPI` + Skills** | Connectors live as small, auto-discovering TypeScript extensions (`agent/extensions/*.ts`); coaching workflows live as Markdown skills (`agent/skills/`). |
| **Tool-level guardrails** | `generate_image: deny` and `generate_image.enabled: false` enforce the **strictly no AI-generated art/video** rule at the runtime layer, not just in prose. |

---

## 2. Proactive Self-Scheduling on a Sleeping Sprite (Upstash QStash + Tasks API)

Fly.io Sprites pause automatically after **~30 seconds of idle time** (warm suspend → cold stop), which keeps idle compute at **$0** — but also pauses any local Linux `cron` daemon inside the VM.

To let Professor L be genuinely **proactive** (e.g., *"Remind me 1 hour before my collab stream on Dec 17 at 15:30 WIB, then pull the VOD afterward to cut raw clips"*), `lma` combines **Upstash QStash** with Fly.io's **`/.sprite/api.sock` Tasks API**:

```mermaid
sequenceDiagram
    participant U as Streamer
    participant L as Professor L (omp RPC)
    participant Q as Upstash QStash (via Sprites Connector)
    participant W as web/server.ts (Port 8080)
    participant T as /.sprite/api.sock (Tasks API)

    U->>L: "Stream with Hans is confirmed for Dec 17 at 15:30 WIB"
    L->>Q: schedule_wakeup(runAt, prompt) [zero local keys]
    Note over L,W: Sprite goes idle -> pauses at $0

    Note over Q: Dec 17, 14:30 WIB arrives
    Q->>W: POST /api/wakeup (HS256 Upstash-Signature + SHA-256 body hash)
    Note over W: Sprite wakes in <1s
    W->>W: Verify Upstash-Signature (dual rotating keys)
    W->>T: PUT /v1/tasks/lma-agent-turn { expire: "10m" }
    W-->>Q: 200 OK (immediate ACK)
    W->>L: Inject [SCHEDULED WAKE-UP] prompt
    L->>L: Execute task (Buffer draft, YouTube check, or chat briefing)
    L-->>W: agent_end / session_settled
    W->>T: DELETE /v1/tasks/lma-agent-turn
    Note over L,W: 30s later -> Sprite sleeps at $0 again
```

### Why the `/.sprite/api.sock` Tasks API Hold Matters
Because `POST /api/wakeup` returns `200 OK` to QStash immediately and runs `omp` asynchronously, there is **no open browser SSE connection** during a headless wake-up. Without a keep-alive hold, a multi-tool agent turn taking >30 seconds could be paused mid-flight by the Sprite's idle detector.

Holding `PUT /v1/tasks/lma-agent-turn` (`expire: "10m"`) on `agent_start` and releasing `DELETE /v1/tasks/lma-agent-turn` on `agent_end`/`abort` guarantees every headless wake-up finishes cleanly — while the 10-minute TTL guarantees a crash can never leak billing.

---

## 3. Zero Outbound API Keys (6 Auto-Discovering Sprites Connectors)

Every external API call routes through `https://api.sprites.dev/v1/gateway/...`:

- **Built-in BYOK Connectors:** Google Gemini, Exa, Firecrawl.
- **Custom API Connectors (provisioned via `sprite api /oauth/connections/custom_api`):**
  - **Composio v3 (`https://backend.composio.dev`, `x-api-key`)** — cleanly works around Sprites' built-in Composio v3.1 catalog validator mismatch while keeping 100% zero-key gateway security for YouTube channel stats, video metadata, captions, and human-approved packaging updates.
  - **Buffer (`https://api.buffer.com`, `Bearer`)** — single GraphQL API covering **X (Twitter), TikTok, and Instagram** (avoiding X's paid Pay-Per-Use API), defaulting to `saveToDraft: true` so nothing publishes publicly without human sign-off.
  - **Upstash QStash (`Bearer`)** — free 1,000 messages/day for agent self-scheduled wake-ups and recurring crons.

Every extension queries `GET https://api.sprites.dev/v1/gateway/list` at runtime and caches its `gateway_base_url` — meaning **zero hardcoded connector IDs** exist anywhere in this repository.

---

## 4. Checkpoint Time-Travel &amp; Agentic E2E Testing

Stateful personal agents are notoriously painful to test end-to-end: persistent memory (`MEMORY.md`, Mnemopi SQLite) and conversation history bleed across runs, and LLM replies are non-deterministic so brittle exact-string unit tests break constantly.

**Fly.io Sprites' immutable copy-on-write checkpoints turned that bottleneck into our biggest development speed multiplier:**

```mermaid
flowchart LR
    C["git commit"] --> H["post-commit hook<br/>sync-initialized-checkpoint.sh"]
    H --> I["Clean 'initialized: &lt;sha&gt;'<br/>Checkpoint (blank MEMORY.md)"]
    I -->|"sprite restore &lt;id&gt; (~1s)"| T["Blank-Slate Testing Agent<br/>(reads scripts/e2e/INDEX.md)"]
    T -->|"Multi-turn omp -p + JSONL inspection"| G["Semantic Rubric Grade<br/>(vs expected-memory.md)"]
    G -->|"sprite restore &lt;prod-id&gt;"| P["Live Prod State<br/>(Zero Data Loss)"]
```

1. **Perpetually Fresh Clean Baseline (`scripts/sync-initialized-checkpoint.sh` + `scripts/install-hooks.sh`):** Installed via `bash scripts/install-hooks.sh` into `.git/hooks/post-commit`, every code commit automatically snapshots live `MEMORY.md` (`prod: auto-backup`) if modified, syncs the repo to the Sprite, clears runtime sessions/memories, resets `MEMORY.md` to `MEMORY.md.example`, rebuilds `web/`, restarts `lma-web`, creates a fresh `initialized: <sha>` checkpoint, and prunes only previous `initialized:` checkpoints.
2. **Deterministic Fast Gate (`scripts/verify-all.sh`):** Runs 14 deterministic checks in ~11 seconds — TypeScript/Vite build, all 5 skill &amp; 8 extension symlinks, Python clipper compilation, `/.sprite/api.sock` Tasks API hold, `401` passcode &amp; QStash signature gates, path-traversal rejections, and authenticated Mission Control APIs.
3. **Agentic Multi-Turn E2E Playbooks (`scripts/e2e/`):** Instead of flaky regex assertions, behavioral tests live as Markdown playbooks (`01-onboarding.md` … `05-qstash-proactive-wakeup.md`) paired with a programmatic communication guide (`scripts/e2e/INDEX.md`) and a golden reference dossier (`scripts/e2e/expected-memory.md`). A completely blank-slate coding agent can restore `initialized:`, execute multi-turn conversations against Professor L, inspect raw JSONL tool calls, semantically grade the resulting `MEMORY.md` against `expected-memory.md`, and jump straight back to live state in seconds — making iteration dramatically faster and consistently reproducible.
---

## 5. Defense-in-Depth Security

- **Zero outbound API keys in VM or repo:** All 6 external API credentials stay inside Fly.io's encrypted org gateway. Inbound verification secrets (`LMA_WEB_PASSWORD` and Upstash QStash signing keys) live strictly in `chmod 600 ~/.config/lma/web.env` outside git.
- **Fail-closed Web Chat UI gate:** `setup.sh` auto-generates `LMA_WEB_PASSWORD` in `~/.config/lma/web.env`; `web/server.ts` refuses to serve `/` or `/api/*` if unset (`503`), rate-limits brute-force attempts (`429`), and signs `HttpOnly; SameSite=Lax; Secure` cookies verified with `crypto.timingSafeEqual`.
