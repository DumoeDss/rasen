/**
 * `issue-status-projection` — the tri-axis status contracts.
 *
 * An Issue's status is three ORTHOGONAL answers, never one blended value:
 *
 *   - `phase` answers "where does the work stand" over the execution graph;
 *   - `health` answers "does anything need a human" from recorded signals;
 *   - `progress` answers "how much required work is complete".
 *
 * A failure, a blockage, or a wait is reported in `health` while `phase` keeps
 * describing where the work stands — a Change failing mid-run leaves the Issue
 * `active/failed`, never "in a failed phase".
 *
 * Every value here is DERIVED on read from three inputs (the latest immutable
 * Execution Plan revision, committed Store evidence, machine-local run-state)
 * and persisted nowhere: there is no second mutable truth beside the Issue
 * record, the plan revisions, and the run-state files. The closed vocabularies
 * ship complete; the projection emits a health value only when a recorded
 * signal supports it, so `blocked` and `stale` stay reserved until a future
 * capability records a real blockage or staleness signal.
 */
import type { IssueDetail, ResolvedExecutionPlan } from '../store/query/index.js';
import type { ExecutionPlanNodeLifecycle } from '../store/issues/types.js';
import type { WorkspaceIndexEntry } from '../store/workspace/registry.js';
import type {
  IssueAcceptanceFacts,
  IssueAcceptanceStatusBlock,
} from '../issue-acceptance/types.js';

/** Where the work stands. Precedence: `done > review > active > ready > planning`. */
export type IssuePhase = 'planning' | 'ready' | 'active' | 'review' | 'done';

/**
 * Whether anything needs a human. Precedence: `failed > waiting-human > healthy`
 * (plus `review` implies `waiting-human`). `blocked` and `stale` are reserved:
 * no durable signal exists for either today, and fabricating one would be the
 * dishonest version of this projection.
 */
export type IssueHealth =
  | 'healthy'
  | 'blocked'
  | 'failed'
  | 'waiting-human'
  | 'stale';

/**
 * What one plan node's execution looks like right now, from committed evidence
 * first and machine-local run-state second.
 *
 * `finalized` comes from committed Store evidence alone (an archived Change
 * with a committed outcome) and therefore holds even from a directory that
 * resolves no execution root. Every other terminal-or-active value comes from
 * the run-state the referenced Change recorded on this machine. `unknown` is
 * the fail-closed answer: an unresolved or ambiguous reference, or a run-state
 * file that exists but cannot be parsed.
 */
export type IssueNodeObservation =
  | 'finalized'
  | 'run-terminal'
  | 'in-flight'
  | 'failed'
  | 'waiting-human'
  | 'advanced'
  | 'not-started'
  | 'unknown';

/** Completed required nodes over total required nodes of the latest readable revision. */
export interface IssueProgress {
  readonly completed: number;
  readonly total: number;
}

/** Why a fact the projection could not derive is reported rather than guessed. */
export type IssueStatusProblemKind =
  /** The latest revision exists but fails its digest or parse. */
  | 'unreadable-plan'
  /** A change node's reference has no committed evidence anywhere searched. */
  | 'unresolved-reference'
  /** Several claimants for one change node's instance; none chosen. */
  | 'ambiguous-reference'
  /** A located run-state file exists but cannot be parsed. */
  | 'invalid-run-state'
  /**
   * A change node's archive record exists in v2 shape but fails validation —
   * damaged bytes (tampering or engine bug; archive accounting is
   * content-addressed). The node reports `unknown`, never a guessed outcome:
   * damaged bytes never release a dependency gate.
   */
  | 'invalid-archive-record'
  /** Acceptance content exists but does not read back (tampered or invalid). */
  | 'unreadable-acceptance'
  /** Store refs this read could not search — never evidence of absence. */
  | 'unsearched-refs';

/** Mirrors the aggregate-problem discipline: name the item, the source, the reason. */
export interface IssueStatusProblem {
  readonly kind: IssueStatusProblemKind;
  /** The node the problem belongs to; null when the problem is Issue-level. */
  readonly node: string | null;
  /** The Store ref or absolute file path the unreadable bytes came from, when known. */
  readonly ref: string | null;
  readonly reason: string;
}

