/**
 * The single membership provider (design D4/D5/D6).
 *
 * Every surface that asks "which projects belong to this Store?" or "which
 * Stores does this project belong to?" gets its answer here, in one shape that
 * carries its own provenance. Current per-project records and the two legacy
 * shapes — a Store's `references: [project:<alias>]` index and its
 * `adoptions.yaml` map — normalize into that one shape, so a caller never has
 * to know which era a Store's data comes from.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **Reading writes nothing.** Not a directory, not a registry repair, not a
 *    minted identity. A read of a Store carrying only legacy data leaves every
 *    file byte-identical.
 * 2. **An unavailable Store is not an empty one.** A declared Store that is not
 *    on this machine comes back marked unavailable, with child A's reason and
 *    repair, and is never filtered out — a consumer must not be able to read
 *    "absent from the answer" as "not a member".
 *
 * The Store is always reached through child A's `resolveStoreBinding()`.
 * Enumerating every registered Store stays legitimate (the ban is on by-id
 * LOOKUP, which silently picks one of two Stores sharing a display name), and
 * enumeration here goes through the registry's own reader rather than the
 * compat one.
 */
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import {
  PROJECT_REFERENCE_PREFIX,
  appendStoreMembershipHint,
  readProjectConfig,
  storeMembershipHintKey,
  type StoreMembershipHint,
} from '../project-config.js';
import { StoreError, type StoreDiagnostic } from './errors.js';
import {
  listStoreRegistryEntries,
  readStoreRegistryState,
  type StorePathOptions,
  type StoreRegistryEntry,
} from './foundation.js';
import { gitHeadCommit } from './git.js';
import {
  primaryRepair,
  resolveStoreBinding,
  type StoreBindingResolution,
  type StoreUnavailableReason,
} from './identity.js';
import {
  projectMembershipLocatorMissing,
  projectMembershipUnverified,
  sharedMetadataContainsLocalPath,
  storeLegacyReferenceUnresolved,
  storeMembershipLegacyManifest,
  storeMembershipRolesInferred,
  storeProjectRecordMissing,
  type MembershipStoreLabel,
} from './identity-diagnostics.js';
import type { ResolvedStoreRef } from './identity-types.js';
import { inspectRegisteredStore } from './inspection.js';
import {
  getAdoptionsManifestPath,
  readAdoptionsManifest,
  renderSuggestedCommit,
  type AdoptionEntry,
  type SuggestedGitCommand,
} from './migration.js';
import {
  assertRecordableProjectIdentity,
  listStoreProjectRecords,
  mergeStoreProjectRoles,
  normalizeProjectIdentity,
  projectIdentityDiagnostic,
  readStoreProjectRecord,
  writeStoreProjectRecord,
  type StoreProjectRecord,
  type StoreProjectRecordAdoption,
  type StoreProjectRoles,
} from './project-records.js';
import { assertCredentialFreeRemote } from './remote.js';

// -----------------------------------------------------------------------------
// Provider shape
// -----------------------------------------------------------------------------

export type MembershipProvenance = 'v2-record' | 'legacy-reference' | 'legacy-adoption';

export interface StoreMembershipRecord {
  /** The Store's permanent identity; absent only for a legacy-identity Store. */
  storeUid?: string;
  /** Display alias of the Store, as resolved. */
  storeId: string;
  projectId: string;
  /** The project's display name, when the source knew one. */
  id?: string;
  /** Credential-free clone source for the project. */
  remote?: string;
  /** Store-root-relative portable bundle locator from a version-1 record. */
  knowledgeBundle?: string;
  roles: StoreProjectRoles;
  /** Which source answered — one entry per project, never two. */
  provenance: MembershipProvenance;
  /** Ownership recorded by `store adopt`; never carries a path. */
  adoption?: StoreProjectRecordAdoption;
  diagnostics: StoreDiagnostic[];
}

export interface StoreMembershipListing {
  members: StoreMembershipRecord[];
  /** Findings about the Store's membership data as a whole. */
  diagnostics: StoreDiagnostic[];
}

// -----------------------------------------------------------------------------
// Selectors that actually work when pasted
// -----------------------------------------------------------------------------

