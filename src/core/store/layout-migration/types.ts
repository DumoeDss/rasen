/**
 * `store-layout-v2-migration` — Interface types for the one Module that moves a
 * legacy flat Store into planning layout v2.
 *
 * Everything a caller may see lives here: semantic items, their states, the
 * immutable plan and its token, and the stable error codes. Ref enumeration,
 * the evidence reducer, the provenance graph, staging, publication, and receipt
 * serialization are all hidden behind `StoreLayoutMigrationModule`.
 */
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface InventoryInput {
  /** Store id or permanent identity, as accepted by the Store registry. */
  readonly storeSelector: string;
  /** Absolute command boundary the caller captured. */
  readonly startPath: string;
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
}

export interface MigrationPlanInput extends InventoryInput {
  /** Path to the committed mapping file, resolved inside the Store worktree. */
  readonly mappingPath?: string;
  readonly defaultTargetLine?: string;
  readonly includeUntracked?: boolean;
}

export type MigrationStatusInput = InventoryInput;

export interface MigrationRecoveryInput extends InventoryInput {
  readonly action: 'resume' | 'rollback' | 'retire-flat';
}

// -----------------------------------------------------------------------------
// Ref survey
// -----------------------------------------------------------------------------

export type RefLayoutClassification =
  | 'layout-v2'
  | 'flat'
  | 'no-store-metadata'
  | 'unreadable';

export interface SurveyedRef {
  readonly ref: string;
  readonly kind: 'local-branch' | 'remote-tracking' | 'other';
  readonly classification: RefLayoutClassification;
  /** True only for the ref checked out in the invoking Store worktree. */
  readonly checkedOut: boolean;
  /** Absent when the ref is not a migration candidate; explains why. */
  readonly notCandidateReason?: string;
  /** The command that migrates this ref, when it is flat and not checked out. */
  readonly migrateFrom?: string;
  readonly reason?: string;
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

export type MigrationItemKind =
  | 'spec'
  | 'change'
  | 'archive-entry'
  | 'design-doc'
  | 'membership-record'
  | 'adoptions-manifest';

export type EvidenceClass =
  | 'E1-recorded-identity'
  | 'E2-store-records'
  | 'E3-association'
  | 'E4-explicit-mapping'
  | 'spec-provenance';

export interface OwnershipEvidence {
  readonly class: EvidenceClass;
  /** The file or record the evidence was read from, Store-relative when possible. */
  readonly source: string;
  readonly projectId: string;
  /**
   * `derived` for anything read out of existing data; `asserted` for an
   * operator declaration in the mapping file. Never conflated.
   */
  readonly nature: 'derived' | 'asserted';
  readonly detail?: string;
}

export type UnresolvedReason =
  | 'unknown-owner'
  | 'evidence-conflict'
  | 'shared-spec'
  | 'non-member-owner'
  | 'unrecordable-identity'
  | 'missing-target-line';

export type BlockedReason =
  | 'destination-exists'
  | 'mixed-layout'
  | 'store-identity-missing'
  | 'unrecordable-catalog-field'
  | 'target-line-catalog-conflict'
  | 'dirty-source';

export type MigrationItemState =
  | { readonly kind: 'resolved' }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason }
  | { readonly kind: 'blocked'; readonly reason: BlockedReason };

/** Stable `resolved` / `unresolved:<reason>` / `blocked:<reason>` label. */
export function migrationItemStateLabel(state: MigrationItemState): string {
  return state.kind === 'resolved' ? 'resolved' : `${state.kind}:${state.reason}`;
}

export interface MigrationItem {
  readonly kind: MigrationItemKind;
  /** Directory or file name inside its flat collection; the stable item key. */
  readonly name: string;
  /** Absolute source path in the Store worktree. */
  readonly source: string;
  /** Store-relative POSIX form, for receipts and messages. */
  readonly sourceRelative: string;
  readonly state: MigrationItemState;
  /** Human sentence for the state; always present. */
  readonly reason: string;
  /** Copy-pasteable repair or the mapping key that resolves it. */
  readonly repair: string;
  readonly owner?: string;
  readonly destination?: string;
  readonly destinationRelative?: string;
  readonly targetLineId?: string;
  readonly evidence: readonly OwnershipEvidence[];
  /** Evidence outranked by a recorded identity. Reported, never blocking. */
  readonly supersededEvidence: readonly OwnershipEvidence[];
  /** Contributing projects for a shared or provenance-assigned capability. */
  readonly contributors?: readonly string[];
  /** sha256 over the item's content, for revalidation. */
  readonly digest?: string;
  /** Untracked files inside a moved tree, Store-relative POSIX. */
  readonly untracked?: readonly string[];
}

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

export interface InventoryReadFailure {
  readonly path: string;
  readonly reason: string;
}

