/**
 * `issue-status-projection` — deriving an Issue's tri-axis status.
 *
 * The projection composes two worlds the Store query keeps apart on purpose:
 * the Store's committed evidence (portable, authoritative) and machine-local
 * run-state (ephemeral, keyed by change alias, on whatever root executed the
 * work). `store-aggregate-query`'s contract is store-pure, so this module —
 * not the query — is where they meet. It imports and never modifies the
 * pipeline-registry run-state readers, mirroring `pipeline resume`'s location
 * recipe exactly so the projection and resume can never disagree about where
 * a Change's state lives.
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
import { ephemeraDir } from '../file-placement.js';
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
  IssueHealth,
  IssueNodeObservation,
  IssueNodeStatus,
  IssuePhase,
  IssueStatus,
  IssueStatusProblem,
  ProjectIssueStatusInput,
} from './types.js';

/** Where a state file resolved from, along the sticky-legacy chain. */
interface LocatedStateFile {
  readonly dir: string;
  readonly path: string;
}

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
): Promise<IssueNodeStatus> {
  const node = resolved.node;

  if (node.kind === 'intent') {
    return {
      nodeId: node.nodeId,
      kind: 'intent',
      alias: null,
      observation: 'not-started',
      blockedBy: resolved.blockedBy,
      diagnostic: null,
      runStatePath: null,
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
      blockedBy: resolved.blockedBy,
      diagnostic: reason,
      runStatePath: null,
    };
  }

  // Committed evidence before machine-local run-state (design D4): an archived
  // Change with a committed outcome is finalized regardless of what any
  // machine-local run-state says, which is why this holds even from a
  // directory that resolves no execution root.
  if (resolved.resolution.archived && resolved.resolution.outcome !== null) {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: aliasFor(resolved),
      observation: 'finalized',
      blockedBy: resolved.blockedBy,
      diagnostic: null,
      runStatePath: null,
    };
  }

  const alias = aliasFor(resolved);
  if (alias === null) {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias: null,
      observation: 'not-started',
      blockedBy: resolved.blockedBy,
      diagnostic: 'no change alias available to locate run-state',
      runStatePath: null,
    };
  }

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
    const read = readPortfolioStateDetailed(portfolioAt.dir);
    if (read.kind === 'invalid') {
      problems.push({
        kind: 'invalid-run-state',
        node: node.nodeId,
        ref: portfolioAt.path,
        reason: read.reason,
      });
      return {
        nodeId: node.nodeId,
        kind: 'change',
        alias,
        observation: 'unknown',
        blockedBy: resolved.blockedBy,
        diagnostic: read.reason,
        runStatePath: portfolioAt.path,
      };
    }
    // `absent` after a locate means the file vanished between the two reads;
    // fall through to the per-change record rather than asserting either way.
    if (read.kind === 'ok') {
      return {
        nodeId: node.nodeId,
        kind: 'change',
        alias,
        observation: observePortfolio(read.state),
        blockedBy: resolved.blockedBy,
        diagnostic: null,
        runStatePath: portfolioAt.path,
      };
    }
  }

  const runAt = locateInChain(chain, runStatePath);
  if (runAt === null) {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias,
      observation: 'not-started',
      blockedBy: resolved.blockedBy,
      diagnostic: null,
      runStatePath: null,
    };
  }
  const read = readRunStateDetailed(runAt.dir);
  if (read.kind === 'invalid') {
    problems.push({
      kind: 'invalid-run-state',
      node: node.nodeId,
      ref: runAt.path,
      reason: read.reason,
    });
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias,
      observation: 'unknown',
      blockedBy: resolved.blockedBy,
      diagnostic: read.reason,
      runStatePath: runAt.path,
    };
  }
  if (read.kind === 'ok') {
    return {
      nodeId: node.nodeId,
      kind: 'change',
      alias,
      observation: observeAutoRun(read.state),
      blockedBy: resolved.blockedBy,
      diagnostic: null,
      runStatePath: runAt.path,
    };
  }
  // `absent` after a locate: the file vanished between the two reads.
  return {
    nodeId: node.nodeId,
    kind: 'change',
    alias,
    observation: 'not-started',
    blockedBy: resolved.blockedBy,
    diagnostic: null,
    runStatePath: null,
  };
}

function isTerminal(observation: IssueNodeObservation): boolean {
  return observation === 'finalized' || observation === 'run-terminal';
}

/**
 * Phase precedence `done > review > active > ready > planning` (design D5).
 * `done` is operator-declared only — archived nodes alone never produce it.
 * `review` requires every node's work complete or finalized AND no intent
 * node left AND an open record. `active` covers any begun graph that is not
 * uniformly terminal (including failure and waiting, which are health facts,
 * not phases), and deliberately also an `unknown` node: a located-but-
 * unreadable run-state or a reference that broke after publication is
 * activity-adjacent trouble — the graph reached execution and hit it — so the
 * phase derives from the OBSERVATION, never from the unreadable bytes.
 * `planning` keeps meaning "no readable plan" (no revision, an unreadable one,
 * zero nodes, or an all-intent plan), which is derived independently of any
 * node's observation. `ready` needs at least one change node with nothing
 * started.
 */
function derivePhase(detail: IssueDetail, nodes: readonly IssueNodeStatus[]): IssuePhase {
  const state = detail.issue.record?.state;
  if (state === 'resolved') return 'done';
  if (
    nodes.length > 0 &&
    state === 'open' &&
    nodes.every(node => node.kind === 'change' && isTerminal(node.observation))
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
  if (nodes.some(node => ACTIVE_SIGNALS.includes(node.observation))) return 'active';
  if (
    nodes.some(node => node.kind === 'change') &&
    nodes.every(node => node.observation === 'not-started')
  ) {
    return 'ready';
  }
  return 'planning';
}

/**
 * Health precedence `failed > waiting-human > healthy`, plus `review` implies
 * `waiting-human`: an open Issue in review has, by definition, human-owned
 * work remaining (merge, release, acceptance). Serial dependency ordering is
 * sequencing, not sickness. `blocked` and `stale` are never emitted — no
 * recorded signal supports them today.
 */
function deriveHealth(phase: IssuePhase, nodes: readonly IssueNodeStatus[]): IssueHealth {
  if (nodes.some(node => node.observation === 'failed')) return 'failed';
  if (phase === 'review' || nodes.some(node => node.observation === 'waiting-human')) {
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
  const nodes: IssueNodeStatus[] = [];

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
      nodes.push(await observeNode(resolved, input, problems));
    }
  }

  const phase = derivePhase(detail, nodes);
  return {
    phase,
    health: deriveHealth(phase, nodes),
    progress:
      plan !== null && plan.revision !== null
        ? {
            // Finished-but-unarchived counts: progress measures work, not
            // archiving. Finalizing later does not change the count.
            completed: nodes.filter(node => isTerminal(node.observation)).length,
            total: nodes.length,
          }
        : null,
    nodes,
    problems,
    runStateVisibility:
      input.executionRoot === undefined
        ? { kind: 'none' }
        : { kind: 'execution-root', executionRoot: input.executionRoot },
    complete:
      detail.complete &&
      problems.every(
        problem => problem.kind !== 'invalid-run-state' && problem.kind !== 'unreadable-plan'
      ),
  };
}
