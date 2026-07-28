/**
 * Exact ownership over the learned-skill files Rasen generated into a checkout.
 *
 * A generated file is modified or removed only when THIS record claims that
 * exact path, the file on disk is still an ordinary file, its bytes still match
 * what was recorded, and the source is still verifiable. Anything failing a
 * check is left alone and reported — a file the user authored at a generated
 * path is never taken over.
 *
 * **Version 2 keys ownership on permanent identity.** Version 1 recorded a
 * Store's display alias, both in the `stores` map and inside every
 * `sources[].owner`. On a release that makes the alias renameable, that record
 * cannot say which Store owns a generated file: rename a Store and the
 * ownership silently moves; run two Stores that share a display name and the
 * ownership is ambiguous from the moment it is written.
 *
 * So version 1 is READ, never trusted as ownership, and upgraded only by an
 * explicit, previewable migration that:
 *
 *   - upgrades when the alias maps to exactly one Store carrying a permanent
 *     identity, and
 *   - **BLOCKS** when it maps to none or to several — never guessing, and never
 *     dropping the source it could not map.
 *
 * Blocking is the correct answer: an ambiguous mapping means the ledger cannot
 * say which Store owns a real file on disk, and attaching that file to the
 * wrong Store is worse than refusing to upgrade.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import {
  listStoreRegistryEntries,
  readStoreRegistryState,
} from './store/foundation.js';
import { normalizeStoreUid } from './store/identity-types.js';
import type { StorePathOptions } from './store/foundation.js';

/** Current ownership-record version: identity-keyed, alias-free. */
export const PROJECT_LEARNED_LEDGER_VERSION = 2 as const;
/** The alias-keyed shape that shipped only on an unreleased branch. */
export const PROJECT_LEARNED_LEDGER_V1_VERSION = 1 as const;
export const PROJECT_LEARNED_LEDGER_FILE = '.learned-skill-materializations.json';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

// -----------------------------------------------------------------------------
// Version 2
// -----------------------------------------------------------------------------

/**
 * A durable source owner. The Store arm carries the permanent identity and, at
 * most, the display alias as a CONVENIENCE field — nothing is keyed on it and
 * nothing compares it.
 */
const DurableOwnerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('global') }),
  z.strictObject({ type: z.literal('project'), projectId: z.string().min(1), id: z.string().min(1).optional() }),
  z.strictObject({ type: z.literal('store'), uid: z.string().min(1), id: z.string().min(1).optional() }),
]);

const SourceSchema = z.strictObject({
  owner: DurableOwnerSchema,
  id: z.string().min(1),
});

const ArtifactFileSchema = z
  .strictObject({
    scope: z.enum(['project', 'absolute']),
    path: z.string().min(1),
    sha256: z.string().regex(sha256Pattern),
  })
  .superRefine((file, context) => {
    if (file.scope === 'absolute') {
      if (!path.isAbsolute(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['path'],
          message: 'absolute learned artifact paths must be absolute',
        });
      }
      return;
    }
    if (
      path.isAbsolute(file.path) ||
      file.path.includes('\\') ||
      file.path.split('/').some((segment) => segment === '..' || segment === '.')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'project learned artifact paths must be portable root-relative paths',
      });
    }
  });

const ProjectLearnedArtifactSchema = z.strictObject({
  effectiveScope: z.enum(['project', 'store', 'global']),
  sources: z.array(SourceSchema).min(1),
  canonicalContentDigest: z.string().regex(sha256Pattern),
  resolutionDigest: z.string().regex(sha256Pattern),
  /**
   * Which identity scheme produced `resolutionDigest`. An entry still carrying
   * scheme 1 is what lets the next reconciliation report a rewrite as the
   * MIGRATION it is, instead of claiming the user edited their whole catalog.
   */
  resolutionSchemaVersion: z.union([z.literal(1), z.literal(2)]),
  file: ArtifactFileSchema,
});

/**
 * What was last known about one Store, keyed in the map by its PERMANENT
 * identity. The display alias rides along for the message only.
 */
const StoreFactSchema = z.strictObject({
  lastMembership: z.enum(['member', 'not-member', 'unavailable']),
  relevant: z.boolean().optional(),
  id: z.string().min(1).optional(),
});

