/**
 * `StoreQueryModule` — the typed aggregate read surface for one Store.
 *
 * Two properties are structural rather than conventional, because a convention
 * here is a convention a caller breaks:
 *
 *   - **Grouping is a value.** `listChanges` returns groups keyed by a
 *     validated project id and a validated target-line id. There is no flat
 *     listing method, because the only way a caller could recover an implicit
 *     group key is from a path or an identifier substring, which is the exact
 *     algorithm the accepted design's §6 exists to delete.
 *   - **Completeness is required.** Every aggregate result carries a
 *     non-optional `complete` flag and an `unsearchedRefs` list. A Store ref
 *     that could not be read lowers completeness; it never removes content and
 *     is never evidence of absence.
 *
 * No method accepts or returns a Store-relative path as an address. Absolute
 * paths that do appear are inert local locators that confer no authority.
 */
import type { FinalizationOutcome } from '../finalization-v2.js';
import type {
  ExecutionPlanRevisionId,
  IssueId,
  ProjectId,
  TargetLineId,
} from '../planning-validation.js';
import type {
  ExecutionPlanNode,
  ExecutionPlanRevisionV1,
  IssueRecordV1,
  IssueState,
} from '../issues/types.js';

export type FinalizationOutcomeName = FinalizationOutcome['outcome'];

// -----------------------------------------------------------------------------
// Shared reporting shapes
// -----------------------------------------------------------------------------

/**
 * A Store ref the query could not read. This is NOT absence: it lowers the
 * result's completeness so a reference is never concluded unresolved on the
 * strength of a ref nobody could open.
 */
export interface UnsearchedRef {
  readonly targetLineId: string;
  readonly storeRef: string;
  readonly reason: string;
}

/**
 * An item the query REACHED and could not read.
 *
 * Distinct from an `UnsearchedRef`, where the bytes were never reached at all.
 * Both lower completeness; neither ever removes the item from the answer. When
 * the thing that failed to parse is the item's own identity — a Change whose
 * committed metadata does not validate has no validated (project, line) key to
 * be grouped under — this report IS the item's report, which is why it names
 * the item, where it was read from, and why.
 *
 * A catalog is deliberately NOT reported here: an invalid project or
 * target-line catalog already appears as its own rollup entry carrying a
 * `CatalogDiagnostic`, because a catalog keeps a readable identity (its file
 * name) even when its content does not validate.
 */
export interface AggregateProblem {
  /** What kind of item could not be read. */
  readonly kind: 'change' | 'issue';
  /** The item as it is addressed: a Change alias, an Issue id. */
  readonly itemId: string;
  /** The Store ref the bytes came from; null for the local checkout. */
  readonly storeRef: string | null;
  /** Where the unreadable bytes are: a blob path on `storeRef`, or a local path. */
  readonly path: string;
  /** Why it could not be read. */
  readonly reason: string;
}

/** Carried by every aggregate result. Never optional, never defaulted. */
export interface AggregateCompleteness {
  readonly unsearchedRefs: readonly UnsearchedRef[];
  /**
   * Items that were reached and could not be read. Non-optional for the same
   * reason `complete` is: a caller who never has to ask for the problems
   * cannot forget to, and an item that is reported here is an item that was
   * not silently omitted.
   */
  readonly problems: readonly AggregateProblem[];
  /** False when a ref went unsearched OR an item went unread. */
  readonly complete: boolean;
}

/** A catalog that failed strict validation is reported, never dropped. */
export interface CatalogDiagnostic {
  readonly code: string;
  readonly message: string;
  /** Local locator of the catalog file. */
  readonly path: string;
}

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface StoreQuery {
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
}

/**
 * Query FILTERS. Every field is optional and every field narrows. This type is
 * structurally unrelated to any mutation scope type, so a handler cannot pass
 * its filter where a complete scope is required — that is decision 10's first
 * of three redundant enforcements.
 */
export interface ChangeQuery extends StoreQuery {
  readonly projects?: readonly string[];
  readonly targetLines?: readonly string[];
  readonly outcomes?: readonly FinalizationOutcomeName[];
  readonly state?: 'active' | 'archived';
}

