/**
 * `store-scoped-issues-management` — the Issue and Execution Plan contracts.
 *
 * An Issue is Store-level cross-project INTENT. It references per-project
 * Change instances and owns none of them: a Change referenced by an Issue keeps
 * exactly one project owner, is validated, archived, and merged on its own
 * line, and is never rewritten because an Issue points at it.
 *
 * Two invariants are stated here because every other file in this Module
 * depends on them:
 *
 *   - **A mutation refuses; a query reports.** Publishing a revision whose
 *     reference cannot be verified fails outright. A READ over the same
 *     references reports `unresolved` / `ambiguous` / `divergent` and an
 *     unsearched-ref list with an explicit completeness flag, and never throws
 *     on one bad node. Those are two correct expressions of one fail-closed
 *     invariant, not an inconsistency (design decision 5).
 *   - **Reference, never containment, and never a back-reference.** The edge is
 *     one-directional. "Which Issues reference this Change" is derived at read
 *     time from the Issue set and is persisted nowhere.
 */
import type {
  ChangeInstanceId,
  ExecutionPlanRevisionId,
  IssueId,
  ProjectId,
  Sha256Digest,
  TargetLineId,
} from '../planning-foundation.js';

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------

/**
 * The closed refusal taxonomy for Store-level Issue work and for the aggregate
 * query that reads it. It is one union rather than two because the query
 * reports the same conditions the mutation refuses on, and a consumer that
 * switches on a code must not have to know which surface produced it.
 */
export type StoreIssueErrorCode =
  /** A Store-level Issue operation resolved no Store. */
  | 'issue_scope_required'
  /** The resolved Store checkout is a planning worktree bound to a Change. */
  | 'issue_write_requires_store_checkout'
  | 'issue_not_found'
  | 'issue_already_exists'
  /** One Issue id, byte-differing records on two Store refs. No winner. */
  | 'issue_record_divergent'
  /** A declared state transition the lifecycle does not permit. */
  | 'issue_state_transition_refused'
  /** No evidence anywhere for a referenced Change instance. */
  | 'issue_reference_unresolved'
  /**
   * The only evidence is a machine-local planning worktree: the Change exists
   * on disk here and is committed on no Store ref. Distinct from
   * `issue_reference_unresolved` because the two say different true things —
   * one found nothing, the other found something that is authority for
   * nothing — and a refusal that named the wrong one would be a lie about
   * what was searched.
   */
  | 'issue_reference_uncommitted'
  /** Several claimants for one Change instance. Every one listed, none chosen. */
  | 'issue_reference_ambiguous'
  /** The reference's declared scope disagrees with committed identity. */
  | 'issue_reference_scope_conflict'
  /**
   * The node's target project is a member the Store records as NOT planning
   * here (`roles.planning: false`). Distinct from the catalog-absence branch of
   * `issue_reference_scope_conflict` for the same reason
   * `issue_reference_uncommitted` is distinct from `issue_reference_unresolved`:
   * the two say different true things — "no such member" and "member, but it
   * does not plan here" have different repairs — and a refusal that named the
   * wrong one would lie about what was checked.
   */
  | 'issue_reference_target_not_planning_member'
  /** The referenced instance belongs to another Store. */
  | 'issue_reference_foreign_store'
  | 'execution_plan_revision_exists'
  | 'execution_plan_cycle'
  | 'execution_plan_node_duplicate'
  /** A published revision no longer matches its recorded canonical digest. */
  | 'execution_plan_digest_mismatch'
  /** An acceptance-conditions revision ordinal that already exists. */
  | 'acceptance_conditions_revision_exists'
  /** The acceptance input names a conditions revision that does not read back. */
  | 'issue_accept_conditions_unreadable'
  /** The acceptance note is blank or not portable durable text. */
  | 'issue_accept_note_invalid'
  /** The acceptance publish reached without --from-file (input shape, not scope). */
  | 'issue_acceptance_from_file_required'
  /** The acceptance publish file carries no conditions: list. */
  | 'issue_acceptance_conditions_list_required'
  /** The Issue is already carrying an acceptance record. */
  | 'issue_accept_already_accepted'
  /** A dropped Issue is abandoned, not acceptable. */
  | 'issue_accept_dropped'
  /** The gate's structural refusals (no plan / no conditions revision). */
  | 'issue_accept_requires_plan'
  | 'issue_accept_conditions_required'
  /** The gate's fact blockers hold the acceptance. */
  | 'issue_accept_blocked'
  /** A mutation reached with a scope segment missing or not declared. */
  | 'store_query_scope_incomplete'
  /** A Store ref could not be read. NEVER evidence of absence. */
  | 'store_query_ref_unreadable';

