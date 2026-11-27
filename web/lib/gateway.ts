export interface GatewayConnection {
  provider?: string;
  display_name?: string;
  gateway_base_url?: string;
  connection_type?: string;
  description?: string;
  updated_at?: string;
}

export type GatewayListResult =
  | { ok: true; connections: GatewayConnection[] }
  | { ok: false; status: number };

export async function fetchGatewayList(timeoutMs = 8000): Promise<GatewayListResult> {
  const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const data = (await res.json()) as { connections?: GatewayConnection[] };
  return { ok: true, connections: data.connections ?? [] };
}

export async function resolveGatewayBaseUrl(
  providerMatch: (g: any) => boolean,
  timeoutMs = 8000
): Promise<string | null> {
  try {
    const result = await fetchGatewayList(timeoutMs);
    if (!result.ok) return null;
    const conn = result.connections.find(providerMatch);
    return conn?.gateway_base_url ? conn.gateway_base_url.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}