/**
 * Which locator found a node's run-state (the widened visibility vocabulary):
 * the working directory's own execution-root chain, or the workspace index
 * entry recorded for the Change's instance — the second is what lets an Issue
 * read from the Store root or any unrelated directory still observe a member
 * project's recorded activity. Null when no run-state was located.
 */
export type IssueRunStateLocator = 'execution-root' | 'workspace-index';

/**
 * One durable session pointer a located run-state's stage records. Carries
 * ONLY durable facts — the session id, thread id, and transcript location
 * that stage's worker recorded. `agentId` is a live handle (a valid target
 * only within the session that spawned the worker) and is excluded by
 * construction: it is never read, so it can never be presented as durable.
 */
export interface IssueNodeSession {
  readonly stageId: string;
  readonly role: string | null;
  readonly runtime: string | null;
  readonly sessionId?: string;
  readonly threadId?: string;
  readonly transcript?: string;
}

/**
 * The facts that join a node's execution back to the Issue (attribution is
 * derived at read time and persisted nowhere):
 *
 *  - `pipeline` — the pipeline the located run-state records. Null when no
 *    run-state was located, and for a portfolio record (its shape carries no
 *    single parent pipeline — child pipelines belong to the children).
 *  - `sessions` — per-stage durable worker pointers. A portfolio record
 *    carries no stage workers, so portfolio-observed nodes report none —
 *    honestly, and without substituting the parent's own per-change record.
 *  - `evidenceLocator` — the Change's evidence directory when its planning
 *    address resolves (the current changes directory, or the store-side
 *    active-change address). Null when it does not — never a guess.
 */
export interface IssueNodeAttribution {
  readonly pipeline: string | null;
  readonly sessions: readonly IssueNodeSession[];
  readonly evidenceLocator: string | null;
}

/**
 * One dependency the work-complete rule still waits on. The nodeId, the
 * dependency's target project as the revision records it, and its observed
 * execution state at this read — the facts both the node line and `start`'s
 * refusals name a dependency wait with.
 */
export interface IssueNodeBlocker {
  readonly nodeId: string;
  readonly projectId: string;
  readonly observation: IssueNodeObservation;
}

/** One plan node, observed. */
export interface IssueNodeStatus {
  readonly nodeId: string;
  readonly kind: 'change' | 'intent';
  /**
   * The node's target project — the project the revision records as the target
   * of the node's work, copied from the plan node itself. Every node carries
   * it, so there is no absent case and no defaulting. It is a DISPLAY fact:
   * the projection derives no phase, health, or progress value from it — the
   * per-project grouping it feeds is `IssueStatus.projects` (the
   * issue-project-grouped-views delivery), which likewise drives no axis.
   */
  readonly projectId: string;
  /** The target line the same revision node records. Display fact, as above. */
  readonly targetLineId: string;
  /**
   * The node's lifecycle as the revision records it, with an absent field
   * read as `required` — the read view of the plan's spelling, for BOTH node
   * kinds: an intent node carries `required`/`optional` exactly as a Change
   * node does, and a non-`required` value is named on its node line the same
   * way. Never null — since intent nodes admitted the vocabulary, every node
   * of a readable revision reads a lifecycle.
   */
  readonly lifecycle: ExecutionPlanNodeLifecycle;
  /**
   * The recorded reason a `cancelled`/`superseded` node carries — shown beside
   * the gate's exclusion and on the node line. Null when none is recorded.
   */
  readonly reason: string | null;
  /**
   * The pipeline the revision's node suggests running for this work, copied
   * from the plan node verbatim. A DISPLAY fact exactly like the target
   * project: the projection derives no phase, health, or progress value from
   * it — it is what a reviewer reads, not a value the projection interprets.
   * Null when the node records no suggestion.
   */
  readonly suggestedPipeline: string | null;
  /**
   * The decomposition rationale the node records — why the work exists as
   * this node. Display fact, as above. Null when none is recorded.
   */
  readonly rationale: string | null;
  /**
   * The decomposition uncertainty the node records — what the decomposer was
   * unsure about. Display fact, as above. Null when none is recorded.
   */
  readonly uncertainty: string | null;
  /**
   * The Change alias the node was keyed by for run-state location: the
   * committed claimant's `changeId`, falling back to the node's recorded
   * `changeAlias`. A reference the query did not resolve reports only the
   * node's recorded alias — no claimant is chosen on its behalf. Null for
   * intent nodes (nothing to locate).
   */
  readonly alias: string | null;
  readonly observation: IssueNodeObservation;
  /**
   * Dependencies whose observed work is not complete, in declaration order —
   * the WORK-COMPLETE basis `store issue start` gates on, NOT the plan read's
   * archive-based list: a dependency whose work is terminal stops being listed
   * here even before its Change is archived, so the read surface explains
   * exactly what a launch will wait for. The store query's own
   * `blockedBy`/`readiness` stays archive-based (the acceptance truth
   * `readyToResolve` feeds on).
   */
  readonly blockedBy: readonly IssueNodeBlocker[];
  /** Present when the observation needs explaining: `unknown` reasons, invalid run-state. */
  readonly diagnostic: string | null;
  /** The run-state file the observation was read from, when one was. */
  readonly runStatePath: string | null;
  /** Which locator found `runStatePath`; null when nothing was located. */
  readonly locatedBy: IssueRunStateLocator | null;
  /** The attribution facts for this node (always present; facts are null/empty when unrecorded). */
  readonly attribution: IssueNodeAttribution;
}

