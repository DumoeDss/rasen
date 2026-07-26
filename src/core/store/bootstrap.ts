/**
 * The bootstrap report: what this machine still needs before a project works.
 *
 * READS ONLY, on every path, in either mode. Nothing here creates a directory,
 * writes a file, registers anything, mints an identity, or spawns a process —
 * so there is no failure mode in which running it leaves a trace. Check mode
 * additionally contacts NO network: the remote seam is not reachable from it at
 * all (`unreachableRemoteResolver` throws if the check path ever reaches for
 * it), so the promise is mechanical rather than a convention.
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

// -----------------------------------------------------------------------------
// Report shape
// -----------------------------------------------------------------------------

/**
 * The two read-only modes, kept as two values rather than one "safe" flag:
 * they are different promises and each carries its own assertion.
 */
export type BootstrapMode = 'check' | 'preview';

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
 */
export type BootstrapRepair =
  | { kind: 'command'; command: string }
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
}

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
}

// -----------------------------------------------------------------------------
// Repairs
// -----------------------------------------------------------------------------

/**
 * The landed repair list, classified rather than re-coined. A repair that
 * begins with a program name is pasteable; the resolver also produces prose
 * instructions ("Register the checkout that carries…"), and calling one of
 * those a command would be the exact defect this change exists to avoid.
 */
export function bootstrapRepairsFrom(repair: readonly string[]): BootstrapRepair[] {
  return repair
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      /^(?:rasen|git)\s/u.test(entry)
        ? ({ kind: 'command', command: entry } as const)
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
      ? { kind: 'command', command: withUnambiguousSelector(repair.command, id, selector) }
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
 * The commands checked at this module's unknown-arm filter sites.
 *
 * NOT an inventory of every state-changing command this change prints: it also
 * prints `rasen store register <path>` and `git clone … && rasen store register
 * …`, neither of which is listed. Those are only ever emitted against an
 * ESTABLISHED answer (a Store found on disk, a Store resolved absent), so they
 * never reach a filter site — but a reader must not take this list for a
 * complete one.
 *
 * The rule this enforces is "no state-changing repair on an unknown". A
 * follow-up recorded in design.md D6 replaces prefix-matching with mutation
 * declared where a repair is CONSTRUCTED, which is what would make the rule
 * total rather than list-maintained.
 */
export const BOOTSTRAP_MUTATING_COMMANDS: readonly string[] = ['rasen store add-project'];

/**
 * True when this repair is one of the commands guarded at the unknown arms.
 * Prefix-matched, so it is exactly as complete as the list above.
 */
export function isMutatingRepair(repair: BootstrapRepair): boolean {
  if (repair.kind !== 'command') return false;
  return BOOTSTRAP_MUTATING_COMMANDS.some((prefix) => repair.command.startsWith(prefix));
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
 */
function unreadableState(path: string, failure: unknown): BootstrapProblem {
  return {
    kind: 'unreadable-state',
    path,
    repair: bootstrapRepairsFrom(['rasen doctor']),
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
    return [{ kind: 'command', command: `rasen store register ${pasteablePath(presentAt)}` }];
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
      ? ({ kind: 'command', command: withKnownLocation(repair.command, location) } as const)
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
        repair: bootstrapRepairsFrom([`rasen store doctor ${registered.id}`, 'rasen doctor']),
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
  if (problems.length === 0) {
    try {
      const listing = await listStoreMembers(store, options);
      diagnostics.push(...listing.diagnostics);
      for (const member of listing.members) {
        projects.push(await buildProjectEntry({ member, entries, input }));
      }
    } catch (failure) {
      return blocked(unreadableState(canonicalRoot, failure));
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
      registered: registered !== undefined,
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
