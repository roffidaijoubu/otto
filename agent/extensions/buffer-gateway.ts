import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

let cachedBaseUrl: string | null = null;

async function getBufferGatewayUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  if (process.env.SPRITES_BUFFER_GATEWAY_URL) {
    cachedBaseUrl = process.env.SPRITES_BUFFER_GATEWAY_URL.replace(/\/$/, "");
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
      c.provider === "buffer" ||
      (c.provider === "custom_api" && /buffer/i.test(c.display_name ?? ""))
  );
  if (!conn) {
    throw new Error(
      "No authorized Buffer Sprites Connector found. Add a Custom API connector named 'Buffer' pointing to https://api.buffer.com with Bearer auth (see docs/setup/buffer.md)."
    );
  }
  cachedBaseUrl = conn.gateway_base_url.replace(/\/$/, "");
  return cachedBaseUrl;
}

async function bufferGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const baseUrl = await getBufferGatewayUrl();
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Buffer gateway error (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Buffer GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data as T;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "buffer_list_channels",
    label: "Buffer List Channels",
    description:
      "List all connected social media channels (X/Twitter, TikTok, Instagram, etc.) in Buffer via the Sprites Connector Gateway (zero local API keys).",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const acct = await bufferGraphQL<{
        account: { organizations: Array<{ id: string; name: string }> };
      }>(`query { account { organizations { id name } } }`);

      const orgs = acct.account?.organizations ?? [];
      const allChannels: Array<{
        organizationId: string;
        organizationName: string;
        id: string;
        name: string;
        displayName: string;
        service: string;
      }> = [];

      for (const org of orgs) {
        const ch = await bufferGraphQL<{
          channels: Array<{ id: string; name: string; displayName: string; service: string }>;
        }>(
          `query ($orgId: OrganizationId!) {
            channels(input: { organizationId: $orgId }) {
              id
              name
              displayName
              service
            }
          }`,
          { orgId: org.id }
        );
        for (const c of ch.channels ?? []) {
          allChannels.push({
            organizationId: org.id,
            organizationName: org.name,
            ...c,
          });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(allChannels, null, 2) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "buffer_create_post",
    label: "Buffer Create Post",
    description:
      "Create a draft or scheduled social post in Buffer for X, TikTok, or Instagram via the Sprites Connector Gateway. Defaults to saveToDraft=true for safety. NEVER set saveToDraft=false or mode='shareNow' without explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "Target Buffer channel ID (get from buffer_list_channels).",
        },
        text: {
          type: "string",
          description: "Post caption / tweet text.",
        },
        saveToDraft: {
          type: "boolean",
          description: "Save as a Buffer draft instead of publishing/queuing (default: true).",
        },
        mode: {
          type: "string",
          enum: ["addToQueue", "shareNext", "shareNow"],
          description: "Queue mode when saveToDraft is false (default: addToQueue).",
        },
        dueAt: {
          type: "string",
          description: "Optional ISO-8601 UTC timestamp for scheduled publishing.",
        },
      },
      required: ["channelId", "text"],
    },
    async execute(
      _toolCallId,
      params: {
        channelId: string;
        text: string;
        saveToDraft?: boolean;
        mode?: "addToQueue" | "shareNext" | "shareNow";
        dueAt?: string;
      }
    ) {
      const saveToDraft = params.saveToDraft ?? true;
      const input: Record<string, unknown> = {
        channelId: params.channelId,
        text: params.text,
        schedulingType: "automatic",
        mode: params.mode ?? "addToQueue",
        saveToDraft,
      };
      if (params.dueAt) {
        input.dueAt = params.dueAt;
      }

      const data = await bufferGraphQL(
        `mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess {
              post {
                id
                text
                dueAt
                status
              }
            }
            ... on MutationError {
              message
            }
          }
        }`,
        { input }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: {},
      };
    },
  });
}