/**
 * A value that names this Store unambiguously on THIS machine: the permanent
 * identity when the display name matches more than one registered Store (or
 * when there is no display name), the display name otherwise.
 *
 * Printed repairs go through here. A hint that fails when pasted is worse than
 * no hint, and the arity is only knowable at print time.
 */
export function unambiguousStoreSelector(
  store: { uid?: string; id?: string },
  entries: readonly StoreRegistryEntry[]
): string {
  if (store.id === undefined) return store.uid ?? '<store>';
  const namesakes = entries.filter(
    (entry) => entry.type === 'store' && entry.id === store.id
  ).length;
  if (namesakes > 1 && store.uid !== undefined) return store.uid;
  return store.id;
}

/** The Store label every membership repair renders, with its safe selector. */
export function membershipStoreLabel(
  store: { uid?: string; id?: string },
  entries: readonly StoreRegistryEntry[]
): MembershipStoreLabel {
  return {
    ...(store.uid !== undefined ? { uid: store.uid } : {}),
    ...(store.id !== undefined ? { id: store.id } : {}),
    selector: unambiguousStoreSelector(store, entries),
  };
}

async function readStoreEntries(
  options: StorePathOptions
): Promise<StoreRegistryEntry[]> {
  const registry = await readStoreRegistryState(options);
  return registry ? listStoreRegistryEntries(registry) : [];
}

// -----------------------------------------------------------------------------
// Legacy normalization
// -----------------------------------------------------------------------------

/**
 * Maps a Store's `references: [project:<alias>]` entries onto project
 * identities through the machine's project namespace.
 *
 * Machine-local BY NATURE: the alias only means something where the project is
 * registered, so a fresh clone of the Store resolves none of them. That is not
 * a defect to work around — it is the exact gap the migration exists to close,
 * and each unresolvable alias is REPORTED rather than dropped or guessed at.
 */
async function normalizeLegacyReferences(
  storeRoot: string,
  label: MembershipStoreLabel,
  entries: readonly StoreRegistryEntry[]
): Promise<{
  byProjectId: Map<string, { alias: string; remote?: string }>;
  diagnostics: StoreDiagnostic[];
}> {
  const byProjectId = new Map<string, { alias: string; remote?: string }>();
  const diagnostics: StoreDiagnostic[] = [];

  const references = (readProjectConfig(storeRoot)?.references ?? []).filter(
    (entry) => entry.type === 'project'
  );

  for (const reference of references) {
    const registered = entries.find(
      (entry) => entry.type === 'project' && entry.id === reference.id
    );
    const projectRoot = registered?.backend.local_path;
    const projectId = projectRoot ? readProjectConfig(projectRoot)?.projectId : undefined;

    if (!projectId) {
      diagnostics.push(storeLegacyReferenceUnresolved({ alias: reference.id, store: label }));
      continue;
    }

    const normalized = normalizeProjectIdentity(projectId);
    if (!byProjectId.has(normalized)) {
      byProjectId.set(normalized, {
        alias: reference.id,
        ...(reference.remote !== undefined ? { remote: reference.remote } : {}),
      });
    }
  }

  return { byProjectId, diagnostics };
}

/** Legacy adoption entries, keyed by projectId. Never reads `sourcePath`. */
async function readLegacyAdoptions(
  storeRoot: string
): Promise<{ byProjectId: Map<string, AdoptionEntry>; present: boolean }> {
  let manifest: Awaited<ReturnType<typeof readAdoptionsManifest>> = null;
  try {
    manifest = await readAdoptionsManifest(storeRoot);
  } catch {
    // A corrupt legacy manifest is reported by `store doctor`'s own drift
    // checks; membership degrades to "no legacy adoptions" rather than making
    // every roster read fail on a file this change is retiring anyway.
    return { byProjectId: new Map(), present: true };
  }

  const byProjectId = new Map<string, AdoptionEntry>();
  for (const [projectId, entry] of Object.entries(manifest?.adoptions ?? {})) {
    byProjectId.set(normalizeProjectIdentity(projectId), entry);
  }
  return { byProjectId, present: manifest !== null };
}

