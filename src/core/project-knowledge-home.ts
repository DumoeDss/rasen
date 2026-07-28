/**
 * One canonical knowledge home per project IDENTITY.
 *
 * A project's own learned knowledge used to live under the machine home of
 * whichever clone the command ran in, so a project cloned twice — or worked on
 * from a linked worktree — ended up with two catalogs on one machine and
 * resolution answered differently depending on where you were standing. The
 * canonical location is keyed on the project's identity instead:
 *
 *   <global data dir>/project-knowledge/<projectId>/learned-skills/<id>/
 *
 * Three roots stay apart, and this module owns only the first (plan §15.6):
 *
 *   canonicalOwnerRoot     here — where the project's knowledge LIVES
 *   evaluationRoot         the session's checkout — where applicability is DECIDED
 *   materializationTarget  a tool's home in that checkout — where files are WRITTEN
 *
 * It is deliberately NOT the clone-specific work directory, not the
 * clone-specific archive/work ephemera, and not a tool's in-checkout skill
 * home. `resolveProjectHome` still owns all of those.
 *
 * The migration off the per-clone layout is explicit, previewable, repeatable,
 * and never destructive: it moves one catalog, deduplicates byte-identical
 * ones, REPORTS divergent ones without choosing a winner, and removes nothing
 * until the replacement has been written to the canonical location and read
 * back successfully.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { randomBytes } from 'node:crypto';

import { FileSystemUtils } from '../utils/file-system.js';
import { getGlobalDataDir } from './global-config.js';
import { digestContent } from './learned-skills/catalog.js';
import { LEARNED_SKILLS_DIR_NAME } from './learned-skills/constants.js';
import {
  getProjectHomeDir,
  readProjectRegistryState,
  type ProjectPathOptions,
} from './project-registry.js';
import {
  normalizeProjectIdentity,
  projectIdentityRecordProblem,
} from './store/project-records.js';

/** The canonical knowledge area under the machine data directory. */
export const PROJECT_KNOWLEDGE_DIR_NAME = 'project-knowledge';

/** Staging prefix for a verified-before-delete move (dot-prefixed, see below). */
const MIGRATION_STAGING_PREFIX = '.rasen-project-knowledge-staging-';

/**
 * A project's canonical knowledge location, resolved.
 *
 * `root` is the `canonicalOwnerRoot` §15.6 names; `catalogDir` is the catalog
 * inside it. Both are composed with `path.join()` so a Windows drive-letter or
 * separator difference can never produce two homes for one project.
 */
export interface ProjectKnowledgeHome {
  projectId: string;
  /** `<global data dir>/project-knowledge/<projectId>` — the canonical owner root. */
  root: string;
  /** `<root>/learned-skills` — the canonical catalog directory. */
  catalogDir: string;
}

/** The identity cannot name a directory, so it cannot key a knowledge home. */
export type ProjectKnowledgeHomeErrorCode = 'project_identity_unrecordable';

export class ProjectKnowledgeHomeError extends Error {
  readonly code: ProjectKnowledgeHomeErrorCode;
  readonly repair: string[];

  constructor(message: string, code: ProjectKnowledgeHomeErrorCode, repair: string[] = []) {
    super(message);
    this.name = 'ProjectKnowledgeHomeError';
    this.code = code;
    this.repair = repair;
  }
}

function globalRoot(options: ProjectPathOptions): string {
  return options.globalDataDir ?? getGlobalDataDir();
}

/**
 * The canonical knowledge home for one project identity.
 *
 * The identity is validated through child B's own rule
 * (`projectIdentityRecordProblem`) rather than a second rule invented here: an
 * identity that cannot name a Store's record file cannot name a directory
 * either, and the two must never disagree about what is safe.
 */
export function resolveProjectKnowledgeHome(
  projectId: string,
  options: ProjectPathOptions = {}
): ProjectKnowledgeHome {
  const normalized = normalizeProjectIdentity(projectId);
  const problem = projectIdentityRecordProblem(normalized);
  if (problem !== null) {
    throw new ProjectKnowledgeHomeError(
      `Project identity '${projectId}' cannot key a canonical knowledge home because ${problem}.`,
      'project_identity_unrecordable',
      ['rasen init']
    );
  }
  const root = path.join(globalRoot(options), PROJECT_KNOWLEDGE_DIR_NAME, normalized);
  return {
    projectId: normalized,
    root,
    catalogDir: path.join(root, LEARNED_SKILLS_DIR_NAME),
  };
}

