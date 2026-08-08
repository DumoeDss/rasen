/**
 * Ownership evidence and the spec provenance graph (design D3 and D4).
 *
 * Ownership is a CONCLUSION drawn from auditable evidence, so absence,
 * disagreement, and shared ownership are first-class states rather than inputs
 * to a guess. Four classes, strongest first:
 *
 *   E1 recorded-identity  — the item's own `.openspec.yaml identity` / `archive.json`
 *   E2 store-records      — `adoptions.yaml` and v1 membership `adoption` lists
 *   E3 association        — machine project-home Change work directories
 *   E4 explicit-mapping   — the committed mapping file (applied by the planner)
 *
 * Nothing else is evidence. A Change-name prefix, a Git branch name, directory
 * adjacency, sibling ordering, and "the only member project whose name looks
 * similar" are excluded here, and `layout-migration-provenance.test.ts` asserts
 * the exclusion rather than trusting this comment.
 */
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { METADATA_FILENAME } from '../../../utils/change-metadata.js';
import { getProjectHomeDir } from '../../project-registry.js';
import { isProjectId } from '../planning-validation.js';
import { parseStoreProjectRecord } from '../project-records.js';
import { readAdoptionsManifest } from '../migration.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import {
  FLAT_RELATIVE,
  flatStorePaths,
  listDirectoryNames,
  listFileNames,
} from './flat-source.js';
import type { EvidenceClass, OwnershipEvidence, UnresolvedReason } from './types.js';

export const ARCHIVE_V2_RECORD_FILENAME = 'archive.json';

/** One evidence entry keyed by item class and name. */
export interface EvidenceIndex {
  /** `${kind}:${name}` → evidence, in precedence order. */
  readonly byItem: ReadonlyMap<string, readonly OwnershipEvidence[]>;
  /** Member project ids of this Store, from its membership records. */
  readonly members: readonly string[];
}

export function evidenceKey(kind: string, name: string): string {
  return `${kind}:${name}`;
}

const PRECEDENCE: Record<EvidenceClass, number> = {
  'E1-recorded-identity': 0,
  'E2-store-records': 1,
  'E3-association': 2,
  'E4-explicit-mapping': 3,
  'spec-provenance': 4,
};

function push(
  target: Map<string, OwnershipEvidence[]>,
  key: string,
  entry: OwnershipEvidence
): void {
  const list = target.get(key);
  if (list === undefined) {
    target.set(key, [entry]);
    return;
  }
  const duplicate = list.some(
    (existing) =>
      existing.class === entry.class &&
      existing.projectId === entry.projectId &&
      existing.source === entry.source
  );
  if (!duplicate) list.push(entry);
}

/** E1 — a Change's own recorded identity. Never overridden by anything. */
async function collectRecordedChangeIdentity(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  changeNames: readonly string[],
  target: Map<string, OwnershipEvidence[]>
): Promise<void> {
  const paths = flatStorePaths(storeRoot);
  for (const name of changeNames) {
    const metadataPath = path.join(paths.changes, name, METADATA_FILENAME);
    const text = await dependencies.fs.readText(metadataPath);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch {
      continue;
    }
    const identity = (parsed as { identity?: { projectId?: unknown } } | null)?.identity;
    const projectId = identity?.projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) continue;
    push(target, evidenceKey('change', name), {
      class: 'E1-recorded-identity',
      source: `${FLAT_RELATIVE.changes}/${name}/${METADATA_FILENAME}`,
      projectId,
      nature: 'derived',
      detail: 'identity.projectId recorded by the Change itself',
    });
  }
}

