/**
 * Learned-skill materialization (design D9).
 *
 * `resolveLearnedSkills` returns the active canonical records; this module
 * generates them into a tool's skill home and tracks each exact generated copy
 * in an artifact ledger. It is the ONLY seam that writes learned skills into a
 * tool directory — init and update call it after ordinary profile/dependency
 * resolution. Learned-skill ids are never added to a profile or workflow
 * closure.
 *
 * Ownership is exact, never inferred by name: a target is refreshed or pruned
 * only when the ledger records it as Rasen's generated copy AND the on-disk
 * bytes still match what Rasen wrote. A human-authored directory, or a
 * generated copy the user has since edited, blocks the operation and is
 * preserved byte-for-byte. Two homes are supported:
 *
 *  - project-local tool homes use the project artifact ledger and materialize
 *    project + global records whose `path-exists` applicability matches;
 *  - a machine-global tool home (Hermes) uses the machine-global ledger,
 *    reconciles every active approved global record independent of any one
 *    project's markers, and skips project-scoped records with a warning.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../utils/file-system.js';
import { quoteYamlValue } from './shared/yaml.js';
import {
  digestContent,
  matchesApplicability,
  LEARNED_SKILL_GENERATED_BY,
  type CanonicalLearnedSkill,
  type LearnedSkillScope,
  type ResolvedLearnedSkillSet,
} from './learned-skills/index.js';
import {
  persistToolLearnedArtifacts,
  readToolLearnedArtifacts,
  resolveArtifactFile,
  sha256File,
  storedArtifactFile,
  type LearnedArtifactEntry,
} from './workflow-artifact-ledger.js';
import {
  persistGlobalLearnedArtifacts,
  readGlobalLearnedArtifacts,
  sha256GlobalFile,
  type GlobalLearnedArtifactEntry,
} from './global-learned-skill-ledger.js';

export const LEARNED_SKILL_CONTENT_FILE = 'SKILL.md';

/** One materialized copy created, updated, or removed during reconciliation. */
export interface LearnedMaterializationOutcome {
  id: string;
  skillScope: LearnedSkillScope;
  targetPath: string;
}

/** A learned skill deliberately left unmaterialized, with an actionable reason. */
export interface LearnedMaterializationSkip {
  id: string;
  skillScope: LearnedSkillScope;
  targetPath?: string;
  reason: 'collision' | 'global-only-home';
  message: string;
}

export interface LearnedReconcileResult {
  created: LearnedMaterializationOutcome[];
  updated: LearnedMaterializationOutcome[];
  removed: LearnedMaterializationOutcome[];
  skipped: LearnedMaterializationSkip[];
}

function emptyResult(): LearnedReconcileResult {
  return { created: [], updated: [], removed: [], skipped: [] };
}

/** True when a reconcile result recorded any change or skip. */
export function learnedReconcileHasActivity(result: LearnedReconcileResult): boolean {
  return (
    result.created.length > 0 ||
    result.updated.length > 0 ||
    result.removed.length > 0 ||
    result.skipped.length > 0
  );
}

/** True when a reconcile result changed the filesystem (create/update/remove). */
export function learnedReconcileHasChanges(result: LearnedReconcileResult): boolean {
  return result.created.length > 0 || result.updated.length > 0 || result.removed.length > 0;
}

/** Merges a per-tool result into an aggregate. */
export function mergeLearnedReconcileResult(
  into: LearnedReconcileResult,
  from: LearnedReconcileResult
): void {
  into.created.push(...from.created);
  into.updated.push(...from.updated);
  into.removed.push(...from.removed);
  into.skipped.push(...from.skipped);
}

/** Strips a leading `---\n…\n---\n` YAML frontmatter block, returning the body. */
function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

/**
 * Renders the materialized `SKILL.md` for a canonical learned skill: the same
 * name/description/body plus string metadata naming generated ownership,
 * scope, learned-skill id, and the canonical content digest (design D7). No
 * executable sidecars — a v1 learned skill is declarative guidance only.
 */