/** Human phrase naming which legacy sources contributed a set of roles. */
function describeLegacySources(fromAdoption: boolean, fromReference: boolean): string {
  if (fromAdoption && fromReference) {
    return 'legacy adoption data and a legacy project reference';
  }
  return fromAdoption ? 'legacy adoption data' : 'a legacy project reference';
}

// -----------------------------------------------------------------------------
// listStoreMembers
// -----------------------------------------------------------------------------

/**
 * Every project this Store records as a member, from current records and
 * legacy data alike, one entry per project identity.
 *
 * Precedence: a current record wins outright. When no record exists, the
 * legacy sources answer together — an adoption proves PLANNING membership, a
 * referenced-project entry proves KNOWLEDGE membership (that is what the
 * reference does: it indexes the project's specs into the Store's
 * instructions), and the reported roles say they were inferred. Provenance
 * names the source that supplied the entry's details, so it never has to
 * pretend one source said something the other did.
 */
export async function listStoreMembers(
  store: ResolvedStoreRef,
  options: StorePathOptions = {}
): Promise<StoreMembershipListing> {
  const entries = await readStoreEntries(options);
  const label = membershipStoreLabel(store, entries);

  const listing = await listStoreProjectRecords(store.root);
  const diagnostics: StoreDiagnostic[] = [...listing.diagnostics];

  const members: StoreMembershipRecord[] = listing.records.map((record) =>
    fromStoreProjectRecord(store, record)
  );
  const seen = new Set(members.map((member) => member.projectId));

  const [references, adoptions] = await Promise.all([
    normalizeLegacyReferences(store.root, label, entries),
    readLegacyAdoptions(store.root),
  ]);
  diagnostics.push(...references.diagnostics);

  if (adoptions.present) {
    diagnostics.push(
      storeMembershipLegacyManifest({
        manifestPath: getAdoptionsManifestPath(store.root),
        storeSelector: label.selector,
      })
    );
  }

  const legacyProjectIds = new Set([
    ...adoptions.byProjectId.keys(),
    ...references.byProjectId.keys(),
  ]);

  for (const projectId of [...legacyProjectIds].sort()) {
    if (seen.has(projectId)) continue;
    const adoption = adoptions.byProjectId.get(projectId);
    const reference = references.byProjectId.get(projectId);

    const roles: StoreProjectRoles = {
      planning: adoption !== undefined,
      knowledge: reference !== undefined,
    };
    const inferred = storeMembershipRolesInferred({
      projectId,
      provenance: describeLegacySources(adoption !== undefined, reference !== undefined),
      storeSelector: label.selector,
    });
    const memberDiagnostics: StoreDiagnostic[] = [inferred];

    if (adoption?.sourcePath !== undefined) {
      memberDiagnostics.push(
        sharedMetadataContainsLocalPath({
          filePath: getAdoptionsManifestPath(store.root),
          detail: `the adoption of project ${projectId} recorded sourcePath`,
          storeSelector: label.selector,
        })
      );
    }

    members.push({
      ...(store.uid !== undefined ? { storeUid: store.uid } : {}),
      storeId: store.id,
      projectId,
      ...(reference?.alias !== undefined ? { id: reference.alias } : {}),
      ...(reference?.remote !== undefined ? { remote: reference.remote } : {}),
      roles,
      provenance: adoption !== undefined ? 'legacy-adoption' : 'legacy-reference',
      ...(adoption !== undefined
        ? {
            adoption: {
              specs: [...adoption.specs],
              changes: [...adoption.changes],
              adoptedAt: adoption.timestamp,
            },
          }
        : {}),
      diagnostics: memberDiagnostics,
    });
    seen.add(projectId);
  }

  members.sort((left, right) => left.projectId.localeCompare(right.projectId));
  return { members, diagnostics };
}

