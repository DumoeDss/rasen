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
   * The pipeline to run: `--pipeline` when supplied (validated), else the
   * pipeline recorded in the addressed node's located run-state, else null —
   * the contract then says the pipeline is chosen at launch.
   */
  readonly pipeline: string | null;
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