export interface IssueQuery extends StoreQuery {
  readonly state?: IssueState;
}

export interface IssueSelector extends StoreQuery {
  readonly issueId: string;
}

export interface ExecutionPlanSelector extends IssueSelector {
  /** Omitted selects the latest published revision. */
  readonly revisionId?: string;
}

// -----------------------------------------------------------------------------
// Project and target-line rollups
// -----------------------------------------------------------------------------

export interface ProjectRollupEntry {
  readonly projectId: string;
  /** Null when the catalog failed validation; the diagnostic says why. */
  readonly roles: { readonly planning: boolean; readonly knowledge: boolean } | null;
  readonly diagnostic: CatalogDiagnostic | null;
  /** Target lines whose catalog declares a code locator for this project. */
  readonly targetLines: readonly string[];
  readonly activeChangeCount: number;
  readonly archivedChangeCount: number;
}

export interface ProjectRollup extends AggregateCompleteness {
  readonly storeId: string;
  readonly storeUid: string;
  readonly projects: readonly ProjectRollupEntry[];
}

export interface TargetLineRollupEntry {
  readonly targetLineId: string;
  readonly storeRef: string | null;
  readonly diagnostic: CatalogDiagnostic | null;
  readonly projects: readonly string[];
  readonly activeChangeCount: number;
  readonly archivedChangeCount: number;
}

export interface TargetLineRollup extends AggregateCompleteness {
  readonly storeId: string;
  readonly storeUid: string;
  readonly targetLines: readonly TargetLineRollupEntry[];
}

// -----------------------------------------------------------------------------
// Grouped Changes
// -----------------------------------------------------------------------------

/** An absolute path that locates something on THIS machine and grants nothing. */
export interface InertLocalLocator {
  readonly root: string;
  readonly kind: 'planning-worktree';
  readonly portable: false;
}

export interface AggregateChangeEntry {
  readonly changeId: string;
  readonly changeInstanceId: string | null;
  readonly projectId: string;
  readonly targetLineId: string;
  /** The Store ref the committed evidence was read from. */
  readonly foundAtRef: string;
  readonly localLocator: InertLocalLocator | null;
}

export interface AggregateArchiveEntry {
  readonly changeId: string;
  readonly changeInstanceId: string | null;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly entryName: string;
  readonly archiveDate: string | null;
  /**
   * Null for a relocated legacy v1 record found in a v2 partition. Never
   * inferred, defaulted, or upgraded — inventing `landed` to fill a column is
   * the exact lie the four-outcome model exists to prevent.
   */
  readonly outcome: FinalizationOutcomeName | null;
  readonly legacyRecord: boolean;
  readonly foundAtRef: string;
}

export interface ChangeGroup {
  readonly projectId: ProjectId;
  readonly targetLineId: TargetLineId;
  readonly active: readonly AggregateChangeEntry[];
  readonly archived: readonly AggregateArchiveEntry[];
}

export interface GroupedChanges extends AggregateCompleteness {
  readonly groups: readonly ChangeGroup[];
}

// -----------------------------------------------------------------------------
// Issues
// -----------------------------------------------------------------------------

/**
 * One copy of an Issue record, with the ref it was read from.
 *
 * `storeRef` is null for the local Store checkout's working tree, which is
 * where a just-authored Issue lives until someone commits it. That copy makes a
 * new Issue visible; it is NEVER part of the divergence decision, which the
 * requirement states over two Store REFS.
 */
export interface IssueRecordCopy {
  readonly storeRef: string | null;
  readonly targetLineId: string | null;
  readonly sha256: string;
  readonly record: IssueRecordV1 | null;
  /** Present when the copy exists but does not validate. */
  readonly diagnostic: string | null;
}

/**
 * One Issue id whose records differ byte-wise across Store refs. Every copy is
 * listed and NONE is presented as the record: choosing by recency would require
 * trusting a timestamp inside a file the divergence already proves untrustworthy.
 */
export interface IssueDivergence {
  readonly copies: readonly IssueRecordCopy[];
}

