/**
 * `issue-status-projection` — deriving an Issue's tri-axis status.
 *
 * The projection composes the worlds the Store query keeps apart on purpose:
 * the Store's committed evidence (portable, authoritative), machine-local
 * run-state (ephemeral, keyed by change alias, on whatever root executed the
 * work), and — since issue-acceptance-close — the Issue's recorded acceptance
 * (conditions revisions and the acceptance record, supplied as verified facts
 * by the caller's one reader). `store-aggregate-query`'s contract is
 * store-pure, so this module — not the query — is where they meet. It imports
 * and never modifies the pipeline-registry run-state readers, mirroring
 * `pipeline resume`'s location recipe exactly so the projection and resume
 * can never disagree about where a Change's state lives.
 *
 * Read-only by construction: no write call exists here (asserted by
 * `test/core/issue-status/issue-status-read-only-guard.test.ts`), and reading
 * the same Issue over unchanged evidence yields the same status. Where a
 * recorded run-state declares `engine.effective: 'reconciler'`, its stage
 * statuses are labeled projections beside a canonical Run; this projection
 * reports them as recorded — they are the observable contract it owns — while
 * canonical-Run-derived status belongs to the execution-binding work (g-002).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveChangeWorkDir } from '../change-work.js';
import { ephemeraDir, evidenceDir } from '../file-placement.js';
import {
  readRunStateDetailed,
  runStatePath,
  stateFileSearchChain,
  type RunState,
  type StateFileLocationOptions,
} from '../pipeline-registry/run-state.js';
import {
  isPortfolioComplete,
  portfolioStatePath,
  readPortfolioStateDetailed,
  type PortfolioState,
} from '../pipeline-registry/portfolio-state.js';
import type { IssueDetail, ResolvedPlanNode } from '../store/query/index.js';
import type {
  ExecutionPlanNode,
  ExecutionPlanRevisionV1,
} from '../store/issues/types.js';
import { resolveStorePlanningLayoutV2Path } from '../store/planning-layout-v2.js';
import type { WorkspaceIndexEntry } from '../store/workspace/registry.js';
// The one runtime edge into the acceptance module: the projection fills the
// `status.acceptance` block's gate from the SAME derivation this read just
// performed. `gate.js` imports no runtime symbol back, so the edge stays
// one-directional at load time and `store/issues` gains nothing upward.
import { evaluateIssueAcceptanceGate } from '../issue-acceptance/gate.js';
import type {
  IssueAcceptanceFacts,
  IssueAcceptanceStatusBlock,
} from '../issue-acceptance/types.js';
import type {
  IssueHealth,
  IssueNodeAttribution,
  IssueNodeObservation,
  IssueNodeSession,
  IssueNodeStatus,
  IssuePhase,
  IssueProgress,
  IssueProjectLane,
  IssueRevisionDelta,
  IssueRevisionEdgeChange,
  IssueRevisionLifecycleChange,
  IssueRevisionRetarget,
  IssueRevisionSuggestionChange,
  IssueRunStateLocator,
  IssueStatus,
  IssueStatusProblem,
  ProjectIssueStatusInput,
} from './types.js';

/** Where a state file resolved from, along the sticky-legacy chain. */
interface LocatedStateFile {
  readonly dir: string;
  readonly path: string;
}

/**
 * An observed node before the plan's lifecycle is resolved onto it. The
 * observation branches stay lifecycle-unaware; `withLifecycle` at the one
 * assembly point adds the fields, so no branch can spell the default
 * differently or forget it. `blockedBy` is absent here too: the displayed
 * dependency facts are derived once, in the `withBlockerFacts` post-pass over
 * the statuses this build produced — no branch copies the plan read's
 * archive-based list, and no second writer exists.
 */
type ObservedNode = Omit<
  IssueNodeStatus,
  | 'lifecycle'
  | 'reason'
  | 'projectId'
  | 'targetLineId'
  | 'suggestedPipeline'
  | 'rationale'
  | 'uncertainty'
  | 'blockedBy'
>;

/** The assembled node before the dependency-facts post-pass completes it. */
type NodeSansBlockers = Omit<IssueNodeStatus, 'blockedBy'>;

function locateInChain(
  chain: readonly string[],
  fileName: (dir: string) => string
): LocatedStateFile | null {
  for (const dir of chain) {
    const candidate = fileName(dir);
    if (fs.existsSync(candidate)) return { dir, path: candidate };
  }
  return null;
}

/**
 * The Change alias a node is keyed by: the committed claimant's `changeId`,
 * falling back to the node's recorded `changeAlias`. The committed evidence's
 * alias is preferred because `changeAlias` on the node is recorded human
 * convenience — the same reasoning the reference resolution applies. A
 * reference the query did not resolve presents ONLY the node's recorded alias:
 * its claimants are exactly what the query refuses to choose among, and
 * presenting `claimants[0]` here would repeat that choice one layer up. Null
 * for intent nodes.
 */
function aliasFor(resolved: ResolvedPlanNode): string | null {
  if (resolved.node.kind !== 'change') return null;
  if (resolved.resolution.status !== 'resolved') {
    return resolved.node.changeAlias ?? null;
  }
  return resolved.resolution.claimants[0]?.changeId ?? resolved.node.changeAlias ?? null;
}

