/**
 * Zero-local-key Box Sprites Connector client (`provider: "box"`).
 * Uses verified Sprites Gateway endpoints:
 * - GET  /2.0/folders/<id>/items
 * - POST /2.0/folders
 * - GET  /2.0/search?query=...
 * - GET  /2.0/files/<id>/content
 * - POST /upload/files/content (attributes before file, <= 50 MiB)
 * - POST /upload/files/<id>/content (version replace on conflict)
 */

import fs from "node:fs";
import path from "node:path";

export const BOX_MAX_UPLOAD_BYTES = 48 * 1024 * 1024; // Leave headroom under 50 MiB gateway limit
export const BOX_HANDOFF_ROOT_NAME = "Otto Handoffs";

let cachedBoxBaseUrl: string | null = null;

export interface BoxEntry {
  id: string;
  type: "file" | "folder";
  name: string;
  size?: number;
  modifiedAt?: string;
  url: string;
}

export interface BoxUploadResult {
  kind: "file" | "folder";
  id: string;
  name: string;
  url: string;
  folderUrl: string;
  uploadedCount: number;
  skipped: Array<{ name: string; reason: string }>;
}

export async function resolveBoxGatewayUrl(forceRefresh = false): Promise<string | null> {
  if (cachedBoxBaseUrl && !forceRefresh) return cachedBoxBaseUrl;
  const fromEnv = process.env.SPRITES_BOX_GATEWAY_URL?.trim();
  if (fromEnv) {
    cachedBoxBaseUrl = fromEnv.replace(/\/$/, "");
    return cachedBoxBaseUrl;
  }
  try {
    const res = await fetch("https://api.sprites.dev/v1/gateway/list", {
      signal: AbortSignal.timeout(8_000),
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
        c.provider === "box" ||
        (c.provider === "custom_api" && /\bbox\b/i.test(c.display_name ?? ""))
    );
    if (!conn) return null;
    cachedBoxBaseUrl = conn.gateway_base_url.replace(/\/$/, "");
    return cachedBoxBaseUrl;
  } catch {
    return null;
  }
}

async function requireBoxBaseUrl(): Promise<string> {
  const base = await resolveBoxGatewayUrl();
  if (!base) {
    throw new Error(
      "Box Sprites Connector is not connected. Add Box in sprites.dev -> Connectors and grant access to this Sprite."
    );
  }
  return base;
}

export function boxItemUrl(type: "file" | "folder", id: string): string {
  return type === "folder"
    ? `https://app.box.com/folder/${encodeURIComponent(id)}`
    : `https://app.box.com/file/${encodeURIComponent(id)}`;
}

export async function listBoxFolder(folderId = "0", limit = 100): Promise<BoxEntry[]> {
  const base = await requireBoxBaseUrl();
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const res = await fetch(
    `${base}/2.0/folders/${encodeURIComponent(folderId)}/items?limit=${safeLimit}&fields=id,type,name,size,modified_at`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Box list folder failed (${res.status}): ${err.slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    entries?: Array<{
      id: string;
      type: string;
      name: string;
      size?: number;
      modified_at?: string;
    }>;
  };
  return (data.entries || [])
    .filter((e) => e.type === "file" || e.type === "folder")
    .map((e) => {
      const t = e.type as "file" | "folder";
      return {
        id: e.id,
        type: t,
        name: e.name,
        size: typeof e.size === "number" ? e.size : undefined,
        modifiedAt: e.modified_at,
        url: boxItemUrl(t, e.id),
      };
    });
}

export async function ensureBoxFolder(parentId: string, name: string): Promise<{ id: string; name: string; url: string }> {
  const base = await requireBoxBaseUrl();
  const cleanName = name.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 120) || "Untitled";
  const res = await fetch(`${base}/2.0/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: cleanName,
      parent: { id: parentId },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.ok) {
    const created = (await res.json()) as { id: string; name: string };
    return { id: created.id, name: created.name, url: boxItemUrl("folder", created.id) };
  }

  if (res.status === 409) {
    const conflictBody = (await res.json().catch(() => ({}))) as {
      context_info?: { conflicts?: Array<{ id?: string; name?: string }> | { id?: string; name?: string } };
    };
    const rawConflicts = conflictBody.context_info?.conflicts;
    const first = Array.isArray(rawConflicts) ? rawConflicts[0] : rawConflicts;
    if (first?.id) {
      return {
        id: first.id,
        name: first.name || cleanName,
        url: boxItemUrl("folder", first.id),
      };
    }
    const existing = (await listBoxFolder(parentId, 200)).find(
      (e) => e.type === "folder" && e.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      return { id: existing.id, name: existing.name, url: existing.url };
    }
  }

  const errText = await res.text().catch(() => "");
  throw new Error(`Box create folder "${cleanName}" failed (${res.status}): ${errText.slice(0, 180)}`);
}

export async function ensureBoxPath(segments: string[], rootId = "0"): Promise<{ id: string; name: string; url: string }> {
  let currentId = rootId;
  let currentName = "All Files";
  for (const seg of segments) {
    const cleaned = seg.trim();
    if (!cleaned) continue;
    const next = await ensureBoxFolder(currentId, cleaned);
    currentId = next.id;
    currentName = next.name;
  }
  return { id: currentId, name: currentName, url: boxItemUrl("folder", currentId) };
}

export async function uploadLocalFileToBox(
  absFilePath: string,
  parentFolderId: string,
  customName?: string
): Promise<{ id: string; name: string; size: number; url: string }> {
  const base = await requireBoxBaseUrl();
  const stat = fs.statSync(absFilePath);
  if (!stat.isFile()) {
    throw new Error("Path is not a file.");
  }
  if (stat.size > BOX_MAX_UPLOAD_BYTES) {
    throw new Error(
      `File "${path.basename(absFilePath)}" is ${(stat.size / (1024 * 1024)).toFixed(1)} MB (Box gateway limit is 50 MiB).`
    );
  }

  const fileName = (customName || path.basename(absFilePath)).trim();
  const fileBytes = fs.readFileSync(absFilePath);

  // Attributes MUST precede file in multipart body (per Box Sprites Connector spec)
  const form = new FormData();
  form.append(
    "attributes",
    JSON.stringify({ name: fileName, parent: { id: parentFolderId } })
  );
  form.append("file", new Blob([fileBytes]), fileName);

  const res = await fetch(`${base}/upload/files/content`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (res.ok) {
    const data = (await res.json()) as {
      entries?: Array<{ id: string; name: string; size?: number }>;
    };
    const entry = data.entries?.[0];
    if (!entry?.id) throw new Error("Box upload returned no file entry.");
    return {
      id: entry.id,
      name: entry.name || fileName,
      size: entry.size ?? stat.size,
      url: boxItemUrl("file", entry.id),
    };
  }

  // Handle name conflict (409) by uploading a new version to /upload/files/<existing_id>/content
  if (res.status === 409) {
    const conflictBody = (await res.json().catch(() => ({}))) as {
      context_info?: { conflicts?: { id?: string } | Array<{ id?: string }> };
    };
    const rawConf = conflictBody.context_info?.conflicts;
    const conflictId = Array.isArray(rawConf) ? rawConf[0]?.id : rawConf?.id;
    if (conflictId) {
      const replaceForm = new FormData();
      replaceForm.append("attributes", JSON.stringify({ name: fileName }));
      replaceForm.append("file", new Blob([fileBytes]), fileName);
      const repRes = await fetch(`${base}/upload/files/${encodeURIComponent(conflictId)}/content`, {
        method: "POST",
        body: replaceForm,
        signal: AbortSignal.timeout(120_000),
      });
      if (repRes.ok) {
        const repData = (await repRes.json()) as {
          entries?: Array<{ id: string; name: string; size?: number }>;
        };
        const entry = repData.entries?.[0];
        const id = entry?.id || conflictId;
        return {
          id,
          name: entry?.name || fileName,
          size: entry?.size ?? stat.size,
          url: boxItemUrl("file", id),
        };
      }
      const repErr = await repRes.text().catch(() => "");
      throw new Error(`Box version update failed (${repRes.status}): ${repErr.slice(0, 180)}`);
    }
  }

  const errText = await res.text().catch(() => "");
  throw new Error(`Box upload failed (${res.status}): ${errText.slice(0, 180)}`);
}

export async function exportWorkspaceEntryToBox(
  absEntryPath: string,
  relWorkspacePath: string
): Promise<BoxUploadResult> {
  const stat = fs.statSync(absEntryPath);
  const relClean = relWorkspacePath.replace(/^\/+|\/+$/g, "");
  const parts = relClean ? relClean.split("/").filter(Boolean) : [];

  if (stat.isFile()) {
    const parentSegments = [BOX_HANDOFF_ROOT_NAME, ...parts.slice(0, -1)];
    const targetFolder = await ensureBoxPath(parentSegments);
    const uploaded = await uploadLocalFileToBox(absEntryPath, targetFolder.id);
    return {
      kind: "file",
      id: uploaded.id,
      name: uploaded.name,
      url: uploaded.url,
      folderUrl: targetFolder.url,
      uploadedCount: 1,
      skipped: [],
    };
  }

  if (stat.isDirectory()) {
    const folderSegments = [BOX_HANDOFF_ROOT_NAME, ...parts];
    const targetFolder = await ensureBoxPath(folderSegments);
    const skipped: Array<{ name: string; reason: string }> = [];
    let uploadedCount = 0;
    const MAX_FILES = 30;

    async function walk(localDir: string, boxFolderId: string): Promise<void> {
      const entries = fs.readdirSync(localDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isSymbolicLink()) {
          skipped.push({ name: entry.name, reason: "symlink skipped" });
          continue;
        }
        const childAbs = path.join(localDir, entry.name);
        if (entry.isDirectory()) {
          const sub = await ensureBoxFolder(boxFolderId, entry.name);
          await walk(childAbs, sub.id);
        } else if (entry.isFile()) {
          if (uploadedCount >= MAX_FILES) {
            skipped.push({ name: entry.name, reason: `max ${MAX_FILES} files per export` });
            continue;
          }
          const fStat = fs.statSync(childAbs);
          if (fStat.size > BOX_MAX_UPLOAD_BYTES) {
            skipped.push({
              name: entry.name,
              reason: `exceeds 48 MB limit (${(fStat.size / (1024 * 1024)).toFixed(1)} MB)`,
            });
            continue;
          }
          await uploadLocalFileToBox(childAbs, boxFolderId, entry.name);
          uploadedCount += 1;
        }
      }
    }

    await walk(absEntryPath, targetFolder.id);
    return {
      kind: "folder",
      id: targetFolder.id,
      name: targetFolder.name,
      url: targetFolder.url,
      folderUrl: targetFolder.url,
      uploadedCount,
      skipped,
    };
  }

  throw new Error("Unsupported workspace entry type.");
}

export async function downloadBoxFileToLocal(
  fileId: string,
  destAbsPath: string
): Promise<{ size: number; destAbsPath: string }> {
  const base = await requireBoxBaseUrl();
  const res = await fetch(`${base}/2.0/files/${encodeURIComponent(fileId)}/content`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Box download failed (${res.status}): ${err.slice(0, 180)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
  fs.writeFileSync(destAbsPath, buf);
  return { size: buf.length, destAbsPath };
}