/** E1 — an Archive entry that already carries an Archive v2 record. */
async function collectRecordedArchiveIdentity(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  entryNames: readonly string[],
  target: Map<string, OwnershipEvidence[]>
): Promise<void> {
  const paths = flatStorePaths(storeRoot);
  for (const name of entryNames) {
    const recordPath = path.join(paths.archive, name, ARCHIVE_V2_RECORD_FILENAME);
    const text = await dependencies.fs.readText(recordPath);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const record = parsed as { schemaVersion?: unknown; projectId?: unknown } | null;
    if (record?.schemaVersion !== 2) continue;
    if (typeof record.projectId !== 'string' || record.projectId.length === 0) continue;
    push(target, evidenceKey('archive-entry', name), {
      class: 'E1-recorded-identity',
      source: `${FLAT_RELATIVE.archive}/${name}/${ARCHIVE_V2_RECORD_FILENAME}`,
      projectId: record.projectId,
      nature: 'derived',
      detail: 'projectId recorded in the Archive v2 record',
    });
  }
}

/** E2 — the legacy adoption manifest and the v1 membership records' name lists. */
async function collectStoreRecords(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  target: Map<string, OwnershipEvidence[]>
): Promise<{ members: string[]; adoptionLists: Map<string, { specs: string[]; changes: string[]; adoptedAt: string }> }> {
  const paths = flatStorePaths(storeRoot);
  const members: string[] = [];
  const adoptionLists = new Map<string, { specs: string[]; changes: string[]; adoptedAt: string }>();

  for (const fileName of await listFileNames(dependencies.fs, paths.projectRecords)) {
    if (!fileName.endsWith('.yaml')) continue;
    const recordPath = path.join(paths.projectRecords, fileName);
    const text = await dependencies.fs.readText(recordPath);
    if (text === null) continue;
    let record: ReturnType<typeof parseStoreProjectRecord>;
    try {
      record = parseStoreProjectRecord(text, recordPath);
    } catch {
      continue;
    }
    members.push(record.projectId);
    if (record.adoption === undefined) continue;
    adoptionLists.set(record.projectId, {
      specs: [...record.adoption.specs],
      changes: [...record.adoption.changes],
      adoptedAt: record.adoption.adoptedAt,
    });
    const source = `${FLAT_RELATIVE.projectRecords}/${fileName}`;
    for (const specName of record.adoption.specs) {
      push(target, evidenceKey('spec', specName), {
        class: 'E2-store-records',
        source,
        projectId: record.projectId,
        nature: 'derived',
        detail: 'adoption.specs name list',
      });
    }
    for (const changeName of record.adoption.changes) {
      push(target, evidenceKey('change', changeName), {
        class: 'E2-store-records',
        source,
        projectId: record.projectId,
        nature: 'derived',
        detail: 'adoption.changes name list',
      });
    }
  }

  const manifest = await readAdoptionsManifest(storeRoot).catch(() => null);
  for (const [projectId, entry] of Object.entries(manifest?.adoptions ?? {})) {
    for (const specName of entry.specs) {
      push(target, evidenceKey('spec', specName), {
        class: 'E2-store-records',
        source: FLAT_RELATIVE.adoptionsManifest,
        projectId,
        nature: 'derived',
        detail: 'legacy adoption manifest specs',
      });
    }
    for (const changeName of entry.changes) {
      push(target, evidenceKey('change', changeName), {
        class: 'E2-store-records',
        source: FLAT_RELATIVE.adoptionsManifest,
        projectId,
        nature: 'derived',
        detail: 'legacy adoption manifest changes',
      });
    }
  }

  members.sort();
  return { members: [...new Set(members)], adoptionLists };
}

/**
 * E3 — machine association records. A project's machine home holds one
 * `changes/<changeId>/` directory per Change it has actually worked on, which
 * is a recorded association between that Change alias and that project. A
 * record is admitted only when its project is a member of THIS Store; an
 * association naming a stranger project proves nothing about this Store's
 * content.
 */