async function workDirFor(input: ProjectIssueStatusInput, alias: string): Promise<string | null> {
  if (input.workDirFor !== undefined) return input.workDirFor(alias);
  if (input.executionRoot === undefined) return null;
  return resolveChangeWorkDir(input.executionRoot, alias, { ensure: false });
}

const NO_SESSIONS: readonly IssueNodeSession[] = [];

/**
 * The durable session pointers a run-state's stages record (design D7).
 * `agentId` is a live handle and is excluded by construction — it is never
 * read, so it can never be presented as durable. A worker that recorded no
 * durable pointer (a bare string label, or a structured record with none of
 * session id / thread id / transcript) contributes no session fact: none is
 * synthesized.
 */
function sessionsFromStages(state: RunState): readonly IssueNodeSession[] {
  const sessions: IssueNodeSession[] = [];
  for (const [stageId, stage] of Object.entries(state.stages ?? {})) {
    const worker = stage.worker;
    if (typeof worker !== 'object' || worker === null) continue;
    const sessionId = typeof worker.sessionId === 'string' ? worker.sessionId : undefined;
    const threadId = typeof worker.threadId === 'string' ? worker.threadId : undefined;
    const transcript = typeof worker.transcript === 'string' ? worker.transcript : undefined;
    if (sessionId === undefined && threadId === undefined && transcript === undefined) {
      continue;
    }
    sessions.push({
      stageId,
      role: typeof worker.role === 'string' ? worker.role : null,
      runtime: typeof worker.runtime === 'string' ? worker.runtime : null,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(threadId === undefined ? {} : { threadId }),
      ...(transcript === undefined ? {} : { transcript }),
    });
  }
  return sessions;
}

/**
 * The Change's evidence directory when its planning address resolves (design
 * D7): the current planning-home changes directory first, then the store-side
 * active-change address computed from `storeRoot` and the committed
 * claimant's ids. Both legs are explicit inputs — no ambient reads — and a
 * relative `storeRoot` would make `resolveStorePlanningLayoutV2Path` produce
 * a cwd-dependent path, so it is treated as absent.
 */
function evidenceLocatorFor(
  resolved: ResolvedPlanNode,
  input: ProjectIssueStatusInput
): string | null {
  if (resolved.node.kind !== 'change' || resolved.resolution.status !== 'resolved') {
    return null;
  }
  const claimant = resolved.resolution.claimants[0];
  if (claimant === undefined) return null;
  if (input.changesDir !== undefined && path.isAbsolute(input.changesDir)) {
    const local = path.join(input.changesDir, claimant.changeId);
    if (fs.existsSync(local)) return evidenceDir(local);
  }
  if (input.storeRoot !== undefined && path.isAbsolute(input.storeRoot)) {
    try {
      const addressed = resolveStorePlanningLayoutV2Path(input.storeRoot, {
        kind: 'active-change',
        projectId: claimant.projectId,
        changeId: claimant.changeId,
      });
      if (fs.existsSync(addressed)) return evidenceDir(addressed);
    } catch {
      // An address that does not validate names no directory: no locator.
    }
  }
  return null;
}

/**
 * The index-root probe chain (design D6): for each entry matching the node's
 * Change instance, that entry's execution root probed with its OWN chain —
 * its ephemera directory keyed by the node's alias, then the entry's
 * planning-side active-change address computed from the entry's own recorded
 * ids. The legacy machine-home work-dir leg applies ONLY to the current
 * execution root: it is keyed to that root's identity, not to an index root.
 * An entry whose recorded address does not validate contributes no planning
 * leg; its ephemera leg still probes.
 */
function indexChainFor(
  entries: readonly WorkspaceIndexEntry[],
  changeInstanceId: string,
  alias: string
): readonly string[] {
  const chain: string[] = [];
  for (const entry of entries) {
    if (entry.changeInstanceId !== changeInstanceId) continue;
    chain.push(ephemeraDir(entry.execution.root, alias));
    try {
      chain.push(
        resolveStorePlanningLayoutV2Path(entry.planning.root, {
          kind: 'active-change',
          projectId: entry.projectId,
          changeId: entry.changeId,
        })
      );
    } catch {
      // The entry's planning side does not address a change directory; the
      // ephemera leg above still probes this entry's execution root.
    }
  }
  return chain;
}

/**
 * Reads a located state file into a node status. Portfolio records carry no
 * parent pipeline and no stage workers, so their attribution is honestly
 * empty (design D7); a per-change record contributes its pipeline and its
 * stages' durable pointers. Returns null for the vanished-between-reads race
 * both readers report as `absent` after a locate, so the caller falls through
 * to the next probe rather than asserting either way.
 */
