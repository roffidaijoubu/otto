/**
 * Shared Upstash QStash CRON_TZ validation & gateway URL resolution helpers.
 * Zero outbound API keys stored in the Sprite — resolves QStash via Sprites Gateway at runtime.
 */

const CRON_FIELD_RE = /^[0-9*,/\-A-Za-z]+$/;
const IANA_TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;

/**
 * Validates and normalizes an Upstash QStash cron expression.
 * Supports BOTH standard 5-field UTC cron (`0 2 * * 1`) and timezone-aware
 * `CRON_TZ=<IANA_Timezone> <5-field-cron>` (e.g. `CRON_TZ=Asia/Bangkok 0 0 * * *`).
 */
export function normalizeQStashCron(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned || /[\r\n\0]/.test(cleaned)) {
    throw new Error("Cron expression must be a single line without control characters.");
  }

  let tzPrefix = "";
  let expr = cleaned;
  if (/^CRON_TZ=/i.test(cleaned)) {
    const firstSpace = cleaned.indexOf(" ");
    if (firstSpace < 0) {
      throw new Error("CRON_TZ prefix must be followed by a 5-field cron expression.");
    }
    const tzPart = cleaned.slice(0, firstSpace);
    const tzName = tzPart.slice("CRON_TZ=".length);
    if (!tzName || !IANA_TZ_RE.test(tzName)) {
      throw new Error(`Invalid IANA timezone in CRON_TZ: ${tzName}`);
    }
    // Verify timezone is recognized by Intl when available
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tzName });
    } catch {
      throw new Error(`Unrecognized IANA timezone in CRON_TZ: ${tzName}`);
    }
    tzPrefix = `CRON_TZ=${tzName} `;
    expr = cleaned.slice(firstSpace + 1).trim();
  }

  const fields = expr.split(" ");
  if (fields.length !== 5) {
    throw new Error(
      `QStash cron must have exactly 5 fields (minute hour dom month dow), got ${fields.length}: "${expr}"`
    );
  }
  for (const field of fields) {
    if (!CRON_FIELD_RE.test(field)) {
      throw new Error(`Invalid cron field "${field}" in "${expr}"`);
    }
  }
  return `${tzPrefix}${fields.join(" ")}`;
}

export function extractIanaTimezone(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "UTC";
  // Extract first IANA-like token (e.g. "Asia/Jakarta" from "Asia/Jakarta (WIB, UTC+7)")
  const ianaMatch = cleaned.match(/\b([A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){1,2})\b/);
  if (ianaMatch) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: ianaMatch[1] });
      return ianaMatch[1];
    } catch {
      // fall through
    }
  }
  const upper = cleaned.toUpperCase();
  if (/\bWIB\b/.test(upper)) return "Asia/Jakarta";
  if (/\bWITA\b/.test(upper)) return "Asia/Makassar";
  if (/\bWIT\b/.test(upper)) return "Asia/Jayapura";
  if (/\bUTC\b|\bGMT\b/.test(upper)) return "UTC";
  return cleaned.split(/\s+/)[0] || "UTC";
}

export function buildMidnightCronForTimezone(timezone: string): string {
  const tz = extractIanaTimezone(timezone);
  if (!tz || tz.toUpperCase() === "UTC") {
    return normalizeQStashCron("CRON_TZ=UTC 0 0 * * *");
  }
  return normalizeQStashCron(`CRON_TZ=${tz} 0 0 * * *`);
}

let cachedQStashGateway: string | null = null;

export async function resolveQStashGatewayUrl(): Promise<string | null> {
  if (cachedQStashGateway) return cachedQStashGateway;
  const fromEnv = process.env.SPRITES_QSTASH_GATEWAY_URL?.trim();
  if (fromEnv) {
    cachedQStashGateway = fromEnv.replace(/\/$/, "");
    return cachedQStashGateway;
  }
  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{
        provider: string;
        display_name?: string;
        gateway_base_url: string;
      }>;
    };
    const conn = data.connections?.find(
      (c) =>
        c.provider === "qstash" ||
        (c.provider === "custom_api" && /qstash/i.test(c.display_name ?? ""))
    );
    if (!conn) return null;
    cachedQStashGateway = conn.gateway_base_url.replace(/\/$/, "");
    return cachedQStashGateway;
  } catch {
    return null;
  }
}
