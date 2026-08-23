/**
 * `issue-execution-binding` — the launch-binding contracts.
 *
 * Starting an Issue's node is RESOLUTION AND VERIFICATION, never spawning:
 * `rasen store issue start` derives, from the plan revision, the Store's
 * membership and committed evidence, and the machine workspace index, the
 * verified launch contract — the working directory to launch from, the Store
 * planning root attached as context, the Change identity, and the pipeline to
 * run when one is known — and hands it to the operator or agent session that
 * will actually drive the pipeline from that directory.
 *
 * Like the status projection, everything here is DERIVED at read time and
 * persisted nowhere. There is no launch log and no Issue-side run pointer:
 * the plan revision's instance references, the Store's records, and the
 * workspace index ARE the binding, re-derived on every read.
 */
import type { IssueStatus } from '../issue-status/index.js';
import type { SessionLaunchContextResult } from '../management-api/session-launch-context.js';
import type { IssueDetail } from '../store/query/index.js';
import type { WorkspaceIndexEntry } from '../store/workspace/registry.js';

/** How the launch working directory was composed (design D4's two routes). */
export type IssueLaunchForm = 'workspace-pair' | 'project-checkout';

/** The working directory and attached context a launch contract emits. */
export interface IssueLaunchContext {
  readonly form: IssueLaunchForm;
  /** The directory the pipeline is launched from. */
  readonly cwd: string;
  /** Store-side planning roots attached as context (empty when cwd IS one). */
  readonly attachedRoots: readonly string[];
}

/**
 * What `start` is reporting for the addressed node:
 *
 *  - `fresh` — the node has not started; a full launch contract is emitted.
 *  - `already-running` — the node has begun; a resume-oriented contract is
 *    emitted (the pipeline and run-state location its run-state records).
 *  - `already-complete` — the node's work is complete; the node is REPORTED
 *    with no launch contract at all.
 */
export type IssueLaunchMode = 'fresh' | 'already-running' | 'already-complete';

/** The resolved launch contract for one Issue node. */
export interface IssueLaunchBinding {
  readonly issueId: string;
  readonly nodeId: string;
  readonly changeInstanceId: string;
  readonly alias: string | null;
  readonly projectId: string;
  readonly targetLineId: string;
  /**
   * Null exactly in `already-complete` mode: complete work gets a report, not
   * a launch. In `already-running` mode the launch orients a resume.
   */
  readonly launch: IssueLaunchContext | null;
  /**
   * The pipeline to run: for a fresh node, `--pipeline` when supplied
   * (validated), else the pipeline recorded in the addressed node's located
   * run-state, else the pipeline the plan revision records as the node's
   * suggestion — a suggestion is a proposal the operator's explicit choice
   * overrides without refusal. For an already-running node the recorded
   * pipeline leads exactly as before. Null in `already-complete` mode or when
   * none of the three sources supplies one — the contract then says the
   * pipeline is chosen at launch.
   */
  readonly pipeline: string | null;
  /**
   * Which source supplied `pipeline`: the operator's `--pipeline` (`operator`),
   * the located run-state's recording (`run-state`), or the plan revision's
   * suggestion (`suggestion`). Null exactly when `pipeline` is null — a
   * contract that names a pipeline names where it came from, so a suggestion
   * the operator overrode stays visible as the operator's deliberate choice.
   */
  readonly pipelineSource: 'operator' | 'run-state' | 'suggestion' | null;
  readonly mode: IssueLaunchMode;
  /** The run-state file the addressed node's observation was read from. */
  readonly runStatePath: string | null;
  /** Which locator found that run-state, on the projection's vocabulary. */
  readonly locatedBy: 'execution-root' | 'workspace-index' | null;
  /**
   * Why `launch` is null for an already-running node (a route failure is
   * carried, never swallowed). Null whenever `launch` is non-null or the mode
   * is `already-complete`.
   */
  readonly launchDiagnostic?: string;
}