function nodeFromLocated(
  resolved: ResolvedPlanNode,
  alias: string,
  record: 'portfolio' | 'run',
  at: LocatedStateFile,
  locatedBy: IssueRunStateLocator,
  evidenceLocator: string | null,
  problems: IssueStatusProblem[]
): ObservedNode | null {
  const nodeId = resolved.node.nodeId;
  if (record === 'portfolio') {
    const read = readPortfolioStateDetailed(at.dir);
    if (read.kind === 'invalid') {
      problems.push({
        kind: 'invalid-run-state',
        node: nodeId,
        ref: at.path,
        reason: read.reason,
      });
      return {
        nodeId,
        kind: 'change',
        alias,
        observation: 'unknown',
        diagnostic: read.reason,
        runStatePath: at.path,
        locatedBy,
        attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator },
      };
    }
    if (read.kind === 'ok') {
      return {
        nodeId,
        kind: 'change',
        alias,
        observation: observePortfolio(read.state),
        diagnostic: null,
        runStatePath: at.path,
        locatedBy,
        attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator },
      };
    }
    return null;
  }
  const read = readRunStateDetailed(at.dir);
  if (read.kind === 'invalid') {
    problems.push({
      kind: 'invalid-run-state',
      node: nodeId,
      ref: at.path,
      reason: read.reason,
    });
    return {
      nodeId,
      kind: 'change',
      alias,
      observation: 'unknown',
      diagnostic: read.reason,
      runStatePath: at.path,
      locatedBy,
      attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator },
    };
  }
  if (read.kind === 'ok') {
    return {
      nodeId,
      kind: 'change',
      alias,
      observation: observeAutoRun(read.state),
      diagnostic: null,
      runStatePath: at.path,
      locatedBy,
      attribution: {
        pipeline: read.state.pipeline,
        sessions: sessionsFromStages(read.state),
        evidenceLocator,
      },
    };
  }
  return null;
}

/**
 * The observation mapping for a per-change `auto-run.json`.
 *
 * Design D4's table enumerates signal → observation; where one run records
 * several signals at once, the escalation signals surface over activity
 * (`waiting-human` over `in-flight`), because design D5's health precedence
 * exists to carry exactly those signals and an `in_progress` stage of the
 * same run must not mask them. Terminality follows the documented run-state
 * contract: `done | skipped` complete a stage; `delegated` is parent-stage
 * ownership transfer and appears in no child stage list.
 */
function observeAutoRun(state: RunState): IssueNodeObservation {
  const stages = state.stages === undefined ? [] : Object.values(state.stages);
  if (stages.some(stage => stage.status === 'escalated')) return 'waiting-human';
  if (stages.some(stage => stage.status === 'in_progress')) return 'in-flight';
  if (stages.length > 0 && stages.every(stage => stage.status === 'done' || stage.status === 'skipped')) {
    return 'run-terminal';
  }
  if (stages.some(stage => stage.status === 'done' || stage.status === 'skipped')) {
    return 'advanced';
  }
  // The legacy `completed[]` convenience form carries no per-stage status and
  // no stage universe, so terminality is not derivable from it — some
  // completed work is the honest ceiling.
  if (state.stages === undefined && (state.completed ?? []).length > 0) return 'advanced';
  // A run-state whose stages have never left `pending` records no progression
  // signal at all: it is distinguishable from an absent file only by the
  // `runStatePath` the node status carries.
  return 'not-started';
}

/**
 * The observation mapping for a decomposed parent's `portfolio-run.json`.
 * Child/delivery escalation is the run-state writer's documented FAILURE
 * signal, so it wins over siblings still running. Delivery shares the child
 * lifecycle, so a one-time parent delivery that is still running keeps the
 * portfolio in flight. Terminality is the portfolio module's own contract
 * (`isPortfolioComplete`), never re-derived here.
 */
function observePortfolio(state: PortfolioState): IssueNodeObservation {
  if (
    state.children.some(child => child.status === 'escalated') ||
    state.delivery.status === 'escalated'
  ) {
    return 'failed';
  }
  if (
    state.children.some(child => child.status === 'in_progress') ||
    state.delivery.status === 'in_progress'
  ) {
    return 'in-flight';
  }
  if (isPortfolioComplete(state)) return 'run-terminal';
  if (state.children.some(child => child.status === 'done' || child.status === 'skipped')) {
    return 'advanced';
  }
  return 'not-started';
}

