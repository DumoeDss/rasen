/**
 * The bootstrap report: what this machine still needs before a project works,
 * and (in apply mode) the actions that close the gap.
 *
 * `check` and `preview` are read-only: nothing here creates a directory, writes
 * a file, registers anything, mints an identity, or spawns a process in either
 * of those modes. `apply` acts: it registers checkouts, registers and obtains
 * Stores, prepares knowledge directories, and writes durable declarations. The
 * obtain step (E3) is the first that retrieves from the network — it clones
 * from a remote to the previewed location and is governed by the
 * provable-creation cleanup guard (design D5) so a failed retrieval never
 * deletes a directory this run did not create.
 *
 * Check mode additionally contacts NO network: the remote seam is not reachable
 * from it at all (`unreachableRemoteResolver` throws if the check path ever
 * reaches for it), so the promise is mechanical rather than a convention.
 *
 * The state machine COMPOSES the landed surfaces rather than shadowing them:
 * `listProjectStoreCandidates` already unions membership hints with locally
 * recorded members and marks unresolvable Stores without dropping them, and
 * `listStoreMembers` already answers "which projects does this Store record?".
 * Two things are genuinely new and live here:
 *
 * 1. The project's own planning `store:` declaration is NOT part of the
 *    candidate listing, so it is resolved separately and merged in on the same
 *    identity key the listing de-duplicates on.
 * 2. `StoreUnavailableReason` is a *why-resolution-failed* vocabulary and the
 *    report's classes are a *what-to-do-about-it* vocabulary. In particular
 *    `not-registered` does not say whether the Store is on this disk but
 *    unregistered or nowhere on this machine — that distinction is derived
 *    here, from a supplied location plus the declaration's recorded remote.
 *
 * Repairs are consumed from the landed `UnavailableStoreBinding.repair` rather
 * than re-coined, and every command this module emits names a selector that
 * resolves unambiguously on THIS machine — the arity is only knowable at the
 * moment of printing, which is exactly when this module knows it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { folderStyleNameProblem, toKebabCase } from '../id.js';
import {
  hasStoreDeclaration,
  readProjectConfig,
  readStorePointer,
  resolveConfigFilePath,
  storePointerProblem,
  type StorePointerRead,
} from '../project-config.js';
import { resolveProjectKnowledgeHome } from '../project-knowledge-home.js';
import { registerProject } from '../project-registry.js';
import { WORKSPACE_DIR_NAME } from '../config.js';
import { StoreError, type StoreDiagnostic } from './errors.js';
import {
  getLegacyStoreMetadataDir,
  getStoreMetadataDir,
  getStoreMetadataPath,
  getStoreRegistryPath,
  listStoreRegistryEntries,
  readOptionalStoreMetadataState,
  readStoreRegistryState,
  storeMetadataUid,
  type StorePathOptions,
  type StoreRegistryEntry,
} from './foundation.js';
import {
  resolveStoreBinding,
  type StoreBindingDeclaration,
  type StoreBindingResolution,
  type StoreUnavailableReason,
} from './identity.js';
import { storeProjectRecordMissing, storeUidMismatch } from './identity-diagnostics.js';
import { storeUidsMatch, type ResolvedStoreRef } from './identity-types.js';
import { inspectRegisteredStore } from './inspection.js';
import { registerExistingStore } from './operations.js';
import { cloneRepository } from './git.js';
import {
  listProjectStoreCandidates,
  listStoreMembers,
  projectStoreCandidateKey,
  resolveProjectMembership,
  unambiguousStoreSelector,
  type ProjectStoreCandidate,
  type StoreMembershipRecord,
} from './membership.js';
import {
  normalizeProjectIdentity,
  readStoreProjectRecord,
  WINDOWS_RESERVED_DEVICE_NAMES,
} from './project-records.js';
import { redactOptionalRemote } from './remote.js';
import { writeDurablePointer } from './upgrade-identity.js';

// -----------------------------------------------------------------------------
// Report shape
// -----------------------------------------------------------------------------

/**
 * The three modes. `check` and `preview` are read-only — two different promises,
 * each with its own assertion. `apply` acts: it registers the current checkout,
 * registers present-unregistered Stores the user names a location for, obtains
 * declared Stores that are absent with a recorded remote (cloning from the
 * remote to the previewed location), prepares the knowledge location, and
 * writes the durable declaration when the trigger fires. `check` contacts no
 * network and creates nothing; `preview` resolves remotes and target paths but
 * creates no directory; `apply` clones and registers, governed by the
 * provable-creation cleanup guard (design D5).
 */
export type BootstrapMode = 'check' | 'preview' | 'apply';

/** The one state a report ends in. */
export type BootstrapEndState = 'complete' | 'degraded' | 'blocked';

/** Which checkout bootstrap was run from. */
export type BootstrapOrigin = 'project' | 'store';

/**
 * What to do about an expected Store, which is a different question from why
 * resolution failed. The first four are the classification a user acts on; the
 * fifth is the arm where the answer is neither "here and usable" nor "not here"
 * — the Store cannot be resolved or read at all, and the report is blocked.
 */
export type BootstrapStoreClass =
  | 'verified'
  | 'present-unregistered'
  | 'absent-with-remote'
  | 'absent-without-remote'
  | 'unresolvable';

/** Why a Store is expected: the planning declaration, a hint, a local record. */
export type BootstrapStoreSource = 'planning' | 'hint' | 'record';

/**
 * One repair. `command` is pasteable as-is; `manual` carries an instruction the
 * landed resolver produced that is not a command; `supply-path` is the one
 * repair the resolver has no reason to produce, because only bootstrap knows a
 * location was never supplied. Prose for the non-command arms is rendered by
 * the command layer — this module emits facts, never English sentences.
 *
 * `mutates` is declared at the CONSTRUCTION SITE, not inferred from a prefix
 * list: a state-changing command cannot be added without stating that it
 * writes, because TypeScript makes the omission a compile error. The field
 * governs BOTH command channels — `repair[]` and any command surfaced from a
 * `diagnostic.fix` — so the "no mutating repair on an unknown" rule is total
 * rather than list-maintained (design D3).
 */
export type BootstrapRepair =
  | { kind: 'command'; command: string; mutates: boolean }
  | { kind: 'manual'; instruction: string }
  | { kind: 'supply-path' };

/**
 * The Store's own record of this project. `unverifiable-here` is never
 * collapsed into `not-recorded`: an unreachable Store's roster is UNKNOWN, and
 * saying "not a member" would tell a user their project was ejected from a
 * Store that simply is not on this machine.
 */
export type BootstrapMembershipState = 'confirmed' | 'not-recorded' | 'unverifiable-here';

export interface BootstrapMembership {
  state: BootstrapMembershipState;
  /**
   * What would record the membership (`not-recorded`) or what would make it
   * verifiable here (`unverifiable-here`). Empty when confirmed.
   */
  repair: BootstrapRepair[];
}

/** Which rule produced a previewed location. */
export type BootstrapLocationSource = 'supplied-path' | 'parent-and-derived-name';

/**
 * Why a chosen location would not be used. `unreadable` is separate from
 * `not-empty` because a permission-denied EMPTY directory refused as "it
 * already has contents" sends the user hunting for contents that do not exist.
 * The refusal is identical; only the stated reason differs, and the reason is
 * what this change delivers.
 */
export type BootstrapLocationRefusal = 'not-empty' | 'existing-checkout' | 'unreadable';

/** Why no location could be chosen. */
export type BootstrapLocationDemand = 'no-location-supplied' | 'no-safe-name';

/**
 * A previewed location. `required` names NO candidate — a location is demanded
 * rather than invented, and a path recorded by another machine never reaches
 * this type at all (see `selectBootstrapLocation`).
 */
export type BootstrapLocation =
  | { kind: 'usable'; path: string; source: BootstrapLocationSource }
  | {
      kind: 'refused';
      path: string;
      source: BootstrapLocationSource;
      because: BootstrapLocationRefusal;
    }
  | { kind: 'required'; because: BootstrapLocationDemand };

/**
 * What bootstrap did for a Store during apply. Additive — check and preview
 * leave `action` unset. JSON distinguishes "did nothing because it was already
 * right" (`already-registered`) from "did nothing because it failed" (no entry
 * at all, or a diagnostic).
 */
export type BootstrapStoreAction =
  /** Bootstrap registered it this run. */
  | 'registered'
  /** Bootstrap cloned and registered it this run. */
  | 'obtained'
  /** It was already in the registry before this run; bootstrap wrote nothing. */
  | 'already-registered'
  /** The user declined consent for an action bootstrap would have done. */
  | 'declined'
  /** The clone failed; the cleanup guard ran and the failure is reported. */
  | 'obtain-failed'
  /** Not an action target — verified, absent, or unresolvable. */
  | 'not-acted';

export interface BootstrapStoreEntry {
  /** The identity key the candidate listing de-duplicates on. */
  key: string;
  sources: BootstrapStoreSource[];
  uid?: string;
  id?: string;
  /** The recorded clone source, redacted. */
  remote?: string;
  /** Canonical root, when the Store is available or was found at a location. */
  root?: string;
  /** Names this Store unambiguously on this machine, for printed commands. */
  selector: string;
  class: BootstrapStoreClass;
  /** The landed why-resolution-failed reason, when it did not resolve. */
  reason?: StoreUnavailableReason;
  membership: BootstrapMembership;
  repair: BootstrapRepair[];
  /** Preview mode only: where this Store would be placed. */
  location?: BootstrapLocation;
  diagnostics: StoreDiagnostic[];
  /** Apply mode only: what bootstrap did for this Store. */
  action?: BootstrapStoreAction;
  /** Apply mode only: the Store was already registered before this run. */
  alreadyRegistered?: boolean;
}

/**
 * Whether a project the Store records is here, obtainable, neither — or not
 * determinable, because a registered project's own identity could not be read
 * and so this machine cannot say whether it already holds this project.
 */
export type BootstrapProjectPresence =
  | 'present'
  | 'obtainable'
  | 'unlocatable'
  | 'unknown';

export interface BootstrapProjectEntry {
  projectId: string;
  id?: string;
  /** The recorded clone source, redacted. */
  remote?: string;
  presence: BootstrapProjectPresence;
  /** Canonical root, when the project is already on this machine. */
  root?: string;
  /** Preview mode only: where this project would be placed. */
  location?: BootstrapLocation;
  diagnostics: StoreDiagnostic[];
  /** Apply mode only: what bootstrap did for this project. */
  action?: BootstrapProjectAction;
}

/**
 * What bootstrap did for a project the Store records, during Store-first apply.
 * Additive — check and preview leave `action` unset.
 */
export type BootstrapProjectAction =
  /** Bootstrap cloned and registered it this run. */
  | 'obtained'
  /** The user did not select this project; bootstrap obtained nothing for it. */
  | 'not-selected'
  /** The clone failed; the cleanup guard ran and the failure is reported. */
  | 'obtain-failed'
  /** The project is already on this machine; no action taken. */
  | 'already-present';

