import { runIsolatedQuickTask } from "../lib/background-job.ts";
import { errorMessage } from "../lib/http.ts";

export async function handleIsolatedAiRoutes(req: Request, url: URL): Promise<Response | null> {
  // Contained Contacts Outreach Drafter (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/contacts/draft-outreach") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        role?: string;
        handle?: string;
        platform?: string;
        notes?: string;
        tone?: "casual" | "professional" | "short";
        customNote?: string;
      };
      const name = String(body.name || "").trim();
      if (!name) return Response.json({ error: "Contact name is required" }, { status: 400 });

      const role = String(body.role || "contact").trim();
      const tone = body.tone === "professional" || body.tone === "short" ? body.tone : "casual";
      const customNote = String(body.customNote || "").trim();

      const prompt = [
        `ISOLATED CONTACT OUTREACH DRAFTER (return ONLY the ready-to-send message text, no preamble or meta-commentary).`,
        `Read ~/.omp/agent/MEMORY.md silently if helpful for creator persona, tone, and OPSEC boundaries.`,
        ``,
        `Recipient: ${name}`,
        `Role: ${role}`,
        body.handle ? `Handle/Email: ${body.handle}` : "",
        body.platform ? `Platform: ${body.platform}` : "",
        body.notes ? `Notes: ${body.notes}` : "",
        `Requested tone: ${tone}`,
        customNote ? `Specific goal/context: ${customNote}` : "",
        ``,
        `Write a crisp, natural, zero-fluff ${role === "collab" ? "collab pitch" : "outreach/brief message"} ready to copy-paste and send. Match the creator's natural language/vibe and strictly honor all OPSEC rules.`,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await runIsolatedQuickTask({ tools: "read", prompt, timeoutMs: 60_000 });
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error || "Could not draft outreach" }, { status: 500 });
      }
      return Response.json({ ok: true, draft: result.reply });
    } catch (err: unknown) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  // Contained Analytics Growth Insights (never clutters main Otto Chat)
  if (req.method === "POST" && url.pathname === "/api/analytics/insights") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        focusPlatform?: string;
        snapshotSummary?: string;
      };
      const focus = String(body.focusPlatform || "all platforms").trim();
      const snap = String(body.snapshotSummary || "").trim();

      const prompt = [
        `ISOLATED MULTI-PLATFORM ANALYTICS GROWTH REVIEW (concise, scannable Markdown, zero fluff).`,
        `Focus: ${focus}.`,
        snap ? `\nCurrent dashboard metrics snapshot:\n${snap}\n` : "",
        `Instructions:`,
        `1. Call studio_metrics_history (and read ~/.omp/agent/MEMORY.md if helpful) to inspect the creator's historical YouTube, TikTok, Instagram, and X trends.`,
        `2. Produce a tight Markdown report with:`,
        `   - **Key Signal** (2–3 bullet takeaways grounded in actual numbers)`,
        `   - **3 Concrete Growth Experiments** (specific, actionable tests for the next 2 weeks — strictly NO AI-generated thumbnails/art/video)`,
        `3. Keep it crisp (under 250 words), practical, and free of corporate filler.`,
      ]
        .filter(Boolean)
        .join("\n");

      const result = await runIsolatedQuickTask({
        tools: "studio_metrics_history,studio_db_overview,read",
        prompt,
        timeoutMs: 90_000,
      });
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error || "Could not generate insights" }, { status: 500 });
      }
      return Response.json({
        ok: true,
        insights: result.reply,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      return Response.json({ ok: false, error: errorMessage(err) }, { status: 400 });
    }
  }

  return null;
}
