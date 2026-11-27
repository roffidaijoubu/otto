import { OMP_BIN, WORK_DIR } from "./config.ts";
import { buildAgentChildEnv } from "./child-env.ts";
import { broadcast } from "./sse.ts";
import { rpc } from "./rpc-bridge.ts";

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

export async function runOverlayRefine(slug: string, prompt: string): Promise<Response> {
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
