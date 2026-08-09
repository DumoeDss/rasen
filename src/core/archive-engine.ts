import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { BigIntStats, Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  applyEphemeraDeletion,
  classifyEphemera,
  EphemeraPlanError,
  type EphemeraBlocker,
  type EphemeraCandidateFingerprint,
  type EphemeraClassification,
  type EphemeraFileSystem,
  type EphemeraPreservedEntry,
} from './ephemera-cleaner.js';
import {
  resolveArchiveAccounting,
  archiveAccountingTemporaryPath,
  serializeArchiveAccounting,
  verifyArchiveAccounting,
  writeArchiveJson,
  type ArchiveAccounting,
  type HandoffAbsorbedEntry,
  type ResolveArchiveAccountingInput,
} from './archive-accounting.js';
import {
  resolveArchiveV2Accounting,
  verifyArchiveV2Accounting,
  writeArchiveV2Json,
  type ArchiveV2IdentityPreimages,
  type ArchiveV2RecordDraft,
  type PreparedArchiveV2Accounting,
} from './archive-accounting-v2.js';
import {
  makeLockErrorFactory,
  withOwnerAwareFileLock,
} from './file-state.js';
import {
  NATIVE_PATH_IDENTITY_FLAVOR,
  pathIdentityEquals,
  type PathIdentityFlavor,
} from './path-identity.js';
import { isConfirmedGitWorkTree } from './store/git.js';
import { parseChangeInstanceId } from './store/planning-identity.js';
import { parseChangeId } from './store/planning-validation.js';
import { resolveStorePlanningLayoutV2Path } from './store/planning-layout-v2.js';

const execFileAsync = promisify(execFile);

export const ARCHIVE_PLAN_VERSION = 2 as const;
export const ARCHIVE_JOURNAL_FILENAME = '.rasen-archive-journal.json';
export const ARCHIVE_PUBLISHED_MARKER_FILENAME = '.rasen-archive-published.json';
export const ARCHIVE_STAGE_OWNER_FILENAME = '.rasen-archive-stage-owner.json';
export const ARCHIVE_FINAL_OWNER_FILENAME = '.rasen-archive-owner.json';
const ARCHIVE_CONTROL_FILENAMES = new Set([
  '.rasen-archive-input.json',
  ARCHIVE_STAGE_OWNER_FILENAME,
  ARCHIVE_FINAL_OWNER_FILENAME,
  ARCHIVE_JOURNAL_FILENAME,
  ARCHIVE_PUBLISHED_MARKER_FILENAME,
]);
export const ARCHIVE_PLAN_TOKEN_PREFIX = 'archive-v1';
export const ARCHIVE_STORED_PLAN_APPLY_OPERATION = 'apply' as const;
export const ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE =
  'archive_merge_confirmation_required';
export const ARCHIVE_MERGE_CONFIRMATION_BLOCKER_MESSAGE =
  'A recorded PR delivery requires explicit merge confirmation.';
export const ARCHIVE_SHIP_LOG_RESERVED_HEADING = '## Archive';
export const ARCHIVE_SHIP_LOG_RESERVED_SECTION_CODE =
  'archive_ship_log_reserved_section';
export const ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE =
  'archive_handoff_projection_collision';
export const ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE =
  'archive_accounting_projection_collision';
export const ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE =
  'archive_openspec_metadata_invalid';
export const ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE =
  'archive_destination_ancestry_invalid';
export const ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE =
  'archive_destination_ancestry_ownership_unverified';
export const ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE =
  'archive_transaction_temp_ownership_unverified';

export function hasReservedArchiveShipLogSection(content: string): boolean {
  return /^## Archive[ \t]*\r?$/m.test(content);
}

export type ArchiveBlockerOperation =
  | 'source-lstat'
  | 'source-inventory'
  | 'source-read'
  | 'target-lstat'
  | 'sidecar-read'
  | 'sidecar-validate'
  | 'handoff-inventory'
  | 'handoff-lstat'
  | 'probe-lstat'
  | 'probe-realpath'
  | 'probe-git'
  | 'cleaner'
  | 'validation'
  | 'tasks'
  | 'timing'
  | 'git'
  | 'quality'
  | 'evidence'
  | 'stage'
  | 'copy'
  | 'handoff'
  | 'spec'
  | 'publish'
  | 'accounting'
  | 'association'
  | 'cleaner-apply'
  | 'source-remove'
  | 'journal';

export interface ArchiveBlocker {
  operation: ArchiveBlockerOperation;
  path: string;
  code?: string;
  message: string;
}

export interface ArchiveTreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  mode?: number;
  executable?: boolean;
  size?: string;
  sha256?: string;
  linkTarget?: string;
}

export interface ArchiveStatIdentity {
  dev: string;
  ino: string;
  mode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}
export interface ArchiveAssociationCarrierIdentity {
  dev: string;
  ino: string;
  mode: number;
  size: string;
}

export interface ArchiveAssociationCarrierAuthority {
  target: string;
  contentDigest: string;
  directory: {
    path: string;
    identity: ArchiveAssociationCarrierIdentity;
  };
  intent: {
    path: string;
    identity: ArchiveAssociationCarrierIdentity;
  };
  claim: {
    path: string;
    identity: ArchiveAssociationCarrierIdentity;
  };
}


export interface ArchiveAuthorityEntry {
  path: string;
  kind: ArchiveTreeEntry['kind'];
  identity: ArchiveStatIdentity;
}

export interface ArchiveTreeFingerprint {
  algorithm: 'sha256';
  digest: string;
  entries: ArchiveTreeEntry[];
  rootIdentity: ArchiveStatIdentity;
  authorityDigest: string;
  authorityEntries: ArchiveAuthorityEntry[];
}

export interface PreparedArchiveSpecAction {
  actionId?: string;
  capability: string;
  action: 'create' | 'update' | 'delete';
  source: string;
  target: string;
  sourceSha256: string;
  targetPrecondition:
    | { state: 'absent' }
    | {
        state: 'file';
        sha256: string;
        identity?: ArchiveStatIdentity;
        capabilityTree?: ArchiveTreeFingerprint;
      };
  rebuilt: string;
  counts: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
}

export interface ArchiveSpecSyncPreparation {
  mode: 'apply' | 'skip' | 'no-deltas' | 'passive';
  /** Absolute delta spec paths exhaustively discovered during preparation. */
  deltaSources: string[];
}

export interface ArchiveHandoffDecision {
  path: string;
  outcome: 'absorbed' | 'preserved';
}

export interface ArchiveProbeDecision {
  path: string;
  codeCommit: string;
}

export interface ArchiveIntentV1 {
  schemaVersion: 1;
  change: string;
  handoff: {
    complete: true;
    decisions: ArchiveHandoffDecision[];
  };
  probes: ArchiveProbeDecision[];
}

export interface ArchiveSidecarProjection {
  status: 'absent' | 'valid' | 'invalid';
  schemaVersion: number | null;
  change: string | null;
  disposition: 'unjudged-preserve-all' | 'judged';
  handoff: {
    complete: boolean | null;
    decisions: ArchiveHandoffDecision[];
    inventory: string[];
  };
  probes: ArchiveProbeDecision[];
  blockers: ArchiveBlocker[];
}

export interface ArchiveCleanerProjection {
  keepEphemera: boolean;
  classification: {
    discarded: string[];
    preserved: string[];
    aborted: boolean;
    abortReason?: string;
    candidates: EphemeraCandidateFingerprint[];
    preservedEntries: EphemeraPreservedEntry[];
    sourceSignals: string[];
    blockers: EphemeraBlocker[];
    complete: boolean;
  };
  effectiveDelete: string[];
  effectivePreserve: string[];
}

export interface ArchiveQualityInput {
  path: string;
  sha256: string;
}

/**
 * One semantic lock a Store v2 finalization holds while it applies. The engine
 * neither derives nor acquires these — it carries them so the plan records
 * which locks the operation ran under and the finalization Module can take them
 * in its own fixed order.
 */
export interface ArchiveFinalizationLockKey {
  kind: 'scope' | 'workspace' | 'change' | 'integration';
  material: Record<string, string>;
  label: string;
}

/**
 * What the `association-finalized` phase must reach. A scope with no workspace
 * pair declares the phase a no-op IN ADVANCE, so "nothing to do" is a planned
 * outcome rather than a silent skip.
 */
export interface ArchiveAssociationPlan {
  noop: boolean;
  /** Why the phase is a no-op; present only when `noop` is true. */
  reason?: string;
  planningScopeId?: string;
  changeId?: string;
  changeInstanceId?: string;
  workspacePairId?: string;
  /** Absolute `.rasen/planning-binding.json` on the execution side. */
  executionAssociationPath?: string;
  /** Machine data directory holding the workspace index. */
  globalDataDir?: string;
  /** What a repair may write, all of it already true on disk at plan time. */
  expected?: {
    storeUid: string;
    storeId: string;
    projectId: string;
    targetLineId: string;
    indexPlanId: string;
    indexPhase: string;
    planning: {
      root: string;
      repositoryIdentity: string;
      worktreeInstanceId: string;
      ref: string;
      headOid: string;
    };
    execution: {
      root: string;
      repositoryIdentity: string;
      worktreeInstanceId: string;
      ref: string;
      headOid: string;
    };
  };
}

/**
 * The frozen facts a finalization re-proves under its locks before the first
 * write, for the preconditions the record itself does not carry.
 *
 * They live on the PLAN and not on the plan token deliberately. `rasen archive
 * --apply-plan` is the only surface a saved plan is ever applied through, and
 * it is the mutating half of the management-API bridge — and it carries no
 * token. A precondition reachable only from a token is a precondition the
 * shipping surface does not have.
 */
export interface ArchiveFinalizationRevalidation {
  /** The target-line catalog this plan's address and refs were frozen from. */
  targetLine: {
    catalogPath: string;
    /** sha256 of the catalog text at plan time; re-read and compared at apply. */
    catalogDigest: string;
    /** Exact target code ref named by the project locator at plan time. */
    codeRef: string | null;
    /** Commit identity resolved for the target code ref at proof time. */
    codeRefOid: string | null;
  };
  /**
   * Foundation-authorized Store archive partition and record address. These
   * paths are independently frozen by the Store planner and bind the engine's
   * generic transaction paths to the Store layout.
   */
  archive: {
    root: string;
    archiveDate: string;
    destination: string;
  };
  /**
   * The committed blob a `superseded` outcome's successor was resolved from.
   * Absent for every other outcome. Re-read at apply so a record can never
   * name a successor that has since been removed from the ref it was found at.
   */
  successor?: {
    changeInstanceId: string;
    foundAtRef: string;
    blobPath: string;
    digest: string;
  };
}

/**
 * The optional Store v2 finalization block. Absent for standalone and legacy
 * flat Store archives, which behave exactly as they did before this field
 * existed: no outcome, no v2 record, no destination override, no association
 * phase, no locks.
 */
export interface ArchivePlanFinalization {
  outcome: 'landed' | 'superseded' | 'cancelled' | 'abandoned';
  /** Everything the record holds except the facts only the published tree supplies. */
  record: ArchiveV2RecordDraft;
  identity: ArchiveV2IdentityPreimages;
  /** The Foundation-computed entry address; equals `paths.final`. */
  destination: string;
  association: ArchiveAssociationPlan;
  /**
   * Required, not optional: an optional field is one an apply path can find
   * absent and skip, which is the shape of the defect this exists to close.
   * Every producer of a finalization block is in this same change, so there is
   * no stored plan that predates it.
   */
  revalidation: ArchiveFinalizationRevalidation;
  lockKeys: ArchiveFinalizationLockKey[];
}

export interface ArchivePlan {
  schemaVersion: 1 | typeof ARCHIVE_PLAN_VERSION;
  transactionId: string;
  planHash: string;
  change: string;
  createdAt: string;
  roots: {
    planning: string;
    execution: string;
  };
  /**
   * The planning scope this plan was created under. Finalization authority is
   * decided from these recorded facts, never re-derived from a path substring —
   * a standalone checkout may legitimately live at `.../rasen/projects/<name>`.
   * Absent on plans written before the field existed; those predate Store v2
   * planning entirely and are classified by their own recorded roots.
   */
  scope?: {
    kind: 'standalone' | 'legacy-store' | 'store-aggregate' | 'store-project';
    storeUid?: string;
    projectId?: string;
  };
  /**
   * Present only for a Store v2 finalization. Its presence — never a path
   * substring and never the content of an existing `archive.json` — is what
   * selects the Archive v2 accounting writer and the association phase.
   */
  finalization?: ArchivePlanFinalization;
  paths: {
    active: string;
    archiveParent: string;
    stage: string;
    final: string;
    journal: string;
    publishedJournal: string;
    ephemera: string;
  };
  archivePathAuthority: ArchiveAuthorityEntry[];
  sourceFingerprint: ArchiveTreeFingerprint | null;
  git: {
    execution: {
      state: 'git' | 'non-git' | 'error';
      codeCommit: string | null;
    };
    planning: {
      state: 'git' | 'non-git' | 'error';
      branch: string | null;
      treeState: 'clean' | 'dirty';
    };
  };
  preconditions: {
    source: 'directory' | 'missing' | 'invalid' | 'error';
    target: 'absent' | 'present' | 'error';
  };
  decisions: {
    validation: 'passed' | 'skipped' | 'blocked';
    tasks: {
      total: number;
      completed: number;
      override: boolean;
    };
    timing: {
      mode: 'in-ship' | 'on-merge';
      deliveryMode: 'pr' | 'push' | 'local' | null;
      override: boolean;
    };
    /** Absent only on stored plans created before exhaustive spec preparation. */
    specSync?: ArchiveSpecSyncPreparation;
  };
  specActions: PreparedArchiveSpecAction[];
  sidecar: ArchiveSidecarProjection;
  cleaner: ArchiveCleanerProjection;
  qualityInputs: ArchiveQualityInput[];
  evidenceInputs: string[];
  shipLog: {
    source: string | null;
    sha256: string | null;
    recordedCommit: string | null;
    reservedSection: boolean;
  };
  actions: Array<{
    order: number;
    kind:
      | 'write-spec'
      | 'delete-spec'
      | 'create-stage'
      | 'copy-payload'
      | 'apply-handoff'
      | 'finalize-ship-log'
      | 'capture-quality'
      | 'publish'
      | 'clean-ephemera'
      | 'write-accounting'
      | 'finalize-association'
      | 'remove-active'
      | 'complete-journal';
    path: string;
  }>;
  blockers: ArchiveBlocker[];
  complete: boolean;
}

export interface ArchiveApplyAssertions {
  mergeConfirmed?: boolean;
}

export interface ArchiveApplyOptions {
  adapters?: ArchiveEngineAdapters;
  assertions?: ArchiveApplyAssertions;
}

export interface ArchiveApplyInspection {
  applicable: boolean;
  blockers: ArchiveBlocker[];
}

export type ArchiveJournalPhase =
  | 'planned'
  | 'staged'
  | 'handoff-finalized'
  | 'evidence-finalized'
  | 'specs-applied'
  | 'published'
  | 'cleaner-progress'
  | 'accounting-finalized'
  | 'association-finalized'
  | 'source-removed'
  | 'complete'
  | 'failed';

export interface ArchiveIntegrityFailure {
  detectedAt: string;
  operation: ArchiveBlockerOperation;
  path: string;
  code?: string;
  message: string;
  safeAction: {
    kind: 'manual-recovery-required';
    guidance: string;
  };
}

export interface ArchiveJournal {
  schemaVersion: 2;
  transactionId: string;
  planHash: string;
  change: string;
  phase: ArchiveJournalPhase;
  activePath: string;
  stagePath: string;
  finalPath: string;
  ephemeraDisposed: string[];
  phaseFingerprints: Record<
    string,
    {
      state: 'intent' | 'verified';
      scope: 'stage' | 'final';
      before: ArchiveTreeFingerprint;
      expectedAfter: ArchiveTreeFingerprint;
      observedAfter?: ArchiveTreeFingerprint;
      temporary?: {
        path: string;
        identity: ArchiveStatIdentity;
      };
    }
  >;
  finalReservation: {
    state: 'none' | 'intent-durable' | 'owned';
    identity: ArchiveStatIdentity | null;
    entries: Array<{
      path: string;
      kind: ArchiveTreeEntry['kind'];
      expected: ArchiveTreeEntry;
      state: 'intent' | 'copied';
      identity?: ArchiveStatIdentity;
    }>;
  };
  specProgress: Array<{
    actionId: string;
    action: PreparedArchiveSpecAction['action'];
    target: string;
    backupOrQuarantine: string | null;
    temporary: string | null;
    claimIdentity?: ArchiveStatIdentity;
    temporaryIdentity?: ArchiveStatIdentity;
    publishedIdentity?: ArchiveStatIdentity;
    state:
      | 'pending'
      | 'intent-durable'
      | 'claimed'
      | 'published'
      | 'verified'
      | 'complete'
      | 'conflict'
      | 'failed';
    error?: string;
  }>;
  cleanerProgress: Array<{
    path: string;
    state:
      | 'pending'
      | 'delete-intent'
      | 'deleted'
      | 'deleted-after-intent'
      | 'already-absent'
      | 'conflict'
      | 'failed';
    error?: string;
  }>;
  associationProgress?: {
    path: string;
    state: 'pending' | 'intent-durable' | 'complete' | 'failed';
    carriers?: ArchiveAssociationCarrierAuthority[];
    error?: string;
  };
  sourceProgress: {
    state:
      | 'pending'
      | 'delete-intent'
      | 'claimed'
      | 'removing'
      | 'removed'
      | 'conflict'
      | 'failed';
    quarantine: string;
    claimIdentity?: ArchiveStatIdentity;
    error?: string;
  };
  updatedAt: string;
  failure?: {
    operation: string;
    path: string;
    code?: string;
    message: string;
    resumePhase: Exclude<ArchiveJournalPhase, 'failed'>;
  };
  integrityFailure?: ArchiveIntegrityFailure;
}
export interface ArchiveJournalState {
  journalPath: string;
  journal: ArchiveJournal | null;
  effectivePhase: Exclude<ArchiveJournalPhase, 'failed'> | null;
}

export interface ArchiveApplyResult {
  status: 'complete' | 'blocked' | 'recoverable' | 'abort-required';
  transactionId: string;
  planHash: string;
  change: string;
  path: string;
  journalPath: string;
  resumed: boolean;
  effectivePhase?: Exclude<ArchiveJournalPhase, 'failed'>;
  specsUpdated: boolean;
  totals: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
  ephemeraDiscarded: string[];
  ephemeraPreserved: string[];
  blockers: ArchiveBlocker[];
  recoveryCommand?: string;
  abortCommand?: string;
  manualRecoveryAction?: ArchiveIntegrityFailure['safeAction'];
  retainedPaths?: string[];
}

export interface ArchiveAbortResult {
  status: 'aborted' | 'already-aborted' | 'blocked';
  transactionId: string;
  planHash: string;
  change: string;
  stagePath: string;
  journalPath: string;
  tombstonePath: string;
  associationPhase?: 'pending' | 'no-op' | 'applied';
  effectivePhase?: Exclude<ArchiveJournalPhase, 'failed'>;
  retainedPaths?: string[];
  recoveryCommand?: string;
  manualRecoveryAction?: ArchiveIntegrityFailure['safeAction'];
  blockers: ArchiveBlocker[];
}

interface StoredArchiveAbortV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-abort';
  transactionId: string;
  planHash: string;
  change: string;
  stagePath: string;
  journalPath: string;
  stageIdentity: ArchiveStatIdentity | null;
  stageAuthority: ArchiveTreeFingerprint | null;
  associationPhase?: 'pending';
  status: 'aborting' | 'aborted';
  createdAt: string;
  updatedAt: string;
}

export interface StoredArchivePlanV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-plan';
  transactionId: string;
  planHash: string;
  createdAt: string;
  plan: ArchivePlan;
}

interface ArchivePublishedMarkerV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-published';
  transactionId: string;
  planHash: string;
  archivePath: string;
  payloadDigest: string;
}

type ArchiveFsStat = Stats | BigIntStats;

export interface ArchiveFileSystem {
  access(target: string): Promise<void>;
  copyFile(source: string, target: string, flags?: number): Promise<void>;
  lstat(target: string): Promise<ArchiveFsStat>;
  mkdir(
    target: string,
    options?: { recursive?: boolean; mode?: number }
  ): Promise<string | undefined>;
  open(
    target: string,
    flags: string | number,
    mode?: number
  ): Promise<FileHandle>;
  readHandle(handle: FileHandle, target: string): Promise<Buffer>;
  readFile(target: string): Promise<Buffer>;
  readFile(target: string, encoding: BufferEncoding): Promise<string>;
  readdir(target: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  readlink(target: string): Promise<string>;
  realpath(target: string): Promise<string>;
  rename(source: string, target: string): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  rmdir(target: string): Promise<void>;
  rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  symlink(target: string, path: string, type?: 'dir' | 'file' | 'junction'): Promise<void>;
  unlink(target: string): Promise<void>;
  writeFile(target: string, data: string | Uint8Array, options?: { flag?: string }): Promise<void>;
}

export interface ArchiveGitAdapter {
  exec: (root: string, args: string[]) => Promise<string>;
  state(root: string): Promise<'git' | 'non-git'>;
}

export interface ArchiveEngineAdapters {
  fs: ArchiveFileSystem;
  git: ArchiveGitAdapter;
  now(): Date;
  transactionId(): string;
  sha256(data: string | Uint8Array): string;
  classifyEphemera(
    ephemeraDir: string,
    fileSystem?: EphemeraFileSystem
  ): Promise<EphemeraClassification>;
  applyEphemeraDeletion(
    ephemeraDir: string,
    classification: EphemeraClassification,
    fileSystem?: EphemeraFileSystem
  ): Promise<string[]>;
  resolveArchiveAccounting(input: ResolveArchiveAccountingInput): Promise<ArchiveAccounting>;
  verifyArchiveAccounting(
    archivedDir: string,
    accounting: ArchiveAccounting
  ): Promise<void>;
  writeArchiveJson(
    archivedDir: string,
    accounting: ArchiveAccounting,
    temporaryIdentity?: ArchiveStatIdentity
  ): Promise<void>;
  /**
   * The Archive v2 trio, dispatched on `plan.finalization` rather than on the
   * content of any file. Standalone and legacy flat archives never reach them.
   */
  resolveArchiveV2Accounting(input: {
    archivedDir: string;
    draft: ArchiveV2RecordDraft;
    identity: ArchiveV2IdentityPreimages;
  }): Promise<PreparedArchiveV2Accounting>;
  verifyArchiveV2Accounting(
    archivedDir: string,
    prepared: PreparedArchiveV2Accounting
  ): Promise<void>;
  writeArchiveV2Json(
    archivedDir: string,
    prepared: PreparedArchiveV2Accounting,
    temporaryIdentity?: ArchiveStatIdentity
  ): Promise<void>;
  /**
   * Completes the workspace association inside the archive transaction.
   * Carrier ownership is journaled through `carrierPrepared` before mutation.
   */
  finalizeArchiveAssociation(input: {
    plan: ArchivePlan;
    requireComplete?: boolean;
    carriers: readonly ArchiveAssociationCarrierAuthority[];
    carrierPrepared(
      authority: ArchiveAssociationCarrierAuthority
    ): Promise<void>;
  }): Promise<void>;
}

export const defaultArchiveEngineAdapters: ArchiveEngineAdapters = {
  fs: {
    access: target => fs.access(target),
    copyFile: (source, target, flags) => fs.copyFile(source, target, flags),
    lstat: target => fs.lstat(target, { bigint: true }),
    mkdir: (target, options) => fs.mkdir(target, options),
    open: (target, flags, mode) => fs.open(target, flags, mode),
    readHandle: handle => handle.readFile(),
    readFile: ((target: string, encoding?: BufferEncoding) =>
      encoding ? fs.readFile(target, encoding) : fs.readFile(target)) as ArchiveFileSystem['readFile'],
    readdir: (target, options) => fs.readdir(target, options),
    readlink: target => fs.readlink(target),
    realpath: target => fs.realpath(target),
    rename: (source, target) => fs.rename(source, target),
    link: (existingPath, newPath) => fs.link(existingPath, newPath),
    rmdir: target => fs.rmdir(target),
    rm: (target, options) => fs.rm(target, options),
    symlink: (target, linkPath, type) => fs.symlink(target, linkPath, type),
    unlink: target => fs.unlink(target),
    writeFile: (target, data, options) => fs.writeFile(target, data, options),
  },
  git: {
    exec: async (root, args) => {
      const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
        windowsHide: true,
      });
      return stdout.trim();
    },
    state: async root => {
      const state = await isConfirmedGitWorkTree(root);
      if (state === true) return 'git';
      if (state === false) return 'non-git';
      throw new Error(`Git state could not be confirmed for ${root}`);
    },
  },
  now: () => new Date(),
  transactionId: () => randomUUID(),
  sha256: data => createHash('sha256').update(data).digest('hex'),
  classifyEphemera,
  applyEphemeraDeletion,
  resolveArchiveAccounting,
  verifyArchiveAccounting,
  writeArchiveJson,
  resolveArchiveV2Accounting,
  verifyArchiveV2Accounting,
  writeArchiveV2Json,
  finalizeArchiveAssociation: async ({ plan }) => {
    if (plan.finalization === undefined || plan.finalization.association.noop) return;
    throw new Error(
      'Archive association completion requires the finalization Module adapter; the default engine adapter cannot reach the machine workspace index.'
    );
  },
};

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function blocker(
  operation: ArchiveBlockerOperation,
  target: string,
  error: unknown
): ArchiveBlocker {
  const code = errorCode(error);
  return {
    operation,
    path: target,
    ...(code ? { code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

function normalizeRelative(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/**
 * Stable JSON used for plan and journal identity. Object keys are sorted at
 * every depth; array order remains semantic and is therefore preserved.
 */
export function stableArchiveJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableArchiveJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableArchiveJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function statScalar(value: number | bigint): string {
  return typeof value === 'bigint' ? value.toString() : String(value);
}

function statNanoseconds(
  stat: ArchiveFsStat,
  nanosecondField: 'mtimeNs' | 'ctimeNs',
  millisecondField: 'mtimeMs' | 'ctimeMs'
): string {
  const nanoseconds = (stat as BigIntStats)[nanosecondField];
  if (typeof nanoseconds === 'bigint') return nanoseconds.toString();
  const milliseconds = stat[millisecondField];
  if (typeof milliseconds === 'bigint') {
    return (milliseconds * 1_000_000n).toString();
  }
  return BigInt(Math.trunc(milliseconds * 1_000_000)).toString();
}

function archiveStatIdentity(stat: ArchiveFsStat): ArchiveStatIdentity {
  return {
    dev: statScalar(stat.dev),
    ino: statScalar(stat.ino),
    mode: statScalar(stat.mode),
    size: statScalar(stat.size),
    mtimeNs: statNanoseconds(stat, 'mtimeNs', 'mtimeMs'),
    ctimeNs: statNanoseconds(stat, 'ctimeNs', 'ctimeMs'),
  };
}

function archiveDeletionIdentity(
  stat: ArchiveFsStat,
  kind: ArchiveAuthorityEntry['kind']
): ArchiveStatIdentity {
  const complete = archiveStatIdentity(stat);
  return kind === 'directory'
    ? {
        ...complete,
        size: '0',
        mtimeNs: '0',
        ctimeNs: '0',
      }
    : complete;
}

function identityMatches(left: ArchiveFsStat, right: ArchiveFsStat): boolean {
  return stableArchiveJson(archiveStatIdentity(left)) ===
    stableArchiveJson(archiveStatIdentity(right));
}

function staleArchiveObject(target: string, detail: string): Error {
  const error = new Error(`${detail}: ${target}`);
  (error as NodeJS.ErrnoException).code = 'ESTALE';
  return error;
}

/**
 * Read a regular file through the exact opened object. O_NOFOLLOW is used
 * where the host exposes it; all hosts additionally bind both handle stats
 * and the final pathname identity to the initial lstat.
 */
async function readStableArchiveFile(
  target: string,
  adapters: ArchiveEngineAdapters
): Promise<{ content: Buffer; stat: ArchiveFsStat }> {
  const beforePath = await adapters.fs.lstat(target);
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw staleArchiveObject(target, 'Archive file is not a regular no-follow object');
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await adapters.fs.open(target, fsConstants.O_RDONLY | noFollow);
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    if (!beforeHandle.isFile() || !identityMatches(beforePath, beforeHandle)) {
      throw staleArchiveObject(target, 'Archive pathname changed before handle read');
    }
    const content = await adapters.fs.readHandle(handle, target);
    const afterHandle = await handle.stat({ bigint: true });
    if (!afterHandle.isFile() || !identityMatches(beforeHandle, afterHandle)) {
      throw staleArchiveObject(target, 'Archive opened file changed during read');
    }
    const afterPath = await adapters.fs.lstat(target);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !identityMatches(afterHandle, afterPath)
    ) {
      throw staleArchiveObject(target, 'Archive pathname changed during handle read');
    }
    return { content, stat: afterPath };
  } finally {
    await handle.close();
  }
}

export function hashArchivePlan(
  plan: Omit<ArchivePlan, 'planHash'>,
  adapters: Pick<ArchiveEngineAdapters, 'sha256'> = defaultArchiveEngineAdapters
): string {
  return adapters.sha256(stableArchiveJson(plan));
}

/**
 * A symlink-safe, deterministic source identity. Engine control files are
 * omitted because they are intent/recovery transport, not archive payload.
 */
export async function fingerprintArchiveTree(
  root: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveTreeFingerprint> {
  const entries: ArchiveTreeEntry[] = [];
  const authorityEntries: ArchiveAuthorityEntry[] = [];

  async function walk(
    directory: string,
    prefix: string,
    directoryBefore: ArchiveFsStat
  ): Promise<void> {
    const dirents = await adapters.fs.readdir(directory, { withFileTypes: true });
    const filtered = dirents
      .filter(dirent => prefix || !ARCHIVE_CONTROL_FILENAMES.has(dirent.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!prefix) {
      for (const controlName of [
        '.rasen-archive-input.json',
        ARCHIVE_STAGE_OWNER_FILENAME,
      ]) {
        const control = dirents.find(dirent => dirent.name === controlName);
        if (!control) continue;
        const absolute = path.join(directory, control.name);
        const before = await adapters.fs.lstat(absolute);
        const after = await adapters.fs.lstat(absolute);
        if (
          !before.isFile() ||
          before.isSymbolicLink() ||
          !after.isFile() ||
          after.isSymbolicLink() ||
          !identityMatches(before, after)
        ) {
          throw staleArchiveObject(
            absolute,
            'Archive control file changed while fingerprinting'
          );
        }
        authorityEntries.push({
          path: control.name,
          kind: 'file',
          identity: archiveDeletionIdentity(after, 'file'),
        });
      }
    }
    for (const dirent of filtered) {
      const absolute = path.join(directory, dirent.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, dirent.name) : dirent.name);
      const before = await adapters.fs.lstat(absolute);
      if (before.isSymbolicLink()) {
        const linkTarget = await adapters.fs.readlink(absolute);
        const after = await adapters.fs.lstat(absolute);
        if (!after.isSymbolicLink() || !identityMatches(before, after)) {
          throw staleArchiveObject(
            absolute,
            'Archive symlink changed while fingerprinting'
          );
        }
        entries.push({
          path: relative,
          kind: 'symlink',
          linkTarget,
        });
        authorityEntries.push({
          path: relative,
          kind: 'symlink',
          identity: archiveDeletionIdentity(after, 'symlink'),
        });
      } else if (before.isDirectory()) {
        entries.push({
          path: relative,
          kind: 'directory',
        });
        await walk(absolute, relative, before);
        const after = await adapters.fs.lstat(absolute);
        if (!after.isDirectory() || !identityMatches(before, after)) {
          throw staleArchiveObject(
            absolute,
            'Archive directory changed while fingerprinting'
          );
        }
        authorityEntries.push({
          path: relative,
          kind: 'directory',
          identity: archiveDeletionIdentity(after, 'directory'),
        });
      } else if (before.isFile()) {
        const stable = await readStableArchiveFile(absolute, adapters);
        if (!identityMatches(before, stable.stat)) {
          throw staleArchiveObject(
            absolute,
            'Archive file changed before handle-bound fingerprinting'
          );
        }
        entries.push({
          path: relative,
          kind: 'file',
          executable:
            process.platform === 'win32'
              ? false
              : (BigInt(stable.stat.mode) & 0o111n) !== 0n,
          size: statScalar(stable.stat.size),
          sha256: adapters.sha256(stable.content),
        });
        authorityEntries.push({
          path: relative,
          kind: 'file',
          identity: archiveDeletionIdentity(stable.stat, 'file'),
        });
      } else {
        throw new Error(`Unsupported archive payload entry: ${absolute}`);
      }
    }

    const namesAfter = (await adapters.fs.readdir(directory, { withFileTypes: true }))
      .filter(dirent => prefix || !ARCHIVE_CONTROL_FILENAMES.has(dirent.name))
      .map(dirent => dirent.name)
      .sort((left, right) => left.localeCompare(right));
    if (
      stableArchiveJson(namesAfter) !==
      stableArchiveJson(filtered.map(dirent => dirent.name))
    ) {
      throw staleArchiveObject(
        directory,
        'Archive directory children changed while fingerprinting'
      );
    }
    const directoryAfter = await adapters.fs.lstat(directory);
    if (!directoryAfter.isDirectory() || !identityMatches(directoryBefore, directoryAfter)) {
      throw staleArchiveObject(
        directory,
        'Archive directory identity changed while fingerprinting'
      );
    }
  }

  const rootBefore = await adapters.fs.lstat(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
    throw staleArchiveObject(root, 'Archive root is not the planned real directory');
  }
  await walk(root, '', rootBefore);
  const rootAfter = await adapters.fs.lstat(root);
  if (!rootAfter.isDirectory() || !identityMatches(rootBefore, rootAfter)) {
    throw staleArchiveObject(root, 'Archive root identity changed while fingerprinting');
  }
  const rootIdentity = archiveDeletionIdentity(rootAfter, 'directory');
  return {
    algorithm: 'sha256',
    digest: adapters.sha256(stableArchiveJson(entries)),
    entries,
    rootIdentity,
    authorityDigest: adapters.sha256(
      stableArchiveJson({ rootIdentity, entries: authorityEntries })
    ),
    authorityEntries,
  };
}

function archivePayloadFingerprintMatches(
  left: ArchiveTreeFingerprint,
  right: ArchiveTreeFingerprint
): boolean {
  return (
    left.digest === right.digest &&
    stableArchiveJson(left.entries) === stableArchiveJson(right.entries)
  );
}

function archiveDeletionAuthorityMatches(
  left: ArchiveTreeFingerprint,
  right: ArchiveTreeFingerprint
): boolean {
  return (
    archivePayloadFingerprintMatches(left, right) &&
    left.authorityDigest === right.authorityDigest &&
    stableArchiveJson(left.rootIdentity) === stableArchiveJson(right.rootIdentity) &&
    stableArchiveJson(left.authorityEntries) ===
      stableArchiveJson(right.authorityEntries)
  );
}

export function projectArchiveCleaner(
  classification: EphemeraClassification,
  keepEphemera: boolean
): ArchiveCleanerProjection {
  const candidates = [...(classification.candidates ?? [])].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const preservedEntries = [...(classification.preservedEntries ?? [])].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason)
  );
  const sourceSignals = [...(classification.sourceSignals ?? [])].sort();
  const blockers = [...(classification.blockers ?? [])].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.operation.localeCompare(right.operation)
  );
  const complete = classification.complete !== false && blockers.length === 0;
  const candidatePaths = candidates.map(candidate => candidate.relativePath);
  const effectivePreserve = [
    ...new Set([
      ...classification.preserved,
      ...(keepEphemera || classification.aborted ? candidatePaths : []),
    ]),
  ].sort();

  return {
    keepEphemera,
    classification: {
      discarded: [...classification.discarded].sort(),
      preserved: [...classification.preserved].sort(),
      aborted: classification.aborted,
      ...(classification.abortReason ? { abortReason: classification.abortReason } : {}),
      candidates,
      preservedEntries,
      sourceSignals,
      blockers,
      complete,
    },
    effectiveDelete:
      keepEphemera || classification.aborted || !complete ? [] : [...classification.discarded].sort(),
    effectivePreserve,
  };
}

export interface ArchivePathApi {
  sep: string;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(target: string): boolean;
  dirname(target: string): string;
  basename(target: string): string;
}

export interface ArchiveTransactionPaths {
  archiveParent: string;
  stage: string;
  final: string;
  journal: string;
  publishedJournal: string;
}

export interface ResolveArchiveTransactionPathsOptions {
  /**
   * An explicit final destination, supplied by a Store v2 finalization from the
   * Foundation layout contract. It must be a direct child of `archiveParent` so
   * publication stays a same-volume rename from the sibling stage directory.
   */
  finalPath?: string;
}

export function resolveArchiveTransactionPaths(
  archiveParent: string,
  date: string,
  change: string,
  transactionId: string,
  pathApi: ArchivePathApi = path,
  options: ResolveArchiveTransactionPathsOptions = {}
): ArchiveTransactionPaths {
  const resolvedParent = pathApi.resolve(archiveParent);
  const stage = pathApi.join(
    resolvedParent,
    `.rasen-archive-stage-${transactionId}`
  );
  let final = pathApi.join(resolvedParent, `${date}-${change}`);
  if (options.finalPath !== undefined) {
    const override = pathApi.resolve(options.finalPath);
    if (pathApi.dirname(override) !== resolvedParent) {
      throw new Error(
        `Archive destination override ${override} is not a direct child of the archive parent ${resolvedParent}; publication must stay a same-volume rename from its sibling stage directory.`
      );
    }
    final = override;
  }
  return {
    archiveParent: resolvedParent,
    stage,
    final,
    journal: pathApi.join(stage, ARCHIVE_JOURNAL_FILENAME),
    publishedJournal: pathApi.join(final, ARCHIVE_JOURNAL_FILENAME),
  };
}

/**
 * A published entry name for `change`, in either shape: the flat
 * `YYYY-MM-DD-<change>` a standalone or legacy archive writes, or the Store v2
 * `YYYY-MM-DD-<change>--<instanceShort>` a finalization writes. The instance
 * suffix is a lowercase hex digest prefix, so the split is unambiguous even for
 * a Change alias that itself contains a double hyphen.
 */
export function archiveDatePrefixedNameMatches(
  candidate: string,
  change: string,
  flavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  const match = candidate.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  if (!match) return false;
  const rest = match[1];
  if (pathIdentityEquals(rest, change, flavor)) return true;
  const suffixed = rest.match(/^(.+)--([0-9a-f]+)$/);
  return !!suffixed && pathIdentityEquals(suffixed[1], change, flavor);
}

export function isArchiveContainedPath(
  root: string,
  candidate: string,
  pathApi: ArchivePathApi = path
): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keySet = new Set(allowed);
  return Object.keys(record).every(key => keySet.has(key));
}

async function inspectArchivePathAuthority(
  foundationRoot: string,
  archiveParent: string,
  adapters: ArchiveEngineAdapters
): Promise<{ authority: ArchiveAuthorityEntry[]; blockers: ArchiveBlocker[] }> {
  const root = path.resolve(foundationRoot);
  const target = path.resolve(archiveParent);
  const blockers: ArchiveBlocker[] = [];
  const authority: ArchiveAuthorityEntry[] = [];
  if (!isArchiveContainedPath(root, target)) {
    return {
      authority,
      blockers: [
        {
          operation: 'publish',
          path: target,
          code: ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
          message: `Archive destination ancestry escapes its authorized Foundation root: ${root}`,
        },
      ],
    };
  }
  const relative = path.relative(root, target);
  const candidates = [
    root,
    ...relative
      .split(path.sep)
      .filter(Boolean)
      .map((_part, index, parts) => path.join(root, ...parts.slice(0, index + 1))),
  ];
  let resolvedFoundationRoot: string | undefined;
  for (const candidate of candidates) {
    let before: ArchiveFsStat;
    try {
      before = await adapters.fs.lstat(candidate);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') break;
      blockers.push(blocker('publish', candidate, error));
      break;
    }
    if (!before.isDirectory() || before.isSymbolicLink()) {
      blockers.push({
        operation: 'publish',
        path: candidate,
        code: ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
        message: 'Archive destination ancestry must contain only real directories.',
      });
      break;
    }
    try {
      const resolved = await adapters.fs.realpath(candidate);
      if (candidate === root) resolvedFoundationRoot = resolved;
      const authorizedResolved = path.resolve(
        resolvedFoundationRoot ?? resolved,
        path.relative(root, candidate)
      );
      const after = await adapters.fs.lstat(candidate);
      if (
        !pathIdentityEquals(resolved, authorizedResolved) ||
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        !identityMatches(before, after)
      ) {
        throw archiveDeterministicInputError(
          ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
          'Archive destination ancestry changed while its identity was being bound.'
        );
      }
      authority.push({
        path: candidate,
        kind: 'directory',
        identity: archiveDeletionIdentity(after, 'directory'),
      });
    } catch (error) {
      blockers.push(blocker('publish', candidate, error));
      break;
    }
  }
  return { authority, blockers };
}

async function assertArchivePathAuthority(
  plan: ArchivePlan,
  expected: ArchiveAuthorityEntry[],
  adapters: ArchiveEngineAdapters,
  options: { recoveryOwned: boolean; allowUnbound: boolean }
): Promise<ArchiveAuthorityEntry[]> {
  const observed = await inspectArchivePathAuthority(
    plan.roots.planning,
    plan.paths.archiveParent,
    adapters
  );
  const expectedByPath = new Map(expected.map(entry => [entry.path, entry]));
  const observedByPath = new Map(
    observed.authority.map(entry => [entry.path, entry])
  );
  const mismatch =
    observed.blockers[0] ??
    expected.find(entry => {
      const actual = observedByPath.get(entry.path);
      return (
        !actual ||
        actual.kind !== entry.kind ||
        stableArchiveJson(actual.identity) !== stableArchiveJson(entry.identity)
      );
    }) ??
    (!options.allowUnbound
      ? observed.authority.find(entry => !expectedByPath.has(entry.path))
      : undefined);
  if (mismatch) {
    throw archiveDeterministicInputError(
      options.recoveryOwned
        ? ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE
        : ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
      `Archive destination ancestry is not bound to the reviewed plan: ${mismatch.path}`
    );
  }
  return observed.authority;
}

async function ensureArchiveParentDirectories(
  plan: ArchivePlan,
  expected: ArchiveAuthorityEntry[],
  adapters: ArchiveEngineAdapters
): Promise<ArchiveAuthorityEntry[]> {
  const relative = path.relative(
    path.resolve(plan.roots.planning),
    path.resolve(plan.paths.archiveParent)
  );
  const candidates = relative
    .split(path.sep)
    .filter(Boolean)
    .map((_part, index, parts) =>
      path.join(plan.roots.planning, ...parts.slice(0, index + 1))
    );
  let authority = expected;
  let created = false;
  for (const candidate of candidates) {
    try {
      await adapters.fs.lstat(candidate);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      authority = await assertArchivePathAuthority(
        plan,
        authority,
        adapters,
        { recoveryOwned: created, allowUnbound: true }
      );
      await adapters.fs.mkdir(candidate);
      created = true;
    }
    authority = await assertArchivePathAuthority(
      plan,
      authority,
      adapters,
      { recoveryOwned: created, allowUnbound: true }
    );
  }
  return authority;
}

async function assertArchiveChildDirectory(
  parent: string,
  child: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveStatIdentity> {
  const before = await adapters.fs.lstat(child);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw archiveDeterministicInputError(
      ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE,
      `Archive transaction child is not a real directory: ${child}`
    );
  }
  const [resolvedParent, resolvedChild] = await Promise.all([
    adapters.fs.realpath(parent),
    adapters.fs.realpath(child),
  ]);
  const after = await adapters.fs.lstat(child);
  if (
    !pathIdentityEquals(path.dirname(resolvedChild), resolvedParent) ||
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    !identityMatches(before, after)
  ) {
    throw archiveDeterministicInputError(
      ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE,
      `Archive transaction child escaped or changed beneath its bound parent: ${child}`
    );
  }
  return archiveDeletionIdentity(after, 'directory');
}

export function validArchiveIntentRelativePath(
  relativePath: string,
  requiredPrefix?: string,
  pathApi: ArchivePathApi = path
): boolean {
  if (
    relativePath.length === 0 ||
    pathApi.isAbsolute(relativePath) ||
    /^[a-z]:[\\/]/i.test(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return false;
  }
  return requiredPrefix === undefined || relativePath.startsWith(`${requiredPrefix}/`);
}

async function inventoryHandoff(
  changeRoot: string,
  adapters: ArchiveEngineAdapters
): Promise<{ inventory: string[]; blockers: ArchiveBlocker[] }> {
  const handoffRoot = path.join(changeRoot, 'handoff');
  const inventory: string[] = [];
  const blockers: ArchiveBlocker[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      blockers.push(blocker('handoff-inventory', directory, error));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(path.join('handoff', prefix, entry.name));
      let stat: ArchiveFsStat;
      try {
        stat = await adapters.fs.lstat(absolute);
      } catch (error) {
        blockers.push(blocker('handoff-lstat', absolute, error));
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        blockers.push({
          operation: 'handoff-lstat',
          path: absolute,
          message: 'Handoff inventory entries must be regular files or directories; symlinks are forbidden.',
        });
      } else if (stat.isDirectory()) {
        await walk(absolute, prefix ? path.join(prefix, entry.name) : entry.name);
      } else {
        try {
          await adapters.fs.readFile(absolute);
          inventory.push(relative);
        } catch (error) {
          blockers.push(blocker('handoff-lstat', absolute, error));
        }
      }
    }
  }

  await walk(handoffRoot, '');
  inventory.sort();
  blockers.sort((left, right) => left.path.localeCompare(right.path));
  return { inventory, blockers };
}

export async function createArchiveIntentTemplate(
  changeRoot: string,
  change: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveIntentV1> {
  const { inventory, blockers } = await inventoryHandoff(changeRoot, adapters);
  if (blockers.length > 0) {
    throw new Error(
      blockers.map(item => `${item.operation}: ${item.message}`).join('; ')
    );
  }
  return {
    schemaVersion: 1,
    change,
    handoff: {
      complete: true,
      decisions: inventory.map(relativePath => ({
        path: relativePath,
        outcome: 'preserved',
      })),
    },
    probes: [],
  };
}

/**
 * Strict, mutation-free archive intent validation. Only an ENOENT sidecar is
 * interpreted as no judgment; every other read/schema/inventory failure is a
 * blocker. Probe paths are checked both lexically and through realpath.
 */
export async function resolveArchiveSidecar(
  changeRoot: string,
  executionRoot: string,
  change: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters,
  intentFile?: string
): Promise<ArchiveSidecarProjection> {
  const { inventory, blockers } = await inventoryHandoff(changeRoot, adapters);
  const embeddedSidecarPath = path.join(changeRoot, '.rasen-archive-input.json');
  let sidecarPath = embeddedSidecarPath;
  let content: string | undefined;
  let embeddedContent: string | undefined;
  try {
    embeddedContent = await adapters.fs.readFile(embeddedSidecarPath, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      blockers.push(blocker('sidecar-read', embeddedSidecarPath, error));
    }
  }
  if (intentFile) {
    sidecarPath = path.resolve(intentFile);
    try {
      content = await adapters.fs.readFile(sidecarPath, 'utf8');
    } catch (error) {
      blockers.push(blocker('sidecar-read', sidecarPath, error));
    }
    if (content !== undefined && embeddedContent !== undefined) {
      try {
        if (
          stableArchiveJson(JSON.parse(content)) !==
          stableArchiveJson(JSON.parse(embeddedContent))
        ) {
          blockers.push({
            operation: 'sidecar-validate',
            path: sidecarPath,
            message:
              'External intent and in-change sidecar are ambiguous because their normalized content differs.',
          });
        }
      } catch {
        // The normal strict parse below reports the selected file; malformed
        // embedded input is still ambiguous and therefore blocking.
        blockers.push({
          operation: 'sidecar-validate',
          path: embeddedSidecarPath,
          message: 'In-change sidecar could not be compared with external intent.',
        });
      }
    }
  } else {
    content = embeddedContent;
  }
  if (content === undefined) {
    return {
      status: blockers.length === 0 ? 'absent' : 'invalid',
      schemaVersion: null,
      change: null,
      disposition: 'unjudged-preserve-all',
      handoff: { complete: null, decisions: [], inventory },
      probes: [],
      blockers,
    };
  }

  const issue = (
    location: string,
    code: string,
    message: string
  ): void => {
    blockers.push({
      operation: 'sidecar-validate',
      path: `${sidecarPath}#${location}`,
      code,
      message,
    });
  };
  const reportUnexpectedKeys = (
    value: Record<string, unknown>,
    allowed: readonly string[],
    location: string
  ): void => {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)
      .filter(candidate => !allowedSet.has(candidate))
      .sort()) {
      issue(
        `${location}/${key}`,
        'archive_intent_unexpected_key',
        `Unexpected key '${key}' at ${location || '/'}; accepted keys are: ${allowed.join(', ')}.`
      );
    }
  };

  let parsed: unknown;
  let parsedSuccessfully = true;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    parsedSuccessfully = false;
    issue(
      '/',
      'archive_intent_json_invalid',
      `Archive intent is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const root = isPlainRecord(parsed) ? parsed : undefined;
  if (parsedSuccessfully && root === undefined) {
    issue(
      '/',
      'archive_intent_root_invalid',
      'Archive intent root must be a JSON object.'
    );
  }
  if (root !== undefined) {
    reportUnexpectedKeys(
      root,
      ['schemaVersion', 'change', 'handoff', 'probes'],
      ''
    );
    if (root.schemaVersion !== 1) {
      issue(
        '/schemaVersion',
        'archive_intent_schema_version_invalid',
        `schemaVersion must be 1; received ${JSON.stringify(root.schemaVersion)}.`
      );
    }
    if (root.change !== change) {
      issue(
        '/change',
        'archive_intent_change_mismatch',
        `Archive intent change must be '${change}'; received ${JSON.stringify(root.change)}.`
      );
    }
  }

  const handoff = root && isPlainRecord(root.handoff) ? root.handoff : undefined;
  if (root !== undefined) {
    if (handoff === undefined) {
      issue(
        '/handoff',
        'archive_intent_handoff_invalid',
        'handoff must be an object with complete and decisions fields.'
      );
    } else {
      reportUnexpectedKeys(handoff, ['complete', 'decisions'], '/handoff');
      if (handoff.complete !== true) {
        issue(
          '/handoff/complete',
          'archive_intent_handoff_incomplete',
          'Set handoff.complete to true after judging every handoff file.'
        );
      }
      if (!Array.isArray(handoff.decisions)) {
        issue(
          '/handoff/decisions',
          'archive_intent_handoff_decisions_invalid',
          'Set handoff.decisions to an array; an empty array is valid when there are no handoff files.'
        );
      }
    }
    if (!Array.isArray(root.probes)) {
      issue(
        '/probes',
        'archive_intent_probes_missing',
        'Add a probes array to archive input; use an empty array when there are no probes.'
      );
    }
  }
  const decisions: ArchiveHandoffDecision[] = [];
  const decisionPaths = new Set<string>();
  if (handoff && Array.isArray(handoff.decisions)) {
    for (const [index, value] of handoff.decisions.entries()) {
      const location = `/handoff/decisions/${index}`;
      if (!isPlainRecord(value)) {
        issue(
          location,
          'archive_intent_handoff_decision_invalid',
          'Each handoff decision must be an object with path and outcome fields.'
        );
        continue;
      }
      reportUnexpectedKeys(value, ['path', 'outcome'], location);
      const validPath =
        typeof value.path === 'string' &&
        validArchiveIntentRelativePath(value.path, 'handoff');
      if (!validPath) {
        issue(
          `${location}/path`,
          'archive_intent_handoff_path_invalid',
          'Handoff decision path must be a contained handoff/ relative path.'
        );
      }
      const validOutcome =
        value.outcome === 'absorbed' || value.outcome === 'preserved';
      if (!validOutcome) {
        issue(
          `${location}/outcome`,
          'archive_intent_handoff_outcome_invalid',
          "Handoff decision outcome must be 'absorbed' or 'preserved'."
        );
      }
      if (!validPath || !validOutcome) continue;

      const decisionPath = value.path as string;
      const absolute = path.resolve(changeRoot, ...decisionPath.split('/'));
      if (!isArchiveContainedPath(path.join(changeRoot, 'handoff'), absolute)) {
        issue(
          `${location}/path`,
          'archive_intent_handoff_path_escape',
          'Handoff decision escapes the handoff directory.'
        );
      } else if (decisionPaths.has(decisionPath)) {
        issue(
          `${location}/path`,
          'archive_intent_handoff_duplicate',
          `Duplicate handoff decision for '${decisionPath}'.`
        );
      } else {
        decisionPaths.add(decisionPath);
        decisions.push({
          path: decisionPath,
          outcome: value.outcome as ArchiveHandoffDecision['outcome'],
        });
      }
    }
  }
  decisions.sort((left, right) => left.path.localeCompare(right.path));

  if (
    handoff &&
    Array.isArray(handoff.decisions) &&
    (decisions.length !== inventory.length ||
      inventory.some(relativePath => !decisionPaths.has(relativePath)) ||
      decisions.some(decision => !inventory.includes(decision.path)))
  ) {
    issue(
      '/handoff/decisions',
      'archive_intent_handoff_inventory_mismatch',
      'Handoff decisions must exactly cover the current regular-file inventory.'
    );
  }

  const probes: ArchiveProbeDecision[] = [];
  const probePaths = new Set<string>();
  let executionReal: string | undefined;
  try {
    executionReal = await adapters.fs.realpath(executionRoot);
  } catch (error) {
    if (root && Array.isArray(root.probes) && root.probes.length > 0) {
      blockers.push(blocker('probe-realpath', executionRoot, error));
    }
  }
  if (root && Array.isArray(root.probes)) {
    for (const [index, value] of root.probes.entries()) {
      const location = `/probes/${index}`;
      if (!isPlainRecord(value)) {
        issue(
          location,
          'archive_intent_probe_invalid',
          'Each probe must be an object with path and codeCommit fields.'
        );
        continue;
      }
      reportUnexpectedKeys(value, ['path', 'codeCommit'], location);
      const validPath =
        typeof value.path === 'string' &&
        validArchiveIntentRelativePath(value.path);
      if (!validPath) {
        issue(
          `${location}/path`,
          'archive_intent_probe_path_invalid',
          'Probe path must be a contained relative path.'
        );
      }
      const validCommit =
        typeof value.codeCommit === 'string' &&
        /^[0-9a-f]{40}$/i.test(value.codeCommit);
      if (!validCommit) {
        issue(
          `${location}/codeCommit`,
          'archive_intent_probe_commit_invalid',
          'Probe codeCommit must be a full 40-hex commit id.'
        );
      }
      if (!validPath || !validCommit) continue;

      const probePath = value.path as string;
      const codeCommit = value.codeCommit as string;
      if (probePaths.has(probePath)) {
        issue(
          `${location}/path`,
          'archive_intent_probe_duplicate',
          `Duplicate probe path '${probePath}'.`
        );
        continue;
      }
      probePaths.add(probePath);
      const absolute = path.resolve(executionRoot, ...probePath.split('/'));
      if (!isArchiveContainedPath(executionRoot, absolute)) {
        issue(
          `${location}/path`,
          'archive_intent_probe_path_escape',
          'Probe path escapes the execution root lexically.'
        );
        continue;
      }
      try {
        const stat = await adapters.fs.lstat(absolute);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error('Probe must be a real directory.');
        }
        const actualReal = await adapters.fs.realpath(absolute);
        if (!executionReal || !isArchiveContainedPath(executionReal, actualReal)) {
          throw new Error('Probe resolves outside the execution root.');
        }
      } catch (error) {
        const probeBlocker = blocker('probe-lstat', absolute, error);
        probeBlocker.code = 'archive_intent_probe_path_unavailable';
        blockers.push(probeBlocker);
        continue;
      }
      try {
        await adapters.git.exec(executionRoot, [
          'cat-file',
          '-e',
          `${codeCommit}^{commit}`,
        ]);
      } catch (error) {
        const probeBlocker = blocker('probe-git', probePath, error);
        probeBlocker.code = 'archive_intent_probe_commit_unavailable';
        blockers.push(probeBlocker);
        continue;
      }
      probes.push({ path: probePath, codeCommit: codeCommit.toLowerCase() });
    }
  }
  probes.sort((left, right) => left.path.localeCompare(right.path));
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );

  return {
    status: blockers.length === 0 ? 'valid' : 'invalid',
    schemaVersion: root?.schemaVersion === 1 ? 1 : null,
    change: typeof root?.change === 'string' ? root.change : null,
    disposition: 'judged',
    handoff: {
      complete: root && isPlainRecord(root.handoff) ? root.handoff.complete === true : false,
      decisions,
      inventory,
    },
    probes,
    blockers,
  };
}

export interface CreateArchivePlanInput {
  change: string;
  planningRoot: string;
  executionRoot: string;
  /** The planning scope the plan is created under; see `ArchivePlan['scope']`. */
  scope?: ArchivePlan['scope'];
  /**
   * The Store v2 finalization block. Absent for standalone and legacy flat
   * archives, whose behavior is unchanged by this seam.
   */
  finalization?: ArchivePlanFinalization;
  activePath: string;
  archiveParent: string;
  ephemeraPath: string;
  date: string;
  keepEphemera: boolean;
  validation: ArchivePlan['decisions']['validation'];
  tasks: ArchivePlan['decisions']['tasks'];
  timing: ArchivePlan['decisions']['timing'];
  specActions: PreparedArchiveSpecAction[];
  specSync?: ArchiveSpecSyncPreparation;
  sidecar: ArchiveSidecarProjection;
  qualityInputs?: ArchiveQualityInput[];
  evidenceInputs?: string[];
  shipLog?: ArchivePlan['shipLog'];
  preparationBlockers?: ArchiveBlocker[];
  transactionId?: string;
  createdAt?: string;
}

function archiveDeterministicInputError(code: string, message: string): Error {
  const error = new Error(message);
  (error as NodeJS.ErrnoException).code = code;
  return error;
}

function parseArchiveOpenSpecMetadata(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw archiveDeterministicInputError(
      ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE,
      'Active .openspec.yaml must contain a valid YAML mapping when quality evidence is present.'
    );
  }
  if (parsed !== null && !isPlainRecord(parsed)) {
    throw archiveDeterministicInputError(
      ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE,
      'Active .openspec.yaml must contain a valid YAML mapping when quality evidence is present.'
    );
  }
  return (parsed as Record<string, unknown> | null) ?? {};
}

async function discoverArchiveEvidenceInputs(
  activePath: string,
  sidecar: ArchiveSidecarProjection,
  adapters: ArchiveEngineAdapters
): Promise<{
  evidenceInputs: string[];
  qualityInputs: ArchiveQualityInput[];
  blockers: ArchiveBlocker[];
}> {
  const evidenceInputs: string[] = [];
  const qualityInputs: ArchiveQualityInput[] = [];
  const blockers: ArchiveBlocker[] = [];
  const evidenceRoot = path.join(activePath, 'evidence');

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      blockers.push(blocker('evidence', directory, error));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      let stat: ArchiveFsStat;
      try {
        stat = await adapters.fs.lstat(absolute);
      } catch (error) {
        blockers.push(blocker('evidence', absolute, error));
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        blockers.push({
          operation: 'evidence',
          path: absolute,
          message: 'Evidence inventory entries must be regular files or directories; symlinks are forbidden.',
        });
      } else if (stat.isDirectory()) {
        await walk(absolute, relative);
      } else {
        try {
          const content = await adapters.fs.readFile(absolute);
          const archiveRelative = `evidence/${relative}`;
          evidenceInputs.push(archiveRelative);
          if (isQualityFilename(entry.name)) {
            qualityInputs.push({
              path: archiveRelative,
              sha256: adapters.sha256(content),
            });
          }
        } catch (error) {
          blockers.push(blocker('evidence', absolute, error));
        }
      }
    }
  }

  await walk(evidenceRoot, '');
  if (!evidenceInputs.includes('evidence/ship-log.md')) {
    evidenceInputs.push('evidence/ship-log.md');
  }
  if (sidecar.disposition === 'judged') {
    for (const decision of sidecar.handoff.decisions) {
      if (decision.outcome !== 'preserved') continue;
      const relative = decision.path.replace(/^handoff\//, '');
      const projected = `evidence/handoff/${relative}`;
      evidenceInputs.push(projected);
      if (isQualityFilename(path.basename(relative))) {
        const source = path.join(activePath, ...decision.path.split('/'));
        try {
          qualityInputs.push({
            path: projected,
            sha256: adapters.sha256(await adapters.fs.readFile(source)),
          });
        } catch (error) {
          blockers.push(blocker('quality', source, error));
        }
      }
    }
  }

  try {
    const topLevel = await adapters.fs.readdir(activePath, { withFileTypes: true });
    topLevel.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of topLevel) {
      if (!isQualityFilename(entry.name)) continue;
      const absolute = path.join(activePath, entry.name);
      try {
        const stat = await adapters.fs.lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Legacy quality input must be a regular file.');
        }
        qualityInputs.push({
          path: entry.name,
          sha256: adapters.sha256(await adapters.fs.readFile(absolute)),
        });
      } catch (error) {
        blockers.push(blocker('quality', absolute, error));
      }
    }
  } catch (error) {
    blockers.push(blocker('quality', activePath, error));
  }

  evidenceInputs.sort();
  qualityInputs.sort((left, right) => left.path.localeCompare(right.path));
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );
  return {
    evidenceInputs: [...new Set(evidenceInputs)],
    qualityInputs: qualityInputs.filter(
      (item, index, all) => all.findIndex(candidate => candidate.path === item.path) === index
    ),
    blockers,
  };
}

async function deterministicArchiveInputBlockers(
  activePath: string,
  sourceFingerprint: ArchiveTreeFingerprint,
  sidecar: ArchiveSidecarProjection,
  qualityInputs: ArchiveQualityInput[],
  adapters: ArchiveEngineAdapters
): Promise<ArchiveBlocker[]> {
  const entries = new Map(sourceFingerprint.entries.map(entry => [entry.path, entry]));
  const blockers: ArchiveBlocker[] = [];
  const accountingPath = 'archive.json';
  if (entries.has(accountingPath)) {
    blockers.push({
      operation: 'accounting',
      path: path.join(activePath, accountingPath),
      code: ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE,
      message:
        'Active archive payload may not contain archive.json because that path is reserved for engine-owned accounting.',
    });
  }

  if (sidecar.disposition === 'judged') {
    for (const decision of sidecar.handoff.decisions) {
      if (decision.outcome !== 'preserved') continue;
      const relative = decision.path.slice('handoff/'.length);
      const projected = normalizeRelative(path.join('evidence', 'handoff', relative));
      const projectedParts = projected.split('/');
      let conflictingPath: string | undefined;
      for (let index = 1; index <= projectedParts.length; index += 1) {
        const candidate = projectedParts.slice(0, index).join('/');
        const entry = entries.get(candidate);
        if (
          entry &&
          (index === projectedParts.length || entry.kind !== 'directory')
        ) {
          conflictingPath = candidate;
          break;
        }
      }
      if (!conflictingPath) continue;
      blockers.push({
        operation: 'handoff',
        path: path.join(activePath, ...conflictingPath.split('/')),
        code: ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE,
        message: `Preserved handoff entry '${decision.path}' cannot project to '${projected}' because '${conflictingPath}' already exists.`,
      });
    }
  }

  const metadataEntry = entries.get('.openspec.yaml');
  if (qualityInputs.length > 0 && metadataEntry) {
    const metadataPath = path.join(activePath, '.openspec.yaml');
    if (metadataEntry.kind !== 'file') {
      blockers.push({
        operation: 'quality',
        path: metadataPath,
        code: ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE,
        message:
          'Active .openspec.yaml must contain a valid YAML mapping when quality evidence is present.',
      });
    } else {
      try {
        parseArchiveOpenSpecMetadata(await adapters.fs.readFile(metadataPath, 'utf8'));
      } catch (error) {
        blockers.push(blocker('quality', metadataPath, error));
      }
    }
  }

  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );
  return blockers;
}

async function resolveArchiveGitPlan(
  planningRoot: string,
  executionRoot: string,
  adapters: ArchiveEngineAdapters
): Promise<{ git: ArchivePlan['git']; blockers: ArchiveBlocker[] }> {
  const blockers: ArchiveBlocker[] = [];
  const git: ArchivePlan['git'] = {
    execution: { state: 'error', codeCommit: null },
    planning: { state: 'error', branch: null, treeState: 'clean' },
  };
  try {
    const state = await adapters.git.state(executionRoot);
    if (state === 'non-git') {
      git.execution = { state, codeCommit: null };
    } else {
      const commit = await adapters.git.exec(executionRoot, [
        'rev-parse',
        '--verify',
        'HEAD^{commit}',
      ]);
      if (!/^[0-9a-f]{40}$/i.test(commit)) {
        throw new Error('Git returned a non-full execution commit.');
      }
      git.execution = { state, codeCommit: commit.toLowerCase() };
    }
  } catch (error) {
    blockers.push(blocker('git', executionRoot, error));
  }
  try {
    const state = await adapters.git.state(planningRoot);
    if (state === 'non-git') {
      git.planning = { state, branch: null, treeState: 'clean' };
    } else {
      const [branchValue, status] = await Promise.all([
        adapters.git.exec(planningRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
        adapters.git.exec(planningRoot, ['status', '--porcelain']),
      ]);
      git.planning = {
        state,
        branch: branchValue === 'HEAD' ? null : branchValue,
        treeState: status.length > 0 ? 'dirty' : 'clean',
      };
    }
  } catch (error) {
    blockers.push(blocker('git', planningRoot, error));
  }
  return { git, blockers };
}

function archiveDeltaSourcesFromFingerprint(
  activePath: string,
  fingerprint: ArchiveTreeFingerprint | null
): string[] {
  if (fingerprint === null) return [];
  return fingerprint.entries
    .filter(entry => {
      const relative = normalizeRelative(entry.path);
      return (
        entry.kind === 'file' &&
        relative.startsWith('specs/') &&
        path.posix.basename(relative) === 'spec.md'
      );
    })
    .map(entry =>
      path.resolve(activePath, ...normalizeRelative(entry.path).split('/'))
    )
    .sort();
}
async function ensureArchiveRealDirectoryChain(
  root: string,
  targetDirectory: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveDirectoryIdentityBinding[]> {
  const relative = path.relative(root, targetDirectory);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw archiveSpecPathSafetyError(
      targetDirectory,
      'Archive spec target directory escapes its canonical root'
    );
  }
  const segments = relative.split(path.sep).filter(Boolean);
  const directories = [
    root,
    ...segments.map((_segment, index) =>
      path.join(root, ...segments.slice(0, index + 1))
    ),
  ];
  const bindings: ArchiveDirectoryIdentityBinding[] = [];
  for (const directory of directories) {
    if (bindings.length > 0) {
      await requireArchiveRealDirectoryChain(bindings, adapters);
    }
    let stat: ArchiveFsStat;
    try {
      stat = await adapters.fs.lstat(directory);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' || bindings.length === 0) throw error;
      await requireArchiveRealDirectoryChain(bindings, adapters);
      try {
        await adapters.fs.mkdir(directory);
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== 'EEXIST') throw mkdirError;
      }
      await requireArchiveRealDirectoryChain(bindings, adapters);
      stat = await adapters.fs.lstat(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw archiveSpecPathSafetyError(
        directory,
        'Archive spec target ancestry must contain only real directories'
      );
    }
    bindings.push({
      path: directory,
      identity: archiveDeletionIdentity(stat, 'directory'),
    });
  }
  return bindings;
}

function archiveSpecSyncManifestIssue(
  activePath: string,
  fingerprint: ArchiveTreeFingerprint | null,
  preparation: ArchiveSpecSyncPreparation,
  actions: readonly PreparedArchiveSpecAction[]
): string | null {
  const current = archiveDeltaSourcesFromFingerprint(activePath, fingerprint);
  const prepared = preparation.deltaSources.map(source => path.resolve(source)).sort();
  if (
    new Set(prepared).size !== prepared.length ||
    stableArchiveJson(prepared) !== stableArchiveJson(current)
  ) {
    return 'Delta spec set changed after spec action preparation.';
  }
  const actionSources = actions.map(action => path.resolve(action.source)).sort();
  if (preparation.mode === 'apply') {
    if (
      new Set(actionSources).size !== actionSources.length ||
      stableArchiveJson(actionSources) !== stableArchiveJson(current)
    ) {
      return 'Prepared spec actions do not exhaustively cover the current delta spec set.';
    }
    return null;
  }
  if (actionSources.length > 0) {
    return `Spec sync mode '${preparation.mode}' cannot carry prepared actions.`;
  }
  if (preparation.mode === 'no-deltas' && current.length > 0) {
    return 'Spec sync was prepared as no-deltas, but delta specs now exist.';
  }
  return null;
}

function expectedArchiveSpecActionPaths(
  planningRoot: string,
  activePath: string,
  scope: ArchivePlan['scope'],
  action: Pick<PreparedArchiveSpecAction, 'capability'>
): { source: string; target: string } | null {
  let canonicalSpecsRoot: string;
  const capabilitySegments = action.capability.split('/');
  if (
    action.capability.length === 0 ||
    path.isAbsolute(action.capability) ||
    /^[a-z]:[\\/]/iu.test(action.capability) ||
    action.capability.includes('\\') ||
    action.capability.includes('\0') ||
    capabilitySegments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    return null;
  }
  try {
    for (const segment of capabilitySegments) {
      parseChangeId(segment, 'capability');
    }
    canonicalSpecsRoot =
      scope?.kind === 'store-project'
        ? resolveStorePlanningLayoutV2Path(planningRoot, {
            kind: 'project-specs',
            projectId: scope.projectId ?? '',
          })
        : path.join(planningRoot, 'rasen', 'specs');
  } catch {
    return null;
  }
  return {
    source: path.join(activePath, 'specs', action.capability, 'spec.md'),
    target: path.join(canonicalSpecsRoot, action.capability, 'spec.md'),
  };
}

function archiveSpecActionPathsAuthorized(
  planningRoot: string,
  activePath: string,
  scope: ArchivePlan['scope'],
  action: Pick<PreparedArchiveSpecAction, 'capability' | 'source' | 'target'>
): boolean {
  const expected = expectedArchiveSpecActionPaths(
    planningRoot,
    activePath,
    scope,
    action
  );
  return (
    expected !== null &&
    pathIdentityEquals(action.source, expected.source) &&
    pathIdentityEquals(action.target, expected.target)
  );
}

function archiveSpecPathSafetyError(target: string, detail: string): Error {
  const error = new Error(`${detail}: ${target}`);
  (error as NodeJS.ErrnoException).code = 'archive_spec_path_unauthorized';
  return error;
}

async function assertArchivePathHasNoSymlinkAncestry(
  root: string,
  target: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep).filter(Boolean);
  const candidates = [
    root,
    ...segments.map((_segment, index) =>
      path.join(root, ...segments.slice(0, index + 1))
    ),
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    let stat: ArchiveFsStat;
    try {
      stat = await adapters.fs.lstat(candidate);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    const final = index === candidates.length - 1;
    if (
      stat.isSymbolicLink() ||
      (final ? !stat.isFile() : !stat.isDirectory())
    ) {
      throw archiveSpecPathSafetyError(
        candidate,
        final
          ? 'Archive spec path must end at a regular file or remain absent'
          : 'Archive spec path ancestry must contain only real directories'
      );
    }
  }
}

interface ArchiveDirectoryIdentityBinding {
  path: string;
  identity: ArchiveStatIdentity;
}

function archiveSpecCanonicalTargetRoot(
  action: Pick<PreparedArchiveSpecAction, 'capability' | 'target'>
): string {
  return action.capability
    .split('/')
    .reduce(root => path.dirname(root), path.dirname(action.target));
}

async function bindArchiveRealDirectoryChain(
  root: string,
  targetDirectory: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveDirectoryIdentityBinding[]> {
  const relative = path.relative(root, targetDirectory);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw archiveSpecPathSafetyError(
      targetDirectory,
      'Archive spec target parent escapes its canonical specs root'
    );
  }
  const segments = relative.split(path.sep).filter(Boolean);
  const directories = [
    root,
    ...segments.map((_segment, index) =>
      path.join(root, ...segments.slice(0, index + 1))
    ),
  ];
  const bindings: ArchiveDirectoryIdentityBinding[] = [];
  for (const directory of directories) {
    const stat = await adapters.fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw archiveSpecPathSafetyError(
        directory,
        'Archive spec target ancestry must contain only real directories'
      );
    }
    bindings.push({
      path: directory,
      identity: archiveDeletionIdentity(stat, 'directory'),
    });
  }
  return bindings;
}

async function requireArchiveRealDirectoryChain(
  bindings: readonly ArchiveDirectoryIdentityBinding[],
  adapters: ArchiveEngineAdapters
): Promise<void> {
  for (const binding of bindings) {
    let stat: ArchiveFsStat;
    try {
      stat = await adapters.fs.lstat(binding.path);
    } catch (error) {
      throw archiveSpecPathSafetyError(
        binding.path,
        `Archive spec target ancestry is unavailable (${error instanceof Error ? error.message : String(error)})`
      );
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stableArchiveJson(archiveDeletionIdentity(stat, 'directory')) !==
        stableArchiveJson(binding.identity)
    ) {
      throw archiveSpecPathSafetyError(
        binding.path,
        'Archive spec target ancestry identity changed before mutation'
      );
    }
  }
}

async function assertArchiveSpecActionFilesystemPaths(
  planningRoot: string,
  activePath: string,
  scope: ArchivePlan['scope'],
  actions: readonly PreparedArchiveSpecAction[],
  adapters: ArchiveEngineAdapters
): Promise<void> {
  for (const action of actions) {
    const expected = expectedArchiveSpecActionPaths(
      planningRoot,
      activePath,
      scope,
      action
    );
    if (expected === null) {
      throw archiveSpecPathSafetyError(
        action.target,
        'Archive spec capability is not a canonical capability id'
      );
    }
    await assertArchivePathHasNoSymlinkAncestry(
      path.join(activePath, 'specs'),
      expected.source,
      adapters
    );
    await assertArchivePathHasNoSymlinkAncestry(
      archiveSpecCanonicalTargetRoot(action),
      expected.target,
      adapters
    );
  }
}

/**
 * First mutation-free planner seam. Validation/spec preparation and strict
 * sidecar resolution are supplied as already-read facts so adapters can be
 * tested independently; no apply action is performed here.
 */
export async function createArchivePlan(
  input: CreateArchivePlanInput,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchivePlan> {
  const shipLog: ArchivePlan['shipLog'] = input.shipLog ?? {
    source: null,
    sha256: null,
    recordedCommit: null,
    reservedSection: false,
  };
  const blockers: ArchiveBlocker[] = [
    ...input.sidecar.blockers,
    ...(input.preparationBlockers ?? []),
    ...(shipLog.reservedSection
      ? [
          {
            operation: 'evidence' as const,
            path: shipLog.source ?? input.activePath,
            code: ARCHIVE_SHIP_LOG_RESERVED_SECTION_CODE,
            message:
              'Remove or rename the change-authored "## Archive" section; that heading is reserved for archive transaction evidence.',
          },
        ]
      : []),
  ];
  const transactionId = input.transactionId ?? adapters.transactionId();
  const transactionPaths = resolveArchiveTransactionPaths(
    input.archiveParent,
    input.date,
    input.change,
    transactionId,
    path,
    input.finalization === undefined
      ? {}
      : { finalPath: input.finalization.destination }
  );
  const archivePathProjection = await inspectArchivePathAuthority(
    input.planningRoot,
    transactionPaths.archiveParent,
    adapters
  );
  blockers.push(...archivePathProjection.blockers);
  let sourceFingerprint: ArchiveTreeFingerprint | null = null;
  let source: ArchivePlan['preconditions']['source'] = 'missing';
  try {
    const stat = await adapters.fs.lstat(input.activePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      source = 'invalid';
      blockers.push({
        operation: 'source-lstat',
        path: input.activePath,
        message: 'Active change source must be a real directory.',
      });
    } else {
      source = 'directory';
      sourceFingerprint = await fingerprintArchiveTree(input.activePath, adapters);
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      blockers.push({
        operation: 'source-lstat',
        path: input.activePath,
        code: 'ENOENT',
        message: `Active change source does not exist: ${input.activePath}`,
      });
    } else {
      source = 'error';
      blockers.push(blocker('source-inventory', input.activePath, error));
    }
  }

  const finalPath = transactionPaths.final;
  let target: ArchivePlan['preconditions']['target'] = 'absent';
  try {
    await adapters.fs.lstat(finalPath);
    target = 'present';
    blockers.push({
      operation: 'target-lstat',
      path: finalPath,
      code: 'EEXIST',
      message: `Archive target already exists: ${finalPath}`,
    });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      target = 'error';
      blockers.push(blocker('target-lstat', finalPath, error));
    }
  }

  const cleanerClassification = await adapters.classifyEphemera(input.ephemeraPath);
  const cleaner = projectArchiveCleaner(cleanerClassification, input.keepEphemera);
  for (const cleanerBlocker of cleaner.classification.blockers) {
    blockers.push({
      operation: 'cleaner',
      path: cleanerBlocker.path,
      ...(cleanerBlocker.code ? { code: cleanerBlocker.code } : {}),
      message: cleanerBlocker.message,
    });
  }
  if (!cleaner.classification.complete) {
    blockers.push({
      operation: 'cleaner',
      path: input.ephemeraPath,
      message: 'Ephemera classification is incomplete.',
    });
  }
  if (input.validation === 'blocked') {
    blockers.push({
      operation: 'validation',
      path: input.activePath,
      message: 'Archive validation did not pass.',
    });
  }
  if (input.tasks.completed < input.tasks.total && !input.tasks.override) {
    blockers.push({
      operation: 'tasks',
      path: input.activePath,
      message: `${input.tasks.total - input.tasks.completed} task(s) are incomplete.`,
    });
  }
  if (
    input.timing.mode === 'on-merge' &&
    input.timing.deliveryMode === 'pr' &&
    !input.timing.override
  ) {
    blockers.push({
      code: ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE,
      operation: 'timing',
      path: input.activePath,
      message: ARCHIVE_MERGE_CONFIRMATION_BLOCKER_MESSAGE,
    });
  }

  const discoveredInputs =
    source === 'directory'
      ? await discoverArchiveEvidenceInputs(
          input.activePath,
          input.sidecar,
          adapters
        )
      : {
          evidenceInputs: [] as string[],
          qualityInputs: [] as ArchiveQualityInput[],
          blockers: [] as ArchiveBlocker[],
        };
  blockers.push(...discoveredInputs.blockers);
  const qualityInputs = [
    ...(input.qualityInputs ?? discoveredInputs.qualityInputs),
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (sourceFingerprint) {
    blockers.push(
      ...(await deterministicArchiveInputBlockers(
        input.activePath,
        sourceFingerprint,
        input.sidecar,
        qualityInputs,
        adapters
      ))
    );
  }
  const gitPlan = await resolveArchiveGitPlan(
    input.planningRoot,
    input.executionRoot,
    adapters
  );
  blockers.push(...gitPlan.blockers);
  const specSync: ArchiveSpecSyncPreparation =
    input.specSync === undefined
      ? {
          mode: input.specActions.length > 0 ? 'apply' : 'no-deltas',
          deltaSources:
            input.specActions.length > 0
              ? input.specActions.map(action => path.resolve(action.source)).sort()
              : [],
        }
      : {
          mode: input.specSync.mode,
          deltaSources: input.specSync.deltaSources
            .map(sourcePath => path.resolve(sourcePath))
            .sort(),
        };
  const specSyncIssue = archiveSpecSyncManifestIssue(
    input.activePath,
    sourceFingerprint,
    specSync,
    input.specActions
  );
  if (specSyncIssue !== null) {
    blockers.push({
      operation: 'spec',
      path: path.join(input.activePath, 'specs'),
      code: 'archive_spec_manifest_stale',
      message: specSyncIssue,
    });
  }
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) || left.path.localeCompare(right.path)
  );
  const stage = transactionPaths.stage;
  const normalizedSpecActions: PreparedArchiveSpecAction[] = [];
  for (const rawAction of [...input.specActions].sort((left, right) =>
    left.target.localeCompare(right.target)
  )) {
    if (
      !archiveSpecActionPathsAuthorized(
        input.planningRoot,
        input.activePath,
        input.scope,
        rawAction
      )
    ) {
      blockers.push({
        operation: 'spec',
        path: rawAction.target,
        code: 'archive_spec_path_unauthorized',
        message:
          'Archive spec actions must bind the active change delta spec.md to the matching canonical capability spec.md.',
      });
      continue;
    }
    try {
      await assertArchiveSpecActionFilesystemPaths(
        input.planningRoot,
        input.activePath,
        input.scope,
        [rawAction],
        adapters
      );
    } catch (error) {
      blockers.push(blocker('spec', rawAction.target, error));
      continue;
    }
    let sourceBytes: Buffer;
    try {
      sourceBytes = await adapters.fs.readFile(rawAction.source);
    } catch (error) {
      blockers.push(
        blocker(
          'spec',
          rawAction.source,
          errorCode(error) === 'ENOENT'
            ? staleArchiveObject(
                rawAction.source,
                'Delta spec disappeared after reconciliation'
              )
            : error
        )
      );
      continue;
    }
    if (adapters.sha256(sourceBytes) !== rawAction.sourceSha256) {
      blockers.push({
        operation: 'spec',
        path: rawAction.source,
        code: 'ESTALE',
        message: `Delta spec changed after reconciliation: ${rawAction.source}`,
      });
      continue;
    }

    try {
      let targetPrecondition = rawAction.targetPrecondition;
      if (targetPrecondition.state === 'absent') {
        try {
          await adapters.fs.lstat(rawAction.target);
          throw staleArchiveObject(
            rawAction.target,
            'Canonical spec appeared after reconciliation'
          );
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error;
        }
      } else {
        const targetStat = await adapters.fs.lstat(rawAction.target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
          throw staleArchiveObject(
            rawAction.target,
            'Canonical spec is no longer a real file'
          );
        }
        const targetBytes = await adapters.fs.readFile(rawAction.target);
        if (adapters.sha256(targetBytes) !== targetPrecondition.sha256) {
          throw staleArchiveObject(
            rawAction.target,
            'Canonical spec changed after reconciliation'
          );
        }
        const verifiedStat = await adapters.fs.lstat(rawAction.target);
        if (!identityMatches(targetStat, verifiedStat)) {
          throw staleArchiveObject(
            rawAction.target,
            'Canonical spec identity changed during archive planning'
          );
        }

        const capabilityTree =
          rawAction.action === 'delete'
            ? await fingerprintArchiveTree(
                path.dirname(rawAction.target),
                adapters
              )
            : undefined;
        if (capabilityTree !== undefined) {
          const finalBytes = await adapters.fs.readFile(rawAction.target);
          const finalStat = await adapters.fs.lstat(rawAction.target);
          if (
            adapters.sha256(finalBytes) !== targetPrecondition.sha256 ||
            !identityMatches(verifiedStat, finalStat)
          ) {
            throw staleArchiveObject(
              rawAction.target,
              'Canonical spec changed while attaching delete authority'
            );
          }
        }

        targetPrecondition = {
          ...targetPrecondition,
          identity: archiveDeletionIdentity(verifiedStat, 'file'),
          ...(capabilityTree === undefined ? {} : { capabilityTree }),
        };
      }
      await assertArchiveSpecActionFilesystemPaths(
        input.planningRoot,
        input.activePath,
        input.scope,
        [rawAction],
        adapters
      );
      const actionWithoutId = {
        ...rawAction,
        targetPrecondition,
      };
      normalizedSpecActions.push({
        ...actionWithoutId,
        actionId:
          rawAction.actionId ??
          adapters.sha256(
            stableArchiveJson({
              ...actionWithoutId,
              source: path.resolve(rawAction.source),
              target: path.resolve(rawAction.target),
            })
          ),
      });
    } catch (error) {
      blockers.push(
        blocker(
          'spec',
          rawAction.target,
          errorCode(error) === 'ENOENT'
            ? staleArchiveObject(
                rawAction.target,
                'Canonical spec disappeared after reconciliation'
              )
            : error
        )
      );
    }
  }
  blockers.sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) ||
      left.path.localeCompare(right.path)
  );
  const actions: ArchivePlan['actions'] = [];
  for (const specAction of normalizedSpecActions) {
    actions.push({
      order: actions.length + 1,
      kind: specAction.action === 'delete' ? 'delete-spec' : 'write-spec',
      path: specAction.target,
    });
  }
  for (const action of [
    ['create-stage', stage],
    ['copy-payload', input.activePath],
    ['apply-handoff', path.join(stage, 'handoff')],
    ['finalize-ship-log', path.join(stage, 'evidence', 'ship-log.md')],
    ['capture-quality', path.join(stage, 'evidence')],
    ['publish', finalPath],
    ['clean-ephemera', input.ephemeraPath],
    ['write-accounting', path.join(finalPath, 'archive.json')],
    ...(input.finalization === undefined
      ? []
      : ([
          [
            'finalize-association',
            input.finalization.association.executionAssociationPath ?? finalPath,
          ],
        ] as const)),
    ['remove-active', input.activePath],
    ['complete-journal', path.join(finalPath, ARCHIVE_JOURNAL_FILENAME)],
  ] as const) {
    actions.push({ order: actions.length + 1, kind: action[0], path: action[1] });
  }

  const withoutHash: Omit<ArchivePlan, 'planHash'> = {
    schemaVersion: ARCHIVE_PLAN_VERSION,
    transactionId,
    change: input.change,
    createdAt: input.createdAt ?? adapters.now().toISOString(),
    roots: {
      planning: path.resolve(input.planningRoot),
      execution: path.resolve(input.executionRoot),
    },
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.finalization === undefined ? {} : { finalization: input.finalization }),
    paths: {
      active: path.resolve(input.activePath),
      archiveParent: transactionPaths.archiveParent,
      stage,
      final: finalPath,
      journal: transactionPaths.journal,
      publishedJournal: transactionPaths.publishedJournal,
      ephemera: path.resolve(input.ephemeraPath),
    },
    archivePathAuthority: archivePathProjection.authority,
    sourceFingerprint,
    git: gitPlan.git,
    preconditions: { source, target },
    decisions: {
      validation: input.validation,
      tasks: input.tasks,
      timing: input.timing,
      specSync,
    },
    specActions: normalizedSpecActions,
    sidecar: input.sidecar,
    cleaner,
    qualityInputs,
    evidenceInputs: [...(input.evidenceInputs ?? discoveredInputs.evidenceInputs)].sort(),
    shipLog,
    actions,
    blockers,
    complete:
      source === 'directory' &&
      target === 'absent' &&
      cleaner.classification.complete &&
      blockers.length === 0,
  };

  return {
    ...withoutHash,
    planHash: hashArchivePlan(withoutHash, adapters),
  };
}

function planWithoutHash(plan: ArchivePlan): Omit<ArchivePlan, 'planHash'> {
  const { planHash: _planHash, ...withoutHash } = plan;
  return withoutHash;
}

function planIdentityValid(plan: ArchivePlan, adapters: ArchiveEngineAdapters): boolean {
  const supportedVersion =
    plan.schemaVersion === ARCHIVE_PLAN_VERSION ||
    (plan.schemaVersion === 1 &&
      plan.finalization === undefined &&
      plan.scope?.kind !== 'store-project');
  const requiredVersionedFieldsPresent =
    plan.schemaVersion === 1 ||
    (plan.decisions.specSync !== undefined &&
      Array.isArray(
        (
          plan as ArchivePlan & {
            archivePathAuthority?: ArchiveAuthorityEntry[];
          }
        ).archivePathAuthority
      ));
  return (
    supportedVersion &&
    requiredVersionedFieldsPresent &&
    hashArchivePlan(planWithoutHash(plan), adapters) === plan.planHash
  );
}

function archivePlanToken(plan: Pick<ArchivePlan, 'transactionId' | 'planHash'>): string {
  return `${ARCHIVE_PLAN_TOKEN_PREFIX}:${plan.transactionId}:${plan.planHash}`;
}

function parseArchivePlanToken(token: string): {
  transactionId: string;
  planHash: string;
} {
  const match = token.match(/^archive-v1:([0-9a-f-]{36}):([0-9a-f]{64})$/i);
  if (!match) throw new Error('Invalid archive plan token.');
  return { transactionId: match[1], planHash: match[2].toLowerCase() };
}

function assertStoredArchivePlanPaths(plan: ArchivePlan): void {
  const absolute = [
    plan.roots.planning,
    plan.roots.execution,
    plan.paths.active,
    plan.paths.archiveParent,
    plan.paths.stage,
    plan.paths.final,
    plan.paths.journal,
    plan.paths.publishedJournal,
    plan.paths.ephemera,
  ];
  if (absolute.some(candidate => !path.isAbsolute(candidate))) {
    throw new Error('Stored archive plan contains a non-absolute path.');
  }
  if (
    plan.specActions.some(
      action =>
        !archiveSpecActionPathsAuthorized(
          plan.roots.planning,
          plan.paths.active,
          plan.scope,
          action
        )
    )
  ) {
    throw new Error(
      'Stored archive plan contains a spec action outside its authorized delta or canonical specs path.'
    );
  }
  const specSync = plan.decisions.specSync;
  if (specSync !== undefined) {
    if (specSync.deltaSources.some(source => !path.isAbsolute(source))) {
      throw new Error('Stored archive plan contains a non-absolute delta manifest path.');
    }
    const issue = archiveSpecSyncManifestIssue(
      plan.paths.active,
      plan.sourceFingerprint,
      specSync,
      plan.specActions
    );
    if (issue !== null) {
      throw new Error(`Stored archive plan has an invalid spec sync manifest: ${issue}`);
    }
  }
  const archiveAuthorization = plan.finalization?.revalidation.archive;
  let expectedStoreArchiveRoot: string | undefined;
  let expectedStoreRecordDestination: string | undefined;
  if (
    plan.finalization !== undefined &&
    archiveAuthorization !== undefined
  ) {
    try {
      const record = plan.finalization.record;
      const changeInstanceId = parseChangeInstanceId(
        record.changeInstanceId
      );
      expectedStoreArchiveRoot = resolveStorePlanningLayoutV2Path(
        plan.roots.planning,
        {
          kind: 'archive-line',
          projectId: record.projectId,
          targetLineId: record.targetLineId,
        }
      );
      expectedStoreRecordDestination = resolveStorePlanningLayoutV2Path(
        plan.roots.planning,
        {
          kind: 'archive-entry',
          projectId: record.projectId,
          targetLineId: record.targetLineId,
          changeId: record.changeId,
          archiveDate: archiveAuthorization.archiveDate,
          changeInstanceId,
        }
      );
    } catch {
      // Invalid Store identity or address input fails the authorization
      // predicate below; it is never repaired into an accepted plan.
    }
  }
  const storeProjectArchiveAllowed =
    plan.scope?.kind === 'store-project' &&
    plan.finalization !== undefined &&
    plan.scope.storeUid === plan.finalization.record.storeUid &&
    plan.scope.projectId === plan.finalization.record.projectId &&
    archiveAuthorization !== undefined &&
    expectedStoreArchiveRoot !== undefined &&
    expectedStoreRecordDestination !== undefined &&
    path.isAbsolute(archiveAuthorization.root) &&
    path.isAbsolute(archiveAuthorization.destination) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(archiveAuthorization.archiveDate) &&
    pathIdentityEquals(archiveAuthorization.root, expectedStoreArchiveRoot) &&
    pathIdentityEquals(
      archiveAuthorization.destination,
      expectedStoreRecordDestination
    ) &&
    pathIdentityEquals(plan.paths.archiveParent, archiveAuthorization.root) &&
    pathIdentityEquals(
      plan.paths.final,
      archiveAuthorization.destination
    ) &&
    pathIdentityEquals(
      plan.finalization.destination,
      archiveAuthorization.destination
    ) &&
    pathIdentityEquals(
      path.dirname(archiveAuthorization.destination),
      archiveAuthorization.root
    );
  const finalizationScopeConsistent =
    (plan.scope?.kind === 'store-project') ===
    (plan.finalization !== undefined);
  const archiveParentAllowed =
    plan.scope?.kind === 'store-project'
      ? storeProjectArchiveAllowed
      : isArchiveContainedPath(plan.roots.planning, plan.paths.archiveParent);
  const archivePathAuthority = (
    plan as ArchivePlan & {
      archivePathAuthority?: ArchiveAuthorityEntry[];
    }
  ).archivePathAuthority;
  const archiveAuthorityPaths = new Set<string>();
  const archivePathAuthorityValid =
    (plan.schemaVersion === 1 && archivePathAuthority === undefined) ||
    (Array.isArray(archivePathAuthority) &&
      archivePathAuthority.length > 0 &&
      archivePathAuthority.every(entry => {
        if (
          entry.kind !== 'directory' ||
          !path.isAbsolute(entry.path) ||
          !isArchiveContainedPath(plan.roots.planning, entry.path) ||
          !isArchiveStatIdentityRecord(entry.identity) ||
          archiveAuthorityPaths.has(entry.path)
        ) {
          return false;
        }
        archiveAuthorityPaths.add(entry.path);
        return true;
      }));
  if (
    !archivePathAuthorityValid ||
    !finalizationScopeConsistent ||
    !isArchiveContainedPath(plan.roots.planning, plan.paths.active) ||
    !archiveParentAllowed ||
    !isArchiveContainedPath(plan.roots.execution, plan.paths.ephemera) ||
    path.dirname(plan.paths.stage) !== plan.paths.archiveParent ||
    path.dirname(plan.paths.final) !== plan.paths.archiveParent ||
    plan.paths.journal !== path.join(plan.paths.stage, ARCHIVE_JOURNAL_FILENAME) ||
    plan.paths.publishedJournal !==
      path.join(plan.paths.final, ARCHIVE_JOURNAL_FILENAME) ||
    path.basename(plan.paths.stage) !==
      `.rasen-archive-stage-${plan.transactionId}`
  ) {
    throw new Error('Stored archive plan path containment or transaction binding is invalid.');
  }
}

/**
 * Persist the exact reviewed plan in the machine-owned transaction store.
 * The transaction directory is exclusively reserved, so its final rename
 * cannot clobber another plan.
 */
export async function persistArchivePlan(
  plan: ArchivePlan,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<string> {
  if (!planIdentityValid(plan, adapters)) {
    throw new Error('Cannot persist an archive plan with an invalid canonical hash.');
  }
  assertStoredArchivePlanPaths(plan);
  const transactionsRoot = path.resolve(globalDataDir, 'archive-transactions');
  const transactionDirectory = path.join(transactionsRoot, plan.transactionId);
  const planPath = path.join(transactionDirectory, 'plan.json');
  await adapters.fs.mkdir(transactionsRoot, { recursive: true });
  try {
    await adapters.fs.mkdir(transactionDirectory);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    const existing = await loadStoredArchivePlan(archivePlanToken(plan), globalDataDir, adapters);
    if (stableArchiveJson(existing) === stableArchiveJson(plan)) {
      return archivePlanToken(plan);
    }
    throw new Error(`Archive transaction store collision: ${transactionDirectory}`);
  }
  const envelope: StoredArchivePlanV1 = {
    schemaVersion: 1,
    kind: 'rasen.archive-plan',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    createdAt: plan.createdAt,
    plan,
  };
  await atomicWriteJson(planPath, envelope, plan.transactionId, adapters);
  return archivePlanToken(plan);
}

function parseStoredArchivePlanEnvelope(
  parsed: unknown,
  expected: { transactionId: string; planHash: string },
  planPath: string,
  adapters: ArchiveEngineAdapters
): ArchivePlan {
  if (
    !isPlainRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      'schemaVersion',
      'kind',
      'transactionId',
      'planHash',
      'createdAt',
      'plan',
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'rasen.archive-plan' ||
    parsed.transactionId !== expected.transactionId ||
    parsed.planHash !== expected.planHash ||
    typeof parsed.createdAt !== 'string' ||
    !isPlainRecord(parsed.plan)
  ) {
    const error = new Error(`Invalid stored archive plan envelope: ${planPath}`);
    (error as NodeJS.ErrnoException).code = 'archive_plan_envelope_invalid';
    throw error;
  }
  const plan = parsed.plan as unknown as ArchivePlan;
  if (parsed.createdAt !== plan.createdAt) {
    const error = new Error(
      `Stored archive plan envelope timestamp mismatch: ${planPath}`
    );
    (error as NodeJS.ErrnoException).code = 'archive_plan_envelope_invalid';
    throw error;
  }
  if (
    plan.transactionId !== expected.transactionId ||
    plan.planHash !== expected.planHash ||
    !planIdentityValid(plan, adapters)
  ) {
    const error = new Error(`Stored archive plan identity mismatch: ${planPath}`);
    (error as NodeJS.ErrnoException).code = 'archive_plan_envelope_invalid';
    throw error;
  }
  assertStoredArchivePlanPaths(plan);
  return plan;
}

async function readStoredArchivePlanEnvelope(
  expected: { transactionId: string; planHash: string },
  planPath: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchivePlan> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      (await readStableArchiveFile(planPath, adapters)).content.toString('utf8')
    ) as unknown;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw error;
    const invalid = new Error(`Invalid stored archive plan envelope: ${planPath}`);
    (invalid as NodeJS.ErrnoException).code = 'archive_plan_envelope_invalid';
    throw invalid;
  }
  return parseStoredArchivePlanEnvelope(parsed, expected, planPath, adapters);
}

export async function loadStoredArchivePlan(
  token: string,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchivePlan> {
  const parsedToken = parseArchivePlanToken(token);
  const planPath = path.join(
    path.resolve(globalDataDir, 'archive-transactions'),
    parsedToken.transactionId,
    'plan.json'
  );
  return readStoredArchivePlanEnvelope(parsedToken, planPath, adapters);
}

function storedArchiveTransactionDirectory(
  globalDataDir: string,
  transactionId: string
): string {
  return path.join(
    path.resolve(globalDataDir, 'archive-transactions'),
    transactionId
  );
}

const archivePlanOperationLockError = makeLockErrorFactory({
  createSubject: 'the archive plan operation lock file',
  busyMessage: 'Archive plan operation is busy.',
  code: 'archive_plan_operation_busy',
  target: 'archive.plan',
});

export async function withStoredArchivePlanOperation<T>(
  plan: ArchivePlan,
  globalDataDir: string,
  holder: 'apply' | 'abort',
  operation: () => Promise<T>
): Promise<T> {
  const transactionDirectory = storedArchiveTransactionDirectory(
    globalDataDir,
    plan.transactionId
  );
  return withOwnerAwareFileLock(
    {
      lockPath: path.join(transactionDirectory, 'operation.lock'),
      errorFor: archivePlanOperationLockError,
      holder: `archive-${holder}:${plan.transactionId}`,
      deadlineMs: 30_000,
    },
    async () => {
      const planPath = path.join(transactionDirectory, 'plan.json');
      const tombstonePath = path.join(transactionDirectory, 'abort.json');
      const tombstone = await readArchiveAbortTombstone(
        tombstonePath,
        defaultArchiveEngineAdapters
      );
      try {
        const storedPlan = await readStoredArchivePlanEnvelope(
          plan,
          planPath,
          defaultArchiveEngineAdapters
        );
        if (stableArchiveJson(storedPlan) !== stableArchiveJson(plan)) {
          const error = new Error(
            'The stored archive plan does not match the supplied immutable plan.'
          );
          (error as NodeJS.ErrnoException).code = 'archive_plan_envelope_invalid';
          throw error;
        }
      } catch (error) {
        const missingForCompletedAbort =
          errorCode(error) === 'ENOENT' &&
          planIdentityValid(plan, defaultArchiveEngineAdapters) &&
          tombstone?.status === 'aborted' &&
          tombstone.transactionId === plan.transactionId &&
          tombstone.planHash === plan.planHash &&
          tombstone.change === plan.change &&
          pathIdentityEquals(tombstone.stagePath, plan.paths.stage) &&
          pathIdentityEquals(tombstone.journalPath, plan.paths.journal);
        if (!missingForCompletedAbort) throw error;
      }
      if (holder === 'apply' && tombstone !== null) {
        const identityMatches =
          tombstone.transactionId === plan.transactionId &&
          tombstone.planHash === plan.planHash;
        const error = new Error(
          identityMatches
            ? tombstone.status === 'aborted'
              ? 'This archive plan was aborted and cannot be applied.'
              : 'This archive plan has an incomplete abort intent; resume the abort before applying.'
            : 'The archive abort tombstone does not belong to this plan.'
        );
        (error as NodeJS.ErrnoException).code = identityMatches
          ? tombstone.status === 'aborted'
            ? 'archive_plan_aborted'
            : 'archive_plan_abort_in_progress'
          : 'archive_abort_ownership_unverified';
        throw error;
      }
      return operation();
    }
  );
}

function isArchiveStatIdentityRecord(
  value: unknown
): value is ArchiveStatIdentity {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']) &&
    typeof value.dev === 'string' &&
    typeof value.ino === 'string' &&
    typeof value.mode === 'string' &&
    typeof value.size === 'string' &&
    typeof value.mtimeNs === 'string' &&
    typeof value.ctimeNs === 'string'
  );
}
function isArchiveAssociationCarrierIdentityRecord(
  value: unknown
): value is ArchiveAssociationCarrierIdentity {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, ['dev', 'ino', 'mode', 'size']) &&
    typeof value.dev === 'string' &&
    typeof value.ino === 'string' &&
    typeof value.mode === 'number' &&
    Number.isInteger(value.mode) &&
    typeof value.size === 'string'
  );
}


function isSafeArchiveAuthorityPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    return false;
  }
  const parts = value.split('/');
  return (
    normalizeRelative(value) === value &&
    parts.every(part => part.length > 0 && part !== '.' && part !== '..')
  );
}

function isArchiveTreeEntryRecord(value: unknown): value is ArchiveTreeEntry {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, [
      'path',
      'kind',
      'mode',
      'executable',
      'size',
      'sha256',
      'linkTarget',
    ]) &&
    isSafeArchiveAuthorityPath(value.path) &&
    (value.kind === 'file' ||
      value.kind === 'directory' ||
      value.kind === 'symlink') &&
    (value.mode === undefined || typeof value.mode === 'number') &&
    (value.executable === undefined ||
      typeof value.executable === 'boolean') &&
    (value.size === undefined || typeof value.size === 'string') &&
    (value.sha256 === undefined ||
      (typeof value.sha256 === 'string' &&
        /^[0-9a-f]{64}$/i.test(value.sha256))) &&
    (value.linkTarget === undefined || typeof value.linkTarget === 'string')
  );
}

function isArchiveAbortStageAuthority(
  value: unknown,
  adapters: ArchiveEngineAdapters
): value is ArchiveTreeFingerprint {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      'algorithm',
      'digest',
      'entries',
      'rootIdentity',
      'authorityDigest',
      'authorityEntries',
    ]) ||
    value.algorithm !== 'sha256' ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.digest) ||
    !Array.isArray(value.entries) ||
    !isArchiveStatIdentityRecord(value.rootIdentity) ||
    typeof value.authorityDigest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.authorityDigest) ||
    !Array.isArray(value.authorityEntries)
  ) {
    return false;
  }
  const entryPaths = new Set<string>();
  const entriesValid = value.entries.every(entry => {
    if (!isArchiveTreeEntryRecord(entry) || entryPaths.has(entry.path)) {
      return false;
    }
    entryPaths.add(entry.path);
    return true;
  });
  if (!entriesValid) return false;
  const authorityPaths = new Set<string>();
  const authorityEntriesValid = value.authorityEntries.every(entry => {
    if (
      !isPlainRecord(entry) ||
      !hasOnlyKeys(entry, ['path', 'kind', 'identity']) ||
      !isSafeArchiveAuthorityPath(entry.path) ||
      (entry.kind !== 'file' &&
        entry.kind !== 'directory' &&
        entry.kind !== 'symlink') ||
      !isArchiveStatIdentityRecord(entry.identity) ||
      authorityPaths.has(entry.path)
    ) {
      return false;
    }
    authorityPaths.add(entry.path);
    return true;
  });
  if (!authorityEntriesValid || authorityPaths.size !== entryPaths.size) {
    return false;
  }
  const authorityKinds = new Map(
    value.authorityEntries.map(entry => [entry.path, entry.kind] as const)
  );
  return (
    value.entries.every(entry => authorityKinds.get(entry.path) === entry.kind) &&
    value.digest === adapters.sha256(stableArchiveJson(value.entries)) &&
    value.authorityDigest ===
      adapters.sha256(
        stableArchiveJson({
          rootIdentity: value.rootIdentity,
          entries: value.authorityEntries,
        })
      )
  );
}

const ARCHIVE_JOURNAL_PHASES = [
  'planned',
  'staged',
  'handoff-finalized',
  'evidence-finalized',
  'specs-applied',
  'published',
  'cleaner-progress',
  'accounting-finalized',
  'association-finalized',
  'source-removed',
  'complete',
  'failed',
] as const satisfies readonly ArchiveJournalPhase[];

const ARCHIVE_RESUME_PHASES = ARCHIVE_JOURNAL_PHASES.filter(
  phase => phase !== 'failed'
);

const ARCHIVE_PHASE_FINGERPRINT_SCOPES = {
  'payload-copied': 'stage',
  'handoff-finalized': 'stage',
  'evidence-finalized': 'stage',
  'final-reserved': 'final',
  'accounting-finalized': 'final',
} as const;

function isArchiveJournalPhaseValue(
  value: unknown
): value is ArchiveJournalPhase {
  return (
    typeof value === 'string' &&
    ARCHIVE_JOURNAL_PHASES.some(phase => phase === value)
  );
}

function isArchiveResumePhaseValue(
  value: unknown
): value is Exclude<ArchiveJournalPhase, 'failed'> {
  return (
    typeof value === 'string' &&
    ARCHIVE_RESUME_PHASES.some(phase => phase === value)
  );
}

function invalidArchiveJournal(
  journalPath: string,
  value: unknown
): never {
  const suffix =
    isPlainRecord(value) && value.schemaVersion === 1
      ? ' Version 1 recovery state requires manual recovery; no destructive state is inferred.'
      : '';
  const error = new Error(`Invalid archive journal: ${journalPath}.${suffix}`);
  (error as NodeJS.ErrnoException).code = 'archive_journal_invalid';
  throw error;
}

function parseArchiveJournalV2(
  value: unknown,
  journalPath: string,
  adapters: ArchiveEngineAdapters
): ArchiveJournal {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'transactionId',
      'planHash',
      'change',
      'phase',
      'activePath',
      'stagePath',
      'finalPath',
      'ephemeraDisposed',
      'phaseFingerprints',
      'finalReservation',
      'specProgress',
      'cleanerProgress',
      'associationProgress',
      'sourceProgress',
      'updatedAt',
      'failure',
      'integrityFailure',
    ]) ||
    value.schemaVersion !== 2 ||
    typeof value.transactionId !== 'string' ||
    value.transactionId.length === 0 ||
    typeof value.planHash !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.planHash) ||
    typeof value.change !== 'string' ||
    value.change.length === 0 ||
    !isArchiveJournalPhaseValue(value.phase) ||
    typeof value.activePath !== 'string' ||
    !path.isAbsolute(value.activePath) ||
    typeof value.stagePath !== 'string' ||
    !path.isAbsolute(value.stagePath) ||
    path.basename(value.stagePath) !==
      `.rasen-archive-stage-${value.transactionId}` ||
    typeof value.finalPath !== 'string' ||
    !path.isAbsolute(value.finalPath) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.ephemeraDisposed) ||
    !isPlainRecord(value.phaseFingerprints) ||
    !isPlainRecord(value.finalReservation) ||
    !Array.isArray(value.specProgress) ||
    !Array.isArray(value.cleanerProgress) ||
    !isPlainRecord(value.sourceProgress)
  ) {
    return invalidArchiveJournal(journalPath, value);
  }

  const ephemeraPaths = new Set<string>();
  for (const disposed of value.ephemeraDisposed) {
    if (
      !isSafeArchiveAuthorityPath(disposed) ||
      ephemeraPaths.has(disposed)
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    ephemeraPaths.add(disposed);
  }

  for (const [name, fingerprint] of Object.entries(value.phaseFingerprints)) {
    if (
      !Object.prototype.hasOwnProperty.call(
        ARCHIVE_PHASE_FINGERPRINT_SCOPES,
        name
      ) ||
      !isPlainRecord(fingerprint) ||
      !hasOnlyKeys(fingerprint, [
        'state',
        'scope',
        'before',
        'expectedAfter',
        'observedAfter',
        'temporary',
      ])
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    const expectedScope =
      ARCHIVE_PHASE_FINGERPRINT_SCOPES[
        name as keyof typeof ARCHIVE_PHASE_FINGERPRINT_SCOPES
      ];
    if (
      (fingerprint.state !== 'intent' &&
        fingerprint.state !== 'verified') ||
      fingerprint.scope !== expectedScope ||
      !isArchiveAbortStageAuthority(fingerprint.before, adapters) ||
      !isArchiveAbortStageAuthority(fingerprint.expectedAfter, adapters) ||
      (fingerprint.observedAfter !== undefined &&
        !isArchiveAbortStageAuthority(
          fingerprint.observedAfter,
          adapters
        )) ||
      (fingerprint.temporary !== undefined &&
        (name !== 'accounting-finalized' ||
          fingerprint.state !== 'intent' ||
          !path.isAbsolute(fingerprint.temporary.path) ||
          !isArchiveStatIdentityRecord(fingerprint.temporary.identity))) ||
      (fingerprint.state === 'intent' &&
        fingerprint.observedAfter !== undefined) ||
      (fingerprint.state === 'verified' &&
        (fingerprint.observedAfter === undefined ||
          !archivePayloadFingerprintMatches(
            fingerprint.observedAfter as ArchiveTreeFingerprint,
            fingerprint.expectedAfter
          )))
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
  }

  if (
    !hasOnlyKeys(value.finalReservation, ['state', 'identity', 'entries']) ||
    (value.finalReservation.state !== 'none' &&
      value.finalReservation.state !== 'intent-durable' &&
      value.finalReservation.state !== 'owned') ||
    (value.finalReservation.identity !== null &&
      !isArchiveStatIdentityRecord(value.finalReservation.identity)) ||
    !Array.isArray(value.finalReservation.entries)
  ) {
    return invalidArchiveJournal(journalPath, value);
  }
  const reservedPaths = new Set<string>();
  for (const entry of value.finalReservation.entries) {
    if (
      !isPlainRecord(entry) ||
      !hasOnlyKeys(entry, [
        'path',
        'kind',
        'expected',
        'state',
        'identity',
      ]) ||
      !isSafeArchiveAuthorityPath(entry.path) ||
      reservedPaths.has(entry.path) ||
      (entry.kind !== 'file' &&
        entry.kind !== 'directory' &&
        entry.kind !== 'symlink') ||
      !isArchiveTreeEntryRecord(entry.expected) ||
      entry.expected.path !== entry.path ||
      entry.expected.kind !== entry.kind ||
      (entry.state !== 'intent' && entry.state !== 'copied') ||
      (entry.identity !== undefined &&
        !isArchiveStatIdentityRecord(entry.identity)) ||
      (entry.state === 'intent' && entry.identity !== undefined) ||
      (entry.state === 'copied' && entry.identity === undefined)
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    reservedPaths.add(entry.path);
  }
  if (
    (value.finalReservation.state === 'owned') !==
      (value.finalReservation.identity !== null) ||
    (value.finalReservation.state !== 'owned' &&
      value.finalReservation.entries.length > 0)
  ) {
    return invalidArchiveJournal(journalPath, value);
  }

  const specActionIds = new Set<string>();
  const specProgressStates = new Set([
    'pending',
    'intent-durable',
    'claimed',
    'published',
    'verified',
    'complete',
    'conflict',
    'failed',
  ]);
  for (const progress of value.specProgress) {
    if (
      !isPlainRecord(progress) ||
      !hasOnlyKeys(progress, [
        'actionId',
        'action',
        'target',
        'backupOrQuarantine',
        'temporary',
        'claimIdentity',
        'temporaryIdentity',
        'publishedIdentity',
        'state',
        'error',
      ]) ||
      typeof progress.actionId !== 'string' ||
      progress.actionId.length === 0 ||
      specActionIds.has(progress.actionId) ||
      (progress.action !== 'create' &&
        progress.action !== 'update' &&
        progress.action !== 'delete') ||
      typeof progress.target !== 'string' ||
      !path.isAbsolute(progress.target) ||
      (progress.backupOrQuarantine !== null &&
        (typeof progress.backupOrQuarantine !== 'string' ||
          !path.isAbsolute(progress.backupOrQuarantine))) ||
      (progress.temporary !== null &&
        (typeof progress.temporary !== 'string' ||
          !path.isAbsolute(progress.temporary))) ||
      (progress.claimIdentity !== undefined &&
        !isArchiveStatIdentityRecord(progress.claimIdentity)) ||
      (progress.temporaryIdentity !== undefined &&
        !isArchiveStatIdentityRecord(progress.temporaryIdentity)) ||
      (progress.publishedIdentity !== undefined &&
        !isArchiveStatIdentityRecord(progress.publishedIdentity)) ||
      typeof progress.state !== 'string' ||
      !specProgressStates.has(progress.state) ||
      (progress.error !== undefined && typeof progress.error !== 'string')
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    const hasError =
      typeof progress.error === 'string' && progress.error.length > 0;
    const isErrorState =
      progress.state === 'conflict' || progress.state === 'failed';
    const hasClaim = progress.claimIdentity !== undefined;
    const hasTemporaryIdentity = progress.temporaryIdentity !== undefined;
    const hasPublishedIdentity = progress.publishedIdentity !== undefined;
    const isPending = progress.state === 'pending';
    const pathsAgreeWithAction =
      (progress.action === 'create'
        ? progress.backupOrQuarantine === null
        : typeof progress.backupOrQuarantine === 'string') &&
      (progress.action === 'delete'
        ? progress.temporary === null
        : typeof progress.temporary === 'string');
    const claimedStateAgrees =
      progress.state !== 'claimed' ||
      (hasClaim &&
        !hasPublishedIdentity &&
        (progress.action === 'delete'
          ? !hasTemporaryIdentity
          : hasTemporaryIdentity));
    const publishedStateAgrees =
      (progress.state !== 'published' &&
        progress.state !== 'verified' &&
        progress.state !== 'complete') ||
      (progress.action === 'delete'
        ? progress.state === 'complete' &&
          hasClaim &&
          !hasTemporaryIdentity &&
          !hasPublishedIdentity
        : hasClaim && hasTemporaryIdentity && hasPublishedIdentity);
    if (
      hasError !== isErrorState ||
      (isPending &&
        (progress.backupOrQuarantine !== null ||
          progress.temporary !== null ||
          hasClaim ||
          hasTemporaryIdentity ||
          hasPublishedIdentity)) ||
      (!isPending && !pathsAgreeWithAction) ||
      (hasTemporaryIdentity && !hasClaim) ||
      (hasPublishedIdentity && (!hasClaim || !hasTemporaryIdentity)) ||
      (progress.action === 'delete' &&
        (hasTemporaryIdentity || hasPublishedIdentity)) ||
      (progress.state === 'intent-durable' && hasPublishedIdentity) ||
      !claimedStateAgrees ||
      !publishedStateAgrees
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    specActionIds.add(progress.actionId);
  }

  const cleanerPaths = new Set<string>();
  const cleanerProgressStates = new Set([
    'pending',
    'delete-intent',
    'deleted',
    'deleted-after-intent',
    'already-absent',
    'conflict',
    'failed',
  ]);
  for (const progress of value.cleanerProgress) {
    if (
      !isPlainRecord(progress) ||
      !hasOnlyKeys(progress, ['path', 'state', 'error']) ||
      !isSafeArchiveAuthorityPath(progress.path) ||
      cleanerPaths.has(progress.path) ||
      typeof progress.state !== 'string' ||
      !cleanerProgressStates.has(progress.state) ||
      (progress.error !== undefined && typeof progress.error !== 'string')
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    const hasError =
      typeof progress.error === 'string' && progress.error.length > 0;
    if (
      hasError !==
      (progress.state === 'conflict' || progress.state === 'failed')
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    cleanerPaths.add(progress.path);
  }

  if (value.associationProgress !== undefined) {
    if (
      !isPlainRecord(value.associationProgress) ||
      !hasOnlyKeys(value.associationProgress, [
        'path',
        'state',
        'carriers',
        'error',
      ]) ||
      typeof value.associationProgress.path !== 'string' ||
      !path.isAbsolute(value.associationProgress.path) ||
      (value.associationProgress.state !== 'pending' &&
        value.associationProgress.state !== 'intent-durable' &&
        value.associationProgress.state !== 'complete' &&
        value.associationProgress.state !== 'failed') ||
      (value.associationProgress.error !== undefined &&
        typeof value.associationProgress.error !== 'string') ||
      (value.associationProgress.carriers !== undefined &&
        !Array.isArray(value.associationProgress.carriers))
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
    const carriers = value.associationProgress.carriers ?? [];
    const carrierTargets = new Set<string>();
    for (const carrier of carriers) {
      if (
        !isPlainRecord(carrier) ||
        !hasOnlyKeys(carrier, [
          'target',
          'contentDigest',
          'directory',
          'intent',
          'claim',
        ]) ||
        typeof carrier.target !== 'string' ||
        !path.isAbsolute(carrier.target) ||
        carrierTargets.has(carrier.target) ||
        typeof carrier.contentDigest !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(carrier.contentDigest) ||
        !isPlainRecord(carrier.directory) ||
        !hasOnlyKeys(carrier.directory, ['path', 'identity']) ||
        typeof carrier.directory.path !== 'string' ||
        !path.isAbsolute(carrier.directory.path) ||
        !isArchiveAssociationCarrierIdentityRecord(
          carrier.directory.identity
        ) ||
        !isPlainRecord(carrier.intent) ||
        !hasOnlyKeys(carrier.intent, ['path', 'identity']) ||
        typeof carrier.intent.path !== 'string' ||
        !path.isAbsolute(carrier.intent.path) ||
        !isArchiveAssociationCarrierIdentityRecord(carrier.intent.identity) ||
        !isPlainRecord(carrier.claim) ||
        !hasOnlyKeys(carrier.claim, ['path', 'identity']) ||
        typeof carrier.claim.path !== 'string' ||
        !path.isAbsolute(carrier.claim.path) ||
        !isArchiveAssociationCarrierIdentityRecord(carrier.claim.identity)
      ) {
        return invalidArchiveJournal(journalPath, value);
      }
      carrierTargets.add(carrier.target);
    }
    const hasError =
      typeof value.associationProgress.error === 'string' &&
      value.associationProgress.error.length > 0;
    if (
      hasError !== (value.associationProgress.state === 'failed') ||
      ((value.associationProgress.state === 'pending' ||
        value.associationProgress.state === 'complete') &&
        carriers.length > 0)
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
  }

  const sourceProgressStates = new Set([
    'pending',
    'delete-intent',
    'claimed',
    'removing',
    'removed',
    'conflict',
    'failed',
  ]);
  if (
    !hasOnlyKeys(value.sourceProgress, [
      'state',
      'quarantine',
      'claimIdentity',
      'error',
    ]) ||
    typeof value.sourceProgress.state !== 'string' ||
    !sourceProgressStates.has(value.sourceProgress.state) ||
    typeof value.sourceProgress.quarantine !== 'string' ||
    !path.isAbsolute(value.sourceProgress.quarantine) ||
    (value.sourceProgress.claimIdentity !== undefined &&
      !isArchiveStatIdentityRecord(value.sourceProgress.claimIdentity)) ||
    (value.sourceProgress.error !== undefined &&
      typeof value.sourceProgress.error !== 'string')
  ) {
    return invalidArchiveJournal(journalPath, value);
  }
  const sourceHasError =
    typeof value.sourceProgress.error === 'string' &&
    value.sourceProgress.error.length > 0;
  const sourceErrorState =
    value.sourceProgress.state === 'conflict' ||
    value.sourceProgress.state === 'failed';
  if (
    sourceHasError !== sourceErrorState ||
    (value.sourceProgress.state === 'pending' &&
      value.sourceProgress.claimIdentity !== undefined) ||
    (value.sourceProgress.state === 'delete-intent' &&
      value.sourceProgress.claimIdentity !== undefined &&
      !isArchiveStatIdentityRecord(value.sourceProgress.claimIdentity)) ||
    ((value.sourceProgress.state === 'claimed' ||
      value.sourceProgress.state === 'removing' ||
      value.sourceProgress.state === 'removed') &&
      value.sourceProgress.claimIdentity === undefined)
  ) {
    return invalidArchiveJournal(journalPath, value);
  }

  if (value.failure !== undefined) {
    if (
      !isPlainRecord(value.failure) ||
      !hasOnlyKeys(value.failure, [
        'operation',
        'path',
        'code',
        'message',
        'resumePhase',
      ]) ||
      typeof value.failure.operation !== 'string' ||
      typeof value.failure.path !== 'string' ||
      (value.failure.code !== undefined &&
        typeof value.failure.code !== 'string') ||
      typeof value.failure.message !== 'string' ||
      !isArchiveResumePhaseValue(value.failure.resumePhase)
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
  }
  if (
    (value.phase === 'failed') !== (value.failure !== undefined)
  ) {
    return invalidArchiveJournal(journalPath, value);
  }
  const effectivePhase =
    value.phase === 'failed' &&
    isPlainRecord(value.failure) &&
    isArchiveResumePhaseValue(value.failure.resumePhase)
      ? value.failure.resumePhase
      : value.phase;
  const atLeastSpecsApplied = [
    'specs-applied',
    'published',
    'cleaner-progress',
    'accounting-finalized',
    'association-finalized',
    'source-removed',
    'complete',
  ].includes(effectivePhase);
  const atLeastPublished = [
    'published',
    'cleaner-progress',
    'accounting-finalized',
    'association-finalized',
    'source-removed',
    'complete',
  ].includes(effectivePhase);
  const atLeastAccounting = [
    'accounting-finalized',
    'association-finalized',
    'source-removed',
    'complete',
  ].includes(effectivePhase);
  const atLeastAssociation = [
    'association-finalized',
    'source-removed',
    'complete',
  ].includes(effectivePhase);
  const atLeastSourceRemoved = ['source-removed', 'complete'].includes(
    effectivePhase
  );
  const disposedCleanerPaths = value.cleanerProgress
    .filter(
      progress =>
        progress.state === 'deleted' ||
        progress.state === 'deleted-after-intent'
    )
    .map(progress => progress.path)
    .sort();
  if (
    stableArchiveJson(disposedCleanerPaths) !==
      stableArchiveJson([...value.ephemeraDisposed].sort()) ||
    (atLeastSpecsApplied &&
      value.specProgress.some(progress => progress.state !== 'complete')) ||
    (atLeastPublished &&
      (value.finalReservation.state !== 'owned' ||
        value.finalReservation.entries.some(entry => entry.state !== 'copied'))) ||
    (atLeastAccounting &&
      value.cleanerProgress.some(
        progress =>
          progress.state !== 'deleted' &&
          progress.state !== 'deleted-after-intent' &&
          progress.state !== 'already-absent'
      )) ||
    ((effectivePhase === 'association-finalized' ||
      (atLeastAssociation && value.associationProgress !== undefined)) &&
      value.associationProgress?.state !== 'complete') ||
    (atLeastSourceRemoved && value.sourceProgress.state !== 'removed')
  ) {
    return invalidArchiveJournal(journalPath, value);
  }

  if (value.integrityFailure !== undefined) {
    const integrityFailure = value.integrityFailure;
    if (
      !isPlainRecord(integrityFailure) ||
      !hasOnlyKeys(integrityFailure, [
        'detectedAt',
        'operation',
        'path',
        'code',
        'message',
        'safeAction',
      ]) ||
      typeof integrityFailure.detectedAt !== 'string' ||
      !Number.isFinite(Date.parse(integrityFailure.detectedAt)) ||
      typeof integrityFailure.operation !== 'string' ||
      typeof integrityFailure.path !== 'string' ||
      (integrityFailure.code !== undefined &&
        typeof integrityFailure.code !== 'string') ||
      typeof integrityFailure.message !== 'string' ||
      !isPlainRecord(integrityFailure.safeAction) ||
      !hasOnlyKeys(integrityFailure.safeAction, ['kind', 'guidance']) ||
      integrityFailure.safeAction.kind !== 'manual-recovery-required' ||
      typeof integrityFailure.safeAction.guidance !== 'string'
    ) {
      return invalidArchiveJournal(journalPath, value);
    }
  }

  return value as unknown as ArchiveJournal;
}

async function readArchiveAbortTombstone(
  tombstonePath: string,
  adapters: ArchiveEngineAdapters
): Promise<StoredArchiveAbortV1 | null> {
  let content: string;
  try {
    content = (
      await readStableArchiveFile(tombstonePath, adapters)
    ).content.toString('utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const invalid = new Error(
      `Invalid archive abort tombstone JSON: ${tombstonePath} (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    (invalid as NodeJS.ErrnoException).code =
      'archive_transaction_store_ownership_unverified';
    throw invalid;
  }
  if (
    !isPlainRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      'schemaVersion',
      'kind',
      'transactionId',
      'planHash',
      'status',
      'change',
      'stagePath',
      'journalPath',
      'associationPhase',
      'stageIdentity',
      'stageAuthority',
      'createdAt',
      'updatedAt',
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'rasen.archive-abort' ||
    typeof parsed.transactionId !== 'string' ||
    typeof parsed.planHash !== 'string' ||
    typeof parsed.change !== 'string' ||
    typeof parsed.stagePath !== 'string' ||
    typeof parsed.journalPath !== 'string' ||
    (parsed.associationPhase !== undefined &&
      parsed.associationPhase !== 'pending') ||
    (parsed.stageIdentity !== null &&
      !isArchiveStatIdentityRecord(parsed.stageIdentity)) ||
    (parsed.stageAuthority !== null &&
      !isArchiveAbortStageAuthority(parsed.stageAuthority, adapters)) ||
    (parsed.stageIdentity === null) !== (parsed.stageAuthority === null) ||
    (parsed.stageIdentity !== null &&
      parsed.stageAuthority !== null &&
      stableArchiveJson(parsed.stageIdentity) !==
        stableArchiveJson(parsed.stageAuthority.rootIdentity)) ||
    (parsed.status !== 'aborting' && parsed.status !== 'aborted') ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.updatedAt !== 'string' ||
    parsed.change.length === 0 ||
    !/^[0-9a-f]{64}$/i.test(parsed.planHash) ||
    !path.isAbsolute(parsed.stagePath) ||
    !path.isAbsolute(parsed.journalPath) ||
    parsed.journalPath !== path.join(parsed.stagePath, ARCHIVE_JOURNAL_FILENAME) ||
    path.basename(parsed.stagePath) !==
      `.rasen-archive-stage-${parsed.transactionId}` ||
    !Number.isFinite(Date.parse(parsed.createdAt)) ||
    !Number.isFinite(Date.parse(parsed.updatedAt))
  ) {
    const invalid = new Error(`Invalid archive abort tombstone: ${tombstonePath}`);
    (invalid as NodeJS.ErrnoException).code =
      'archive_transaction_store_ownership_unverified';
    throw invalid;
  }
  return parsed as unknown as StoredArchiveAbortV1;
}

async function retireStoredArchivePlan(
  plan: ArchivePlan,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const transactionDirectory = storedArchiveTransactionDirectory(
    globalDataDir,
    plan.transactionId
  );
  const planPath = path.join(transactionDirectory, 'plan.json');
  let stored: unknown;
  let stable: { content: Buffer; stat: ArchiveFsStat };
  try {
    stable = await readStableArchiveFile(planPath, adapters);
    stored = JSON.parse(stable.content.toString('utf8')) as unknown;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  if (
    !isPlainRecord(stored) ||
    stored.schemaVersion !== 1 ||
    stored.kind !== 'rasen.archive-plan' ||
    stored.transactionId !== plan.transactionId ||
    stored.planHash !== plan.planHash ||
    stableArchiveJson(stored.plan) !== stableArchiveJson(plan)
  ) {
    const error = new Error(
      'The stored archive plan changed before abort could retire it.'
    );
    (error as NodeJS.ErrnoException).code =
      'archive_abort_ownership_unverified';
    throw error;
  }
  const claim = await moveArchiveObjectToPrivateClaim(
    planPath,
    archiveDeletionIdentity(stable.stat, 'file'),
    'file',
    plan.transactionId,
    'stored-plan-retirement',
    adapters
  );
  const claimed = await readStableArchiveFile(claim.claimed, adapters);
  if (claimed.content.toString('utf8') !== stable.content.toString('utf8')) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Claimed stored archive plan changed before retirement.',
      [planPath, claim.claimed]
    );
  }
  await requireArchivePrivateClaim(claim, adapters);
  await adapters.fs.unlink(claim.claimed);
  await retireArchivePrivateClaim(claim, adapters);
  await flushArchiveDirectory(transactionDirectory, adapters);
}

export async function loadCompletedArchiveAbort(
  token: string,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveAbortResult | null> {
  const parsedToken = parseArchivePlanToken(token);
  const transactionDirectory = storedArchiveTransactionDirectory(
    globalDataDir,
    parsedToken.transactionId
  );
  const tombstonePath = path.join(transactionDirectory, 'abort.json');
  if ((await pathExists(tombstonePath, adapters)) === 'absent') return null;
  return withOwnerAwareFileLock(
    {
      lockPath: path.join(transactionDirectory, 'operation.lock'),
      errorFor: archivePlanOperationLockError,
      holder: `archive-abort:${parsedToken.transactionId}`,
      deadlineMs: 30_000,
    },
    async () => {
      let tombstone: StoredArchiveAbortV1 | null;
      try {
        tombstone = await readArchiveAbortTombstone(tombstonePath, adapters);
      } catch (error) {
        if (
          errorCode(error) !==
          'archive_transaction_store_ownership_unverified'
        ) {
          throw error;
        }
        const planPath = path.join(transactionDirectory, 'plan.json');
        const storedPlan = await readStoredArchivePlanEnvelope(
          parsedToken,
          planPath,
          adapters
        );
        const retainedPaths = [
          tombstonePath,
          planPath,
          storedPlan.paths.stage,
          storedPlan.paths.journal,
          storedPlan.paths.final,
          storedPlan.paths.publishedJournal,
        ].sort();
        return {
          status: 'blocked',
          transactionId: storedPlan.transactionId,
          planHash: storedPlan.planHash,
          change: storedPlan.change,
          stagePath: storedPlan.paths.stage,
          journalPath: storedPlan.paths.journal,
          tombstonePath,
          ...(storedPlan.finalization === undefined
            ? {}
            : { associationPhase: 'pending' as const }),
          retainedPaths,
          manualRecoveryAction: {
            kind: 'manual-recovery-required',
            guidance:
              `Preserve the invalid archive abort tombstone at ${tombstonePath}, ` +
              `the stored plan at ${planPath}, and every retained transaction path; ` +
              'restore trusted transaction-store state and obtain operator verification before retrying.',
          },
          blockers: [
            {
              operation: 'journal',
              path: tombstonePath,
              code: 'archive_transaction_store_ownership_unverified',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
      if (tombstone === null) return null;
      if (
        tombstone.transactionId !== parsedToken.transactionId ||
        tombstone.planHash !== parsedToken.planHash
      ) {
        const error = new Error(
          'The archive abort tombstone does not belong to this token.'
        );
        (error as NodeJS.ErrnoException).code =
          'archive_abort_ownership_unverified';
        throw error;
      }
      if (tombstone.status !== 'aborted') {
        const error = new Error(
          'The archive abort intent is incomplete and its stored plan is unavailable.'
        );
        (error as NodeJS.ErrnoException).code =
          'archive_plan_abort_in_progress';
        throw error;
      }
      return {
        status: 'already-aborted',
        transactionId: tombstone.transactionId,
        planHash: tombstone.planHash,
        change: tombstone.change,
        stagePath: tombstone.stagePath,
        journalPath: tombstone.journalPath,
        tombstonePath,
        ...(tombstone.associationPhase === undefined
          ? {}
          : { associationPhase: tombstone.associationPhase }),
        blockers: [],
      };
    }
  );
}

/**
 * Aborts one operation-locked, token-owned transaction before any durable
 * canonical, publication, cleaner, association, or source mutation.
 */
export async function abortArchivePlan(
  plan: ArchivePlan,
  globalDataDir: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveAbortResult> {
  const transactionDirectory = storedArchiveTransactionDirectory(
    globalDataDir,
    plan.transactionId
  );
  const tombstonePath = path.join(transactionDirectory, 'abort.json');
  const base = {
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    stagePath: plan.paths.stage,
    journalPath: plan.paths.journal,
    tombstonePath,
  };
  const associationResult =
    plan.finalization === undefined
      ? {}
      : { associationPhase: 'pending' as const };
  const blocked = (
    operation: ArchiveBlockerOperation,
    target: string,
    code: string,
    message: string,
    details: {
      journalPath?: string;
      effectivePhase?: Exclude<ArchiveJournalPhase, 'failed'>;
      retainedPaths?: string[];
      associationPhase?: 'pending' | 'no-op' | 'applied';
      disposition?: 'resume' | 'manual';
      manualRecoveryAction?: ArchiveIntegrityFailure['safeAction'];
    } = {}
  ): ArchiveAbortResult => {
    const retainedPaths = [
      ...new Set(
        details.retainedPaths ?? [
          target,
          plan.paths.active,
          plan.paths.stage,
          plan.paths.journal,
          plan.paths.final,
          plan.paths.publishedJournal,
          tombstonePath,
        ]
      ),
    ].sort();
    const disposition = details.disposition ?? 'manual';
    return {
      ...base,
      ...associationResult,
      status: 'blocked',
      ...(details.journalPath === undefined
        ? {}
        : { journalPath: details.journalPath }),
      ...(details.effectivePhase === undefined
        ? {}
        : { effectivePhase: details.effectivePhase }),
      ...(details.associationPhase === undefined
        ? {}
        : { associationPhase: details.associationPhase }),
      retainedPaths,
      ...(disposition === 'resume'
        ? {
            recoveryCommand: `rasen archive --apply-plan ${archivePlanToken(plan)} --yes`,
          }
        : {
            manualRecoveryAction:
              details.manualRecoveryAction ?? {
                kind: 'manual-recovery-required',
                guidance:
                  `Preserve every retained archive transaction path and inspect ${target}. ` +
                  'Resolve the ownership or integrity dispute from trusted state before any further archive action.',
              },
          }),
      blockers: [{ operation, path: target, code, message }],
    };
  };
  try {
    await assertNoArchiveTransactionDebris(plan, adapters);
  } catch (error) {
    if (errorCode(error) !== ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE) {
      throw error;
    }
    const reported =
      error instanceof Error &&
      Array.isArray(
        (error as Error & { retainedPaths?: unknown }).retainedPaths
      )
        ? (error as Error & { retainedPaths: string[] }).retainedPaths
        : [];
    const target = reported[0] ?? plan.paths.archiveParent;
    return blocked(
      'journal',
      target,
      ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
      error instanceof Error ? error.message : String(error),
      {
        disposition: 'manual',
        retainedPaths: [
          ...reported,
          plan.paths.stage,
          plan.paths.final,
          plan.paths.journal,
          plan.paths.publishedJournal,
          tombstonePath,
          path.join(transactionDirectory, 'plan.json'),
        ],
      }
    );
  }
  const writeAbortState = async (
    state: StoredArchiveAbortV1
  ): Promise<ArchiveAbortResult | null> => {
    try {
      await atomicWriteJson(
        tombstonePath,
        state,
        plan.transactionId,
        adapters
      );
      return null;
    } catch (error) {
      if (errorCode(error) !== ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE) {
        throw error;
      }
      const reported =
        error instanceof Error &&
        Array.isArray(
          (error as Error & { retainedPaths?: unknown }).retainedPaths
        )
          ? (error as Error & { retainedPaths: string[] }).retainedPaths
          : [];
      return blocked(
        'journal',
        reported[0] ?? tombstonePath,
        ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
        error instanceof Error ? error.message : String(error),
        {
          disposition: 'manual',
          retainedPaths: [
            ...reported,
            plan.paths.stage,
            plan.paths.final,
            plan.paths.journal,
            tombstonePath,
            path.join(transactionDirectory, 'plan.json'),
          ],
        }
      );
    }
  };

  let existingTombstone: StoredArchiveAbortV1 | null;
  try {
    existingTombstone = await readArchiveAbortTombstone(
      tombstonePath,
      adapters
    );
  } catch (error) {
    if (
      errorCode(error) !==
      'archive_transaction_store_ownership_unverified'
    ) {
      throw error;
    }
    return blocked(
      'journal',
      tombstonePath,
      'archive_transaction_store_ownership_unverified',
      error instanceof Error ? error.message : String(error),
      {
        disposition: 'manual',
        retainedPaths: [
          tombstonePath,
          path.join(transactionDirectory, 'plan.json'),
          plan.paths.stage,
          plan.paths.journal,
          plan.paths.final,
          plan.paths.publishedJournal,
        ],
      }
    );
  }
  const storedPlanPath = path.join(transactionDirectory, 'plan.json');
  try {
    const storedPlan = await readStoredArchivePlanEnvelope(
      plan,
      storedPlanPath,
      adapters
    );
    if (stableArchiveJson(storedPlan) !== stableArchiveJson(plan)) {
      return blocked(
        'validation',
        storedPlanPath,
        'archive_abort_plan_invalid',
        'The stored archive plan does not match the supplied immutable plan.'
      );
    }
  } catch (error) {
    const completedAbortOwnsMissingPlan =
      errorCode(error) === 'ENOENT' &&
      planIdentityValid(plan, adapters) &&
      existingTombstone?.status === 'aborted' &&
      existingTombstone.transactionId === plan.transactionId &&
      existingTombstone.planHash === plan.planHash &&
      existingTombstone.change === plan.change &&
      pathIdentityEquals(existingTombstone.stagePath, plan.paths.stage) &&
      pathIdentityEquals(existingTombstone.journalPath, plan.paths.journal);
    if (!completedAbortOwnsMissingPlan) {
      return blocked(
        'validation',
        storedPlanPath,
        'archive_abort_plan_invalid',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  if (!planIdentityValid(plan, adapters)) {
    return blocked(
      'validation',
      plan.paths.active,
      'archive_abort_plan_invalid',
      'The stored archive plan identity is invalid.'
    );
  }
  try {
    assertStoredArchivePlanPaths(plan);
  } catch (error) {
    return blocked(
      'validation',
      plan.paths.final,
      'archive_abort_plan_invalid',
      error instanceof Error ? error.message : String(error)
    );
  }
  if (
    existingTombstone !== null &&
    (existingTombstone.transactionId !== plan.transactionId ||
      existingTombstone.planHash !== plan.planHash ||
      existingTombstone.change !== plan.change ||
      path.resolve(existingTombstone.stagePath) !== path.resolve(plan.paths.stage) ||
      path.resolve(existingTombstone.journalPath) !==
        path.resolve(plan.paths.journal))
  ) {
    return blocked(
      'journal',
      tombstonePath,
      'archive_abort_ownership_unverified',
      'The abort tombstone does not belong to this exact archive plan.'
    );
  }
  if (existingTombstone?.status === 'aborted') {
    await retireStoredArchivePlan(plan, globalDataDir, adapters);
    return {
      ...base,
      ...associationResult,
      status: 'already-aborted',
      blockers: [],
    };
  }

  const finalState = await pathExists(plan.paths.final, adapters);
  const publishedJournalState = await pathExists(
    plan.paths.publishedJournal,
    adapters
  );
  if (finalState === 'present' || publishedJournalState === 'present') {
    let publishedState: ArchiveJournalState;
    try {
      publishedState = await inspectArchiveJournalState(plan, adapters);
    } catch (error) {
      return blocked(
        'journal',
        publishedJournalState === 'present'
          ? plan.paths.publishedJournal
          : plan.paths.final,
        errorCode(error) === 'archive_journal_invalid'
          ? 'archive_abort_journal_invalid'
          : 'archive_abort_ownership_unverified',
        error instanceof Error ? error.message : String(error)
      );
    }
    const publishedJournal = publishedState.journal;
    const effectivePhase = publishedState.effectivePhase;
    if (publishedJournal === null || effectivePhase === null) {
      return blocked(
        'journal',
        publishedState.journalPath,
        'archive_abort_ownership_unverified',
        'The published archive has no journal owned by this exact plan.'
      );
    }
    const associationPhase =
      plan.finalization === undefined
        ? undefined
        : phaseAtLeast(effectivePhase, 'association-finalized')
          ? plan.finalization.association.noop
            ? ('no-op' as const)
            : ('applied' as const)
          : ('pending' as const);
    const retainedPaths = [
      plan.paths.active,
      plan.paths.stage,
      plan.paths.journal,
      plan.paths.final,
      plan.paths.publishedJournal,
      tombstonePath,
      ...plan.specActions.map(action => action.target),
      ...publishedJournal.specProgress.flatMap(progress => [
        progress.target,
        ...(progress.backupOrQuarantine === null
          ? []
          : [progress.backupOrQuarantine]),
        ...(progress.temporary === null ? [] : [progress.temporary]),
      ]),
      ...plan.cleaner.effectiveDelete.map(relativePath =>
        path.join(plan.paths.ephemera, relativePath)
      ),
      ...(publishedJournal.associationProgress === undefined
        ? []
        : [publishedJournal.associationProgress.path]),
      publishedJournal.sourceProgress.quarantine,
    ];
    return blocked(
      'publish',
      plan.paths.final,
      'archive_abort_phase_unsafe',
      'Abort is unavailable after archive publication or final reservation.',
      {
        effectivePhase,
        journalPath: publishedState.journalPath,
        retainedPaths,
        ...(associationPhase === undefined ? {} : { associationPhase }),
        disposition: publishedJournal.integrityFailure ? 'manual' : 'resume',
        ...(publishedJournal.integrityFailure === undefined
          ? {}
          : {
              manualRecoveryAction:
                publishedJournal.integrityFailure.safeAction,
            }),
      }
    );
  }

  const stageState = await pathExists(plan.paths.stage, adapters);
  let stageIdentity: ArchiveFsStat | null = null;
  let stageAbortIdentity: ArchiveStatIdentity | null =
    existingTombstone?.stageIdentity ?? null;
  let stageAbortAuthority: ArchiveTreeFingerprint | null =
    existingTombstone?.stageAuthority ?? null;
  let journal: ArchiveJournal | null = null;
  if (stageState === 'present') {
    try {
      await requireArchiveStageOwner(plan, adapters);
    } catch (error) {
      return blocked(
        'journal',
        plan.paths.stage,
        'archive_abort_ownership_unverified',
        error instanceof Error ? error.message : String(error),
        {
          disposition: 'manual',
          retainedPaths: [plan.paths.stage, plan.paths.journal, tombstonePath],
        }
      );
    }
    stageIdentity = await adapters.fs.lstat(plan.paths.stage);
    if (
      !stageIdentity.isDirectory() ||
      stageIdentity.isSymbolicLink()
    ) {
      return blocked(
        'journal',
        plan.paths.stage,
        'archive_abort_ownership_unverified',
        'The claimed archive stage is not a real directory.'
      );
    }
    const observedStageIdentity = archiveDeletionIdentity(
      stageIdentity,
      'directory'
    );
    if (
      existingTombstone !== null &&
      (existingTombstone.stageIdentity === null ||
        stableArchiveJson(existingTombstone.stageIdentity) !==
          stableArchiveJson(observedStageIdentity))
    ) {
      return blocked(
        'journal',
        plan.paths.stage,
        'archive_abort_ownership_unverified',
        'The archive stage identity does not match the durable abort intent.'
      );
    }
    stageAbortIdentity = observedStageIdentity;
    try {
      journal = await readJournal(plan.paths.journal, adapters);
    } catch (error) {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_journal_invalid',
        error instanceof Error ? error.message : String(error)
      );
    }
    if (
      (journal === null && existingTombstone?.status !== 'aborting') ||
      (journal !== null &&
        (journal.transactionId !== plan.transactionId ||
          journal.planHash !== plan.planHash ||
          journal.change !== plan.change ||
          path.resolve(journal.activePath) !== path.resolve(plan.paths.active) ||
          path.resolve(journal.stagePath) !== path.resolve(plan.paths.stage) ||
          path.resolve(journal.finalPath) !== path.resolve(plan.paths.final)))
    ) {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_ownership_unverified',
        'The archive stage lacks a journal owned by this exact plan.'
      );
    }
  } else if (existingTombstone?.status !== 'aborting') {
    const journalState = await pathExists(plan.paths.journal, adapters);
    if (journalState === 'present') {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_ownership_unverified',
        'The transaction journal exists without its claimed archive stage.'
      );
    }
  }

  if (journal !== null) {
    const effectivePhase =
      journal.phase === 'failed' ? journal.failure!.resumePhase : journal.phase;
    const expectedSpecProgress = plan.specActions.map(action => ({
      actionId:
        action.actionId ?? adapters.sha256(stableArchiveJson(action)),
      action: action.action,
      target: action.target,
    }));
    const expectedCleanerPaths = plan.cleaner.effectiveDelete;
    const expectedAssociationPath =
      plan.finalization?.association.executionAssociationPath ??
      (plan.finalization === undefined ? undefined : plan.paths.final);
    const expectedSourceQuarantine = path.join(
      path.dirname(plan.paths.active),
      `.rasen-archive-source-${plan.transactionId}`,
      plan.change
    );
    const specCorresponds =
      journal.specProgress.length === expectedSpecProgress.length &&
      journal.specProgress.every((progress, index) => {
        const expected = expectedSpecProgress[index];
        return (
          expected !== undefined &&
          progress.actionId === expected.actionId &&
          progress.action === expected.action &&
          pathIdentityEquals(progress.target, expected.target)
        );
      });
    const cleanerCorresponds =
      journal.cleanerProgress.length === expectedCleanerPaths.length &&
      journal.cleanerProgress.every(
        (progress, index) => progress.path === expectedCleanerPaths[index]
      );
    const associationCorresponds =
      expectedAssociationPath === undefined
        ? journal.associationProgress === undefined
        : journal.associationProgress !== undefined &&
          pathIdentityEquals(
            journal.associationProgress.path,
            expectedAssociationPath
          );
    const sourceCorresponds = pathIdentityEquals(
      journal.sourceProgress.quarantine,
      expectedSourceQuarantine
    );
    const retainedPaths = [
      plan.paths.active,
      plan.paths.stage,
      plan.paths.journal,
      ...expectedSpecProgress.map(progress => progress.target),
      ...expectedCleanerPaths.map(progressPath =>
        path.join(plan.paths.ephemera, progressPath)
      ),
      ...(expectedAssociationPath === undefined ? [] : [expectedAssociationPath]),
      expectedSourceQuarantine,
      ...journal.specProgress.flatMap(progress => [
        progress.target,
        ...(progress.backupOrQuarantine === null
          ? []
          : [progress.backupOrQuarantine]),
        ...(progress.temporary === null ? [] : [progress.temporary]),
      ]),
      ...journal.cleanerProgress.map(progress =>
        path.join(plan.paths.ephemera, progress.path)
      ),
      ...(journal.associationProgress === undefined
        ? []
        : [journal.associationProgress.path]),
      journal.sourceProgress.quarantine,
    ];
    if (
      !specCorresponds ||
      !cleanerCorresponds ||
      !associationCorresponds ||
      !sourceCorresponds
    ) {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_journal_plan_mismatch',
        'Abort requires exact plan/action correspondence for every journal progress record and path.',
        { effectivePhase, retainedPaths }
      );
    }
    if (journal.integrityFailure) {
      return blocked(
        journal.integrityFailure.operation,
        journal.integrityFailure.path,
        'archive_abort_integrity_failure',
        journal.integrityFailure.message,
        {
          effectivePhase,
          retainedPaths,
          disposition: 'manual',
          manualRecoveryAction: journal.integrityFailure.safeAction,
        }
      );
    }
    const progressAllPending =
      journal.specProgress.every(
        progress =>
          progress.state === 'pending' &&
          progress.backupOrQuarantine === null &&
          progress.temporary === null &&
          progress.claimIdentity === undefined &&
          progress.temporaryIdentity === undefined &&
          progress.publishedIdentity === undefined &&
          progress.error === undefined
      ) &&
      journal.cleanerProgress.every(
        progress =>
          progress.state === 'pending' && progress.error === undefined
      ) &&
      (journal.associationProgress === undefined ||
        (journal.associationProgress.state === 'pending' &&
          journal.associationProgress.error === undefined)) &&
      journal.sourceProgress.state === 'pending' &&
      journal.sourceProgress.error === undefined;
    const durableMutationObserved =
      phaseAtLeast(effectivePhase, 'specs-applied') ||
      journal.ephemeraDisposed.length > 0 ||
      !progressAllPending ||
      journal.finalReservation.identity !== null ||
      journal.finalReservation.entries.length > 0 ||
      Object.values(journal.phaseFingerprints).some(
        fingerprint => fingerprint.scope === 'final'
      );
    if (
      phaseAtLeast(effectivePhase, 'specs-applied') ||
      durableMutationObserved
    ) {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_phase_unsafe',
        'Abort is unavailable because the transaction crossed a durable mutation boundary.',
        {
          effectivePhase,
          retainedPaths,
          disposition: 'resume',
        }
      );
    }
    if (JOURNAL_PHASE_ORDER[effectivePhase] >
        JOURNAL_PHASE_ORDER['evidence-finalized']) {
      return blocked(
        'journal',
        plan.paths.journal,
        'archive_abort_phase_unsafe',
        'Abort is unavailable after evidence finalization.',
        { effectivePhase, retainedPaths, disposition: 'resume' }
      );
    }
  }

  if (stageIdentity !== null && existingTombstone === null) {
    const stageFingerprintNames = [
      'evidence-finalized',
      'handoff-finalized',
      'payload-copied',
    ] as const;
    for (const name of stageFingerprintNames) {
      const fingerprint = journal?.phaseFingerprints[name];
      if (
        fingerprint?.scope === 'stage' &&
        fingerprint.state === 'verified' &&
        fingerprint.observedAfter !== undefined
      ) {
        stageAbortAuthority = fingerprint.observedAfter;
        break;
      }
    }
  }
  if (
    stageIdentity !== null &&
    (stageAbortAuthority === null ||
      stageAbortIdentity === null ||
      stableArchiveJson(stageAbortAuthority.rootIdentity) !==
        stableArchiveJson(stageAbortIdentity))
  ) {
    return blocked(
      'journal',
      plan.paths.stage,
      'archive_abort_ownership_unverified',
      'The archive stage lacks a durable deletion authority.'
    );
  }

  const currentAuthorityMatchesRecordedSubset = (
    current: ArchiveTreeFingerprint,
    recorded: ArchiveTreeFingerprint
  ): boolean => {
    if (
      stableArchiveJson(current.rootIdentity) !==
      stableArchiveJson(recorded.rootIdentity)
    ) {
      return false;
    }
    const recordedEntries = new Map(
      recorded.authorityEntries.map(entry => [entry.path, entry] as const)
    );
    return current.authorityEntries.every(entry => {
      const expected = recordedEntries.get(entry.path);
      return (
        expected !== undefined &&
        expected.kind === entry.kind &&
        stableArchiveJson(expected.identity) ===
          stableArchiveJson(entry.identity)
      );
    });
  };
  if (stageIdentity !== null && stageAbortAuthority !== null) {
    const currentAuthority = await fingerprintArchiveTree(
      plan.paths.stage,
      adapters
    );
    if (
      !currentAuthorityMatchesRecordedSubset(
        currentAuthority,
        stageAbortAuthority
      )
    ) {
      return blocked(
        'journal',
        plan.paths.stage,
        'archive_abort_ownership_unverified',
        'The archive stage payload does not match journal-recorded deletion authority.'
      );
    }
  }


  const startedAt =
    existingTombstone?.createdAt ?? adapters.now().toISOString();
  const intent: StoredArchiveAbortV1 = {
    schemaVersion: 1,
    kind: 'rasen.archive-abort',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    stagePath: plan.paths.stage,
    journalPath: plan.paths.journal,
    stageIdentity: stageAbortIdentity,
    stageAuthority: stageAbortAuthority,
    ...associationResult,
    status: 'aborting',
    createdAt: startedAt,
    updatedAt: adapters.now().toISOString(),
  };
  const abortingWriteBlocked = await writeAbortState(intent);
  if (abortingWriteBlocked) return abortingWriteBlocked;
  if (stageIdentity !== null) {
    let privateClaim: ArchivePrivateClaim | null = null;
    try {
      const claimed = await adapters.fs.lstat(plan.paths.stage);
      if (
        stageAbortIdentity === null ||
        !identityMatches(stageIdentity, claimed) ||
        stableArchiveJson(archiveDeletionIdentity(claimed, 'directory')) !==
          stableArchiveJson(stageAbortIdentity)
      ) {
        throw archiveStageOwnershipError(
          plan.paths.stage,
          'The archive stage identity changed before abort claim.'
        );
      }
      const authority = stageAbortAuthority;
      if (
        authority === null ||
        stableArchiveJson(authority.rootIdentity) !==
          stableArchiveJson(stageAbortIdentity)
      ) {
        throw archiveStageOwnershipError(
          plan.paths.stage,
          'The archive stage fingerprint is not bound to the durable abort intent.'
        );
      }
      const currentAuthority = await fingerprintArchiveTree(
        plan.paths.stage,
        adapters
      );
      if (!currentAuthorityMatchesRecordedSubset(currentAuthority, authority)) {
        throw archiveStageOwnershipError(
          plan.paths.stage,
          'The archive stage contains an object outside the durable deletion authority.'
        );
      }
      privateClaim = await moveArchiveObjectToPrivateClaim(
        plan.paths.stage,
        stageAbortIdentity,
        'directory',
        plan.transactionId,
        'abort-stage',
        adapters
      );
      const movedAuthority = await fingerprintArchiveTree(
        privateClaim.claimed,
        adapters
      );
      if (!archiveDeletionAuthorityMatches(movedAuthority, currentAuthority)) {
        throw archiveClaimOwnershipError(
          privateClaim.root,
          'Abort-claimed stage differs from its pre-claim authority.',
          [plan.paths.stage, privateClaim.claimed]
        );
      }
      const claimedJournal = path.join(
        privateClaim.claimed,
        ARCHIVE_JOURNAL_FILENAME
      );
      const journalState = await pathExists(claimedJournal, adapters);
      if (journalState === 'present') {
        const stableJournal = await readStableArchiveFile(
          claimedJournal,
          adapters
        );
        let observedJournal: unknown;
        try {
          observedJournal = JSON.parse(stableJournal.content.toString('utf8'));
        } catch {
          throw archiveClaimOwnershipError(
            privateClaim.root,
            'Abort-claimed journal is not valid JSON.',
            [claimedJournal]
          );
        }
        if (
          !isPlainRecord(observedJournal) ||
          observedJournal.transactionId !== plan.transactionId ||
          observedJournal.planHash !== plan.planHash ||
          observedJournal.change !== plan.change ||
          observedJournal.activePath !== plan.paths.active ||
          observedJournal.stagePath !== plan.paths.stage ||
          observedJournal.finalPath !== plan.paths.final ||
          (journal !== null &&
            stableArchiveJson(observedJournal) !== stableArchiveJson(journal))
        ) {
          throw archiveClaimOwnershipError(
            privateClaim.root,
            'Abort-claimed journal ownership does not match the transaction.',
            [claimedJournal]
          );
        }
      }
      await removeClaimedArchiveEntriesGuarded(
        privateClaim.claimed,
        currentAuthority,
        adapters
      );
      if (journalState === 'present') {
        await adapters.fs.unlink(claimedJournal);
      }
      await requireArchivePrivateClaim(privateClaim, adapters);
      const emptiedStage = await adapters.fs.lstat(privateClaim.claimed);
      if (
        !emptiedStage.isDirectory() ||
        emptiedStage.isSymbolicLink() ||
        !sameArchiveObject(emptiedStage, stageAbortIdentity, 'directory')
      ) {
        throw archiveClaimOwnershipError(
          privateClaim.root,
          'Abort-claimed stage root changed before final removal.',
          [privateClaim.claimed]
        );
      }
      await adapters.fs.rmdir(privateClaim.claimed);
      await retireArchivePrivateClaim(privateClaim, adapters);
    } catch (error) {
      const retained =
        privateClaim === null
          ? [plan.paths.stage, plan.paths.journal, tombstonePath]
          : [
              plan.paths.stage,
              plan.paths.journal,
              privateClaim.root,
              privateClaim.claimed,
              tombstonePath,
            ];
      return blocked(
        'journal',
        privateClaim?.root ?? plan.paths.stage,
        'archive_abort_ownership_unverified',
        error instanceof Error ? error.message : String(error),
        { disposition: 'manual', retainedPaths: retained }
      );
    }
  }
  const abortedWriteBlocked = await writeAbortState({
    ...intent,
    status: 'aborted',
    updatedAt: adapters.now().toISOString(),
  });
  if (abortedWriteBlocked) return abortedWriteBlocked;
  await retireStoredArchivePlan(plan, globalDataDir, adapters);
  return { ...base, ...associationResult, status: 'aborted', blockers: [] };
}

async function pathExists(
  target: string,
  adapters: ArchiveEngineAdapters
): Promise<'present' | 'absent'> {
  try {
    await adapters.fs.lstat(target);
    return 'present';
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'absent';
    throw error;
  }
}

function archiveTransactionTempOwnershipError(
  temporary: string,
  target: string,
  detail: string
): Error {
  const error = new Error(
    `${detail} Preserve the transaction temporary ${temporary} and target ${target} for manual recovery.`
  ) as Error & { retainedPaths: string[] };
  (error as NodeJS.ErrnoException).code =
    ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE;
  error.retainedPaths = [temporary, target];
  return error;
}

async function transactionTemporaryPaths(
  directory: string,
  prefixes: string[],
  adapters: ArchiveEngineAdapters
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await adapters.fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(entry => prefixes.some(prefix => entry.name.startsWith(prefix)))
    .map(entry => path.join(directory, entry.name))
    .sort();
}

async function assertNoAtomicWriteTemporary(
  target: string,
  transactionId: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const prefix = `.${path.basename(target)}.tmp-${transactionId}`;
  const [temporary] = await transactionTemporaryPaths(
    path.dirname(target),
    [prefix],
    adapters
  );
  if (temporary) {
    throw archiveTransactionTempOwnershipError(
      temporary,
      target,
      'An unjournaled archive atomic-write temporary already exists.'
    );
  }
}

async function assertNoArchiveTransactionDebris(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const transactionId = plan.transactionId;
  const claimDirectories = [
    ...new Set([
      plan.paths.archiveParent,
      path.dirname(plan.paths.active),
      plan.paths.stage,
      path.join(plan.paths.stage, 'handoff'),
      path.join(plan.paths.stage, 'evidence', 'handoff'),
      plan.paths.ephemera,
      ...plan.specActions.flatMap(action => [
        path.dirname(action.target),
        path.dirname(action.source),
      ]),
    ]),
  ];
  const groups = [
    {
      directory: plan.paths.archiveParent,
      prefixes: [
        `.rasen-archive-projection-${transactionId}`,
        `.rasen-archive-accounting-${transactionId}`,
      ],
    },
    {
      directory: plan.paths.stage,
      prefixes: [`.${ARCHIVE_JOURNAL_FILENAME}.tmp-${transactionId}`],
    },
    {
      directory: plan.paths.final,
      prefixes: [
        `.${ARCHIVE_JOURNAL_FILENAME}.tmp-${transactionId}`,
        `.${ARCHIVE_PUBLISHED_MARKER_FILENAME}.tmp-${transactionId}`,
      ],
    },
    ...claimDirectories.map(directory => ({
      directory,
      prefixes: [`.rasen-archive-claim-${transactionId}-`],
    })),
  ];
  for (const group of groups) {
    const [temporary] = await transactionTemporaryPaths(
      group.directory,
      group.prefixes,
      adapters
    );
    if (!temporary) continue;
    const error = archiveTransactionTempOwnershipError(
      temporary,
      plan.paths.final,
      'Unjournaled debris from this archive transaction already exists.'
    ) as Error & { retainedPaths: string[] };
    error.retainedPaths = [
      temporary,
      plan.paths.stage,
      plan.paths.final,
      plan.paths.journal,
      plan.paths.publishedJournal,
    ];
    throw error;
  }
}

async function atomicWriteJson(
  target: string,
  value: unknown,
  transactionId: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  await assertNoAtomicWriteTemporary(target, transactionId, adapters);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${transactionId}`
  );
  let handle: FileHandle;
  try {
    handle = await adapters.fs.open(temporary, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw archiveTransactionTempOwnershipError(
        temporary,
        target,
        'The deterministic archive atomic-write temporary is already occupied.'
      );
    }
    throw error;
  }
  let closed = false;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    closed = true;
    await adapters.fs.rename(temporary, target);
    await flushArchiveDirectory(path.dirname(target), adapters);
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    throw archiveTransactionTempOwnershipError(
      temporary,
      target,
      `Archive atomic publication did not complete (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

async function flushArchiveDirectory(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await adapters.fs.open(directory, 'r');
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (
      !['EISDIR', 'EINVAL', 'EPERM', 'ENOTSUP', 'EACCES'].includes(
        errorCode(error) ?? ''
      )
    ) {
      throw error;
    }
  }
}

interface ArchiveJournalCarrierSnapshot {
  path: string;
  content: string;
  identity: ArchiveStatIdentity;
}

const archiveJournalCarrierSnapshots = new WeakMap<
  ArchiveJournal,
  ArchiveJournalCarrierSnapshot
>();

async function writeJournalCas(
  journalPath: string,
  journal: ArchiveJournal,
  previous: ArchiveJournal | null,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const expected = previous
    ? archiveJournalCarrierSnapshots.get(previous)
    : undefined;
  let oldClaim: ArchivePrivateClaim | null = null;
  if (expected?.path === journalPath) {
    let current: { content: Buffer; stat: ArchiveFsStat };
    try {
      current = await readStableArchiveFile(journalPath, adapters);
    } catch (error) {
      throw archiveClaimOwnershipError(
        journalPath,
        `Expected archive journal carrier cannot be re-read (${
          error instanceof Error ? error.message : String(error)
        }).`,
        [journalPath]
      );
    }
    if (
      current.content.toString('utf8') !== expected.content ||
      stableArchiveJson(archiveDeletionIdentity(current.stat, 'file')) !==
        stableArchiveJson(expected.identity)
    ) {
      throw archiveClaimOwnershipError(
        journalPath,
        'Archive journal carrier changed before compare-and-swap publication.',
        [journalPath]
      );
    }
    oldClaim = await moveArchiveObjectToPrivateClaim(
      journalPath,
      expected.identity,
      'file',
      journal.transactionId,
      `journal-old:${path.basename(journalPath)}`,
      adapters
    );
    const claimedOld = await readStableArchiveFile(oldClaim.claimed, adapters);
    if (claimedOld.content.toString('utf8') !== expected.content) {
      throw archiveClaimOwnershipError(
        oldClaim.root,
        'Claimed journal carrier differs from the expected durable bytes.',
        [journalPath, oldClaim.claimed]
      );
    }
  } else if ((await pathExists(journalPath, adapters)) === 'present') {
    throw archiveClaimOwnershipError(
      journalPath,
      'Archive journal appeared before its first exclusive publication.',
      [journalPath]
    );
  }

  const content = `${JSON.stringify(journal, null, 2)}\n`;
  const temporary = path.join(
    path.dirname(journalPath),
    `.${path.basename(journalPath)}.tmp-${journal.transactionId}`
  );
  await assertNoAtomicWriteTemporary(
    journalPath,
    journal.transactionId,
    adapters
  );
  let handle: FileHandle;
  try {
    handle = await adapters.fs.open(temporary, 'wx', 0o600);
  } catch (error) {
    throw archiveTransactionTempOwnershipError(
      temporary,
      journalPath,
      `Archive journal CAS temporary cannot be created (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    const temporaryStable = await readStableArchiveFile(temporary, adapters);
    await adapters.fs.link(temporary, journalPath);
    const published = await readStableArchiveFile(journalPath, adapters);
    if (
      published.content.toString('utf8') !== content ||
      !identityMatches(temporaryStable.stat, published.stat)
    ) {
      throw archiveClaimOwnershipError(
        journalPath,
        'Exclusively published journal carrier failed identity verification.',
        [temporary, journalPath]
      );
    }
    const temporaryClaim = await moveArchiveObjectToPrivateClaim(
      temporary,
      archiveDeletionIdentity(temporaryStable.stat, 'file'),
      'file',
      journal.transactionId,
      `journal-temporary:${path.basename(journalPath)}`,
      adapters
    );
    await requireArchivePrivateClaim(temporaryClaim, adapters);
    await adapters.fs.unlink(temporaryClaim.claimed);
    await retireArchivePrivateClaim(temporaryClaim, adapters);
    if (oldClaim) {
      await requireArchivePrivateClaim(oldClaim, adapters);
      await adapters.fs.unlink(oldClaim.claimed);
      await retireArchivePrivateClaim(oldClaim, adapters);
    }
    await flushArchiveDirectory(path.dirname(journalPath), adapters);
    archiveJournalCarrierSnapshots.set(journal, {
      path: journalPath,
      content,
      identity: archiveDeletionIdentity(published.stat, 'file'),
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (
      errorCode(error) === ARCHIVE_CLAIM_OWNERSHIP_CODE ||
      errorCode(error) === ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE
    ) {
      throw error;
    }
    throw archiveTransactionTempOwnershipError(
      temporary,
      journalPath,
      `Archive journal CAS publication did not complete (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }
}

async function writeJournal(
  journalPath: string,
  journal: ArchiveJournal,
  previous: ArchiveJournal | null,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  await writeJournalCas(journalPath, journal, previous, adapters);
}

async function readJournal(
  journalPath: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveJournal | null> {
  let content: string;
  let stable: { content: Buffer; stat: ArchiveFsStat };
  try {
    stable = await readStableArchiveFile(journalPath, adapters);
    content = stable.content.toString('utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;

  } catch {
    return invalidArchiveJournal(journalPath, content);
  }
  const journal = parseArchiveJournalV2(parsed, journalPath, adapters);
  archiveJournalCarrierSnapshots.set(journal, {
    path: journalPath,
    content,
    identity: archiveDeletionIdentity(stable.stat, 'file'),
  });
  return journal;
}
function archiveJournalProgressAgreesWithPlan(
  journal: ArchiveJournal,
  plan: ArchivePlan
): boolean {
  const expectedSpecs = plan.specActions.map(action => ({
    actionId:
      action.actionId ??
      defaultArchiveEngineAdapters.sha256(stableArchiveJson(action)),
    action: action.action,
    target: action.target,
  }));
  if (
    journal.specProgress.length !== expectedSpecs.length ||
    !journal.specProgress.every((progress, index) => {
      const expected = expectedSpecs[index];
      return (
        expected !== undefined &&
        progress.actionId === expected.actionId &&
        progress.action === expected.action &&
        pathIdentityEquals(progress.target, expected.target)
      );
    }) ||
    journal.cleanerProgress.length !== plan.cleaner.effectiveDelete.length ||
    !journal.cleanerProgress.every(
      (progress, index) => progress.path === plan.cleaner.effectiveDelete[index]
    )
  ) {
    return false;
  }
  const expectedAssociationPath =
    plan.finalization?.association.executionAssociationPath ??
    (plan.finalization === undefined ? undefined : plan.paths.final);
  if (
    expectedAssociationPath === undefined
      ? journal.associationProgress !== undefined
      : journal.associationProgress === undefined ||
        !pathIdentityEquals(
          journal.associationProgress.path,
          expectedAssociationPath
        )
  ) {
    return false;
  }
  if (
    journal.associationProgress?.carriers !== undefined &&
    (journal.associationProgress.carriers.length > 2 ||
      journal.associationProgress.carriers.some(carrier => {
        if (
          expectedAssociationPath !== undefined &&
          pathIdentityEquals(carrier.target, expectedAssociationPath)
        ) {
          return false;
        }
        const planningScopeId =
          plan.finalization?.association.planningScopeId;
        return (
          planningScopeId === undefined ||
          path.basename(carrier.target) !== `${planningScopeId}.json` ||
          path.basename(path.dirname(carrier.target)) !== 'index'
        );
      }))
  ) {
    return false;
  }
  const expectedSourceQuarantine = path.join(
    path.dirname(plan.paths.active),
    `.rasen-archive-source-${plan.transactionId}`,
    plan.change
  );
  if (
    !pathIdentityEquals(
      journal.sourceProgress.quarantine,
      expectedSourceQuarantine
    )
  ) {
    return false;
  }
  const effectivePhase =
    journal.phase === 'failed' ? journal.failure!.resumePhase : journal.phase;
  const required: Array<{
    phase: Exclude<ArchiveJournalPhase, 'failed'>;
    name: string;
    scope: 'stage' | 'final';
  }> = [
    { phase: 'staged', name: 'payload-copied', scope: 'stage' },
    { phase: 'handoff-finalized', name: 'handoff-finalized', scope: 'stage' },
    { phase: 'evidence-finalized', name: 'evidence-finalized', scope: 'stage' },
    { phase: 'published', name: 'final-reserved', scope: 'final' },
    {
      phase: 'accounting-finalized',
      name: 'accounting-finalized',
      scope: 'final',
    },
  ];
  return required.every(({ phase, name, scope }) => {
    if (!phaseAtLeast(effectivePhase, phase)) return true;
    const fingerprint = journal.phaseFingerprints[name];
    return (
      fingerprint?.scope === scope &&
      fingerprint.state === 'verified' &&
      fingerprint.observedAfter !== undefined
    );
  });
}

function archiveJournalBelongsToPlan(
  journal: ArchiveJournal | null,
  plan: ArchivePlan
): journal is ArchiveJournal {
  return (
    journal !== null &&
    journal.transactionId === plan.transactionId &&
    journal.planHash === plan.planHash &&
    journal.change === plan.change &&
    pathIdentityEquals(journal.activePath, plan.paths.active) &&
    pathIdentityEquals(journal.stagePath, plan.paths.stage) &&
    pathIdentityEquals(journal.finalPath, plan.paths.final) &&
    archiveJournalProgressAgreesWithPlan(journal, plan)
  );
}

export async function inspectArchiveJournalState(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveJournalState> {
  await assertNoArchiveTransactionDebris(plan, adapters);
  const [stageState, finalState, stageJournalState, publishedJournalState] =
    await Promise.all([
      pathExists(plan.paths.stage, adapters),
      pathExists(plan.paths.final, adapters),
      pathExists(plan.paths.journal, adapters),
      pathExists(plan.paths.publishedJournal, adapters),
    ]);
  const durableReservationIntentPlacement =
    stageState === 'present' &&
    stageJournalState === 'present' &&
    finalState === 'present' &&
    publishedJournalState === 'absent';
  if (stageState === 'present' && stageJournalState === 'absent') {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'Archive stage exists without a durable transaction journal.',
      [plan.paths.journal, plan.paths.final]
    );
  }
  const stateMismatch =
    (stageJournalState === 'present' &&
      publishedJournalState === 'present' &&
      !(stageState === 'present' && finalState === 'present')) ||
    (finalState === 'present' &&
      publishedJournalState === 'absent' &&
      !durableReservationIntentPlacement) ||
    (stageState === 'absent' && stageJournalState === 'present') ||
    (finalState === 'absent' && publishedJournalState === 'present');
  if (stateMismatch) {
    const error = new Error(
      'Archive journal placement does not match the transaction stage/publication state.'
    );
    (error as NodeJS.ErrnoException).code =
      'archive_journal_ownership_mismatch';
    throw error;
  }
  const journalPath =
    publishedJournalState === 'present'
      ? plan.paths.publishedJournal
      : plan.paths.journal;
  if (
    stageJournalState === 'absent' &&
    publishedJournalState === 'absent'
  ) {
    return { journalPath, journal: null, effectivePhase: null };
  }
  const journal = await readJournal(journalPath, adapters);
  const hasSupersededStageJournal =
    stageJournalState === 'present' && publishedJournalState === 'present';
  const supersededStageJournal = hasSupersededStageJournal
    ? await readJournal(plan.paths.journal, adapters)
    : null;
  if (
    !archiveJournalBelongsToPlan(journal, plan) ||
    (durableReservationIntentPlacement &&
      journal.finalReservation.state !== 'intent-durable') ||
    (hasSupersededStageJournal &&
      !archiveJournalBelongsToPlan(supersededStageJournal, plan))
  ) {
    const error = new Error(
      'Archive journal does not belong to the supplied immutable plan.'
    );
    (error as NodeJS.ErrnoException).code =
      'archive_journal_ownership_mismatch';
    throw error;
  }
  return {
    journalPath,
    journal,
    effectivePhase:
      journal.phase === 'failed' ? journal.failure!.resumePhase : journal.phase,
  };
}

function journalFor(
  plan: ArchivePlan,
  phase: ArchiveJournalPhase,
  ephemeraDisposed: string[],
  adapters: ArchiveEngineAdapters,
  failure?: ArchiveJournal['failure'],
  previous?: ArchiveJournal | null
): ArchiveJournal {
  const sourceClaimRoot = path.join(
    path.dirname(plan.paths.active),
    `.rasen-archive-source-${plan.transactionId}`
  );
  return {
    schemaVersion: 2,
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    phase,
    activePath: plan.paths.active,
    stagePath: plan.paths.stage,
    finalPath: plan.paths.final,
    ephemeraDisposed: [...ephemeraDisposed].sort(),
    phaseFingerprints: previous?.phaseFingerprints ?? {},
    finalReservation:
      previous?.finalReservation ?? {
        state: 'none',
        identity: null,
        entries: [],
      },
    specProgress:
      previous?.specProgress ??
      plan.specActions.map(action => ({
        actionId:
          action.actionId ??
          adapters.sha256(stableArchiveJson(action)),
        action: action.action,
        target: action.target,
        backupOrQuarantine: null,
        temporary: null,
        state: 'pending',
      })),
    cleanerProgress:
      previous?.cleanerProgress ??
      plan.cleaner.effectiveDelete.map(relativePath => ({
        path: relativePath,
        state: 'pending',
      })),
    ...(plan.finalization === undefined
      ? {}
      : {
          associationProgress:
            previous?.associationProgress ?? {
              path:
                plan.finalization.association.executionAssociationPath ??
                plan.paths.final,
              state: 'pending' as const,
            },
        }),
    sourceProgress:
      previous?.sourceProgress ?? {
        state: 'pending',
        quarantine: path.join(sourceClaimRoot, plan.change),
      },
    updatedAt: adapters.now().toISOString(),
    ...(failure ? { failure } : {}),
    ...(previous?.integrityFailure
      ? { integrityFailure: previous.integrityFailure }
      : {}),
  };
}

const JOURNAL_PHASE_ORDER: Record<ArchiveJournalPhase, number> = {
  planned: 0,
  staged: 1,
  'handoff-finalized': 2,
  'evidence-finalized': 3,
  'specs-applied': 4,
  published: 5,
  'cleaner-progress': 6,
  'accounting-finalized': 7,
  'association-finalized': 8,
  'source-removed': 9,
  complete: 10,
  failed: -1,
};

function phaseAtLeast(
  phase: ArchiveJournalPhase,
  threshold: ArchiveJournalPhase
): boolean {
  return JOURNAL_PHASE_ORDER[phase] >= JOURNAL_PHASE_ORDER[threshold];
}

function archiveJournalHasDurableMutation(
  journal: ArchiveJournal | null
): journal is ArchiveJournal {
  if (journal === null) return false;
  const effectivePhase =
    journal.phase === 'failed' ? journal.failure!.resumePhase : journal.phase;
  return (
    phaseAtLeast(effectivePhase, 'specs-applied') ||
    journal.specProgress.some(progress => progress.state !== 'pending') ||
    journal.cleanerProgress.some(progress => progress.state !== 'pending') ||
    (journal.associationProgress !== undefined &&
      journal.associationProgress.state !== 'pending') ||
    journal.sourceProgress.state !== 'pending' ||
    journal.ephemeraDisposed.length > 0 ||
    journal.finalReservation.identity !== null ||
    journal.finalReservation.entries.length > 0
  );
}

function applyFailure(
  plan: ArchivePlan,
  journalPath: string,
  resumed: boolean,
  ephemeraDisposed: string[],
  error: unknown,
  operation: ArchiveBlockerOperation,
  operationPath: string,
  totals: ArchiveApplyResult['totals'],
  effectivePhase: Exclude<ArchiveJournalPhase, 'failed'>
): ArchiveApplyResult {
  const code = errorCode(error);
  const deterministicInputFailure =
    code === ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE ||
    code === ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE ||
    code === ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE ||
    code === ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE;
  const deterministicAbortEligible =
    deterministicInputFailure &&
    !phaseAtLeast(effectivePhase, 'evidence-finalized');
  const abortRequired =
    code === ARCHIVE_SHIP_LOG_RESERVED_SECTION_CODE ||
    deterministicAbortEligible;
  const deterministicManualRecovery =
    deterministicInputFailure && !deterministicAbortEligible;
  const reportedRetainedPaths =
    error instanceof Error &&
    Array.isArray(
      (error as Error & { retainedPaths?: unknown }).retainedPaths
    ) &&
    (error as Error & { retainedPaths: unknown[] }).retainedPaths.every(
      retained => typeof retained === 'string'
    )
      ? (error as Error & { retainedPaths: string[] }).retainedPaths
      : undefined;
  const ancestryManualRecovery =
    code === ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE;
  const reservationManualRecovery =
    code === 'archive_reservation_ownership_unverified';
  const transactionTempManualRecovery =
    code === ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE;
  const retainedPaths =
    reportedRetainedPaths !== undefined
      ? [
          ...new Set([
            ...reportedRetainedPaths,
            plan.paths.active,
            plan.paths.stage,
            plan.paths.final,
            plan.finalization?.association.executionAssociationPath ??
              plan.paths.final,
            path.join(
              path.dirname(plan.paths.active),
              `.rasen-archive-source-${plan.transactionId}`
            ),
            journalPath,
          ]),
        ]
      : deterministicManualRecovery ||
          ancestryManualRecovery ||
          reservationManualRecovery ||
          code === 'archive_journal_invalid' ||
          code === ARCHIVE_CLEANER_OWNERSHIP_CODE ||
          code === 'planning_execution_binding_mismatch' ||
          code === 'archive_accounting_ownership_unverified'
        ? [
            ...new Set([
              plan.paths.stage,
              plan.paths.final,
              journalPath,
              ...(code === 'planning_execution_binding_mismatch'
                ? [
                    plan.paths.active,
                    plan.finalization?.association.executionAssociationPath ??
                      plan.paths.final,
                  ]
                : []),
              ...(code === 'archive_journal_invalid'
                ? [
                    plan.paths.active,
                    path.join(
                      path.dirname(plan.paths.active),
                      `.rasen-archive-source-${plan.transactionId}`
                    ),
                    plan.finalization?.association.executionAssociationPath ??
                      plan.paths.final,
                  ]
                : []),
            ]),
          ]
        : undefined;
  const manualRecoveryRequired =
    deterministicManualRecovery ||
    ancestryManualRecovery ||
    code === 'archive_journal_invalid' ||
    reservationManualRecovery ||
    transactionTempManualRecovery ||
    code === ARCHIVE_STAGE_OWNERSHIP_CODE ||
    code === ARCHIVE_CLAIM_OWNERSHIP_CODE ||
    code === ARCHIVE_HANDOFF_OWNERSHIP_CODE ||
    code === ARCHIVE_CLEANER_OWNERSHIP_CODE ||
    code === 'planning_execution_binding_mismatch' ||
    code === 'archive_accounting_ownership_unverified';
  return {
    status: abortRequired ? 'abort-required' : 'recoverable',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    change: plan.change,
    path: plan.paths.final,
    journalPath,
    resumed,
    effectivePhase,
    specsUpdated: Object.values(totals).some(value => value > 0),
    totals,
    ephemeraDiscarded: [...ephemeraDisposed].sort(),
    ephemeraPreserved: plan.cleaner.effectivePreserve,
    blockers: [
      {
        operation,
        path: operationPath,
        ...(code ? { code } : {}),
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    ...(retainedPaths === undefined ? {} : { retainedPaths }),
    ...(abortRequired
      ? {
          abortCommand: `rasen archive --abort-plan ${archivePlanToken(plan)} --yes`,
        }
      : manualRecoveryRequired
        ? {
            manualRecoveryAction: {
              kind: 'manual-recovery-required' as const,
              guidance:
                code === ARCHIVE_STAGE_OWNERSHIP_CODE
                  ? `Preserve the unrecognized archive stage at ${operationPath} and every retained path reported by this result; no matching durable stage ownership was verified, so neither retry nor abort may remove it without operator verification.`
                  : code === ARCHIVE_CLAIM_OWNERSHIP_CODE
                    ? `Preserve the unverified claim path at ${operationPath}, every retained path reported by this result, and the durable transaction journal at ${journalPath}; verify filesystem ownership before any further archive action.`
                    : code === 'archive_accounting_ownership_unverified'
                      ? `Preserve the journal-owned accounting temporary, archive ledger, published archive, and journal at ${journalPath}; their identities disagree and no carrier is adopted or overwritten automatically.`
                    : code === 'planning_execution_binding_mismatch'
                      ? `Preserve the published archive, active source, execution association, machine index, and journal at ${journalPath}; the frozen Store binding disagrees and must never be overwritten automatically.`
                    : code === ARCHIVE_CLEANER_OWNERSHIP_CODE
                      ? `Preserve the changed ephemera candidate at ${operationPath}, the published archive, and journal at ${journalPath}; its planned deletion authority no longer matches, so exact replay and abort are disabled pending operator verification.`
                    : code === ARCHIVE_HANDOFF_OWNERSHIP_CODE
                      ? `Preserve the unverified handoff occupants, archive stage at ${plan.paths.stage}, and durable journal at ${journalPath}; do not abort or replay until an operator verifies ownership.`
                      : code === 'archive_reservation_ownership_unverified'
                        ? `Preserve the unverified final archive destination at ${plan.paths.final} and the retained stage journal at ${plan.paths.journal}; inspect the destination without deleting or adopting it, verify reservation ownership, and obtain operator verification before any further archive action.`
                        : ancestryManualRecovery
                          ? `Preserve the owned archive transaction at ${plan.paths.stage}, ${plan.paths.final}, and ${journalPath}; its Foundation archive ancestry no longer matches the reviewed identities, so do not follow, replace, or remove those paths until an operator verifies containment.`
                          : deterministicManualRecovery
                            ? `Preserve the progressed archive transaction at ${plan.paths.stage}, ${plan.paths.final}, and ${journalPath}; abort and exact-token replay cannot safely resolve this deterministic input conflict after evidence finalization, so obtain operator verification before any further archive action.`
                            : code === ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE
                              ? `Preserve every retained transaction temporary and its stage/final/journal targets; the temporary has no durable ownership intent, so neither retry nor abort may delete or adopt it without operator verification.`
                            : `Preserve the archive transaction state at ${journalPath}. ` +
                              'The journal schema or integrity is invalid, so exact-token replay is disabled; restore the journal from trusted transaction state and obtain operator verification before any further archive action.',
            },
          }
        : {
            recoveryCommand: `rasen archive --apply-plan ${archivePlanToken(plan)} --yes`,
          }),
  };
}

function totalsFromSpecProgress(
  plan: ArchivePlan,
  journal: ArchiveJournal | null
): ArchiveApplyResult['totals'] {
  const totals = { added: 0, modified: 0, removed: 0, renamed: 0 };
  const complete = new Set(
    journal?.specProgress
      .filter(progress => progress.state === 'complete')
      .map(progress => progress.actionId) ?? []
  );
  for (const action of plan.specActions) {
    const actionId = action.actionId ?? '';
    if (!complete.has(actionId)) continue;
    totals.added += action.counts.added;
    totals.modified += action.counts.modified;
    totals.removed += action.counts.removed;
    totals.renamed += action.counts.renamed;
  }
  return totals;
}
function invalidCompletedProgress(pathname: string, detail: string): Error {
  const error = new Error(
    `Invalid completed archive progress at ${pathname}: ${detail}`
  );
  (error as NodeJS.ErrnoException).code = 'archive_journal_invalid';
  return error;
}

async function verifyCompletedSpecProgress(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  for (const action of plan.specActions) {
    const progress = journal.specProgress.find(
      candidate => candidate.actionId === action.actionId
    );
    if (progress?.state !== 'complete') continue;
    const claimRoot =
      progress.temporary !== null
        ? path.dirname(progress.temporary)
        : progress.backupOrQuarantine === null
          ? null
          : path.dirname(progress.backupOrQuarantine);
    if (
      claimRoot === null ||
      (await pathExists(claimRoot, adapters)) !== 'absent'
    ) {
      throw invalidCompletedProgress(
        claimRoot ?? action.target,
        'the transaction claim root is not durably absent'
      );
    }
    const targetState = await pathExists(action.target, adapters);
    if (action.action === 'delete') {
      if (targetState !== 'absent') {
        throw invalidCompletedProgress(
          action.target,
          'a completed delete still has a durable target'
        );
      }
      continue;
    }
    if (targetState !== 'present' || !progress.publishedIdentity) {
      throw invalidCompletedProgress(
        action.target,
        'a completed publication has no durable target identity'
      );
    }
    const target = await readStableArchiveFile(action.target, adapters);
    if (
      adapters.sha256(target.content) !== adapters.sha256(action.rebuilt) ||
      !sameArchiveObject(
        target.stat,
        progress.publishedIdentity,
        'file'
      )
    ) {
      throw invalidCompletedProgress(
        action.target,
        'the durable target no longer matches the published payload capability'
      );
    }
  }
}

async function verifyCompletedCleanerProgress(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  for (const progress of journal.cleanerProgress) {
    if (
      progress.state !== 'deleted' &&
      progress.state !== 'deleted-after-intent' &&
      progress.state !== 'already-absent'
    ) {
      continue;
    }
    const target = path.join(plan.paths.ephemera, progress.path);
    if ((await pathExists(target, adapters)) !== 'absent') {
      throw archiveCleanerOwnershipError(
        target,
        plan,
        `Cleaner state '${progress.state}' disagrees with durable presence.`
      );
    }
  }
}

async function verifyRemovedSourceProgress(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  if (journal.sourceProgress.state !== 'removed') return;
  const quarantine = journal.sourceProgress.quarantine;
  const claimRoot = path.dirname(quarantine);
  for (const target of [plan.paths.active, quarantine, claimRoot]) {
    if ((await pathExists(target, adapters)) !== 'absent') {
      throw invalidCompletedProgress(
        target,
        'removed source progress disagrees with durable filesystem state'
      );
    }
  }
}

/**
 * Structural duck type keeps archive-engine independent from the concrete
 * accounting error class while retaining its precise operation/path.
 */
class ArchiveAccountingErrorLike {
  operation!: string;
  path!: string;
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'operation' in value &&
      typeof (value as { operation?: unknown }).operation === 'string' &&
      'path' in value &&
      typeof (value as { path?: unknown }).path === 'string'
    );
  }
}

async function copyArchivePayload(
  source: string,
  target: string,
  adapters: ArchiveEngineAdapters,
  topLevel = true
): Promise<void> {
  const entries = await adapters.fs.readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (topLevel && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const stat = await adapters.fs.lstat(from);
    if (stat.isSymbolicLink()) {
      const linkTarget = await adapters.fs.readlink(from);
      await adapters.fs.symlink(linkTarget, to);
    } else if (stat.isDirectory()) {
      await adapters.fs.mkdir(to);
      await copyArchivePayload(from, to, adapters, false);
    } else if (stat.isFile()) {
      await adapters.fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
    } else {
      throw new Error(`Unsupported archive payload entry: ${from}`);
    }
  }
}

/**
 * Publish a fully flushed temporary file without replacing an existing
 * destination. A same-volume hard link is atomic and fails with EEXIST.
 */
export async function publishArchiveFileNoReplace(
  temporary: string,
  target: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters,
  beforeTemporaryRemoval?: () => Promise<void>,
  transactionId = adapters.sha256(path.resolve(temporary)).slice(0, 32)
): Promise<void> {
  const temporaryStat = await adapters.fs.lstat(temporary);
  if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
    throw staleArchiveObject(
      temporary,
      'Archive publication temporary is not a real file'
    );
  }
  const temporaryIdentity = archiveDeletionIdentity(temporaryStat, 'file');
  await adapters.fs.link(temporary, target);
  const targetStat = await adapters.fs.lstat(target);
  if (!sameArchiveObject(targetStat, temporaryIdentity, 'file')) {
    throw staleArchiveObject(
      target,
      'Published archive file is not the linked temporary object'
    );
  }
  await beforeTemporaryRemoval?.();
  const claim = await moveArchiveObjectToPrivateClaim(
    temporary,
    temporaryIdentity,
    'file',
    transactionId,
    `publication-temporary:${path.basename(target)}`,
    adapters
  );
  await requireArchivePrivateClaim(claim, adapters);
  await adapters.fs.unlink(claim.claimed);
  await retireArchivePrivateClaim(claim, adapters);
  await flushArchiveDirectory(path.dirname(target), adapters);
}

export async function reserveArchiveDestination(
  target: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<void> {
  await adapters.fs.mkdir(target);
  await flushArchiveDirectory(path.dirname(target), adapters);
}

function archiveFinalOwnerContent(plan: ArchivePlan): string {
  return `${stableArchiveJson({
    kind: 'rasen.archive-final-owner',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    archivePath: plan.paths.final,
  })}\n`;
}

async function createArchiveFinalOwner(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveJournal['finalReservation']['entries'][number]> {
  const target = path.join(plan.paths.final, ARCHIVE_FINAL_OWNER_FILENAME);
  const content = archiveFinalOwnerContent(plan);
  await writeFlushedExclusiveFile(target, content, adapters);
  const stable = await readStableArchiveFile(target, adapters);
  if (stable.content.toString('utf8') !== content) {
    throw archiveReservationOwnershipError(
      target,
      'Fresh archive reservation owner sentinel changed during creation'
    );
  }
  return {
    path: ARCHIVE_FINAL_OWNER_FILENAME,
    kind: 'file',
    state: 'copied',
    expected: {
      path: ARCHIVE_FINAL_OWNER_FILENAME,
      kind: 'file',
      executable: false,
      size: statScalar(stable.stat.size),
      sha256: adapters.sha256(stable.content),
    },
    identity: archiveDeletionIdentity(stable.stat, 'file'),
  };
}

async function verifyArchiveFinalOwner(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveJournal['finalReservation']['entries'][number]> {
  const target = path.join(plan.paths.final, ARCHIVE_FINAL_OWNER_FILENAME);
  try {
    const stable = await readStableArchiveFile(target, adapters);
    const content = archiveFinalOwnerContent(plan);
    if (stable.content.toString('utf8') !== content) {
      throw new Error('sentinel content mismatch');
    }
    return {
      path: ARCHIVE_FINAL_OWNER_FILENAME,
      kind: 'file',
      state: 'copied',
      expected: {
        path: ARCHIVE_FINAL_OWNER_FILENAME,
        kind: 'file',
        executable: false,
        size: statScalar(stable.stat.size),
        sha256: adapters.sha256(stable.content),
      },
      identity: archiveDeletionIdentity(stable.stat, 'file'),
    };
  } catch (error) {
    throw archiveReservationOwnershipError(
      target,
      `Archive reservation owner sentinel is missing or invalid (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  }
}

async function publishArchiveMarker(
  plan: ArchivePlan,
  payload: ArchiveTreeFingerprint,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const target = path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME);
  await assertNoAtomicWriteTemporary(target, plan.transactionId, adapters);
  const temporary = path.join(
    plan.paths.final,
    `.${ARCHIVE_PUBLISHED_MARKER_FILENAME}.tmp-${plan.transactionId}`
  );
  const marker: ArchivePublishedMarkerV1 = {
    schemaVersion: 1,
    kind: 'rasen.archive-published',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    archivePath: plan.paths.final,
    payloadDigest: payload.digest,
  };
  let handle: FileHandle;
  try {
    handle = await adapters.fs.open(temporary, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw archiveTransactionTempOwnershipError(
        temporary,
        target,
        'The deterministic archive marker temporary is already occupied.'
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(`${stableArchiveJson(marker)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    await publishArchiveFileNoReplace(
      temporary,
      target,
      adapters,
      undefined,
      plan.transactionId
    );
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw archiveTransactionTempOwnershipError(
      temporary,
      target,
      `Archive marker publication did not complete (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

async function readArchiveMarker(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<ArchivePublishedMarkerV1 | null> {
  const markerPath = path.join(
    plan.paths.final,
    ARCHIVE_PUBLISHED_MARKER_FILENAME
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      (await readStableArchiveFile(markerPath, adapters)).content.toString('utf8')
    );
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (
    !isPlainRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== 'rasen.archive-published' ||
    parsed.transactionId !== plan.transactionId ||
    parsed.planHash !== plan.planHash ||
    parsed.archivePath !== plan.paths.final ||
    typeof parsed.payloadDigest !== 'string'
  ) {
    throw staleArchiveObject(
      markerPath,
      'Invalid archive publication marker'
    );
  }
  return parsed as unknown as ArchivePublishedMarkerV1;
}

async function archiveEntryFromSource(
  absolute: string,
  relative: string,
  stat: ArchiveFsStat,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveTreeEntry> {
  if (stat.isSymbolicLink()) {
    return {
      path: relative,
      kind: 'symlink',
      linkTarget: await adapters.fs.readlink(absolute),
    };
  }
  if (stat.isDirectory()) {
    return { path: relative, kind: 'directory' };
  }
  if (stat.isFile()) {
    const stable = await readStableArchiveFile(absolute, adapters);
    if (!identityMatches(stat, stable.stat)) {
      throw staleArchiveObject(
        absolute,
        'Archive copy source changed before handle-bound read'
      );
    }
    return {
      path: relative,
      kind: 'file',
      executable:
        process.platform === 'win32'
          ? false
          : (BigInt(stable.stat.mode) & 0o111n) !== 0n,
      size: statScalar(stable.stat.size),
      sha256: adapters.sha256(stable.content),
    };
  }
  throw new Error(`Unsupported archive payload entry: ${absolute}`);
}

async function verifyReservedArchiveEntry(
  absolute: string,
  expected: ArchiveTreeEntry,
  identity: ArchiveStatIdentity,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const stat = await adapters.fs.lstat(absolute);
  const kind: ArchiveTreeEntry['kind'] = stat.isSymbolicLink()
    ? 'symlink'
    : stat.isDirectory()
      ? 'directory'
      : stat.isFile()
        ? 'file'
        : expected.kind;
  if (
    kind !== expected.kind ||
    stableArchiveJson(archiveDeletionIdentity(stat, kind)) !==
      stableArchiveJson(identity)
  ) {
    throw staleArchiveObject(
      absolute,
      'Reserved archive entry identity changed during recovery'
    );
  }
  if (kind === 'symlink') {
    if ((await adapters.fs.readlink(absolute)) !== expected.linkTarget) {
      throw staleArchiveObject(
        absolute,
        'Reserved archive symlink target changed during recovery'
      );
    }
  } else if (kind === 'file') {
    const stable = await readStableArchiveFile(absolute, adapters);
    if (
      adapters.sha256(stable.content) !== expected.sha256 ||
      statScalar(stable.stat.size) !== expected.size ||
      (process.platform !== 'win32' &&
        ((BigInt(stable.stat.mode) & 0o111n) !== 0n) !== expected.executable)
    ) {
      throw staleArchiveObject(
        absolute,
        'Reserved archive file payload changed during recovery'
      );
    }
  }
}

async function listReservedArchivePayloadPaths(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<string[]> {
  const paths: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await adapters.fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
      const relative = normalizeRelative(
        prefix ? path.join(prefix, entry.name) : entry.name
      );
      paths.push(relative);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(path.join(current, entry.name), relative);
      }
    }
  }
  await walk(directory, '');
  return paths;
}

async function listArchiveReservationOccupants(
  directory: string,
  adapters: ArchiveEngineAdapters
): Promise<string[]> {
  const entries = await adapters.fs.readdir(directory, { withFileTypes: true });
  return entries.map(entry => entry.name).sort();
}

function archiveReservationOwnershipError(
  target: string,
  detail: string
): Error {
  const error = new Error(`${detail}: ${target}`);
  (error as NodeJS.ErrnoException).code =
    'archive_reservation_ownership_unverified';
  return error;
}

async function verifyReservedIntentTarget(
  absolute: string,
  expected: ArchiveTreeEntry,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveStatIdentity> {
  try {
    const stat = await adapters.fs.lstat(absolute);
    const kind: ArchiveTreeEntry['kind'] = stat.isSymbolicLink()
      ? 'symlink'
      : stat.isDirectory()
        ? 'directory'
        : stat.isFile()
          ? 'file'
          : expected.kind;
    if (kind !== expected.kind) {
      throw new Error(`Expected ${expected.kind}, observed ${kind}.`);
    }
    if (
      kind === 'directory' &&
      (await adapters.fs.readdir(absolute, { withFileTypes: true })).length > 0
    ) {
      throw new Error('Expected an empty newly-created directory.');
    }
    const identity = archiveDeletionIdentity(stat, kind);
    await verifyReservedArchiveEntry(absolute, expected, identity, adapters);
    return identity;
  } catch (error) {
    throw archiveReservationOwnershipError(
      absolute,
      `Archive reservation intent target does not exactly match its expected entry (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

async function assertOwnedArchiveReservation(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  if (
    journal.finalReservation?.state !== 'owned' ||
    !journal.finalReservation.identity
  ) {
    throw archiveReservationOwnershipError(
      plan.paths.final,
      'Archive reservation has no durable identity capability'
    );
  }
  const stat = await adapters.fs.lstat(plan.paths.final);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stableArchiveJson(archiveDeletionIdentity(stat, 'directory')) !==
      stableArchiveJson(journal.finalReservation.identity)
  ) {
    throw archiveReservationOwnershipError(
      plan.paths.final,
      'Archive reservation identity changed during recovery'
    );
  }
  const ownerEntry = journal.finalReservation.entries.find(
    entry => entry.path === ARCHIVE_FINAL_OWNER_FILENAME
  );
  if (!ownerEntry || ownerEntry.state !== 'copied' || !ownerEntry.identity) {
    throw archiveReservationOwnershipError(
      plan.paths.final,
      'Archive reservation has no durable owner-sentinel capability'
    );
  }
  const observedOwner = await verifyArchiveFinalOwner(plan, adapters);
  if (
    stableArchiveJson(ownerEntry.expected) !==
      stableArchiveJson(observedOwner.expected) ||
    stableArchiveJson(ownerEntry.identity) !==
      stableArchiveJson(observedOwner.identity)
  ) {
    throw archiveReservationOwnershipError(
      plan.paths.final,
      'Archive reservation owner sentinel changed during recovery'
    );
  }
  const accounted = new Set(
    journal.finalReservation.entries.map(entry => entry.path)
  );
  const effectivePhase =
    journal.phase === 'failed' ? journal.resumePhase : journal.phase;
  if (phaseAtLeast(effectivePhase, 'published')) {
    accounted.add(ARCHIVE_PUBLISHED_MARKER_FILENAME);
  }
  if (phaseAtLeast(effectivePhase, 'accounting-finalized')) {
    accounted.add('archive.json');
  }
  const current = await listReservedArchivePayloadPaths(plan.paths.final, adapters);
  const unaccounted = current.filter(relative => !accounted.has(relative));
  if (unaccounted.length > 0) {
    throw archiveReservationOwnershipError(
      plan.paths.final,
      `Archive reservation contains unaccounted occupant(s): ${unaccounted.join(', ')}`
    );
  }
  for (const entry of journal.finalReservation.entries) {
    const absolute = path.join(plan.paths.final, ...entry.path.split('/'));
    const state = await pathExists(absolute, adapters);
    if (entry.state === 'intent') {
      if (state === 'present') {
        await verifyReservedIntentTarget(absolute, entry.expected, adapters);
      }
      continue;
    }
    if (state !== 'present' || !entry.identity) {
      throw archiveReservationOwnershipError(
        absolute,
        'Recorded reserved archive entry is absent or lacks identity'
      );
    }
    try {
      await verifyReservedArchiveEntry(
        absolute,
        entry.expected,
        entry.identity,
        adapters
      );
    } catch (error) {
      throw archiveReservationOwnershipError(
        absolute,
        `Recorded reserved archive entry no longer matches its durable identity (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
}

async function copyArchivePayloadIntoReservation(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  adapters: ArchiveEngineAdapters,
  flush: () => Promise<void>
): Promise<void> {
  await assertOwnedArchiveReservation(plan, journal, adapters);

  async function walk(source: string, prefix: string): Promise<void> {
    const entries = await adapters.fs.readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ARCHIVE_CONTROL_FILENAMES.has(entry.name)) continue;
      const from = path.join(source, entry.name);
      const relative = normalizeRelative(
        prefix ? path.join(prefix, entry.name) : entry.name
      );
      const to = path.join(plan.paths.final, ...relative.split('/'));
      const stat = await adapters.fs.lstat(from);
      const expected = await archiveEntryFromSource(
        from,
        relative,
        stat,
        adapters
      );
      let progress = journal.finalReservation.entries.find(
        candidate => candidate.path === relative
      );
      if (!progress) {
        progress = {
          path: relative,
          kind: expected.kind,
          expected,
          state: 'intent',
        };
        journal.finalReservation.entries.push(progress);
        journal.finalReservation.entries.sort((left, right) =>
          left.path.localeCompare(right.path)
        );
        await flush();
      } else if (
        progress.kind !== expected.kind ||
        stableArchiveJson(progress.expected) !== stableArchiveJson(expected)
      ) {
        throw staleArchiveObject(
          from,
          'Staged archive entry changed after copy intent'
        );
      }

      const targetState = await pathExists(to, adapters);
      if (progress.state === 'copied') {
        if (targetState !== 'present' || !progress.identity) {
          throw archiveReservationOwnershipError(
            to,
            'Recorded reserved archive entry disappeared'
          );
        }
        try {
          await verifyReservedArchiveEntry(
            to,
            progress.expected,
            progress.identity,
            adapters
          );
        } catch (error) {
          throw archiveReservationOwnershipError(
            to,
            `Recorded reserved archive entry no longer matches its durable identity (${error instanceof Error ? error.message : String(error)})`
          );
        }
      } else {
        if (targetState === 'present') {
          progress.identity = await verifyReservedIntentTarget(
            to,
            expected,
            adapters
          );
        } else {
          if (expected.kind === 'symlink') {
            await adapters.fs.symlink(expected.linkTarget!, to);
          } else if (expected.kind === 'directory') {
            await adapters.fs.mkdir(to);
          } else {
            await adapters.fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
          }
          progress.identity = await verifyReservedIntentTarget(
            to,
            expected,
            adapters
          );
        }
        progress.state = 'copied';
        await flush();
      }

      if (expected.kind === 'directory') {
        await walk(from, relative);
      }
    }
  }
  await walk(plan.paths.stage, '');
  await assertOwnedArchiveReservation(plan, journal, adapters);
}

function identityForAuthorityEntry(
  stat: ArchiveFsStat,
  kind: ArchiveAuthorityEntry['kind']
): ArchiveStatIdentity {
  return archiveDeletionIdentity(stat, kind);
}

async function removeClaimedArchiveEntriesGuarded(
  claimedRoot: string,
  authority: ArchiveTreeFingerprint,
  adapters: ArchiveEngineAdapters,
  allowMissing = false
): Promise<void> {
  const ordered = [...authority.authorityEntries].sort(
    (left, right) =>
      right.path.split('/').length - left.path.split('/').length ||
      right.path.localeCompare(left.path)
  );
  for (const entry of ordered) {
    const absolute = path.join(claimedRoot, ...entry.path.split('/'));
    let stat: ArchiveFsStat;
    try {
      stat = await adapters.fs.lstat(absolute);
    } catch (error) {
      if (allowMissing && errorCode(error) === 'ENOENT') continue;
      throw error;
    }
    const kind: ArchiveAuthorityEntry['kind'] = stat.isSymbolicLink()
      ? 'symlink'
      : stat.isDirectory()
        ? 'directory'
        : stat.isFile()
          ? 'file'
          : entry.kind;
    if (
      kind !== entry.kind ||
      stableArchiveJson(identityForAuthorityEntry(stat, kind)) !==
        stableArchiveJson(entry.identity)
    ) {
      const conflict = new Error(
        `Claimed archive object identity changed before deletion: ${absolute}`
      );
      (conflict as NodeJS.ErrnoException).code = 'ESTALE';
      throw conflict;
    }
    if (kind === 'directory') await adapters.fs.rmdir(absolute);
    else await adapters.fs.unlink(absolute);
  }
}

/**
 * Delete only the exact objects represented by a previously verified
 * deletion authority. Every leaf is revalidated immediately before unlink;
 * directories are removed bottom-up without recursive rm.
 */
export async function removeClaimedArchiveTreeGuarded(
  claimedRoot: string,
  authority: ArchiveTreeFingerprint,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters,
  allowMissing = false
): Promise<void> {
  await removeClaimedArchiveEntriesGuarded(
    claimedRoot,
    authority,
    adapters,
    allowMissing
  );
  const rootStat = await adapters.fs.lstat(claimedRoot);
  if (
    !rootStat.isDirectory() ||
    stableArchiveJson(archiveDeletionIdentity(rootStat, 'directory')) !==
      stableArchiveJson(authority.rootIdentity)
  ) {
    const conflict = new Error(
      `Claimed archive root identity changed before deletion: ${claimedRoot}`
    );
    (conflict as NodeJS.ErrnoException).code = 'ESTALE';
    throw conflict;
  }
  await adapters.fs.rmdir(claimedRoot);
}

const ARCHIVE_STAGE_OWNERSHIP_CODE = 'archive_stage_ownership_unverified';

function archiveStageOwnershipError(
  stage: string,
  detail: string,
  retainedPaths: string[] = []
): Error {
  const error = new Error(
    `${detail} Retained archive stage at ${stage}; preserve it and the durable journal for manual recovery.`
  ) as Error & { retainedPaths: string[] };
  (error as NodeJS.ErrnoException).code = ARCHIVE_STAGE_OWNERSHIP_CODE;
  error.retainedPaths = [stage, ...retainedPaths];
  return error;
}

const ARCHIVE_CLAIM_OWNERSHIP_CODE =
  'archive_claim_ownership_unverified';
const ARCHIVE_CLEANER_OWNERSHIP_CODE =
  'archive_cleaner_ownership_unverified';

function archiveCleanerOwnershipError(
  candidate: string,
  plan: ArchivePlan,
  detail: string
): Error {
  const error = new Error(detail) as Error & { retainedPaths: string[] };
  (error as NodeJS.ErrnoException).code = ARCHIVE_CLEANER_OWNERSHIP_CODE;
  error.retainedPaths = [
    candidate,
    plan.paths.final,
    plan.paths.publishedJournal,
  ];
  return error;
}


function archiveClaimOwnershipError(
  claimRoot: string,
  detail: string,
  retainedPaths: string[] = [claimRoot]
): Error {
  const error = new Error(
    `${detail} Retained claim state at ${claimRoot}; preserve it and the durable journal for manual recovery.`
  ) as Error & { retainedPaths: string[] };
  (error as NodeJS.ErrnoException).code = ARCHIVE_CLAIM_OWNERSHIP_CODE;
  error.retainedPaths = [...new Set([claimRoot, ...retainedPaths])];
  return error;
}

async function requireClaimRootOccupants(
  claimRoot: string,
  allowedNames: readonly string[],
  adapters: ArchiveEngineAdapters,
  retainedPaths: string[] = []
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await adapters.fs.readdir(claimRoot, { withFileTypes: true });
  } catch (error) {
    throw archiveClaimOwnershipError(
      claimRoot,
      `Claim root cannot be inventoried: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      retainedPaths
    );
  }
  const allowed = new Set(allowedNames);
  const unknown = entries
    .filter(entry => !allowed.has(entry.name))
    .map(entry => path.join(claimRoot, entry.name));
  if (unknown.length > 0) {
    throw archiveClaimOwnershipError(
      claimRoot,
      `Claim root contains unverified occupants: ${unknown.join(', ')}.`,
      [...retainedPaths, ...unknown]
    );
  }
}

async function requireClaimRootIdentity(
  claimRoot: string,
  expected: ArchiveStatIdentity,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let stat: ArchiveFsStat;
  try {
    stat = await adapters.fs.lstat(claimRoot);
  } catch (error) {
    throw archiveClaimOwnershipError(
      claimRoot,
      `Claim root is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stableArchiveJson(archiveDeletionIdentity(stat, 'directory')) !==
      stableArchiveJson(expected)
  ) {
    throw archiveClaimOwnershipError(
      claimRoot,
      'Claim root is not the durably recorded real directory.'
    );
  }
}

async function removeVerifiedEmptyClaimRoot(
  claimRoot: string,
  expected: ArchiveStatIdentity,
  adapters: ArchiveEngineAdapters,
  retainedPaths: string[]
): Promise<void> {
  await requireClaimRootOccupants(claimRoot, [], adapters, retainedPaths);
  await requireClaimRootIdentity(claimRoot, expected, adapters);
  try {
    await adapters.fs.rmdir(claimRoot);
  } catch (error) {
    throw archiveClaimOwnershipError(
      claimRoot,
      `Claim root changed at the removal boundary: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      retainedPaths
    );
  }
}

async function createOrValidateClaimRoot(
  claimRoot: string,
  expected: ArchiveStatIdentity | undefined,
  adapters: ArchiveEngineAdapters,
  retainedPaths: string[] = []
): Promise<ArchiveStatIdentity> {
  let created = false;
  let existed = false;
  try {
    await adapters.fs.mkdir(claimRoot);
    created = true;
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    existed = true;
  }
  let stat: ArchiveFsStat;
  try {
    stat = await adapters.fs.lstat(claimRoot);
  } catch (error) {
    throw archiveClaimOwnershipError(
      claimRoot,
      `Claim root cannot be inspected after ${created ? 'creation' : 'resume'}: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      retainedPaths
    );
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw archiveClaimOwnershipError(
      claimRoot,
      'The deterministic claim root is not a real non-symlink directory.',
      retainedPaths
    );
  }
  if (existed && !expected) {
    throw archiveClaimOwnershipError(
      claimRoot,
      'A deterministic claim root already exists without durable ownership identity.',
      retainedPaths
    );
  }
  const observed = archiveDeletionIdentity(stat, 'directory');
  if (
    expected &&
    stableArchiveJson(observed) !== stableArchiveJson(expected)
  ) {
    throw archiveClaimOwnershipError(
      claimRoot,
      'The deterministic claim root identity differs from durable recovery state.',
      retainedPaths
    );
  }
  return observed;
}

function plannedStagePayloadOwns(
  current: ArchiveTreeFingerprint,
  planned: ArchiveTreeFingerprint
): boolean {
  const plannedEntries = new Map(
    planned.entries.map(entry => [entry.path, entry] as const)
  );
  return current.entries.every(entry => {
    const expected = plannedEntries.get(entry.path);
    return (
      expected !== undefined &&
      stableArchiveJson(expected) === stableArchiveJson(entry)
    );
  });
}

function recordedStageAuthorityOwns(
  current: ArchiveTreeFingerprint,
  recorded: ArchiveTreeFingerprint
): boolean {
  const recordedEntries = new Map(
    recorded.authorityEntries.map(entry => [entry.path, entry] as const)
  );
  return current.authorityEntries.every(entry => {
    const expected = recordedEntries.get(entry.path);
    return (
      expected !== undefined &&
      expected.kind === entry.kind &&
      stableArchiveJson(expected.identity) === stableArchiveJson(entry.identity)
    );
  });
}

async function assertOwnedStageJournal(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  expected: ArchiveJournal | null
): Promise<ArchiveStatIdentity | null> {
  let stable: { content: Buffer; stat: ArchiveFsStat };
  try {
    stable = await readStableArchiveFile(plan.paths.journal, adapters);
  } catch (error) {
    if (expected === null && errorCode(error) === 'ENOENT') return null;
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'The stage journal is missing or is not a stable transaction control file.'
    );
  }
  let observed: unknown;
  try {
    observed = JSON.parse(stable.content.toString('utf8'));
  } catch {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'The stage journal is not valid transaction control state.'
    );
  }
  const parsed = parseArchiveJournalV2(
    observed,
    plan.paths.journal,
    adapters
  );
  const parsedPhase =
    parsed.phase === 'failed' ? parsed.failure!.resumePhase : parsed.phase;
  if (
    parsed.transactionId !== plan.transactionId ||
    parsed.planHash !== plan.planHash ||
    parsed.change !== plan.change ||
    parsed.activePath !== plan.paths.active ||
    parsed.stagePath !== plan.paths.stage ||
    parsed.finalPath !== plan.paths.final ||
    (expected === null && parsedPhase !== 'specs-applied') ||
    (expected !== null &&

      stableArchiveJson(parsed) !== stableArchiveJson(expected))
  ) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'The stage journal is not owned by the exact archive transaction.'
    );
  }
  return archiveDeletionIdentity(stable.stat, 'file');
}
function archiveStageOwnerContent(plan: ArchivePlan): string {
  return `${stableArchiveJson({
    kind: 'rasen.archive-stage-owner',
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    stagePath: plan.paths.stage,
  })}\n`;
}

async function requireArchiveStageOwner(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<ArchiveStatIdentity> {
  const stage = await adapters.fs.lstat(plan.paths.stage);
  if (!stage.isDirectory() || stage.isSymbolicLink()) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'Archive stage is not a real transaction-owned directory.'
    );
  }
  const ownerPath = path.join(
    plan.paths.stage,
    ARCHIVE_STAGE_OWNER_FILENAME
  );
  let owner: { content: Buffer; stat: ArchiveFsStat };
  try {
    owner = await readStableArchiveFile(ownerPath, adapters);
  } catch (error) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      `Archive stage ownership sentinel is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      [ownerPath]
    );
  }
  if (owner.content.toString('utf8') !== archiveStageOwnerContent(plan)) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'Archive stage ownership sentinel does not match this transaction.',
      [ownerPath]
    );
  }
  return archiveDeletionIdentity(stage, 'directory');
}

async function createArchiveOwnedStage(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const parentBinding = await bindArchiveRealDirectoryChain(
    plan.paths.archiveParent,
    plan.paths.archiveParent,
    adapters
  );
  await adapters.fs.mkdir(plan.paths.stage, { mode: 0o700 });
  await requireArchiveRealDirectoryChain(parentBinding, adapters);
  const stage = await adapters.fs.lstat(plan.paths.stage);
  if (!stage.isDirectory() || stage.isSymbolicLink()) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      'Fresh archive stage was replaced before ownership binding.'
    );
  }
  const ownerPath = path.join(
    plan.paths.stage,
    ARCHIVE_STAGE_OWNER_FILENAME
  );
  await writeFlushedExclusiveFile(
    ownerPath,
    archiveStageOwnerContent(plan),
    adapters
  );
  await requireArchiveStageOwner(plan, adapters);
  await flushArchiveDirectory(plan.paths.archiveParent, adapters);
}

async function removeArchiveStageGuarded(
  plan: ArchivePlan,
  journal: ArchiveJournal,
  mode: 'planned' | 'terminal',
  adapters: ArchiveEngineAdapters
): Promise<void> {
  try {
    await adapters.fs.lstat(plan.paths.stage);
  } catch (error) {
    if (mode === 'terminal' && errorCode(error) === 'ENOENT') return;
    throw error;
  }
  await requireArchiveStageOwner(plan, adapters);
  const topLevel = await adapters.fs.readdir(plan.paths.stage, {
    withFileTypes: true,
  });
  const unownedControls = topLevel
    .filter(
      entry =>
        ARCHIVE_CONTROL_FILENAMES.has(entry.name) &&
        entry.name !== ARCHIVE_JOURNAL_FILENAME &&
        entry.name !== ARCHIVE_STAGE_OWNER_FILENAME
    )
    .map(entry => entry.name)
    .sort();
  if (unownedControls.length > 0) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      `The stage contains unowned control entries: ${unownedControls.join(', ')}.`
    );
  }

  let current: ArchiveTreeFingerprint;
  try {
    current = await fingerprintArchiveTree(plan.paths.stage, adapters);
  } catch (error) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      `The stage payload could not be proven owned: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  if (mode === 'planned') {
    if (
      plan.sourceFingerprint === null ||
      !plannedStagePayloadOwns(current, plan.sourceFingerprint)
    ) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'The partial stage contains unplanned or payload-mismatched content outside the immutable planned payload.'
      );
    }
  } else {
    const recorded =
      journal.phaseFingerprints['evidence-finalized']?.observedAfter;
    if (
      recorded === undefined ||
      !recordedStageAuthorityOwns(current, recorded)
    ) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'The terminal stage contains an object outside its verified deletion authority.'
      );
    }
  }

  const journalIdentity = await assertOwnedStageJournal(
    plan,
    adapters,
    mode === 'planned' ? journal : null
  );
  const claim = await moveArchiveObjectToPrivateClaim(
    plan.paths.stage,
    current.rootIdentity,
    'directory',
    plan.transactionId,
    `stage-cleanup:${mode}`,
    adapters
  );
  const moved = await fingerprintArchiveTree(claim.claimed, adapters);
  if (!archiveDeletionAuthorityMatches(moved, current)) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Claimed archive stage differs from its pre-claim deletion authority.',
      [plan.paths.stage, claim.claimed]
    );
  }
  try {
    await removeClaimedArchiveEntriesGuarded(
      claim.claimed,
      current,
      adapters
    );
    if (journalIdentity !== null) {
      const claimedJournal = path.join(
        claim.claimed,
        ARCHIVE_JOURNAL_FILENAME
      );
      const journalStat = await adapters.fs.lstat(claimedJournal);
      if (
        !journalStat.isFile() ||
        journalStat.isSymbolicLink() ||
        stableArchiveJson(archiveDeletionIdentity(journalStat, 'file')) !==
          stableArchiveJson(journalIdentity)
      ) {
        throw archiveClaimOwnershipError(
          claim.root,
          'Claimed stage journal changed after ownership verification.',
          [plan.paths.stage, claimedJournal]
        );
      }
      await adapters.fs.unlink(claimedJournal);
    }
    await requireArchivePrivateClaim(claim, adapters);
    const claimedRoot = await adapters.fs.lstat(claim.claimed);
    if (
      !claimedRoot.isDirectory() ||
      claimedRoot.isSymbolicLink() ||
      !sameArchiveObject(claimedRoot, current.rootIdentity, 'directory')
    ) {
      throw archiveClaimOwnershipError(
        claim.root,
        'Claimed stage root changed before final removal.',
        [plan.paths.stage, claim.claimed]
      );
    }
    await adapters.fs.rmdir(claim.claimed);
    await retireArchivePrivateClaim(claim, adapters);
  } catch (error) {
    if (
      errorCode(error) === 'ESTALE' ||
      errorCode(error) === 'ENOTEMPTY' ||
      errorCode(error) === 'EEXIST'
    ) {
      throw archiveClaimOwnershipError(
        claim.root,
        'Claimed stage changed after ownership verification.',
        [plan.paths.stage, claim.claimed]
      );
    }
    throw error;
  }
}


const ARCHIVE_HANDOFF_OWNERSHIP_CODE =
  'archive_handoff_ownership_unverified';

async function applyStagedHandoff(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  authority: ArchiveTreeFingerprint
): Promise<void> {
  if (plan.sidecar.disposition === 'unjudged-preserve-all') return;

  async function requireDurableHandoffFile(
    target: string,
    relativePath: string
  ): Promise<ArchiveFsStat> {
    const authorityEntry = authority.authorityEntries.find(
      entry => entry.path === relativePath
    );
    const payloadEntry = authority.entries.find(
      entry => entry.path === relativePath
    );
    if (
      !authorityEntry ||
      authorityEntry.kind !== 'file' ||
      !payloadEntry ||
      payloadEntry.kind !== 'file' ||
      !payloadEntry.sha256
    ) {
      throw staleArchiveObject(
        target,
        'Durable handoff authority is missing its file identity'
      );
    }
    const stable = await readStableArchiveFile(target, adapters);
    if (
      !sameArchiveObject(stable.stat, authorityEntry.identity, 'file') ||
      adapters.sha256(stable.content) !== payloadEntry.sha256
    ) {
      throw staleArchiveObject(
        target,
        'Handoff file differs from its durable pre-transform identity'
      );
    }
    return stable.stat;
  }

  function handoffConflict(message: string, code = 'ESTALE'): Error {
    const conflict = new Error(message);
    (conflict as NodeJS.ErrnoException).code = code;
    return conflict;
  }

  function handoffOwnershipConflict(
    message: string,
    retainedPaths: string[]
  ): Error {
    const conflict = new Error(message) as Error & { retainedPaths: string[] };
    (conflict as NodeJS.ErrnoException).code =
      ARCHIVE_HANDOFF_OWNERSHIP_CODE;
    conflict.retainedPaths = [
      ...new Set([plan.paths.stage, ...retainedPaths]),
    ];
    return conflict;
  }

  async function bindHandoffDestinationParent(
    destination: string
  ): Promise<ArchiveDirectoryIdentityBinding[]> {
    let bindings: ArchiveDirectoryIdentityBinding[];
    try {
      bindings = await ensureArchiveRealDirectoryChain(
        plan.paths.stage,
        path.dirname(destination),
        adapters
      );
    } catch (error) {
      throw handoffOwnershipConflict(
        `Handoff destination parent cannot be safely created or bound: ${destination} (${
          error instanceof Error ? error.message : String(error)
        })`,
        [destination]
      );
    }
    if (
      !bindings[0] ||
      stableArchiveJson(bindings[0].identity) !==
        stableArchiveJson(authority.rootIdentity)
    ) {
      throw handoffOwnershipConflict(
        `Handoff stage identity changed before destination creation: ${plan.paths.stage}`,
        [destination]
      );
    }
    return bindings;
  }

  async function bindHandoffSourceParent(
    source: string
  ): Promise<ArchiveDirectoryIdentityBinding[]> {
    let bindings: ArchiveDirectoryIdentityBinding[];
    try {
      bindings = await bindArchiveRealDirectoryChain(
        plan.paths.stage,
        path.dirname(source),
        adapters
      );
    } catch (error) {
      throw handoffOwnershipConflict(
        `Handoff source parent cannot be safely bound: ${source} (${
          error instanceof Error ? error.message : String(error)
        })`,
        [source]
      );
    }
    if (
      !bindings[0] ||
      stableArchiveJson(bindings[0].identity) !==
        stableArchiveJson(authority.rootIdentity)
    ) {
      throw handoffOwnershipConflict(
        `Handoff stage identity changed before source mutation: ${plan.paths.stage}`,
        [source]
      );
    }
    return bindings;
  }

  async function claimAndRemoveHandoffFile(
    source: string,
    relativePath: string
  ): Promise<void> {
    const sourceStat = await requireDurableHandoffFile(source, relativePath);
    const claim = await moveArchiveObjectToPrivateClaim(
      source,
      archiveDeletionIdentity(sourceStat, 'file'),
      'file',
      plan.transactionId,
      `handoff-file:${relativePath}`,
      adapters
    );
    const claimed = await readStableArchiveFile(claim.claimed, adapters);
    const payloadEntry = authority.entries.find(
      entry => entry.path === relativePath && entry.kind === 'file'
    );
    if (
      !payloadEntry?.sha256 ||
      adapters.sha256(claimed.content) !== payloadEntry.sha256
    ) {
      throw archiveClaimOwnershipError(
        claim.root,
        'Claimed handoff file content differs from durable authority.',
        [source, claim.claimed]
      );
    }
    await requireArchivePrivateClaim(claim, adapters);
    await adapters.fs.unlink(claim.claimed);
    await retireArchivePrivateClaim(claim, adapters);
  }

  async function removeAuthorizedHandoffDirectories(): Promise<void> {
    const directories = authority.authorityEntries
      .filter(
        entry =>
          entry.kind === 'directory' &&
          (entry.path === 'handoff' || entry.path.startsWith('handoff/'))
      )
      .sort(
        (left, right) =>
          right.path.split('/').length - left.path.split('/').length ||
          right.path.localeCompare(left.path)
      );
    for (const expected of directories) {
      const directory = path.join(
        plan.paths.stage,
        ...expected.path.split('/')
      );
      let entries: Dirent[];
      try {
        entries = await adapters.fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue;
        throw handoffOwnershipConflict(
          `Handoff directory cannot be inspected before cleanup: ${directory} (${
            error instanceof Error ? error.message : String(error)
          })`,
          [directory]
        );
      }
      if (entries.length > 0) {
        throw handoffOwnershipConflict(
          `Handoff directory contains unverified occupants: ${directory}`,
          [directory, ...entries.map(entry => path.join(directory, entry.name))]
        );
      }
      const stat = await adapters.fs.lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !sameArchiveObject(stat, expected.identity, 'directory')
      ) {
        throw handoffOwnershipConflict(
          `Handoff directory identity changed before removal: ${directory}`,
          [directory]
        );
      }
      const claim = await moveArchiveObjectToPrivateClaim(
        directory,
        expected.identity,
        'directory',
        plan.transactionId,
        `handoff-directory:${expected.path}`,
        adapters
      );
      const claimedEntries = await adapters.fs.readdir(claim.claimed, {
        withFileTypes: true,
      });
      if (claimedEntries.length > 0) {
        throw archiveClaimOwnershipError(
          claim.root,
          'Claimed handoff directory contains unverified occupants.',
          [
            directory,
            claim.claimed,
            ...claimedEntries.map(entry =>
              path.join(claim.claimed, entry.name)
            ),
          ]
        );
      }
      await requireArchivePrivateClaim(claim, adapters);
      await adapters.fs.rmdir(claim.claimed);
      await retireArchivePrivateClaim(claim, adapters);
    }
  }

  for (const decision of plan.sidecar.handoff.decisions) {
    const relativeParts = decision.path.split('/');
    const source = path.join(plan.paths.stage, ...relativeParts);
    const sourceParentBindings = await bindHandoffSourceParent(source);
    if (decision.outcome === 'absorbed') {
      if ((await pathExists(source, adapters)) === 'present') {
        await requireDurableHandoffFile(source, decision.path);
        await requireArchiveRealDirectoryChain(sourceParentBindings, adapters);
        await claimAndRemoveHandoffFile(source, decision.path);
      }
      continue;
    }
    const handoffRelative = relativeParts.slice(1);
    const destination = path.join(
      plan.paths.stage,
      'evidence',
      'handoff',
      ...handoffRelative
    );
    const destinationParentBindings =
      await bindHandoffDestinationParent(destination);
    const sourceState = await pathExists(source, adapters);
    const destinationState = await pathExists(destination, adapters);
    if (sourceState === 'absent' && destinationState === 'present') {
      try {
        await requireDurableHandoffFile(destination, decision.path);
      } catch (error) {
        throw handoffOwnershipConflict(
          `Handoff destination exists without durable ownership: ${destination} (${
            error instanceof Error ? error.message : String(error)
          })`,
          [destination]
        );
      }
      continue;
    }
    if (sourceState === 'present' && destinationState === 'absent') {
      await requireDurableHandoffFile(source, decision.path);
      await requireArchiveRealDirectoryChain(sourceParentBindings, adapters);
      await requireArchiveRealDirectoryChain(
        destinationParentBindings,
        adapters
      );
      try {
        await adapters.fs.link(source, destination);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw handoffOwnershipConflict(
            `Handoff destination appeared at the no-replace boundary: ${destination}`,
            [source, destination]
          );
        }
        throw error;
      }
      const destinationStat = await requireDurableHandoffFile(
        destination,
        decision.path
      );
      const sourceStat = await requireDurableHandoffFile(
        source,
        decision.path
      );
      if (!identityMatches(sourceStat, destinationStat)) {
        throw handoffOwnershipConflict(
          `Handoff hard-link identity mismatch: ${decision.path}`,
          [source, destination]
        );
      }
      await requireArchiveRealDirectoryChain(sourceParentBindings, adapters);
      await requireArchiveRealDirectoryChain(
        destinationParentBindings,
        adapters
      );
      await claimAndRemoveHandoffFile(source, decision.path);
      continue;
    }
    if (sourceState === 'present' && destinationState === 'present') {
      const sourceBefore = await adapters.fs.lstat(source);
      const destinationBefore = await adapters.fs.lstat(destination);
      if (!identityMatches(sourceBefore, destinationBefore)) {
        throw handoffOwnershipConflict(
          `Handoff resume conflict: source and destination are different objects, path=${decision.path}`,
          [source, destination]
        );
      }
      await requireDurableHandoffFile(destination, decision.path);
      await requireDurableHandoffFile(source, decision.path);
      await requireArchiveRealDirectoryChain(sourceParentBindings, adapters);
      await requireArchiveRealDirectoryChain(
        destinationParentBindings,
        adapters
      );
      await claimAndRemoveHandoffFile(source, decision.path);
      continue;
    }
    throw handoffConflict(
      `Handoff resume conflict: source=${sourceState}, destination=${destinationState}, path=${decision.path}`
    );
  }
  await removeAuthorizedHandoffDirectories();
}

function extractRecordedShipCommit(content: string): string | null {
  const match = content.match(/^\*\*Commit:\*\*\s*([0-9a-f]{7,64})\s*$/im);
  return match?.[1] ?? null;
}

async function finalizeStagedShipLog(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const evidenceRoot = path.join(plan.paths.stage, 'evidence');
  const target = path.join(evidenceRoot, 'ship-log.md');
  let evidenceBindings: ArchiveDirectoryIdentityBinding[];
  try {
    evidenceBindings = await ensureArchiveRealDirectoryChain(
      plan.paths.stage,
      evidenceRoot,
      adapters
    );
  } catch (error) {
    throw archiveStageOwnershipError(
      plan.paths.stage,
      `The staged evidence directory cannot be safely created or bound: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }

  async function requireEvidenceBindings(): Promise<void> {
    try {
      await requireArchiveRealDirectoryChain(evidenceBindings, adapters);
    } catch (error) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        `The staged evidence directory identity changed before mutation: ${
          error instanceof Error ? error.message : String(error)
        }.`,
        [evidenceRoot, target]
      );
    }
  }

  async function readBoundStageFile(
    candidate: string
  ): Promise<{ content: string; stat: ArchiveFsStat } | null> {
    await requireEvidenceBindings();
    let stable: { content: Buffer; stat: ArchiveFsStat };
    try {
      stable = await readStableArchiveFile(candidate, adapters);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw archiveStageOwnershipError(
        plan.paths.stage,
        `The staged ship-log object cannot be safely read: ${candidate} (${
          error instanceof Error ? error.message : String(error)
        }).`
      );
    }
    await requireEvidenceBindings();
    return { content: stable.content.toString('utf8'), stat: stable.stat };
  }

  const existingTarget = await readBoundStageFile(target);
  let content: string;
  if (existingTarget !== null) {
    content = existingTarget.content;
  } else {
    const stagedLegacy = path.join(plan.paths.stage, 'ship-log.md');
    const legacy = await readBoundStageFile(stagedLegacy);
    if (legacy !== null) {
      content = legacy.content;
    } else if (plan.shipLog.source) {
      const source = await readStableArchiveFile(plan.shipLog.source, adapters);
      const sourceContent = source.content.toString('utf8');
      if (
        plan.shipLog.sha256 &&
        adapters.sha256(sourceContent) !== plan.shipLog.sha256
      ) {
        const drift = new Error('Ship log changed after archive planning.');
        (drift as NodeJS.ErrnoException).code = 'ESTALE';
        throw drift;
      }
      content = sourceContent;
    } else {
      content = `# Ship Log: ${plan.change}\n`;
    }
  }

  if (hasReservedArchiveShipLogSection(content)) {
    if (!content.includes(`**Transaction:** ${plan.transactionId}`)) {
      const collision = new Error(
        'Ship log already has an archive section for another transaction.'
      );
      (collision as NodeJS.ErrnoException).code =
        ARCHIVE_SHIP_LOG_RESERVED_SECTION_CODE;
      throw collision;
    }
    return;
  }
  const recordedCommit =
    plan.shipLog.recordedCommit ?? extractRecordedShipCommit(content);
  const suffix = [
    '',
    '## Archive',
    `**Date:** ${plan.createdAt}`,
    ...(recordedCommit ? [`**Ship commit:** ${recordedCommit}`] : []),
    `**Outcome:** archived at ${plan.paths.final}`,
    `**Transaction:** ${plan.transactionId}`,
    '',
  ].join('\n');
  const finalizedContent = `${content}${suffix}`;

  await requireEvidenceBindings();
  let handle: FileHandle | undefined;
  try {
    handle = await adapters.fs.open(
      target,
      existingTarget === null ? 'wx' : 'r+',
      0o600
    );
    const beforeHandle = await handle.stat({ bigint: true });
    if (
      !beforeHandle.isFile() ||
      (existingTarget !== null &&
        !identityMatches(existingTarget.stat, beforeHandle))
    ) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'The staged ship-log target changed before its handle-bound write.'
      );
    }
    const beforePath = await adapters.fs.lstat(target);
    if (
      !beforePath.isFile() ||
      beforePath.isSymbolicLink() ||
      !identityMatches(beforeHandle, beforePath)
    ) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'The staged ship-log pathname changed before its handle-bound write.'
      );
    }
    await requireEvidenceBindings();
    await handle.truncate(0);
    await handle.writeFile(finalizedContent, 'utf8');
    await handle.sync();
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await adapters.fs.lstat(target);
    if (
      !afterHandle.isFile() ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      statScalar(afterHandle.dev) !== statScalar(afterPath.dev) ||
      statScalar(afterHandle.ino) !== statScalar(afterPath.ino)
    ) {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'The staged ship-log pathname changed during its handle-bound write.'
      );
    }
    await requireEvidenceBindings();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (errorCode(error) === 'EEXIST') {
      throw archiveStageOwnershipError(
        plan.paths.stage,
        'An unowned staged ship-log target appeared before publication.'
      );
    }
    throw error;
  }
}

function isQualityFilename(name: string): boolean {
  return /(?:-review|-report|-audit)\.md$/i.test(name);
}

export interface ArchiveQualitySummary {
  files: string[];
  metrics: Record<string, number>;
}

export async function captureArchiveQuality(
  archiveRoot: string,
  adapters: ArchiveEngineAdapters = defaultArchiveEngineAdapters
): Promise<ArchiveQualitySummary> {
  const evidenceRoot = path.join(archiveRoot, 'evidence');
  const summary: ArchiveQualitySummary = { files: [], metrics: {} };

  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await adapters.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!prefix && errorCode(error) === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(prefix ? path.join(prefix, entry.name) : entry.name);
      const stat = await adapters.fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Quality evidence may not contain symlinks: ${absolute}`);
      }
      if (stat.isDirectory()) {
        await walk(absolute, relative);
      } else if (stat.isFile() && isQualityFilename(entry.name)) {
        const archiveRelative = `evidence/${relative}`;
        const content = await adapters.fs.readFile(absolute, 'utf8');
        const metricCount = content
          .split(/\r?\n/)
          .filter(line => /\b(?:findings|issues|scenarios):/i.test(line.trim())).length;
        summary.files.push(archiveRelative);
        summary.metrics[archiveRelative] = metricCount;
      }
    }
  }

  await walk(evidenceRoot, '');
  // Compatibility: archives produced before canonical evidence placement kept
  // quality reports at the change root. Continue recording those exact
  // top-level paths while all new workflow guidance writes under evidence/.
  let legacyEntries: Dirent[];
  try {
    legacyEntries = await adapters.fs.readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    throw error;
  }
  legacyEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of legacyEntries) {
    if (!isQualityFilename(entry.name)) continue;
    const absolute = path.join(archiveRoot, entry.name);
    const stat = await adapters.fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Legacy quality input must be a regular file: ${absolute}`);
    }
    const content = await adapters.fs.readFile(absolute, 'utf8');
    summary.files.push(entry.name);
    summary.metrics[entry.name] = content
      .split(/\r?\n/)
      .filter(line => /\b(?:findings|issues|scenarios):/i.test(line.trim())).length;
  }
  summary.files.sort();
  summary.metrics = Object.fromEntries(
    Object.entries(summary.metrics).sort(([left], [right]) => left.localeCompare(right))
  );
  if (summary.files.length === 0) return summary;

  const metadataPath = path.join(archiveRoot, '.openspec.yaml');
  let metadata: Record<string, unknown> = {};
  try {
    metadata = parseArchiveOpenSpecMetadata(
      await adapters.fs.readFile(metadataPath, 'utf8')
    );
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  metadata.quality = summary;
  await adapters.fs.writeFile(metadataPath, stringifyYaml(metadata));
  return summary;
}

function sameArchiveObject(
  stat: ArchiveFsStat,
  planned: ArchiveStatIdentity,
  kind: ArchiveAuthorityEntry['kind']
): boolean {
  const actual = archiveDeletionIdentity(stat, kind);
  return (
    actual.dev === planned.dev &&
    actual.ino === planned.ino &&
    actual.mode === planned.mode &&
    actual.size === planned.size
  );
}

async function writeFlushedExclusiveFile(
  target: string,
  bytes: string | Uint8Array,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const handle = await adapters.fs.open(target, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

interface ArchivePrivateClaim {
  root: string;
  claimed: string;
  sentinel: string;
  nonce: string;
  rootIdentity: ArchiveStatIdentity;
  sentinelIdentity: ArchiveStatIdentity;
}

async function requireArchivePrivateClaim(
  claim: ArchivePrivateClaim,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  const root = await adapters.fs.lstat(claim.root);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    !sameArchiveObject(root, claim.rootIdentity, 'directory')
  ) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Private archive claim root identity changed.',
      [claim.claimed, claim.sentinel]
    );
  }
  const sentinel = await readStableArchiveFile(claim.sentinel, adapters);
  if (
    !sameArchiveObject(sentinel.stat, claim.sentinelIdentity, 'file') ||
    sentinel.content.toString('utf8') !== claim.nonce
  ) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Private archive claim sentinel identity changed.',
      [claim.claimed, claim.sentinel]
    );
  }
}

async function createArchivePrivateClaim(
  source: string,
  transactionId: string,
  operation: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchivePrivateClaim> {
  const parent = path.dirname(source);
  const label = adapters.sha256(operation).slice(0, 16);
  const root = path.join(
    parent,
    `.rasen-archive-claim-${transactionId}-${label}`
  );
  if ((await pathExists(root, adapters)) === 'present') {
    throw archiveClaimOwnershipError(
      root,
      'A prior private archive claim requires manual recovery.',
      [source]
    );
  }
  const parentBinding = await bindArchiveRealDirectoryChain(
    parent,
    parent,
    adapters
  );
  try {
    await adapters.fs.mkdir(root, { mode: 0o700 });
  } catch (error) {
    throw archiveClaimOwnershipError(
      root,
      `Private archive claim creation failed: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      [source]
    );
  }
  await requireArchiveRealDirectoryChain(parentBinding, adapters);
  const rootStat = await adapters.fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw archiveClaimOwnershipError(
      root,
      'Created private archive claim is not a real directory.',
      [source]
    );
  }
  const nonce = `${transactionId}:${randomUUID()}\n`;
  const sentinel = path.join(root, '.rasen-claim-owner');
  await writeFlushedExclusiveFile(sentinel, nonce, adapters);
  const sentinelFile = await readStableArchiveFile(sentinel, adapters);
  const claim: ArchivePrivateClaim = {
    root,
    claimed: path.join(root, 'object'),
    sentinel,
    nonce,
    rootIdentity: archiveDeletionIdentity(rootStat, 'directory'),
    sentinelIdentity: archiveDeletionIdentity(sentinelFile.stat, 'file'),
  };
  await requireArchivePrivateClaim(claim, adapters);
  await flushArchiveDirectory(parent, adapters);
  return claim;
}

async function moveArchiveObjectToPrivateClaim(
  source: string,
  expectedIdentity: ArchiveStatIdentity,
  kind: ArchiveAuthorityEntry['kind'],
  transactionId: string,
  operation: string,
  adapters: ArchiveEngineAdapters
): Promise<ArchivePrivateClaim> {
  const before = await adapters.fs.lstat(source);
  if (
    (kind !== 'symlink' && before.isSymbolicLink()) ||
    !sameArchiveObject(before, expectedIdentity, kind)
  ) {
    throw archiveClaimOwnershipError(
      source,
      'Archive object changed before private claim.',
      [source]
    );
  }
  const claim = await createArchivePrivateClaim(
    source,
    transactionId,
    operation,
    adapters
  );
  await requireArchivePrivateClaim(claim, adapters);
  if ((await pathExists(claim.claimed, adapters)) === 'present') {
    throw archiveClaimOwnershipError(
      claim.root,
      'Private archive claim destination is unexpectedly occupied.',
      [source, claim.claimed]
    );
  }
  await adapters.fs.rename(source, claim.claimed);
  await requireArchivePrivateClaim(claim, adapters);
  const moved = await adapters.fs.lstat(claim.claimed);
  if (
    (kind !== 'symlink' && moved.isSymbolicLink()) ||
    !sameArchiveObject(moved, expectedIdentity, kind)
  ) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Object moved into private archive claim has an unrecognized identity.',
      [source, claim.claimed]
    );
  }
  return claim;
}

async function retireArchivePrivateClaim(
  claim: ArchivePrivateClaim,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  await requireArchivePrivateClaim(claim, adapters);
  if ((await pathExists(claim.claimed, adapters)) === 'present') {
    throw archiveClaimOwnershipError(
      claim.root,
      'Private archive claim still contains its claimed object.',
      [claim.claimed]
    );
  }
  const sentinel = await adapters.fs.lstat(claim.sentinel);
  if (
    sentinel.isSymbolicLink() ||
    !sameArchiveObject(sentinel, claim.sentinelIdentity, 'file')
  ) {
    throw archiveClaimOwnershipError(
      claim.root,
      'Private archive claim sentinel changed before retirement.',
      [claim.sentinel]
    );
  }
  await adapters.fs.unlink(claim.sentinel);
  await adapters.fs.rmdir(claim.root);
  await flushArchiveDirectory(path.dirname(claim.root), adapters);
}

async function applySpecActions(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  journal: ArchiveJournal,
  flush: () => Promise<void>
): Promise<ArchiveApplyResult['totals']> {
  const stateRank: Record<ArchiveJournal['specProgress'][number]['state'], number> = {
    pending: 0,
    'intent-durable': 1,
    claimed: 2,
    published: 3,
    verified: 4,
    complete: 5,
    conflict: -1,
    failed: -1,
  };

  async function conflict(
    progress: ArchiveJournal['specProgress'][number],
    message: string,
    code: string
  ): Promise<never> {
    const error = new Error(message);
    (error as NodeJS.ErrnoException).code = code;
    progress.state = 'conflict';
    progress.error = message;
    await flush();
    throw error;
  }

  async function claimOwnershipConflict(
    progress: ArchiveJournal['specProgress'][number],
    claimRoot: string,
    message: string,
    retainedPaths: string[]
  ): Promise<never> {
    progress.state = 'conflict';
    progress.error = message;
    await flush();
    throw archiveClaimOwnershipError(claimRoot, message, retainedPaths);
  }

  async function stableFileHash(target: string): Promise<{
    sha256: string;
    stat: ArchiveFsStat;
  }> {
    const stable = await readStableArchiveFile(target, adapters);
    return {
      sha256: adapters.sha256(stable.content),
      stat: stable.stat,
    };
  }

  for (const action of plan.specActions) {
    const actionId = action.actionId!;
    const progress = journal.specProgress.find(
      candidate => candidate.actionId === actionId
    );
    if (!progress) {
      throw new Error(`Missing durable spec progress for ${action.target}.`);
    }
    if (progress.state === 'complete') continue;
    if ((await stableFileHash(action.source)).sha256 !== action.sourceSha256) {
      const drift = new Error(`Delta spec changed after planning: ${action.source}`);
      (drift as NodeJS.ErrnoException).code = 'ESTALE';
      throw drift;
    }
    const canonicalTargetRoot = archiveSpecCanonicalTargetRoot(action);
    await assertArchiveSpecActionFilesystemPaths(
      plan.roots.planning,
      plan.paths.active,
      plan.scope,
      [action],
      adapters
    );

    const targetDirectory = path.dirname(action.target);
    const claimRoot = path.join(
      targetDirectory,
      `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, action.action === 'delete' ? 'capability' : 'original');
    const temporary = path.join(claimRoot, 'result.tmp');
    progress.backupOrQuarantine =
      action.action === 'create' ? null : backup;
    progress.temporary = action.action === 'delete' ? null : temporary;
    if (progress.state === 'pending') {
      progress.state = 'intent-durable';
      await flush();
    }

    if (action.action === 'delete') {
      if (
        action.targetPrecondition.state !== 'file' ||
        !action.targetPrecondition.capabilityTree
      ) {
        throw new Error(`Delete spec is missing full-tree authority: ${action.target}`);
      }
      const capabilityDirectory = path.dirname(action.target);
      const claimParent = path.dirname(capabilityDirectory);
      const claimParentBinding = await bindArchiveRealDirectoryChain(
        canonicalTargetRoot,
        claimParent,
        adapters
      );
      const deleteClaimRoot = path.join(
        claimParent,
        `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
      );
      const quarantine = path.join(deleteClaimRoot, path.basename(capabilityDirectory));
      progress.backupOrQuarantine = quarantine;
      if (
        progress.state === 'claimed' &&
        (await pathExists(capabilityDirectory, adapters)) === 'absent' &&
        (await pathExists(quarantine, adapters)) === 'absent' &&
        (await pathExists(deleteClaimRoot, adapters)) === 'absent'
      ) {
        progress.state = 'complete';
        await flush();
        continue;
      }
      const deleteClaimIdentity = await createOrValidateClaimRoot(
        deleteClaimRoot,
        progress.claimIdentity,
        adapters,
        [quarantine, capabilityDirectory]
      );
      await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
      if (!progress.claimIdentity) {
        progress.claimIdentity = deleteClaimIdentity;
        await flush();
      }
      const durableDeleteClaimIdentity =
        progress.claimIdentity ?? deleteClaimIdentity;
      await requireClaimRootOccupants(
        deleteClaimRoot,
        [path.basename(quarantine)],
        adapters,
        [quarantine, capabilityDirectory]
      );
      if (
        progress.state === 'claimed' &&
        (await pathExists(quarantine, adapters)) === 'absent'
      ) {
        await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
        await removeVerifiedEmptyClaimRoot(
          deleteClaimRoot,
          durableDeleteClaimIdentity,
          adapters,
          [quarantine, capabilityDirectory]
        );
        progress.state = 'complete';
        await flush();
        continue;
      }
      if ((await pathExists(quarantine, adapters)) === 'absent') {
        const capabilityDirectoryBinding = await bindArchiveRealDirectoryChain(
          canonicalTargetRoot,
          capabilityDirectory,
          adapters
        );
        await requireArchiveRealDirectoryChain(
          capabilityDirectoryBinding,
          adapters
        );
        const current = await fingerprintArchiveTree(capabilityDirectory, adapters);
        if (
          !archiveDeletionAuthorityMatches(
            current,
            action.targetPrecondition.capabilityTree
          )
        ) {
          const drift = new Error(
            `Capability tree changed after planning: ${capabilityDirectory}`
          );
          (drift as NodeJS.ErrnoException).code = 'ESTALE';
          progress.state = 'conflict';
          progress.error = drift.message;
          await flush();
          throw drift;
        }
        await requireArchiveRealDirectoryChain(
          capabilityDirectoryBinding,
          adapters
        );
        await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
        await requireClaimRootIdentity(
          deleteClaimRoot,
          durableDeleteClaimIdentity,
          adapters
        );
        await adapters.fs.rename(capabilityDirectory, quarantine);
        await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
        await requireClaimRootIdentity(
          deleteClaimRoot,
          durableDeleteClaimIdentity,
          adapters
        );
      }
      if (progress.state !== 'claimed') {
        const claimed = await fingerprintArchiveTree(quarantine, adapters);
        if (
          !archiveDeletionAuthorityMatches(
            claimed,
            action.targetPrecondition.capabilityTree
          )
        ) {
          const message = `Claimed capability identity mismatch; retained at ${quarantine}`;
          progress.state = 'conflict';
          progress.error = message;
          await flush();
          throw archiveClaimOwnershipError(
            deleteClaimRoot,
            message,
            [quarantine, capabilityDirectory]
          );
        }
        progress.state = 'claimed';
        await flush();
      }
      await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
      await requireClaimRootIdentity(
        deleteClaimRoot,
        durableDeleteClaimIdentity,
        adapters
      );
      try {
        await removeClaimedArchiveTreeGuarded(
          quarantine,
          action.targetPrecondition.capabilityTree,
          adapters,
          progress.state === 'claimed'
        );
      } catch (error) {
        throw archiveClaimOwnershipError(
          deleteClaimRoot,
          `Claimed capability cannot be safely removed: ${
            error instanceof Error ? error.message : String(error)
          }.`,
          [quarantine, capabilityDirectory]
        );
      }
      await requireArchiveRealDirectoryChain(claimParentBinding, adapters);
      await removeVerifiedEmptyClaimRoot(
        deleteClaimRoot,
        durableDeleteClaimIdentity,
        adapters,
        [quarantine, capabilityDirectory]
      );
      progress.state = 'complete';
      await flush();
      continue;
    }

    await assertArchiveSpecActionFilesystemPaths(
      plan.roots.planning,
      plan.paths.active,
      plan.scope,
      [action],
      adapters
    );
    const targetParentBinding = await ensureArchiveRealDirectoryChain(
      path.dirname(canonicalTargetRoot),
      targetDirectory,
      adapters
    );
    await requireArchiveRealDirectoryChain(targetParentBinding, adapters);
    const rebuiltHash = adapters.sha256(action.rebuilt);
    if (
      progress.state === 'verified' &&
      progress.publishedIdentity &&
      (await pathExists(claimRoot, adapters)) === 'absent' &&
      (await pathExists(action.target, adapters)) === 'present'
    ) {
      const published = await stableFileHash(action.target);
      await requireArchiveRealDirectoryChain(targetParentBinding, adapters);
      if (
        published.sha256 === rebuiltHash &&
        sameArchiveObject(
          published.stat,
          progress.publishedIdentity,
          'file'
        )
      ) {
        progress.state = 'complete';
        await flush();
        continue;
      }
    }
    const claimIdentity = await createOrValidateClaimRoot(
      claimRoot,
      progress.claimIdentity,
      adapters,
      [backup, temporary, action.target]
    );
    await requireArchiveRealDirectoryChain(targetParentBinding, adapters);
    if (!progress.claimIdentity) {
      progress.claimIdentity = claimIdentity;
      await flush();
    }
    await requireClaimRootOccupants(
      claimRoot,
      [path.basename(backup), path.basename(temporary)],
      adapters,
      [backup, temporary, action.source, action.target]
    );
    const durableClaimIdentity = progress.claimIdentity ?? claimIdentity;

    async function requireSpecClaimRoot(): Promise<void> {
      await requireArchiveRealDirectoryChain(targetParentBinding, adapters);
      await requireClaimRootIdentity(
        claimRoot,
        durableClaimIdentity,
        adapters
      );
    }

    const verifiedBeforeAttempt = stateRank[progress.state] >= stateRank.verified;
    const durableProgress = progress;

    async function ensureTemporary(): Promise<void> {
      await requireSpecClaimRoot();
      const temporaryState = await pathExists(temporary, adapters);
      if (temporaryState === 'absent') {
        if (durableProgress.temporaryIdentity) {
          return;
        }
        await writeFlushedExclusiveFile(temporary, action.rebuilt, adapters);
      }
      const current = await stableFileHash(temporary);
      if (current.sha256 !== rebuiltHash) {
        await conflict(
          durableProgress,
          `Spec temporary payload changed: ${temporary}`,
          'ESTALE'
        );
      }
      const identity = archiveDeletionIdentity(current.stat, 'file');
      if (
        durableProgress.temporaryIdentity &&
        stableArchiveJson(durableProgress.temporaryIdentity) !==
          stableArchiveJson(identity)
      ) {
        await conflict(
          durableProgress,
          `Spec temporary identity changed: ${temporary}`,
          'ESTALE'
        );
      }
      if (!durableProgress.temporaryIdentity) {
        durableProgress.temporaryIdentity = identity;
        await flush();
      }
    }

    async function reconcilePublishedTarget(): Promise<boolean> {
      await requireSpecClaimRoot();
      if ((await pathExists(action.target, adapters)) === 'absent') return false;
      const current = await stableFileHash(action.target);
      await requireSpecClaimRoot();
      if (
        action.action === 'update' &&
        stateRank[durableProgress.state] < stateRank.claimed &&
        action.targetPrecondition.state === 'file' &&
        action.targetPrecondition.identity &&
        sameArchiveObject(current.stat, action.targetPrecondition.identity, 'file') &&
        current.sha256 === action.targetPrecondition.sha256
      ) {
        return false;
      }
      const currentIdentity = archiveDeletionIdentity(current.stat, 'file');
      const owned =
        (durableProgress.temporaryIdentity &&
          sameArchiveObject(
            current.stat,
            durableProgress.temporaryIdentity,
            'file'
          )) ||
        (durableProgress.publishedIdentity &&
          sameArchiveObject(
            current.stat,
            durableProgress.publishedIdentity,
            'file'
          ));
      if (current.sha256 !== rebuiltHash || !owned) {
        await conflict(
          durableProgress,
          `Spec target exists without this transaction's publication identity: ${action.target}`,
          current.sha256 === rebuiltHash ? 'EEXIST' : 'ESTALE'
        );
      }
      durableProgress.publishedIdentity = currentIdentity;
      if (stateRank[durableProgress.state] < stateRank.published) {
        durableProgress.state = 'published';
      }
      await flush();
      if ((await pathExists(temporary, adapters)) === 'present') {
        const temporaryStat = await adapters.fs.lstat(temporary);
        if (
          !durableProgress.temporaryIdentity ||
          !sameArchiveObject(
            temporaryStat,
            durableProgress.temporaryIdentity,
            'file'
          ) ||
          !sameArchiveObject(temporaryStat, currentIdentity, 'file')
        ) {
          await conflict(
            durableProgress,
            `Spec temporary is not the published hard-link object: ${temporary}`,
            'ESTALE'
          );
        }
        await requireSpecClaimRoot();
        const temporaryClaim = await moveArchiveObjectToPrivateClaim(
          temporary,
          durableProgress.temporaryIdentity,
          'file',
          plan.transactionId,
          `spec-temporary:${progress.actionId}`,
          adapters
        );
        await requireArchivePrivateClaim(temporaryClaim, adapters);
        await adapters.fs.unlink(temporaryClaim.claimed);
        await retireArchivePrivateClaim(temporaryClaim, adapters);
        await flushArchiveDirectory(claimRoot, adapters);
      }
      return true;
    }

    let publishedTarget = await reconcilePublishedTarget();
    if (!publishedTarget) {
      await ensureTemporary();
      if (!progress.temporaryIdentity) {
        throw new Error(`Spec temporary identity is not durable: ${temporary}`);
      }
      if (action.action === 'create') {
        await requireSpecClaimRoot();
        await publishArchiveFileNoReplace(
          temporary,
          action.target,
          adapters,
          requireSpecClaimRoot,
          plan.transactionId
        );
      } else {
        if (action.targetPrecondition.state !== 'file') {
          throw new Error(`Update spec is missing a file precondition: ${action.target}`);
        }
        let backupState = await pathExists(backup, adapters);
        if (backupState === 'absent') {
          await requireSpecClaimRoot();
          const current = await stableFileHash(action.target);
          if (
            !action.targetPrecondition.identity ||
            !sameArchiveObject(
              current.stat,
              action.targetPrecondition.identity,
              'file'
            ) ||
            current.sha256 !== action.targetPrecondition.sha256
          ) {
            await conflict(
              progress,
              `Target spec changed after planning: ${action.target}`,
              'ESTALE'
            );
          }
          await requireSpecClaimRoot();
          try {
            await adapters.fs.rename(action.target, backup);
          } catch (error) {
            if (errorCode(error) === 'EEXIST') {
              await claimOwnershipConflict(
                progress,
                claimRoot,
                `Spec backup appeared at the no-replace claim boundary: ${backup}`,
                [action.target, backup]
              );
            }
            throw error;
          }
          backupState = 'present';
        }
        if (backupState !== 'present') {
          throw new Error(`Spec backup claim did not produce a payload: ${backup}`);
        }
        let claimed = await stableFileHash(backup);
        if (
          !action.targetPrecondition.identity ||
          !sameArchiveObject(
            claimed.stat,
            action.targetPrecondition.identity,
            'file'
          ) ||
          claimed.sha256 !== action.targetPrecondition.sha256
        ) {
          await claimOwnershipConflict(
            progress,
            claimRoot,
            `Claimed spec target identity mismatch; retained at ${backup}`,
            [action.target, backup]
          );
        }
        await requireSpecClaimRoot();
        if ((await pathExists(action.target, adapters)) === 'present') {
          const targetBeforeUnlink = await stableFileHash(action.target);
          if (
            !action.targetPrecondition.identity ||
            !sameArchiveObject(
              targetBeforeUnlink.stat,
              action.targetPrecondition.identity,
              'file'
            ) ||
            targetBeforeUnlink.sha256 !== action.targetPrecondition.sha256 ||
            !identityMatches(targetBeforeUnlink.stat, claimed.stat)
          ) {
            await claimOwnershipConflict(
              progress,
              claimRoot,
              `Spec target and backup are not the transaction's same claimed object: ${action.target}`,
              [action.target, backup]
            );
          }
          await requireSpecClaimRoot();
          const targetClaim = await moveArchiveObjectToPrivateClaim(
            action.target,
            archiveDeletionIdentity(targetBeforeUnlink.stat, 'file'),
            'file',
            plan.transactionId,
            `spec-original:${progress.actionId}`,
            adapters
          );
          await requireArchivePrivateClaim(targetClaim, adapters);
          await adapters.fs.unlink(targetClaim.claimed);
          await retireArchivePrivateClaim(targetClaim, adapters);
          claimed = await stableFileHash(backup);
          if (
            !action.targetPrecondition.identity ||
            !sameArchiveObject(
              claimed.stat,
              action.targetPrecondition.identity,
              'file'
            ) ||
            claimed.sha256 !== action.targetPrecondition.sha256
          ) {
            await claimOwnershipConflict(
              progress,
              claimRoot,
              `Spec backup changed after target claim: ${backup}`,
              [backup]
            );
          }
        }
        if (stateRank[progress.state] < stateRank.claimed) {
          progress.state = 'claimed';
          await flush();
        }
        await requireSpecClaimRoot();
        await publishArchiveFileNoReplace(
          temporary,
          action.target,
          adapters,
          requireSpecClaimRoot,
          plan.transactionId
        );
      }
      await requireSpecClaimRoot();
      const target = await stableFileHash(action.target);
      if (
        target.sha256 !== rebuiltHash ||
        !sameArchiveObject(target.stat, progress.temporaryIdentity, 'file')
      ) {
        await conflict(
          progress,
          `Published spec verification failed: ${action.target}`,
          'ESTALE'
        );
      }

      progress.publishedIdentity = archiveDeletionIdentity(target.stat, 'file');
      progress.state = 'published';
      await flush();
      publishedTarget = true;
    }

    if (!publishedTarget) {
      throw new Error(`Spec publication did not produce a target: ${action.target}`);
    }
    await requireSpecClaimRoot();
    const result = await stableFileHash(action.target);
    if (
      result.sha256 !== rebuiltHash ||
      !progress.publishedIdentity ||
      !sameArchiveObject(result.stat, progress.publishedIdentity, 'file')
    ) {
      await conflict(
        progress,
        `Published spec verification failed: ${action.target}`,
        'ESTALE'
      );
    }
    progress.state = 'verified';
    await flush();

    if (action.action === 'update') {
      const backupState = await pathExists(backup, adapters);
      if (backupState === 'present') {
        const backupFile = await stableFileHash(backup);
        if (
          action.targetPrecondition.state !== 'file' ||
          !action.targetPrecondition.identity ||
          !sameArchiveObject(backupFile.stat, action.targetPrecondition.identity, 'file') ||
          backupFile.sha256 !== action.targetPrecondition.sha256
        ) {
          await conflict(
            progress,
            `Spec backup identity changed before removal: ${backup}`,
            'ESTALE'
          );
        }
        await requireSpecClaimRoot();
        const backupClaim = await moveArchiveObjectToPrivateClaim(
          backup,
          archiveDeletionIdentity(backupFile.stat, 'file'),
          'file',
          plan.transactionId,
          `spec-backup:${progress.actionId}`,
          adapters
        );
        await requireArchivePrivateClaim(backupClaim, adapters);
        await adapters.fs.unlink(backupClaim.claimed);
        await retireArchivePrivateClaim(backupClaim, adapters);
        await flushArchiveDirectory(claimRoot, adapters);
      } else if (!verifiedBeforeAttempt) {
        await conflict(
          progress,
          `Spec backup disappeared before verified cleanup intent: ${backup}`,
          'ESTALE'
        );
      }
    }
    await requireSpecClaimRoot();
    await removeVerifiedEmptyClaimRoot(
      claimRoot,
      durableClaimIdentity,
      adapters,
      [backup, temporary, action.source, action.target]
    );
    progress.state = 'complete';
    await flush();
  }
  return totalsFromSpecProgress(plan, journal);
}

async function claimAndDeleteCleanerCandidate(
  plan: ArchivePlan,
  relativePath: string,
  adapters: ArchiveEngineAdapters
): Promise<string[]> {
  const candidate = plan.cleaner.classification.candidates.find(
    entry => entry.relativePath === relativePath
  );
  if (!candidate) {
    throw archiveCleanerOwnershipError(
      path.join(plan.paths.ephemera, relativePath),
      plan,
      `Archive plan is missing cleaner fingerprint for ${relativePath}.`
    );
  }
  const source = path.join(plan.paths.ephemera, relativePath);
  const stable = await readStableArchiveFile(source, adapters);
  const stat = stable.stat;
  if (
    statScalar(stat.dev) !== String(candidate.dev) ||
    statScalar(stat.ino) !== String(candidate.ino) ||
    statScalar(stat.mode) !== String(candidate.mode) ||
    statScalar(stat.size) !== String(candidate.size) ||
    adapters.sha256(stable.content) !== candidate.sha256
  ) {
    throw archiveCleanerOwnershipError(
      source,
      plan,
      `Cleaner candidate differs from its planned fingerprint: ${relativePath}.`
    );
  }
  const claim = await moveArchiveObjectToPrivateClaim(
    source,
    archiveDeletionIdentity(stat, 'file'),
    'file',
    plan.transactionId,
    `cleaner:${relativePath}`,
    adapters
  );
  const claimedCandidate: EphemeraCandidateFingerprint = {
    ...candidate,
    relativePath: 'object',
  };
  const classification: EphemeraClassification = {
    discarded: ['object'],
    preserved: [],
    aborted: false,
    candidates: [claimedCandidate],
    preservedEntries: [],
    sourceSignals: [],
    blockers: [],
    complete: true,
  };
  const deleted = await adapters.applyEphemeraDeletion(
    claim.root,
    classification
  );
  if (
    !deleted.includes('object') ||
    (await pathExists(claim.claimed, adapters)) === 'present'
  ) {
    throw archiveCleanerOwnershipError(
      claim.claimed,
      plan,
      'Cleaner did not remove the identity-bound private claim.'
    );
  }
  await retireArchivePrivateClaim(claim, adapters);
  return [relativePath];
}

function handoffAccounting(plan: ArchivePlan): HandoffAbsorbedEntry[] | null {
  if (plan.sidecar.disposition === 'unjudged-preserve-all') return null;
  return plan.sidecar.handoff.decisions.map(decision => ({
    file: decision.path,
    outcome: decision.outcome,
  }));
}

async function revalidateArchiveGitPlan(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters,
  recoveryOwned = false
): Promise<void> {
  const actual = await resolveArchiveGitPlan(
    plan.roots.planning,
    plan.roots.execution,
    adapters
  );
  if (recoveryOwned && actual.git.planning.state === 'git') {
    const excluded = [
      plan.paths.active,
      plan.paths.stage,
      plan.paths.final,
      plan.paths.ephemera,
      path.join(
        path.dirname(plan.paths.active),
        `.rasen-archive-source-${plan.transactionId}`
      ),
      ...plan.specActions.map(action => action.target),
      ...plan.specActions.map(action => {
        const actionId = action.actionId ?? adapters.sha256(stableArchiveJson(action));
        const parent =
          action.action === 'delete'
            ? path.dirname(path.dirname(action.target))
            : path.dirname(action.target);
        return path.join(
          parent,
          `.rasen-archive-spec-${plan.transactionId}-${actionId.slice(0, 12)}`
        );
      }),
    ]
      .filter(candidate => isArchiveContainedPath(plan.roots.planning, candidate))
      .map(candidate =>
        normalizeRelative(path.relative(plan.roots.planning, candidate))
      )
      .filter(relative => relative.length > 0);
    const status = await adapters.git.exec(plan.roots.planning, [
      'status',
      '--porcelain',
      '--',
      '.',
      ...excluded.flatMap(relative => [
        `:(exclude)${relative}`,
        `:(exclude)${relative}/**`,
      ]),
    ]);
    actual.git.planning.treeState = status.length > 0 ? 'dirty' : 'clean';
  }
  if (
    actual.blockers.length > 0 ||
    stableArchiveJson(actual.git.execution) !== stableArchiveJson(plan.git.execution) ||
    actual.git.planning.state !== plan.git.planning.state ||
    actual.git.planning.branch !== plan.git.planning.branch ||
    actual.git.planning.treeState !== plan.git.planning.treeState
  ) {
    const drift = new Error('Git facts changed or became ambiguous after archive planning.');
    (drift as NodeJS.ErrnoException).code = 'ESTALE';
    throw drift;
  }
}

async function revalidateArchiveProbes(
  plan: ArchivePlan,
  adapters: ArchiveEngineAdapters
): Promise<void> {
  let executionReal: string | undefined;
  if (plan.sidecar.probes.length > 0) {
    executionReal = await adapters.fs.realpath(plan.roots.execution);
  }
  for (const probe of plan.sidecar.probes) {
    const absolute = path.resolve(
      plan.roots.execution,
      ...probe.path.split('/')
    );
    if (!isArchiveContainedPath(plan.roots.execution, absolute)) {
      throw new Error(`Probe escaped execution root after planning: ${probe.path}`);
    }
    const stat = await adapters.fs.lstat(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Probe is no longer a real directory: ${probe.path}`);
    }
    const actualReal = await adapters.fs.realpath(absolute);
    if (!executionReal || !isArchiveContainedPath(executionReal, actualReal)) {
      throw new Error(`Probe resolves outside execution root: ${probe.path}`);
    }
    await adapters.git.exec(plan.roots.execution, [
      'cat-file',
      '-e',
      `${probe.codeCommit}^{commit}`,
    ]);
  }
}

function isMergeConfirmationBlocker(
  plan: ArchivePlan,
  blocker: ArchiveBlocker
): boolean {
  if (
    plan.decisions.timing.mode !== 'on-merge' ||
    plan.decisions.timing.deliveryMode !== 'pr' ||
    plan.decisions.timing.override
  ) {
    return false;
  }
  if (blocker.operation !== 'timing') return false;
  if (blocker.code === ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE) return true;
  return (
    blocker.code === undefined &&
    blocker.message === ARCHIVE_MERGE_CONFIRMATION_BLOCKER_MESSAGE
  );
}

export function inspectArchiveApplyPlan(
  plan: ArchivePlan,
  assertions: ArchiveApplyAssertions = {}
): ArchiveApplyInspection {
  const blockers =
    assertions.mergeConfirmed === true
      ? plan.blockers.filter(
          blocker => !isMergeConfirmationBlocker(plan, blocker)
        )
      : [...plan.blockers];
  const assertionSatisfied = blockers.length < plan.blockers.length;
  return {
    applicable:
      blockers.length === 0 && (plan.complete || assertionSatisfied),
    blockers,
  };
}

/**
 * Apply the exact immutable plan. The active source is copied and verified,
 * all archive-local transformations happen in the stage, publication is one
 * exclusive same-parent rename, and source removal is the final destructive
 * operation.
 */
export async function applyArchive(
  plan: ArchivePlan,
  options: ArchiveApplyOptions = {}
): Promise<ArchiveApplyResult> {
  const adapters = options.adapters ?? defaultArchiveEngineAdapters;
  if (!planIdentityValid(plan, adapters)) {
    return {
      status: 'blocked',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.journal,
      resumed: false,
      specsUpdated: false,
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      ephemeraDiscarded: [],
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [
        {
          operation: 'validation',
          path: plan.paths.active,
          message: 'Archive plan hash or schema version is invalid.',
        },
      ],
    };
  }
  try {
    assertStoredArchivePlanPaths(plan);
    await assertArchiveSpecActionFilesystemPaths(
      plan.roots.planning,
      plan.paths.active,
      plan.scope,
      plan.specActions,
      adapters
    );
  } catch (error) {
    return {
      status: 'blocked',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.journal,
      resumed: false,
      specsUpdated: false,
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      ephemeraDiscarded: [],
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [
        {
          operation: 'validation',
          path: plan.paths.final,
          code: 'archive_plan_path_unauthorized',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const inspection = inspectArchiveApplyPlan(plan, options.assertions);
  if (!inspection.applicable) {
    return {
      status: 'blocked',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: plan.paths.journal,
      resumed: false,
      specsUpdated: false,
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      ephemeraDiscarded: [],
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: inspection.blockers,
    };
  }

  let resumed = false;
  let published = false;
  let finalReserved = false;
  let journalPath = plan.paths.journal;
  let ephemeraDisposed: string[] = [];
  let totals = { added: 0, modified: 0, removed: 0, renamed: 0 };
  let currentPhase: Exclude<ArchiveJournalPhase, 'failed'> = 'planned';
  let ownsRecoveryState = false;
  let currentOperation: ArchiveBlockerOperation = 'source-inventory';
  let currentOperationPath = plan.paths.active;
  let journalSnapshot: ArchiveJournal | null = null;
  let archivePathAuthority =
    (
      plan as ArchivePlan & {
        archivePathAuthority?: ArchiveAuthorityEntry[];
      }
    ).archivePathAuthority ?? [];

  async function persistJournalPhase(
    target: string,
    phase: ArchiveJournalPhase,
    failure?: ArchiveJournal['failure']
  ): Promise<void> {
    const previous = journalSnapshot;
    journalSnapshot = journalFor(
      plan,
      phase,
      ephemeraDisposed,
      adapters,
      failure,
      previous
    );
    await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned: ownsRecoveryState, allowUnbound: ownsRecoveryState }
    );
    await writeJournal(target, journalSnapshot, previous, adapters);
  }

  async function recordVerifiedFingerprint(
    name: string,
    scope: 'stage' | 'final',
    before: ArchiveTreeFingerprint,
    observedAfter: ArchiveTreeFingerprint
  ): Promise<void> {
    if (!journalSnapshot) {
      journalSnapshot = journalFor(
        plan,
        currentPhase,
        ephemeraDisposed,
        adapters
      );
    }
    journalSnapshot.phaseFingerprints[name] = {
      state: 'verified',
      scope,
      before,
      expectedAfter: observedAfter,
      observedAfter,
    };
  }

  async function recordIntentFingerprint(
    name: string,
    scope: 'stage' | 'final',
    before: ArchiveTreeFingerprint,
    expectedAfter: ArchiveTreeFingerprint,
    targetJournal: string
  ): Promise<void> {
    if (!journalSnapshot) {
      journalSnapshot = journalFor(
        plan,
        currentPhase,
        ephemeraDisposed,
        adapters
      );
    }
    journalSnapshot.phaseFingerprints[name] = {
      state: 'intent',
      scope,
      before,
      expectedAfter,
    };
    await persistJournalPhase(targetJournal, currentPhase);
  }

  async function createBoundProjection(
    projection: string
  ): Promise<ArchiveTreeFingerprint> {
    archivePathAuthority = await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned: true, allowUnbound: true }
    );
    try {
      await adapters.fs.mkdir(projection);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw archiveTransactionTempOwnershipError(
          projection,
          plan.paths.archiveParent,
          'The deterministic archive scratch path is already occupied.'
        );
      }
      throw error;
    }
    archivePathAuthority = await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned: true, allowUnbound: true }
    );
    await assertArchiveChildDirectory(
      plan.paths.archiveParent,
      projection,
      adapters
    );
    return fingerprintArchiveTree(projection, adapters);
  }

  async function removeBoundProjection(
    projection: string,
    authority: ArchiveTreeFingerprint
  ): Promise<void> {
    archivePathAuthority = await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned: true, allowUnbound: true }
    );
    await removeClaimedArchiveTreeGuarded(projection, authority, adapters);
    archivePathAuthority = await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned: true, allowUnbound: true }
    );
  }

  async function projectStageTransform(
    mutator: (
      projectionPlan: ArchivePlan,
      projectionAuthority: ArchiveTreeFingerprint
    ) => Promise<void>
  ): Promise<ArchiveTreeFingerprint> {
    const projection = path.join(
      plan.paths.archiveParent,
      `.rasen-archive-projection-${plan.transactionId}`
    );
    let projectionAuthority = await createBoundProjection(projection);
    try {
      await copyArchivePayload(plan.paths.stage, projection, adapters);
      projectionAuthority = await fingerprintArchiveTree(projection, adapters);
      await mutator(
        {
          ...plan,
          paths: { ...plan.paths, stage: projection },
        },
        projectionAuthority
      );
      projectionAuthority = await fingerprintArchiveTree(projection, adapters);
      return projectionAuthority;
    } finally {
      await removeBoundProjection(projection, projectionAuthority);
    }
  }

  async function projectAccountingContentTransform(
    content: string
  ): Promise<ArchiveTreeFingerprint> {
    const projection = path.join(
      plan.paths.archiveParent,
      `.rasen-archive-accounting-${plan.transactionId}`
    );
    let projectionAuthority = await createBoundProjection(projection);
    try {
      await copyArchivePayload(plan.paths.final, projection, adapters);
      projectionAuthority = await fingerprintArchiveTree(projection, adapters);
      try {
        await adapters.fs.writeFile(
          path.join(projection, 'archive.json'),
          content,
          { flag: 'wx' }
        );
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        throw archiveDeterministicInputError(
          ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE,
          'Active archive payload may not contain archive.json because that path is reserved for engine-owned accounting.'
        );
      }

      projectionAuthority = await fingerprintArchiveTree(projection, adapters);
      return projectionAuthority;
    } finally {
      await removeBoundProjection(projection, projectionAuthority);
    }
  }

  async function projectAccountingTransform(
    accounting: ArchiveAccounting
  ): Promise<ArchiveTreeFingerprint> {
    return projectAccountingContentTransform(serializeArchiveAccounting(accounting));
  }
  async function preparePlannedAccounting() {
    if (plan.finalization !== undefined) {
      const prepared = await adapters.resolveArchiveV2Accounting({
        archivedDir: plan.paths.final,
        draft: plan.finalization.record,
        identity: plan.finalization.identity,
      });
      return {
        kind: 'v2' as const,
        content: prepared.content,
        write: (temporaryIdentity?: ArchiveStatIdentity) =>
          adapters.writeArchiveV2Json(
            plan.paths.final,
            prepared,
            temporaryIdentity
          ),
        verify: () =>
          adapters.verifyArchiveV2Accounting(plan.paths.final, prepared),
      };
    }
    const accounting = await adapters.resolveArchiveAccounting({
      changeName: plan.change,
      archivedDir: plan.paths.final,
      executionRoot: plan.roots.execution,
      planningRoot: plan.roots.planning,
      ephemeraDiscarded: ephemeraDisposed,
      handoffAbsorbed: handoffAccounting(plan),
      probes: plan.sidecar.probes,
      archivedAt: plan.createdAt,
      gitFacts: {
        codeCommit: plan.git.execution.codeCommit,
        planningBranch: plan.git.planning.branch,
        planningTreeState: plan.git.planning.treeState,
      },
    });
    return {
      kind: 'v1' as const,
      content: serializeArchiveAccounting(accounting),
      write: (temporaryIdentity?: ArchiveStatIdentity) =>
        adapters.writeArchiveJson(
          plan.paths.final,
          accounting,
          temporaryIdentity
        ),
      verify: () => adapters.verifyArchiveAccounting(plan.paths.final, accounting),
    };
  }

  async function reconcileAccountingIntent(): Promise<void> {
    if (!journalSnapshot) return;
    const intent = journalSnapshot.phaseFingerprints['accounting-finalized'];
    if (intent?.state !== 'intent') return;
    const prepared = await preparePlannedAccounting();
    const expectedTemporary = archiveAccountingTemporaryPath(
      plan.paths.final,
      prepared.content
    );
    if (
      intent.temporary !== undefined &&
      !pathIdentityEquals(intent.temporary.path, expectedTemporary)
    ) {
      throw invalidCompletedProgress(
        intent.temporary.path,
        'the accounting intent names a disagreeing deterministic temporary'
      );
    }
    const temporaryState = await pathExists(expectedTemporary, adapters);
    if (temporaryState === 'present') {
      if (intent.temporary === undefined) {
        throw invalidCompletedProgress(
          expectedTemporary,
          'an unclaimed accounting temporary is retained'
        );
      }
      const temporary = await readStableArchiveFile(expectedTemporary, adapters);
      if (
        temporary.content.toString('utf8') !== prepared.content ||
        stableArchiveJson(archiveDeletionIdentity(temporary.stat, 'file')) !==
          stableArchiveJson(intent.temporary.identity)
      ) {
        throw invalidCompletedProgress(
          expectedTemporary,
          'the claimed accounting temporary identity or bytes disagree'
        );
      }
      await prepared.write(intent.temporary.identity);
    }
    const current = await fingerprintArchiveTree(plan.paths.final, adapters);
    if (archivePayloadFingerprintMatches(current, intent.expectedAfter)) {
      await prepared.verify();
      delete intent.temporary;
      intent.state = 'verified';
      intent.observedAfter = current;
      currentPhase = 'accounting-finalized';
      await persistJournalPhase(
        plan.paths.publishedJournal,
        'accounting-finalized'
      );
      return;
    }
    if (archivePayloadFingerprintMatches(current, intent.before)) return;
    throw invalidCompletedProgress(
      plan.paths.final,
      'the durable accounting output matches neither side of its intent'
    );
  }

  async function verifyRecordedPayloadForResume(): Promise<void> {
    if (!journalSnapshot) return;
    await reconcileAccountingIntent();
    const records = Object.entries(journalSnapshot.phaseFingerprints);
    const scopes: Array<'stage' | 'final'> = finalReserved
      ? published
        ? ['final']
        : ['stage', 'final']
      : ['stage'];
    for (const scope of scopes) {
      const matching = records.filter(([, value]) => value.scope === scope);
      const latest = matching.at(-1);
      if (!latest) continue;
      if (
        scope === 'final' &&
        latest[0] === 'final-reserved' &&
        latest[1].state === 'intent'
      ) {
        await assertOwnedArchiveReservation(plan, journalSnapshot, adapters);
        continue;
      }
      const expected = latest[1].observedAfter ?? latest[1].expectedAfter;
      const root = scope === 'final' ? plan.paths.final : plan.paths.stage;
      const current = await fingerprintArchiveTree(root, adapters);
      const matchesExpected = archivePayloadFingerprintMatches(current, expected);
      const matchesBefore =
        latest[1].state === 'intent' &&
        archivePayloadFingerprintMatches(current, latest[1].before);
      if (!matchesExpected && !matchesBefore) {
        if (scope === 'stage' && latest[1].state === 'intent') {
          throw archiveStageOwnershipError(
            plan.paths.stage,
            `Archive stage payload matches neither side of the durable ${latest[0]} transform intent.`,
            [plan.paths.journal]
          );
        }
        const conflict = new Error(
          `Archive ${scope} payload changed after verified phase ${latest[0]}.`
        );
        (conflict as NodeJS.ErrnoException).code = 'ESTALE';
        throw conflict;
      }
      if (latest[1].state === 'intent' && matchesExpected) {
        latest[1].state = 'verified';
        latest[1].observedAfter = current;
        const reconciledPhase: Partial<
          Record<string, Exclude<ArchiveJournalPhase, 'failed'>>
        > = {
          'payload-copied': 'staged',
          'handoff-finalized': 'handoff-finalized',
          'evidence-finalized': 'evidence-finalized',
          'accounting-finalized': 'accounting-finalized',
        };
        const promoted = reconciledPhase[latest[0]];
        if (
          promoted &&
          JOURNAL_PHASE_ORDER[promoted] > JOURNAL_PHASE_ORDER[currentPhase]
        ) {
          currentPhase = promoted;
        }
        await persistJournalPhase(
          finalReserved ? plan.paths.publishedJournal : plan.paths.journal,
          currentPhase
        );
      }
    }
  }

  async function verifySourceLastDurability(
    durable: ArchiveJournal
  ): Promise<void> {
    try {
      await assertOwnedArchiveReservation(plan, durable, adapters);
      await verifyCompletedSpecProgress(plan, durable, adapters);
      await verifyCompletedCleanerProgress(plan, durable, adapters);
      if (
        plan.finalization !== undefined &&
        durable.associationProgress?.state === 'complete'
      ) {
        await adapters.finalizeArchiveAssociation({
          plan,
          requireComplete: true,
          carriers: durable.associationProgress.carriers ?? [],
          carrierPrepared: async authority => {
            throw invalidCompletedProgress(
              authority.target,
              'completed association verification attempted a new carrier mutation'
            );
          },
        });
      }
      const accounting =
        durable.phaseFingerprints['accounting-finalized'];
      if (
        !accounting ||
        accounting.scope !== 'final' ||
        accounting.state !== 'verified' ||
        !accounting.observedAfter
      ) {
        throw new Error(
          'Archive lacks a durable accounting-finalized payload capability.'
        );
      }
      const finalPayload = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      if (
        !archiveDeletionAuthorityMatches(
          finalPayload,
          accounting.observedAfter
        )
      ) {
        throw new Error(
          'Published archive changed after accounting finalization.'
        );
      }
    } catch (error) {
      if (
        errorCode(error) === ARCHIVE_CLAIM_OWNERSHIP_CODE ||
        errorCode(error) === ARCHIVE_CLEANER_OWNERSHIP_CODE ||
        errorCode(error) === 'planning_execution_binding_mismatch'
      ) {
        throw error;
      }
      throw archiveClaimOwnershipError(
        plan.paths.final,
        `Source-last durability verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        [
          plan.paths.active,
          plan.paths.final,
          plan.paths.publishedJournal,
          ...plan.specActions.map(action => action.target),
        ]
      );
    }
  }

  async function verifyCompletedTransaction(
    completed: ArchiveJournal
  ): Promise<void> {
    await assertOwnedArchiveReservation(plan, completed, adapters);
    await verifyCompletedSpecProgress(plan, completed, adapters);
    await verifyCompletedCleanerProgress(plan, completed, adapters);
    await verifyRemovedSourceProgress(plan, completed, adapters);
    if (
      plan.finalization !== undefined &&
      completed.associationProgress?.state === 'complete'
    ) {
      await adapters.finalizeArchiveAssociation({
        plan,
        requireComplete: true,
        carriers: completed.associationProgress.carriers ?? [],
        carrierPrepared: async authority => {
          throw invalidCompletedProgress(
            authority.target,
            'completed association verification attempted a new carrier mutation'
          );
        },
      });
    }
    const marker = await readArchiveMarker(plan, adapters);
    if (!marker) {
      throw staleArchiveObject(
        path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME),
        'Completed archive is missing its publication marker'
      );
    }
    const accountingPhase =
      completed.phaseFingerprints['accounting-finalized'];
    if (
      !accountingPhase ||
      accountingPhase.scope !== 'final' ||
      accountingPhase.state !== 'verified' ||
      !accountingPhase.observedAfter
    ) {
      throw staleArchiveObject(
        plan.paths.publishedJournal,
        'Completed archive lacks a verified accounting payload capability'
      );
    }
    if (marker.payloadDigest !== accountingPhase.before.digest) {
      throw staleArchiveObject(
        path.join(plan.paths.final, ARCHIVE_PUBLISHED_MARKER_FILENAME),
        'Publication marker is not bound to the completed accounting phase'
      );
    }
    const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
    if (
      !archiveDeletionAuthorityMatches(
        finalPayload,
        accountingPhase.observedAfter
      )
    ) {
      throw staleArchiveObject(
        plan.paths.final,
        'Completed archive payload differs from its verified phase fingerprint'
      );
    }
    if (plan.finalization !== undefined) {
      const prepared = await adapters.resolveArchiveV2Accounting({
        archivedDir: plan.paths.final,
        draft: plan.finalization.record,
        identity: plan.finalization.identity,
      });
      await adapters.verifyArchiveV2Accounting(plan.paths.final, prepared);
      return;
    }

    const ledgerPath = path.join(plan.paths.final, 'archive.json');
    let accounting: ArchiveAccounting;
    try {
      const parsed = JSON.parse(
        (await readStableArchiveFile(ledgerPath, adapters)).content.toString('utf8')
      ) as ArchiveAccounting;
      if (
        !isPlainRecord(parsed) ||
        parsed.change !== plan.change ||
        parsed.archivedAt !== plan.createdAt ||
        parsed.codeCommit !== plan.git.execution.codeCommit ||
        parsed.planningBranch !== plan.git.planning.branch ||
        parsed.planningTreeState !== plan.git.planning.treeState ||
        stableArchiveJson(parsed.ephemeraDiscarded) !==
          stableArchiveJson([...completed.ephemeraDisposed].sort()) ||
        stableArchiveJson(parsed.probes) !==
          stableArchiveJson(plan.sidecar.probes) ||
        stableArchiveJson(parsed.handoffAbsorbed) !==
          stableArchiveJson(handoffAccounting(plan))
      ) {
        throw new Error('Completed archive accounting is not bound to its plan and journal.');
      }
      accounting = parsed;
    } catch (error) {
      if (errorCode(error)) throw error;
      const invalid = new Error(
        `Completed archive accounting verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      (invalid as NodeJS.ErrnoException).code = 'ESTALE';
      throw invalid;
    }
    await adapters.verifyArchiveAccounting(plan.paths.final, accounting);
  }

  function completedIntegrityFailureResult(
    integrityFailure: ArchiveIntegrityFailure,
    retainedJournalPath = plan.paths.publishedJournal
  ): ArchiveApplyResult {
    return {
      status: 'recoverable',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: retainedJournalPath,
      resumed: true,
      effectivePhase: currentPhase,
      specsUpdated: Object.values(totals).some(value => value > 0),
      totals,
      ephemeraDiscarded: [...ephemeraDisposed].sort(),
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [
        {
          operation: integrityFailure.operation,
          path: integrityFailure.path,
          ...(integrityFailure.code ? { code: integrityFailure.code } : {}),
          message: integrityFailure.message,
        },
      ],
      manualRecoveryAction: integrityFailure.safeAction,
    };
  }

  function bindPublishedRecoveryJournal(completed: ArchiveJournal): void {
    resumed = true;
    published = true;
    finalReserved = true;
    ownsRecoveryState = true;
    journalPath = plan.paths.publishedJournal;
    currentPhase =
      completed.phase === 'failed'
        ? completed.failure!.resumePhase
        : completed.phase;
    journalSnapshot = completed;
    ephemeraDisposed = [...completed.ephemeraDisposed];
    totals = totalsFromSpecProgress(plan, completed);
  }

  async function persistCompletedIntegrityFailure(
    completed: ArchiveJournal,
    integrityFailure: ArchiveIntegrityFailure
  ): Promise<ArchiveApplyResult> {
    const terminalJournal: ArchiveJournal = {
      ...completed,
      updatedAt: integrityFailure.detectedAt,
      integrityFailure,
    };
    journalSnapshot = terminalJournal;
    try {
      await writeJournal(
        plan.paths.publishedJournal,
        terminalJournal,
        completed,
        adapters
      );
      return completedIntegrityFailureResult(integrityFailure);
    } catch (persistenceError) {
      let authoritative: ArchiveJournal | null = null;
      let rereadError: unknown;
      try {
        authoritative = await readJournal(plan.paths.publishedJournal, adapters);
      } catch (error) {
        rereadError = error;
      }
      if (
        authoritative?.transactionId === plan.transactionId &&
        authoritative.planHash === plan.planHash
      ) {
        bindPublishedRecoveryJournal(authoritative);
        if (authoritative.integrityFailure) {
          return completedIntegrityFailureResult(
            authoritative.integrityFailure
          );
        }
      } else {
        bindPublishedRecoveryJournal(completed);
      }

      const persistenceCode = errorCode(persistenceError);
      const persistenceMessage =
        persistenceError instanceof Error
          ? persistenceError.message
          : String(persistenceError);
      const rereadDetail = rereadError
        ? ` The authoritative journal could not be reread: ${
            rereadError instanceof Error ? rereadError.message : String(rereadError)
          }.`
        : '';
      const persistenceFailure: ArchiveIntegrityFailure = {
        detectedAt: integrityFailure.detectedAt,
        operation: 'journal',
        path: plan.paths.publishedJournal,
        ...(persistenceCode ? { code: persistenceCode } : {}),
        message:
          `The completed archive failed integrity verification, but the engine could not persist its manual-recovery alert: ${persistenceMessage}.` +
          ` Original integrity failure: ${integrityFailure.message}.${rereadDetail}`,
        safeAction: {
          kind: 'manual-recovery-required',
          guidance:
            'Automatic archive resume is disabled because the completed archive failed integrity verification and its terminal alert could not be confirmed durable. ' +
            `Preserve the published archive and journal, inspect ${integrityFailure.path}, resolve the journal I/O failure at ${plan.paths.publishedJournal}, restore the archive from a trusted source, and obtain operator verification before any further archive action. ` +
            'A later invocation may retry recording the alert but cannot repair the archive automatically.',
        },
      };
      return completedIntegrityFailureResult(persistenceFailure);
    }
  }

  try {
    currentOperation = 'journal';
    currentOperationPath = plan.paths.archiveParent;
    await assertNoArchiveTransactionDebris(plan, adapters);
    const preflightStage = await pathExists(plan.paths.stage, adapters);
    const preflightFinal = await pathExists(plan.paths.final, adapters);
    let recoveryOwned = false;
    let recoveryFactsConsumed = false;
    if (preflightStage === 'present') {
      const existing = await readJournal(plan.paths.journal, adapters);
      recoveryOwned =
        existing?.transactionId === plan.transactionId &&
        existing.planHash === plan.planHash;
      if (recoveryOwned) {
        recoveryFactsConsumed =
          recoveryFactsConsumed || archiveJournalHasDurableMutation(existing);
      }
      if (recoveryOwned && existing?.integrityFailure) {
        resumed = true;
        ownsRecoveryState = true;
        journalPath = plan.paths.journal;
        journalSnapshot = existing;
        currentPhase =
          existing.phase === 'failed'
            ? existing.failure!.resumePhase
            : existing.phase;
        ephemeraDisposed = [...existing.ephemeraDisposed];
        totals = totalsFromSpecProgress(plan, existing);
        return completedIntegrityFailureResult(
          existing.integrityFailure,
          plan.paths.journal
        );
      }
    }
    if (preflightFinal === 'present') {
      const existing = await readJournal(plan.paths.publishedJournal, adapters);
      const publishedRecoveryOwned =
        existing?.transactionId === plan.transactionId &&
        existing.planHash === plan.planHash;
      recoveryOwned = recoveryOwned || publishedRecoveryOwned;
      if (publishedRecoveryOwned) {
        recoveryFactsConsumed =
          recoveryFactsConsumed || archiveJournalHasDurableMutation(existing);
      }
      if (publishedRecoveryOwned && existing?.integrityFailure) {
        bindPublishedRecoveryJournal(existing);
        return completedIntegrityFailureResult(existing.integrityFailure);
      }
    }
    if (!recoveryFactsConsumed) {
      currentOperation = 'git';
      currentOperationPath = plan.roots.execution;
      await revalidateArchiveGitPlan(plan, adapters, recoveryOwned);
      currentOperation = 'probe-git';
      await revalidateArchiveProbes(plan, adapters);
    }
    currentOperation = 'source-inventory';
    currentOperationPath = plan.paths.active;
    let sourceNow: ArchiveTreeFingerprint;
    let sourceClaimedAtStart = false;
    try {
      sourceNow = await fingerprintArchiveTree(plan.paths.active, adapters);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        const completed = await readJournal(plan.paths.publishedJournal, adapters);
        if (
          completed &&
          completed.transactionId === plan.transactionId &&
          completed.planHash === plan.planHash &&
          (completed.phase === 'complete' ||
            (completed.phase === 'failed' &&
              completed.failure!.resumePhase === 'source-removed'))
        ) {
          bindPublishedRecoveryJournal(completed);
          currentOperation = 'accounting';
          currentOperationPath = plan.paths.final;
          if (completed.integrityFailure) {
            return completedIntegrityFailureResult(completed.integrityFailure);
          }
          try {
            await verifyCompletedTransaction(completed);
          } catch (error) {
            const accountingError =
              error instanceof ArchiveAccountingErrorLike ? error : undefined;
            const operation: ArchiveBlockerOperation = accountingError
              ? accountingError.operation.startsWith('evidence')
                ? 'evidence'
                : 'accounting'
              : currentOperation;
            const operationPath = accountingError?.path ?? currentOperationPath;
            const code = errorCode(error);
            const message = error instanceof Error ? error.message : String(error);
            const integrityFailure: ArchiveIntegrityFailure = {
              detectedAt: adapters.now().toISOString(),
              operation,
              path: operationPath,
              ...(code ? { code } : {}),
              message,
              safeAction: {
                kind: 'manual-recovery-required',
                guidance:
                  'Automatic archive resume is disabled because the completed archive failed integrity verification. ' +
                  `Preserve the published archive and journal, inspect ${operationPath}, restore the archive from a trusted source, and obtain operator verification before any further archive action.`,
              },
            };
            currentOperation = 'journal';
            currentOperationPath = journalPath;
            return persistCompletedIntegrityFailure(
              completed,
              integrityFailure
            );
          }
          if (completed.phase !== 'complete') {
            currentPhase = 'source-removed';
            currentOperation = 'stage';
            currentOperationPath = plan.paths.stage;
            await removeArchiveStageGuarded(
              plan,
              completed,
              'terminal',
              adapters
            );
            currentOperation = 'journal';
            currentOperationPath = journalPath;
            await persistJournalPhase(journalPath, 'complete');
          }
          return {
            status: 'complete',
            transactionId: plan.transactionId,
            planHash: plan.planHash,
            change: plan.change,
            path: plan.paths.final,
            journalPath: plan.paths.publishedJournal,
            resumed: true,
            effectivePhase: 'complete',
            specsUpdated: Object.values(totals).some(value => value > 0),
            totals,
            ephemeraDiscarded: [...completed.ephemeraDisposed].sort(),
            ephemeraPreserved: plan.cleaner.effectivePreserve,
            blockers: [],
          };
        }
        if (
          completed &&
          completed.transactionId === plan.transactionId &&
          completed.planHash === plan.planHash &&
          ['delete-intent', 'claimed', 'removing', 'removed'].includes(
            completed.sourceProgress.state
          )
        ) {
          sourceClaimedAtStart = true;
          sourceNow = plan.sourceFingerprint!;
          resumed = true;
          finalReserved = true;
          published = (await readArchiveMarker(plan, adapters)) !== null;
          ownsRecoveryState = true;
          journalPath = plan.paths.publishedJournal;
          journalSnapshot = completed;
          ephemeraDisposed = [...completed.ephemeraDisposed];
          currentPhase =
            completed.phase === 'failed'
              ? completed.failure!.resumePhase
              : completed.phase;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    if (
      !sourceClaimedAtStart &&
      (!plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(sourceNow, plan.sourceFingerprint))
    ) {
      const drift = new Error('Active archive source changed after planning.');
      (drift as NodeJS.ErrnoException).code = 'ESTALE';
      throw drift;
    }
    if (
      !sourceClaimedAtStart &&
      preflightStage === 'absent' &&
      preflightFinal === 'absent'
    ) {
      const [inputBlocker] = await deterministicArchiveInputBlockers(
        plan.paths.active,
        sourceNow,
        plan.sidecar,
        plan.qualityInputs,
        adapters
      );
      if (inputBlocker) {
        currentOperation = inputBlocker.operation;
        currentOperationPath = inputBlocker.path;
        throw archiveDeterministicInputError(
          inputBlocker.code!,
          inputBlocker.message
        );
      }
    }

    currentOperation = 'stage';
    currentOperationPath = plan.paths.stage;
    const stageState = await pathExists(plan.paths.stage, adapters);
    const finalState = await pathExists(plan.paths.final, adapters);
    currentOperation = 'publish';
    currentOperationPath = plan.paths.archiveParent;
    if (archivePathAuthority.length === 0) {
      if (plan.finalization !== undefined) {
        throw archiveDeterministicInputError(
          recoveryOwned
            ? ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE
            : ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
          'Store archive destination has no reviewed Foundation ancestry authority.'
        );
      }
      const derived = await inspectArchivePathAuthority(
        plan.roots.planning,
        plan.paths.archiveParent,
        adapters
      );
      if (derived.blockers[0]) {
        throw archiveDeterministicInputError(
          recoveryOwned
            ? ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE
            : ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
          derived.blockers[0].message
        );
      }
      archivePathAuthority = derived.authority;
    }
    archivePathAuthority = await assertArchivePathAuthority(
      plan,
      archivePathAuthority,
      adapters,
      { recoveryOwned, allowUnbound: recoveryOwned }
    );
    if (finalState === 'present') {
      currentOperation = 'publish';
      currentOperationPath = plan.paths.final;
      let existing = await readJournal(plan.paths.publishedJournal, adapters);
      if (!archiveJournalBelongsToPlan(existing, plan)) {
        const reservationIntent =
          stageState === 'present'
            ? await readJournal(plan.paths.journal, adapters)
            : null;
        if (
          !archiveJournalBelongsToPlan(reservationIntent, plan) ||
          reservationIntent.finalReservation.state !== 'intent-durable'
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            'Archive target has neither an owned published journal nor a matching durable reservation intent'
          );
        }
        const reservationStat = await adapters.fs.lstat(plan.paths.final);
        const occupants =
          reservationStat.isDirectory() && !reservationStat.isSymbolicLink()
            ? await listArchiveReservationOccupants(plan.paths.final, adapters)
            : ['(non-directory target)'];
        if (
          !reservationStat.isDirectory() ||
          reservationStat.isSymbolicLink() ||
          stableArchiveJson(occupants) !==
            stableArchiveJson([ARCHIVE_FINAL_OWNER_FILENAME])
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            `Archive target cannot be adopted from its reservation intent; occupants: ${occupants.join(', ')}`
          );
        }
        const adoptedOwner = await verifyArchiveFinalOwner(plan, adapters);
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        const adoptedIdentity = await assertArchiveChildDirectory(
          plan.paths.archiveParent,
          plan.paths.final,
          adapters
        );
        if (
          stableArchiveJson(adoptedIdentity) !==
          stableArchiveJson(archiveDeletionIdentity(reservationStat, 'directory'))
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            'Archive target identity changed during durable-intent adoption'
          );
        }
        reservationIntent.finalReservation = {
          state: 'owned',
          identity: adoptedIdentity,
          entries: [adoptedOwner],
        };
        existing = reservationIntent;
        journalSnapshot = existing;
        currentPhase =
          existing.phase === 'failed'
            ? existing.failure!.resumePhase
            : existing.phase;
        finalReserved = true;
        journalPath = plan.paths.publishedJournal;
        if (
          stableArchiveJson(
            await assertArchiveChildDirectory(
              plan.paths.archiveParent,
              plan.paths.final,
              adapters
            )
          ) !== stableArchiveJson(adoptedIdentity)
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            'Archive target identity changed before durable ownership publication'
          );
        }
        await persistJournalPhase(journalPath, currentPhase);
      }
      resumed = true;
      journalSnapshot = existing;
      finalReserved = true;
      const marker = await readArchiveMarker(plan, adapters);
      published = marker !== null;
      if (marker) {
        const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
        const accountingIntent =
          existing.phaseFingerprints['accounting-finalized'];
        const matchesAccountingIntent =
          accountingIntent?.state === 'intent' &&
          archivePayloadFingerprintMatches(
            finalPayload,
            accountingIntent.expectedAfter
          );
        if (finalPayload.digest !== marker.payloadDigest &&
            !matchesAccountingIntent &&
            !phaseAtLeast(
              existing.phase === 'failed'
                ? existing.failure!.resumePhase
                : existing.phase,
              'accounting-finalized'
            )) {
          const conflict = new Error(
            'Published archive payload no longer matches its commit marker.'
          );
          (conflict as NodeJS.ErrnoException).code = 'ESTALE';
          throw conflict;
        }
      }
      ownsRecoveryState = true;
      journalPath = plan.paths.publishedJournal;
      ephemeraDisposed = [...existing.ephemeraDisposed];
      currentPhase =
        existing.phase === 'failed'
          ? existing.failure!.resumePhase
          : existing.phase;
    } else if (stageState === 'present') {
      currentOperation = 'stage';
      currentOperationPath = plan.paths.stage;
      await requireArchiveStageOwner(plan, adapters);
      const existing = await readJournal(plan.paths.journal, adapters);
      if (
        !existing ||
        existing.transactionId !== plan.transactionId ||
        existing.planHash !== plan.planHash
      ) {
        throw archiveStageOwnershipError(
          plan.paths.stage,
          'Archive stage exists without a matching durable transaction journal.',
          [plan.paths.journal, plan.paths.final]
        );
      }
      resumed = true;
      journalSnapshot = existing;
      ownsRecoveryState = true;
      ephemeraDisposed = [...existing.ephemeraDisposed];
      currentPhase =
        existing.phase === 'failed'
          ? existing.failure!.resumePhase
          : existing.phase;
    } else {
      archivePathAuthority = await ensureArchiveParentDirectories(
        plan,
        archivePathAuthority,
        adapters
      );
      await createArchiveOwnedStage(plan, adapters);
      archivePathAuthority = await assertArchivePathAuthority(
        plan,
        archivePathAuthority,
        adapters,
        { recoveryOwned: true, allowUnbound: true }
      );
      await assertArchiveChildDirectory(
        plan.paths.archiveParent,
        plan.paths.stage,
        adapters
      );
      ownsRecoveryState = true;
      currentOperation = 'journal';
      currentOperationPath = plan.paths.journal;
      await assertArchivePathAuthority(
        plan,
        archivePathAuthority,
        adapters,
        { recoveryOwned: true, allowUnbound: true }
      );
      await persistJournalPhase(plan.paths.journal, 'planned');
      currentPhase = 'planned';
    }

    if (resumed && currentPhase !== 'planned') {
      currentOperation = finalReserved ? 'publish' : 'stage';
      currentOperationPath = finalReserved ? plan.paths.final : plan.paths.stage;
      await verifyRecordedPayloadForResume();
    }
    if (journalSnapshot) {
      totals = totalsFromSpecProgress(plan, journalSnapshot);
      ephemeraDisposed = journalSnapshot.cleanerProgress
        .filter(
          progress =>
            progress.state === 'deleted' ||
            progress.state === 'deleted-after-intent'
        )
        .map(progress => progress.path)
        .sort();
    }
    if (resumed && journalSnapshot) {
      currentOperation = 'spec';
      currentOperationPath = plan.paths.active;
      await verifyCompletedSpecProgress(plan, journalSnapshot, adapters);
      currentOperation = 'cleaner-apply';
      currentOperationPath = plan.paths.ephemera;
      await verifyCompletedCleanerProgress(plan, journalSnapshot, adapters);
      currentOperation = 'source-remove';
      currentOperationPath = plan.paths.active;
      await verifyRemovedSourceProgress(plan, journalSnapshot, adapters);
      if (
        plan.finalization !== undefined &&
        journalSnapshot.associationProgress?.state === 'complete'
      ) {
        currentOperation = 'association';
        currentOperationPath =
          plan.finalization.association.executionAssociationPath ??
          plan.paths.final;
        await adapters.finalizeArchiveAssociation({
          plan,
          requireComplete: true,
          carriers: journalSnapshot.associationProgress.carriers ?? [],
          carrierPrepared: async authority => {
            throw invalidCompletedProgress(
              authority.target,
              'completed association verification attempted a new carrier mutation'
            );
          },
        });
      }
    }

    if (!published && currentPhase === 'planned') {
      currentOperation = 'stage';
      currentOperationPath = plan.paths.stage;
      if (resumed) {
        // A planned retry may clear only payload slots named by the immutable
        // source inventory and the exact transaction control journal.
        if (!journalSnapshot) {
          throw new Error('Planned stage cleanup requires a durable journal.');
        }
        await removeArchiveStageGuarded(
          plan,
          journalSnapshot,
          'planned',
          adapters
        );
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        await createArchiveOwnedStage(plan, adapters);
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        await assertArchiveChildDirectory(
          plan.paths.archiveParent,
          plan.paths.stage,
          adapters
        );
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        journalSnapshot = null;
        await persistJournalPhase(plan.paths.journal, 'planned');
      }
      currentOperation = 'copy';
      currentOperationPath = plan.paths.stage;
      const beforeCopy = await fingerprintArchiveTree(plan.paths.stage, adapters);
      await recordIntentFingerprint(
        'payload-copied',
        'stage',
        beforeCopy,
        plan.sourceFingerprint!,
        plan.paths.journal
      );
      await copyArchivePayload(plan.paths.active, plan.paths.stage, adapters);
      const stagedFingerprint = await fingerprintArchiveTree(plan.paths.stage, adapters);
      if (
        !plan.sourceFingerprint ||
        !archivePayloadFingerprintMatches(stagedFingerprint, plan.sourceFingerprint)
      ) {
        const mismatch = new Error('Staged archive payload does not match the planned source.');
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      currentOperation = 'journal';
      currentOperationPath = plan.paths.journal;
      await recordVerifiedFingerprint(
        'payload-copied',
        'stage',
        plan.sourceFingerprint!,
        stagedFingerprint
      );
      await persistJournalPhase(plan.paths.journal, 'staged');
      currentPhase = 'staged';
    }

    if (!published) {
      if (!phaseAtLeast(currentPhase, 'handoff-finalized')) {
        const before = await fingerprintArchiveTree(plan.paths.stage, adapters);
        const recordedHandoffIntent =
          journalSnapshot?.phaseFingerprints['handoff-finalized'];
        const handoffAuthority =
          recordedHandoffIntent?.state === 'intent'
            ? recordedHandoffIntent.before
            : before;
        const expected =
          recordedHandoffIntent?.state === 'intent'
            ? recordedHandoffIntent.expectedAfter
            : await projectStageTransform(
                (projectionPlan, projectionAuthority) =>
                  applyStagedHandoff(
                    projectionPlan,
                    adapters,
                    projectionAuthority
                  )
              );
        await recordIntentFingerprint(
          'handoff-finalized',
          'stage',
          handoffAuthority,
          expected,
          plan.paths.journal
        );
        currentOperation = 'handoff';
        currentOperationPath = path.join(plan.paths.stage, 'handoff');
        await applyStagedHandoff(plan, adapters, handoffAuthority);
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        const after = await fingerprintArchiveTree(plan.paths.stage, adapters);
        if (!archivePayloadFingerprintMatches(after, expected)) {
          const mismatch = new Error(
            'Handoff transform did not match its durable expected payload.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        await recordVerifiedFingerprint(
          'handoff-finalized',
          'stage',
          handoffAuthority,
          after
        );
        await persistJournalPhase(plan.paths.journal, 'handoff-finalized');
        currentPhase = 'handoff-finalized';
      }
      if (!phaseAtLeast(currentPhase, 'evidence-finalized')) {
        const before = await fingerprintArchiveTree(plan.paths.stage, adapters);
        const expected = await projectStageTransform(async projectionPlan => {
          await finalizeStagedShipLog(projectionPlan, adapters);
          await captureArchiveQuality(projectionPlan.paths.stage, adapters);
        });
        await recordIntentFingerprint(
          'evidence-finalized',
          'stage',
          before,
          expected,
          plan.paths.journal
        );
        currentOperation = 'quality';
        currentOperationPath = path.join(plan.paths.stage, 'evidence');
        await finalizeStagedShipLog(plan, adapters);
        const quality = await captureArchiveQuality(plan.paths.stage, adapters);
        if (
          stableArchiveJson(quality.files) !==
          stableArchiveJson(plan.qualityInputs.map(input => input.path))
        ) {
          const mismatch = new Error(
            'Staged quality inventory differs from the immutable archive plan.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        for (const input of plan.qualityInputs) {
          const absolute = path.join(plan.paths.stage, ...input.path.split('/'));
          if (adapters.sha256(await adapters.fs.readFile(absolute)) !== input.sha256) {
            const mismatch = new Error(
              `Staged quality input differs from the immutable archive plan: ${input.path}`
            );
            (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
            throw mismatch;
          }
        }
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        const after = await fingerprintArchiveTree(plan.paths.stage, adapters);
        if (!archivePayloadFingerprintMatches(after, expected)) {
          const mismatch = new Error(
            'Evidence transform did not match its durable expected payload.'
          );
          (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
          throw mismatch;
        }
        await recordVerifiedFingerprint(
          'evidence-finalized',
          'stage',
          before,
          after
        );
        await persistJournalPhase(plan.paths.journal, 'evidence-finalized');
        currentPhase = 'evidence-finalized';
      }
      if (!phaseAtLeast(currentPhase, 'specs-applied')) {
        currentOperation = 'spec';
        currentOperationPath = plan.paths.active;
        if (!journalSnapshot) {
          throw new Error('Prepared spec actions require a durable journal.');
        }
        totals = await applySpecActions(
          plan,
          adapters,
          journalSnapshot,
          () => persistJournalPhase(plan.paths.journal, currentPhase)
        );
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        await persistJournalPhase(plan.paths.journal, 'specs-applied');
        currentPhase = 'specs-applied';
      } else {
        totals = totalsFromSpecProgress(plan, journalSnapshot);
      }
      currentOperation = 'publish';
      currentOperationPath = plan.paths.final;
      if (!finalReserved) {
        if (!journalSnapshot) {
          journalSnapshot = journalFor(
            plan,
            currentPhase,
            ephemeraDisposed,
            adapters
          );
        }
        journalSnapshot.finalReservation = {
          state: 'intent-durable',
          identity: null,
          entries: [],
        };
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        await assertArchiveChildDirectory(
          plan.paths.archiveParent,
          plan.paths.stage,
          adapters
        );
        currentOperation = 'journal';
        currentOperationPath = plan.paths.journal;
        await persistJournalPhase(plan.paths.journal, currentPhase);
        currentOperation = 'publish';
        currentOperationPath = plan.paths.final;
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        let finalOwner: ArchiveJournal['finalReservation']['entries'][number];
        try {
          await reserveArchiveDestination(plan.paths.final, adapters);
          finalOwner = await createArchiveFinalOwner(plan, adapters);
        } catch (error) {
          if ((await pathExists(plan.paths.final, adapters)) === 'present') {
            const failedReservationStat = await adapters.fs.lstat(plan.paths.final);
            const failedReservationOccupants =
              failedReservationStat.isDirectory() &&
              !failedReservationStat.isSymbolicLink()
                ? await listArchiveReservationOccupants(plan.paths.final, adapters)
                : ['(non-directory target)'];
            if (
              !failedReservationStat.isDirectory() ||
              failedReservationStat.isSymbolicLink() ||
              failedReservationOccupants.length > 0
            ) {
              throw archiveReservationOwnershipError(
                plan.paths.final,
                `Archive reservation could not prove ownership; occupants: ${failedReservationOccupants.join(', ')}`
              );
            }
          }
          throw error;
        }
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        const reservedIdentity = await assertArchiveChildDirectory(
          plan.paths.archiveParent,
          plan.paths.final,
          adapters
        );
        finalReserved = true;
        published = false;
        journalPath = plan.paths.publishedJournal;
        const reservationStat = await adapters.fs.lstat(plan.paths.final);
        const initialOccupants =
          reservationStat.isDirectory() && !reservationStat.isSymbolicLink()
            ? await listArchiveReservationOccupants(plan.paths.final, adapters)
            : ['(non-directory target)'];
        if (
          !reservationStat.isDirectory() ||
          reservationStat.isSymbolicLink() ||
          stableArchiveJson(initialOccupants) !==
            stableArchiveJson([ARCHIVE_FINAL_OWNER_FILENAME]) ||
          stableArchiveJson(
            archiveDeletionIdentity(reservationStat, 'directory')
          ) !== stableArchiveJson(reservedIdentity)
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            `Fresh archive reservation lacks its exclusive owner sentinel; occupants: ${initialOccupants.join(', ')}`
          );
        }
        journalSnapshot.finalReservation = {
          state: 'owned',
          identity: reservedIdentity,
          entries: [finalOwner],
        };
        archivePathAuthority = await assertArchivePathAuthority(
          plan,
          archivePathAuthority,
          adapters,
          { recoveryOwned: true, allowUnbound: true }
        );
        const durableReservationIdentity = await assertArchiveChildDirectory(
          plan.paths.archiveParent,
          plan.paths.final,
          adapters
        );
        if (
          stableArchiveJson(durableReservationIdentity) !==
          stableArchiveJson(reservedIdentity)
        ) {
          throw archiveReservationOwnershipError(
            plan.paths.final,
            'Fresh archive reservation identity changed before durable publication'
          );
        }
        currentOperation = 'journal';
        currentOperationPath = journalPath;
        await persistJournalPhase(journalPath, 'specs-applied');
      } else {
        if (!journalSnapshot) {
          throw new Error('Archive reservation recovery requires a durable journal.');
        }
        await assertOwnedArchiveReservation(plan, journalSnapshot, adapters);
      }

      currentOperation = 'copy';
      currentOperationPath = plan.paths.final;
      const stagedPayload = await fingerprintArchiveTree(plan.paths.stage, adapters);
      const beforeFinalCopy = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      await recordIntentFingerprint(
        'final-reserved',
        'final',
        beforeFinalCopy,
        stagedPayload,
        journalPath
      );
      if (!journalSnapshot) {
        throw new Error('Archive reservation copy requires a durable journal.');
      }
      await copyArchivePayloadIntoReservation(
        plan,
        journalSnapshot,
        adapters,
        () => persistJournalPhase(journalPath, currentPhase)
      );
      const finalPayload = await fingerprintArchiveTree(plan.paths.final, adapters);
      if (!archivePayloadFingerprintMatches(finalPayload, stagedPayload)) {
        const mismatch = new Error(
          'Reserved archive payload does not match the verified stage.'
        );
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      await recordVerifiedFingerprint(
        'final-reserved',
        'final',
        stagedPayload,
        finalPayload
      );
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'specs-applied');

      currentOperation = 'publish';
      currentOperationPath = path.join(
        plan.paths.final,
        ARCHIVE_PUBLISHED_MARKER_FILENAME
      );
      await publishArchiveMarker(plan, finalPayload, adapters);
      published = true;
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'published');
      currentPhase = 'published';
    }

    for (const relativePath of plan.cleaner.effectiveDelete) {
      if (!journalSnapshot) {
        throw new Error('Archive cleaner requires a durable journal.');
      }
      const progress = journalSnapshot.cleanerProgress.find(
        entry => entry.path === relativePath
      );
      if (!progress) {
        throw new Error(`Archive cleaner progress is missing ${relativePath}.`);
      }
      if (
        progress.state === 'deleted' ||
        progress.state === 'deleted-after-intent'
      ) {
        if (!ephemeraDisposed.includes(relativePath)) {
          ephemeraDisposed.push(relativePath);
        }
        continue;
      }
      if (progress.state === 'already-absent') continue;
      currentOperation = 'cleaner-apply';
      currentOperationPath = path.join(plan.paths.ephemera, relativePath);
      const candidateState = await pathExists(currentOperationPath, adapters);
      if (progress.state === 'pending' && candidateState === 'absent') {
        progress.state = 'already-absent';
        await persistJournalPhase(journalPath, 'cleaner-progress');
        continue;
      }
      if (progress.state === 'delete-intent' && candidateState === 'absent') {
        progress.state = 'deleted-after-intent';
        if (!ephemeraDisposed.includes(relativePath)) {
          ephemeraDisposed.push(relativePath);
        }
        await persistJournalPhase(journalPath, 'cleaner-progress');
        currentPhase = 'cleaner-progress';
        continue;
      }
      if (progress.state === 'pending') {
        progress.state = 'delete-intent';
        await persistJournalPhase(journalPath, 'cleaner-progress');
      }
      let deleted: string[];
      try {
        deleted = await claimAndDeleteCleanerCandidate(
          plan,
          relativePath,
          adapters
        );
      } catch (error) {
        if (
          error instanceof EphemeraPlanError ||
          errorCode(error) === 'ESTALE' ||
          errorCode(error) === 'EEXIST'
        ) {
          throw archiveCleanerOwnershipError(
            currentOperationPath,
            plan,
            error instanceof Error ? error.message : String(error)
          );
        }
        throw error;
      }
      if (deleted.includes(relativePath)) {
        progress.state = 'deleted';
      } else if (
        (await pathExists(currentOperationPath, adapters)) === 'absent'
      ) {
        progress.state = 'deleted-after-intent';
      } else {
        throw archiveCleanerOwnershipError(
          currentOperationPath,
          plan,
          'Cleaner did not achieve the planned deletion postcondition.'
        );
      }
      if (!ephemeraDisposed.includes(relativePath)) {
        ephemeraDisposed.push(relativePath);
      }
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'cleaner-progress');
      currentPhase = 'cleaner-progress';
    }

    if (!phaseAtLeast(currentPhase, 'accounting-finalized')) {
      currentOperation = 'accounting';
      currentOperationPath = path.join(plan.paths.final, 'archive.json');
      // Which record schema is written is decided from the plan's recorded
      // finalization block, never from the content of any file at the
      // destination and never from a path substring.
      const prepared = await preparePlannedAccounting();
      const beforeAccounting = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      const expectedAccounting = await projectAccountingContentTransform(
        prepared.content
      );
      await recordIntentFingerprint(
        'accounting-finalized',
        'final',
        beforeAccounting,
        expectedAccounting,
        journalPath
      );
      if (!journalSnapshot) {
        throw new Error('Accounting intent requires a durable journal.');
      }
      const accountingTemporary = archiveAccountingTemporaryPath(
        plan.paths.final,
        prepared.content
      );
      try {
        await writeFlushedExclusiveFile(
          accountingTemporary,
          prepared.content,
          adapters
        );
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw archiveTransactionTempOwnershipError(
            accountingTemporary,
            path.join(plan.paths.final, 'archive.json'),
            'The deterministic accounting temporary is already occupied before its identity was journaled.'
          );
        }
        throw error;
      }
      const durableTemporary = await readStableArchiveFile(
        accountingTemporary,
        adapters
      );
      if (durableTemporary.content.toString('utf8') !== prepared.content) {
        throw archiveTransactionTempOwnershipError(
          accountingTemporary,
          path.join(plan.paths.final, 'archive.json'),
          'The deterministic accounting temporary changed before its identity was journaled.'
        );
      }
      journalSnapshot.phaseFingerprints['accounting-finalized']!.temporary = {
        path: accountingTemporary,
        identity: archiveDeletionIdentity(durableTemporary.stat, 'file'),
      };
      await persistJournalPhase(journalPath, currentPhase);
      await prepared.write(
        archiveDeletionIdentity(durableTemporary.stat, 'file')
      );
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      const accountingFingerprint = await fingerprintArchiveTree(
        plan.paths.final,
        adapters
      );
      if (
        !archivePayloadFingerprintMatches(
          accountingFingerprint,
          expectedAccounting
        )
      ) {
        const mismatch = new Error(
          'Accounting transform did not match its durable expected payload.'
        );
        (mismatch as NodeJS.ErrnoException).code = 'ESTALE';
        throw mismatch;
      }
      await recordVerifiedFingerprint(
        'accounting-finalized',
        'final',
        beforeAccounting,
        accountingFingerprint
      );
      await persistJournalPhase(journalPath, 'accounting-finalized');
      currentPhase = 'accounting-finalized';
    }

    // The binding's terminal state is a phase of THIS transaction, ordered
    // after the record is durable and before the active source is removed. A
    // failure here leaves the entry published and the journal naming this
    // phase, so re-applying the same token completes it once the disagreement
    // is repaired. A scope with no workspace pair declared the phase a no-op in
    // advance, and the adapter honours that declaration rather than inventing a
    // binding.
    if (
      plan.finalization !== undefined &&
      !phaseAtLeast(currentPhase, 'association-finalized')
    ) {
      currentOperation = 'association';
      currentOperationPath =
        plan.finalization.association.executionAssociationPath ?? plan.paths.final;
      if (!journalSnapshot) {
        throw new Error('Archive association finalization requires a durable journal.');
      }
      if (!journalSnapshot.associationProgress) {
        journalSnapshot.associationProgress = {
          path: currentOperationPath,
          state: 'pending',
        };
        await persistJournalPhase(journalPath, currentPhase);
      }
      journalSnapshot.associationProgress.state = 'intent-durable';
      await persistJournalPhase(journalPath, currentPhase);
      await adapters.finalizeArchiveAssociation({
        plan,
        carriers: journalSnapshot.associationProgress.carriers ?? [],
        carrierPrepared: async authority => {
          const carriers =
            journalSnapshot!.associationProgress!.carriers ?? [];
          const existing = carriers.find(
            candidate => pathIdentityEquals(candidate.target, authority.target)
          );
          if (
            existing !== undefined &&
            stableArchiveJson(existing) !== stableArchiveJson(authority)
          ) {
            throw invalidCompletedProgress(
              authority.target,
              'the association carrier disagrees with journal-bound authority'
            );
          }
          if (existing === undefined) {
            journalSnapshot!.associationProgress!.carriers = [
              ...carriers,
              authority,
            ];
          }
          await persistJournalPhase(journalPath, currentPhase);
        },
      });
      delete journalSnapshot.associationProgress.carriers;
      journalSnapshot.associationProgress.state = 'complete';
      currentOperation = 'journal';
      currentOperationPath = journalPath;
      await persistJournalPhase(journalPath, 'association-finalized');
      currentPhase = 'association-finalized';
    }

    currentOperation = 'source-remove';
    if (!journalSnapshot) {
      throw new Error('Archive source deletion requires a durable journal.');
    }
    // The phase the journal holds while source removal is in flight. It is the
    // last COMPLETED phase, which gains an entry for a Store v2 finalization;
    // persisting the v1 literal there would regress a v2 journal below the
    // association phase it has already passed.
    const sourceRemovalJournalPhase: ArchiveJournalPhase =
      plan.finalization === undefined ? 'accounting-finalized' : 'association-finalized';
    const sourceQuarantine = journalSnapshot.sourceProgress.quarantine;
    const sourceClaimRoot = path.dirname(sourceQuarantine);
    currentOperationPath = sourceClaimRoot;
    const sourceClaimParent = path.dirname(sourceClaimRoot);
    let sourceClaimParentStat: ArchiveFsStat;
    try {
      sourceClaimParentStat = await adapters.fs.lstat(sourceClaimParent);
    } catch (error) {
      throw archiveClaimOwnershipError(
        sourceClaimRoot,
        `Active-source claim parent is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }.`,
        [sourceClaimParent, sourceQuarantine]
      );
    }
    if (
      !sourceClaimParentStat.isDirectory() ||
      sourceClaimParentStat.isSymbolicLink()
    ) {
      throw archiveClaimOwnershipError(
        sourceClaimRoot,
        'Active-source claim parent is not a real directory.',
        [sourceClaimParent]
      );
    }
    const sourceClaimParentIdentity = archiveDeletionIdentity(
      sourceClaimParentStat,
      'directory'
    );
    async function requireSourceClaimRootIdentity(
      expected: ArchiveStatIdentity
    ): Promise<void> {
      let parentStat: ArchiveFsStat;
      try {
        parentStat = await adapters.fs.lstat(sourceClaimParent);
      } catch (error) {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          `Active-source claim parent is unavailable before mutation: ${
            error instanceof Error ? error.message : String(error)
          }.`,
          [sourceClaimParent, sourceQuarantine]
        );
      }
      if (
        !parentStat.isDirectory() ||
        parentStat.isSymbolicLink() ||
        stableArchiveJson(archiveDeletionIdentity(parentStat, 'directory')) !==
          stableArchiveJson(sourceClaimParentIdentity)
      ) {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          'Active-source claim parent identity changed before mutation.',
          [sourceClaimParent, sourceQuarantine]
        );
      }
      await requireClaimRootIdentity(sourceClaimRoot, expected, adapters);
    }
    currentOperation = 'source-remove';
    currentOperationPath = plan.paths.final;
    await verifySourceLastDurability(journalSnapshot);
    if (!sourceClaimedAtStart) {
      const sourceBeforeRemove = await fingerprintArchiveTree(
        plan.paths.active,
        adapters
      );
      if (
        !plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(
          sourceBeforeRemove,
          plan.sourceFingerprint
        )
      ) {
        const drift = new Error(
          'Active archive source changed before source-last removal.'
        );
        (drift as NodeJS.ErrnoException).code = 'ESTALE';
        throw drift;
      }
      journalSnapshot.sourceProgress.state = 'delete-intent';
      currentOperationPath = sourceClaimRoot;
      await persistJournalPhase(journalPath, sourceRemovalJournalPhase);
      const sourceParentBeforeClaim = await adapters.fs.lstat(sourceClaimParent);
      if (
        !sourceParentBeforeClaim.isDirectory() ||
        sourceParentBeforeClaim.isSymbolicLink() ||
        stableArchiveJson(
          archiveDeletionIdentity(sourceParentBeforeClaim, 'directory')
        ) !== stableArchiveJson(sourceClaimParentIdentity)
      ) {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          'Active-source claim parent identity changed before claim creation.',
          [sourceClaimParent, plan.paths.active]
        );
      }
      const sourceClaimIdentity = await createOrValidateClaimRoot(
        sourceClaimRoot,
        journalSnapshot.sourceProgress.claimIdentity,
        adapters,
        [plan.paths.active, sourceQuarantine]
      );
      if (!journalSnapshot.sourceProgress.claimIdentity) {
        journalSnapshot.sourceProgress.claimIdentity = sourceClaimIdentity;
        await persistJournalPhase(journalPath, sourceRemovalJournalPhase);
      }
      const durableSourceClaimIdentity =
        journalSnapshot.sourceProgress.claimIdentity ?? sourceClaimIdentity;
      await requireSourceClaimRootIdentity(durableSourceClaimIdentity);
      if ((await pathExists(sourceQuarantine, adapters)) === 'present') {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          'Active-source claim destination is already occupied.',
          [plan.paths.active, sourceQuarantine]
        );
      }
      await adapters.fs.rename(plan.paths.active, sourceQuarantine);
      await requireSourceClaimRootIdentity(durableSourceClaimIdentity);
    }

    if (
      sourceClaimedAtStart &&
      journalSnapshot.sourceProgress.state === 'removing' &&
      (await pathExists(sourceQuarantine, adapters)) === 'absent'
    ) {
      currentOperationPath = sourceClaimRoot;
      if (!journalSnapshot.sourceProgress.claimIdentity) {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          'Source removal recovery has no durable claim-root identity.',
          [sourceQuarantine]
        );
      }
      const [activeRecoveryState, claimRootRecoveryState] = await Promise.all([
        pathExists(plan.paths.active, adapters),
        pathExists(sourceClaimRoot, adapters),
      ]);
      if (
        activeRecoveryState === 'absent' &&
        claimRootRecoveryState === 'absent'
      ) {
        journalSnapshot.sourceProgress.state = 'removed';
        await persistJournalPhase(journalPath, 'source-removed');
      } else {
        if (activeRecoveryState === 'present') {
          throw archiveClaimOwnershipError(
            sourceClaimRoot,
            'Active source reappeared after the durable removal intent.',
            [plan.paths.active, sourceQuarantine]
          );
        }
        await requireSourceClaimRootIdentity(
          journalSnapshot.sourceProgress.claimIdentity
        );
        await adapters.fs.rmdir(sourceClaimRoot);
        journalSnapshot.sourceProgress.state = 'removed';
        await persistJournalPhase(journalPath, 'source-removed');
      }
    }
    if (journalSnapshot.sourceProgress.state !== 'removed') {
      if (!journalSnapshot.sourceProgress.claimIdentity) {
        throw archiveClaimOwnershipError(
          sourceClaimRoot,
          'Claimed source recovery has no durable claim-root identity.',
          [sourceQuarantine]
        );
      }
      await requireSourceClaimRootIdentity(
        journalSnapshot.sourceProgress.claimIdentity
      );
      currentOperationPath = sourceQuarantine;
      const claimed = await fingerprintArchiveTree(sourceQuarantine, adapters);
      if (
        !plan.sourceFingerprint ||
        !archiveDeletionAuthorityMatches(claimed, plan.sourceFingerprint)
      ) {
        journalSnapshot.sourceProgress.state = 'conflict';
        journalSnapshot.sourceProgress.error =
          'Claimed source does not match planned deletion authority.';
        await persistJournalPhase(journalPath, sourceRemovalJournalPhase);
        const conflict = new Error(
          `Claimed source identity mismatch; retained at ${sourceQuarantine}`
        );
        (conflict as NodeJS.ErrnoException).code = 'ESTALE';
        throw conflict;
      }
      journalSnapshot.sourceProgress.state = 'claimed';
      await persistJournalPhase(journalPath, sourceRemovalJournalPhase);
      journalSnapshot.sourceProgress.state = 'removing';
      await persistJournalPhase(journalPath, sourceRemovalJournalPhase);
      await requireSourceClaimRootIdentity(
        journalSnapshot.sourceProgress.claimIdentity
      );
      await removeClaimedArchiveTreeGuarded(
        sourceQuarantine,
        plan.sourceFingerprint,
        adapters
      );
      await requireSourceClaimRootIdentity(
        journalSnapshot.sourceProgress.claimIdentity
      );
      await adapters.fs.rmdir(sourceClaimRoot);
      journalSnapshot.sourceProgress.state = 'removed';
      await persistJournalPhase(journalPath, 'source-removed');
    }
    currentOperation = 'source-remove';
    currentOperationPath = plan.paths.final;
    await verifySourceLastDurability(journalSnapshot);
    currentPhase = 'source-removed';
    currentOperation = 'stage';
    currentOperationPath = plan.paths.stage;
    await removeArchiveStageGuarded(
      plan,
      journalSnapshot,
      'terminal',
      adapters
    );
    currentOperation = 'journal';
    currentOperationPath = journalPath;
    await persistJournalPhase(journalPath, 'complete');

    return {
      status: 'complete',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath,
      resumed,
      effectivePhase: 'complete',
      specsUpdated: Object.values(totals).some(value => value > 0),
      totals,
      ephemeraDiscarded: [...ephemeraDisposed].sort(),
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      blockers: [],
    };
  } catch (error) {
    const accountingError =
      error instanceof ArchiveAccountingErrorLike ? error : undefined;
    let resultOperation: ArchiveBlockerOperation = accountingError
      ? accountingError.operation.startsWith('evidence')
        ? 'evidence'
        : 'accounting'
      : currentOperation;
    let resultPath = accountingError?.path ?? currentOperationPath;
    let resultError: unknown = error;
    const failure = {
      operation: accountingError?.operation ?? currentOperation,
      path: resultPath,
      ...(errorCode(error) ? { code: errorCode(error) } : {}),
      message: error instanceof Error ? error.message : String(error),
      resumePhase: currentPhase,
    };
    const retainedJournal = finalReserved
      ? plan.paths.publishedJournal
      : plan.paths.journal;
    if (
      ownsRecoveryState &&
      errorCode(error) !== ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE &&
      errorCode(error) !== ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE
    ) {
      try {
        await persistJournalPhase(retainedJournal, 'failed', failure);
      } catch (persistenceError) {
        resultOperation = 'journal';
        resultPath = retainedJournal;
        resultError = persistenceError;
        if (persistenceError instanceof Error) {
          persistenceError.message =
            `${persistenceError.message} Original archive failure at ` +
            `${failure.operation} ${failure.path}: ${failure.message}`;
          const retained = (
            persistenceError as Error & { retainedPaths?: string[] }
          ).retainedPaths;
          (
            persistenceError as Error & { retainedPaths?: string[] }
          ).retainedPaths = [
            ...new Set([
              ...(retained ?? []),
              retainedJournal,
              failure.path,
              plan.paths.stage,
              plan.paths.final,
            ]),
          ];
        }
      }
    }
    totals = totalsFromSpecProgress(plan, journalSnapshot);
    if (journalSnapshot) {
      ephemeraDisposed = journalSnapshot.cleanerProgress
        .filter(
          progress =>
            progress.state === 'deleted' ||
            progress.state === 'deleted-after-intent'
        )
        .map(progress => progress.path)
        .sort();
    }
    return applyFailure(
      plan,
      retainedJournal,
      resumed,
      ephemeraDisposed,
      resultError,
      resultOperation,
      resultPath,
      totals,
      currentPhase
    );
  }
}