const ProjectLearnedLedgerSchema = z
  .strictObject({
    version: z.literal(PROJECT_LEARNED_LEDGER_VERSION),
    stores: z.record(z.string(), StoreFactSchema),
    tools: z.record(
      z.string(),
      z.strictObject({ learned: z.record(z.string(), ProjectLearnedArtifactSchema) })
    ),
  })
  .superRefine((ledger, context) => {
    for (const [toolId, tool] of Object.entries(ledger.tools)) {
      for (const [id, entry] of Object.entries(tool.learned)) {
        for (const [sourceIndex, source] of entry.sources.entries()) {
          if (source.id !== id) {
            context.addIssue({
              code: 'custom',
              path: ['tools', toolId, 'learned', id, 'sources', sourceIndex, 'id'],
              message: 'learned source ids must match their ledger map key',
            });
          }
        }
      }
    }
  });

// -----------------------------------------------------------------------------
// Version 1 (read-only)
// -----------------------------------------------------------------------------

const LegacyOwnerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('global') }),
  z.strictObject({ type: z.literal('project'), id: z.string().min(1) }),
  z.strictObject({ type: z.literal('store'), id: z.string().min(1) }),
]);

const LegacyLedgerSchema = z.strictObject({
  version: z.literal(PROJECT_LEARNED_LEDGER_V1_VERSION),
  stores: z.record(
    z.string(),
    z.strictObject({
      lastMembership: z.enum(['member', 'not-member', 'unavailable']),
      relevant: z.boolean().optional(),
    })
  ),
  tools: z.record(
    z.string(),
    z.strictObject({
      learned: z.record(
        z.string(),
        z.strictObject({
          effectiveScope: z.enum(['project', 'store', 'global']),
          sources: z.array(z.strictObject({ owner: LegacyOwnerSchema, id: z.string().min(1) })).min(1),
          canonicalContentDigest: z.string().regex(sha256Pattern),
          resolutionDigest: z.string().regex(sha256Pattern),
          file: ArtifactFileSchema,
        })
      ),
    })
  ),
});

export type ProjectLearnedArtifactEntry = z.infer<typeof ProjectLearnedArtifactSchema>;
export type ProjectLearnedStoreFact = z.infer<typeof StoreFactSchema>;
export type ProjectLearnedLedger = z.infer<typeof ProjectLearnedLedgerSchema>;
export type LegacyProjectLearnedLedger = z.infer<typeof LegacyLedgerSchema>;

export class ProjectLearnedLedgerError extends Error {
  readonly code:
    | 'ledger_unreadable'
    | 'ledger_invalid'
    /** A version 1 record is present and must be migrated before it is trusted. */
    | 'learned_owner_legacy_alias';
  readonly repair: string[];

  constructor(
    message: string,
    code: ProjectLearnedLedgerError['code'],
    repair: string[] = []
  ) {
    super(message);
    this.name = 'ProjectLearnedLedgerError';
    this.code = code;
    this.repair = repair;
  }
}

/**
 * The ownership record lives beside the project's planning content in the
 * CHECKOUT, because that is where the files it claims were generated. It is
 * not the canonical knowledge home and must never be confused with it.
 */
export function getProjectLearnedLedgerPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), 'rasen', PROJECT_LEARNED_LEDGER_FILE);
}

function emptyLedger(): ProjectLearnedLedger {
  return { version: PROJECT_LEARNED_LEDGER_VERSION, stores: {}, tools: {} };
}

function readRaw(projectRoot: string): unknown | null {
  const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ProjectLearnedLedgerError(
      `Cannot read project learned ledger: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_unreadable'
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProjectLearnedLedgerError(
      `Project learned ledger is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_invalid'
    );
  }
}

/**
 * The version 1 ledger present in this checkout, or null.
 *
 * Reading it leaves the file byte-identical: a read is never a migration, and
 * a version 1 record only becomes version 2 when the user runs the migration.
 */
export function readLegacyProjectLearnedLedger(
  projectRoot: string
): LegacyProjectLearnedLedger | null {
  const raw = readRaw(projectRoot);
  if (raw === null) return null;
  const legacy = LegacyLedgerSchema.safeParse(raw);
  return legacy.success ? legacy.data : null;
}