async function observeNode(
  resolved: ResolvedPlanNode,
  input: ProjectIssueStatusInput,
  problems: IssueStatusProblem[]
): Promise<ObservedNode> {
  const node = resolved.node;

  if (node.kind === 'intent') {
    return {
      nodeId: node.nodeId,
      kind: 'intent',
      alias: null,
      observation: 'not-started',
      diagnostic: null,
      runStatePath: null,
      locatedBy: null,
      attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator: null },
    };
  }

  // The reference's status gates the committed-evidence branch below: a
  // scope-conflicted reference still carries its committed evidence (the
  // archive of a Change whose identity moved to another project or line after
  // publication — exactly the state the query reports as `ambiguous` while
  // keeping `archived` and the outcome), and reporting that node `finalized`
  // would drop the conflict the query deliberately surfaced instead of
  // choosing. It falls to the unknown + problem path like every other
  // unresolved reference.
  if (resolved.resolution.status !== 'resolved') {
    const reason =
      resolved.resolution.status === 'ambiguous'
        ? `reference ${node.changeInstanceId} is ambiguous: ` +
          `${resolved.resolution.claimants.length} claimants, none chosen`
        : `reference ${node.changeInstanceId} has no committed Store evidence ` +
          `(${resolved.resolution.status})`;
    problems.push({
      kind:
        resolved.resolution.status === 'ambiguous' ? 'ambiguous-reference' : 'unresolved-reference',
      node: node.nodeId,
      ref: null,
      reason,
    });
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: aliasFor(resolved),
      observation: 'unknown',
      diagnostic: reason,
      runStatePath: null,
      locatedBy: null,
      attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator: null },
    };
  }

  // Committed evidence before machine-local run-state (design D4): an archived
  // Change with a committed outcome is finalized regardless of what any
  // machine-local run-state says, which is why this holds even from a
  // directory that resolves no execution root. Since
  // issue-ready-set-scheduling D3/D4, the finalized branch reads the archive
  // record's BASIS, not just the outcome column:
  //
  //   - `invalid` — v2-shaped bytes that failed validation are damaged
  //     evidence, never a legacy truth: the node reports `unknown` with an
  //     `invalid-archive-record` problem naming the file and the reason, and
  //     no gate the node holds may open on unreadable bytes.
  //   - `legacy` — an archived entry with no v2 outcome record where none was
  //     ever written is committed evidence the work story CLOSED. Reading it
  //     complete invents no outcome value (the four-outcome model's
  //     no-inference stance governs the OUTCOME column, not the archive
  //     fact), so the node finalizes with the basis named in its diagnostic —
  //     work delivered before v2 records existed stops reading fresh forever.
  //   - `v2` — the outcome-bearing record, exactly as before.
  //
  // A resolution that predates the basis field (absent) keeps the pre-ruling
  // behavior: finalized only on a committed outcome, the run-state path
  // otherwise.
  if (resolved.resolution.archived && resolved.resolution.outcomeBasis === 'invalid') {
    const reason =
      resolved.resolution.outcomeBasisReason ?? 'the record failed v2 validation';
    problems.push({
      kind: 'invalid-archive-record',
      node: node.nodeId,
      ref: resolved.resolution.outcomeBasisPath ?? null,
      reason,
    });
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: aliasFor(resolved),
      observation: 'unknown',
      diagnostic: `archive record does not validate: ${reason}`,
      runStatePath: null,
      locatedBy: null,
      attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator: null },
    };
  }
  if (
    resolved.resolution.archived &&
    (resolved.resolution.outcome !== null || resolved.resolution.outcomeBasis === 'legacy')
  ) {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: aliasFor(resolved),
      observation: 'finalized',
      diagnostic:
        resolved.resolution.outcome === null && resolved.resolution.outcomeBasis === 'legacy'
          ? 'finalized on a legacy archive record (no v2 outcome was ever recorded)'
          : null,
      runStatePath: null,
      locatedBy: null,
      attribution: {
        pipeline: null,
        sessions: NO_SESSIONS,
        evidenceLocator: evidenceLocatorFor(resolved, input),
      },
    };
  }

  const alias = aliasFor(resolved);
  if (alias === null) {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: null,
      observation: 'not-started',
      diagnostic: 'no change alias available to locate run-state',
      runStatePath: null,
      locatedBy: null,
      attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator: null },
    };
  }

  const evidenceLocator = evidenceLocatorFor(resolved, input);

  // The same sticky-legacy chain `pipeline resume` searches: the execution
  // root's ephemera directory first, then the legacy machine-home work
  // directory, then the planning change directory. Lookup is by this node's
  // explicit alias — no directory pattern matching.
  const options: StateFileLocationOptions = {
    ...(input.executionRoot === undefined
      ? {}
      : { ephemeraDir: ephemeraDir(input.executionRoot, alias) }),
    workDir: await workDirFor(input, alias),
  };
  // A non-absolute changes directory — including the `''` a store-aggregate
  // root reports — would make `path.join` produce a bare relative tail, and a
  // relative tail is an ambient read against `process.cwd()`, which this
  // module forbids. It is treated as absent: with no planning changes
  // directory the chain is simply the two root-owned locations.
  // `stateFileSearchChain` remains the ordering authority whenever the full
  // chain is expressible.
  const changeDir =
    input.changesDir !== undefined && path.isAbsolute(input.changesDir)
      ? path.join(input.changesDir, alias)
      : null;
  const chain =
    changeDir === null
      ? [
          ...(options.ephemeraDir === undefined || options.ephemeraDir === null ? [] : [options.ephemeraDir]),
          ...(options.workDir === undefined || options.workDir === null ? [] : [options.workDir]),
        ]
      : stateFileSearchChain(changeDir, options);

  // A located portfolio record is AUTHORITATIVE for this node's progression —
  // the same rule resume applies. A present-but-invalid one is reported, never
  // fallen back from: falling back to auto-run.json would answer a different
  // orchestration model than the one this Change actually ran.
  const portfolioAt = locateInChain(chain, portfolioStatePath);
  if (portfolioAt !== null) {
    // `absent` after a locate means the file vanished between the two reads;
    // the helper's null falls through to the per-change record rather than
    // asserting either way.
    const observed = nodeFromLocated(
      resolved,
      alias,
      'portfolio',
      portfolioAt,
      'execution-root',
      evidenceLocator,
      problems
    );
    if (observed !== null) return observed;
  }

  const runAt = locateInChain(chain, runStatePath);
  if (runAt !== null) {
    const observed = nodeFromLocated(
      resolved,
      alias,
      'run',
      runAt,
      'execution-root',
      evidenceLocator,
      problems
    );
    if (observed !== null) return observed;
  }
  // Design D6 — the widened locator: after the working directory's own
  // execution-root chain finds nothing, each matching index entry's execution
  // root is probed with its own chain. This is what lets an Issue read from
  // the Store root or any unrelated directory still observe a member
  // project's recorded activity, and the node labels the workspace index as
  // the locator that found it. The same portfolio-authoritative rule and the
  // same per-dir order apply on the index chain.
  if (input.workspaceEntries !== undefined) {
    const indexChain = indexChainFor(input.workspaceEntries, node.changeInstanceId, alias);
    if (indexChain.length > 0) {
      const portfolioAtIndex = locateInChain(indexChain, portfolioStatePath);
      if (portfolioAtIndex !== null) {
        const observed = nodeFromLocated(
          resolved,
          alias,
          'portfolio',
          portfolioAtIndex,
          'workspace-index',
          evidenceLocator,
          problems
        );
        if (observed !== null) return observed;
      }
      const runAtIndex = locateInChain(indexChain, runStatePath);
      if (runAtIndex !== null) {
        const observed = nodeFromLocated(
          resolved,
          alias,
          'run',
          runAtIndex,
          'workspace-index',
          evidenceLocator,
          problems
        );
        if (observed !== null) return observed;
      }
    }
  }

  return {
    nodeId: node.nodeId,
    kind: 'change',
    alias,
    observation: 'not-started',
    diagnostic: null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: NO_SESSIONS, evidenceLocator },
  };
}