export interface IssueSummary {
  readonly issueId: string;
  /**
   * Null when the Issue is divergent (no copy is chosen) AND when no copy
   * could be read at all. `diagnostic` distinguishes the two, so a null record
   * is never a fact without a reason.
   */
  readonly record: IssueRecordV1 | null;
  /**
   * Why no record is presented: the reason the copy that would have been
   * presented could not be read, committed copies first. Null when a record IS
   * presented, and null when every copy read but they disagree — that is a
   * divergence, which `divergence` reports copy by copy instead.
   */
  readonly diagnostic: string | null;
  readonly divergence: IssueDivergence | null;
  readonly revisionIds: readonly string[];
  readonly latestRevisionId: string | null;
  readonly refs: readonly string[];
  /** True when the only copy found is the local checkout's working tree. */
  readonly uncommitted: boolean;
}

export interface IssueSummaryPage extends AggregateCompleteness {
  readonly issues: readonly IssueSummary[];
}

export type PlanNodeResolutionStatus =
  | 'resolved'
  | 'unresolved'
  | 'ambiguous'
  | 'not-created';

export interface PlanNodeClaimant {
  readonly changeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly foundAtRef: string;
  readonly archived: boolean;
}

export interface PlanNodeResolution {
  readonly status: PlanNodeResolutionStatus;
  /** Every claimant, in every status. For `ambiguous`, none is chosen. */
  readonly claimants: readonly PlanNodeClaimant[];
  readonly searchedRefs: readonly string[];
  readonly localLocator: InertLocalLocator | null;
  readonly outcome: FinalizationOutcomeName | null;
  readonly archived: boolean;
}

export type PlanNodeReadiness =
  | 'not-started'
  | 'blocked'
  | 'in-progress'
  | 'finalized'
  | 'unknown';

export interface ResolvedPlanNode {
  readonly node: ExecutionPlanNode;
  readonly resolution: PlanNodeResolution;
  readonly readiness: PlanNodeReadiness;
  /** Dependencies that are not yet finalized, in declaration order. */
  readonly blockedBy: readonly string[];
}

export interface IssueReadiness {
  readonly nodes: readonly ResolvedPlanNode[];
  /**
   * Derived and reported, never written back. An Issue is not auto-resolved by
   * its graph; its state stays operator-declared.
   */
  readonly readyToResolve: boolean;
}

export interface ResolvedExecutionPlan extends AggregateCompleteness {
  readonly issueId: IssueId;
  readonly revisionId: ExecutionPlanRevisionId | null;
  readonly revision: ExecutionPlanRevisionV1 | null;
  /** Present when the addressed revision exists but does not validate. */
  readonly diagnostic: string | null;
  readonly readiness: IssueReadiness;
}

export interface IssueDetail extends AggregateCompleteness {
  readonly issue: IssueSummary;
  readonly plan: ResolvedExecutionPlan | null;
}

// -----------------------------------------------------------------------------
// The Module Interface
// -----------------------------------------------------------------------------

/**
 * The whole public surface. Every method reads fresh; none takes a lock, so a
 * held write lock never blocks a board; none has a write path at all.
 *
 * There is deliberately no `listChangesFlat`.
 */
export interface StoreQueryModule {
  listProjects(input: StoreQuery): Promise<ProjectRollup>;
  listTargetLines(input: StoreQuery): Promise<TargetLineRollup>;
  listChanges(input: ChangeQuery): Promise<GroupedChanges>;
  listIssues(input: IssueQuery): Promise<IssueSummaryPage>;
  showIssue(input: IssueSelector): Promise<IssueDetail>;
  resolveExecutionPlan(input: ExecutionPlanSelector): Promise<ResolvedExecutionPlan>;
  /**
   * The derived reverse lookup: which Issues reference a given Change instance.
   * Computed from the Issue set at read time and persisted NOWHERE — a
   * back-reference inside the Change would be a Store-level write landing in a
   * project partition on another ref.
   */
  issuesReferencing(
    input: StoreQuery & { readonly changeInstanceId: string }
  ): Promise<IssueSummaryPage>;
}