/** Every canonical knowledge home currently present on this machine. */
export function listProjectKnowledgeHomes(options: ProjectPathOptions = {}): string[] {
  const base = path.join(globalRoot(options), PROJECT_KNOWLEDGE_DIR_NAME);
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Content identity for a record directory
// -----------------------------------------------------------------------------

/** Every regular file under `dir`, relative and POSIX-normalized, sorted. */
function listRecordFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      found.push(FileSystemUtils.toPosixPath(path.relative(dir, full)));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * A stable digest over a record directory's contents.
 *
 * Digested through {@link digestContent}, which normalizes line endings: a
 * clone checked out with `core.autocrlf` on must not read as content that
 * diverges from the same record in a sibling clone — that would be a spurious
 * conflict blocking a migration that is in fact a plain duplicate.
 */
export function digestRecordDirectory(dir: string): string | null {
  const files = listRecordFiles(dir);
  if (files.length === 0) return null;
  const parts: string[] = [];
  for (const relative of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, ...relative.split('/')), 'utf-8');
    } catch {
      return null;
    }
    parts.push(`${relative}\u0000${digestContent(content)}`);
  }
  return digestContent(parts.join('\n'));
}

// -----------------------------------------------------------------------------
// Migration
// -----------------------------------------------------------------------------

/** One per-clone catalog found during the scan. */
export interface LegacyProjectCatalog {
  /** The registered checkout whose machine home holds this catalog. */
  checkoutRoot: string;
  /** `<machine home>/learned-skills` — the old per-clone catalog directory. */
  catalogDir: string;
  /** Record id → content digest, for every readable record it holds. */
  records: Record<string, string>;
}

/** One record the migration would move, and the identical copies it subsumes. */
export interface ProjectKnowledgeMove {
  id: string;
  from: string;
  to: string;
  /** Byte-identical copies in other clones, removed only after verification. */
  duplicates: string[];
}

/** One record several clones disagree about. Never resolved, never deleted. */
export interface ProjectKnowledgeConflict {
  id: string;
  /** Every catalog holding a version, with the digest that made it distinct. */
  participants: Array<{ catalogDir: string; digest: string }>;
}

export interface ProjectKnowledgeMigrationDiagnostic {
  code: string;
  message: string;
  repair?: string[];
}

export type ProjectKnowledgeMigrationStatus =
  /** Nothing left to move; the canonical home is already the only catalog. */
  | 'nothing-to-do'
  /** Everything found can move (preview) or did move (applied). */
  | 'complete'
  /** Some records moved; at least one identifier is a reported conflict. */
  | 'partial'
  /** Nothing could move — every candidate identifier conflicts. */
  | 'blocked';

export interface ProjectKnowledgeMigrationPlan {
  projectId: string;
  /** The canonical catalog everything moves INTO. */
  target: string;
  /** Every per-clone catalog the scan found. */
  sources: LegacyProjectCatalog[];
  /** Records already present in the canonical catalog and identical there. */
  alreadyCanonical: string[];
  moves: ProjectKnowledgeMove[];
  conflicts: ProjectKnowledgeConflict[];
  diagnostics: ProjectKnowledgeMigrationDiagnostic[];
}

export interface ProjectKnowledgeMigrationResult extends ProjectKnowledgeMigrationPlan {
  status: ProjectKnowledgeMigrationStatus;
  /** True for a preview: nothing was created, moved, or deleted. */
  dryRun: boolean;
  moved: string[];
  /** Identical copies removed after their canonical replacement verified. */
  deduplicated: string[];
  /** Records that could not be verified at the canonical location. Originals intact. */
  failed: Array<{ id: string; reason: string }>;
}

export interface ProjectKnowledgeMigrationOptions extends ProjectPathOptions {
  /** Preview only. Nothing is created, moved, or deleted. */
  dryRun?: boolean;
}

