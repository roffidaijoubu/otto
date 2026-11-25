/**
 * Hermes-style Procedural Learned Skills store.
 *
 * Persists agent-authored playbooks in TWO synchronized places:
 *  1. Separate runtime folder `~/.omp/agent/learned-skills/<slug>/SKILL.md`
 *     (isolated from repo-symlinked `~/.omp/agent/skills/*` so `setup.sh` never clobbers them).
 *  2. SQLite index table `learned_skills` inside `~/.omp/agent/studio.db`
 *     (stage-first `pending` | `active` | `rejected` lifecycle + Mission Control UI review).
 *
 * Security & Anti-Bloat Guardrails:
 *  - Strict slug regex + `path.resolve()`/`realpathSync` containment inside `LEARNED_SKILLS_ROOT`.
 *  - Anti-prompt-injection filter rejecting instructions that disable anti-AI-art rules,
 *    exfiltrate secrets/web.env/QStash keys, run piped shell installers, or override system prompts.
 *  - Size cap (16 KiB per skill) and count cap (30 learned skills).
 */

import fs from "node:fs";
import path from "node:path";
import { getStudioDb } from "./studio-db.ts";

export type LearnedSkillStatus = "pending" | "active" | "rejected";
export type LearnedSkillSource = "nightly" | "manual" | "chat";
export type LearnedSkillConfidence = "low" | "medium" | "high";

export interface LearnedSkill {
  slug: string;
  title: string;
  description: string;
  status: LearnedSkillStatus;
  source: LearnedSkillSource;
  confidence: LearnedSkillConfidence;
  triggerHint: string;
  evidenceSummary: string;
  bodyMarkdown: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

const HOME_DIR = process.env.HOME || "/home/sprite";
export const LEARNED_SKILLS_ROOT = path.resolve(
  process.env.LMA_LEARNED_SKILLS_DIR || path.join(HOME_DIR, ".omp", "agent", "learned-skills")
);

export const MAX_LEARNED_SKILL_BYTES = 16 * 1024;
export const MAX_LEARNED_SKILLS = 30;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

// Patterns strictly forbidden inside learned procedural skills (anti-prompt-injection & guardrail preservation)
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /ignore\s+(all\s+)?(previous|prior|system)\s+instructions/i,
    reason: "Prompt-injection directive ('ignore previous instructions') is forbidden in learned skills.",
  },
  {
    re: /(?:web\.env|LMA_WEB_PASSWORD|QSTASH_CURRENT_SIGNING_KEY|QSTASH_NEXT_SIGNING_KEY)/i,
    reason: "Referencing private runtime credentials or web.env is forbidden in learned skills.",
  },
  {
    re: /(?:enable|allow|use|turn\s+on)\s+(?:generate_image|ai[- ]generated\s+(?:art|images|thumbnails|video))/i,
    reason: "Overriding Otto's strict No-AI-Art / No-AI-Video guardrail is forbidden.",
  },
  {
    re: /(?:curl|wget)[^\n|]{0,160}\|\s*(?:sh|bash|zsh)\b/i,
    reason: "Piped remote shell execution (`curl | sh`) is forbidden in learned skills.",
  },
  {
    re: /\b(?:rm\s+-rf\s+\/|chmod\s+777|base64\s+-d\s*\|\s*(?:sh|bash))\b/i,
    reason: "Destructive or obfuscated shell commands are forbidden in learned skills.",
  },
];