/**
 * The closed refusal taxonomy for `rasen store issue start`. Every refusal
 * names what it refused on — candidates, blockers, the preparation command,
 * or the launch-context diagnostic — never a bare "no".
 */
export type IssueStartRefusalCode =
  /** The Issue has no readable published plan; planning precedes execution. */
  | 'issue_start_requires_plan'
  /** Several runnable nodes; the operator must choose with --node. */
  | 'issue_start_frontier_ambiguous'
  /** The addressed (or only possible) node cannot run now, and why. */
  | 'issue_start_node_not_runnable'
  /** --node names a cancelled node; the plan says its work is not wanted. */
  | 'issue_start_node_cancelled'
  /** --node names a superseded node; its reason names what replaced it. */
  | 'issue_start_node_superseded'
  /**
   * --node names a deferred node; the plan postponed its work beyond this
   * Issue. Its own code rather than a shared lifecycle refusal: postponed is
   * not abandoned, and the refusal points at re-publishing a revision whose
   * lifecycle wants the work, never at a side door around the plan.
   */
  | 'issue_start_node_deferred'
  /** Neither binding exists; the exact workspace preparation is named. */
  | 'issue_start_unprepared'
  /** The launch context could not be uniquely resolved; diagnostic carried. */
  | 'issue_start_launch_context_failed'
  /** --pipeline disagrees with the pipeline a running node records. */
  | 'issue_start_pipeline_conflict'
  /** --pipeline names no pipeline the registry knows. */
  | 'issue_start_pipeline_unknown';

/** One refusal, carrying everything that explains it. */
export interface IssueStartRefusal {
  readonly code: IssueStartRefusalCode;
  readonly message: string;
  /** Runnable candidates, for `issue_start_frontier_ambiguous`. */
  readonly candidates: readonly string[];
  /** Non-terminal dependencies, for `issue_start_node_not_runnable`. */
  readonly blockers: readonly string[];
  /**
   * The exact `rasen store workspace plan --existing-change …` line, for
   * `issue_start_unprepared`. Null for every other code.
   */
  readonly preparation: string | null;
  /**
   * The launch-context composition's own diagnostic (or the entry list behind
   * an ambiguous binding), passed through unchanged for
   * `issue_start_launch_context_failed`. Null for every other code.
   */
  readonly diagnostic: string | null;
}

/**
 * The session-launch composition seam: resolves the member-project checkout
 * binding for one project, exactly as a supervised session does. Production
 * wraps `resolveSessionLaunchContext({ space: 'store:<identity>', execution:
 * 'project:<id>' })` — the same composition the daemon performs, not a
 * reimplementation. Injectable so unit tests never touch a machine registry.
 */
export type IssueLaunchContextFor = (
  projectId: string
) => Promise<SessionLaunchContextResult>;

/**
 * Whether a pipeline name is known to the pipeline registry. Production
 * default (and the CLI's root-aware variant) read the frozen
 * pipeline-registry resolver's catalog; injected in tests.
 */
export type IssuePipelineKnown = (name: string) => boolean;

export interface ResolveIssueLaunchBindingInput {
  readonly detail: IssueDetail;
  /** The projection over the same detail — carries the per-node observations. */
  readonly status: IssueStatus;
  /**
   * Workspace index entries, already filtered to the resolved Store's uid by
   * the caller. Matched per node by `changeInstanceId`; several matching
   * entries for one instance are refused, never averaged.
   */
  readonly workspaceEntries: readonly WorkspaceIndexEntry[];
  /** The member-project checkout route (design D4 route 2). */
  readonly launchContextFor: IssueLaunchContextFor;
  /** `--pipeline`, validated against the pipeline registry when supplied. */
  readonly pipeline?: string;
  /**
   * Registry membership test for `--pipeline`. Omitted falls back to the
   * pipeline-registry resolver's package + user layers (cwd-independent,
   * machine-local — the same shape of default the status projection's
   * `workDirFor` takes); the CLI injects a root-aware variant.
   */
  readonly pipelineKnown?: IssuePipelineKnown;
  /** `--node`; omitted means the frontier is derived (design D3). */
  readonly nodeId?: string;
  /** Composes the exact preparation line (design D4 route 3). */
  readonly storeId?: string;
}