function fromStoreProjectRecord(
  store: ResolvedStoreRef,
  record: StoreProjectRecord
): StoreMembershipRecord {
  return {
    ...(store.uid !== undefined ? { storeUid: store.uid } : {}),
    storeId: store.id,
    projectId: record.projectId,
    ...(record.id !== undefined ? { id: record.id } : {}),
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
    ...(record.knowledgeBundle !== undefined
      ? { knowledgeBundle: record.knowledgeBundle }
      : {}),
    roles: { ...record.roles },
    provenance: 'v2-record',
    ...(record.adoption !== undefined ? { adoption: { ...record.adoption } } : {}),
    diagnostics: [],
  };
}

/**
 * This Store's membership answer for ONE project, or null when it records
 * none. Same precedence and the same normalization as `listStoreMembers` — it
 * is the same answer, narrowed, never a second implementation of it.
 */
export async function resolveProjectMembership(
  store: ResolvedStoreRef,
  projectId: string,
  options: StorePathOptions = {}
): Promise<StoreMembershipRecord | null> {
  const normalized = normalizeProjectIdentity(projectId);
  const direct = await readStoreProjectRecord(store.root, normalized).catch(() => null);
  if (direct?.record) {
    return { ...fromStoreProjectRecord(store, direct.record), diagnostics: direct.diagnostics };
  }

  const listing = await listStoreMembers(store, options);
  return listing.members.find((member) => member.projectId === normalized) ?? null;
}

// -----------------------------------------------------------------------------
// Eligibility union (design D5)
// -----------------------------------------------------------------------------

export interface ProjectStoreCandidate {
  /** Discovery sources, in a stable order: a hint, a local record, or both. */
  sources: Array<'hint' | 'record'>;
  uid?: string;
  id?: string;
  remote?: string;
  /** The Store, when it is available on this machine. */
  store?: ResolvedStoreRef;
  /** The Store's own record for this project, when it could be read. */
  membership?: StoreMembershipRecord;
  /** Set when a declared Store cannot be used here — NEVER filtered out. */
  unavailable?: { reason: StoreUnavailableReason; repair: string[] };
  diagnostics: StoreDiagnostic[];
}

export interface ProjectStoreCandidateListing {
  projectId: string | undefined;
  candidates: ProjectStoreCandidate[];
  diagnostics: StoreDiagnostic[];
}

/**
 * The identity key this listing de-duplicates on: the resolved root when the
 * Store is here (two declarations naming one checkout are one Store), else the
 * permanent identity, else the display alias.
 *
 * Exported for `store/bootstrap.ts`, which merges the project's own planning
 * declaration — not part of this listing — into the same set. Merging on a
 * second key rule would let a hint and the pointer naming one Store appear
 * twice, so there is exactly one rule and both callers use it.
 */
export function projectStoreCandidateKey(candidate: {
  uid?: string;
  id?: string;
  store?: ResolvedStoreRef;
}): string {
  if (candidate.store) {
    return `root:${FileSystemUtils.toPosixPath(candidate.store.root).toLowerCase()}`;
  }
  if (candidate.uid) return `uid:${candidate.uid.trim().toLowerCase()}`;
  return `id:${(candidate.id ?? '').trim().toLowerCase()}`;
}

/**
 * The Stores this project is eligible to draw on: every Store it declares a
 * hint for, UNION every locally available Store whose records include it.
 *
 * A hint pointing at a Store that is not here does not shrink the answer to
 * what happens to be local — it comes back marked unavailable so a consumer
 * can defer rather than treat the Store as empty. A locally recorded member
 * with no hint is eligible too, with a diagnostic saying discovery would fail
 * on another machine.
 */