// -----------------------------------------------------------------------------
// The Issue record
// -----------------------------------------------------------------------------

export type IssueState = 'open' | 'resolved' | 'dropped';

/**
 * `rasen/issues/<issueId>/issue.yaml`.
 *
 * Deliberately small. It carries no `storeUid` (the containing Store is the
 * Store), no project list and no node list (the plan's nodes are), and no
 * `latestRevision` (the revisions directory is). Each omission removes a second
 * source of truth rather than a convenience.
 */
export interface IssueRecordV1 {
  readonly version: 1;
  readonly id: IssueId;
  readonly title: string;
  readonly state: IssueState;
  /**
   * Required for `dropped`. Permitted but not required in every other state:
   * a reason given while resolving is portable-checked and carried through
   * rather than discarded, since dropping the operator's own words to satisfy
   * a shape rule would be an edit nobody asked for.
   */
  readonly reason: string | null;
  readonly createdAt: string;
}

// -----------------------------------------------------------------------------
// Execution Plan revisions
// -----------------------------------------------------------------------------

export type ExecutionPlanNodeKind = 'change' | 'intent';

/**
 * The closed lifecycle vocabulary a node carries, scoped by kind: a Change node
 * admits all four values; an intent node admits `required` and `optional` only
 * (see `ExecutionPlanIntentNode`). An ABSENT lifecycle reads as `required` —
 * the value every revision published before this vocabulary existed has always
 * meant — and the stored canonical form omits a `required` lifecycle exactly as
 * it omits an absent `changeAlias`, so those revisions re-derive their
 * published digests byte-for-byte. `cancelled` and `superseded` carry a
 * recorded `reason`, and stay Change-node-only: they explain work that EXISTED
 * and is no longer wanted, while unwanted intent work — work no Change ever
 * backed — is expressed by omitting the node from the next revision.
 */
export type ExecutionPlanNodeLifecycle = 'required' | 'optional' | 'cancelled' | 'superseded';

interface ExecutionPlanNodeBase {
  readonly nodeId: string;
  /** Every node names its project, whether or not its Change exists yet. */
  readonly projectId: ProjectId;
  readonly targetLineId: TargetLineId;
  readonly dependsOn: readonly string[];
  /**
   * The pipeline the plan proposes to run for this node. A name the pipeline
   * registry resolves at PUBLICATION (validated through the same registry seam
   * `store issue start --pipeline` uses — the store module takes the
   * membership test as an injected input because it owns no working-directory
   * root to resolve pipelines from). Absent fields are omitted from the
   * canonical form exactly as an absent `lifecycle` is, so revisions published
   * before this field existed re-derive their digests byte-for-byte.
   */
  readonly suggestedPipeline?: string;
  /**
   * Why the work exists as this node — the decomposition reasoning that
   * produced it. Portable durable text, refused at the schema rather than
   * trimmed; canonically omitted when absent.
   */
  readonly rationale?: string;
  /**
   * What the decomposer was unsure about when it proposed this node. Portable
   * durable text, refused at the schema rather than trimmed; canonically
   * omitted when absent.
   */
  readonly uncertainty?: string;
}

/**
 * A node whose Change exists and whose identity was verified against committed
 * Store evidence at publication. `changeAlias` is human convenience and is
 * never resolved by — resolution is by `changeInstanceId` only, and a test
 * asserts the exclusion rather than a comment claiming it.
 */
export interface ExecutionPlanChangeNode extends ExecutionPlanNodeBase {
  readonly kind: 'change';
  readonly changeInstanceId: ChangeInstanceId;
  readonly changeAlias?: string;
  /** Absent ≡ `required`; see `ExecutionPlanNodeLifecycle`. */
  readonly lifecycle?: ExecutionPlanNodeLifecycle;
  /** The recorded reason a `cancelled`/`superseded` node must carry. */
  readonly reason?: string;
}

/**
 * Work declared for one project on one line for which no Change exists yet.
 * Not a weaker `change` node with a missing field: ownership is explicit from
 * the first draft, which is what keeps "exactly one owner" true across the
 * whole lifecycle rather than only at the end.
 *
 * An intent node carries the required/optional half of the lifecycle
 * vocabulary: the decomposition's proposal lives ON the node the review
 * surface shows, not in a sidecar document. `cancelled`/`superseded` are
 * refused here — unwanted intent work is expressed by omitting the node from
 * the next revision, because there is no existed work for those values to
 * explain. An absent lifecycle reads `required` and is canonically omitted,
 * so intent revisions published before this field existed re-derive their
 * digests byte-for-byte.
 */
