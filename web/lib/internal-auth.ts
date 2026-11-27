import { LMA_INTERNAL_SECRET } from "./config.ts";
import { timingSafeStrEqual } from "./secure-compare.ts";

export function requireInternalSecret(req: Request): Response | null {
  const auth = req.headers.get("authorization") || "";
  const token =
    req.headers.get("x-lma-internal-secret") ||
    (auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
  if (!token || !timingSafeStrEqual(token, LMA_INTERNAL_SECRET)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