export async function listProjectStoreCandidates(
  projectRoot: string,
  options: StorePathOptions = {}
): Promise<ProjectStoreCandidateListing> {
  const config = readProjectConfig(projectRoot);
  const projectId = config?.projectId;
  const hints = config?.storeMemberships ?? [];
  const entries = await readStoreEntries(options);
  const storeEntries = entries.filter((entry) => entry.type === 'store');

  const byKey = new Map<string, ProjectStoreCandidate>();
  const diagnostics: StoreDiagnostic[] = [];

  for (const hint of hints) {
    const binding = await resolveHint(hint, options);
    const candidate: ProjectStoreCandidate = {
      sources: ['hint'],
      ...(hint.uid !== undefined ? { uid: hint.uid } : {}),
      ...(hint.id !== undefined ? { id: hint.id } : {}),
      ...(hint.remote !== undefined ? { remote: hint.remote } : {}),
      diagnostics: [],
    };

    if (binding.kind === 'resolved') {
      candidate.store = binding.store;
      candidate.uid = binding.store.uid ?? candidate.uid;
      candidate.id = binding.store.id;
      if (projectId !== undefined) {
        const membership = await resolveProjectMembership(binding.store, projectId, options);
        if (membership) candidate.membership = membership;
      }
    } else if (binding.kind === 'unavailable') {
      candidate.unavailable = { reason: binding.reason, repair: binding.repair };
      candidate.diagnostics.push(
        projectMembershipUnverified({
          store: {
            ...(hint.uid !== undefined ? { uid: hint.uid } : {}),
            ...(hint.id !== undefined ? { id: hint.id } : {}),
          },
          repair: primaryRepair(binding),
        })
      );
      candidate.diagnostics.push(...binding.diagnostics);
    }

    byKey.set(projectStoreCandidateKey(candidate), candidate);
  }

  if (projectId !== undefined) {
    for (const entry of storeEntries) {
      const inspection = await inspectRegisteredStore(entry.id, entry.backend.local_path);
      if (inspection.kind !== 'ok') continue;

      const store: ResolvedStoreRef = {
        type: 'store',
        id: entry.id,
        root: inspection.canonicalRoot,
        ...(inspection.uid !== undefined ? { uid: inspection.uid } : {}),
      };
      const membership = await resolveProjectMembership(store, projectId, options);
      if (!membership) continue;

      const key = projectStoreCandidateKey({ store });
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes('record')) existing.sources.push('record');
        existing.membership = membership;
        continue;
      }

      byKey.set(key, {
        sources: ['record'],
        ...(store.uid !== undefined ? { uid: store.uid } : {}),
        id: store.id,
        store,
        membership,
        diagnostics: [
          projectMembershipLocatorMissing({
            projectId,
            store: membershipStoreLabel(store, entries),
            projectPath: projectRoot,
          }),
        ],
      });
    }
  }

  const candidates = [...byKey.values()].sort((left, right) =>
    (left.id ?? left.uid ?? '').localeCompare(right.id ?? right.uid ?? '')
  );

  return {
    projectId,
    candidates,
    diagnostics,
  };
}

async function resolveHint(
  hint: StoreMembershipHint,
  options: StorePathOptions
): Promise<StoreBindingResolution> {
  // No `projectRoot`: the no-transitivity rule is about a project's OWN
  // planning declaration. A Store's checkout can still be a member of another
  // Store, and passing the root here would silently answer `absent` for every
  // hint such a project declares.
  if (hint.uid !== undefined) {
    return resolveStoreBinding({
      declaration: {
        form: 'durable',
        uid: hint.uid,
        ...(hint.id !== undefined ? { id: hint.id } : {}),
        ...(hint.remote !== undefined ? { remote: hint.remote } : {}),
      },
      ...options,
    });
  }
  if (hint.id !== undefined) {
    return resolveStoreBinding({ declaration: { form: 'alias', id: hint.id }, ...options });
  }
  return { kind: 'absent' };
}

// -----------------------------------------------------------------------------
// Two-repository mutation (design D6)
// -----------------------------------------------------------------------------

export interface MembershipRepair {
  code: string;
  message: string;
  /** A command the user can paste to finish the job. */
  repair: string;
}

export interface MembershipMutationPlan {
  projectRoot: string;
  storeRoot: string;
  /** The commit each repository sat on when the plan was made; null when not a repo. */
  projectBaseCommit: string | null;
  storeBaseCommit: string | null;
  /** Absolute paths this mutation would write, per repository. */
  projectWrites: string[];
  storeWrites: string[];
  repairNeeded: MembershipRepair[];
}

export interface MembershipMutationInput extends StorePathOptions {
  projectRoot: string;
  projectId: string;
  /** The project's display name, recorded for reading only. */
  projectDisplayId?: string;
  /** Credential-free clone source for the project. */
  projectRemote?: string;
  store: ResolvedStoreRef;
  /** Credential-free clone source for the Store, written into the hint. */
  storeRemote?: string;
  roles: StoreProjectRoles;
  adoption?: StoreProjectRecordAdoption;
}

