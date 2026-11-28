/**
 * Shared zero-key Apify Sprites Connector helper (`agent/lib/apify.ts`).
 *
 * Only executes explicitly curated, benchmarked pay-per-event actors
 * (never arbitrary actor IDs) with strict item caps to prevent runaway spend.
 */

export const CURATED_APIFY_ACTORS = {
  tiktok: "clockworks~tiktok-scraper",
  instagram: "apify~instagram-scraper",
  x: "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest",
  xFallback: "apidojo~tweet-scraper",
} as const;

export type CuratedApifyActorId =
  (typeof CURATED_APIFY_ACTORS)[keyof typeof CURATED_APIFY_ACTORS];

const ALLOWED_ACTORS = new Set<string>(Object.values(CURATED_APIFY_ACTORS));

let cachedBaseUrl: string | null = null;

export function resetApifyGatewayCache(): void {
  cachedBaseUrl = null;
}

export async function getApifyGatewayUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  if (process.env.SPRITES_APIFY_GATEWAY_URL) {
    cachedBaseUrl = process.env.SPRITES_APIFY_GATEWAY_URL.replace(/\/$/, "");
    return cachedBaseUrl;
  }

  const res = await fetch("https://api.sprites.dev/v1/gateway/list");
  if (!res.ok) {
    throw new Error(`Failed to query Sprites gateway/list (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{
      provider: string;
      display_name?: string;
      gateway_base_url: string;
    }>;
  };
  const conn = data.connections?.find(
    (c) =>
      c.provider === "apify" ||
      (c.provider === "custom_api" && /apify/i.test(c.display_name ?? ""))
  );
  if (!conn) {
    throw new Error(
      "No authorized Apify Sprites Connector found. Add the Apify connector in Sprites Dashboard (https://sprites.dev -> Connectors) and grant access to this Sprite."
    );
  }
  cachedBaseUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedBaseUrl;
}

export interface ApifyRunResult<T = Record<string, unknown>> {
  actorId: string;
  runId: string;
  datasetId: string;
  status: string;
  elapsedSec: number;
  items: T[];
}

export function clampApifyLimit(raw: number | undefined, fallback = 8, max = 25): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(raw)));
}

export async function runCuratedApifyActor<T = Record<string, unknown>>(
  actorId: CuratedApifyActorId,
  input: Record<string, unknown>,
  opts?: { limit?: number; timeoutSec?: number }
): Promise<ApifyRunResult<T>> {
  if (!ALLOWED_ACTORS.has(actorId)) {
    throw new Error(`Actor '${actorId}' is not in Otto's curated Apify allowlist.`);
  }

  const baseUrl = await getApifyGatewayUrl();
  const limit = clampApifyLimit(opts?.limit, 8, 25);
  const timeoutSec = Math.max(20, Math.min(120, opts?.timeoutSec ?? 75));
  const startedAt = Date.now();

  const runRes = await fetch(
    `${baseUrl}/v2/actors/${encodeURIComponent(actorId)}/runs?waitForFinish=60`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(
      `Apify actor ${actorId} failed to start (${runRes.status}): ${errText.slice(0, 400)}`
    );
  }

  const runJson = (await runRes.json()) as {
    data?: { id?: string; status?: string; defaultDatasetId?: string };
  };
  const runId = runJson.data?.id;
  let status = runJson.data?.status ?? "UNKNOWN";
  let datasetId = runJson.data?.defaultDatasetId ?? "";
  if (!runId) {
    throw new Error(`Apify actor ${actorId} did not return a run ID.`);
  }

  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if ((Date.now() - startedAt) / 1000 >= timeoutSec) {
      throw new Error(
        `Apify actor ${actorId} timed out after ${timeoutSec}s (run ${runId}, status ${status}).`
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${baseUrl}/v2/actor-runs/${encodeURIComponent(runId)}`);
    if (!pollRes.ok) {
      throw new Error(`Failed to poll Apify run ${runId} (${pollRes.status})`);
    }
    const pollJson = (await pollRes.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    status = pollJson.data?.status ?? status;
    datasetId = pollJson.data?.defaultDatasetId ?? datasetId;
  }

  const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  if (status !== "SUCCEEDED") {
    throw new Error(`Apify actor ${actorId} ended with status ${status} (run ${runId}).`);
  }
  if (!datasetId) {
    return { actorId, runId, datasetId: "", status, elapsedSec, items: [] };
  }

  const dsRes = await fetch(
    `${baseUrl}/v2/datasets/${encodeURIComponent(datasetId)}/items?limit=${limit}&clean=true`
  );
  if (!dsRes.ok) {
    const errText = await dsRes.text();
    throw new Error(
      `Failed to fetch Apify dataset ${datasetId} (${dsRes.status}): ${errText.slice(0, 300)}`
    );
  }
  const items = (await dsRes.json()) as T[];
  return {
    actorId,
    runId,
    datasetId,
    status,
    elapsedSec,
    items: Array.isArray(items) ? items.slice(0, limit) : [],
  };
}