async function collectAssociations(
  dependencies: StoreLayoutMigrationDependencies,
  globalDataDir: string | undefined,
  members: readonly string[],
  target: Map<string, OwnershipEvidence[]>
): Promise<void> {
  const memberSet = new Set(members);
  const projects = await dependencies.snapshotProjects(globalDataDir);
  for (const project of projects) {
    if (!memberSet.has(project.entry.projectId)) continue;
    const homeDir = project.entry.home;
    if (typeof homeDir !== 'string' || homeDir.length === 0) continue;
    const homeChanges = path.join(
      getProjectHomeDir(homeDir, globalDataDir === undefined ? {} : { globalDataDir }),
      'changes'
    );
    for (const changeName of await listDirectoryNames(dependencies.fs, homeChanges)) {
      push(target, evidenceKey('change', changeName), {
        class: 'E3-association',
        source: `machine-home:${homeDir}/changes/${changeName}`,
        projectId: project.entry.projectId,
        nature: 'derived',
        detail: 'machine association record for this Change alias',
      });
    }
  }
}

export interface CollectEvidenceInput {
  readonly storeRoot: string;
  readonly globalDataDir?: string;
  readonly specs: readonly string[];
  readonly changes: readonly string[];
  readonly archiveEntries: readonly string[];
}

export interface CollectedEvidence extends EvidenceIndex {
  readonly adoptionLists: ReadonlyMap<
    string,
    { readonly specs: readonly string[]; readonly changes: readonly string[]; readonly adoptedAt: string }
  >;
}

export async function collectEvidence(
  dependencies: StoreLayoutMigrationDependencies,
  input: CollectEvidenceInput
): Promise<CollectedEvidence> {
  const target = new Map<string, OwnershipEvidence[]>();
  await collectRecordedChangeIdentity(dependencies, input.storeRoot, input.changes, target);
  await collectRecordedArchiveIdentity(
    dependencies,
    input.storeRoot,
    input.archiveEntries,
    target
  );
  const { members, adoptionLists } = await collectStoreRecords(
    dependencies,
    input.storeRoot,
    target
  );
  await collectAssociations(dependencies, input.globalDataDir, members, target);

  const byItem = new Map<string, readonly OwnershipEvidence[]>();
  for (const [key, list] of target) {
    byItem.set(
      key,
      Object.freeze(
        [...list].sort(
          (left, right) =>
            PRECEDENCE[left.class] - PRECEDENCE[right.class] ||
            left.projectId.localeCompare(right.projectId) ||
            left.source.localeCompare(right.source)
        )
      )
    );
  }

  return { byItem, members, adoptionLists };
}

export interface OwnershipDecision {
  readonly owner?: string;
  readonly reason?: UnresolvedReason;
  readonly evidence: readonly OwnershipEvidence[];
  readonly superseded: readonly OwnershipEvidence[];
  readonly conflictingProjects?: readonly string[];
}

/**
 * The precedence reducer. E1 binds and is never overridden: a lower-priority
 * source that disagrees with it is recorded as superseded and reported, but
 * does not block — refusing to migrate because a stale `adoptions.yaml`
 * disagrees with the Change's own recorded identity would make correct Stores
 * unmigratable. E2 and E3 disagreeing with each other has no principled winner
 * and is `evidence-conflict`.
 */
export function reduceOwnership(
  evidence: readonly OwnershipEvidence[],
  members: readonly string[]
): OwnershipDecision {
  if (evidence.length === 0) {
    return { reason: 'unknown-owner', evidence: [], superseded: [] };
  }
  const recorded = evidence.filter((entry) => entry.class === 'E1-recorded-identity');
  if (recorded.length > 0) {
    const owners = [...new Set(recorded.map((entry) => entry.projectId))];
    if (owners.length > 1) {
      return {
        reason: 'evidence-conflict',
        evidence: recorded,
        superseded: [],
        conflictingProjects: owners,
      };
    }
    const owner = owners[0] as string;
    const superseded = evidence.filter(
      (entry) => entry.class !== 'E1-recorded-identity' && entry.projectId !== owner
    );
    return memberChecked(owner, recorded, superseded, members);
  }

  const lower = evidence.filter(
    (entry) => entry.class === 'E2-store-records' || entry.class === 'E3-association'
  );
  const owners = [...new Set(lower.map((entry) => entry.projectId))];
  if (owners.length === 0) {
    return { reason: 'unknown-owner', evidence: [], superseded: [] };
  }
  if (owners.length > 1) {
    return {
      reason: 'evidence-conflict',
      evidence: lower,
      superseded: [],
      conflictingProjects: owners.slice().sort(),
    };
  }
  return memberChecked(owners[0] as string, lower, [], members);
}