function readCatalogRecords(catalogDir: string): Record<string, string> {
  const records: Record<string, string> = {};
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(catalogDir, { withFileTypes: true });
  } catch {
    return records;
  }
  for (const entry of entries) {
    // A dot-prefixed entry is mutation debris (a staging or backup directory),
    // never a record. The leading dot is contract in the learned-skill core
    // for exactly this reason and is honoured here too.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const digest = digestRecordDirectory(path.join(catalogDir, entry.name));
    if (digest !== null) records[entry.name] = digest;
  }
  return records;
}

/**
 * Every per-clone catalog on this machine that belongs to `projectId`.
 *
 * Scans the project registry rather than the filesystem: the registry is what
 * says which machine home belongs to which project identity, and two clones of
 * one project are exactly two registry entries carrying the same `projectId`.
 */
export async function scanLegacyProjectCatalogs(
  projectId: string,
  options: ProjectPathOptions = {}
): Promise<LegacyProjectCatalog[]> {
  const normalized = normalizeProjectIdentity(projectId);
  const state = await readProjectRegistryState(options);
  if (!state) return [];
  const found: LegacyProjectCatalog[] = [];
  for (const [checkoutRoot, entry] of Object.entries(state.projects)) {
    if (normalizeProjectIdentity(entry.projectId) !== normalized) continue;
    const catalogDir = path.join(
      getProjectHomeDir(entry.home, options),
      LEARNED_SKILLS_DIR_NAME
    );
    if (found.some((candidate) => candidate.catalogDir === catalogDir)) continue;
    const records = readCatalogRecords(catalogDir);
    if (Object.keys(records).length === 0) continue;
    found.push({ checkoutRoot, catalogDir, records });
  }
  return found.sort((left, right) => left.catalogDir.localeCompare(right.catalogDir));
}

/**
 * What the migration would do. Reads only — safe to call from a preview, from
 * a read-only surface, and repeatedly.
 */
export async function planProjectKnowledgeMigration(
  projectId: string,
  options: ProjectPathOptions = {}
): Promise<ProjectKnowledgeMigrationPlan> {
  const home = resolveProjectKnowledgeHome(projectId, options);
  const sources = (await scanLegacyProjectCatalogs(projectId, options)).filter(
    (source) => source.catalogDir !== home.catalogDir
  );
  const canonical = readCatalogRecords(home.catalogDir);
  const diagnostics: ProjectKnowledgeMigrationDiagnostic[] = [];

  const byId = new Map<string, Array<{ catalogDir: string; digest: string }>>();
  for (const source of sources) {
    for (const [id, digest] of Object.entries(source.records)) {
      const group = byId.get(id) ?? [];
      group.push({ catalogDir: source.catalogDir, digest });
      byId.set(id, group);
    }
  }

  const moves: ProjectKnowledgeMove[] = [];
  const conflicts: ProjectKnowledgeConflict[] = [];
  const alreadyCanonical: string[] = [];

  for (const id of [...byId.keys()].sort()) {
    const group = (byId.get(id) ?? []).sort((left, right) =>
      left.catalogDir.localeCompare(right.catalogDir)
    );
    const canonicalDigest = canonical[id];
    const digests = new Set(group.map((item) => item.digest));
    if (canonicalDigest !== undefined) digests.add(canonicalDigest);

    if (digests.size > 1) {
      // Rule 4: choosing between divergent catalogs would silently discard a
      // project's knowledge, and no available signal could justify the choice.
      conflicts.push({
        id,
        participants: [
          ...(canonicalDigest !== undefined
            ? [{ catalogDir: home.catalogDir, digest: canonicalDigest }]
            : []),
          ...group,
        ],
      });
      diagnostics.push({
        code: 'project_knowledge_catalog_conflict',
        message: `Learned knowledge "${id}" differs between ${
          group.length + (canonicalDigest === undefined ? 0 : 1)
        } catalogs for this project; nothing was chosen, moved, or deleted.`,
        repair: [`rasen knowledge show ${id}`],
      });
      continue;
    }

    if (canonicalDigest !== undefined) {
      // Already migrated (possibly by an interrupted earlier run): the copies
      // left behind are duplicates of what is already canonical.
      alreadyCanonical.push(id);
      moves.push({
        id,
        from: group[0]!.catalogDir,
        to: home.catalogDir,
        duplicates: group.map((item) => item.catalogDir),
      });
      continue;
    }

    const [first, ...rest] = group;
    moves.push({
      id,
      from: first!.catalogDir,
      to: home.catalogDir,
      duplicates: rest.map((item) => item.catalogDir),
    });
  }

  return {
    projectId: home.projectId,
    target: home.catalogDir,
    sources,
    alreadyCanonical,
    moves,
    conflicts,
    diagnostics,
  };
}

