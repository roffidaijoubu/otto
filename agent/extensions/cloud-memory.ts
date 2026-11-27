import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  forgetCloudMemory,
  recallCloudMemories,
  rememberCloudMemory,
} from "../lib/cloud-memory.ts";
import { listStudioMemories, type StudioMemoryCategory } from "../lib/studio-db.ts";

const CATEGORY_ENUM = Type.Union([
  Type.Literal("preference"),
  Type.Literal("decision"),
  Type.Literal("workflow"),
  Type.Literal("team"),
  Type.Literal("content"),
  Type.Literal("opsec"),
  Type.Literal("general"),
]);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "memory_remember",
    label: "Save Permanent Creator Memory",
    description:
      "Permanently store an important creator preference, workflow decision, content lesson, team note, or boundary in durable cloud memory so it survives restarts and deployments.",
    parameters: Type.Object({
      content: Type.String({
        description: "Clear, self-contained fact, preference, or decision to remember long-term",
      }),
      category: Type.Optional(CATEGORY_ENUM),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Optional short keyword tags (e.g. ['schedule', 'wib'])" })
      ),
      id: Type.Optional(
        Type.String({ description: "Optional existing memory ID to update in place" })
      ),
    }),
    async execute(_id, params) {
      const res = await rememberCloudMemory({
        id: params.id,
        category: (params.category as StudioMemoryCategory | undefined) ?? "general",
        content: params.content,
        tags: params.tags,
        source: "otto",
      });
      return {
        content: [
          {
            type: "text",
            text: `Saved to permanent memory (${res.memory.id}, category: ${res.memory.category}).`,
          },
        ],
        details: res,
      };
    },
  });

  pi.registerTool({
    name: "memory_recall",
    label: "Recall Permanent Creator Memories",
    description:
      "Semantically search durable long-term creator memories (preferences, past decisions, workflow rules, team details, content lessons) in Indonesian or English.",
    parameters: Type.Object({
      query: Type.String({
        description: "Topic, question, or context to recall from past conversations and studio decisions",
      }),
      topK: Type.Optional(
        Type.Number({ description: "Number of top memories to return (default: 6, max: 15)" })
      ),
      category: Type.Optional(CATEGORY_ENUM),
    }),
    async execute(_id, params) {
      const items = await recallCloudMemories({
        query: params.query,
        topK: params.topK ?? 6,
        category: params.category as StudioMemoryCategory | undefined,
      });
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "No matching long-term memories found." }],
          details: { count: 0, items: [] },
        };
      }
      const lines = items.map(
        (m, i) =>
          `${i + 1}. [${m.category}] (${m.id}, match ${Math.round(m.score * 100)}%): ${m.content}` +
          (m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "")
      );
      return {
        content: [{ type: "text", text: `Recalled ${items.length} memory item(s):\n\n${lines.join("\n")}` }],
        details: { count: items.length, items },
      };
    },
  });

  pi.registerTool({
    name: "memory_list",
    label: "List Permanent Creator Memories",
    description: "List recent durable long-term memories stored for this creator.",
    parameters: Type.Object({
      category: Type.Optional(CATEGORY_ENUM),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default: 20)" })),
    }),
    async execute(_id, params) {
      const items = await listStudioMemories({
        category: params.category as StudioMemoryCategory | undefined,
        limit: params.limit ?? 20,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ count: items.length, items }, null, 2) }],
        details: { count: items.length },
      };
    },
  });

  pi.registerTool({
    name: "memory_forget",
    label: "Delete Permanent Creator Memory",
    description: "Remove an outdated or incorrect memory from durable cloud storage by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Memory ID to delete (e.g. mem_a1b2c3d4e5)" }),
    }),
    async execute(_id, params) {
      const res = await forgetCloudMemory(params.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: res.deleted, id: params.id, ...res }) }],
        details: res,
      };
    },
  });
}
