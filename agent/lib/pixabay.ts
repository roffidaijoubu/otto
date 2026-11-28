/**
 * Zero-local-key Pixabay Sprites Custom API Connector client.
 * Auth: query_param (`key`) injected by Fly.io Sprites Gateway.
 * Strict non-AI guardrail: hard-filters `isAiGenerated === false` and `isLowQuality === false`.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchSafePublicHttpsBuffer, type PinnedHttpsFetchOptions } from "./ssrf-guard.ts";

const GATEWAY_LIST_URL = "https://api.sprites.dev/v1/gateway/list";
const AI_TAG_REGEX = /\b(ai[- ]?generated|midjourney|stable[- ]?diffusion|dall-?e|generative[- ]?ai)\b/i;

let cachedPixabay: { gatewayBaseUrl: string; upstreamHasApiPath: boolean } | null = null;

export interface PixabayPhotoHit {
  id: number;
  heading: string;
  description: string;
  tags: string;
  width: number;
  height: number;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  pageURL: string;
  photographer: string;
}

export async function resolvePixabayGateway(
  forceRefresh = false
): Promise<{ gatewayBaseUrl: string; upstreamHasApiPath: boolean } | null> {
  if (cachedPixabay && !forceRefresh) return cachedPixabay;
  const fromEnv = process.env.SPRITES_PIXABAY_GATEWAY_URL?.trim();
  if (fromEnv) {
    cachedPixabay = {
      gatewayBaseUrl: fromEnv.replace(/\/+$/, ""),
      upstreamHasApiPath: true,
    };
    return cachedPixabay;
  }
  try {
    const res = await fetch(GATEWAY_LIST_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{
        provider?: string;
        display_name?: string;
        base_api_url?: string;
        gateway_base_url?: string;
        provider_info?: { base_api_url?: string };
      }>;
    };
    const match = (data.connections || []).find((c) => {
      const api = (c.base_api_url || c.provider_info?.base_api_url || "").toLowerCase();
      return api.includes("pixabay.com") || /\bpixabay\b/i.test(c.display_name || "");
    });
    if (!match?.gateway_base_url) return null;
    const upstreamApi = (match.base_api_url || match.provider_info?.base_api_url || "").replace(/\/+$/, "");
    cachedPixabay = {
      gatewayBaseUrl: match.gateway_base_url.replace(/\/+$/, ""),
      upstreamHasApiPath: /\/api$/i.test(upstreamApi),
    };
    return cachedPixabay;
  } catch {
    return null;
  }
}

export async function resolvePixabayGatewayUrl(forceRefresh = false): Promise<string | null> {
  const info = await resolvePixabayGateway(forceRefresh);
  return info?.gatewayBaseUrl ?? null;
}

export async function searchPixabayBackgrounds(opts: {
  query: string;
  limit?: number;
  colors?: string;
  editorsChoice?: boolean;
  minWidth?: number;
}): Promise<{ totalHits: number; filteredOutAi: number; hits: PixabayPhotoHit[] }> {
  const gateway = await resolvePixabayGateway();
  if (!gateway) {
    throw new Error(
      "Pixabay Sprites Connector is not connected. Add Pixabay (query_param: key) in Sprites Connectors first."
    );
  }
  const q = opts.query.trim();
  if (!q) throw new Error("Search query is required.");

  const desired = Math.max(1, Math.min(20, Math.round(opts.limit ?? 8)));
  const fetchCount = Math.min(40, Math.max(12, desired * 3));
  const params = new URLSearchParams({
    q,
    image_type: "photo",
    orientation: "horizontal",
    safesearch: "true",
    min_width: String(Math.max(640, opts.minWidth ?? 1280)),
    per_page: String(fetchCount),
    order: "popular",
  });
  if (opts.colors?.trim()) params.set("colors", opts.colors.trim());
  if (opts.editorsChoice) params.set("editors_choice", "true");

  // Query-parameter auth on Sprites Gateway requires identity/gzip (no brotli/206)
  const endpoint = gateway.upstreamHasApiPath
    ? `${gateway.gatewayBaseUrl}/?${params.toString()}`
    : `${gateway.gatewayBaseUrl}/api/?${params.toString()}`;
  const res = await fetch(endpoint, {
    headers: { "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Pixabay search failed (HTTP ${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    totalHits?: number;
    hits?: Array<{
      id: number;
      type?: string;
      tags?: string;
      heading?: string;
      description?: string;
      imageWidth?: number;
      imageHeight?: number;
      previewURL?: string;
      webformatURL?: string;
      largeImageURL?: string;
      pageURL?: string;
      user?: string;
      isAiGenerated?: boolean;
      isLowQuality?: boolean;
    }>;
  };

  let filteredOutAi = 0;
  const clean: PixabayPhotoHit[] = [];

  for (const h of data.hits || []) {
    const tags = String(h.tags || "");
    const heading = String(h.heading || "");
    const desc = String(h.description || "");
    if (
      h.isAiGenerated === true ||
      h.isLowQuality === true ||
      AI_TAG_REGEX.test(tags) ||
      AI_TAG_REGEX.test(heading) ||
      AI_TAG_REGEX.test(desc)
    ) {
      filteredOutAi += 1;
      continue;
    }
    if (!h.largeImageURL && !h.webformatURL) continue;
    clean.push({
      id: h.id,
      heading: heading || tags.split(",").slice(0, 3).join(",").trim(),
      description: desc,
      tags,
      width: h.imageWidth ?? 1280,
      height: h.imageHeight ?? 720,
      previewURL: h.previewURL || "",
      webformatURL: h.webformatURL || "",
      largeImageURL: h.largeImageURL || h.webformatURL || "",
      pageURL: h.pageURL || "",
      photographer: h.user || "Pixabay",
    });
    if (clean.length >= desired) break;
  }

  return {
    totalHits: data.totalHits ?? clean.length,
    filteredOutAi,
    hits: clean,
  };
}

function assertPixabayHost(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS Pixabay URLs are allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (host !== "pixabay.com" && host !== "cdn.pixabay.com" && !host.endsWith(".pixabay.com")) {
    throw new Error(`Blocked non-Pixabay host: ${host}`);
  }
}

export async function downloadPixabayImage(
  imageUrl: string,
  destAbsPath: string,
  fetchOpts: Pick<PinnedHttpsFetchOptions, "lookupFn" | "requestImpl" | "maxBytes"> = {}
): Promise<{ size: number; destAbsPath: string; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("Invalid Pixabay image URL.");
  }
  assertPixabayHost(parsed);

  const fetched = await fetchSafePublicHttpsBuffer(parsed.toString(), {
    maxBytes: fetchOpts.maxBytes ?? 15 * 1024 * 1024,
    maxRedirects: 4,
    timeoutMs: 30_000,
    lookupFn: fetchOpts.lookupFn,
    requestImpl: fetchOpts.requestImpl,
  });
  // Ensure any redirect destination remained on an allowed Pixabay host
  assertPixabayHost(new URL(fetched.finalUrl));
  if (fetched.bytes.length === 0) {
    throw new Error("Downloaded Pixabay image was empty.");
  }

  fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
  fs.writeFileSync(destAbsPath, fetched.bytes);
  return {
    size: fetched.bytes.length,
    destAbsPath,
    contentType: fetched.contentType || "image/jpeg",
  };
}
