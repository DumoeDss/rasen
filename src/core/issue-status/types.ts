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
import type { IssueDetail } from '../store/query/index.js';
import type { WorkspaceIndexEntry } from '../store/workspace/registry.js';

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

/** One plan node, observed. */
export interface IssueNodeStatus {
  readonly nodeId: string;
  readonly kind: 'change' | 'intent';
  /**
   * The Change alias the node was keyed by for run-state location: the
   * committed claimant's `changeId`, falling back to the node's recorded
   * `changeAlias`. A reference the query did not resolve reports only the
   * node's recorded alias — no claimant is chosen on its behalf. Null for
   * intent nodes (nothing to locate).
   */
  readonly alias: string | null;
  readonly observation: IssueNodeObservation;
  /** Dependencies that are not yet finalized, in declaration order (from the plan read). */
  readonly blockedBy: readonly string[];
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
 * Whether this read could see machine-local run-state at all, and where. An
 * Issue is Store content and readable from anywhere; its run-state is not —
 * so the answer labels the execution root it consulted, and says so plainly
 * when no execution root resolved from this working directory. Absence is
 * never presented as a failure.
 */
export type IssueRunStateVisibility =
  | { readonly kind: 'execution-root'; readonly executionRoot: string }
  | { readonly kind: 'none' };

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
   * Resolves the legacy machine-home work directory for one alias. Defaults to
   * `resolveChangeWorkDir(executionRoot, alias, { ensure: false })` — the same
   * probe-only seam `pipeline resume` uses. Injectable so unit tests never
   * touch a real machine registry.
   */
  readonly workDirFor?: (alias: string) => Promise<string | null>;
}