export interface ExecutionPlanIntentNode extends ExecutionPlanNodeBase {
  readonly kind: 'intent';
  readonly summary: string;
  /** Absent ≡ `required`; only `optional` is ever stored. */
  readonly lifecycle?: 'optional';
}

export type ExecutionPlanNode = ExecutionPlanChangeNode | ExecutionPlanIntentNode;

/**
 * `rasen/issues/<issueId>/plans/<revisionId>.yaml`, immutable once published.
 *
 * `contentSha256` covers the canonical serialization of every OTHER field, so
 * a hand-edited revision is detectable. It is reported as a mismatch, never
 * silently repaired or re-digested.
 */
export interface ExecutionPlanRevisionV1 {
  readonly version: 1;
  readonly issueId: IssueId;
  readonly revisionId: ExecutionPlanRevisionId;
  readonly supersedes: ExecutionPlanRevisionId | null;
  readonly createdAt: string;
  readonly contentSha256: Sha256Digest;
  readonly nodes: readonly ExecutionPlanNode[];
}

/** A revision as authored, before an ordinal and a digest are allocated. */
export interface ExecutionPlanDraft {
  readonly nodes: readonly ExecutionPlanNodeInput[];
}

// -----------------------------------------------------------------------------
// Acceptance content
// -----------------------------------------------------------------------------

/**
 * One acceptance condition: a stable identifier, the requirement statement,
 * and an optional note on how it was or will be verified. The MACHINE gate is
 * the derived node/health/problem state; the checklist's satisfaction is
 * attested by the act of accepting, frozen with the gate snapshot.
 */
export interface AcceptanceCondition {
  readonly id: string;
  readonly requirement: string;
  readonly verification?: string;
}

/** A condition as authored, before canonicalization. */
export interface AcceptanceConditionInput {
  readonly id: string;
  readonly requirement: string;
  readonly verification?: string;
}

/**
 * `rasen/issues/<issueId>/acceptance/<revisionId>.yaml`, immutable once
 * published — the same ordinal/digest/supersedes discipline an Execution Plan
 * revision follows, reused rather than rebuilt.
 */
export interface AcceptanceConditionsRevisionV1 {
  readonly version: 1;
  readonly issueId: IssueId;
  readonly revisionId: ExecutionPlanRevisionId;
  readonly supersedes: ExecutionPlanRevisionId | null;
  readonly createdAt: string;
  readonly contentSha256: Sha256Digest;
  readonly conditions: readonly AcceptanceCondition[];
}

/**
 * The gate facts an acceptance freezes: counts, the health value, and that no
 * status problem stood — portable facts only, no paths, no machine names
 * (design D7). A snapshot a different machine cannot read would be a defect in
 * a Store-level artifact.
 */
export interface AcceptanceGateSnapshot {
  readonly completed: number;
  readonly total: number;
  readonly health: string;
  readonly problemsStanding: number;
}

/**
 * `rasen/issues/<issueId>/accepted.yaml` — ONE record per Issue, never
 * rewritten. It freezes WHAT was accepted (the conditions revision id and that
 * revision's digest, so a later revision cannot change what the record says
 * was accepted), the gate snapshot at acceptance, an optional note, and its
 * own content digest.
 */
export interface IssueAcceptedRecordV1 {
  readonly version: 1;
  readonly issueId: IssueId;
  readonly acceptedAt: string;
  readonly conditionsRevisionId: ExecutionPlanRevisionId;
  readonly conditionsSha256: Sha256Digest;
  readonly gate: AcceptanceGateSnapshot;
  readonly note: string | null;
  readonly contentSha256: Sha256Digest;
}

export interface ExecutionPlanChangeNodeInput {
  readonly nodeId: string;
  readonly kind: 'change';
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeInstanceId: string;
  readonly changeAlias?: string;
  /** Authored lifecycle; validated against the closed vocabulary. */
  readonly lifecycle?: string;
  /** Authored reason; required for `cancelled`/`superseded`, portable-checked. */
  readonly reason?: string;
  readonly dependsOn?: readonly string[];
  /** Optional suggestion/rationale/uncertainty; see `ExecutionPlanNodeBase`. */
  readonly suggestedPipeline?: string;
  readonly rationale?: string;
  readonly uncertainty?: string;
}

export interface ExecutionPlanIntentNodeInput {
  readonly nodeId: string;
  readonly kind: 'intent';
  readonly projectId: string;
  readonly targetLineId: string;
  readonly summary: string;
  readonly dependsOn?: readonly string[];
  /** Authored lifecycle; `required`|`optional` only, validated semantically. */
  readonly lifecycle?: string;
  /** Optional suggestion/rationale/uncertainty; see `ExecutionPlanNodeBase`. */
  readonly suggestedPipeline?: string;
  readonly rationale?: string;
  readonly uncertainty?: string;
}

