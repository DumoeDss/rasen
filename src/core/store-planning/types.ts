import type { ChangeMetadata } from '../change-metadata/index.js';
import type {
  PlanningScopeId,
  VerifiedChangeInstanceId,
} from '../store/planning-foundation.js';

declare const scopedLocationBrand: unique symbol;
declare const scopeCapabilityBrand: unique symbol;

export type PlanningIntent =
  | 'store-read'
  | 'project-read'
  | 'create-change'
  | 'finalize-change'
  | 'store-issue';
export type PlanningPathFlavor = 'native' | 'win32' | 'posix';

export interface PlanningSelection {
  readonly store?: string;
  readonly project?: string;
  readonly targetLine?: string;
}

interface OpenBase {
  /** Absolute command/session boundary captured by the caller. */
  readonly startPath: string;
  readonly selection?: PlanningSelection;
  readonly globalDataDir?: string;
  readonly pathFlavor?: PlanningPathFlavor;
}

export interface OpenStoreRead extends OpenBase {
  readonly intent: 'store-read';
}

export interface ChangeSelector {
  readonly changeId: string;
  readonly expectedInstanceId?: string;
}

export interface OpenProjectRead extends OpenBase {
  readonly intent: 'project-read';
  readonly change?: ChangeSelector;
}

export interface OpenChangeCreation extends OpenBase {
  readonly intent: 'create-change';
}

/**
 * Finalizing an existing Change. A distinct intent from `create-change`
 * because its authority requirements differ: the Change must already exist,
 * its committed v2 identity must verify, and the resolved stable target line
 * must be the one frozen in that identity — none of which creation checks.
 */
export interface OpenChangeFinalization extends OpenBase {
  readonly intent: 'finalize-change';
  readonly change: ChangeSelector;
}

/**
 * A Store-level Issue or Execution Plan operation.
 *
 * A distinct intent from `store-read` because its authority requirements
 * differ in BOTH directions: it requires no project and no target line — an
 * Issue spans projects by construction, so demanding one would contradict the
 * resource — and it must resolve the Store even when the start path is an
 * execution worktree whose binding names one project, without resolving that
 * binding's planning worktree as the write location.
 *
 * Opening it confers no project authority: a project read or mutation attempted
 * from it still needs its own unambiguous project scope.
 */
export interface OpenStoreIssue extends OpenBase {
  readonly intent: 'store-issue';
}

export type OpenPlanningScope =
  | OpenStoreRead
  | OpenProjectRead
  | OpenChangeCreation
  | OpenChangeFinalization
  | OpenStoreIssue;

/**
 * Store-level cross-project Issue content. Each of the directory, the record,
 * the revisions directory, and ONE revision is its own address, so no caller
 * appends a filename to a returned directory. None of them takes a project or a
 * target line.
 */
export type StoreIssueAddress =
  | { readonly kind: 'issue'; readonly issueId: string }
  | { readonly kind: 'issue-record'; readonly issueId: string }
  | { readonly kind: 'execution-plans'; readonly issueId: string }
  | {
      readonly kind: 'execution-plan';
      readonly issueId: string;
      readonly revisionId: string;
    };

export type StoreReadAddress =
  | { readonly kind: 'store-metadata' }
  | { readonly kind: 'store-design-docs' }
  | StoreIssueAddress;

export type ProjectReadAddress =
  | { readonly kind: 'project-home' }
  | { readonly kind: 'project-config' }
  | { readonly kind: 'project-schemas' }
  | { readonly kind: 'project-work' }
  | { readonly kind: 'specs' }
  | { readonly kind: 'spec'; readonly capabilityId: string }
  | { readonly kind: 'project-design-docs' }
  | { readonly kind: 'active-changes' }
  | { readonly kind: 'active-change'; readonly changeId: string }
  | { readonly kind: 'archive-line' }
  /**
   * The addressed Archive entry for one Change attempt. In a Store v2 project
   * scope the verified Change instance is required and the address comes from
   * the layout contract; a standalone project or a legacy flat Store composes
   * its existing flat `YYYY-MM-DD-<changeId>` name and mints no v2 identity.
   */
  | {
      readonly kind: 'archive-entry';
      readonly changeId: string;
      readonly archiveDate: string;
      readonly changeInstanceId?: string;
    };

export type PlanningAddressKind = StoreReadAddress['kind'] | ProjectReadAddress['kind'];

export type PlanningScopeSource =
  | 'explicit'
  | 'session'
  | 'execution-association'
  | 'planning-worktree-marker'
  | 'project-binding'
  | 'nearest-standalone';

export interface ScopeEvidence {
  readonly source: PlanningScopeSource;
  readonly field: 'store' | 'project' | 'target-line' | 'planning-root' | 'execution-root';
  readonly value: string;
}

export interface PlanningNotice {
  readonly code:
    | 'configuration_store_inheritance'
    | 'split_planning_truth'
    | 'legacy_flat_store_layout'
    | 'execution_authority_unavailable'
    | 'invalid_project_catalog';
  readonly message: string;
}

export interface StandaloneProjectRef {
  readonly mode: 'standalone';
  readonly projectId?: string;
  readonly projectRoot: string;
}

export interface LegacyStoreReadRef {
  readonly mode: 'legacy-store';
  readonly storeUid?: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly projectId?: string;
}

export interface StoreAggregateRef {
  readonly mode: 'store-aggregate';
  readonly storeUid?: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly layoutVersion?: 2;
}

export interface StoreProjectRef {
  readonly mode: 'store-project';
  readonly storeUid: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly projectId: string;
  readonly targetLineId?: string;
  readonly planningScopeId?: PlanningScopeId;
}

