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

/**
 * Which branch an archive entry's record read under — the machine-facing
 * enrichment `legacyRecord`'s display boolean cannot carry (it stays collapsed
 * for display on purpose). `legacy` covers the two shapes that predate v2
 * outcome records (no record at all, or a record that is not a
 * schemaVersion-2 document); `invalid` is a record that EXISTS in v2 shape —
 * or would have to be JSON to be anything — but does not validate or parse:
 * damaged bytes, never a legacy truth.
 */
export type ArchiveOutcomeBasis = 'v2' | 'legacy' | 'invalid';

/** One frozen evidence-inventory entry: its Store-relative path and digest. */
export interface ArchiveDeliveryEvidenceEntry {
  readonly path: string;
  readonly sha256: string;
}

/**
 * The delivery facts one archived entry's record yielded — the `record` state
 * of the issue-delivery-evidence vocabulary. Present only when the record
 * PARSED (a v1 ledger or a validated v2 record): bytes that are absent or
 * damaged derive no delivery facts at all, so `delivery: null` names the
 * `no-record` and `unreadable` branches the basis (`outcomeBasis`) already
 * distinguishes. Every fact is the record's own spelling, mapped per basis and
 * never normalized: a v1 ledger is read defensively (it has no schema — an
 * absent or wrongly typed field reads as its named absence `null`, never
 * repaired), and a v2 record contributes its validated fields. `outcome` is
 * null exactly on the legacy basis, which predates v2 outcome records — the
 * absence is the record's own statement, never filled.
 */
export interface IssueArchiveDelivery {
  /** Which parsed record shape the facts came from. */
  readonly basis: 'v2' | 'legacy';
  readonly archivedAt: string | null;
  /**
   * The code commit that shipped the work: a v1 ledger's `codeCommit`, or a
   * v2 record's `codeMerge.commit`. Null is the record's own absence — a
   * non-git root's ledger, or a v2 record with no code merge — never inferred.
   */
  readonly codeCommit: string | null;
  /**
   * The planning-branch fact in the record's own spelling: a v1 ledger's
   * `planningBranch`, or a v2 record's full `planning.sourceRef`.
   */
  readonly planningBranch: string | null;
  readonly outcome: FinalizationOutcomeName | null;
  /**
   * The evidence inventory the record froze, each entry its store-relative
   * path and recorded digest. Null when the record carries no readable
   * inventory; an empty array is a frozen empty inventory — different truths.
   */
  readonly evidence: readonly ArchiveDeliveryEvidenceEntry[] | null;
  /** The missing-evidence names the record recorded; null when none readable. */
  readonly missing: readonly string[] | null;
  readonly entryName: string;
  readonly foundAtRef: string;
  readonly blobPath: string;
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
  /**
   * Which branch the entry's record read under (issue-ready-set-scheduling
   * D4). Display semantics of `legacyRecord` are untouched; this is the
   * scheduling consumer's basis fact.
   */
  readonly outcomeBasis: ArchiveOutcomeBasis;
  /**
   * Why an `invalid` basis failed — the parse or validation error. Null on
   * every other basis.
   */
  readonly outcomeBasisReason: string | null;
  /**
   * The archive record's Store-relative blob path, carried for every branch
   * (including the record-absent one, where it names the path nothing was
   * found at). Machine-facing; the aggregate display never reads it.
   */
  readonly outcomeBasisPath: string;
  readonly foundAtRef: string;
  /**
   * The delivery facts of the parsed record (issue-delivery-evidence-rollup).
   * Null when the record was absent (`text === null`) or its bytes did not
   * parse/validate — damaged bytes never yield delivery facts. Threads onto
   * `PlanNodeResolution` exactly as `outcomeBasis` does.
   */
  readonly delivery: IssueArchiveDelivery | null;
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
  /**
   * Which basis the archived Change's record read under, threaded from
   * `readArchiveEntry` (issue-ready-set-scheduling D4). Absent when no archive
   * record was consulted — the query populates it for every archived
   * resolution; the optionality keeps hand-built rows (tests, degraded reads)
   * valid without guessing a basis.
   */
  readonly outcomeBasis?: ArchiveOutcomeBasis;
  /** The `invalid` basis's parse/validation failure. Absent/null elsewhere. */
  readonly outcomeBasisReason?: string | null;
  /** The archive record's Store-relative blob path, when one was consulted. */
  readonly outcomeBasisPath?: string | null;
  /**
   * The delivery facts of the consulted archive record (additive, the
   * `outcomeBasis` pattern): the parsed record's facts, or null when the
   * record was absent or damaged — the basis distinguishes which. Absent when
   * no archive record was consulted (the node is not archived).
   */
  readonly delivery?: IssueArchiveDelivery | null;
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
