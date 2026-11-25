import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  addChannelMetric,
  deleteContact,
  deleteCustomTrackerItem,
  deletePipelineItem,
  getStudioDbOverview,
  listChannelMetrics,
  listContacts,
  listCustomTrackerItems,
  listCustomTrackers,
  listPipelineItems,
  runReadOnlySql,
  upsertContact,
  upsertCustomTracker,
  upsertCustomTrackerItem,
  upsertPipelineItem,
  type ContactRole,
  type ContactStatus,
  type PipelineFormat,
  type PipelinePillar,
  type PipelineStatus,
} from "../lib/studio-db.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "studio_db_overview",
    label: "Studio Database Overview",
    description:
      "Inspect the unified Studio SQLite database (~/.omp/agent/studio.db) shared with Mission Control Web UI: returns row counts for calendar_events, content_pipeline (including 3+1 core vs experiment ratio), contacts, channel_metrics, and all custom trackers.",
    parameters: Type.Object({}),
    async execute() {
      const overview = getStudioDbOverview();
      return {
        content: [{ type: "text", text: JSON.stringify(overview, null, 2) }],
        details: overview,
      };
    },
  });

  pi.registerTool({
    name: "studio_db_query",
    label: "Query Studio Database (Read-Only)",
    description:
      "Run a read-only SELECT, WITH, or PRAGMA table_info SQL query against the unified Studio SQLite database (~/.omp/agent/studio.db). Useful for cross-table analysis across calendar_events, content_pipeline, contacts, channel_metrics, custom_trackers, and custom_items.",
    parameters: Type.Object({
      sql: Type.String({ description: "Read-only SQL SELECT/WITH query" }),
      params: Type.Optional(
        Type.Array(Type.Union([Type.String(), Type.Number(), Type.Null()]), {
          description: "Optional positional query parameters",
        })
      ),
    }),
    async execute(_id, params) {
      const res = runReadOnlySql(params.sql, params.params || []);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        details: { rowCount: res.rows.length, truncated: res.truncated },
      };
    },
  });

  // ---- Content Pipeline (3+1 Tracker) ----

  pi.registerTool({
    name: "studio_pipeline_list",
    label: "List Content Pipeline (3+1)",
    description:
      "List ideas, streams, videos, and shorts in the shared 3+1 Content Pipeline table (synced live with Mission Control Studio DB).",
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Optional status filter: idea|prepping|scheduled|live|editing|published|dropped" })),
      pillar: Type.Optional(Type.String({ description: "Optional 3+1 pillar filter: core|experiment" })),
      format: Type.Optional(Type.String({ description: "Optional format filter: stream|video|short|collab" })),
    }),
    async execute(_id, params) {
      const items = listPipelineItems(params);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: items.length, items }, null, 2) }],
        details: { count: items.length },
      };
    },
  });

  pi.registerTool({
    name: "studio_pipeline_upsert",
    label: "Save Content Pipeline Item",
    description:
      "Create or update an item in the shared 3+1 Content Pipeline table (visible live in Mission Control Studio DB). Link workspace files via thumbnailPath (e.g. 'thumbnails/draft.png') or scriptPath (e.g. 'scripts/ep12.md').",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Existing item ID to update; omit to create new." })),
      title: Type.Optional(Type.String({ description: "Working title or concept name." })),
      format: Type.Optional(
        Type.Union([
          Type.Literal("stream"),
          Type.Literal("video"),
          Type.Literal("short"),
          Type.Literal("collab"),
        ])
      ),
      pillar: Type.Optional(Type.Union([Type.Literal("core"), Type.Literal("experiment")])),
      status: Type.Optional(
        Type.Union([
          Type.Literal("idea"),
          Type.Literal("prepping"),
          Type.Literal("scheduled"),
          Type.Literal("live"),
          Type.Literal("editing"),
          Type.Literal("published"),
          Type.Literal("dropped"),
        ])
      ),
      hook: Type.Optional(Type.String({ description: "4 Ps Premise/Problem hook or packaging angle." })),
      thumbnailPath: Type.Optional(Type.String({ description: "Workspace-relative path to human artist thumbnail draft." })),
      scriptPath: Type.Optional(Type.String({ description: "Workspace-relative path to script or run-of-show .md." })),
      scheduledFor: Type.Optional(Type.String({ description: "Optional target date or ISO timestamp." })),
      notes: Type.Optional(Type.String({ description: "Packaging notes, Squint Test feedback, or segment breakdown." })),
    }),
    async execute(_id, params) {
      const item = upsertPipelineItem({
        id: params.id,
        title: params.title,
        format: params.format as PipelineFormat | undefined,
        pillar: params.pillar as PipelinePillar | undefined,
        status: params.status as PipelineStatus | undefined,
        hook: params.hook,
        thumbnailPath: params.thumbnailPath,
        scriptPath: params.scriptPath,
        scheduledFor: params.scheduledFor,
        notes: params.notes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, item }, null, 2) }],
        details: { id: item.id },
      };
    },
  });

  pi.registerTool({
    name: "studio_pipeline_delete",
    label: "Delete Content Pipeline Item",
    description: "Remove an item from the shared Content Pipeline table by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Pipeline item ID to delete." }),
    }),
    async execute(_id, params) {
      const deleted = deletePipelineItem(params.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: deleted, id: params.id }) }],
        details: { deleted },
      };
    },
  });

  // ---- Contacts (Human Artists / Clippers / Collabs / Sponsors) ----

  pi.registerTool({
    name: "studio_contact_list",
    label: "List Studio Contacts",
    description:
      "List human artists, riggers, clippers, editors, collab creators, moderators, and sponsors stored in the shared Studio DB.",
    parameters: Type.Object({
      role: Type.Optional(Type.String({ description: "Optional role filter: artist|clipper|editor|rigger|collab|sponsor|mod" })),
      status: Type.Optional(Type.String({ description: "Optional status filter: prospect|pitched|active|paused" })),
    }),
    async execute(_id, params) {
      const contacts = listContacts(params);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: contacts.length, contacts }, null, 2) }],
        details: { count: contacts.length },
      };
    },
  });

  pi.registerTool({
    name: "studio_contact_upsert",
    label: "Save Studio Contact",
    description:
      "Add or update a human artist, clipper, editor, rigger, collab partner, sponsor, or moderator in the shared Studio DB.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Existing contact ID to update; omit to create new." })),
      name: Type.Optional(Type.String({ description: "Contact display name." })),
      role: Type.Optional(
        Type.Union([
          Type.Literal("artist"),
          Type.Literal("clipper"),
          Type.Literal("editor"),
          Type.Literal("rigger"),
          Type.Literal("collab"),
          Type.Literal("sponsor"),
          Type.Literal("mod"),
        ])
      ),
      handle: Type.Optional(Type.String({ description: "Social handle, email, or portfolio handle." })),
      platform: Type.Optional(Type.String({ description: "Primary platform (YouTube, X, Discord, VGen, etc.)." })),
      status: Type.Optional(
        Type.Union([
          Type.Literal("prospect"),
          Type.Literal("pitched"),
          Type.Literal("active"),
          Type.Literal("paused"),
        ])
      ),
      notes: Type.Optional(Type.String({ description: "Rates, art style, timezone, collab vibe, or pitch notes." })),
    }),
    async execute(_id, params) {
      const contact = upsertContact({
        id: params.id,
        name: params.name,
        role: params.role as ContactRole | undefined,
        handle: params.handle,
        platform: params.platform,
        status: params.status as ContactStatus | undefined,
        notes: params.notes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, contact }, null, 2) }],
        details: { id: contact.id },
      };
    },
  });

  pi.registerTool({
    name: "studio_contact_delete",
    label: "Delete Studio Contact",
    description: "Remove a contact from the shared Studio DB by ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Contact ID to delete." }),
    }),
    async execute(_id, params) {
      const deleted = deleteContact(params.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: deleted, id: params.id }) }],
        details: { deleted },
      };
    },
  });

  // ---- Channel Metrics History ----

  pi.registerTool({
    name: "studio_metrics_log",
    label: "Log Channel Metrics Snapshot",
    description:
      "Record a historical channel metrics snapshot (subscribers, views, avg CCV, avg CTR, notes) in the shared Studio DB so trends can be tracked over time.",
    parameters: Type.Object({
      recordedAt: Type.Optional(Type.String({ description: "Date string YYYY-MM-DD (defaults to today)." })),
      platform: Type.Optional(Type.String({ description: "Platform (default: 'youtube')." })),
      subscribers: Type.Optional(Type.Number({ description: "Subscriber / follower count." })),
      totalViews: Type.Optional(Type.Number({ description: "Cumulative channel views." })),
      avgCcv: Type.Optional(Type.Number({ description: "Average concurrent viewers." })),
      avgCtr: Type.Optional(Type.Number({ description: "Average thumbnail CTR percentage (e.g. 6.4)." })),
      notes: Type.Optional(Type.String({ description: "Context for this snapshot (e.g. post-collab spike, packaging experiment)." })),
    }),
    async execute(_id, params) {
      const metric = addChannelMetric(params);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, metric }, null, 2) }],
        details: { id: metric.id },
      };
    },
  });

  pi.registerTool({
    name: "studio_metrics_list",
    label: "List Channel Metrics History",
    description: "Read recent historical channel metrics snapshots from the shared Studio DB.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max snapshots to return (default 25)." })),
    }),
    async execute(_id, params) {
      const metrics = listChannelMetrics(params.limit ?? 25);
      return {
        content: [{ type: "text", text: JSON.stringify({ count: metrics.length, metrics }, null, 2) }],
        details: { count: metrics.length },
      };
    },
  });

  // ---- Custom Trackers (Flexible Collections) ----

  pi.registerTool({
    name: "studio_tracker_create",
    label: "Create Custom Studio Tracker",
    description:
      "Create or update a custom tracker collection in the shared Studio DB (e.g. 'game-backlog', 'ramadhan-series', 'merch-ideas'). It appears automatically in the Mission Control Studio DB tab.",
    parameters: Type.Object({
      name: Type.String({ description: "Display name of the tracker (e.g. 'Game Backlog')." }),
      slug: Type.Optional(Type.String({ description: "Optional lowercase URL slug (auto-generated from name if omitted)." })),
      description: Type.Optional(Type.String({ description: "Short description of what this tracker is for." })),
      columns: Type.Optional(
        Type.Array(Type.String(), {
          description: "Extra custom column names besides title & status (e.g. ['genre', 'hours', 'notes']).",
        })
      ),
    }),
    async execute(_id, params) {
      const tracker = upsertCustomTracker(params);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, tracker }, null, 2) }],
        details: { slug: tracker.slug },
      };
    },
  });

  pi.registerTool({
    name: "studio_tracker_list",
    label: "List Custom Trackers & Items",
    description:
      "List all custom trackers, or pass trackerSlug to list all rows inside a specific custom tracker.",
    parameters: Type.Object({
      trackerSlug: Type.Optional(Type.String({ description: "Optional tracker slug to fetch its rows." })),
    }),
    async execute(_id, params) {
      if (params.trackerSlug) {
        const items = listCustomTrackerItems(params.trackerSlug);
        return {
          content: [{ type: "text", text: JSON.stringify({ trackerSlug: params.trackerSlug, count: items.length, items }, null, 2) }],
          details: { count: items.length },
        };
      }
      const trackers = listCustomTrackers();
      return {
        content: [{ type: "text", text: JSON.stringify({ count: trackers.length, trackers }, null, 2) }],
        details: { count: trackers.length },
      };
    },
  });

  pi.registerTool({
    name: "studio_tracker_upsert_item",
    label: "Save Custom Tracker Row",
    description: "Add or update a row inside a custom Studio DB tracker.",
    parameters: Type.Object({
      trackerSlug: Type.String({ description: "Slug of the custom tracker." }),
      id: Type.Optional(Type.String({ description: "Existing item ID to update; omit to create new." })),
      title: Type.Optional(Type.String({ description: "Row title." })),
      status: Type.Optional(Type.String({ description: "Row status (e.g. 'open', 'playing', 'done')." })),
      data: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Key-value map for the tracker's custom columns.",
        })
      ),
    }),
    async execute(_id, params) {
      const item = upsertCustomTrackerItem(params);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, item }, null, 2) }],
        details: { id: item.id },
      };
    },
  });

  pi.registerTool({
    name: "studio_tracker_delete_item",
    label: "Delete Custom Tracker Row",
    description: "Delete a row from a custom Studio DB tracker.",
    parameters: Type.Object({
      trackerSlug: Type.String({ description: "Slug of the custom tracker." }),
      id: Type.String({ description: "Row ID to delete." }),
    }),
    async execute(_id, params) {
      const deleted = deleteCustomTrackerItem(params.trackerSlug, params.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: deleted, id: params.id }) }],
        details: { deleted },
      };
    },
  });
}