export function renderMaterializedSkill(record: CanonicalLearnedSkill): string {
  const { manifest } = record;
  const body = stripFrontmatter(record.content);
  return [
    '---',
    `name: ${quoteYamlValue(manifest.id)}`,
    `description: ${quoteYamlValue(manifest.description)}`,
    'license: MIT',
    'compatibility: Requires rasen CLI.',
    'metadata:',
    '  author: rasen',
    `  generatedBy: ${quoteYamlValue(LEARNED_SKILL_GENERATED_BY)}`,
    `  learnedSkillScope: ${quoteYamlValue(manifest.scope)}`,
    `  learnedSkillId: ${quoteYamlValue(manifest.id)}`,
    `  contentDigest: ${quoteYamlValue(manifest.contentDigest)}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** A learned skill Rasen wants materialized into a skill home. */
interface DesiredMaterialization {
  id: string;
  skillScope: LearnedSkillScope;
  contentDigest: string;
  content: string;
}

/** A materialized copy the ledger currently tracks (absolute path). */
interface TrackedMaterialization {
  id: string;
  skillScope: LearnedSkillScope;
  contentDigest: string;
  targetPath: string;
  sha256: string;
}

/** The result of the pure reconcile core: the new tracked set plus outcomes. */
interface CoreReconcile {
  next: TrackedMaterialization[];
  result: LearnedReconcileResult;
}

function writeMaterialized(targetFile: string, content: string): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, content, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Removes now-empty directories from `start` up to (but not past) `boundary`.
 * Stops at the first non-empty directory. Cross-platform via `path` primitives.
 */
function removeEmptyDirsUpTo(start: string, boundary: string): void {
  const stop = path.resolve(boundary);
  let current = path.resolve(start);
  while (current !== stop) {
    const relative = path.relative(stop, current);
    // Never walk outside the boundary (guards the string-prefix pitfall).
    if (relative.startsWith('..') || path.isAbsolute(relative)) return;
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * The pure reconcile core over absolute target paths, shared by the project and
 * global wrappers. Byte-preserving: it writes only into an absent target or a
 * copy it exactly owns, and removes only an owned, unmodified copy.
 */
function reconcileCore(
  skillsRoot: string,
  desired: readonly DesiredMaterialization[],
  tracked: readonly TrackedMaterialization[],
  toolLabel: string
): CoreReconcile {
  const result = emptyResult();
  const next: TrackedMaterialization[] = [];
  const trackedById = new Map(tracked.map((entry) => [entry.id, entry]));
  const desiredIds = new Set(desired.map((entry) => entry.id));

  for (const item of desired) {
    const targetDir = path.join(skillsRoot, item.id);
    const targetFile = path.join(targetDir, LEARNED_SKILL_CONTENT_FILE);
    const prior = trackedById.get(item.id);
    const desiredSha = digestContent(item.content);
    const onDisk = sha256File(targetFile);

    if (onDisk === null) {
      // Absent (or an unsafe non-file entity) — free to generate.
      writeMaterialized(targetFile, item.content);
      const entry: TrackedMaterialization = {
        id: item.id,
        skillScope: item.skillScope,
        contentDigest: item.contentDigest,
        targetPath: targetFile,
        sha256: desiredSha,
      };
      next.push(entry);
      result.created.push({ id: item.id, skillScope: item.skillScope, targetPath: targetFile });
      continue;
    }

    const owned =
      prior !== undefined &&
      path.resolve(prior.targetPath) === path.resolve(targetFile) &&
      prior.sha256 === onDisk;

    if (!owned) {
      // A human-authored skill or a generated copy the user has edited — never
      // overwrite it, and do not claim ownership.
      result.skipped.push({
        id: item.id,
        skillScope: item.skillScope,
        targetPath: targetFile,
        reason: 'collision',
        message: `Skipped learned skill "${item.id}" for ${toolLabel}: ${targetFile} is not the exact copy Rasen generated (human-authored or locally modified); left unchanged.`,
      });
      continue;
    }

    if (onDisk === desiredSha) {
      // Owned and unchanged.
      next.push({ ...prior, contentDigest: item.contentDigest });
      continue;
    }

    // Owned and the canonical content changed — refresh in place.
    writeMaterialized(targetFile, item.content);
    next.push({
      id: item.id,
      skillScope: item.skillScope,
      contentDigest: item.contentDigest,
      targetPath: targetFile,
      sha256: desiredSha,
    });
    result.updated.push({ id: item.id, skillScope: item.skillScope, targetPath: targetFile });
  }

  for (const entry of tracked) {
    if (desiredIds.has(entry.id)) continue;
    const onDisk = sha256File(entry.targetPath);
    if (onDisk !== null && onDisk === entry.sha256) {
      fs.rmSync(entry.targetPath, { force: true });
      removeEmptyDirsUpTo(path.dirname(entry.targetPath), skillsRoot);
      result.removed.push({ id: entry.id, skillScope: entry.skillScope, targetPath: entry.targetPath });
    }
    // Otherwise the copy is gone or user-modified: drop tracking without
    // deleting anything the user now owns.
  }

  return { next, result };
}

/** The dedup'd, applicability-matched records to materialize for a project-local home. */
function projectDesiredSet(
  resolved: ResolvedLearnedSkillSet,
  projectRoot: string
): DesiredMaterialization[] {
  const byId = new Map<string, DesiredMaterialization>();
  // Global first so an owning project's project-scoped record of the same id
  // takes precedence (its own copy wins the shared directory name).
  for (const record of resolved.global) {
    if (!matchesApplicability(record.manifest.applicability, projectRoot)) continue;
    byId.set(record.manifest.id, {
      id: record.manifest.id,
      skillScope: 'global',
      contentDigest: record.manifest.contentDigest,
      content: renderMaterializedSkill(record),
    });
  }
  for (const record of resolved.project) {
    if (!matchesApplicability(record.manifest.applicability, projectRoot)) continue;
    byId.set(record.manifest.id, {
      id: record.manifest.id,
      skillScope: 'project',
      contentDigest: record.manifest.contentDigest,
      content: renderMaterializedSkill(record),
    });
  }
  return [...byId.values()];
}

/**
 * Reconciles applicable learned skills for one project-local tool home,
 * persisting exact ownership in the project artifact ledger. Global and
 * project-scoped records both materialize only when their `path-exists`
 * applicability matches the initialized project.
 */
export function reconcileProjectLearnedSkillsForTool(params: {
  projectRoot: string;
  toolId: string;
  toolLabel: string;
  skillsRoot: string;
  resolved: ResolvedLearnedSkillSet;
}): LearnedReconcileResult {
  const { projectRoot, toolId, toolLabel, skillsRoot, resolved } = params;
  const desired = projectDesiredSet(resolved, projectRoot);

  const tracked: TrackedMaterialization[] = [];
  for (const [id, entry] of Object.entries(readToolLearnedArtifacts(projectRoot, toolId))) {
    const targetPath = resolveArtifactFile(projectRoot, entry.file);
    if (targetPath === null) continue; // unsafe/tampered ledger path — treat as untracked
    tracked.push({
      id,
      skillScope: entry.skillScope,
      contentDigest: entry.contentDigest,
      targetPath,
      sha256: entry.file.sha256,
    });
  }

  const { next, result } = reconcileCore(skillsRoot, desired, tracked, toolLabel);

  const learned: Record<string, LearnedArtifactEntry> = {};
  for (const entry of next) {
    learned[entry.id] = {
      skillScope: entry.skillScope,
      contentDigest: entry.contentDigest,
      file: { ...storedArtifactFile(projectRoot, entry.targetPath), sha256: entry.sha256 },
    };
  }
  persistToolLearnedArtifacts(projectRoot, toolId, learned);

  return result;
}

/**
 * Reconciles learned skills for a machine-global tool home (Hermes). Every
 * active approved global record is reconciled through the machine-global ledger
 * independent of any one project's markers; project-scoped records are skipped
 * with a warning because a global-only home cannot enforce project
 * applicability at install time.
 */
export function reconcileGlobalLearnedSkillsForTool(params: {
  toolId: string;
  toolLabel: string;
  skillsRoot: string;
  resolved: ResolvedLearnedSkillSet;
  globalDataDir?: string;
}): LearnedReconcileResult {
  const { toolId, toolLabel, skillsRoot, resolved, globalDataDir } = params;

  const desired: DesiredMaterialization[] = resolved.global.map((record) => ({
    id: record.manifest.id,
    skillScope: 'global',
    contentDigest: record.manifest.contentDigest,
    content: renderMaterializedSkill(record),
  }));

  const tracked: TrackedMaterialization[] = [];
  for (const [id, entry] of Object.entries(readGlobalLearnedArtifacts(globalDataDir, toolId))) {
    tracked.push({
      id,
      skillScope: 'global',
      contentDigest: entry.contentDigest,
      targetPath: entry.path,
      sha256: entry.sha256,
    });
  }

  const { next, result } = reconcileCore(skillsRoot, desired, tracked, toolLabel);

  // A global-only home cannot receive project-scoped knowledge; report each as
  // skipped so the caller can warn.
  for (const record of resolved.project) {
    result.skipped.push({
      id: record.manifest.id,
      skillScope: 'project',
      reason: 'global-only-home',
      message: `Skipped project-scoped learned skill "${record.manifest.id}" for ${toolLabel}: project-scoped learned skills require a project-local tool home.`,
    });
  }

  const learned: Record<string, GlobalLearnedArtifactEntry> = {};
  for (const entry of next) {
    learned[entry.id] = {
      contentDigest: entry.contentDigest,
      path: entry.targetPath,
      sha256: entry.sha256,
    };
  }
  persistGlobalLearnedArtifacts(globalDataDir, toolId, learned);

  return result;
}

// sha256GlobalFile is re-exported so tests can assert on-disk global copies.
export { sha256GlobalFile };
