/**
 * Shared zero-key Buffer GraphQL Sprites Connector helper (`agent/lib/buffer.ts`).
 *
 * Powers channel-scoped draft creation (`tiktok_draft_post`, `instagram_draft_post`,
 * `x_draft_post`) and channel auto-resolution without exposing vendor internals to Otto.
 */

export type SocialService = "twitter" | "tiktok" | "instagram";

export interface BufferChannel {
  organizationId: string;
  organizationName: string;
  id: string;
  name: string;
  displayName: string;
  service: string;
  isDisconnected?: boolean;
}

let cachedBaseUrl: string | null = null;
let cachedChannels: { fetchedAt: number; items: BufferChannel[] } | null = null;

export async function getBufferGatewayUrl(): Promise<string> {
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

export async function bufferGraphQL<T = unknown>(
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

export async function listBufferChannels(forceRefresh = false): Promise<BufferChannel[]> {
  if (!forceRefresh && cachedChannels && Date.now() - cachedChannels.fetchedAt < 5 * 60_000) {
    return cachedChannels.items;
  }

  const acct = await bufferGraphQL<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(`query { account { organizations { id name } } }`);

  const orgs = acct.account?.organizations ?? [];
  const allChannels: BufferChannel[] = [];

  for (const org of orgs) {
    const ch = await bufferGraphQL<{
      channels: Array<{
        id: string;
        name: string;
        displayName: string;
        service: string;
        isDisconnected?: boolean;
      }>;
    }>(
      `query ($orgId: OrganizationId!) {
        channels(input: { organizationId: $orgId }) {
          id
          name
          displayName
          service
          isDisconnected
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

  cachedChannels = { fetchedAt: Date.now(), items: allChannels };
  return allChannels;
}

export async function resolveChannelByService(
  service: SocialService,
  channelIdOverride?: string
): Promise<BufferChannel> {
  const channels = await listBufferChannels();
  if (channelIdOverride) {
    const exact = channels.find((c) => c.id === channelIdOverride);
    if (exact) return exact;
  }
  const match = channels.find(
    (c) => c.service.toLowerCase() === service && !c.isDisconnected
  );
  if (!match) {
    const available = channels.map((c) => `${c.service} (${c.displayName})`).join(", ") || "none";
    throw new Error(
      `No active '${service}' channel connected in Buffer. Connected channels: ${available}.`
    );
  }
  return match;
}

export async function createBufferDraftOrPost(params: {
  service: SocialService;
  text: string;
  channelId?: string;
  saveToDraft?: boolean;
  mode?: "addToQueue" | "shareNext" | "shareNow";
  dueAt?: string;
}): Promise<{
  channel: { id: string; service: string; displayName: string };
  result: unknown;
}> {
  const channel = await resolveChannelByService(params.service, params.channelId);
  const saveToDraft = params.saveToDraft ?? true;
  const input: Record<string, unknown> = {
    channelId: channel.id,
    text: params.text,
    schedulingType: "automatic",
    mode: params.mode ?? "addToQueue",
    saveToDraft,
  };
  if (params.dueAt) {
    input.dueAt = params.dueAt;
  }

  const result = await bufferGraphQL(
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
    channel: { id: channel.id, service: channel.service, displayName: channel.displayName },
    result,
  };
}
