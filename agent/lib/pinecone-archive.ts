/**
 * Zero-Key Pinecone Creator Archive Library (`agent/lib/pinecone-archive.ts`).
 *
 * Uses the native Pinecone Sprites Connector (auto-discovered via GET /v1/gateway/list)
 * to embed, upsert, query, and rerank timestamped YouTube video/VOD transcripts.
 * Pinecone is the durable source of truth across Sprite resets/checkpoints; local SQLite
 * (`archive_videos`) caches sync progress and auto-hydrates from Pinecone sentinels (`<id>#0`).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  getArchiveStats,
  getStudioMeta,
  upsertArchiveVideo,
  type ArchiveContentType,
  type ArchiveStats,
} from "./studio-db.ts";

const execFileAsync = promisify(execFile);

export const ARCHIVE_INDEX_NAME = process.env.LMA_PINECONE_INDEX?.trim() || "otto-creator-archive";
export const ARCHIVE_NAMESPACE = process.env.LMA_PINECONE_NAMESPACE?.trim() || "default";
const PINECONE_API_VERSION = "2025-04";
const EMBED_MODEL = "multilingual-e5-large";
const RERANK_MODEL = "bge-reranker-v2-m3";
const EMBED_DIMENSION = 1024;
const WINDOW_SEC = 50;
const OVERLAP_SEC = 10;
const EMBED_BATCH_SIZE = 48;
const UPSERT_BATCH_SIZE = 100;

let cachedGatewayUrl: string | null = null;

export interface DiscoveredChannelVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  contentType: ArchiveContentType;
}

export interface ArchiveSearchMatch {
  id: string;
  videoId: string;
  title: string;
  publishedAt: string;
  contentType: ArchiveContentType;
  startSec: number;
  endSec: number;
  startStr: string;
  endStr: string;
  durationSec: number;
  lang: string;
  text: string;
  score: number;
  youtubeUrl: string;
  thumbUrl: string;
}

export interface PineconeIndexInfo {
  connected: boolean;
  indexName: string;
  ready: boolean;
  totalVectorCount: number;
  namespaceVectorCount: number;
  error?: string;
}

function findYtDlpBin(): string {
  const home = process.env.HOME || "/home/sprite";
  const local = path.join(home, ".local", "bin", "yt-dlp");
  if (fs.existsSync(local)) return local;
  return "yt-dlp";
}

export function formatSec(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function extractVideoId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname === "youtu.be" || u.hostname === "www.youtu.be") {
      const seg = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(seg)) return seg;
    }
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  } catch {
    // fall through
  }
  throw new Error(`Could not extract 11-character YouTube video ID from: ${urlOrId}`);
}

export async function resolvePineconeGatewayUrl(): Promise<string> {
  if (cachedGatewayUrl) return cachedGatewayUrl;
  const envUrl = process.env.SPRITES_PINECONE_GATEWAY_URL?.trim().replace(/\/$/, "");
  if (envUrl) {
    cachedGatewayUrl = envUrl;
    return cachedGatewayUrl;
  }

  const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Sprites gateway/list failed (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{
      provider?: string;
      display_name?: string;
      gateway_base_url?: string;
    }>;
  };
  const conn = data.connections?.find(
    (c) =>
      c.provider === "pinecone" ||
      (c.provider === "custom_api" && /pinecone/i.test(c.display_name ?? ""))
  );
  if (!conn?.gateway_base_url) {
    throw new Error("Pinecone Sprites Connector is not connected.");
  }
  cachedGatewayUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedGatewayUrl;
}

async function pineconeFetch<T = Record<string, unknown>>(
  endpointPath: string,
  opts: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const baseUrl = await resolvePineconeGatewayUrl();
  const url = `${baseUrl}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
  const headers: Record<string, string> = {
    "X-Pinecone-API-Version": PINECONE_API_VERSION,
    Accept: "application/json",
  };
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(opts.body);
  }

  const res = await fetch(url, {
    method: opts.method ?? (bodyStr ? "POST" : "GET"),
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pinecone ${opts.method ?? "GET"} ${endpointPath} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (text.trim() ? JSON.parse(text) : {}) as T;
}

export async function ensureArchiveIndex(): Promise<{ indexName: string; ready: boolean }> {
  const listed = await pineconeFetch<{
    indexes?: Array<{ name?: string; status?: { ready?: boolean } }>;
  }>("/indexes");
  const existing = listed.indexes?.find((i) => i.name === ARCHIVE_INDEX_NAME);
  if (existing?.status?.ready) {
    return { indexName: ARCHIVE_INDEX_NAME, ready: true };
  }

  if (!existing) {
    await pineconeFetch("/indexes", {
      method: "POST",
      body: {
        name: ARCHIVE_INDEX_NAME,
        dimension: EMBED_DIMENSION,
        metric: "cosine",
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
        deletion_protection: "disabled",
      },
    });
  }

  for (let i = 0; i < 30; i += 1) {
    const info = await pineconeFetch<{ status?: { ready?: boolean } }>(
      `/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}`
    );
    if (info.status?.ready) {
      return { indexName: ARCHIVE_INDEX_NAME, ready: true };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for Pinecone index '${ARCHIVE_INDEX_NAME}' to become ready.`);
}

export async function getPineconeIndexInfo(): Promise<PineconeIndexInfo> {
  try {
    await resolvePineconeGatewayUrl();
  } catch (err) {
    return {
      connected: false,
      indexName: ARCHIVE_INDEX_NAME,
      ready: false,
      totalVectorCount: 0,
      namespaceVectorCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const listed = await pineconeFetch<{
      indexes?: Array<{ name?: string; status?: { ready?: boolean } }>;
    }>("/indexes");
    const found = listed.indexes?.find((i) => i.name === ARCHIVE_INDEX_NAME);
    if (!found) {
      return {
        connected: true,
        indexName: ARCHIVE_INDEX_NAME,
        ready: false,
        totalVectorCount: 0,
        namespaceVectorCount: 0,
      };
    }

    let totalVectorCount = 0;
    let namespaceVectorCount = 0;
    try {
      const stats = await pineconeFetch<{
        totalVectorCount?: number;
        namespaces?: Record<string, { vectorCount?: number }>;
      }>(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/describe_index_stats`, {
        method: "POST",
        body: {},
      });
      totalVectorCount = Number(stats.totalVectorCount ?? 0);
      namespaceVectorCount = Number(stats.namespaces?.[ARCHIVE_NAMESPACE]?.vectorCount ?? totalVectorCount);
    } catch {
      // ignore if stats endpoint is temporarily unavailable while initializing
    }

    return {
      connected: true,
      indexName: ARCHIVE_INDEX_NAME,
      ready: Boolean(found.status?.ready),
      totalVectorCount,
      namespaceVectorCount,
    };
  } catch (err) {
    return {
      connected: false,
      indexName: ARCHIVE_INDEX_NAME,
      ready: false,
      totalVectorCount: 0,
      namespaceVectorCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchExistingVideoIdsFromPinecone(videoIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  const batchSize = 50;
  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const params = new URLSearchParams();
    params.set("namespace", ARCHIVE_NAMESPACE);
    for (const vid of batch) {
      params.append("ids", `${vid}#0`);
    }
    const res = await pineconeFetch<{ vectors?: Record<string, unknown> }>(
      `/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/vectors/fetch?${params.toString()}`
    );
    for (const vecId of Object.keys(res.vectors ?? {})) {
      const idx = vecId.indexOf("#");
      if (idx > 0) existing.add(vecId.slice(0, idx));
    }
  }
  return existing;
}

export async function embedTexts(
  texts: string[],
  inputType: "passage" | "query"
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const res = await pineconeFetch<{ data?: Array<{ values?: number[] }> }>("/embed", {
      method: "POST",
      body: {
        model: EMBED_MODEL,
        parameters: { input_type: inputType, truncate: "END" },
        inputs: batch.map((text) => ({ text })),
      },
    });
    const rows = res.data ?? [];
    if (rows.length !== batch.length) {
      throw new Error(`Pinecone embed count mismatch: expected ${batch.length}, got ${rows.length}`);
    }
    for (const r of rows) {
      if (!Array.isArray(r.values)) throw new Error("Missing vector values from Pinecone embed");
      vectors.push(r.values);
    }
  }
  return vectors;
}

export async function searchCreatorArchive(opts: {
  query: string;
  topK?: number;
  contentType?: ArchiveContentType | "all";
  videoId?: string;
  useRerank?: boolean;
}): Promise<ArchiveSearchMatch[]> {
  const query = opts.query.trim();
  if (!query) return [];

  const topK = Math.max(1, Math.min(20, opts.topK ?? 8));
  const useRerank = opts.useRerank !== false;
  const candidateK = useRerank ? Math.max(20, topK * 3) : topK;

  const [queryVector] = await embedTexts([query], "query");

  const filter: Record<string, unknown> = {};
  if (opts.contentType && opts.contentType !== "all") {
    filter.content_type = { $eq: opts.contentType };
  }
  if (opts.videoId?.trim()) {
    filter.video_id = { $eq: extractVideoId(opts.videoId.trim()) };
  }

  const queryBody: Record<string, unknown> = {
    namespace: ARCHIVE_NAMESPACE,
    vector: queryVector,
    topK: candidateK,
    includeMetadata: true,
    includeValues: false,
  };
  if (Object.keys(filter).length > 0) {
    queryBody.filter = filter;
  }

  const res = await pineconeFetch<{
    matches?: Array<{
      id: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/query`, {
    method: "POST",
    body: queryBody,
  });

  const rawMatches = (res.matches ?? []).filter((m) => m.metadata && typeof m.metadata.text === "string");
  if (rawMatches.length === 0) return [];

  const toMatch = (
    m: { id: string; score?: number; metadata?: Record<string, unknown> },
    overrideScore?: number
  ): ArchiveSearchMatch => {
    const md = m.metadata ?? {};
    const videoId = String(md.video_id ?? "");
    const startSec = Math.max(0, Math.floor(Number(md.start_sec ?? 0)));
    const endSec = Math.max(startSec, Math.floor(Number(md.end_sec ?? startSec)));
    return {
      id: m.id,
      videoId,
      title: String(md.title ?? ""),
      publishedAt: String(md.published_at ?? ""),
      contentType: (String(md.content_type ?? "video") as ArchiveContentType),
      startSec,
      endSec,
      startStr: String(md.start_str ?? formatSec(startSec)),
      endStr: String(md.end_str ?? formatSec(endSec)),
      durationSec: Number(md.duration_sec ?? 0),
      lang: String(md.lang ?? ""),
      text: String(md.text ?? ""),
      score: Number((overrideScore ?? m.score ?? 0).toFixed(4)),
      youtubeUrl: `https://youtu.be/${encodeURIComponent(videoId)}?t=${startSec}`,
      thumbUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`,
    };
  };

  if (useRerank && rawMatches.length > 1) {
    try {
      const rerankRes = await pineconeFetch<{
        data?: Array<{ index: number; score: number }>;
      }>("/rerank", {
        method: "POST",
        body: {
          model: RERANK_MODEL,
          query,
          top_n: Math.min(topK, rawMatches.length),
          return_documents: false,
          documents: rawMatches.map((m) => ({
            id: m.id,
            text: `${String(m.metadata?.title ?? "")}\n${String(m.metadata?.text ?? "")}`,
          })),
        },
      });
      const ranked = rerankRes.data ?? [];
      if (ranked.length > 0) {
        return ranked
          .filter((r) => r.index >= 0 && r.index < rawMatches.length)
          .map((r) => toMatch(rawMatches[r.index], r.score));
      }
    } catch {
      // Fall back cleanly to dense vector similarity scores if rerank fails
    }
  }

  return rawMatches.slice(0, topK).map((m) => toMatch(m));
}

export function resolveCreatorChannelUrl(): string | null {
  // 1. Check cached YouTube widget metadata in studio_meta
  const ytMetaRaw = getStudioMeta("yt_metrics_widget_v1");
  if (ytMetaRaw) {
    try {
      const parsed = JSON.parse(ytMetaRaw) as { channelId?: string };
      if (parsed.channelId && /^UC[A-Za-z0-9_-]{20,}$/.test(parsed.channelId)) {
        return `https://www.youtube.com/channel/${parsed.channelId}`;
      }
    } catch {
      // ignore
    }
  }

  // 2. Scan ~/.omp/agent/MEMORY.md for a YouTube channel URL or @handle
  const home = process.env.HOME || "/home/sprite";
  const memoryPath = path.join(home, ".omp", "agent", "MEMORY.md");
  if (fs.existsSync(memoryPath)) {
    const content = fs.readFileSync(memoryPath, "utf8");
    const fullUrl = content.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9._-]+|channel\/UC[A-Za-z0-9_-]+)/i);
    if (fullUrl) return fullUrl[0];
    const ytLine = content.match(/YouTube[^\n]*?(@[A-Za-z0-9._-]+)/i);
    if (ytLine) return `https://www.youtube.com/${ytLine[1]}`;
  }

  return null;
}

export async function discoverChannelVideos(
  channelUrl: string,
  includeShorts = true
): Promise<DiscoveredChannelVideo[]> {
  const ytDlp = findYtDlpBin();
  const base = channelUrl.replace(/\/+$/, "");
  const tabs: Array<{ contentType: ArchiveContentType; url: string }> = [
    { contentType: "video", url: `${base}/videos` },
    { contentType: "live", url: `${base}/streams` },
  ];
  if (includeShorts) {
    tabs.push({ contentType: "short", url: `${base}/shorts` });
  }

  const seen = new Map<string, DiscoveredChannelVideo>();
  for (const tab of tabs) {
    try {
      const { stdout } = await execFileAsync(
        ytDlp,
        ["--no-update", "--flat-playlist", "--dump-json", "--ignore-errors", tab.url],
        { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }
      );
      for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line.startsWith("{")) continue;
        try {
          const item = JSON.parse(line) as Record<string, unknown>;
          const vid = String(item.id ?? "").trim();
          if (!/^[A-Za-z0-9_-]{11}$/.test(vid) || seen.has(vid)) continue;
          const liveStatus = String(item.live_status ?? "").toLowerCase();
          if (liveStatus === "is_upcoming" || liveStatus === "is_live") continue;
          const ud = String(item.upload_date ?? "");
          const publishedAt =
            ud.length === 8 && /^\d{8}$/.test(ud)
              ? `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}`
              : "";
          seen.set(vid, {
            videoId: vid,
            title: String(item.title ?? "").trim(),
            publishedAt,
            durationSec: typeof item.duration === "number" ? Math.floor(item.duration) : 0,
            contentType: tab.contentType,
          });
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // ignore missing tab (e.g. channel has no /streams or /shorts)
    }
  }
  return Array.from(seen.values());
}

interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

interface TranscriptChunk {
  chunkIndex: number;
  startSec: number;
  endSec: number;
  startStr: string;
  endStr: string;
  text: string;
}

function parseJson3File(filePath: string): TranscriptSegment[] {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
  };
  const segments: TranscriptSegment[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs?.length) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || /^\[(Musik|Music|Applause|Tepuk tangan)\]$/i.test(text)) continue;
    const startMs = Number(ev.tStartMs ?? 0);
    const durMs = Number(ev.dDurationMs ?? 0);
    segments.push({
      startSec: Math.floor(startMs / 1000),
      endSec: Math.floor((startMs + durMs) / 1000),
      text,
    });
  }
  segments.sort((a, b) => a.startSec - b.startSec);
  return segments;
}

function chunkTranscriptSegments(segments: TranscriptSegment[]): TranscriptChunk[] {
  if (segments.length === 0) return [];
  const chunks: TranscriptChunk[] = [];
  const stepSec = Math.max(10, WINDOW_SEC - OVERLAP_SEC);
  const maxEnd = Math.max(...segments.map((s) => s.endSec));
  let winStart = segments[0].startSec;
  let idx = 0;

  while (winStart <= maxEnd) {
    const winEnd = winStart + WINDOW_SEC;
    const texts: string[] = [];
    let actualStart: number | null = null;
    let actualEnd = winStart;

    for (const s of segments) {
      if (s.startSec >= winEnd) break;
      if (s.endSec >= winStart || s.startSec >= winStart) {
        if (actualStart === null) actualStart = s.startSec;
        actualEnd = Math.max(actualEnd, s.endSec, s.startSec);
        texts.push(s.text);
      }
    }

    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length >= 25 && actualStart !== null) {
      const endSec = Math.max(actualEnd, actualStart + 5);
      chunks.push({
        chunkIndex: idx,
        startSec: actualStart,
        endSec,
        startStr: formatSec(actualStart),
        endStr: formatSec(endSec),
        text: joined.slice(0, 1600),
      });
      idx += 1;
    }

    if (winEnd >= maxEnd) break;
    winStart += stepSec;
  }

  return chunks;
}

export async function indexSingleVideo(
  input: string | DiscoveredChannelVideo,
  langs = ["id-orig", "id", "en-orig", "en"]
): Promise<{
  videoId: string;
  title: string;
  status: "indexed" | "no_captions";
  chunkCount: number;
  lang: string;
}> {
  await ensureArchiveIndex();

  const videoId = typeof input === "string" ? extractVideoId(input) : input.videoId;
  let title = typeof input === "string" ? "" : input.title;
  let publishedAt = typeof input === "string" ? "" : input.publishedAt;
  let durationSec = typeof input === "string" ? 0 : input.durationSec;
  let contentType: ArchiveContentType = typeof input === "string" ? "video" : input.contentType;

  upsertArchiveVideo({
    videoId,
    title,
    publishedAt,
    durationSec,
    contentType,
    status: "indexing",
    error: "",
  });

  const ytDlp = findYtDlpBin();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `otto-arch-${videoId}-`));

  try {
    let pickedLang = "";
    let segments: TranscriptSegment[] = [];

    for (const lang of langs) {
      await execFileAsync(
        ytDlp,
        [
          "--no-update",
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          lang,
          "--sub-format",
          "json3",
          "--write-info-json",
          "--no-warnings",
          "--quiet",
          "--output",
          path.join(tmpDir, "%(id)s.%(ext)s"),
          url,
        ],
        { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }
      ).catch(() => {});

      const infoPath = path.join(tmpDir, `${videoId}.info.json`);
      if (fs.existsSync(infoPath)) {
        try {
          const info = JSON.parse(fs.readFileSync(infoPath, "utf8")) as Record<string, unknown>;
          if (!title && typeof info.title === "string") title = info.title.trim();
          if (!durationSec && typeof info.duration === "number") durationSec = Math.floor(info.duration);
          const ud = String(info.upload_date ?? "");
          if (!publishedAt && ud.length === 8 && /^\d{8}$/.test(ud)) {
            publishedAt = `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}`;
          }
          if (typeof input === "string") {
            const wasLive = Boolean(info.was_live || info.is_live);
            if (wasLive) contentType = "live";
            else if (durationSec > 0 && durationSec <= 65) contentType = "short";
          }
        } catch {
          // ignore info parse errors
        }
      }

      const cand = path.join(tmpDir, `${videoId}.${lang}.json3`);
      if (fs.existsSync(cand)) {
        segments = parseJson3File(cand);
        pickedLang = lang;
        break;
      }
    }

    const chunks = chunkTranscriptSegments(segments);
    if (chunks.length === 0) {
      upsertArchiveVideo({
        videoId,
        title,
        publishedAt,
        durationSec,
        contentType,
        status: "no_captions",
        chunkCount: 0,
        lang: "",
        error: "",
      });
      return { videoId, title, status: "no_captions", chunkCount: 0, lang: "" };
    }

    const embedInputs = chunks.map((c) => `${title}\n[${c.startStr}] ${c.text}`);
    const embeddings = await embedTexts(embedInputs, "passage");

    const vectors = chunks.map((c, i) => ({
      id: `${videoId}#${c.chunkIndex}`,
      values: embeddings[i],
      metadata: {
        video_id: videoId,
        title: title.slice(0, 300),
        published_at: publishedAt,
        content_type: contentType,
        start_sec: c.startSec,
        end_sec: c.endSec,
        start_str: c.startStr,
        end_str: c.endStr,
        duration_sec: durationSec,
        chunk_index: c.chunkIndex,
        lang: pickedLang,
        text: c.text,
      },
    }));

    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      await pineconeFetch(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/vectors/upsert`, {
        method: "POST",
        body: {
          namespace: ARCHIVE_NAMESPACE,
          vectors: vectors.slice(i, i + UPSERT_BATCH_SIZE),
        },
      });
    }

    upsertArchiveVideo({
      videoId,
      title,
      publishedAt,
      durationSec,
      contentType,
      status: "indexed",
      chunkCount: vectors.length,
      lang: pickedLang,
      error: "",
      indexedAt: new Date().toISOString(),
    });

    return {
      videoId,
      title,
      status: "indexed",
      chunkCount: vectors.length,
      lang: pickedLang,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    upsertArchiveVideo({
      videoId,
      title,
      publishedAt,
      durationSec,
      contentType,
      status: "failed",
      error: msg.slice(0, 400),
    });
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function getCombinedArchiveOverview(): Promise<{
  pinecone: PineconeIndexInfo;
  local: ArchiveStats;
  channelUrl: string | null;
}> {
  const [pinecone, local] = await Promise.all([
    getPineconeIndexInfo(),
    Promise.resolve(getArchiveStats()),
  ]);
  return {
    pinecone,
    local,
    channelUrl: resolveCreatorChannelUrl(),
  };
}