export type StablePlanningRef =
  | StandaloneProjectRef
  | LegacyStoreReadRef
  | StoreAggregateRef
  | StoreProjectRef;

export interface PlanningScopeDescription {
  readonly kind: 'standalone' | 'legacy-store' | 'store-aggregate' | 'store-project';
  readonly intent: PlanningIntent;
  readonly source: PlanningScopeSource;
  readonly ref: StablePlanningRef;
  /** Local locators only. A serialized description is never replayable authority. */
  readonly paths: Readonly<Partial<Record<PlanningAddressKind | 'planning-checkout' | 'execution-root', string>>>;
  readonly evidence: readonly ScopeEvidence[];
  readonly notices: readonly PlanningNotice[];
  readonly followupSelection: PlanningSelection;
}

export interface ScopedReadLocation {
  readonly absolutePath: string;
  readonly address: PlanningAddressKind;
  readonly owner: StablePlanningRef;
  readonly [scopedLocationBrand]: true;
}

export interface ScopedReadChange {
  readonly changeId: string;
  readonly location: ScopedReadLocation;
  readonly metadata: ChangeMetadata | null;
  readonly instanceId?: VerifiedChangeInstanceId;
}

export interface CreateScopedChangeInput {
  readonly changeId: string;
  readonly schema?: string;
  readonly defaultSchema?: string;
  readonly description?: string;
  readonly proposal?: string;
  readonly goal?: string;
  readonly implementation?: 'code' | 'none';
}

export interface ScopedAuthoredChange {
  readonly changeId: string;
  readonly schema: string;
  readonly location: ScopedReadLocation;
  readonly metadataPath: string;
  readonly instanceId?: VerifiedChangeInstanceId;
}

interface ScopeCapability {
  readonly [scopeCapabilityBrand]: true;
  describe(): PlanningScopeDescription;
}

export interface StoreAggregateReadScope extends ScopeCapability {
  readonly kind: 'store-aggregate';
  readonly ref: StoreAggregateRef;
  locate(address: StoreReadAddress): ScopedReadLocation;
}

/**
 * A Store-level Issue scope. It exposes ONLY Issue addresses — not
 * `store-metadata`, not `store-design-docs`, and no project address — so the
 * capability a caller holds says exactly what it may reach.
 *
 * `storeCheckoutRoot` is the Store checkout a Git-tracked Issue write would
 * land in. It is the Store's registered checkout, never a planning worktree
 * bound to a Change: that worktree's branch carries one Change's unmerged line,
 * and a cross-line resource written there is invisible from every other line.
 */
export interface StoreIssueScope extends ScopeCapability {
  readonly kind: 'store-issue';
  readonly ref: StoreAggregateRef;
  readonly storeCheckoutRoot: string;
  locate(address: StoreIssueAddress): ScopedReadLocation;
}

export interface ProjectReadScope extends ScopeCapability {
  readonly kind: 'project';
  readonly ref: StandaloneProjectRef | LegacyStoreReadRef | StoreProjectRef;
  locate(address: ProjectReadAddress): ScopedReadLocation;
  openChange(selector: ChangeSelector): Promise<ScopedReadChange>;
}

export interface StandaloneAuthoringRef extends StandaloneProjectRef {
  readonly mode: 'standalone';
}

export interface StoreProjectAuthoringRef extends StoreProjectRef {
  readonly mode: 'store-project';
  readonly targetLineId: string;
  readonly planningScopeId: PlanningScopeId;
}

/**
 * A legacy flat Store authoring scope. It writes the Store's existing flat
 * `rasen/changes` layout through the frozen legacy adapter and mints no Store
 * v2 identity. Refusing this class belongs to `store-layout-v2-migration`,
 * which ships the migration that makes the refusal survivable; see that
 * child's proposal BREAKING bullet.
 */
export interface LegacyStoreAuthoringRef extends LegacyStoreReadRef {
  readonly mode: 'legacy-store';
}

export interface ChangeCreationScope extends ScopeCapability {
  readonly kind: 'change-creation';
  readonly ref: StandaloneAuthoringRef | StoreProjectAuthoringRef | LegacyStoreAuthoringRef;
  createChange(input: CreateScopedChangeInput): Promise<ScopedAuthoredChange>;
}

/**
 * The finalization scope: an existing Change whose committed v2 identity
 * verified, on the stable target line frozen in that identity, with verified
 * planning-worktree authority. It exposes the project's canonical specs, the
 * applicable Archive line, and the addressed Archive entry as scope-owned
 * typed locations. `workspacePairId` is present only when the machine
 * workspace index supplies one; finalization refuses rather than minting it.
 */
export interface ChangeFinalizationScope extends ScopeCapability {
  readonly kind: 'change-finalization';
  readonly ref: StandaloneProjectRef | LegacyStoreReadRef | StoreProjectRef;
  readonly change: ScopedReadChange;
  locate(address: ProjectReadAddress): ScopedReadLocation;
}

export interface StorePlanning {
  open(input: OpenStoreRead): Promise<StoreAggregateReadScope>;
  open(input: OpenProjectRead): Promise<ProjectReadScope>;
  open(input: OpenChangeCreation): Promise<ChangeCreationScope>;
  open(input: OpenChangeFinalization): Promise<ChangeFinalizationScope>;
  open(input: OpenStoreIssue): Promise<StoreIssueScope>;
}

/** Deprecated read-only bridge. It is not accepted by mutation APIs. */
export interface ResolvedOpenSpecRootReadProjection {
  readonly planningCheckoutRoot: string;
  readonly projectHome: string;
  readonly schemasDir: string;
  readonly changesDir: string;
  readonly specsDir: string;
  readonly archiveDir?: string;
}