/**
 * The projection's work-complete test — the same pair `store issue start`
 * gates on. `undefined` (no row at all) is not terminal: fail-closed, exactly
 * like the gate.
 */
function isTerminal(observation: IssueNodeObservation | undefined): boolean {
  return observation === 'finalized' || observation === 'run-terminal';
}

/**
 * Whether a change node's lifecycle still wants its work: `required` (the
 * absent default) or `optional`. `cancelled`/`superseded` are OUTSIDE the
 * execution graph — their recorded activity or staleness drives no phase and
 * no health value, though their observations stay on their node lines.
 */
function isWanted(node: IssueNodeStatus): boolean {
  return node.kind === 'change' && (node.lifecycle === 'required' || node.lifecycle === 'optional');
}

/** Whether a change node's work is demanded: exactly a `required` lifecycle. */
function isRequired(node: IssueNodeStatus): boolean {
  return node.kind === 'change' && node.lifecycle === 'required';
}

/**
 * The progress pair — the ONE rule, parameterized by scope: completed required
 * nodes over total required nodes of whatever selection it is handed. The
 * Issue-level pair and every per-project lane pair call this same function
 * (design D2 of issue-project-grouped-views: a per-project "what's left" that
 * disagreed with the node lines or the start gate would be a third basis, and
 * the whole point of the basis unification was that there is one). Optional,
 * cancelled, and superseded completions count nowhere, and neither do intent
 * nodes: `isRequired`'s change-kind conjunct is what excludes them — intent
 * nodes DO carry `required`|`optional` since issue-autodecompose-review-flow
 * (absent reads `required`), while `cancelled`/`superseded` stay
 * Change-node-only. Finished-but-unarchived still counts:
 * progress measures work, not archiving.
 */
function progressOver(nodes: readonly IssueNodeStatus[]): IssueProgress {
  const required = nodes.filter(isRequired);
  return {
    completed: required.filter(node => isTerminal(node.observation)).length,
    total: required.length,
  };
}

/**
 * The per-project lanes (design D1): a post-pass over the built node
 * statuses, one lane per distinct node `projectId`, in project-identity
 * code-point order, each listing its node ids in the revision's canonical
 * node order — `nodes` is built in that order, so iteration order is the lane
 * order. A lane exists only for a project the revision's nodes actually name.
 * Called only for a readable revision; an unreadable one reports no lanes at
 * all (never empty ones — the no-progress rule's reasoning, one level down).
 */
function deriveProjectLanes(
  nodes: readonly IssueNodeStatus[],
  aliases: Readonly<Record<string, string>> | undefined
): readonly IssueProjectLane[] {
  const byProject = new Map<string, IssueNodeStatus[]>();
  for (const node of nodes) {
    const lane = byProject.get(node.projectId);
    if (lane === undefined) byProject.set(node.projectId, [node]);
    else lane.push(node);
  }
  return [...byProject.keys()]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map(projectId => {
      const laneNodes = byProject.get(projectId) as readonly IssueNodeStatus[];
      return {
        projectId,
        alias: aliases?.[projectId] ?? null,
        nodeIds: laneNodes.map(node => node.nodeId),
        progress: progressOver(laneNodes),
      };
    });
}

/**
 * The node-level delta of one revision against the predecessor it supersedes
 * (review-flow D5): added and removed nodes, retargets, dependency-edge
 * changes, lifecycle changes, and suggestion changes — derived on read from
 * the two revisions alone, persisted nowhere, driving no axis. Node-by-node
 * over stable nodeIds, so the nodeId-continuity convention (a merged node may
 * keep a constituent's id; a split mints new ids and re-edges dependents) is
 * what makes a structural revision read as the change it is rather than as a
 * wholesale rewrite.
 */
