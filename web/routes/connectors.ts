import { fetchGatewayList } from "../lib/gateway.ts";
import { errorMessage } from "../lib/http.ts";
import { computeGuardrailStatus } from "../lib/qstash.ts";

export async function handleConnectorsRoutes(
  req: Request,
  url: URL
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/connectors") {
    const guardrails = computeGuardrailStatus();
    try {
      const gwResult = await fetchGatewayList(8000);
      if (!gwResult.ok) {
        return Response.json({
          connectors: [],
          ...guardrails,
          warning: `Gateway HTTP ${gwResult.status}`,
        });
      }
      const connectors = gwResult.connections.map((c) => ({
        provider: c.provider || "custom_api",
        displayName: c.display_name || c.provider || "Connector",
        connectionType: c.connection_type || "api_key",
        description: c.description || "",
        updatedAt: c.updated_at || null,
        status: "connected",
      }));
      return Response.json({
        connectors,
        ...guardrails,
      });
    } catch (err: unknown) {
      return Response.json({
        connectors: [],
        ...guardrails,
        warning: errorMessage(err),
      });
    }
  }

  return null;
}