function memberChecked(
  owner: string,
  evidence: readonly OwnershipEvidence[],
  superseded: readonly OwnershipEvidence[],
  members: readonly string[]
): OwnershipDecision {
  if (!isProjectId(owner)) {
    return { reason: 'unrecordable-identity', evidence, superseded, owner };
  }
  if (!members.includes(owner)) {
    return { reason: 'non-member-owner', evidence, superseded, owner };
  }
  return { owner, evidence, superseded };
}

// -----------------------------------------------------------------------------
// Spec provenance graph (design D4)
// -----------------------------------------------------------------------------

export interface CapabilityProvenance {
  readonly capability: string;
  /** Distinct resolved contributing projects, sorted. */
  readonly contributors: readonly string[];
  /** True when at least one contributing Change is itself unresolved. */
  readonly hasUnknownContributor: boolean;
  readonly edges: readonly { readonly from: string; readonly owner?: string }[];
}

export interface BuildProvenanceInput {
  readonly storeRoot: string;
  readonly changes: readonly string[];
  readonly archiveEntries: readonly string[];
  /** Resolved owner per `change:<name>` / `archive-entry:<name>` key, if any. */
  readonly ownerByKey: ReadonlyMap<string, string | undefined>;
}

/**
 * A flat canonical spec cannot be attributed from the Change that happens to
 * sit next to it, so ownership comes from a bipartite graph over every active
 * and archived Change delta. An unresolved contributor propagates as `unknown`
 * rather than dropping out — otherwise one unresolved Change could make a
 * genuinely shared capability look single-owner.
 */
export async function buildSpecProvenance(
  dependencies: StoreLayoutMigrationDependencies,
  input: BuildProvenanceInput
): Promise<ReadonlyMap<string, CapabilityProvenance>> {
  const paths = flatStorePaths(input.storeRoot);
  const graph = new Map<
    string,
    { contributors: Set<string>; unknown: boolean; edges: { from: string; owner?: string }[] }
  >();

  const addEdges = async (
    itemKind: 'change' | 'archive-entry',
    name: string,
    deltaSpecsDir: string
  ): Promise<void> => {
    const capabilities = await listDirectoryNames(dependencies.fs, deltaSpecsDir);
    if (capabilities.length === 0) return;
    const owner = input.ownerByKey.get(evidenceKey(itemKind, name));
    for (const capability of capabilities) {
      const node = graph.get(capability) ?? {
        contributors: new Set<string>(),
        unknown: false,
        edges: [],
      };
      if (owner === undefined) {
        node.unknown = true;
        node.edges.push({ from: `${itemKind}:${name}` });
      } else {
        node.contributors.add(owner);
        node.edges.push({ from: `${itemKind}:${name}`, owner });
      }
      graph.set(capability, node);
    }
  };

  for (const name of input.changes) {
    await addEdges('change', name, path.join(paths.changes, name, 'specs'));
  }
  for (const name of input.archiveEntries) {
    await addEdges('archive-entry', name, path.join(paths.archive, name, 'specs'));
  }

  const result = new Map<string, CapabilityProvenance>();
  for (const [capability, node] of graph) {
    result.set(
      capability,
      Object.freeze({
        capability,
        contributors: Object.freeze([...node.contributors].sort()),
        hasUnknownContributor: node.unknown,
        edges: Object.freeze(
          node.edges.slice().sort((left, right) => left.from.localeCompare(right.from))
        ),
      })
    );
  }
  return result;
}
