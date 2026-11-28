import { OMP_BIN, WORK_DIR } from "./config.ts";
import { buildAgentChildEnv } from "./child-env.ts";
import { broadcast } from "./sse.ts";
import { friendlyToolLabel, rpc, type RpcEvent } from "./rpc-bridge.ts";

// ---------- Silent Isolated Background Job Runner ----------

export function startSilentBackgroundJob(opts: {
  label: string;
  prompt: string;
  jobType: string;
}): void {
  // Fire-and-forget isolated `omp --no-session -p` turn while Tasks API hold stays active.
  void (async () => {
    try {
      const childEnv = buildAgentChildEnv();

      const proc = Bun.spawn([OMP_BIN, "--no-session", "-p", opts.prompt], {
        cwd: WORK_DIR,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      });

      const timeoutMs = 4 * 60 * 1000;
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      }, timeoutMs);

      const [exitCode, , stderrText] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
      ]);
      clearTimeout(timer);

      if (exitCode !== 0) {
        console.error(
          `[lma-web] background job "${opts.label}" failed (exit ${exitCode}):`,
          stderrText.trim().slice(0, 140)
        );
      }
    } catch (err: unknown) {
      console.error(`[lma-web] background job "${opts.label}" threw:`, err);
    } finally {
      rpc.backgroundBusy = false;
      rpc.releaseSpriteHold();
      broadcast({ type: "db_changed" });
    }
  })();
}

export function runStreamingWorker(opts: {
  tools: string;
  prompt: string;
  onFinishBroadcast?: () => void;
  fallbackReply?: string;
}): Response {
  const childEnv = buildAgentChildEnv();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // stream closed by client
        }
      };

      rpc.backgroundBusy = true;
      void rpc.holdSpriteActive();

      let finalReply = "";
      let stderrTail = "";
      let buf = "";

      try {
        const proc = Bun.spawn(
          [
            OMP_BIN,
            "--mode",
            "json",
            "--no-session",
            "--tools",
            opts.tools,
            "-p",
            opts.prompt,
          ],
          {
            cwd: WORK_DIR,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            env: childEnv,
          }
        );

        const stderrPromise = (async () => {
          if (!proc.stderr) return;
          const reader = proc.stderr.getReader();
          const dec = new TextDecoder();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              stderrTail = (stderrTail + dec.decode(value, { stream: true })).slice(-1200);
            }
          } catch {
            // ignore
          }
        })();

        if (proc.stdout) {
          const reader = proc.stdout.getReader();
          const dec = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              let ev: RpcEvent;
              try {
                ev = JSON.parse(line) as RpcEvent;
              } catch {
                continue;
              }
              if (ev.type === "message_update" && ev.assistantMessageEvent) {
                const ame = ev.assistantMessageEvent;
                if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
                  send({ type: "thinking_delta", delta: ame.delta });
                } else if (ame.type === "text_delta" && typeof ame.delta === "string") {
                  finalReply += ame.delta;
                  send({ type: "text_delta", delta: ame.delta });
                }
              } else if (ev.type === "tool_execution_start" && typeof ev.toolName === "string") {
                send({
                  type: "tool_start",
                  toolName: ev.toolName,
                  label: friendlyToolLabel(ev.toolName),
                });
              } else if (ev.type === "tool_execution_end" && typeof ev.toolName === "string") {
                send({ type: "tool_end", toolName: ev.toolName });
              }
            }
          }
        }

        const [exitCode] = await Promise.all([proc.exited, stderrPromise]);
        opts.onFinishBroadcast?.();

        if (exitCode !== 0 && !finalReply.trim()) {
          send({
            type: "error",
            error: stderrTail.trim() || `Refinement worker exited (${exitCode})`,
          });
        } else {
          send({
            type: "done",
            reply: finalReply.trim() || opts.fallbackReply || "Done.",
          });
        }
      } catch (err: unknown) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        rpc.backgroundBusy = false;
        rpc.releaseSpriteHold();
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function runOverlayRefine(slug: string, prompt: string, stream = false): Promise<Response> {
  const tools = "obs_overlay_list,obs_overlay_deploy,obs_overlay_control,box_list_assets,box_download_file,read";
  if (stream) {
    return runStreamingWorker({
      tools,
      prompt,
      fallbackReply: `Updated overlay "${slug}".`,
      onFinishBroadcast: () => broadcast({ type: "obs_overlays_changed", slug }),
    });
  }
  const childEnv = buildAgentChildEnv();

  rpc.backgroundBusy = true;
  void rpc.holdSpriteActive();
  try {
    const proc = Bun.spawn(
      [
        OMP_BIN,
        "--no-session",
        "--tools",
        "obs_overlay_list,obs_overlay_deploy,obs_overlay_control,box_list_assets,box_download_file,read",
        "-p",
        prompt,
      ],
      {
        cwd: WORK_DIR,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      }
    );
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    broadcast({ type: "obs_overlays_changed", slug });
    if (exitCode !== 0) {
      return Response.json(
        { error: stderrText.trim() || `Refinement worker exited (${exitCode})` },
        { status: 500 }
      );
    }
    return Response.json({
      ok: true,
      slug,
      reply: stdoutText.trim() || `Updated overlay "${slug}".`,
    });
  } finally {
    rpc.backgroundBusy = false;
    rpc.releaseSpriteHold();
  }
}

