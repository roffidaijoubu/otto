import { resolveGatewayBaseUrl } from "./gateway.ts";

export interface ServerGCalCtx {
  baseUrl: string;
  connectedAccountId: string;
  userId: string;
}

export async function resolveServerGoogleCalendar(): Promise<ServerGCalCtx | null> {
  try {
    let baseUrl = process.env.SPRITES_COMPOSIO_GATEWAY_URL?.trim()?.replace(/\/$/, "");
    if (!baseUrl) {
      baseUrl =
        (await resolveGatewayBaseUrl(
          (c) =>
            c.provider === "composio" ||
            (c.provider === "custom_api" && /composio/i.test(c.display_name ?? ""))
        )) ?? undefined;
      if (!baseUrl) return null;
    }
    const accRes = await fetch(
      `${baseUrl}/api/v3/connected_accounts?toolkit_slugs=googlecalendar&limit=20`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!accRes.ok) return null;
    const accData = (await accRes.json()) as {
      items?: Array<{ id: string; status: string; user_id?: string; userId?: string }>;
    };
    const active = accData.items?.find((a) => a.status === "ACTIVE");
    if (!active) return null;
    return {
      baseUrl,
      connectedAccountId: active.id,
      userId: active.user_id || active.userId || "default",
    };
  } catch {
    return null;
  }
}

export async function execServerGCalTool(
  ctx: ServerGCalCtx,
  slug: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${ctx.baseUrl}/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connected_account_id: ctx.connectedAccountId,
      user_id: ctx.userId,
      arguments: args,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Composio ${slug} HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