/**
 * One member project's lane: the grouping view over a readable revision's
 * flat node list. The lane carries node IDS, never node copies — `nodes`
 * stays the single node truth and a lane is a grouping over it (consumers
 * find rows by `nodeId`, never by position). `progress` is the SAME pair the
 * Issue's own progress computes, scoped to the lane's required Change nodes —
 * one completion rule, two scopes — so per-project "what's left" can never
 * disagree with the node lines or the start gate. Lanes drive no axis.
 */
export interface IssueProjectLane {
  /** The project's identity — always the id, never the alias. */
  readonly projectId: string;
  /**
   * The display alias the caller supplied as input (the Store's own catalog
   * display name). Null when none resolves; the raw id is the fallback, never
   * a guess — grouping, gating, and progress key on the id regardless.
   */
  readonly alias: string | null;
  /** The lane's node ids, in the revision's canonical node order. */
  readonly nodeIds: readonly string[];
  /** Completed required Change nodes over total required Change nodes of the lane. */
  readonly progress: IssueProgress;
}

/**
 * Whether this read could see machine-local run-state at all, and where. An
 * Issue is Store content and readable from anywhere; its run-state is not —
 * so the answer labels the execution root it consulted, and says so plainly
 * when no execution root resolved from this working directory. Absence is
 * never presented as a failure.
 */
export type IssueRunStateVisibility =
  | { readonly kind: 'execution-root'; readonly executionRoot: string }
  | { readonly kind: 'none' };

// -----------------------------------------------------------------------------
// The ready set (issue-ready-set-scheduling D1/D5)
// -----------------------------------------------------------------------------

/**
 * One member of the ready set: a Change node the plan still wants whose
 * observed execution is `not-started` and whose every dependency's observed
 * work is complete — the exact set `store issue start` gates on and `confirm`
 * composes for. Carried with the facts a launch decision reads: identity,
 * target, alias, suggestion, lifecycle.
 */
export interface IssueReadyMember {
  readonly nodeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  /** The Change alias the projection keyed the node's run-state by. */
  readonly alias: string | null;
  /** The pipeline the revision suggests for this work; null when none recorded. */
  readonly suggestedPipeline: string | null;
  /** The member's lifecycle — `required` or `optional`; both are wanted work. */
  readonly lifecycle: ExecutionPlanNodeLifecycle;
}

/**
 * One blocker a blocked exit names: the dependency's node identifier, target
 * project, and observed state in the SAME refinement vocabulary the node line
 * renders (`issueBlockerState`) — "never started here" and "unreadable, here
 * is why" are named, never guessed.
 */
export interface IssueReadyBlocker {
  readonly nodeId: string;
  readonly projectId: string;
  readonly state: string;
}

/**
 * Why one node of the revision is NOT in the ready set — the closed exit-reason
 * vocabulary, each value derived from the node's own projection facts. No node
 * is silently dropped, and no reason names a state the projection did not
 * observe.
 */