export interface MembershipMutationResult extends MembershipMutationPlan {
  applied: boolean;
  /** True when this run changed the Store's record. */
  storeRecordWritten: boolean;
  /** True when this run changed the project's hint list. */
  projectHintWritten: boolean;
  suggestedCommits: SuggestedGitCommand[];
}

/** The hint a mutation records for a Store: identity, alias, remote. Nothing else. */
export function membershipHintFor(
  store: ResolvedStoreRef,
  remote?: string
): StoreMembershipHint {
  return {
    ...(store.uid !== undefined ? { uid: store.uid } : {}),
    id: store.id,
    ...(remote !== undefined ? { remote } : {}),
  };
}

async function readBaseCommits(
  projectRoot: string,
  storeRoot: string
): Promise<{ projectBaseCommit: string | null; storeBaseCommit: string | null }> {
  const [projectBaseCommit, storeBaseCommit] = await Promise.all([
    gitHeadCommit(projectRoot),
    gitHeadCommit(storeRoot),
  ]);
  return { projectBaseCommit, storeBaseCommit };
}

/**
 * What the mutation would write in each repository, and what would still need
 * repair — computed without touching either. A non-git root reports a null
 * base commit and DEGRADES; it never blocks the mutation, because plenty of
 * legitimate projects are not repositories.
 */
export async function planMembershipMutation(
  input: MembershipMutationInput
): Promise<MembershipMutationPlan> {
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const projectId = assertRecordableProjectIdentity(input.projectId);
  const base = await readBaseCommits(input.projectRoot, input.store.root);

  const existing = await readStoreProjectRecord(input.store.root, projectId);
  const nextRecord = composeRecord(existing.record, projectId, input);
  const storeWrites =
    existing.record && recordsEqual(existing.record, nextRecord) ? [] : [existing.filePath];

  const hint = membershipHintFor(input.store, input.storeRemote);
  const config = readProjectConfig(input.projectRoot);
  const key = storeMembershipHintKey(hint);
  const match = (config?.storeMemberships ?? []).find(
    (entry) => storeMembershipHintKey(entry) === key
  );
  const hintUpToDate =
    match !== undefined &&
    (hint.uid === undefined || match.uid === hint.uid) &&
    (hint.id === undefined || match.id === hint.id) &&
    (hint.remote === undefined || match.remote === hint.remote);

  const configPath = path.join(input.projectRoot, 'rasen', 'config.yaml');
  const projectWrites = hintUpToDate ? [] : [configPath];

  const repairNeeded: MembershipRepair[] = [];
  const entries = await readStoreEntries(pathOptions);
  if (config === null) {
    repairNeeded.push(locatorRepair(input, entries));
  }

  return {
    projectRoot: input.projectRoot,
    storeRoot: input.store.root,
    ...base,
    projectWrites,
    storeWrites,
    repairNeeded,
  };
}

function locatorRepair(
  input: MembershipMutationInput,
  entries: readonly StoreRegistryEntry[]
): MembershipRepair {
  const diagnostic = projectMembershipLocatorMissing({
    projectId: normalizeProjectIdentity(input.projectId),
    store: membershipStoreLabel(input.store, entries),
    projectPath: input.projectRoot,
  });
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    repair: diagnostic.fix ?? 'rasen doctor',
  };
}