export interface FlatStoreInventory {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
  readonly checkedOutRef?: string;
  readonly headOid?: string;
  readonly declaredLayoutVersion?: 2;
  readonly refs: readonly SurveyedRef[];
  readonly specs: readonly string[];
  readonly changes: readonly string[];
  readonly archiveEntries: readonly string[];
  readonly designDocs: readonly string[];
  readonly membershipRecords: readonly string[];
  readonly hasAdoptionsManifest: boolean;
  /** Every item that could not be read, with its reason. Never aborts a scan. */
  readonly failures: readonly InventoryReadFailure[];
  /** sha256 over the ref survey, every enumerated path, and every digest read. */
  readonly fingerprint: string;
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

export interface CatalogUpgrade {
  readonly projectId: string;
  readonly recordPath: string;
  readonly recordRelative: string;
  /** Verbatim bytes of the v1 record, bound into the plan for revalidation. */
  readonly sourceDigest: string;
  readonly catalogYaml: string;
  readonly droppedAdoption?: {
    readonly specs: readonly string[];
    readonly changes: readonly string[];
    readonly adoptedAt: string;
  };
  readonly binding: 'bound' | 'unbound';
}

export interface TargetLineCatalogOutput {
  readonly targetLineId: string;
  readonly destination: string;
  readonly destinationRelative: string;
  readonly catalogYaml: string;
}

export interface MintedChangeIdentity {
  readonly changeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly instanceSeed: string;
  readonly planningScopeId: string;
  readonly changeInstanceId: string;
  /** The pre-migration association alias for this Change. */
  readonly oldAlias: string;
  readonly minted: boolean;
}

export interface SharedSpecResolution {
  readonly capability: string;
  readonly mode: 'owner' | 'split';
  readonly projects: readonly string[];
  readonly contributors: readonly string[];
}

export interface RetainedDesignDoc {
  readonly name: string;
  readonly path: string;
  readonly relative: string;
}

export interface MigrationPlanToken {
  readonly planId: string;
  readonly storeUid: string;
  readonly ref: string;
  readonly headOid: string;
  readonly inventoryFingerprint: string;
}

export interface ImmutableMigrationPlan {
  readonly planId: string;
  readonly schemaVersion: 1;
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
  readonly ref?: string;
  readonly headOid?: string;
  readonly inventoryFingerprint: string;
  readonly createdAt: string;
  readonly items: readonly MigrationItem[];
  readonly catalogUpgrades: readonly CatalogUpgrade[];
  readonly targetLineCatalogs: readonly TargetLineCatalogOutput[];
  readonly mintedIdentities: readonly MintedChangeIdentity[];
  readonly sharedSpecResolutions: readonly SharedSpecResolution[];
  readonly retainedDesignDocs: readonly RetainedDesignDoc[];
  /** Flat paths `--retire-flat` removes, Store-relative POSIX. */
  readonly retirementSet: readonly string[];
  readonly otherFlatRefs: readonly SurveyedRef[];
  readonly mappingPath?: string;
  readonly mappingDigest?: string;
  readonly defaultTargetLine?: string;
  readonly includeUntracked: boolean;
  /** True only when every item is resolved and nothing is blocked. */
  readonly applicable: boolean;
  /** Every unresolved or blocked item, in plan order. */
  readonly blockers: readonly MigrationItem[];
  readonly token?: MigrationPlanToken;
}

// -----------------------------------------------------------------------------
// Apply / recovery
// -----------------------------------------------------------------------------

export type MigrationPhase =
  | 'staged'
  | 'verified'
  | 'publishing'
  | 'published'
  | 'retired'
  | 'rolled-back'
  | 'failed';

export interface MigrationRunStatus {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly ref?: string;
  readonly planId?: string;
  readonly phase?: MigrationPhase;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly createdPaths: readonly string[];
  readonly manifestPath?: string;
  readonly receiptPath?: string;
  /** True when a completed publication receipt exists for this ref. */
  readonly publicationComplete: boolean;
  readonly failure?: string;
}

export interface MigrationResult {
  readonly planId: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly ref?: string;
  readonly phase: MigrationPhase;
  readonly published: readonly string[];
  readonly removed: readonly string[];
  readonly receiptPath?: string;
  readonly suggestedCommits: readonly SuggestedMigrationCommit[];
}

export interface SuggestedMigrationCommit {
  readonly repoRoot: string;
  readonly pathspecs: readonly string[];
  readonly message: string;
  readonly rationale: string;
  readonly command: string;
}

// -----------------------------------------------------------------------------
// Module
// -----------------------------------------------------------------------------

export interface StoreLayoutMigrationModule {
  inventory(input: InventoryInput): Promise<FlatStoreInventory>;
  plan(input: MigrationPlanInput): Promise<ImmutableMigrationPlan>;
  apply(token: MigrationPlanToken): Promise<MigrationResult>;
  status(input: MigrationStatusInput): Promise<MigrationRunStatus>;
  recover(input: MigrationRecoveryInput): Promise<MigrationResult>;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export const STORE_LAYOUT_MIGRATION_ERROR_CODES = [
  'migration_store_unresolved',
  'migration_not_checked_out',
  'migration_ref_unavailable',
  'migration_plan_blocked',
  'migration_plan_stale',
  'migration_plan_missing',
  'migration_mapping_invalid',
  'migration_mapping_outside_store',
  'migration_store_identity_missing',
  'migration_run_missing',
  'migration_retire_without_publication',
  'migration_rollback_after_retirement',
  'migration_staging_verification_failed',
  'migration_already_v2',
  'migration_lock_unavailable',
] as const;

export type StoreLayoutMigrationErrorCode =
  (typeof STORE_LAYOUT_MIGRATION_ERROR_CODES)[number];