export function deriveRevisionDelta(
  revision: ExecutionPlanRevisionV1,
  predecessor: ExecutionPlanRevisionV1
): IssueRevisionDelta {
  const current = new Map(revision.nodes.map(node => [node.nodeId, node] as const));
  const before = new Map(predecessor.nodes.map(node => [node.nodeId, node] as const));

  const codePointOrder = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  const added = [...current.keys()].filter(id => !before.has(id)).sort(codePointOrder);
  const removed = [...before.keys()].filter(id => !current.has(id)).sort(codePointOrder);

  const retargeted: IssueRevisionRetarget[] = [];
  const edgeChanges: IssueRevisionEdgeChange[] = [];
  const lifecycleChanges: IssueRevisionLifecycleChange[] = [];
  const suggestionChanges: IssueRevisionSuggestionChange[] = [];
  for (const nodeId of [...current.keys()].filter(id => before.has(id)).sort(codePointOrder)) {
    const now = current.get(nodeId) as ExecutionPlanNode;
    const then = before.get(nodeId) as ExecutionPlanNode;
    if (now.projectId !== then.projectId || now.targetLineId !== then.targetLineId) {
      retargeted.push({
        nodeId,
        fromProjectId: then.projectId,
        toProjectId: now.projectId,
        fromTargetLineId: then.targetLineId,
        toTargetLineId: now.targetLineId,
      });
    }
    const addedDependencies = now.dependsOn.filter(dep => !then.dependsOn.includes(dep));
    const removedDependencies = then.dependsOn.filter(dep => !now.dependsOn.includes(dep));
    if (addedDependencies.length > 0 || removedDependencies.length > 0) {
      edgeChanges.push({
        nodeId,
        addedDependencies: [...addedDependencies].sort(codePointOrder),
        removedDependencies: [...removedDependencies].sort(codePointOrder),
      });
    }
    const fromLifecycle = then.lifecycle ?? 'required';
    const toLifecycle = now.lifecycle ?? 'required';
    if (fromLifecycle !== toLifecycle) {
      lifecycleChanges.push({ nodeId, from: fromLifecycle, to: toLifecycle });
    }
    const fromSuggestion = then.suggestedPipeline ?? null;
    const toSuggestion = now.suggestedPipeline ?? null;
    if (fromSuggestion !== toSuggestion) {
      suggestionChanges.push({ nodeId, from: fromSuggestion, to: toSuggestion });
    }
  }

  return {
    revisionId: revision.revisionId,
    supersedes: predecessor.revisionId,
    added,
    removed,
    retargeted,
    edgeChanges,
    lifecycleChanges,
    suggestionChanges,
  };
}

/**
 * The observed node with the plan's own spelling resolved onto it: an absent
 * lifecycle field reads as `required`, on BOTH node kinds — an intent node
 * carries `required`/`optional` exactly as a Change node does, so the review
 * surface names the required/optional proposal the revision records whatever
 * the node's kind. The node's target project and line are copied from the
 * revision node verbatim — the one projection-seam widening, so every
 * observation branch reports the project and none can forget or default it.
 * One wrapper for every observation branch. The dependency facts are still
 * absent; `withBlockerFacts` below is their sole writer.
 */
function withLifecycle(
  planNode: ExecutionPlanNode,
  observed: ObservedNode
): NodeSansBlockers {
  // The decomposition-guidance facts ride the same one-widening wrapper as the
  // project and lifecycle: copied verbatim from the revision node on every
  // branch, read by no axis (they are facts to read, like the target project).
  const suggestion = {
    suggestedPipeline: planNode.suggestedPipeline ?? null,
    rationale: planNode.rationale ?? null,
    uncertainty: planNode.uncertainty ?? null,
  };
  if (planNode.kind !== 'change') {
    return {
      ...observed,
      projectId: planNode.projectId,
      targetLineId: planNode.targetLineId,
      lifecycle: planNode.lifecycle ?? 'required',
      reason: null,
      ...suggestion,
    };
  }
  return {
    ...observed,
    projectId: planNode.projectId,
    targetLineId: planNode.targetLineId,
    lifecycle: planNode.lifecycle ?? 'required',
    reason: planNode.reason ?? null,
    ...suggestion,
  };
}

/**
 * The state label a dependency wait reads as, on both surfaces that name one
 * (the node line's `blockedBy` segment and `store issue start`'s refusals):
 * the observation itself, with the two honest refinements the cross-project
 * era adds — a `not-started` dependency no local run-state explains says so
 * (absence is a visibility fact, never a recorded state), and an `unknown`
 * dependency carries its diagnostic rather than being guessed at. `undefined`
 * (no status row at all — a dangling edge readable revisions exclude) reads
 * `unknown` with the same fallback diagnostic the refusal vocabulary uses.
 */
export function issueBlockerState(
  status: Pick<IssueNodeStatus, 'observation' | 'locatedBy' | 'diagnostic'> | undefined
): string {
  if (status === undefined || status.observation === 'unknown') {
    return `unknown (${status?.diagnostic ?? 'its reference or run-state could not be read'})`;
  }
  if (status.observation === 'not-started' && status.locatedBy === null) {
    return 'not-started, no local run-state';
  }
  return status.observation;
}

