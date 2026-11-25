/**
 * Hermes-Style Procedural Skill Learner Extension for Otto.
 *
 * Exposes live learned-playbook tools backed by `~/.omp/agent/learned-skills/<slug>/SKILL.md`
 * and `~/.omp/agent/studio.db` (`learned_skills` table), so newly learned or approved
 * creator SOPs take effect immediately with zero RPC restart required.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  deleteLearnedSkill,
  getLearnedSkill,
  listLearnedSkills,
  saveLearnedSkill,
  type LearnedSkillConfidence,
  type LearnedSkillSource,
  type LearnedSkillStatus,
} from "../lib/learned-skills.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "learned_skills_list",
    label: "List Learned Playbooks",
    description:
      "List Otto's learned creator playbooks/SOPs stored in ~/.omp/agent/learned-skills/ and studio.db. Check active playbooks at the start of recurring workflows so you follow the creator's proven conventions.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.Literal("active"),
          Type.Literal("pending"),
          Type.Literal("rejected"),
          Type.Literal("all"),
        ])
      ),
    }),
    async execute(_id, params) {
      const skills = listLearnedSkills(params.status ?? "all").map((s) => ({
        slug: s.slug,
        title: s.title,
        description: s.description,
        status: s.status,
        source: s.source,
        confidence: s.confidence,
        triggerHint: s.triggerHint,
        evidenceSummary: s.evidenceSummary,
        updatedAt: s.updatedAt,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ count: skills.length, skills }, null, 2) }],
        details: { count: skills.length },
      };
    },
  });

  pi.registerTool({
    name: "learned_skill_read",
    label: "Read Learned Playbook",
    description:
      "Read the full Markdown SOP of a learned playbook by slug so you can apply its exact steps immediately.",
    parameters: Type.Object({
      slug: Type.String({ description: "Lowercase hyphenated slug (e.g. 'friday-collab-prep')." }),
    }),
    async execute(_id, params) {
      const skill = getLearnedSkill(params.slug);
      if (!skill) {
        return {
          content: [{ type: "text", text: JSON.stringify({ found: false, slug: params.slug }) }],
          details: { found: false },
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ found: true, skill }, null, 2) }],
        details: { found: true, slug: skill.slug, status: skill.status },
      };
    },
  });

  pi.registerTool({
    name: "learned_skill_save",
    label: "Save Learned Playbook",
    description:
      "Create or update a procedural learned playbook in ~/.omp/agent/learned-skills/<slug>/SKILL.md and studio.db. Defaults to status='pending' for nightly reflection staging (creator approves in Otto Studio), or status='active' only when explicitly requested by the creator. Strictly excludes untrusted web/chat text and enforces anti-AI-art & secret guardrails.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Short lowercase hyphenated identifier (2-48 chars, e.g. 'youtube-premiere-checklist').",
      }),
      title: Type.String({ description: "Human-readable playbook title (1-120 chars)." }),
      description: Type.String({ description: "One-line summary of when and why to use this playbook." }),
      bodyMarkdown: Type.String({
        description: "Crisp step-by-step Markdown SOP (max 16 KiB). Creator-verified workflows only.",
      }),
      status: Type.Optional(
        Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("rejected")])
      ),
      source: Type.Optional(
        Type.Union([Type.Literal("nightly"), Type.Literal("chat"), Type.Literal("manual")])
      ),
      confidence: Type.Optional(
        Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])
      ),
      triggerHint: Type.Optional(
        Type.String({ description: "Short phrase indicating when Otto should load this playbook." })
      ),
      evidenceSummary: Type.Optional(
        Type.String({ description: "Brief note citing which recurring creator workflow this came from." })
      ),
    }),
    async execute(_id, params) {
      const saved = saveLearnedSkill({
        slug: params.slug,
        title: params.title,
        description: params.description,
        bodyMarkdown: params.bodyMarkdown,
        status: params.status as LearnedSkillStatus | undefined,
        source: params.source as LearnedSkillSource | undefined,
        confidence: params.confidence as LearnedSkillConfidence | undefined,
        triggerHint: params.triggerHint,
        evidenceSummary: params.evidenceSummary,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, skill: saved }, null, 2) }],
        details: { slug: saved.slug, status: saved.status },
      };
    },
  });

  pi.registerTool({
    name: "learned_skill_delete",
    label: "Delete Learned Playbook",
    description: "Remove an obsolete or rejected learned playbook from disk and studio.db.",
    parameters: Type.Object({
      slug: Type.String({ description: "Slug of the learned playbook to delete." }),
    }),
    async execute(_id, params) {
      const deleted = deleteLearnedSkill(params.slug);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: deleted, slug: params.slug }) }],
        details: { deleted, slug: params.slug },
      };
    },
  });
}