export type IssueReadyExit =
  /** A `cancelled` node, with its recorded reason (null when none recorded). */
  | { readonly kind: 'cancelled'; readonly reason: string | null }
  /** A `superseded` node, with its recorded reason. */
  | { readonly kind: 'superseded'; readonly reason: string | null }
  /**
   * An intent node — no Change exists to run; pending Change creation, named
   * with its target project and target line.
   */
  | {
      readonly kind: 'pending-change-creation';
      readonly projectId: string;
      readonly targetLineId: string;
    }
  /**
   * A wanted node whose observation is `in-flight`, `advanced`, or
   * `waiting-human` — running; the observation is the reason, never its
   * dependency facts.
   */
  | { readonly kind: 'running'; readonly observation: 'in-flight' | 'advanced' | 'waiting-human' }
  /** A `failed` node. */
  | { readonly kind: 'failed' }
  /**
   * A node whose work is complete — `finalized` or `run-terminal`. `basis`
   * carries the node's diagnostic when one explains the completion (a legacy
   * archive record basis); null when none.
   */
  | { readonly kind: 'complete'; readonly basis: string | null }
  /**
   * A `not-started` node whose dependencies' observed work is not all
   * complete, naming each non-terminal dependency (cross-project blockers
   * included, with their projects).
   */
  | { readonly kind: 'blocked'; readonly blockers: readonly IssueReadyBlocker[] }
  /** An `unknown` node with its diagnostic — never a ready-set member. */
  | { readonly kind: 'unknown'; readonly diagnostic: string | null };

/** One non-member node paired with its exit reason. */
export interface IssueReadyExitEntry {
  readonly nodeId: string;
  readonly reason: IssueReadyExit;
}

/**
 * The deterministic ready set of one Issue's latest readable revision: the
 * members plus every non-member with its exit reason. Derived on read from the
 * status projection's own node facts alone, persisted nowhere — reading the
 * same Issue over unchanged evidence yields the same set. Null when the
 * revision did not read back: "no readable plan" and "nothing runnable" are
 * different truths, and an empty set would read as the second.
 */
export interface IssueReadySet {
  readonly members: readonly IssueReadyMember[];
  readonly exits: readonly IssueReadyExitEntry[];
}

// -----------------------------------------------------------------------------
// The revision delta (review-flow D5)
// -----------------------------------------------------------------------------

/** One node the latest revision retargeted, with both revisions' target facts. */
export interface IssueRevisionRetarget {
  readonly nodeId: string;
  readonly fromProjectId: string;
  readonly toProjectId: string;
  readonly fromTargetLineId: string;
  readonly toTargetLineId: string;
}

/** One node whose dependency edges changed between the two revisions. */
export interface IssueRevisionEdgeChange {
  readonly nodeId: string;
  readonly addedDependencies: readonly string[];
  readonly removedDependencies: readonly string[];
}

/** One node whose lifecycle changed, with both readings (absent reads required). */
export interface IssueRevisionLifecycleChange {
  readonly nodeId: string;
  readonly from: ExecutionPlanNodeLifecycle;
  readonly to: ExecutionPlanNodeLifecycle;
}

