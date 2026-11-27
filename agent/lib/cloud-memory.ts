/**
 * Persistent Cloud Long-Term Memory (`agent/lib/cloud-memory.ts`).
 *
 * Dual-writes Otto's conversational memories to:
 *   1. Neon Serverless Postgres (`studio_memories` table — structured durability)
 *   2. Pinecone Serverless Index (`otto-creator-archive`, isolated namespace `otto-memory`)
 *      with `multilingual-e5-large` embeddings + `bge-reranker-v2-m3` semantic recall.
 *
 * Survives Sprite resets, deployments, and checkpoints with zero local API keys.
 */

import {
  ARCHIVE_INDEX_NAME,
  embedTexts,
  ensureArchiveIndex,
  resolvePineconeGatewayUrl,
} from "./pinecone-archive.ts";
import {
  deleteStudioMemory,
  listStudioMemories,
  upsertStudioMemory,
  type StudioMemory,
  type StudioMemoryCategory,
} from "./studio-db.ts";

export const MEMORY_NAMESPACE = "otto-memory";
const PINECONE_API_VERSION = "2025-04";
const RERANK_MODEL = "bge-reranker-v2-m3";

export interface RecalledMemory extends StudioMemory {
  score: number;
}

async function pineconeMemoryFetch<T = Record<string, unknown>>(
  endpointPath: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {}
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
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pinecone memory ${opts.method ?? "GET"} ${endpointPath} failed (${res.status}): ${text.slice(0, 250)}`);
  }
  return (text.trim() ? JSON.parse(text) : {}) as T;
}

export async function rememberCloudMemory(input: {
  id?: string;
  category?: StudioMemoryCategory;
  content: string;
  tags?: string[];
  source?: string;
}): Promise<{ memory: StudioMemory; vectorSynced: boolean }> {
  const memory = await upsertStudioMemory(input);
  let vectorSynced = false;

  try {
    await ensureArchiveIndex();
    const embedText = `[${memory.category}] ${memory.content}${
      memory.tags.length > 0 ? ` (${memory.tags.join(", ")})` : ""
    }`;
    const [values] = await embedTexts([embedText], "passage");
    await pineconeMemoryFetch(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/vectors/upsert`, {
      method: "POST",
      body: {
        namespace: MEMORY_NAMESPACE,
        vectors: [
          {
            id: memory.id,
            values,
            metadata: {
              category: memory.category,
              content: memory.content.slice(0, 2000),
              tags: memory.tags,
              source: memory.source,
              created_at: memory.createdAt,
              updated_at: memory.updatedAt,
            },
          },
        ],
      },
    });
    vectorSynced = true;
  } catch (err) {
    console.warn(
      "[cloud-memory] Pinecone sync warning (saved in Neon):",
      err instanceof Error ? err.message : String(err)
    );
  }

  return { memory, vectorSynced };
}

export async function recallCloudMemories(opts: {
  query: string;
  topK?: number;
  category?: StudioMemoryCategory;
}): Promise<RecalledMemory[]> {
  const query = opts.query.trim();
  const topK = Math.max(1, Math.min(15, opts.topK ?? 6));

  if (!query) {
    const recent = await listStudioMemories({ category: opts.category, limit: topK });
    return recent.map((m) => ({ ...m, score: 1 }));
  }

  try {
    const [queryVec] = await embedTexts([query], "query");
    const body: Record<string, unknown> = {
      namespace: MEMORY_NAMESPACE,
      vector: queryVec,
      topK: Math.max(16, topK * 3),
      includeMetadata: true,
      includeValues: false,
    };
    if (opts.category) {
      body.filter = { category: { $eq: opts.category } };
    }

    const res = await pineconeMemoryFetch<{
      matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }>;
    }>(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/query`, {
      method: "POST",
      body,
    });

    const raw = (res.matches ?? []).filter((m) => m.metadata && typeof m.metadata.content === "string");
    if (raw.length === 0) {
      // Fallback to recent Neon memories if namespace is empty
      const fallback = await listStudioMemories({ category: opts.category, limit: topK });
      return fallback.map((m) => ({ ...m, score: 0.5 }));
    }

    const toRecalled = (
      m: { id: string; score?: number; metadata?: Record<string, unknown> },
      overrideScore?: number
    ): RecalledMemory => {
      const md = m.metadata ?? {};
      return {
        id: m.id,
        category: (String(md.category ?? "general") as StudioMemoryCategory),
        content: String(md.content ?? ""),
        tags: Array.isArray(md.tags) ? md.tags.map(String) : [],
        source: String(md.source ?? "otto"),
        createdAt: String(md.created_at ?? ""),
        updatedAt: String(md.updated_at ?? ""),
        score: Number((overrideScore ?? m.score ?? 0).toFixed(4)),
      };
    };

    if (raw.length > 1) {
      try {
        const rr = await pineconeMemoryFetch<{ data?: Array<{ index: number; score: number }> }>(
          "/rerank",
          {
            method: "POST",
            body: {
              model: RERANK_MODEL,
              query,
              top_n: Math.min(topK, raw.length),
              return_documents: false,
              documents: raw.map((m) => ({
                id: m.id,
                text: `[${String(m.metadata?.category ?? "general")}] ${String(m.metadata?.content ?? "")}`,
              })),
            },
          }
        );
        const ranked = rr.data ?? [];
        if (ranked.length > 0) {
          return ranked
            .filter((r) => r.index >= 0 && r.index < raw.length)
            .map((r) => toRecalled(raw[r.index], r.score));
        }
      } catch {
        // Fall back to dense vector scores
      }
    }

    return raw.slice(0, topK).map((m) => toRecalled(m));
  } catch {
    // Graceful Neon substring fallback if Pinecone is offline
    const all = await listStudioMemories({ category: opts.category, limit: 100 });
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    const scored = all
      .map((m) => {
        const hay = `${m.category} ${m.content} ${m.tags.join(" ")}`.toLowerCase();
        const hits = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { ...m, score: terms.length > 0 ? hits / terms.length : 0.5 };
      })
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

export async function forgetCloudMemory(id: string): Promise<{ deleted: boolean; vectorDeleted: boolean }> {
  const deleted = await deleteStudioMemory(id);
  let vectorDeleted = false;
  try {
    await pineconeMemoryFetch(`/indexes/${encodeURIComponent(ARCHIVE_INDEX_NAME)}/vectors/delete`, {
      method: "POST",
      body: {
        namespace: MEMORY_NAMESPACE,
        ids: [id],
      },
    });
    vectorDeleted = true;
  } catch {
    // ignore if vector wasn't present
  }
  return { deleted, vectorDeleted };
}