export async function runThumbnailWorker(slug: string, prompt: string, stream = false): Promise<Response> {
  const tools =
    "thumbnail_save,thumbnail_list,thumbnail_get,thumbnail_delete,thumbnail_render,box_list_assets,box_download_file,pixabay_search_backgrounds,pixabay_download_image,critique_thumbnail,read";
  if (stream) {
    return runStreamingWorker({
      tools,
      prompt,
      fallbackReply: `Updated thumbnail "${slug}".`,
      onFinishBroadcast: () => broadcast({ type: "thumbnails_changed", slug }),
    });
  }
  const childEnv = buildAgentChildEnv();

  rpc.backgroundBusy = true;
  void rpc.holdSpriteActive();
  try {
    const proc = Bun.spawn(
      [
        OMP_BIN,
        "--no-session",
        "--tools",
        "thumbnail_save,thumbnail_list,thumbnail_get,thumbnail_delete,thumbnail_render,box_list_assets,box_download_file,pixabay_search_backgrounds,pixabay_download_image,critique_thumbnail,read",
        "-p",
        prompt,
      ],
      {
        cwd: WORK_DIR,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: childEnv,
      }
    );
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    broadcast({ type: "thumbnails_changed", slug });
    if (exitCode !== 0) {
      return Response.json(
        { error: stderrText.trim() || `Thumbnail worker exited (${exitCode})` },
        { status: 500 }
      );
    }
    return Response.json({
      ok: true,
      slug,
      reply: stdoutText.trim() || `Updated thumbnail "${slug}".`,
    });
  } finally {
    rpc.backgroundBusy = false;
    rpc.releaseSpriteHold();
  }
}

export async function runIsolatedQuickTask(opts: {
  tools: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; reply: string; error?: string }> {
  const childEnv = buildAgentChildEnv();
  rpc.backgroundBusy = true;
  void rpc.holdSpriteActive();
  try {
    const args = [OMP_BIN, "--no-session"];
    if (opts.tools.trim()) {
      args.push("--tools", opts.tools.trim());
    }
    args.push("-p", opts.prompt);
    const proc = Bun.spawn(args, {
      cwd: WORK_DIR,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv,
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, opts.timeoutMs ?? 90_000);
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (exitCode !== 0) {
      return {
        ok: false,
        reply: "",
        error: stderrText.trim() || `Isolated worker exited (${exitCode})`,
      };
    }
    return { ok: true, reply: stdoutText.trim() };
  } finally {
    rpc.backgroundBusy = false;
    rpc.releaseSpriteHold();
  }
}