/** One node whose recorded suggestion changed (null = none recorded). */
export interface IssueRevisionSuggestionChange {
  readonly nodeId: string;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * The node-level delta of the latest readable revision against its
 * `supersedes` predecessor — DERIVED ON READ from the two revisions alone and
 * persisted nowhere, so a reviewer sees what a revision changed (a merge, a
 * split, a retarget) without diffing files. The delta drives no phase, health,
 * or progress value: it is a fact of the read surface, exactly like a node's
 * target project. Node-by-node over stable nodeIds — the nodeId-continuity
 * convention (a merged node may keep a constituent's id; a split mints new
 * ids) is what makes the delta read as the change it is.
 */
export interface IssueRevisionDelta {
  readonly revisionId: string;
  readonly supersedes: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly retargeted: readonly IssueRevisionRetarget[];
  readonly edgeChanges: readonly IssueRevisionEdgeChange[];
  readonly lifecycleChanges: readonly IssueRevisionLifecycleChange[];
  readonly suggestionChanges: readonly IssueRevisionSuggestionChange[];
}

/** The tri-axis answer, plus everything that explains it. */
export interface IssueStatus {
  readonly phase: IssuePhase;
  readonly health: IssueHealth;
  /**
   * Null when there is no latest readable revision to count over — including
   * an unreadable one, where a `0/0` pair would read "nothing required".
   */
  readonly progress: IssueProgress | null;
  readonly nodes: readonly IssueNodeStatus[];
  /**
   * The node-level delta of the latest readable revision against its
   * `supersedes` predecessor — added/removed/retargeted/re-edged nodes,
   * lifecycle changes, suggestion changes — derived on read, persisted
   * nowhere, driving no axis. Null when the latest revision supersedes
   * nothing (a first revision reports no delta section) or when the caller
   * supplied no readable predecessor for a superseding revision.
   */
  readonly delta: IssueRevisionDelta | null;
  /**
   * One lane per distinct target project the readable revision's nodes name,
   * in project-identity code-point order. Empty when there is no readable
   * revision — the same absence `progress: null` reports (empty lanes would
   * read "no projects", a different claim than "no readable revision").
   */
  readonly projects: readonly IssueProjectLane[];
  readonly problems: readonly IssueStatusProblem[];
  readonly runStateVisibility: IssueRunStateVisibility;
  /**
   * Carried from the underlying `IssueDetail` and lowered further by
   * projection-local failures to read what was reached (invalid run-state,
   * unreadable plan). Reported-but-honest answers (an unresolved reference)
   * do not lower it — the same split the aggregate query makes between an
   * unreadable item and a reported one.
   */
  readonly complete: boolean;
  /**
   * The acceptance block (design D2/D4): latest conditions revision, the gate
   * evaluated over THIS status, and the verified acceptance record. Null when
   * the caller supplied no acceptance facts — every pre-acceptance derivation
   * above is unchanged by that omission.
   */
  readonly acceptance: IssueAcceptanceStatusBlock | null;
}

/**
 * Design D2: the projection takes explicit inputs; the CLI resolves the
 * machine-local ones. Given the same inputs the result is identical — there
 * are no ambient reads inside the module.
 */
export interface ProjectIssueStatusInput {
  /** From `StoreAggregateQuery.showIssue` (or assembled around `resolveExecutionPlan`). */
  readonly detail: IssueDetail;
  /**
   * The execution root whose ephemera directory is searched FIRST for
   * run-state. Absent means run-state visibility is `none` on this machine.
   */
  readonly executionRoot?: string;
  /** The planning-home changes directory — the sticky-legacy chain's tail. */
  readonly changesDir?: string;
  /**
   * The Store's registered root (an absolute path). Enables the store-side
   * active-change address for evidence locators — where a member project's
   * Change planning content lives even when the read runs from an unrelated
   * directory. Omitted inputs reproduce C1 behavior exactly.
   */
  readonly storeRoot?: string;
  /**
   * Workspace index entries, ALREADY filtered to the resolved Store's uid by
   * the caller. Per change node, after the current-root chain finds nothing,
   * each matching entry's execution root is probed with its own chain (design
   * D6: ephemera first, then the entry's planning-side active-change address —
   * no legacy work-dir leg on index roots). Matching is by the node's
   * `changeInstanceId`; first hit wins.
   */
  readonly workspaceEntries?: readonly WorkspaceIndexEntry[];
  /**
   * Display aliases for member projects, keyed by project id — resolved by the
   * CLI from the Store's own project catalogs (the catalog display `id`), the
   * same display-only composition shape as the machine-local locators above.
   * A project with no entry here carries a null alias; identity stays the id.
   */
  readonly projectAliases?: Readonly<Record<string, string>>;
  /**
   * Resolves the legacy machine-home work directory for one alias. Defaults to
   * `resolveChangeWorkDir(executionRoot, alias, { ensure: false })` — the same
   * probe-only seam `pipeline resume` uses. Injectable so unit tests never
   * touch a real machine registry.
   */
  readonly workDirFor?: (alias: string) => Promise<string | null>;
  /**
   * The Issue's recorded acceptance, as one read found it — the fourth input
   * (design D4): the latest acceptance-conditions revision and the acceptance
   * record, both digest-verified by the reader. Omitted means the caller
   * asserts no acceptance facts; every pre-acceptance derivation is unchanged
   * by that omission, and `done` — which requires a verified record — stays
   * out of reach without one.
   */
  readonly acceptance?: IssueAcceptanceFacts;
  /**
   * The predecessor revision the latest revision's `supersedes` names, as one
   * read resolved it — the fifth input (review-flow D5), consumed ONLY by the
   * revision delta: when it carries a readable revision, the delta derives
   * node-by-node from the two revisions alone. Omitted or unreadable means no
   * delta section; no axis ever reads it, so its absence changes nothing else.
   */
  readonly predecessorPlan?: ResolvedExecutionPlan | null;
}