/**
 * Strict reader for the CURRENT shape. An invalid record blocks mutation
 * instead of silently losing ownership of real files; a version 1 record is
 * refused with the migration that upgrades it, because trusting it would mean
 * trusting a display name to say who owns a file.
 */
export function readProjectLearnedLedger(projectRoot: string): ProjectLearnedLedger | null {
  const raw = readRaw(projectRoot);
  if (raw === null) return null;
  const parsed = ProjectLearnedLedgerSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (LegacyLedgerSchema.safeParse(raw).success) {
    throw new ProjectLearnedLedgerError(
      `The learned-skill ownership record in ${getProjectLearnedLedgerPath(
        projectRoot
      )} names its sources by a Store's display name, which this release makes renameable. Run the migration to re-key it on permanent identity.`,
      'learned_owner_legacy_alias',
      ['rasen knowledge migrate --dry-run', 'rasen knowledge migrate']
    );
  }
  throw new ProjectLearnedLedgerError(
    `Project learned ledger is invalid: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    'ledger_invalid'
  );
}

function writeProjectLearnedLedger(projectRoot: string, ledger: ProjectLearnedLedger): void {
  const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
  const hasEntries =
    Object.keys(ledger.stores).length > 0 ||
    Object.values(ledger.tools).some((tool) => Object.keys(tool.learned).length > 0);
  if (!hasEntries) {
    fs.rmSync(ledgerPath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = path.join(
    path.dirname(ledgerPath),
    `.${path.basename(ledgerPath)}.${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  );
  const backup = `${temporary}.bak`;
  fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    if (!fs.existsSync(ledgerPath)) {
      fs.renameSync(temporary, ledgerPath);
      return;
    }
    fs.renameSync(ledgerPath, backup);
    try {
      fs.renameSync(temporary, ledgerPath);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      fs.rmSync(ledgerPath, { force: true });
      fs.renameSync(backup, ledgerPath);
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function readProjectLearnedArtifacts(
  projectRoot: string,
  toolId: string
): Record<string, ProjectLearnedArtifactEntry> {
  return readProjectLearnedLedger(projectRoot)?.tools[toolId]?.learned ?? {};
}

export function readProjectLearnedStoreFacts(
  projectRoot: string
): Record<string, ProjectLearnedStoreFact> {
  return readProjectLearnedLedger(projectRoot)?.stores ?? {};
}

/**
 * Every Store the previous ownership record named, by PERMANENT identity.
 *
 * This is what makes "a Store named only by a previous ownership record is
 * still relevant" work: an outage in one of these defers cleanup instead of
 * deleting the files that Store previously provided.
 *
 * A version 1 record contributes nothing here rather than contributing aliases
 * — an alias cannot name a Store on a machine with two of them, and the caller
 * is told to migrate rather than handed a guess.
 */
export function collectProjectLearnedStores(
  projectRoot: string
): Array<{ type: 'store'; uid: string; id?: string }> {
  let ledger: ProjectLearnedLedger | null;
  try {
    ledger = readProjectLearnedLedger(projectRoot);
  } catch {
    return [];
  }
  if (!ledger) return [];
  const byUid = new Map<string, { type: 'store'; uid: string; id?: string }>();
  for (const [uid, fact] of Object.entries(ledger.stores)) {
    if (fact.lastMembership !== 'member' && fact.relevant !== true) continue;
    byUid.set(normalizeStoreUid(uid), {
      type: 'store',
      uid,
      ...(fact.id !== undefined ? { id: fact.id } : {}),
    });
  }
  for (const tool of Object.values(ledger.tools)) {
    for (const entry of Object.values(tool.learned)) {
      for (const source of entry.sources) {
        if (source.owner.type !== 'store') continue;
        const key = normalizeStoreUid(source.owner.uid);
        if (byUid.has(key)) continue;
        byUid.set(key, {
          type: 'store',
          uid: source.owner.uid,
          ...(source.owner.id !== undefined ? { id: source.owner.id } : {}),
        });
      }
    }
  }
  return [...byUid.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

/**
 * Atomically persists one tool plus the command-wide Store snapshot. Existing
 * tools are preserved so several adapters can share the same preflight plan,
 * and an unchanged ledger is not rewritten at all.
 */
export function persistProjectLearnedArtifacts(
  projectRoot: string,
  toolId: string,
  learned: Record<string, ProjectLearnedArtifactEntry>,
  stores: Record<string, ProjectLearnedStoreFact>
): void {
  const current = readProjectLearnedLedger(projectRoot);
  const before = current ? JSON.stringify(current) : undefined;
  const ledger = current ?? emptyLedger();
  ledger.stores = Object.fromEntries(
    Object.entries(stores).sort(([left], [right]) => left.localeCompare(right))
  );
  if (Object.keys(learned).length > 0) {
    ledger.tools[toolId] = {
      learned: Object.fromEntries(
        Object.entries(learned).sort(([left], [right]) => left.localeCompare(right))
      ),
    };
  } else {
    delete ledger.tools[toolId];
  }
  if (before === JSON.stringify(ledger)) return;
  writeProjectLearnedLedger(projectRoot, ledger);
}

// -----------------------------------------------------------------------------
// Version 1 → version 2 migration
// -----------------------------------------------------------------------------

/** One display name the migration had to map onto a permanent identity. */
export interface LedgerAliasMapping {
  alias: string;
  /** The permanent identity, when exactly one Store carrying one matched. */
  uid?: string;
  /** Why it could not be mapped, when it could not. */
  problem?: 'ambiguous' | 'unknown' | 'no-identity';
  /** Every matching Store, so an ambiguity report can name them. */
  candidates: Array<{ uid?: string; root: string }>;
}

export interface ProjectLearnedLedgerMigration {
  status: 'nothing-to-do' | 'ready' | 'applied' | 'blocked';
  dryRun: boolean;
  ledgerPath: string;
  /** Every alias the version 1 record named, with what it maps to. */
  mappings: LedgerAliasMapping[];
  /** Aliases that stopped the upgrade. Nothing is written while any exist. */
  blocking: LedgerAliasMapping[];
  /** Ownership entries the upgrade covers, by tool. */
  entries: Array<{ toolId: string; id: string }>;
  diagnostics: Array<{ code: string; message: string; repair?: string[] }>;
}

/**
 * Maps every display name a version 1 record used onto a permanent identity.
 *
 * The registry is ENUMERATED and filtered here rather than looked up by name:
 * a by-name lookup returns one Store and hides the fact that two matched,
 * which is exactly the ambiguity this migration must refuse.
 */
async function mapLedgerAliases(
  aliases: readonly string[],
  options: StorePathOptions
): Promise<LedgerAliasMapping[]> {
  const registry = await readStoreRegistryState(options);
  const entries = registry
    ? listStoreRegistryEntries(registry).filter((entry) => entry.type === 'store')
    : [];
  return aliases.map((alias) => {
    const matches = entries.filter((entry) => entry.id === alias);
    const candidates = matches.map((entry) => ({
      ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
      root: entry.backend.local_path,
    }));
    if (matches.length === 0) return { alias, problem: 'unknown' as const, candidates };
    if (matches.length > 1) return { alias, problem: 'ambiguous' as const, candidates };
    const uid = matches[0]!.uid;
    return uid === undefined
      ? { alias, problem: 'no-identity' as const, candidates }
      : { alias, uid, candidates };
  });
}

function legacyAliases(legacy: LegacyProjectLearnedLedger): string[] {
  const aliases = new Set<string>(Object.keys(legacy.stores));
  for (const tool of Object.values(legacy.tools)) {
    for (const entry of Object.values(tool.learned)) {
      for (const source of entry.sources) {
        if (source.owner.type === 'store') aliases.add(source.owner.id);
      }
    }
  }
  return [...aliases].sort();
}

function blockingDiagnostic(mapping: LedgerAliasMapping): {
  code: string;
  message: string;
  repair: string[];
} {
  switch (mapping.problem) {
    case 'ambiguous':
      return {
        code: 'store_alias_ambiguous',
        message: `The ownership record names store "${mapping.alias}", which matches ${mapping.candidates.length} registered stores on this machine; it cannot say which one owns the generated files.`,
        repair: ['rasen store list'],
      };
    case 'no-identity':
      return {
        code: 'learned_owner_legacy_alias',
        message: `Store "${mapping.alias}" has no permanent identity yet, so ownership recorded against it cannot be re-keyed.`,
        repair: [`rasen store upgrade-identity ${mapping.alias}`],
      };
    default:
      return {
        code: 'store_project_record_missing',
        message: `The ownership record names store "${mapping.alias}", which is not registered on this machine; its recorded provenance cannot be re-keyed and is not being dropped.`,
        repair: ['rasen store list', 'rasen bootstrap'],
      };
  }
}

/**
 * Detects, previews, or applies the version 1 → version 2 upgrade.
 *
 * `dryRun` writes nothing at all; an applied run writes only when EVERY alias
 * mapped, so a blocked migration never leaves a half-upgraded record naming
 * some sources durably and others by a name.
 */
export async function migrateProjectLearnedLedger(
  projectRoot: string,
  options: StorePathOptions & { dryRun?: boolean } = {}
): Promise<ProjectLearnedLedgerMigration> {
  const { dryRun = false, ...pathOptions } = options;
  const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
  const legacy = readLegacyProjectLearnedLedger(projectRoot);
  if (!legacy) {
    return {
      status: 'nothing-to-do',
      dryRun,
      ledgerPath,
      mappings: [],
      blocking: [],
      entries: [],
      diagnostics: [],
    };
  }

  const mappings = await mapLedgerAliases(legacyAliases(legacy), pathOptions);
  const blocking = mappings.filter((mapping) => mapping.problem !== undefined);
  const entries = Object.entries(legacy.tools).flatMap(([toolId, tool]) =>
    Object.keys(tool.learned).map((id) => ({ toolId, id }))
  );

  if (blocking.length > 0) {
    return {
      status: 'blocked',
      dryRun,
      ledgerPath,
      mappings,
      blocking,
      entries,
      diagnostics: blocking.map(blockingDiagnostic),
    };
  }

  const uidByAlias = new Map(mappings.map((mapping) => [mapping.alias, mapping.uid as string]));
  const upgraded: ProjectLearnedLedger = {
    version: PROJECT_LEARNED_LEDGER_VERSION,
    stores: Object.fromEntries(
      Object.entries(legacy.stores)
        .map(([alias, fact]) => [
          uidByAlias.get(alias) as string,
          {
            lastMembership: fact.lastMembership,
            ...(fact.relevant !== undefined ? { relevant: fact.relevant } : {}),
            id: alias,
          },
        ])
        .sort(([left], [right]) => (left as string).localeCompare(right as string))
    ),
    tools: {},
  };
  for (const [toolId, tool] of Object.entries(legacy.tools)) {
    const learned: Record<string, ProjectLearnedArtifactEntry> = {};
    for (const [id, entry] of Object.entries(tool.learned)) {
      learned[id] = {
        effectiveScope: entry.effectiveScope,
        sources: entry.sources.map((source) => ({
          owner:
            source.owner.type === 'store'
              ? { type: 'store' as const, uid: uidByAlias.get(source.owner.id) as string, id: source.owner.id }
              : source.owner.type === 'project'
                ? { type: 'project' as const, projectId: source.owner.id }
                : { type: 'global' as const },
          id: source.id,
        })),
        canonicalContentDigest: entry.canonicalContentDigest,
        // Carried forward AS VERSION 1 on purpose. The identity scheme has
        // changed, and the next reconciliation must be able to report that
        // rewrite as a migration rather than as content the user edited.
        resolutionDigest: entry.resolutionDigest,
        resolutionSchemaVersion: PROJECT_LEARNED_LEDGER_V1_VERSION,
        file: entry.file,
      };
    }
    upgraded.tools[toolId] = { learned };
  }

  if (dryRun) {
    return {
      status: 'ready',
      dryRun: true,
      ledgerPath,
      mappings,
      blocking: [],
      entries,
      diagnostics: [],
    };
  }

  writeProjectLearnedLedger(projectRoot, upgraded);
  return {
    status: 'applied',
    dryRun: false,
    ledgerPath,
    mappings,
    blocking: [],
    entries,
    diagnostics: [],
  };
}
