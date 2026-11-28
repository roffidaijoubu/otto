/**
 * Managed RPC Background Worker Registry (`web/lib/rpc-worker.ts`).
 *
 * Spawns isolated background `omp --mode rpc --no-ui --no-session` workers with a live
 * writable stdin pipe so Otto (and the Web UI) can:
 *  1. Peek live worker telemetry (current tool, elapsed time, recent event ring buffer)
 *  2. Nudge/steer a running worker mid-flight via JSONL RPC (`steer` / `follow_up`)
 *  3. Cleanly abort and kill stuck or cancelled workers
 */

import { OMP_BIN, WORK_DIR } from "./config.ts";
import { buildAgentChildEnv } from "./child-env.ts";
import {
  extractTextContent,
  friendlyToolLabel,
  type PendingRequest,
  type RpcEvent,
} from "./rpc-bridge.ts";
import { updateStudioJob, type StudioJobKind } from "../../agent/lib/studio-db.ts";
import { broadcast } from "./sse.ts";

export interface LiveWorkerEvent {
  at: string;
  type: "tool_start" | "tool_end" | "nudge" | "assistant" | "error" | "info";
  toolName?: string;
  message: string;
}

export interface LiveWorkerSnapshot {
  jobId: string;
  kind: StudioJobKind;
  live: boolean;
  canNudge: boolean;
  startedAt: string;
  elapsedSec: number;
  currentTool: string | null;
  lastActivity: string;
  nudgesCount: number;
  recentEvents: LiveWorkerEvent[];
}

interface ManagedWorkerHandle {
  jobId: string;
  kind: StudioJobKind;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  startedAtMs: number;
  startedAt: string;
  currentTool: string | null;
  lastActivity: string;
  nudgesCount: number;
  recentEvents: LiveWorkerEvent[];
  aborted: boolean;
  sendCommand: (type: string, extra?: Record<string, unknown>) => Promise<unknown>;
  abort: () => Promise<void>;
}

const MAX_RECENT_EVENTS = 30;
const activeManagedWorkers = new Map<string, ManagedWorkerHandle>();

function pushEvent(handle: ManagedWorkerHandle, ev: Omit<LiveWorkerEvent, "at">): void {
  handle.recentEvents.push({ at: new Date().toISOString(), ...ev });
  if (handle.recentEvents.length > MAX_RECENT_EVENTS) {
    handle.recentEvents.splice(0, handle.recentEvents.length - MAX_RECENT_EVENTS);
  }
}

export function hasActiveManagedWorkers(): boolean {
  return activeManagedWorkers.size > 0;
}

export function getLiveWorkerSnapshot(jobId: string): LiveWorkerSnapshot | null {
  const h = activeManagedWorkers.get(jobId);
  if (!h) return null;
  return {
    jobId: h.jobId,
    kind: h.kind,
    live: true,
    canNudge: !h.aborted,
    startedAt: h.startedAt,
    elapsedSec: Math.max(0, Math.round((Date.now() - h.startedAtMs) / 1000)),
    currentTool: h.currentTool,
    lastActivity: h.lastActivity,
    nudgesCount: h.nudgesCount,
    recentEvents: [...h.recentEvents],
  };
}

export function listLiveWorkerSnapshots(): LiveWorkerSnapshot[] {
  return Array.from(activeManagedWorkers.keys())
    .map((id) => getLiveWorkerSnapshot(id))
    .filter((s): s is LiveWorkerSnapshot => s !== null);
}

export async function nudgeManagedWorker(
  jobId: string,
  message: string,
  mode: "steer" | "follow_up" = "steer"
): Promise<{ ok: boolean; modeUsed: string; snapshot: LiveWorkerSnapshot }> {
  const h = activeManagedWorkers.get(jobId);
  if (!h || h.aborted) {
    throw new Error(`No live nudgeable worker is currently running for job "${jobId}".`);
  }
  const cleanMsg = message.trim();
  if (!cleanMsg) {
    throw new Error("Nudge message cannot be empty.");
  }

  let modeUsed: string = mode;
  try {
    await h.sendCommand(mode, { message: cleanMsg });
  } catch (primaryErr) {
    // Fallback to follow_up if steer isn't supported or worker is between turns,
    // and finally prompt with streamingBehavior.
    const fallbackOrder: Array<{ cmd: string; extra: Record<string, unknown>; label: string }> =
      mode === "steer"
        ? [
            { cmd: "follow_up", extra: { message: cleanMsg }, label: "follow_up" },
            { cmd: "prompt", extra: { message: cleanMsg, streamingBehavior: "steer" }, label: "prompt(steer)" },
          ]
        : [
            { cmd: "steer", extra: { message: cleanMsg }, label: "steer" },
            { cmd: "prompt", extra: { message: cleanMsg, streamingBehavior: "followUp" }, label: "prompt(followUp)" },
          ];
    let delivered = false;
    for (const fb of fallbackOrder) {
      try {
        await h.sendCommand(fb.cmd, fb.extra);
        modeUsed = fb.label;
        delivered = true;
        break;
      } catch {
        // try next fallback
      }
    }
    if (!delivered) {
      throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr));
    }
  }

  h.nudgesCount += 1;
  h.lastActivity = `Nudged (${modeUsed}): ${cleanMsg.slice(0, 100)}`;
  pushEvent(h, {
    type: "nudge",
    message: `[${modeUsed}] ${cleanMsg.slice(0, 280)}`,
  });

  await updateStudioJob(jobId, {
    logMessage: `Nudged worker (${modeUsed}): ${cleanMsg.slice(0, 180)}`,
  }).catch(() => {});
  broadcast({ type: "jobs_changed", jobId });

  return {
    ok: true,
    modeUsed,
    snapshot: getLiveWorkerSnapshot(jobId)!,
  };
}