/**
 * The displayed dependency facts (design D2 of issue-cross-project-gating): a
 * post-pass over the statuses this build just produced, on the WORK-COMPLETE
 * basis — the one rule `store issue start` enforces — never the plan read's
 * archive-based list (which stays the query's own truth for `readyToResolve`).
 * Each dependency whose observed work is not complete is listed with its node
 * id, target project, and observation, in declaration order; one whose work is
 * terminal is not listed even before its Change is archived. A dependency with
 * no built row cannot occur in a readable revision (the revision validator
 * refuses unknown `dependsOn` targets); if one ever did, it fail-closes to
 * `unknown` with no project invented for it.
 */
function withBlockerFacts(
  nodes: readonly NodeSansBlockers[],
  rows: readonly ResolvedPlanNode[]
): IssueNodeStatus[] {
  const statusById = new Map(nodes.map(node => [node.nodeId, node] as const));
  const dependsOnById = new Map(
    rows.map(row => [row.node.nodeId, row.node.dependsOn] as const)
  );
  return nodes.map(node => ({
    ...node,
    blockedBy: (dependsOnById.get(node.nodeId) ?? [])
      .filter(dep => !isTerminal(statusById.get(dep)?.observation))
      .map(dep => {
        const dependency = statusById.get(dep);
        return {
          nodeId: dep,
          projectId: dependency?.projectId ?? '',
          observation: dependency?.observation ?? ('unknown' as const),
        };
      }),
  }));
}

/**
 * Phase precedence `done > review > active > ready > planning` (design D5,
 * revised by issue-acceptance-close D4, scoped by issue-node-lifecycle D3).
 * `done` follows explicit acceptance: the resolved state AND an acceptance
 * record that reads back verified — never an archived count, and never the
 * resolved state alone. A resolved Issue without a verified record (the
 * pre-capability close, a tampered record, or a read that supplied no
 * acceptance facts) is `review`: its work stands complete, its acceptance
 * unproven — and `review` implies `waiting-human`, which is the human who can
 * accept it.
 * `review` requires every REQUIRED change node's work complete or finalized
 * AND no intent node left AND a record whose close is not proven (an open
 * Issue, or one resolved without a verified record). An optional node's
 * incomplete work does not hold review, and a plan with zero required nodes
 * vacuously satisfies the condition — nothing demanded is unfinished (D6). A
 * cancelled/superseded node is outside the execution graph: its recorded
 * activity drives no phase value.
 * `active` covers any begun graph of WANTED work (`required` + `optional`)
 * that is not uniformly terminal (including failure and waiting, which are
 * health facts, not phases), and deliberately also an `unknown` node: a
 * located-but-unreadable run-state or a reference that broke after
 * publication is activity-adjacent trouble — the graph reached execution and
 * hit it — so the phase derives from the OBSERVATION, never from the
 * unreadable bytes.
 * `planning` keeps meaning "no readable plan" (no revision, an unreadable one,
 * zero nodes, or an all-intent plan), which is derived independently of any
 * node's observation. `ready` needs at least one wanted change node with
 * nothing started.
 */
function derivePhase(
  detail: IssueDetail,
  nodes: readonly IssueNodeStatus[],
  acceptance: IssueAcceptanceFacts | undefined
): IssuePhase {
  const state = detail.issue.record?.state;
  if (state === 'resolved') {
    // The record proves the acceptance; the resolved state records the close;
    // anything else — including bytes that no longer verify — is unproven.
    return acceptance?.acceptedRecord.record != null ? 'done' : 'review';
  }
  if (
    nodes.length > 0 &&
    state === 'open' &&
    // No intent node remains ...
    nodes.every(node => node.kind === 'change') &&
    // ... and every required node's work is complete or finalized. Optional
    // and cancelled/superseded nodes never hold review on incompleteness.
    nodes.filter(isRequired).every(node => isTerminal(node.observation))
  ) {
    return 'review';
  }
  const ACTIVE_SIGNALS: readonly IssueNodeObservation[] = [
    'in-flight',
    'advanced',
    'waiting-human',
    'failed',
    'finalized',
    'run-terminal',
    'unknown',
  ];
  const wanted = nodes.filter(isWanted);
  if (wanted.some(node => ACTIVE_SIGNALS.includes(node.observation))) return 'active';
  if (wanted.length > 0 && wanted.every(node => node.observation === 'not-started')) {
    return 'ready';
  }
  return 'planning';
}

/**
 * Health precedence `failed > waiting-human > healthy`, plus `review` implies
 * `waiting-human`: an open Issue in review has, by definition, human-owned
 * work remaining (merge, release, acceptance). Failure and wait signals come
 * from work the plan still WANTS — `required` and `optional`: a cancelled or
 * superseded node's recorded escalation is history and drives no health
 * value. Serial dependency ordering is sequencing, not sickness. `blocked`
 * and `stale` are never emitted — no recorded signal supports them today.
 */