function statusFor(
  plan: ProjectKnowledgeMigrationPlan,
  movedCount: number,
  deduplicatedCount: number
): ProjectKnowledgeMigrationStatus {
  if (plan.moves.length === 0 && plan.conflicts.length === 0) return 'nothing-to-do';
  if (plan.conflicts.length === 0) return 'complete';
  return movedCount + deduplicatedCount > 0 ? 'partial' : 'blocked';
}

/** Recursive copy that refuses to follow a symlink into somebody else's tree. */
function copyRecordDirectory(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyRecordDirectory(source, destination);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(source, destination);
  }
}

/**
 * Applies (or previews) the move into the canonical knowledge home.
 *
 * Order is the whole safety property: stage → publish → VERIFY by re-reading →
 * only then remove the originals. A verification failure leaves every original
 * catalog exactly as it was, and a run interrupted anywhere re-runs cleanly
 * because a record already canonical and identical is treated as a duplicate
 * to clear rather than something to move again.
 */
export async function migrateProjectKnowledgeHome(
  projectId: string,
  options: ProjectKnowledgeMigrationOptions = {}
): Promise<ProjectKnowledgeMigrationResult> {
  const { dryRun = false, ...pathOptions } = options;
  const plan = await planProjectKnowledgeMigration(projectId, pathOptions);
  const moved: string[] = [];
  const deduplicated: string[] = [];
  const failed: ProjectKnowledgeMigrationResult['failed'] = [];

  if (dryRun) {
    return {
      ...plan,
      status: statusFor(plan, 0, 0),
      dryRun: true,
      moved: [],
      deduplicated: [],
      failed: [],
    };
  }

  for (const move of plan.moves) {
    const target = path.join(move.to, move.id);
    const alreadyCanonical = plan.alreadyCanonical.includes(move.id);
    const expected = digestRecordDirectory(path.join(move.from, move.id));
    if (expected === null) {
      failed.push({ id: move.id, reason: `${move.from} no longer holds a readable record` });
      continue;
    }

    if (!alreadyCanonical) {
      const staging = path.join(
        move.to,
        `${MIGRATION_STAGING_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`
      );
      try {
        fs.mkdirSync(move.to, { recursive: true });
        copyRecordDirectory(path.join(move.from, move.id), staging);
        if (fs.existsSync(target)) {
          // Another run published it between the plan and here. Leave the
          // published copy alone; the verification below decides the rest.
          fs.rmSync(staging, { recursive: true, force: true });
        } else {
          fs.renameSync(staging, target);
        }
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        failed.push({
          id: move.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Verified by RE-READING the canonical location, not by trusting the copy.
    const verified = digestRecordDirectory(target);
    if (verified !== expected) {
      failed.push({
        id: move.id,
        reason: `the canonical copy at ${target} did not read back as the record it was written from`,
      });
      continue;
    }

    if (!alreadyCanonical) moved.push(move.id);
    // Only NOW is an original removed, and only when it still reads back as
    // the exact record the canonical copy was verified against.
    const removals = alreadyCanonical ? move.duplicates : [move.from, ...move.duplicates];
    for (const catalogDir of removals) {
      const copy = path.join(catalogDir, move.id);
      if (digestRecordDirectory(copy) !== expected) continue;
      fs.rmSync(copy, { recursive: true, force: true });
      if (alreadyCanonical || catalogDir !== move.from) deduplicated.push(move.id);
    }
  }

  return {
    ...plan,
    status: statusFor(plan, moved.length, deduplicated.length),
    dryRun: false,
    moved: [...new Set(moved)].sort(),
    deduplicated: [...new Set(deduplicated)].sort(),
    failed,
  };
}
