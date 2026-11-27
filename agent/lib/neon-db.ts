/**
 * Zero-Key Neon Serverless Postgres Bootstrap (`agent/lib/neon-db.ts`).
 *
 * Auto-discovers the native `neon` Sprites Connector via GET /v1/gateway/list,
 * ensures the `lma-studio` project exists (respecting `name_prefix: "lma"`),
 * fetches a live `connection_uri` strictly in-memory (never persisted to disk),
 * and opens a pooled Bun.SQL Postgres client.
 */

import { SQL } from "bun";

export const NEON_PROJECT_NAME = process.env.LMA_NEON_PROJECT_NAME?.trim() || "lma-studio";
export const NEON_REGION = process.env.LMA_NEON_REGION?.trim() || "aws-ap-southeast-1";

export interface NeonRuntimeInfo {
  backend: "neon" | "sqlite";
  projectId?: string;
  projectName?: string;
  region?: string;
  branchId?: string;
  reason?: string;
}

interface ResolvedNeonConnection {
  sql: SQL;
  info: NeonRuntimeInfo;
}

let cachedPromise: Promise<ResolvedNeonConnection | null> | null = null;
let cachedInfo: NeonRuntimeInfo = { backend: "sqlite", reason: "Not initialized" };

export function getNeonRuntimeInfo(): NeonRuntimeInfo {
  return { ...cachedInfo };
}

async function resolveNeonGatewayUrl(): Promise<string | null> {
  const envUrl = process.env.SPRITES_NEON_GATEWAY_URL?.trim().replace(/\/$/, "");
  if (envUrl) return envUrl;

  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      connections?: Array<{
        provider?: string;
        display_name?: string;
        gateway_base_url?: string;
      }>;
    };
    const conn = data.connections?.find(
      (c) =>
        c.provider === "neon" ||
        (c.provider === "custom_api" && /neon/i.test(c.display_name ?? ""))
    );
    return conn?.gateway_base_url ? conn.gateway_base_url.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function neonApi<T = Record<string, unknown>>(
  baseUrl: string,
  endpoint: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: opts.method ?? (bodyStr ? "POST" : "GET"),
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Neon API ${opts.method ?? "GET"} ${endpoint} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (text.trim() ? JSON.parse(text) : {}) as T;
}

async function initNeonConnection(): Promise<ResolvedNeonConnection | null> {
  // Optional direct DATABASE_URL override for local scripts/testing (never committed)
  const directUri = process.env.LMA_NEON_DATABASE_URL?.trim();
  if (directUri) {
    const sql = new SQL({ url: directUri, max: 5, idleTimeout: 30 });
    cachedInfo = { backend: "neon", projectName: NEON_PROJECT_NAME, region: "direct-env" };
    return { sql, info: cachedInfo };
  }

  const baseUrl = await resolveNeonGatewayUrl();
  if (!baseUrl) {
    cachedInfo = { backend: "sqlite", reason: "Neon Sprites Connector not connected" };
    return null;
  }

  try {
    const orgsRes = await neonApi<{ organizations?: Array<{ id?: string; name?: string }> }>(
      baseUrl,
      "/api/v2/users/me/organizations"
    );
    const orgId = orgsRes.organizations?.[0]?.id;
    const projectsEndpoint = orgId
      ? `/api/v2/projects?org_id=${encodeURIComponent(orgId)}`
      : "/api/v2/projects";

    const projRes = await neonApi<{
      projects?: Array<{ id: string; name: string; region_id?: string }>;
    }>(baseUrl, projectsEndpoint);

    let project = projRes.projects?.find((p) => p.name === NEON_PROJECT_NAME);
    let defaultBranchId = "";

    if (!project) {
      const created = await neonApi<{
        project?: { id: string; name: string; region_id?: string };
        branch?: { id: string };
      }>(baseUrl, "/api/v2/projects", {
        method: "POST",
        body: {
          project: {
            name: NEON_PROJECT_NAME,
            ...(orgId ? { org_id: orgId } : {}),
            region_id: NEON_REGION,
          },
        },
      });
      if (!created.project?.id) {
        throw new Error("Neon project creation returned no project id");
      }
      project = created.project;
      defaultBranchId = created.branch?.id || "";
    }

    if (!defaultBranchId) {
      const brRes = await neonApi<{
        branches?: Array<{ id: string; primary?: boolean; default?: boolean; name?: string }>;
      }>(baseUrl, `/api/v2/projects/${encodeURIComponent(project.id)}/branches`);
      const primary =
        brRes.branches?.find((b) => b.primary || b.default || b.name === "main") ??
        brRes.branches?.[0];
      defaultBranchId = primary?.id || "";
    }

    const uriParams = new URLSearchParams({
      database_name: "neondb",
      role_name: "neondb_owner",
    });
    if (defaultBranchId) uriParams.set("branch_id", defaultBranchId);

    const uriRes = await neonApi<{ uri?: string }>(
      baseUrl,
      `/api/v2/projects/${encodeURIComponent(project.id)}/connection_uri?${uriParams.toString()}`
    );
    if (!uriRes.uri) {
      throw new Error("Neon connection_uri response missing uri");
    }

    const sql = new SQL({
      url: uriRes.uri,
      max: 5,
      idleTimeout: 30,
    });

    cachedInfo = {
      backend: "neon",
      projectId: project.id,
      projectName: project.name,
      region: project.region_id || NEON_REGION,
      branchId: defaultBranchId || undefined,
    };
    return { sql, info: cachedInfo };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[studio-db] Neon unavailable (${msg}); falling back to local SQLite.`);
    cachedInfo = { backend: "sqlite", reason: msg };
    return null;
  }
}

export async function getNeonSql(): Promise<SQL | null> {
  if (!cachedPromise) {
    cachedPromise = initNeonConnection();
  }
  const resolved = await cachedPromise;
  return resolved ? resolved.sql : null;
}

export function resetNeonConnectionCache(): void {
  cachedPromise = null;
}