export async function cancelManagedWorker(jobId: string): Promise<boolean> {
  const h = activeManagedWorkers.get(jobId);
  if (!h) return false;
  await h.abort();
  return true;
}

export interface ManagedRpcWorkerResult {
  ok: boolean;
  aborted: boolean;
  reply: string;
  error?: string;
  exitCode: number | null;
}

export async function runManagedRpcWorker(opts: {
  jobId: string;
  kind: StudioJobKind;
  tools: string;
  prompt: string;
  env?: Record<string, string | undefined>;
  ompBin?: string;
  workDir?: string;
  timeoutMs?: number;
  onToolStart?: (toolName: string, label: string) => void;
  onFinishBroadcast?: () => void;
  onBusyChange?: (busy: boolean) => void;
}): Promise<ManagedRpcWorkerResult> {
  const childEnv = opts.env ?? buildAgentChildEnv();
  const ompBin = opts.ompBin || OMP_BIN;
  const workDir = opts.workDir || WORK_DIR;
  const args = [ompBin, "--mode", "rpc", "--no-ui", "--no-session"];
  if (opts.tools.trim()) {
    args.push("--tools", opts.tools.trim());
  }

  const proc = Bun.spawn(args, {
    cwd: workDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
  });

  const pending = new Map<string, PendingRequest>();
  let reqCounter = 0;
  let ready = false;
  let readyResolvers: Array<() => void> = [];
  let settled = false;
  let resolveTurn: (() => void) | null = null;
  const turnDonePromise = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });

  let finalReply = "";
  let stderrTail = "";
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const waitReady = (): Promise<void> => {
    if (ready) return Promise.resolve();
    return new Promise((resolve) => {
      readyResolvers.push(resolve);
      // Safety fallback in case ready event was missed or delayed
      setTimeout(() => {
        if (!ready) {
          ready = true;
          for (const r of readyResolvers) r();
          readyResolvers = [];
        }
      }, 4000);
    });
  };

  const sendCommand = async (type: string, extra: Record<string, unknown> = {}): Promise<unknown> => {
    await waitReady();
    if (!proc.stdin) throw new Error("Worker RPC stdin unavailable");
    const id = `wreq-${++reqCounter}`;
    const line = JSON.stringify({ id, type, ...extra }) + "\n";
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    pending.set(id, { resolve, reject });
    proc.stdin.write(line);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Worker RPC command "${type}" timed out`));
      }
    }, 20_000);
    return promise;
  };

  const startedAtMs = Date.now();
  const handle: ManagedWorkerHandle = {
    jobId: opts.jobId,
    kind: opts.kind,
    proc,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    currentTool: null,
    lastActivity: "Starting RPC worker...",
    nudgesCount: 0,
    recentEvents: [],
    aborted: false,
    sendCommand,
    abort: async () => {
      handle.aborted = true;
      pushEvent(handle, { type: "info", message: "Abort requested." });
      try {
        await sendCommand("abort");
      } catch {
        // ignore if already closing
      }
      try {
        proc.kill();
      } catch {
        // ignore
      }
      if (!settled) {
        settled = true;
        resolveTurn?.();
      }
    },
  };

  activeManagedWorkers.set(opts.jobId, handle);
  opts.onBusyChange?.(true);
  pushEvent(handle, { type: "info", message: `Spawned ${opts.kind} RPC worker.` });

  const stderrPromise = (async () => {
    if (!proc.stderr) return;
    const reader = proc.stderr.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stderrTail = (stderrTail + dec.decode(value, { stream: true })).slice(-1600);
      }
    } catch {
      // ignore
    }
  })();

  const stdoutPromise = (async () => {
    if (!proc.stdout) return;
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: RpcEvent;
          try {
            ev = JSON.parse(line) as RpcEvent;
          } catch {
            continue;
          }

          if (ev.type === "ready") {
            ready = true;
            for (const r of readyResolvers) r();
            readyResolvers = [];
            continue;
          }

          if (ev.type === "response" && ev.id && pending.has(ev.id)) {
            const p = pending.get(ev.id)!;
            pending.delete(ev.id);
            if (ev.success === false) {
              p.reject(new Error(ev.error || `Worker command ${ev.command ?? "unknown"} failed`));
            } else {
              p.resolve(ev.data);
            }
            continue;
          }

          if (ev.type === "agent_start") {
            if (settleTimer) {
              clearTimeout(settleTimer);
              settleTimer = null;
            }
            handle.lastActivity = "Thinking...";
            continue;
          }

          if (ev.type === "tool_execution_start" && typeof ev.toolName === "string") {
            const label = friendlyToolLabel(ev.toolName);
            handle.currentTool = ev.toolName;
            handle.lastActivity = label;
            pushEvent(handle, { type: "tool_start", toolName: ev.toolName, message: label });
            opts.onToolStart?.(ev.toolName, label);
            continue;
          }

          if (ev.type === "tool_execution_end" && typeof ev.toolName === "string") {
            handle.currentTool = null;
            pushEvent(handle, {
              type: "tool_end",
              toolName: ev.toolName,
              message: `Finished ${ev.toolName}`,
            });
            continue;
          }

          if (ev.type === "message_end" && ev.message?.role === "assistant") {
            const txt = extractTextContent(ev.message.content).trim();
            if (txt) {
              finalReply = txt;
              pushEvent(handle, { type: "assistant", message: txt.slice(0, 240) });
            }
            continue;
          }

          if (ev.type === "agent_end" || ev.type === "session_settled") {
            // Brief debounce in case a follow_up nudge immediately starts a new turn
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
              if (!settled) {
                settled = true;
                resolveTurn?.();
              }
            }, 350);
            continue;
          }
        }
      }
    } catch {
      // ignore stream close
    }
  })();

  const timeoutMs = opts.timeoutMs ?? 8 * 60 * 1000;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    pushEvent(handle, { type: "error", message: `Timed out after ${Math.round(timeoutMs / 1000)}s.` });
    try {
      proc.kill();
    } catch {
      // ignore
    }
    if (!settled) {
      settled = true;
      resolveTurn?.();
    }
  }, timeoutMs);

  let promptError: string | null = null;
  try {
    await sendCommand("prompt", { message: opts.prompt });
    await Promise.race([turnDonePromise, proc.exited]);
  } catch (err) {
    promptError = err instanceof Error ? err.message : String(err);
    pushEvent(handle, { type: "error", message: promptError });
  } finally {
    clearTimeout(timeoutTimer);
    if (settleTimer) clearTimeout(settleTimer);
    try {
      proc.stdin?.end();
    } catch {
      // ignore
    }
    // Give process a brief moment to exit cleanly after EOF, then terminate
    const exitedEarly = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 600)),
    ]);
    if (!exitedEarly) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }
    const [exitCode] = await Promise.all([proc.exited.catch(() => null), stdoutPromise, stderrPromise]);
    for (const [, p] of pending) {
      p.reject(new Error("Worker exited"));
    }
    pending.clear();
    activeManagedWorkers.delete(opts.jobId);
    opts.onBusyChange?.(hasActiveManagedWorkers());
    opts.onFinishBroadcast?.();

    if (handle.aborted) {
      return {
        ok: false,
        aborted: true,
        reply: finalReply,
        error: "Cancelled",
        exitCode,
      };
    }
    if (timedOut) {
      return {
        ok: false,
        aborted: false,
        reply: finalReply,
        error: `Worker timed out after ${Math.round(timeoutMs / 1000)}s`,
        exitCode,
      };
    }
    if (promptError) {
      return {
        ok: false,
        aborted: false,
        reply: finalReply,
        error: promptError,
        exitCode,
      };
    }
    const succeeded = Boolean(finalReply.trim()) || exitCode === 0 || exitCode === null;
    if (!succeeded) {
      return {
        ok: false,
        aborted: false,
        reply: finalReply,
        error: stderrTail.trim() || `Worker exited (${exitCode})`,
        exitCode,
      };
    }
    return {
      ok: true,
      aborted: false,
      reply: finalReply,
      exitCode: exitCode ?? 0,
    };
  }
}