function composeRecord(
  existing: StoreProjectRecord | null,
  projectId: string,
  input: MembershipMutationInput
): StoreProjectRecord {
  const id = input.projectDisplayId ?? existing?.id;
  const remote = input.projectRemote ?? existing?.remote;
  const knowledgeBundle = existing?.knowledgeBundle;
  const adoption = input.adoption ?? existing?.adoption;

  return {
    version: 1,
    projectId,
    ...(id !== undefined ? { id } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(knowledgeBundle !== undefined ? { knowledgeBundle } : {}),
    roles: mergeStoreProjectRoles(existing?.roles, input.roles),
    ...(adoption !== undefined ? { adoption } : {}),
  };
}

function recordsEqual(left: StoreProjectRecord, right: StoreProjectRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Writes the Store's authority record and verifies it by reading it back.
 *
 * Identity is validated and the remote is checked BEFORE anything is written,
 * so a refused mutation leaves no partial state — the same order child A's
 * registration uses.
 */
export async function writeMembershipRecord(
  input: MembershipMutationInput
): Promise<{ record: StoreProjectRecord; filePath: string; changed: boolean }> {
  const projectId = assertRecordableProjectIdentity(input.projectId);
  assertCredentialFreeRemote(input.projectRemote, 'store.metadata');

  const existing = await readStoreProjectRecord(input.store.root, projectId);
  const next = composeRecord(existing.record, projectId, input);

  if (existing.record && recordsEqual(existing.record, next)) {
    return { record: existing.record, filePath: existing.filePath, changed: false };
  }

  const filePath = await writeStoreProjectRecord(input.store.root, next);

  // Verified by re-reading, not inferred from the absence of an error: the
  // project hint is written only once the authority record is provably on
  // disk and readable.
  const verified = await readStoreProjectRecord(input.store.root, projectId);
  if (!verified.record || !recordsEqual(verified.record, next)) {
    throw new StoreError(
      `The membership record for project ${projectId} did not read back as written (${filePath}).`,
      'store_project_record_unverified',
      {
        target: 'store.membership',
        fix: `Inspect ${filePath} and rerun.`,
      }
    );
  }

  return { record: verified.record, filePath, changed: true };
}

/** Writes the project's locator hint. Errors propagate for the caller to record. */
export async function writeMembershipLocator(
  projectRoot: string,
  hint: StoreMembershipHint
): Promise<{ configPath: string; changed: boolean }> {
  assertCredentialFreeRemote(hint.remote, 'store.pointer');
  const result = await appendStoreMembershipHint(projectRoot, hint);
  return { configPath: result.configPath, changed: result.changed };
}

/**
 * The ordered two-repository apply (design D6): verify identities and base
 * commits, write the Store's authority record, verify it, write the project's
 * locator hint, verify both directions.
 *
 * The two repositories cannot change atomically and this does not pretend
 * otherwise. When the project-side write fails, the Store record STANDS — it
 * is legitimate on its own — and the missing hint is reported as repair work
 * with the command that completes it. Nothing is rolled back: deleting a valid
 * authority record to tidy up a locator destroys the more important of the two,
 * and a crash during the "rollback" would not be atomic either.
 *
 * Rasen never stages, commits, pushes, fetches, or pulls. It renders a
 * path-scoped commit suggestion per repository for the user to run.
 */
export async function applyMembershipMutation(
  input: MembershipMutationInput
): Promise<MembershipMutationResult> {
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const plan = await planMembershipMutation(input);
  const entries = await readStoreEntries(pathOptions);

  // Re-checked immediately before the first write, so a repository that moved
  // between planning and applying fails HERE — with nothing written yet —
  // rather than recording membership against a state the plan never saw.
  const current = await readBaseCommits(input.projectRoot, input.store.root);
  assertUnmovedBase('project', input.projectRoot, plan.projectBaseCommit, current.projectBaseCommit);
  assertUnmovedBase('store', input.store.root, plan.storeBaseCommit, current.storeBaseCommit);

  const repairNeeded: MembershipRepair[] = [];
  const written = await writeMembershipRecord(input);

  let projectHintWritten = false;
  const hint = membershipHintFor(input.store, input.storeRemote);
  try {
    const locator = await writeMembershipLocator(input.projectRoot, hint);
    projectHintWritten = locator.changed;
  } catch {
    repairNeeded.push(locatorRepair(input, entries));
  }

  // Verify both directions: the Store records the project, and the project
  // locates the Store. A hint that did not land is repair work, not a rollback.
  if (repairNeeded.length === 0) {
    const config = readProjectConfig(input.projectRoot);
    const key = storeMembershipHintKey(hint);
    const present = (config?.storeMemberships ?? []).some(
      (entry) => storeMembershipHintKey(entry) === key
    );
    if (!present) repairNeeded.push(locatorRepair(input, entries));
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const storeCommit = renderSuggestedCommit(
    input.store.root,
    [path.relative(input.store.root, written.filePath) || written.filePath],
    `chore: record ${input.projectDisplayId ?? plan.projectRoot} as a member`,
    'Store repo: record the membership authority record.'
  );
  if (storeCommit) suggestedCommits.push(storeCommit);
  const projectCommit = renderSuggestedCommit(
    input.projectRoot,
    [path.join('rasen', 'config.yaml')],
    `chore: record membership of store ${input.store.id}`,
    'Project repo: record the membership locator hint.'
  );
  if (projectCommit) suggestedCommits.push(projectCommit);

  return {
    ...plan,
    projectBaseCommit: current.projectBaseCommit,
    storeBaseCommit: current.storeBaseCommit,
    applied: true,
    storeRecordWritten: written.changed,
    projectHintWritten,
    repairNeeded,
    suggestedCommits,
  };
}

function assertUnmovedBase(
  label: 'project' | 'store',
  root: string,
  planned: string | null,
  current: string | null
): void {
  if (planned === current) return;
  throw new StoreError(
    `The ${label} repository at ${root} moved from ${planned ?? '(no commit)'} to ${current ?? '(no commit)'} while membership was being prepared; nothing was written.`,
    'membership_base_commit_moved',
    {
      target: 'store.membership',
      fix: 'Rerun the command so membership is recorded against the current state.',
    }
  );
}

// -----------------------------------------------------------------------------
// Doctor-facing composition
// -----------------------------------------------------------------------------

export interface ProjectMembershipHealthInput extends StorePathOptions {
  projectRoot: string;
  /** The project's planning Store, when it resolved. */
  planningStore?: ResolvedStoreRef;
}

export interface ProjectMembershipHealth {
  projectId?: string;
  candidates: ProjectStoreCandidate[];
  diagnostics: StoreDiagnostic[];
}

/**
 * Read-only membership findings for one project: the primary planning Store
 * missing a record (an error — planning is already bound to it), a recorded
 * membership with no project-side hint (a warning — it breaks on the next
 * machine), a hint whose Store is not here (a warning — unknown, not "no"),
 * and an unrecordable project identity.
 *
 * Contacts no network, repairs nothing, writes nothing.
 */
export async function inspectProjectMembership(
  input: ProjectMembershipHealthInput
): Promise<ProjectMembershipHealth> {
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const listing = await listProjectStoreCandidates(input.projectRoot, pathOptions);
  const diagnostics: StoreDiagnostic[] = [...listing.diagnostics];

  // An identity that cannot name a record file will never acquire one, so the
  // honest report is "this project cannot be recorded", not "it belongs to no
  // store". Reported here as well as refused at the write path, because doctor
  // is where a user goes to find out why a command will not work.
  if (listing.projectId !== undefined) {
    const unrecordable = projectIdentityDiagnostic(listing.projectId);
    if (unrecordable) diagnostics.push(unrecordable);
  }

  for (const candidate of listing.candidates) {
    diagnostics.push(...candidate.diagnostics);
    for (const member of candidate.membership?.diagnostics ?? []) {
      diagnostics.push(member);
    }
  }

  if (input.planningStore && listing.projectId !== undefined) {
    const entries = await readStoreEntries(pathOptions);
    const planningRoot = projectStoreCandidateKey({ store: input.planningStore });
    const planningCandidate = listing.candidates.find(
      (candidate) => candidate.store && projectStoreCandidateKey({ store: candidate.store }) === planningRoot
    );
    if (!planningCandidate?.membership) {
      diagnostics.push(
        storeProjectRecordMissing({
          projectId: listing.projectId,
          store: membershipStoreLabel(input.planningStore, entries),
          projectPath: input.projectRoot,
        })
      );
    }
  }

  return {
    ...(listing.projectId !== undefined ? { projectId: listing.projectId } : {}),
    candidates: listing.candidates,
    diagnostics,
  };
}

/** The legacy `project:<alias>` prefix, re-exported so callers share one constant. */
export { PROJECT_REFERENCE_PREFIX };