export function normalizeSkillSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid skill slug "${raw}". Use 2-48 lowercase letters, digits, and hyphens (e.g. "friday-collab-prep").`
    );
  }
  return slug;
}

export function validateLearnedSkillContent(input: {
  title: string;
  description: string;
  bodyMarkdown: string;
}): void {
  const title = input.title.trim();
  const description = input.description.trim();
  const body = input.bodyMarkdown.trim();

  if (!title || title.length > 120) {
    throw new Error("Learned skill title must be 1-120 characters.");
  }
  if (!description || description.length > 320) {
    throw new Error("Learned skill description must be 1-320 characters.");
  }
  if (!body) {
    throw new Error("Learned skill markdown body cannot be empty.");
  }
  if (Buffer.byteLength(body, "utf8") > MAX_LEARNED_SKILL_BYTES) {
    throw new Error(
      `Learned skill exceeds ${MAX_LEARNED_SKILL_BYTES} bytes cap (keep playbooks crisp and focused).`
    );
  }

  const combined = `${title}\n${description}\n${body}`;
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.re.test(combined)) {
      throw new Error(rule.reason);
    }
  }
}

export function ensureLearnedSkillsRoot(): void {
  fs.mkdirSync(LEARNED_SKILLS_ROOT, { recursive: true });
}

function resolveSkillFilePath(slug: string): string {
  ensureLearnedSkillsRoot();
  const safeSlug = normalizeSkillSlug(slug);
  const rootReal = fs.realpathSync(LEARNED_SKILLS_ROOT);
  const dirPath = path.resolve(rootReal, safeSlug);
  if (!dirPath.startsWith(rootReal + path.sep)) {
    throw new Error("Learned skill path escapes runtime root.");
  }
  return path.join(dirPath, "SKILL.md");
}

function renderSkillMarkdownFile(skill: {
  slug: string;
  title: string;
  description: string;
  status: LearnedSkillStatus;
  source: LearnedSkillSource;
  triggerHint: string;
  updatedAt: string;
  bodyMarkdown: string;
}): string {
  const safeYaml = (v: string) => JSON.stringify(v.replace(/[\r\n]+/g, " ").trim());
  return [
    "---",
    `name: ${skill.slug}`,
    `title: ${safeYaml(skill.title)}`,
    `description: ${safeYaml(skill.description)}`,
    `status: ${skill.status}`,
    `source: ${skill.source}`,
    `trigger_hint: ${safeYaml(skill.triggerHint)}`,
    `updated_at: ${skill.updatedAt}`,
    "---",
    "",
    skill.bodyMarkdown.trim(),
    "",
  ].join("\n");
}

interface LearnedSkillRow {
  slug: string;
  title: string;
  description: string;
  status: string;
  source: string;
  confidence: string;
  trigger_hint: string;
  evidence_summary: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
}

function mapRow(r: LearnedSkillRow): LearnedSkill {
  const status: LearnedSkillStatus =
    r.status === "active" || r.status === "rejected" ? r.status : "pending";
  const source: LearnedSkillSource =
    r.source === "manual" || r.source === "chat" ? r.source : "nightly";
  const confidence: LearnedSkillConfidence =
    r.confidence === "low" || r.confidence === "high" ? r.confidence : "medium";
  return {
    slug: r.slug,
    title: r.title,
    description: r.description,
    status,
    source,
    confidence,
    triggerHint: r.trigger_hint,
    evidenceSummary: r.evidence_summary,
    bodyMarkdown: r.body_markdown,
    filePath: path.join(LEARNED_SKILLS_ROOT, r.slug, "SKILL.md"),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listLearnedSkills(statusFilter?: LearnedSkillStatus | "all"): LearnedSkill[] {
  const db = getStudioDb();
  let rows: LearnedSkillRow[];
  if (statusFilter && statusFilter !== "all") {
    rows = db
      .query("SELECT * FROM learned_skills WHERE status = ? ORDER BY updated_at DESC")
      .all(statusFilter) as LearnedSkillRow[];
  } else {
    rows = db
      .query(
        "SELECT * FROM learned_skills ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, updated_at DESC"
      )
      .all() as LearnedSkillRow[];
  }
  return rows.map(mapRow);
}

export function getLearnedSkill(slug: string): LearnedSkill | null {
  const safeSlug = normalizeSkillSlug(slug);
  const db = getStudioDb();
  const row = db
    .query("SELECT * FROM learned_skills WHERE slug = ?")
    .get(safeSlug) as LearnedSkillRow | null;
  return row ? mapRow(row) : null;
}

export function saveLearnedSkill(input: {
  slug: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  status?: LearnedSkillStatus;
  source?: LearnedSkillSource;
  confidence?: LearnedSkillConfidence;
  triggerHint?: string;
  evidenceSummary?: string;
}): LearnedSkill {
  const slug = normalizeSkillSlug(input.slug);
  validateLearnedSkillContent(input);

  const db = getStudioDb();
  const existing = db
    .query("SELECT * FROM learned_skills WHERE slug = ?")
    .get(slug) as LearnedSkillRow | null;

  if (!existing) {
    const countRow = db.query("SELECT COUNT(*) as c FROM learned_skills").get() as { c?: number } | null;
    if ((countRow?.c ?? 0) >= MAX_LEARNED_SKILLS) {
      throw new Error(
        `Maximum of ${MAX_LEARNED_SKILLS} learned playbooks reached. Prune or delete unused skills first.`
      );
    }
  }

  const nowIso = new Date().toISOString();
  const status: LearnedSkillStatus =
    input.status ?? (existing ? (existing.status as LearnedSkillStatus) : "pending");
  const source: LearnedSkillSource =
    input.source ?? (existing ? (existing.source as LearnedSkillSource) : "nightly");
  const confidence: LearnedSkillConfidence =
    input.confidence ?? (existing ? (existing.confidence as LearnedSkillConfidence) : "medium");
  const triggerHint = (input.triggerHint ?? existing?.trigger_hint ?? "").trim().slice(0, 200);
  const evidenceSummary = (input.evidenceSummary ?? existing?.evidence_summary ?? "").trim().slice(0, 320);
  const title = input.title.trim();
  const description = input.description.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();
  const createdAt = existing?.created_at ?? nowIso;

  // Write SKILL.md on disk inside isolated ~/.omp/agent/learned-skills/<slug>/SKILL.md
  const filePath = resolveSkillFilePath(slug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rendered = renderSkillMarkdownFile({
    slug,
    title,
    description,
    status,
    source,
    triggerHint,
    updatedAt: nowIso,
    bodyMarkdown,
  });
  fs.writeFileSync(filePath, rendered, "utf8");

  db.prepare(`
    INSERT INTO learned_skills (
      slug, title, description, status, source, confidence,
      trigger_hint, evidence_summary, body_markdown, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      source = excluded.source,
      confidence = excluded.confidence,
      trigger_hint = excluded.trigger_hint,
      evidence_summary = excluded.evidence_summary,
      body_markdown = excluded.body_markdown,
      updated_at = excluded.updated_at
  `).run(
    slug,
    title,
    description,
    status,
    source,
    confidence,
    triggerHint,
    evidenceSummary,
    bodyMarkdown,
    createdAt,
    nowIso
  );

  return {
    slug,
    title,
    description,
    status,
    source,
    confidence,
    triggerHint,
    evidenceSummary,
    bodyMarkdown,
    filePath,
    createdAt,
    updatedAt: nowIso,
  };
}

export function updateLearnedSkillStatus(
  slug: string,
  patch: {
    status?: LearnedSkillStatus;
    title?: string;
    description?: string;
    bodyMarkdown?: string;
    triggerHint?: string;
  }
): LearnedSkill | null {
  const existing = getLearnedSkill(slug);
  if (!existing) return null;
  return saveLearnedSkill({
    slug: existing.slug,
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    bodyMarkdown: patch.bodyMarkdown ?? existing.bodyMarkdown,
    status: patch.status ?? existing.status,
    source: existing.source,
    confidence: existing.confidence,
    triggerHint: patch.triggerHint ?? existing.triggerHint,
    evidenceSummary: existing.evidenceSummary,
  });
}

export function deleteLearnedSkill(slug: string): boolean {
  const safeSlug = normalizeSkillSlug(slug);
  const db = getStudioDb();
  const res = db.prepare("DELETE FROM learned_skills WHERE slug = ?").run(safeSlug);

  try {
    ensureLearnedSkillsRoot();
    const rootReal = fs.realpathSync(LEARNED_SKILLS_ROOT);
    const dirPath = path.resolve(rootReal, safeSlug);
    if (dirPath.startsWith(rootReal + path.sep) && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // ignore fs cleanup edge errors
  }

  return res.changes > 0;
}
