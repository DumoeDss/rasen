import type { ChangeMetadata } from '../change-metadata/index.js';
import type {
  PlanningScopeId,
  VerifiedChangeInstanceId,
} from '../store/planning-foundation.js';

declare const scopedLocationBrand: unique symbol;
declare const scopeCapabilityBrand: unique symbol;

export type PlanningIntent = 'store-read' | 'project-read' | 'create-change';
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

export type OpenPlanningScope = OpenStoreRead | OpenProjectRead | OpenChangeCreation;

export type StoreReadAddress =
  | { readonly kind: 'store-metadata' }
  | { readonly kind: 'store-design-docs' };

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
  | { readonly kind: 'archive-line' };

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

export interface StorePlanning {
  open(input: OpenStoreRead): Promise<StoreAggregateReadScope>;
  open(input: OpenProjectRead): Promise<ProjectReadScope>;
  open(input: OpenChangeCreation): Promise<ChangeCreationScope>;
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