/** A finding that blocks the report rather than degrading it. */
export type BootstrapProblemKind =
  | 'declaration-malformed'
  | 'store-identity-mismatch'
  | 'project-identity-missing'
  | 'not-a-store-checkout'
  /**
   * State this machine keeps — the Store registry, a Store's own identity file
   * — exists but cannot be read. This is the case the report exists to name:
   * the spec's `blocked` is "something cannot be resolved or read at all", and
   * a machine whose registry is corrupt is exactly that. It is reported, never
   * thrown: a diagnosis command that crashes on the broken machine it was run
   * to diagnose has inverted its own promise.
   */
  | 'unreadable-state';

export interface BootstrapProblem {
  kind: BootstrapProblemKind;
  /** The file or directory the problem is about, when there is one. */
  path?: string;
  reason?: StoreUnavailableReason;
  repair: BootstrapRepair[];
  diagnostics: StoreDiagnostic[];
}

export interface BootstrapProjectContext {
  root: string;
  projectId?: string;
  /** True when the project declares a planning Store in either form. */
  declaresStore: boolean;
  /** The config file the declaration was read from. */
  declarationPath?: string;
}

export interface BootstrapStoreContext {
  root: string;
  uid?: string;
  id: string;
  registered: boolean;
}

/** Knowledge location preparation result (apply mode only). */
export interface BootstrapKnowledgePreparation {
  root: string;
  catalogDir: string;
  /** True when the directories already existed and were empty before this run. */
  alreadyHydrated: boolean;
}

/** Durable declaration outcome (apply mode only). */
export interface BootstrapDeclarationResult {
  outcome:
    | 'written'
    | 'already-durable'
    | 'nameless-store'
    | 'not-triggered';
  /** The config file path written, when a write occurred. */
  path?: string;
}

export interface BootstrapReport {
  mode: BootstrapMode;
  origin: BootstrapOrigin;
  state: BootstrapEndState;
  /** Present for the project-first flow. */
  project?: BootstrapProjectContext;
  /** Present for the Store-first flow. */
  store?: BootstrapStoreContext;
  /** Project-first: every expected Store. Empty for the Store-first flow. */
  stores: BootstrapStoreEntry[];
  /** Store-first: every project the Store records. Empty otherwise. */
  projects: BootstrapProjectEntry[];
  problems: BootstrapProblem[];
  diagnostics: StoreDiagnostic[];
  /** Apply mode only: knowledge location preparation. */
  knowledge?: BootstrapKnowledgePreparation;
  /** Apply mode only: durable declaration outcome. */
  declaration?: BootstrapDeclarationResult;
}

// -----------------------------------------------------------------------------
// Repairs
// -----------------------------------------------------------------------------

/**
 * The landed repair list, classified rather than re-coined. A repair that
 * begins with a program name is pasteable; the resolver also produces prose
 * instructions ("Register the checkout that carries…"), and calling one of
 * those a command would be the exact defect this change exists to avoid.
 *
 * Every command consumed here defaults to `mutates: true` — the conservative
 * read, because the landed resolver's commands are almost all state-changing
 * (register, upgrade-identity, clone). The safe direction is "block unless
 * proven read-only," not "allow unless proven mutating." Bootstrap's OWN
 * repairs, constructed at sites that know what they do, set `mutates` to the
 * value the site knows.
 */
export function bootstrapRepairsFrom(repair: readonly string[]): BootstrapRepair[] {
  return repair
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      /^(?:rasen|git)\s/u.test(entry)
        ? ({ kind: 'command', command: entry, mutates: true } as const)
        : ({ kind: 'manual', instruction: entry } as const)
    );
}

/**
 * Replaces a whole-token occurrence of an ambiguous display name with the
 * selector that resolves here. Whole-token, never a substring: a display name
 * is frequently a substring of a path, and rewriting inside one would produce a
 * command that no longer names the file the user has.
 */
function withUnambiguousSelector(command: string, id: string, selector: string): string {
  if (id === selector) return command;
  return command
    .split(' ')
    .map((token) => (token === id ? selector : token))
    .join(' ');
}

/** Every printed command names a selector that resolves on this machine. */
function disambiguateRepairs(
  repairs: readonly BootstrapRepair[],
  id: string | undefined,
  selector: string
): BootstrapRepair[] {
  if (id === undefined || id === selector) return [...repairs];
  return repairs.map((repair) =>
    repair.kind === 'command'
      ? {
          kind: 'command',
          command: withUnambiguousSelector(repair.command, id, selector),
          mutates: repair.mutates,
        }
      : repair
  );
}

// -----------------------------------------------------------------------------
// Location selection (the sole source of a previewed location)
// -----------------------------------------------------------------------------

const RESERVED_DEVICE_NAMES = new Set(WINDOWS_RESERVED_DEVICE_NAMES);

/**
 * The last meaningful segment of a clone source, for both URL and scp-style
 * remotes. `.git` is stripped because a directory named `repo.git` is a bare
 * clone's name, not a working tree's.
 */