function deriveHealth(phase: IssuePhase, nodes: readonly IssueNodeStatus[]): IssueHealth {
  const wanted = nodes.filter(isWanted);
  if (wanted.some(node => node.observation === 'failed')) return 'failed';
  if (phase === 'review' || wanted.some(node => node.observation === 'waiting-human')) {
    return 'waiting-human';
  }
  return 'healthy';
}

/**
 * Derive one Issue's tri-axis status. Same inputs, same result — the module
 * performs no ambient reads. Nothing is written anywhere.
 */
export async function projectIssueStatus(input: ProjectIssueStatusInput): Promise<IssueStatus> {
  const detail = input.detail;
  const problems: IssueStatusProblem[] = [];
  const sansBlockers: NodeSansBlockers[] = [];

  for (const unsearched of detail.unsearchedRefs) {
    problems.push({
      kind: 'unsearched-refs',
      node: null,
      ref: unsearched.storeRef,
      reason: `${unsearched.targetLineId}: ${unsearched.reason}`,
    });
  }

  const plan = detail.plan;
  if (plan !== null && plan.revision === null && plan.diagnostic !== null) {
    problems.push({
      kind: 'unreadable-plan',
      node: null,
      ref: plan.revisionId,
      reason: plan.diagnostic,
    });
  }

  if (plan !== null) {
    for (const resolved of plan.readiness.nodes) {
      sansBlockers.push(withLifecycle(resolved.node, await observeNode(resolved, input, problems)));
    }
  }
  // The dependency facts complete the node statuses before any axis reads
  // them — one writer (the post-pass), one basis (work-complete).
  const nodes: IssueNodeStatus[] = withBlockerFacts(sansBlockers, plan?.readiness.nodes ?? []);

  // Acceptance content that exists but does not read back is reported as a
  // problem — never as done-from-unreadable-bytes, and never trimmed away
  // (design D4). Absent content reports nothing: an Issue that simply has no
  // acceptance yet has no unreadable bytes.
  const acceptance = input.acceptance;
  if (acceptance !== undefined) {
    if (acceptance.conditions.diagnostic !== null) {
      problems.push({
        kind: 'unreadable-acceptance',
        node: null,
        ref: acceptance.conditions.path,
        reason: acceptance.conditions.diagnostic,
      });
    }
    if (acceptance.acceptedRecord.present && acceptance.acceptedRecord.record === null) {
      problems.push({
        kind: 'unreadable-acceptance',
        node: null,
        ref: acceptance.acceptedRecord.path,
        reason: acceptance.acceptedRecord.diagnostic ?? 'the acceptance record does not verify',
      });
    }
  }

  const phase = derivePhase(detail, nodes, acceptance);
  const health = deriveHealth(phase, nodes);
  const complete =
    detail.complete &&
    problems.every(
      problem =>
        problem.kind !== 'invalid-run-state' &&
        problem.kind !== 'unreadable-plan' &&
        problem.kind !== 'unreadable-acceptance' &&
        problem.kind !== 'invalid-archive-record'
    );

  // The acceptance block (design D2): the facts as read, the gate evaluated
  // over THIS status, and the verified record. Structural facts the gate
  // needs that the tri-axis answer does not carry — the Issue's declared
  // state — come from the same detail every other derivation here reads.
  const acceptanceBlock: IssueAcceptanceStatusBlock | null =
    acceptance === undefined
      ? null
      : {
          conditions: acceptance.conditions,
          gate: evaluateIssueAcceptanceGate(
            {
              issueState: detail.issue.record?.state ?? null,
              nodes,
              problems,
              health,
              complete,
            },
            acceptance
          ),
          record: acceptance.acceptedRecord.record,
        };

  // The revision delta derives ONLY from the two revisions, after every axis
  // was decided — it drives nothing, so its presence or absence can never
  // change an axis value. A first revision (supersedes null) reports no delta
  // section at all, exactly as one whose predecessor was not supplied or did
  // not read back.
  let delta: IssueRevisionDelta | null = null;
  if (
    plan !== null &&
    plan.revision !== null &&
    plan.revision.supersedes !== null &&
    input.predecessorPlan?.revision != null &&
    // The predecessor must BE the one the revision names — a caller supplying
    // any other revision derives no delta rather than a misleading one.
    input.predecessorPlan.revision.revisionId === plan.revision.supersedes
  ) {
    delta = deriveRevisionDelta(plan.revision, input.predecessorPlan.revision);
  }

  return {
    phase,
    health,
    progress:
      plan !== null && plan.revision !== null
        ? // The Issue-level pair: the one rule over the whole node selection.
          // A readable revision with no required nodes reports the stated pair
          // 0/0 — no work is demanded — which stays distinct from the null an
          // unreadable revision reports.
          progressOver(nodes)
        : null,
    nodes,
    delta,
    // Lanes derive only from a readable revision, after the axes did — they
    // drive nothing, so their absence can never change an axis value.
    projects:
      plan !== null && plan.revision !== null
        ? deriveProjectLanes(nodes, input.projectAliases)
        : [],
    problems,
    runStateVisibility:
      input.executionRoot === undefined
        ? { kind: 'none' }
        : { kind: 'execution-root', executionRoot: input.executionRoot },
    complete,
    acceptance: acceptanceBlock,
  };
}