export type ExecutionPlanNodeInput =
  | ExecutionPlanChangeNodeInput
  | ExecutionPlanIntentNodeInput;

// -----------------------------------------------------------------------------
// Module inputs and results
// -----------------------------------------------------------------------------

export interface StoreIssueQuery {
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
}

export interface StoreIssueSelector extends StoreIssueQuery {
  readonly issueId: string;
}

export interface CreateIssueInput extends StoreIssueSelector {
  readonly title: string;
  /** Writes an optional narrative scaffold. Never parsed for facts. */
  readonly readme?: boolean;
}

export interface SetIssueStateInput extends StoreIssueSelector {
  readonly state: IssueState;
  readonly reason?: string;
}

/**
 * Whether a pipeline name is known to the pipeline registry — the SAME seam
 * `store issue start --pipeline` validates through (the CLI composes the
 * root-aware variant over the working directory's resolved root). Structural
 * duplicate of issue-execution's `IssuePipelineKnown`, declared locally so the
 * store module takes no upward dependency on the composition layer above it.
 */
export type IssuePlanPipelineKnown = (name: string) => boolean;

export interface PublishExecutionPlanInput extends StoreIssueSelector {
  readonly nodes: readonly ExecutionPlanNodeInput[];
  /**
   * Registry membership test for node `suggestedPipeline` values. When a node
   * carries a suggestion and no test was supplied, publication refuses rather
   * than storing a suggestion it could not check; the CLI injects the
   * root-aware variant on every source path.
   */
  readonly pipelineKnown?: IssuePlanPipelineKnown;
}

export interface PublishAcceptanceConditionsInput extends StoreIssueSelector {
  readonly conditions: readonly AcceptanceConditionInput[];
}

/**
 * The already-evaluated gate an acceptance is recorded under. The mutation
 * takes the snapshot as input and performs no run-state reads itself (design
 * D6: evaluate fresh, then write under the lock — the snapshot states the
 * facts the acceptance was made under, so the boundary is auditable).
 */
export interface AcceptIssueInput extends StoreIssueSelector {
  readonly conditionsRevisionId: string;
  readonly conditionsSha256: Sha256Digest;
  readonly gate: AcceptanceGateSnapshot;
  readonly note?: string;
}

/**
 * A commit suggestion. Issue content is Git-tracked Store content, so a write
 * prints the pathspec that would commit it and stages, commits, fetches, and
 * pushes nothing.
 */
export interface SuggestedIssueCommit {
  readonly repoRoot: string;
  readonly pathspecs: readonly string[];
  readonly message: string;
  readonly rationale: string;
}

export interface IssueWriteReport {
  readonly issueId: IssueId;
  readonly storeId: string;
  readonly storeUid: string;
  /** The checkout the write landed in — a local locator, never authority. */
  readonly checkoutRoot: string;
  /** The ref that checkout has out, when it has one. */
  readonly checkoutRef: string | null;
  /** Absolute paths written, as local locators. */
  readonly written: readonly string[];
  readonly suggestedCommits: readonly SuggestedIssueCommit[];
}

export interface IssueRecordResult extends IssueWriteReport {
  readonly record: IssueRecordV1;
}

export interface ExecutionPlanResult extends IssueWriteReport {
  readonly revision: ExecutionPlanRevisionV1;
}

export interface AcceptanceConditionsResult extends IssueWriteReport {
  readonly revision: AcceptanceConditionsRevisionV1;
}

export interface AcceptIssueResult extends IssueWriteReport {
  readonly record: IssueAcceptedRecordV1;
  /** The Issue's state after the mutation: `resolved` on both D5 write rows. */
  readonly state: IssueState;
}

/**
 * The Store-level Issue Module.
 *
 * Every method takes a Store and NEITHER a project nor a target line: an Issue
 * spans projects, so requiring one would contradict the resource. That is the
 * accepted design's §7 exception, made executable.
 */
export interface StoreIssues {
  create(input: CreateIssueInput): Promise<IssueRecordResult>;
  setState(input: SetIssueStateInput): Promise<IssueRecordResult>;
  publishPlan(input: PublishExecutionPlanInput): Promise<ExecutionPlanResult>;
  publishAcceptance(input: PublishAcceptanceConditionsInput): Promise<AcceptanceConditionsResult>;
  accept(input: AcceptIssueInput): Promise<AcceptIssueResult>;
}