function remoteBasename(remote: string): string {
  const withoutQuery = remote.split(/[?#]/u)[0] ?? '';
  const segments = withoutQuery.split(/[/\\:]/u).filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1] ?? '';
  return last.replace(/\.git$/iu, '');
}

/**
 * A basename that is safe on every platform, or null when none can be derived.
 *
 * Reuses the EXISTING rules rather than writing a second set: `toKebabCase` is
 * the repo's normalizer (its output cannot contain a separator or a traversal
 * segment), `folderStyleNameProblem` is the folder-safe-name grammar, and
 * `WINDOWS_RESERVED_DEVICE_NAMES` is the device list child B already enforces
 * on every platform.
 */
export function deriveSafeLocationName(source: {
  remote?: string;
  id?: string;
}): string | null {
  const raw = source.remote !== undefined ? remoteBasename(source.remote) : source.id;
  if (raw === undefined) return null;

  const candidate = toKebabCase(raw);
  if (candidate.length === 0) return null;
  if (folderStyleNameProblem(candidate, 'a derived directory name') !== null) return null;
  if (RESERVED_DEVICE_NAMES.has(candidate)) return null;
  return candidate;
}

export interface BootstrapLocationInputs {
  /** A path supplied explicitly FOR THIS target. Wins outright. */
  suppliedPath?: string;
  /** A parent directory a safe derived name is placed under. */
  parentDirectory?: string;
  /** What a derived name is derived from. */
  nameSource: { remote?: string; id?: string };
}

/**
 * A canonical absolute path, so a drive-letter or separator difference is not a
 * different location. `canonicalizeExistingPath` already falls back to
 * `path.resolve` for a path that does not exist yet, which is the ordinary case
 * for a location nothing has been placed at.
 */
function canonicalLocation(target: string): string {
  return FileSystemUtils.canonicalizeExistingPath(path.resolve(target));
}

/**
 * True when this directory already holds a checkout of anything. The legacy
 * Store metadata directory counts: a legacy-only checkout would otherwise be
 * refused as merely "not empty", which describes the same refusal with the
 * wrong reason — and the reason is what this change delivers.
 */
function holdsCheckout(target: string): boolean {
  return (
    fs.existsSync(path.join(target, '.git')) ||
    fs.existsSync(getStoreMetadataDir(target)) ||
    fs.existsSync(getLegacyStoreMetadataDir(target))
  );
}

/**
 * THE selection function: the only source of a previewed location, anywhere.
 * Priority is stated once here — an explicitly supplied path, else a supplied
 * parent plus a safe derived name, else a location is demanded rather than
 * invented.
 *
 * It takes no recorded path, by construction: a path another machine wrote
 * cannot influence an answer it is never given.
 */
export function selectBootstrapLocation(inputs: BootstrapLocationInputs): BootstrapLocation {
  if (inputs.suppliedPath !== undefined && inputs.suppliedPath.trim().length > 0) {
    return inspectChosenLocation(canonicalLocation(inputs.suppliedPath), 'supplied-path');
  }

  if (inputs.parentDirectory !== undefined && inputs.parentDirectory.trim().length > 0) {
    const name = deriveSafeLocationName(inputs.nameSource);
    if (name === null) return { kind: 'required', because: 'no-safe-name' };
    return inspectChosenLocation(
      canonicalLocation(path.join(inputs.parentDirectory, name)),
      'parent-and-derived-name'
    );
  }

  return { kind: 'required', because: 'no-location-supplied' };
}

function inspectChosenLocation(
  target: string,
  source: BootstrapLocationSource
): BootstrapLocation {
  if (!fs.existsSync(target)) return { kind: 'usable', path: target, source };
  if (holdsCheckout(target)) {
    return { kind: 'refused', path: target, source, because: 'existing-checkout' };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(target);
  } catch {
    // Refusing is the safe answer either way — but "it already has contents"
    // would be a false statement about a directory that may be empty and
    // merely unreadable, and would send the user looking for files that are
    // not there.
    return { kind: 'refused', path: target, source, because: 'unreadable' };
  }

  return entries.length === 0
    ? { kind: 'usable', path: target, source }
    : { kind: 'refused', path: target, source, because: 'not-empty' };
}

// -----------------------------------------------------------------------------
// The remote seam (preview only)
// -----------------------------------------------------------------------------

export interface BootstrapRemoteRequest {
  uid?: string;
  id?: string;
  /** The remote the declaration or the Store's own metadata records. */
  remote?: string;
}

export interface BootstrapResolvedRemote {
  /** The clone source that would be used, redacted for display. */
  remote: string;
}

/**
 * Where preview mode is permitted to reach beyond local information. Injectable
 * so "check mode contacts no remote" is asserted AT THE SEAM rather than by
 * reading the output — and so a future reachability probe has one place to go.
 */
export interface BootstrapRemoteResolver {
  resolve(request: BootstrapRemoteRequest): Promise<BootstrapResolvedRemote | null>;
}

/**
 * The default preview resolver: it works out WHICH clone source would be used
 * and redacts it. It contacts nothing — this change runs no version-control
 * operation and spawns no process on any path.
 */
export const declaredRemoteResolver: BootstrapRemoteResolver = {
  async resolve(request) {
    const redacted = redactOptionalRemote(request.remote);
    return redacted === undefined ? null : { remote: redacted };
  },
};

/**
 * Check mode's resolver. Reaching it is an invariant violation rather than a
 * user-facing failure, so it throws rather than returning a message: check mode
 * must not so much as decide which remote it would use.
 */
const unreachableRemoteResolver: BootstrapRemoteResolver = {
  resolve() {
    throw new Error('bootstrap check mode must not resolve a remote');
  },
};

// -----------------------------------------------------------------------------
// Classification (pure, over already-read data)
// -----------------------------------------------------------------------------

export interface StoreClassificationInput {
  /** How the declaration resolved on this machine. */
  resolution: { kind: 'resolved' } | { kind: 'unavailable'; reason: StoreUnavailableReason };
  /**
   * The canonical root of a Store checkout found at a SUPPLIED location that
   * carries the expected identity, when there is one. This is the fact the
   * landed tri-state cannot supply: `not-registered` says nothing about whether
   * the Store is on this disk.
   */
  presentAt?: string;
  /**
   * The supplied location holds something whose Store identity cannot be read.
   * Neither "here" nor "not here" — reporting it as absent would print a clone
   * command over a directory that may hold the very Store being looked for.
   */
  locationUnreadable?: boolean;
  /** The remote the declaration or hint records. */
  remote?: string;
}

/**
 * The four report classes, plus the unresolvable arm. Pure: every branch is
 * testable without a filesystem fixture.
 */
export function classifyBootstrapStore(input: StoreClassificationInput): {
  class: BootstrapStoreClass;
  reason?: StoreUnavailableReason;
} {
  if (input.resolution.kind === 'resolved') return { class: 'verified' };

  const { reason } = input.resolution;
  if (reason !== 'not-registered') return { class: 'unresolvable', reason };

  if (input.presentAt !== undefined) return { class: 'present-unregistered', reason };
  if (input.locationUnreadable === true) return { class: 'unresolvable', reason };
  if (input.remote !== undefined && input.remote.trim().length > 0) {
    return { class: 'absent-with-remote', reason };
  }
  return { class: 'absent-without-remote', reason };
}

/**
 * The end state, from the per-Store classes, the membership answers, the
 * recorded projects, AND the diagnostics that were collected getting there.
 *
 * The diagnostics are not decoration. A composed reader in this repo has TWO
 * failure modes: it throws, or it degrades to a diagnostic and returns a
 * plausible-looking answer with something silently dropped. Only the first is
 * caught by a guard. So an end state computed from the returned values alone
 * will one day report `complete` over state it could not read — which is the
 * same false claim as reporting a Store absent because its record would not
 * parse. Any error-severity diagnostic therefore forbids `complete`.
 */
export function computeBootstrapEndState(input: {
  stores: ReadonlyArray<Pick<BootstrapStoreEntry, 'class' | 'membership'>>;
  projects: ReadonlyArray<Pick<BootstrapProjectEntry, 'presence'>>;
  problems: readonly unknown[];
  /**
   * REQUIRED, not optional. A call site that forgot to pass them would
   * silently lose the "never complete over unread state" rule, which is the
   * one this argument exists to enforce — so the compiler asks for it.
   */
  diagnostics: readonly StoreDiagnostic[];
}): BootstrapEndState {
  if (input.problems.length > 0) return 'blocked';
  if (input.stores.some((entry) => entry.class === 'unresolvable')) return 'blocked';

  const unread = input.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

  const missing =
    unread ||
    input.stores.some((entry) => entry.class !== 'verified') ||
    input.stores.some((entry) => entry.membership.state !== 'confirmed') ||
    input.projects.some((entry) => entry.presence !== 'present');

  return missing ? 'degraded' : 'complete';
}

/** Every diagnostic a report carries, wherever it was attached. */
export function allBootstrapDiagnostics(report: {
  stores: ReadonlyArray<Pick<BootstrapStoreEntry, 'diagnostics'>>;
  projects: ReadonlyArray<Pick<BootstrapProjectEntry, 'diagnostics'>>;
  diagnostics: readonly StoreDiagnostic[];
}): StoreDiagnostic[] {
  return [
    ...report.diagnostics,
    ...report.stores.flatMap((entry) => entry.diagnostics),
    ...report.projects.flatMap((entry) => entry.diagnostics),
  ];
}

// -----------------------------------------------------------------------------
// The membership seam
// -----------------------------------------------------------------------------

export interface BootstrapMembershipInput {
  /** The Store, when it is available here. Absent means unverifiable. */
  store?: ResolvedStoreRef;
  /** The Store's own record for this project, when it could be read. */
  record?: StoreMembershipRecord;
  /**
   * What would make an unavailable Store usable here — and therefore what
   * would make its membership verifiable. The caller passes the repairs it
   * already built for the Store itself, so the two never disagree: a report
   * naming a concrete path for the Store and a bare `<path>` placeholder for
   * its membership would read as two different repairs for one problem.
   */
  unavailableRepair?: readonly BootstrapRepair[];
  /** The project identity being asked about. */
  projectId?: string;
  /** The project checkout, for the repair that would record the membership. */
  projectRoot?: string;
  /**
   * The Store IS available, and its record for this project exists but could
   * not be read. Distinct from "no record" on purpose: a record file that
   * cannot be parsed makes membership UNKNOWN, and there is no reading of the
   * data that makes "this Store does not record the project" a true statement.
   */
  unreadableRecord?: { path: string; diagnostics: readonly StoreDiagnostic[] };
  /** The selector every printed command names this Store by. */
  selector: string;
  /** The declared display name, for the ambiguity rewrite. */
  id?: string;
}

/**
 * True when this repair carries a state-changing command. Reads the
 * construction-time `mutates` field rather than a prefix list, so the rule is
 * total: a command repair cannot exist without stating whether it writes, and
 * the filter at the unknown arms sees exactly what the construction site knew.
 *
 * The rule this enforces is "no state-changing repair on an unknown" — a
 * mutating repair may only be offered against an answer that was established.
 * The filter blocks at the unknown arms only (unverifiable membership,
 * unreadable locations); it passes the same repair through at established arms
 * (present-unregistered, absent-with-remote), because the answer it acts on
 * was verified.
 */
export function isMutatingRepair(repair: BootstrapRepair): boolean {
  return repair.kind === 'command' && repair.mutates;
}

/**
 * `confirmed | not-recorded | unverifiable-here`, in one place.
 *
 * `unverifiable-here` is the UNKNOWN answer, and it has two causes, not one:
 * the Store is not on this machine at all, or the Store is here and its record
 * for this project cannot be read. Both are unknown; neither is "not a member".
 * Collapsing either into `not-recorded` reports a definite fact bootstrap never
 * established — and, because the repair for `not-recorded` MUTATES, it would
 * ask the user to act on that invented fact.
 */
export function resolveBootstrapMembership(
  input: BootstrapMembershipInput
): BootstrapMembership {
  if (input.store === undefined || input.projectId === undefined) {
    return {
      state: 'unverifiable-here',
      repair: disambiguateRepairs(input.unavailableRepair ?? [], input.id, input.selector),
    };
  }

  if (input.record !== undefined) return { state: 'confirmed', repair: [] };

  if (input.unreadableRecord !== undefined) {
    // The repair is to make the record readable — never `add-project`, which
    // would write a second answer over one that may already be correct.
    const fixes = input.unreadableRecord.diagnostics
      .map((diagnostic) => diagnostic.fix)
      .filter((fix): fix is string => fix !== undefined);
    const repair = bootstrapRepairsFrom(
      fixes.length > 0 ? fixes : [`Repair or remove ${input.unreadableRecord.path}`]
    ).filter((entry) => !isMutatingRepair(entry));
    return { state: 'unverifiable-here', repair };
  }

  const diagnostic =
    input.projectRoot === undefined
      ? undefined
      : storeProjectRecordMissing({
          projectId: input.projectId,
          store: {
            ...(input.store.uid !== undefined ? { uid: input.store.uid } : {}),
            id: input.store.id,
            selector: input.selector,
          },
          projectPath: input.projectRoot,
        });

  return {
    state: 'not-recorded',
    repair: diagnostic?.fix === undefined ? [] : bootstrapRepairsFrom([diagnostic.fix]),
  };
}

// -----------------------------------------------------------------------------
// Reading the ground truth
// -----------------------------------------------------------------------------

/**
 * The registry, or the reason it could not be read. The failure is RETURNED
 * rather than swallowed: an unreadable registry is a reportable end state, and
 * silently substituting an empty list would make a corrupt machine look like a
 * machine with no Stores — the single most misleading answer available.
 */
async function readRegistryEntries(
  options: StorePathOptions
): Promise<{ entries: StoreRegistryEntry[]; failure?: unknown }> {
  try {
    const registry = await readStoreRegistryState(options);
    return { entries: registry ? listStoreRegistryEntries(registry) : [] };
  } catch (failure) {
    return { entries: [], failure };
  }
}

/** The diagnostic a thrown Store failure already carries, or one built from it. */
function diagnosticsFor(failure: unknown): StoreDiagnostic[] {
  if (failure instanceof StoreError) return [failure.diagnostic];
  return [
    {
      severity: 'error',
      code: 'bootstrap_state_unreadable',
      message: failure instanceof Error ? failure.message : String(failure),
      target: 'store.registry',
    },
  ];
}

/**
 * The blocking problem an unreadable piece of machine state becomes. `rasen
 * doctor` is the repair because it is the surface that reports and repairs
 * machine-local state, and it is a command that exists today.
 *
 * Constructed directly (not through `bootstrapRepairsFrom`) because this is
 * bootstrap's OWN repair at a site that knows what `rasen doctor` does: it is
 * a diagnostic command, not a registration or declaration write, so `mutates`
 * is `false`.
 */
function unreadableState(path: string, failure: unknown): BootstrapProblem {
  return {
    kind: 'unreadable-state',
    path,
    repair: [{ kind: 'command', command: 'rasen doctor', mutates: false }],
    diagnostics: diagnosticsFor(failure),
  };
}

/** The declaration side of resolution, from what is actually on disk. */
function declarationFrom(pointer: StorePointerRead): StoreBindingDeclaration {
  if (pointer.shape === 'durable' && pointer.durable) {
    return {
      form: 'durable',
      uid: pointer.durable.uid,
      ...(pointer.durable.id !== undefined ? { id: pointer.durable.id } : {}),
      ...(pointer.durable.remote !== undefined ? { remote: pointer.durable.remote } : {}),
    };
  }
  if (pointer.shape === 'alias') {
    // `hasStoreDeclaration` already proved the alias form carries a value.
    return { form: 'alias', id: pointer.value ?? '' };
  }
  if (pointer.shape === 'malformed') {
    return {
      form: 'malformed',
      problem: storePointerProblem(pointer.malformed ?? 'unparseable'),
      ...(pointer.filePath !== null ? { filePath: pointer.filePath } : {}),
    };
  }
  return { form: 'absent' };
}

/**
 * The nearest ancestor of `from` that carries a Rasen workspace directory, or
 * `from` itself. Read-only, and it stops at the filesystem root.
 */
export function findBootstrapRoot(from: string): string {
  let current = path.resolve(from);
  for (;;) {
    if (
      resolveConfigFilePath(current) !== null ||
      fs.existsSync(path.join(current, WORKSPACE_DIR_NAME))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(from);
    current = parent;
  }
}

/**
 * What a supplied location turned out to hold. Three answers, never two: a
 * bare null would make "this is not the Store" and "I could not tell whether
 * this is the Store" the same reply, and the second must never be reported as
 * the first — the printed repair for "not here" clones a second copy.
 */
type LocationProbe =
  | { kind: 'store'; root: string }
  | { kind: 'other' }
  | { kind: 'unreadable'; path: string; diagnostics: StoreDiagnostic[] };

/**
 * Whether a Store checkout carrying the expected identity is at `target`.
 * Local reads only — this is what turns `not-registered` into "present here
 * but unregistered" rather than "nowhere on this machine".
 */
async function probeStoreAtLocation(
  target: string,
  expected: { uid?: string; id?: string }
): Promise<LocationProbe> {
  if (!fs.existsSync(target)) return { kind: 'other' };

  let metadata: Awaited<ReturnType<typeof readOptionalStoreMetadataState>>;
  try {
    metadata = await readOptionalStoreMetadataState(target);
  } catch (failure) {
    // Something IS there and it claims to be a Store; its identity simply
    // cannot be read. Reporting that as "absent" would print a clone command
    // over a directory that may hold the very Store being looked for.
    const metadataPath = getStoreMetadataPath(target);
    return { kind: 'unreadable', path: metadataPath, diagnostics: diagnosticsFor(failure) };
  }
  if (!metadata) return { kind: 'other' };

  const uid = storeMetadataUid(metadata);
  if (expected.uid !== undefined) {
    return storeUidsMatch(uid, expected.uid)
      ? { kind: 'store', root: canonicalLocation(target) }
      : { kind: 'other' };
  }
  if (expected.id !== undefined) {
    return metadata.id === expected.id
      ? { kind: 'store', root: canonicalLocation(target) }
      : { kind: 'other' };
  }
  return { kind: 'other' };
}

// -----------------------------------------------------------------------------
// Project-first flow
// -----------------------------------------------------------------------------

/** A location supplied for one named target, keyed by its selector. */
export type SuppliedLocations = ReadonlyMap<string, string>;

/**
 * A structured consent request. The core module emits facts (what action, which
 * target, where); the command layer formats them into a localized prompt.
 */
export interface BootstrapConsentRequest {
  readonly action: 'register-store' | 'upgrade-declaration' | 'obtain-store';
  readonly selector: string;
  readonly path: string;
}

/**
 * Consent state for apply mode. Interactive (ask per action) by default;
 * blanket (`--yes`) confirms the Stores the project itself declares without
 * asking. A Store NOT declared by the project is never covered by blanket
 * consent and always asks.
 */
export interface BootstrapConsent {
  /** True when `--yes` was passed (blanket confirmation for project-declared Stores). */
  blanket: boolean;
  /**
   * Ask the user for confirmation. Called for non-declared Stores under `--yes`,
   * and for every Store in interactive mode. Returns true to proceed.
   */
  confirm?: (request: BootstrapConsentRequest) => Promise<boolean>;
  /**
   * Store-first interactive selection: ask which projects to obtain. Returns
   * the projectIds the user selected. NEVER called under `--yes` (the
   * never-harvest rule holds even under blanket confirmation). Called only in
   * interactive Store-first apply mode, and only for projects that are
   * obtainable (present projects are never offered).
   */
  selectProjects?: (projects: readonly BootstrapProjectSelection[]) => Promise<string[]>;
}

/**
 * What the Store-first selection callback receives for each obtainable project.
 * Enough to render a meaningful prompt without exposing internal types.
 */
export interface BootstrapProjectSelection {
  projectId: string;
  /** The display name from the Store's record, when present. */
  id?: string;
  /** The redacted clone source, when recorded. */
  remote?: string;
}

export interface BootstrapInput extends StorePathOptions {
  /** The directory bootstrap was invoked from. */
  cwd: string;
  mode: BootstrapMode;
  /** Explicit paths, keyed by the selector they were supplied for. */
  paths?: SuppliedLocations;
  /** The parent directory a derived name is placed under. */
  into?: string;
  /**
   * Preview's remote seam. Ignored in check mode, which uses a resolver that
   * throws — so a future edit cannot quietly make check mode reach out.
   */
  remotes?: BootstrapRemoteResolver;
  /** Apply mode only: consent configuration. */
  consent?: BootstrapConsent;
}

/** Every value a supplied location may be keyed by, in match order. */
function suppliedPathFor(
  paths: SuppliedLocations | undefined,
  keys: ReadonlyArray<string | undefined>
): string | undefined {
  if (!paths || paths.size === 0) return undefined;
  for (const key of keys) {
    if (key === undefined) continue;
    const hit = paths.get(key) ?? paths.get(key.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return undefined;
}

interface ExpectedStore {
  key: string;
  sources: BootstrapStoreSource[];
  uid?: string;
  id?: string;
  remote?: string;
  resolution: StoreBindingResolution;
  store?: ResolvedStoreRef;
  record?: StoreMembershipRecord;
  diagnostics: StoreDiagnostic[];
}

function expectedFromCandidate(candidate: ProjectStoreCandidate): ExpectedStore {
  const resolution: StoreBindingResolution = candidate.store
    ? {
        kind: 'resolved',
        store: candidate.store,
        pointer: { form: candidate.uid !== undefined ? 'durable' : 'alias' },
        resolvedBy: candidate.uid !== undefined ? 'uid' : 'alias',
        diagnostics: [],
      }
    : candidate.unavailable
      ? {
          kind: 'unavailable',
          expected: {
            type: 'store',
            ...(candidate.uid !== undefined ? { uid: candidate.uid } : {}),
            ...(candidate.id !== undefined ? { id: candidate.id } : {}),
          },
          reason: candidate.unavailable.reason,
          diagnostics: [],
          repair: candidate.unavailable.repair,
        }
      : { kind: 'absent' };

  return {
    key: projectStoreCandidateKey(candidate),
    sources: candidate.sources.map((source) => (source === 'hint' ? 'hint' : 'record')),
    ...(candidate.uid !== undefined ? { uid: candidate.uid } : {}),
    ...(candidate.id !== undefined ? { id: candidate.id } : {}),
    ...(candidate.remote !== undefined ? { remote: candidate.remote } : {}),
    resolution,
    ...(candidate.store !== undefined ? { store: candidate.store } : {}),
    ...(candidate.membership !== undefined ? { record: candidate.membership } : {}),
    diagnostics: candidate.diagnostics,
  };
}

// -----------------------------------------------------------------------------
// Apply path: acting on what is already local (design D5)
// -----------------------------------------------------------------------------

/**
 * Whether a consent-gated action may proceed. Blanket confirmation covers the
 * Stores the project itself declares; a non-declared Store always asks.
 * Returns false when there is no way to ask (the `confirm` callback is absent).
 */
async function confirmAction(
  request: BootstrapConsentRequest,
  declaredByProject: boolean,
  consent: BootstrapConsent | undefined
): Promise<boolean> {
  if (declaredByProject && consent?.blanket) return true;
  if (consent?.confirm) return consent.confirm(request);
  return false;
}

/**
 * Clone with the provable-creation cleanup guard (design D5). This is the ONE
 * place the data-destruction guard lives — both the Store obtain and the
 * project obtain flows route through it, so a future change to the guard
 * cannot fix one and miss the other.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, targetExistedBefore }`
 * on failure (the cleanup decision has already been executed and reported).
 * Failures are pushed to `diagnostics` by this function; the caller sets the
 * entry's action.
 */
async function cloneWithCleanupGuard(
  remote: string,
  target: string,
  diagnostics: StoreDiagnostic[]
): Promise<{ ok: true } | { ok: false; targetExistedBefore: boolean }> {
  // PROVENANCE PROOF — THE data-destruction guard's evidence. Record whether
  // the target existed BEFORE the clone attempt. This is the single piece of
  // evidence the cleanup guard consumes at clone-failure time. If the
  // directory did not exist before this run → safe to remove on failure. If
  // it pre-existed → leave untouched, always.
  const targetExistedBefore = fs.existsSync(target);

  try {
    await cloneRepository(remote, target);
    return { ok: true };
  } catch (failure) {
    // FAILED-RETRIEVAL CLEANUP — THE data-destruction guard's action.
    if (!targetExistedBefore) {
      // This run created (or attempted to create) the directory. Removing it
      // restores the pre-run state — the directory contained only the failed
      // clone attempt.
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch (cleanupFailure) {
        diagnostics.push(...diagnosticsFor(cleanupFailure));
      }
    }
    // If `targetExistedBefore` is true, leave the directory exactly as it is.
    // A half-corrupted clone in a pre-existing directory is the user's to
    // diagnose, not bootstrap's to "fix" by deleting.
    diagnostics.push(...diagnosticsFor(failure));
    if (targetExistedBefore) {
      diagnostics.push({
        severity: 'warning',
        code: 'bootstrap_obtain_target_preserved',
        message: `The directory at ${target} pre-existed and was left untouched. Inspect it manually before retrying.`,
        target: 'store.root',
      });
    }
    return { ok: false, targetExistedBefore };
  }
}

/**
 * THE obtain step (design D3, D5). Clones a declared Store from its remote,
 * registers the checkout, and governs failed-retrieval cleanup by a
 * provable-creation guard. The cleanup proof (`fs.existsSync` recorded BEFORE
 * the clone) and the cleanup decision are in THIS function — the proof does
 * not cross a module boundary where a future change could consume it without
 * establishing it.
 *
 * Returns the outcome, mutates `entry` in place (action, class, root, repair,
 * diagnostics). Never throws — failures are pushed as diagnostics so the
 * remaining steps still execute.
 */
async function obtainAbsentStore(
  entry: BootstrapStoreEntry,
  rawRemote: string,
  input: BootstrapInput,
  diagnostics: StoreDiagnostic[]
): Promise<'obtained' | 'obtain-failed' | 'declined' | 'not-acted'> {
  // Clone target enforcement (D5): call selectBootstrapLocation to choose the
  // target. This is the SAME function preview uses — E3 adds the enforcement
  // that a non-`usable` result prevents the clone.
  const suppliedPath = suppliedPathFor(input.paths, [entry.id, entry.uid, entry.selector]);
  const location = selectBootstrapLocation({
    ...(suppliedPath !== undefined ? { suppliedPath } : {}),
    ...(input.into !== undefined ? { parentDirectory: input.into } : {}),
    nameSource: {
      ...(rawRemote !== undefined ? { remote: rawRemote } : {}),
      ...(entry.id !== undefined ? { id: entry.id } : {}),
    },
  });

  if (location.kind === 'refused') {
    entry.action = 'not-acted';
    entry.diagnostics.push({
      severity: 'warning',
      code: 'bootstrap_obtain_target_refused',
      message:
        location.because === 'not-empty'
          ? `The target directory ${location.path} already has contents, so the Store was not cloned there.`
          : location.because === 'existing-checkout'
            ? `The target directory ${location.path} already holds a checkout, so the Store was not cloned there.`
            : `The target directory ${location.path} could not be read, so the Store was not cloned there.`,
      target: 'store.root',
      fix: `Choose a different location with --path <selector>=<dir> or --into <dir>.`,
    });
    return 'not-acted';
  }

  if (location.kind === 'required') {
    entry.action = 'not-acted';
    // The location demand means the user must supply a path — prepend the
    // supply-path repair so the report names what to do.
    if (!entry.repair.some((repair) => repair.kind === 'supply-path')) {
      entry.repair = [{ kind: 'supply-path' }, ...entry.repair];
    }
    return 'not-acted';
  }

  // Location is usable. Consent gate (D3): without `--yes`, each obtain asks;
  // with `--yes` (project-first), declared Stores are obtained without asking.
  const declaredByProject = entry.sources.includes('planning');
  const consentRequest: BootstrapConsentRequest = {
    action: 'obtain-store',
    selector: entry.selector,
    path: location.path,
  };
  const confirmed = await confirmAction(consentRequest, declaredByProject, input.consent);
  if (!confirmed) {
    entry.action = 'declined';
    return 'declined';
  }

  // Clone through the shared cleanup guard — the proof and the cleanup
  // decision are in `cloneWithCleanupGuard`, the single place the
  // data-destruction guard lives.
  const result = await cloneWithCleanupGuard(rawRemote, location.path, entry.diagnostics);
  if (!result.ok) {
    entry.action = 'obtain-failed';
    return 'obtain-failed';
  }

  // Clone succeeded. Register through the same path E2 uses for a
  // present-unregistered Store.
  try {
    await registerExistingStore({ path: location.path });
  } catch (failure) {
    // The clone succeeded but registration failed. The checkout IS there —
    // report the failure but do NOT remove the checkout. A valid clone is
    // data the user may want to keep, and removing it would be the exact
    // data-destruction pattern the cleanup guard exists to prevent.
    entry.action = 'obtain-failed';
    entry.diagnostics.push(...diagnosticsFor(failure));
    entry.diagnostics.push({
      severity: 'warning',
      code: 'bootstrap_obtain_clone_succeeded_register_failed',
      message: `The repository was cloned to ${location.path} but could not be registered. The checkout is intact; run 'rasen store register ${pasteablePath(location.path)}' manually.`,
      target: 'store.root',
    });
    return 'obtain-failed';
  }

  entry.action = 'obtained';
  entry.class = 'verified';
  entry.root = canonicalLocation(location.path);
  entry.repair = [];
  return 'obtained';
}

/**
 * The durable-declaration trigger (design D7). Bootstrap writes when the
 * project has a declaration that COULD be more durable — not when it has none at
 * all (that is `rasen init`'s contract).
 *
 * Returns the outcome, the path written (if any), and any drift noticed. Drift
 * is reported and NEVER corrected automatically.
 */
async function maybeUpgradeDeclaration(
  pointer: StorePointerRead,
  stores: readonly BootstrapStoreEntry[],
  consent: BootstrapConsent | undefined,
  diagnostics: StoreDiagnostic[]
): Promise<BootstrapDeclarationResult> {
  if (pointer.filePath === null) return { outcome: 'not-triggered' };

  // The planning Store, once it has resolved. Only Stores the project declared
  // (sources include 'planning') are candidates for a declaration upgrade.
  const planningStore = stores.find(
    (entry) => entry.sources.includes('planning') && entry.uid !== undefined
  );

  if (pointer.shape === 'alias') {
    // The declaration is a bare display name. If the planning Store has
    // resolved with a permanent identity AND a display name, bootstrap can
    // upgrade it to the durable object form.
    if (planningStore === undefined || planningStore.uid === undefined) {
      return { outcome: 'not-triggered' };
    }

    // The display name for the durable declaration comes from the Store's own
    // metadata (read during resolution), not from the alias string. A Store
    // whose metadata carries no display name would produce a uid-only
    // declaration that silently fails in session launch — report the
    // limitation instead. This guard is defensive: the metadata schema
    // currently requires `id`, but a future change or a hand-edited file
    // could produce a nameless Store, and bootstrap must not manufacture an
    // instance of the bug it exists to prevent.
    if (
      planningStore.id === undefined ||
      planningStore.id.trim().length === 0
    ) {
      return { outcome: 'nameless-store' };
    }

    const request: BootstrapConsentRequest = {
      action: 'upgrade-declaration',
      selector: planningStore.selector,
      path: pointer.filePath,
    };
    // The upgrade is implied by the project's own existing (alias-form)
    // declaration, so blanket consent covers it.
    const confirmed = await confirmAction(request, true, consent);
    if (!confirmed) return { outcome: 'not-triggered' };

    try {
      await writeDurablePointer(pointer.filePath, {
        uid: planningStore.uid,
        id: planningStore.id,
        ...(planningStore.remote !== undefined ? { remote: planningStore.remote } : {}),
      });
      return { outcome: 'written', path: pointer.filePath };
    } catch (failure) {
      diagnostics.push(...diagnosticsFor(failure));
      return { outcome: 'not-triggered' };
    }
  }

  if (pointer.shape === 'durable') {
    // The declaration is already in the durable form. Check for drift: a
    // display name or remote that no longer matches the Store's own metadata.
    if (
      pointer.durable !== undefined &&
      planningStore !== undefined &&
      planningStore.id !== undefined
    ) {
      const declaredName = pointer.durable.id;
      if (declaredName !== undefined && declaredName !== planningStore.id) {
        diagnostics.push({
          severity: 'warning',
          code: 'bootstrap_declaration_drift',
          message: `The durable declaration records the name '${declaredName}' but the Store's metadata carries '${planningStore.id}'. Run 'rasen store upgrade-identity' to refresh it.`,
          target: 'store.pointer.id',
        });
      }
    }
    return { outcome: 'already-durable' };
  }

  return { outcome: 'not-triggered' };
}

interface ApplyProjectFirstResult {
  knowledge?: BootstrapKnowledgePreparation;
  declaration?: BootstrapDeclarationResult;
}

/**
 * The project-first apply path (design D5). Acts on what is already local AND
 * obtains what is not: registers the current checkout, registers each
 * present-unregistered Store the user named a location for, obtains each
 * declared Store that is absent with a recorded remote, re-verifies membership
 * for newly-available Stores, prepares the knowledge location, and writes the
 * durable declaration when the trigger fires.
 *
 * Each step is individually idempotent, so an interruption at any point leaves a
 * state a rerun resumes from. A failed step is reported and does not abort the
 * whole run — the remaining steps still execute.
 */
async function applyProjectFirstActions(
  input: BootstrapInput,
  stores: BootstrapStoreEntry[],
  context: {
    projectRoot: string;
    projectId?: string;
    pointer: StorePointerRead;
    options: StorePathOptions;
    diagnostics: StoreDiagnostic[];
    /** Raw (unredacted) remotes keyed by entry key, for cloning. */
    rawRemotes: Map<string, string>;
  }
): Promise<ApplyProjectFirstResult> {
  const { projectRoot, projectId, pointer, options, diagnostics, rawRemotes } = context;
  const consent = input.consent;

  // Step 2: Register the current project checkout. Always performed in apply
  // mode — no separate consent (invoking apply IS the consent for the
  // project's own checkout). Idempotent: a path-exact match updates in place.
  if (projectId !== undefined) {
    try {
      await registerProject({ projectRoot, projectId, mode: 'in-repo' }, options);
    } catch (failure) {
      // Reported, not thrown — the remaining steps still execute.
      diagnostics.push(...diagnosticsFor(failure));
    }
  }

  // Step 3: Register each present-unregistered Store the user named a location
  // for. Consent-gated: without `--yes`, each asks; with `--yes`, the Stores
  // the project declares are confirmed without asking.
  const newlyRegistered: BootstrapStoreEntry[] = [];
  for (const entry of stores) {
    if (entry.class === 'verified') {
      entry.action = 'already-registered';
      entry.alreadyRegistered = true;
      continue;
    }
    if (entry.class !== 'present-unregistered' || entry.root === undefined) {
      entry.action = 'not-acted';
      continue;
    }

    const declaredByProject = entry.sources.includes('planning');
    const request: BootstrapConsentRequest = {
      action: 'register-store',
      selector: entry.selector,
      path: entry.root,
    };
    const confirmed = await confirmAction(request, declaredByProject, consent);
    if (!confirmed) {
      entry.action = 'declined';
      continue;
    }

    try {
      await registerExistingStore({ path: entry.root });
      entry.action = 'registered';
      entry.alreadyRegistered = false;
      // The Store is now registered — its class moves to verified, and no
      // repair is needed.
      entry.class = 'verified';
      entry.repair = [];
      newlyRegistered.push(entry);
    } catch (failure) {
      // The path no longer holds the expected Store, or the registry is
      // locked. Report the failure and continue.
      entry.action = 'not-acted';
      entry.diagnostics.push(...diagnosticsFor(failure));
    }
  }

  // Step 3.5 (E3): Obtain each absent-with-remote declared Store. After step 3,
  // Stores that were `present-unregistered` are now `verified`. The only Stores
  // still at `absent-with-remote` are the ones that need cloning from their
  // remotes. Consent-gated: without `--yes`, each obtain asks; with `--yes`
  // (project-first), declared Stores are obtained without asking. The cleanup
  // guard (design D5) lives inside `obtainAbsentStore`.
  for (const entry of stores) {
    if (entry.class !== 'absent-with-remote') continue;
    const rawRemote = rawRemotes.get(entry.key);
    if (rawRemote === undefined) continue;

    const outcome = await obtainAbsentStore(entry, rawRemote, input, diagnostics);
    if (outcome === 'obtained') {
      // The Store was cloned and registered — its records are now readable for
      // the first time. Add it to the membership re-verification list.
      newlyRegistered.push(entry);
    }
  }

  // Step 4: Re-verify membership for newly-available Stores. The Store's records
  // are now readable, so the answer moves from unverifiable-here to confirmed or
  // not-recorded. It is NEVER left as unverifiable when the Store is now
  // available — that would freeze a stale unknown over an answer bootstrap just
  // established.
  for (const entry of newlyRegistered) {
    if (projectId === undefined || entry.root === undefined) continue;
    const store: ResolvedStoreRef = {
      type: 'store',
      id: entry.id ?? entry.selector,
      root: entry.root,
      ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
    };
    try {
      const unreadable = await readUnreadableRecord(store, projectId);
      if (unreadable) {
        // The Store's records STILL fail to parse after registration — the
        // unknown is real, not stale. Membership stays unverifiable-here.
        entry.diagnostics.push(...unreadable.diagnostics);
      } else {
        const record = await resolveProjectMembership(store, projectId, options);
        entry.membership =
          record !== null
          ? { state: 'confirmed', repair: [] }
          : resolveBootstrapMembership({
              store,
              projectId,
              projectRoot,
              selector: entry.selector,
              ...(entry.id !== undefined ? { id: entry.id } : {}),
            });
      }
    } catch (failure) {
      // Membership re-verification failed after registration. The end-state
      // computation will degrade rather than claim complete, but the user
      // deserves to know WHY membership stayed unverifiable — push the
      // diagnostic so the failure mode is reported, matching every other
      // composed reader in the apply path.
      diagnostics.push(...diagnosticsFor(failure));
    }
  }

  // Step 5: Prepare the knowledge location as empty base directories. Invent
  // no content (no placeholder files, no README, no default catalog entries).
  // The portable bundle import is a SEPARATE step (F4) — bootstrap does not
  // perform it.
  let knowledge: BootstrapKnowledgePreparation | undefined;
  if (projectId !== undefined) {
    try {
      const home = resolveProjectKnowledgeHome(projectId, options);
      const rootExisted = fs.existsSync(home.root);
      const catalogExisted = fs.existsSync(home.catalogDir);
      fs.mkdirSync(home.root, { recursive: true });
      fs.mkdirSync(home.catalogDir, { recursive: true });
      knowledge = {
        root: home.root,
        catalogDir: home.catalogDir,
        alreadyHydrated: rootExisted && catalogExisted,
      };
    } catch (failure) {
      // Knowledge preparation failed; not blocking — the rest of the report
      // is still useful.
      diagnostics.push(...diagnosticsFor(failure));
    }
  }

  // Step 6: Write the durable declaration when the trigger fires.
  const declaration = await maybeUpgradeDeclaration(pointer, stores, consent, diagnostics);

  return { knowledge, declaration };
}

async function buildProjectReport(input: BootstrapInput): Promise<BootstrapReport> {
  const options: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const projectRoot = findBootstrapRoot(input.cwd);
  const config = readProjectConfig(projectRoot);
  const projectId = config?.projectId;
  const pointer = readStorePointer(projectRoot);
  const registry = await readRegistryEntries(options);
  const entries = registry.entries;

  const problems: BootstrapProblem[] = [];
  const diagnostics: StoreDiagnostic[] = [];

  // An unreadable registry makes every Store question unanswerable, so the
  // report says exactly that and stops — rather than resolving nothing and
  // calling the machine empty, or throwing on the very machine it exists to
  // diagnose.
  if (registry.failure !== undefined) {
    return blockedProjectReport({
      input,
      projectRoot,
      pointer,
      ...(projectId !== undefined ? { projectId } : {}),
      problem: unreadableState(getStoreRegistryPath(options), registry.failure),
    });
  }

  const expected = new Map<string, ExpectedStore>();
  try {
    const listing = await listProjectStoreCandidates(projectRoot, options);
    diagnostics.push(...listing.diagnostics);
    for (const candidate of listing.candidates) {
      const built = expectedFromCandidate(candidate);
      expected.set(built.key, built);
    }
  } catch (failure) {
    return blockedProjectReport({
      input,
      projectRoot,
      pointer,
      ...(projectId !== undefined ? { projectId } : {}),
      problem: unreadableState(getStoreRegistryPath(options), failure),
    });
  }

  // The planning declaration is NOT part of the candidate listing; it is merged
  // in on the same identity key so a hint and the pointer naming one Store
  // collapse to one entry.
  if (hasStoreDeclaration(pointer)) {
    let resolution: StoreBindingResolution;
    try {
      resolution = await resolveStoreBinding({
        declaration: declarationFrom(pointer),
        projectRoot,
        ...options,
      });
    } catch (failure) {
      return blockedProjectReport({
        input,
        projectRoot,
        pointer,
        ...(projectId !== undefined ? { projectId } : {}),
        problem: unreadableState(getStoreRegistryPath(options), failure),
      });
    }
    await mergePlanningDeclaration({
      expected,
      resolution,
      pointer,
      projectId,
      options,
    });
  } else if (pointer.shape === 'malformed') {
    // A declaration that cannot be understood is reported, never skipped and
    // never treated as absent.
    const resolution = await resolveStoreBinding({ declaration: declarationFrom(pointer), ...options });
    if (resolution.kind === 'unavailable') {
      problems.push({
        kind: 'declaration-malformed',
        ...(pointer.filePath !== null ? { path: pointer.filePath } : {}),
        reason: resolution.reason,
        repair: bootstrapRepairsFrom(resolution.repair),
        diagnostics: resolution.diagnostics,
      });
    }
  }

  if (expected.size > 0 && projectId === undefined) {
    problems.push({
      kind: 'project-identity-missing',
      path: projectRoot,
      repair: [],
      diagnostics: [],
    });
  }

  const stores: BootstrapStoreEntry[] = [];
  for (const item of [...expected.values()]) {
    stores.push(
      await buildStoreEntry({
        item,
        entries,
        input,
        options,
        projectRoot,
        ...(projectId !== undefined ? { projectId } : {}),
      })
    );
  }
  stores.sort((left, right) => left.selector.localeCompare(right.selector));

  // Apply mode: act on what is already local AND obtain what is not. The
  // read-and-classify path above is unchanged — the apply path consumes its
  // results. Each step is individually idempotent, so an interruption leaves a
  // state a rerun resumes from. The end state is computed AFTER acting, so it
  // reflects the post-acting facts.
  let knowledge: BootstrapKnowledgePreparation | undefined;
  let declaration: BootstrapDeclarationResult | undefined;
  if (input.mode === 'apply') {
    // Build the raw-remotes map from the expected Stores: the entries carry
    // the REDACTED remote for display, but cloning needs the raw URL.
    const rawRemotes = new Map<string, string>();
    for (const [key, item] of expected) {
      if (item.remote !== undefined) rawRemotes.set(key, item.remote);
    }
    const result = await applyProjectFirstActions(input, stores, {
      projectRoot,
      ...(projectId !== undefined ? { projectId } : {}),
      pointer,
      options,
      diagnostics,
      rawRemotes,
    });
    knowledge = result.knowledge;
    declaration = result.declaration;
  }

  const state = computeBootstrapEndState({
    stores,
    projects: [],
    problems,
    diagnostics: allBootstrapDiagnostics({ stores, projects: [], diagnostics }),
  });

  return {
    mode: input.mode,
    origin: 'project',
    state,
    project: {
      root: projectRoot,
      ...(projectId !== undefined ? { projectId } : {}),
      declaresStore: hasStoreDeclaration(pointer),
      ...(pointer.filePath !== null ? { declarationPath: pointer.filePath } : {}),
    },
    stores,
    projects: [],
    problems,
    diagnostics,
    ...(knowledge !== undefined ? { knowledge } : {}),
    ...(declaration !== undefined ? { declaration } : {}),
  };
}

/**
 * The report a project-first run produces when the machine's own state cannot
 * be read: `blocked`, naming the file and the repair, with no Store list —
 * because no Store question could be answered, not because there are none.
 */
function blockedProjectReport(context: {
  input: BootstrapInput;
  projectRoot: string;
  pointer: StorePointerRead;
  projectId?: string;
  problem: BootstrapProblem;
}): BootstrapReport {
  const { input, projectRoot, pointer, problem } = context;
  return {
    mode: input.mode,
    origin: 'project',
    state: 'blocked',
    project: {
      root: projectRoot,
      ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
      declaresStore: hasStoreDeclaration(pointer),
      ...(pointer.filePath !== null ? { declarationPath: pointer.filePath } : {}),
    },
    stores: [],
    projects: [],
    problems: [problem],
    diagnostics: [],
  };
}

/**
 * The already-expected Store this declaration names, by key OR by either half
 * of its identity.
 *
 * The key alone is not enough. `projectStoreCandidateKey` falls back to
 * `uid:` and then `id:`, so a durable membership hint (`uid:…`) and an
 * alias-form planning pointer (`id:team-store`) naming ONE Store that is not
 * on this machine produce two different keys and never collapse — the user
 * sees the same Store listed twice with two repair blocks. Once the Store
 * resolves, both key on `root:` and the problem disappears, which is exactly
 * why only the unavailable case shows it.
 */
function findExpectedStore(
  expected: Map<string, ExpectedStore>,
  key: string,
  declared: { uid?: string; id?: string }
): ExpectedStore | undefined {
  const direct = expected.get(key);
  if (direct) return direct;

  const normalize = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : value.trim().toLowerCase();
  const uid = normalize(declared.uid);
  const id = normalize(declared.id);

  for (const item of expected.values()) {
    if (uid !== undefined && normalize(item.uid) === uid) return item;
    if (id !== undefined && normalize(item.id) === id) return item;
  }
  return undefined;
}

async function mergePlanningDeclaration(context: {
  expected: Map<string, ExpectedStore>;
  resolution: StoreBindingResolution;
  pointer: StorePointerRead;
  projectId: string | undefined;
  options: StorePathOptions;
}): Promise<void> {
  const { expected, resolution, pointer, projectId, options } = context;
  if (resolution.kind === 'absent') return;

  const declared = {
    ...(pointer.durable?.uid !== undefined ? { uid: pointer.durable.uid } : {}),
    ...(pointer.value !== undefined ? { id: pointer.value } : {}),
    ...(pointer.durable?.remote !== undefined ? { remote: pointer.durable.remote } : {}),
  };

  const key =
    resolution.kind === 'resolved'
      ? projectStoreCandidateKey({ store: resolution.store })
      : projectStoreCandidateKey(declared);

  const existing = findExpectedStore(expected, key, declared);
  if (existing) {
    if (!existing.sources.includes('planning')) existing.sources.unshift('planning');
    if (existing.remote === undefined && declared.remote !== undefined) {
      existing.remote = declared.remote;
    }
    // The declaration may know an identity the hint did not, or the reverse.
    // Keeping both is what makes the merged entry's selector unambiguous.
    if (existing.uid === undefined && declared.uid !== undefined) existing.uid = declared.uid;
    if (existing.id === undefined && declared.id !== undefined) existing.id = declared.id;
    return;
  }

  const item: ExpectedStore = {
    key,
    sources: ['planning'],
    ...(declared.uid !== undefined ? { uid: declared.uid } : {}),
    ...(declared.id !== undefined ? { id: declared.id } : {}),
    ...(declared.remote !== undefined ? { remote: declared.remote } : {}),
    resolution,
    diagnostics: resolution.diagnostics,
  };

  if (resolution.kind === 'resolved') {
    item.store = resolution.store;
    item.uid = resolution.store.uid ?? item.uid;
    item.id = resolution.store.id;
    if (projectId !== undefined) {
      const record = await resolveProjectMembership(resolution.store, projectId, options);
      if (record) item.record = record;
    }
  }

  expected.set(key, item);
}

async function buildStoreEntry(context: {
  item: ExpectedStore;
  entries: readonly StoreRegistryEntry[];
  input: BootstrapInput;
  options: StorePathOptions;
  projectRoot: string;
  projectId?: string;
}): Promise<BootstrapStoreEntry> {
  const { item, entries, input, projectRoot } = context;
  const selector = unambiguousStoreSelector(
    {
      ...(item.uid !== undefined ? { uid: item.uid } : {}),
      ...(item.id !== undefined ? { id: item.id } : {}),
    },
    entries
  );

  // ONE selection function decides the location, in both modes. Check mode
  // still uses it — reading whether a supplied directory already holds this
  // Store is local information — but only preview REPORTS the answer.
  const suppliedPath = suppliedPathFor(input.paths, [item.id, item.uid, selector]);
  const location = selectBootstrapLocation({
    ...(suppliedPath !== undefined ? { suppliedPath } : {}),
    ...(input.into !== undefined ? { parentDirectory: input.into } : {}),
    nameSource: {
      ...(item.remote !== undefined ? { remote: item.remote } : {}),
      ...(item.id !== undefined ? { id: item.id } : {}),
    },
  });

  const probe: LocationProbe =
    item.resolution.kind === 'unavailable' && location.kind !== 'required'
      ? await probeStoreAtLocation(location.path, {
          ...(item.uid !== undefined ? { uid: item.uid } : {}),
          ...(item.id !== undefined ? { id: item.id } : {}),
        })
      : { kind: 'other' };
  const presentAt = probe.kind === 'store' ? probe.root : null;
  const diagnostics = [...item.diagnostics];
  if (probe.kind === 'unreadable') diagnostics.push(...probe.diagnostics);

  const classification = classifyBootstrapStore({
    resolution:
      item.resolution.kind === 'resolved'
        ? { kind: 'resolved' }
        : { kind: 'unavailable', reason: unavailableReason(item.resolution) },
    ...(presentAt !== null ? { presentAt } : {}),
    // A location whose identity cannot be read answers neither "here" nor
    // "not here", so the Store is reported as unresolvable rather than as
    // absent — the absent arm prints a clone.
    ...(probe.kind === 'unreadable' ? { locationUnreadable: true } : {}),
    ...(item.remote !== undefined ? { remote: item.remote } : {}),
  });

  const reportedLocation =
    input.mode === 'preview' && classification.class !== 'verified' ? location : undefined;

  const repair = buildStoreRepairs({
    classification: classification.class,
    resolution: item.resolution,
    presentAt,
    ...(probe.kind === 'unreadable'
      ? { unreadableLocation: { path: probe.path, diagnostics: probe.diagnostics } }
      : {}),
    // Only a location the report actually SHOWS may be spliced into a repair;
    // filling a path the user was never shown would be a hint they cannot check.
    location: reportedLocation,
    selector,
    ...(item.id !== undefined ? { id: item.id } : {}),
  });

  // The Store is HERE and healthy, but its record for this project may exist
  // and be unreadable — which `resolveProjectMembership` reports as a plain
  // `null`, indistinguishable from "no record". Ask the one reader that keeps
  // the two apart.
  const unreadableRecord =
    item.store !== undefined && item.record === undefined && context.projectId !== undefined
      ? await readUnreadableRecord(item.store, context.projectId)
      : undefined;
  if (unreadableRecord) diagnostics.push(...unreadableRecord.diagnostics);

  const membership = resolveBootstrapMembership({
    ...(item.store !== undefined ? { store: item.store } : {}),
    ...(item.record !== undefined ? { record: item.record } : {}),
    ...(unreadableRecord !== undefined ? { unreadableRecord } : {}),
    unavailableRepair: repair,
    ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
    projectRoot,
    selector,
    ...(item.id !== undefined ? { id: item.id } : {}),
  });

  const remote =
    input.mode === 'preview'
      ? (await remoteResolverFor(input).resolve({
          ...(item.uid !== undefined ? { uid: item.uid } : {}),
          ...(item.id !== undefined ? { id: item.id } : {}),
          ...(item.remote !== undefined ? { remote: item.remote } : {}),
        }))?.remote
      : redactOptionalRemote(item.remote);

  const root = item.store?.root ?? presentAt ?? undefined;

  return {
    key: item.key,
    sources: item.sources,
    ...(item.uid !== undefined ? { uid: item.uid } : {}),
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(root !== undefined ? { root } : {}),
    selector,
    class: classification.class,
    ...(classification.reason !== undefined ? { reason: classification.reason } : {}),
    membership,
    repair,
    ...(reportedLocation !== undefined ? { location: reportedLocation } : {}),
    diagnostics,
  };
}

/**
 * The record file that exists but cannot be read, or undefined when there is
 * simply no record.
 *
 * `readStoreProjectRecord` is the ONE landed reader that keeps those apart: it
 * returns empty diagnostics for a missing file and the parse or key-mismatch
 * diagnostic for a broken one. `resolveProjectMembership` collapses both into
 * `null`, which is why the answer has to be re-asked here rather than inferred.
 */
async function readUnreadableRecord(
  store: ResolvedStoreRef,
  projectId: string
): Promise<{ path: string; diagnostics: StoreDiagnostic[] } | undefined> {
  try {
    const read = await readStoreProjectRecord(store.root, projectId);
    if (read.record !== null || read.diagnostics.length === 0) return undefined;
    return { path: read.filePath, diagnostics: [...read.diagnostics] };
  } catch (failure) {
    // An identity that cannot even name a record file is itself the reason
    // membership cannot be established here.
    return {
      path: store.root,
      diagnostics: diagnosticsFor(failure),
    };
  }
}

function unavailableReason(resolution: StoreBindingResolution): StoreUnavailableReason {
  return resolution.kind === 'unavailable' ? resolution.reason : 'not-registered';
}

function remoteResolverFor(input: BootstrapInput): BootstrapRemoteResolver {
  if (input.mode === 'check') return unreachableRemoteResolver;
  return input.remotes ?? declaredRemoteResolver;
}

/**
 * The landed repairs carry a `<path>` placeholder because the resolver never
 * knows where a Store would go. Bootstrap sometimes does — and a hint carrying
 * `<path>` beside a report line naming the exact path is not pasteable, which
 * is the one thing the requirement this change took verbatim forbids. So the
 * placeholder is filled in wherever the location is settled, and left alone
 * wherever it is not (refused or not supplied), because inventing a path there
 * would be worse than a placeholder.
 */
function withKnownLocation(command: string, location: BootstrapLocation | undefined): string {
  if (location === undefined || location.kind !== 'usable') return command;
  return command
    .split(' ')
    .map((token) => (token === '<path>' ? pasteablePath(location.path) : token))
    .join(' ');
}

/**
 * A real path, safe to paste.
 *
 * Do not read this as "nowhere else substitutes a real path": `identity.ts:195`
 * emits `rasen store register ${storeRoot}` and `:192` embeds a metadata path,
 * both unquoted, and both are latently broken for a path containing whitespace.
 * This change quotes because it took the pasteable-hints requirement verbatim
 * and preview now splices a computed location into a printed command, so an
 * unquoted `C:\Program Files\…` would split into two arguments — a hint that
 * demonstrably does not work when pasted. The sibling hazard in `identity.ts`
 * is real and deliberately NOT fixed here (out of this change's scope); it is a
 * candidate follow-up.
 *
 * Quoted only when it has to be, so ordinary paths still render exactly as
 * every other command shows them. Double quotes work in POSIX shells,
 * PowerShell, and cmd alike.
 */
function pasteablePath(target: string): string {
  return /\s/u.test(target) ? `"${target}"` : target;
}

function buildStoreRepairs(context: {
  classification: BootstrapStoreClass;
  resolution: StoreBindingResolution;
  presentAt: string | null;
  unreadableLocation?: { path: string; diagnostics: readonly StoreDiagnostic[] };
  location: BootstrapLocation | undefined;
  selector: string;
  id?: string;
}): BootstrapRepair[] {
  const { classification, resolution, presentAt, location, selector, id } = context;
  if (classification === 'verified') return [];

  // A Store found on this disk has ONE repair, and it names the path rather
  // than a selector — registering it is what makes the selector work.
  if (classification === 'present-unregistered' && presentAt !== null) {
    return [
      { kind: 'command', command: `rasen store register ${pasteablePath(presentAt)}`, mutates: true },
    ];
  }

  // The named location holds something whose identity will not parse. The
  // landed repair for `not-registered` is a clone — which would act on
  // "it is not here", the one thing that was NOT established. Repair the
  // location instead.
  if (context.unreadableLocation !== undefined) {
    const fixes = context.unreadableLocation.diagnostics
      .map((diagnostic) => diagnostic.fix)
      .filter((fix): fix is string => fix !== undefined);
    return bootstrapRepairsFrom([
      ...(fixes.length > 0 ? fixes : [`Repair or remove ${context.unreadableLocation.path}`]),
      'rasen doctor',
    ]).filter((repair) => !isMutatingRepair(repair));
  }

  const landed = (
    resolution.kind === 'unavailable' ? bootstrapRepairsFrom(resolution.repair) : []
  ).map((repair) =>
    repair.kind === 'command'
      ? ({
          kind: 'command',
          command: withKnownLocation(repair.command, location),
          mutates: repair.mutates,
        } as const)
      : repair
  );

  if (classification === 'absent-without-remote') {
    return [{ kind: 'supply-path' }, ...disambiguateRepairs(landed, id, selector)];
  }

  return disambiguateRepairs(landed, id, selector);
}

// -----------------------------------------------------------------------------
// Store-first flow
// -----------------------------------------------------------------------------

async function buildStoreFirstReport(
  input: BootstrapInput,
  storeRoot: string
): Promise<BootstrapReport> {
  const options: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const problems: BootstrapProblem[] = [];
  const diagnostics: StoreDiagnostic[] = [];
  const registry = await readRegistryEntries(options);
  const entries = registry.entries;

  const blocked = (problem: BootstrapProblem): BootstrapReport => ({
    mode: input.mode,
    origin: 'store',
    state: 'blocked',
    stores: [],
    projects: [],
    problems: [problem],
    diagnostics,
  });

  if (registry.failure !== undefined) {
    return blocked(unreadableState(getStoreRegistryPath(options), registry.failure));
  }

  // Metadata that is ABSENT and metadata that is CORRUPT are different answers:
  // the first means this is not a Store checkout, the second means it is one
  // whose identity file needs correcting. Collapsing them would tell a user
  // their Store is not a Store.
  let metadata: Awaited<ReturnType<typeof readOptionalStoreMetadataState>>;
  try {
    metadata = await readOptionalStoreMetadataState(storeRoot);
  } catch (failure) {
    return blocked(unreadableState(getStoreMetadataPath(storeRoot), failure));
  }
  if (!metadata) {
    return blocked({
      kind: 'not-a-store-checkout',
      path: storeRoot,
      repair: [],
      diagnostics: [],
    });
  }

  const canonicalRoot = canonicalLocation(storeRoot);
  const registered = entries.find(
    (entry) => entry.type === 'store' && canonicalLocation(entry.backend.local_path) === canonicalRoot
  );

  // "Does this checkout verify as the Store it claims to be?" is only a real
  // question when something else on this machine also claims it: the registry.
  if (registered) {
    const inspection = await inspectRegisteredStore(registered.id, storeRoot);
    if (inspection.kind !== 'ok') {
      problems.push({
        kind: 'store-identity-mismatch',
        path: canonicalRoot,
        repair: [
          { kind: 'command', command: `rasen store doctor ${registered.id}`, mutates: false },
          { kind: 'command', command: 'rasen doctor', mutates: false },
        ],
        diagnostics: [
          storeUidMismatch({
            expected: registered.uid ?? registered.id,
            ...(storeMetadataUid(metadata) !== undefined
              ? { found: storeMetadataUid(metadata) as string }
              : {}),
            root: canonicalRoot,
          }),
        ],
      });
    }
  }

  const store: ResolvedStoreRef = {
    type: 'store',
    id: metadata.id,
    root: canonicalRoot,
    ...(storeMetadataUid(metadata) !== undefined
      ? { uid: storeMetadataUid(metadata) as string }
      : {}),
  };

  const projects: BootstrapProjectEntry[] = [];
  /** Raw (unredacted) remotes for cloning, keyed by projectId. */
  const rawProjectRemotes = new Map<string, string>();
  if (problems.length === 0) {
    try {
      const listing = await listStoreMembers(store, options);
      diagnostics.push(...listing.diagnostics);
      for (const member of listing.members) {
        projects.push(await buildProjectEntry({ member, entries, input }));
        if (member.remote !== undefined) {
          rawProjectRemotes.set(member.projectId, member.remote);
        }
      }
    } catch (failure) {
      return blocked(unreadableState(canonicalRoot, failure));
    }
  }

  // Apply mode (E3, design D4): register the Store's own checkout and obtain
  // explicitly selected projects. `--yes` covers registering the Store's own
  // checkout ONLY — it never obtains projects (the never-harvest rule, D6).
  let storeRegisteredAfterApply = registered !== undefined;
  if (input.mode === 'apply' && problems.length === 0) {
    // Step 1: Register the Store's own checkout. Consent is covered by
    // invoking apply (the Store is what the user is running bootstrap from).
    if (registered === undefined) {
      try {
        await registerExistingStore({ path: canonicalRoot });
        storeRegisteredAfterApply = true;
      } catch (failure) {
        // Idempotent on rerun: if already registered, this is a no-op.
        // Any other failure is reported and the remaining steps still run.
        diagnostics.push(...diagnosticsFor(failure));
      }
    }

    // Step 2: Determine which projects the user EXPLICITLY selected. The
    // never-harvest rule (D6) holds: `--yes` alone selects nothing. Only an
    // explicit `--path <projectId>=<dir>` or an interactive pick counts.
    const selectedProjectIds = new Set<string>();

    // (a) Projects named via --path are explicitly selected.
    for (const project of projects) {
      if (project.presence === 'present') continue;
      const supplied = suppliedPathFor(input.paths, [project.id, project.projectId]);
      if (supplied !== undefined) selectedProjectIds.add(project.projectId);
    }

    // (b) Interactive selection — ONLY when blanket is NOT set (never-harvest
    // under `--yes`) AND the callback is available.
    if (!input.consent?.blanket && input.consent?.selectProjects) {
      const obtainable = projects.filter((p) => p.presence === 'obtainable');
      if (obtainable.length > 0) {
        const selections: BootstrapProjectSelection[] = obtainable.map((p) => ({
          projectId: p.projectId,
          ...(p.id !== undefined ? { id: p.id } : {}),
          ...(p.remote !== undefined ? { remote: p.remote } : {}),
        }));
        const picked = await input.consent.selectProjects(selections);
        for (const id of picked) selectedProjectIds.add(id);
      }
    }

    // Step 3: Clone and register each selected project. The cleanup guard
    // (design D5) runs inside `cloneWithCleanupGuard`.
    for (const project of projects) {
      if (project.presence === 'present') {
        project.action = 'already-present';
        continue;
      }
      if (!selectedProjectIds.has(project.projectId)) {
        project.action = 'not-selected';
        continue;
      }

      const rawRemote = rawProjectRemotes.get(project.projectId);
      if (rawRemote === undefined) {
        project.action = 'obtain-failed';
        project.diagnostics.push({
          severity: 'error',
          code: 'bootstrap_obtain_no_remote',
          message: `No remote is recorded for project ${project.id ?? project.projectId}, so it cannot be obtained.`,
          target: 'project.root',
        });
        continue;
      }

      // Target selection (D5 enforcement).
      const suppliedPath = suppliedPathFor(input.paths, [
        project.id,
        project.projectId,
      ]);
      const location = selectBootstrapLocation({
        ...(suppliedPath !== undefined ? { suppliedPath } : {}),
        ...(input.into !== undefined ? { parentDirectory: input.into } : {}),
        nameSource: {
          ...(rawRemote !== undefined ? { remote: rawRemote } : {}),
          ...(project.id !== undefined ? { id: project.id } : {}),
        },
      });

      if (location.kind === 'refused') {
        project.action = 'obtain-failed';
        project.diagnostics.push({
          severity: 'warning',
          code: 'bootstrap_obtain_target_refused',
          message:
            location.because === 'not-empty'
              ? `The target directory ${location.path} already has contents, so the project was not cloned there.`
              : location.because === 'existing-checkout'
                ? `The target directory ${location.path} already holds a checkout, so the project was not cloned there.`
                : `The target directory ${location.path} could not be read, so the project was not cloned there.`,
          target: 'project.root',
          fix: `Choose a different location with --path <selector>=<dir> or --into <dir>.`,
        });
        continue;
      }

      if (location.kind === 'required') {
        project.action = 'obtain-failed';
        project.diagnostics.push({
          severity: 'warning',
          code: 'bootstrap_obtain_target_required',
          message: `A target location must be supplied for project ${project.id ?? project.projectId}. Use --path <selector>=<dir> or --into <dir>.`,
          target: 'project.root',
        });
        continue;
      }

      // Clone with the shared cleanup guard.
      const result = await cloneWithCleanupGuard(
        rawRemote,
        location.path,
        project.diagnostics
      );
      if (!result.ok) {
        project.action = 'obtain-failed';
        continue;
      }

      // Identity verification (design D4, task 6.6): re-read the cloned
      // project's own config and verify its projectId matches what the Store
      // recorded. A mismatch means the remote held a different project than
      // expected — the checkout is left in place (it is valid data the user
      // may want to inspect), and the mismatch is reported.
      const clonedConfig = readProjectConfig(location.path);
      const clonedProjectId = clonedConfig?.projectId;
      if (
        clonedProjectId !== undefined &&
        normalizeProjectIdentity(clonedProjectId) !==
          normalizeProjectIdentity(project.projectId)
      ) {
        project.action = 'obtain-failed';
        project.diagnostics.push({
          severity: 'error',
          code: 'bootstrap_obtain_identity_mismatch',
          message: `The cloned project at ${location.path} identifies as '${clonedProjectId}' but the Store recorded it as '${project.projectId}'. The checkout was left in place for inspection.`,
          target: 'project.projectId',
        });
        continue;
      }

      // Register the obtained project checkout.
      try {
        await registerProject(
          { projectRoot: location.path, projectId: project.projectId, mode: 'in-repo' },
          options
        );
        project.action = 'obtained';
        project.root = canonicalLocation(location.path);
        project.presence = 'present';
      } catch (failure) {
        // Clone succeeded but registration failed — the checkout is valid
        // data. Report the failure but do NOT remove the checkout.
        project.action = 'obtain-failed';
        project.diagnostics.push(...diagnosticsFor(failure));
        project.diagnostics.push({
          severity: 'warning',
          code: 'bootstrap_obtain_clone_succeeded_register_failed',
          message: `The project was cloned to ${location.path} but could not be registered. The checkout is intact.`,
          target: 'project.root',
        });
      }
    }
  }

  const state = computeBootstrapEndState({
    stores: [],
    projects,
    problems,
    diagnostics: allBootstrapDiagnostics({ stores: [], projects, diagnostics }),
  });

  return {
    mode: input.mode,
    origin: 'store',
    state,
    store: {
      root: canonicalRoot,
      id: metadata.id,
      ...(storeMetadataUid(metadata) !== undefined
        ? { uid: storeMetadataUid(metadata) as string }
        : {}),
      registered: storeRegisteredAfterApply,
    },
    stores: [],
    projects,
    problems,
    diagnostics,
  };
}

async function buildProjectEntry(context: {
  member: StoreMembershipRecord;
  entries: readonly StoreRegistryEntry[];
  input: BootstrapInput;
}): Promise<BootstrapProjectEntry> {
  const { member, entries, input } = context;
  const lookup = findLocalProject(member.projectId, entries);
  const root = lookup.kind === 'found' ? lookup.root : null;

  const presence: BootstrapProjectPresence =
    lookup.kind === 'found'
      ? 'present'
      : lookup.kind === 'unknown'
        ? 'unknown'
        : member.remote !== undefined
          ? 'obtainable'
          : 'unlocatable';

  const diagnostics = [
    ...member.diagnostics,
    ...(lookup.kind === 'unknown' ? lookup.diagnostics : []),
  ];

  const suppliedPath = suppliedPathFor(input.paths, [member.projectId, member.id]);
  const location =
    input.mode === 'preview' && presence !== 'present'
      ? selectBootstrapLocation({
          ...(suppliedPath !== undefined ? { suppliedPath } : {}),
          ...(input.into !== undefined ? { parentDirectory: input.into } : {}),
          nameSource: {
            ...(member.remote !== undefined ? { remote: member.remote } : {}),
            ...(member.id !== undefined ? { id: member.id } : {}),
          },
        })
      : undefined;

  const remote =
    input.mode === 'preview'
      ? (await remoteResolverFor(input).resolve({
          ...(member.id !== undefined ? { id: member.id } : {}),
          ...(member.remote !== undefined ? { remote: member.remote } : {}),
        }))?.remote
      : redactOptionalRemote(member.remote);

  return {
    projectId: member.projectId,
    ...(member.id !== undefined ? { id: member.id } : {}),
    ...(remote !== undefined ? { remote } : {}),
    presence,
    ...(root !== null ? { root } : {}),
    ...(location !== undefined ? { location } : {}),
    diagnostics,
  };
}

/**
 * The registered project carrying this identity, by ENUMERATION — the by-id
 * lookup ban targets picking one of two namesakes, and an identity has no
 * namesakes.
 *
 * Three answers again, not two. A registered project whose own config cannot
 * be read has an UNKNOWN identity, so "this project is not on this machine"
 * is not a conclusion the enumeration is entitled to draw — and that
 * conclusion prints an obtain suggestion for something that may already be
 * checked out here.
 */
type LocalProjectLookup =
  | { kind: 'found'; root: string }
  | { kind: 'absent' }
  | { kind: 'unknown'; diagnostics: StoreDiagnostic[] };

function findLocalProject(
  projectId: string,
  entries: readonly StoreRegistryEntry[]
): LocalProjectLookup {
  const wanted = normalizeProjectIdentity(projectId);
  const unreadable: StoreDiagnostic[] = [];

  for (const entry of entries) {
    if (entry.type !== 'project') continue;
    const root = entry.backend.local_path;
    const config = readProjectConfig(root);
    if (config === null && fs.existsSync(root)) {
      unreadable.push({
        severity: 'error',
        code: 'bootstrap_project_identity_unreadable',
        message: `The registered project at ${root} does not declare a readable project identity, so whether it is project ${projectId} cannot be determined here.`,
        target: 'project.projectId',
        fix: `Repair the Rasen config in ${root}, or unregister it with rasen store unregister --project ${entry.id}.`,
      });
      continue;
    }
    const identity = config?.projectId;
    if (identity !== undefined && normalizeProjectIdentity(identity) === wanted) {
      return { kind: 'found', root: canonicalLocation(root) };
    }
  }

  return unreadable.length > 0 ? { kind: 'unknown', diagnostics: unreadable } : { kind: 'absent' };
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * The whole report, in one read. Writes nothing, creates nothing, spawns
 * nothing — in either mode, from either origin, however many Stores or
 * projects are involved.
 */
export async function buildBootstrapReport(input: BootstrapInput): Promise<BootstrapReport> {
  const root = findBootstrapRoot(input.cwd);
  const metadata = await readOptionalStoreMetadataState(root).catch(() => null);
  if (metadata !== null || fs.existsSync(getStoreMetadataDir(root))) {
    return buildStoreFirstReport(input, root);
  }
  return buildProjectReport(input);
}