export type ResolveIssueLaunchBindingResult =
  | { ok: true; binding: IssueLaunchBinding }
  | { ok: false; refusal: IssueStartRefusal };

// -----------------------------------------------------------------------------
// The confirm composition (issue-autodecompose-review-flow D6)
// -----------------------------------------------------------------------------

/** One intent node the confirmed revision still carries, as confirm reports it. */
export interface IssueConfirmPendingChange {
  readonly nodeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly summary: string;
  /** The node's recorded suggestion, when the revision carries one. */
  readonly suggestedPipeline: string | null;
  /** The node's lifecycle as the revision records it (absent reads required). */
  readonly lifecycle: 'required' | 'optional';
}

/** A wanted change node that is not launchable now, as confirm reports it. */
export interface IssueConfirmWaitingNode {
  readonly nodeId: string;
  /** Why it waits, named with the same blocker facts a start refusal uses. */
  readonly reason: string;
}

/** A wanted change node whose deps complete but whose launch context failed. */
export interface IssueConfirmUnpreparedNode {
  readonly nodeId: string;
  readonly reason: string;
  /** The exact `rasen store workspace plan --existing-change …` line, when the failure was the unprepared state. */
  readonly preparation: string | null;
}

/**
 * The confirm report: the verified launch-contract set plus the pending work,
 * composed from one revision and WRITTEN NOWHERE. Starting a confirmed node
 * remains the operator's per-node act.
 */
export interface IssueConfirmReport {
  readonly issueId: string;
  readonly revisionId: string;
  /**
   * The launch contracts `store issue start --node <id>` would emit now, for
   * every wanted change node whose dependencies' work is complete — fresh
   * launches, resume-oriented contracts for already-running nodes, and the
   * report-only rows for already-complete ones.
   */
  readonly contracts: readonly IssueLaunchBinding[];
  /** Intent nodes the revision still carries — pending Change creation. */
  readonly pendingChanges: readonly IssueConfirmPendingChange[];
  /** Wanted change nodes awaiting dependency work, each with its reason. */
  readonly waiting: readonly IssueConfirmWaitingNode[];
  /** Wanted change nodes whose launch context did not resolve, with why. */
  readonly unprepared: readonly IssueConfirmUnpreparedNode[];
}

/** The closed refusal taxonomy for the confirm composition. */
export type IssueConfirmRefusalCode =
  /** No readable revision to compose from; planning precedes confirmation. */
  | 'issue_confirm_requires_plan'
  /**
   * A NAMED revision that did not read back on an Issue that HAS published
   * revisions — a distinct truth from having nothing to confirm: the operator
   * misaddressed an ordinal, and the advice is to read the range, not to
   * publish (review round-1 Minor-1).
   */
  | 'issue_confirm_revision_unreadable'
  /** A change node's instance did not verify against committed Store evidence. */
  | 'issue_confirm_reference_unresolved';

export interface IssueConfirmRefusal {
  readonly code: IssueConfirmRefusalCode;
  readonly message: string;
}

export interface ComposeIssueConfirmInput {
  readonly detail: IssueDetail;
  /** The projection over the same detail — carries the per-node observations. */
  readonly status: IssueStatus;
  readonly workspaceEntries: readonly WorkspaceIndexEntry[];
  readonly launchContextFor: IssueLaunchContextFor;
  /**
   * The revision the operator NAMED (`--revision`), when one was named. It is
   * what lets a null plan read as "that ordinal does not exist" rather than
   * "the Issue has no plan" on an Issue that has published revisions.
   */
  readonly requestedRevisionId?: string;
}

export type ComposeIssueConfirmResult =
  | { ok: true; report: IssueConfirmReport }
  | { ok: false; refusal: IssueConfirmRefusal };
