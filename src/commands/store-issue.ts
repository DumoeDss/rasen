/**
 * `rasen store issue new|list|show|state|plan|start|confirm|ready|acceptance|accept`
 * — the CLI for the Store-level Issue Module (`StoreIssues`) and the
 * Issue-facing slice of the aggregate query
 * (`StoreAggregateQuery.{listIssues,showIssue}`).
 *
 * An Issue is Store-level cross-project intent, so every subcommand takes
 * only `--store`: never `--project`, never `--target-line`. Issue content is
 * Git-tracked Store content, so a write prints a pathspec-scoped commit
 * suggestion and stages, commits, fetches, and pushes nothing.
 */
import * as fs from 'node:fs';

import { Command } from 'commander';
import { parse as parseYaml } from 'yaml';

import { StoreError } from '../core/store/errors.js';
import {
  ISSUE_STATES,
  StoreIssuesModuleInstance,
  issueError,
  type AcceptanceConditionInput,
  type AcceptanceConditionsResult,
  type AcceptIssueResult,
  type ExecutionPlanNodeInput,
  type ExecutionPlanResult,
  type IssueRecordResult,
  type IssueState,
  type SuggestedIssueCommit,
} from '../core/store/issues/index.js';
import {
  StoreAggregateQuery,
  listProjectEntries,
  nodeStoreQueryFileSystem,
  productionStoreQueryDependencies,
  resolveQueryStore,
  type AggregateProblem,
  type IssueDetail,
  type IssueSummary,
  type IssueSummaryPage,
  type ResolvedExecutionPlan,
} from '../core/store/query/index.js';
import {
  listAllWorkspaceIndexEntries,
  type WorkspaceIndexEntry,
} from '../core/store/workspace/registry.js';
import { listPipelines } from '../core/pipeline-registry/resolver.js';
import { resolveSessionLaunchContext } from '../core/management-api/session-launch-context.js';
import {
  deriveIssueReadySet,
  issueBlockerState,
  projectIssueStatus,
  type IssueReadyExit,
  type IssueReadyMember,
  type IssueReadySet,
  type IssueStatus,
  type IssueStatusProblem,
  type ProjectIssueStatusInput,
} from '../core/issue-status/index.js';
import {
  composeIssueConfirm,
  refusalFix,
  resolveIssueLaunchBinding,
  type IssueConfirmReport,
  type IssueLaunchBinding,
  type IssueStartRefusal,
} from '../core/issue-execution/index.js';
import {
  acceptIssue,
  readIssueAcceptanceFacts,
  type IssueAcceptanceBlocker,
  type IssueAcceptanceGateEvaluation,
} from '../core/issue-acceptance/index.js';
import {
  resolvedExecutionProjectRoot,
  resolveOpenSpecRoot,
} from '../core/root-selection.js';
import {
  publishPlanFromDecomposition,
  publishPlanFromPortfolio,
  type IssuePlanPublicationResult,
} from '../core/issue-publication/index.js';
import { emitFailure, printJson } from './shared-output.js';

export interface StoreIssueOptions {
  store?: string;
  title?: string;
  readme?: boolean;
  state?: string;
  reason?: string;
  fromFile?: string;
  fromPortfolio?: string;
  fromDecomposition?: string;
  node?: string;
  pipeline?: string;
  revision?: string;
  note?: string;
  json?: boolean;
}

function issuePayload(result: IssueRecordResult): unknown {
  return {
    issueId: result.issueId,
    record: result.record,
    storeId: result.storeId,
    storeUid: result.storeUid,
    checkoutRoot: result.checkoutRoot,
    checkoutRef: result.checkoutRef,
    written: result.written,
    suggestedCommits: result.suggestedCommits,
  };
}

function planPayload(result: ExecutionPlanResult): unknown {
  return {
    issueId: result.issueId,
    revision: result.revision,
    storeId: result.storeId,
    storeUid: result.storeUid,
    checkoutRoot: result.checkoutRoot,
    checkoutRef: result.checkoutRef,
    written: result.written,
    suggestedCommits: result.suggestedCommits,
  };
}

function acceptancePayload(result: AcceptanceConditionsResult): unknown {
  return {
    issueId: result.issueId,
    revision: result.revision,
    storeId: result.storeId,
    storeUid: result.storeUid,
    checkoutRoot: result.checkoutRoot,
    checkoutRef: result.checkoutRef,
    written: result.written,
    suggestedCommits: result.suggestedCommits,
  };
}

function acceptPayload(result: AcceptIssueResult): unknown {
  return {
    issueId: result.issueId,
    record: result.record,
    state: result.state,
    storeId: result.storeId,
    storeUid: result.storeUid,
    checkoutRoot: result.checkoutRoot,
    checkoutRef: result.checkoutRef,
    written: result.written,
    suggestedCommits: result.suggestedCommits,
  };
}

function renderCommitSuggestions(suggestions: readonly SuggestedIssueCommit[]): void {
  for (const suggestion of suggestions) {
    console.log('');
    console.log(`  ${suggestion.rationale}`);
    console.log(`    git -C ${suggestion.repoRoot} add ${suggestion.pathspecs.join(' ')}`);
    console.log(`    git -C ${suggestion.repoRoot} commit -m "${suggestion.message}"`);
  }
}

function renderIssueWrite(result: IssueRecordResult): void {
  console.log(`Issue ${result.issueId} (${result.record.state})`);
  console.log(`  title: ${result.record.title}`);
  if (result.record.reason !== null) console.log(`  reason: ${result.record.reason}`);
  console.log(`  checkout: ${result.checkoutRoot}`);
  renderCommitSuggestions(result.suggestedCommits);
}

function renderPlanWrite(
  result: ExecutionPlanResult,
  sourceLine?: string
): void {
  console.log(`Issue ${result.issueId}: Execution Plan revision ${result.revision.revisionId}`);
  console.log(`  supersedes: ${result.revision.supersedes ?? '(none)'}`);
  console.log(`  nodes: ${result.revision.nodes.length}`);
  // The same source facts the JSON form carries in its `source` block, on one
  // human line beside the revision facts (issue-plan-publication D5).
  if (sourceLine !== undefined) console.log(sourceLine);
  renderCommitSuggestions(result.suggestedCommits);
}

/**
 * One human line naming where a portfolio publication came from: the parent,
 * the located run-state path, and the child count — the same facts the JSON
 * form's `source` block carries.
 */
function portfolioSourceLine(result: IssuePlanPublicationResult): string {
  const source = result.source;
  if (source.kind !== 'portfolio') return `  source: ${source.kind}`;
  return `  source: portfolio '${source.parent}' — ${source.childCount} children, run-state ${source.statePath}`;
}

/**
 * One human line naming where a decomposition publication came from: the
 * document path, the node count — the same facts the JSON form's `source`
 * block carries.
 */
function decompositionSourceLine(result: IssuePlanPublicationResult): string {
  const source = result.source;
  if (source.kind !== 'decomposition') return `  source: ${source.kind}`;
  return `  source: decomposition — ${source.nodeCount} intent nodes, document ${source.documentPath}`;
}

function renderAcceptanceWrite(result: AcceptanceConditionsResult): void {
  console.log(
    `Issue ${result.issueId}: acceptance conditions revision ${result.revision.revisionId}`
  );
  console.log(`  supersedes: ${result.revision.supersedes ?? '(none)'}`);
  console.log(`  conditions: ${result.revision.conditions.length}`);
  renderCommitSuggestions(result.suggestedCommits);
}

function renderAcceptWrite(result: AcceptIssueResult): void {
  console.log(`Issue ${result.issueId} accepted (${result.state})`);
  console.log(
    `  conditions: revision ${result.record.conditionsRevisionId} (${result.record.conditionsSha256})`
  );
  console.log(
    `  gate: ${result.record.gate.completed}/${result.record.gate.total} ${result.record.gate.health}, 0 problems standing`
  );
  // The record's own arithmetic: every exclusion it froze, beside the total
  // it explains — the same facts the JSON form's `record` carries.
  for (const exclusion of result.record.exclusions ?? []) {
    console.log(`  excluded ${exclusion.nodeId} (${exclusion.lifecycle}): ${exclusion.reason}`);
  }
  if (result.record.note !== null) console.log(`  note: ${result.record.note}`);
  renderCommitSuggestions(result.suggestedCommits);
}

/**
 * Items that were read and could not be understood, in the HUMAN form — the
 * same list the JSON form carries under `problems`. A malformed Issue whose id
 * appears without its reason is exactly the "the item survives, the why does
 * not" failure this reporting exists to close.
 */
function renderProblems(problems: readonly AggregateProblem[]): void {
  if (problems.length === 0) return;
  console.log('');
  console.log(`UNREADABLE: ${problems.length} item(s) were found and could not be read.`);
  for (const problem of problems) {
    console.log(
      `  ${problem.kind} ${problem.itemId} (${problem.storeRef ?? '(local checkout)'}: ${
        problem.path
      }): ${problem.reason}`
    );
  }
}

// -----------------------------------------------------------------------------
// Status projection (read enrichment)
// -----------------------------------------------------------------------------

/**
 * The machine-local inputs the projection needs: resolved from the WORKING
 * DIRECTORY the command runs from, best-effort. An Issue is Store content and
 * readable from anywhere, so a directory that resolves no project execution
 * root degrades to a visibility-`none` answer — committed evidence still
 * derives; never a failure of the store-scoped command.
 *
 * Exported for the store-level `attention` scan (issue-needs-attention D3):
 * the scan composes each Issue through the SAME inputs `show` does, so
 * attention and show cannot disagree about an Issue's facts.
 */
export async function resolveProjectionContext(): Promise<{
  executionRoot?: string;
  changesDir?: string;
  projectRoot?: string;
}> {
  try {
    const root = await resolveOpenSpecRoot({ startPath: process.cwd(), reporter: false });
    return {
      executionRoot: resolvedExecutionProjectRoot(root),
      changesDir: root.changesDir,
      projectRoot: root.path,
    };
  } catch {
    return {};
  }
}

export function statusInputFor(
  detail: IssueDetail,
  context: {
    executionRoot?: string;
    changesDir?: string;
    storeRoot?: string;
    workspaceEntries?: readonly WorkspaceIndexEntry[];
    projectAliases?: Readonly<Record<string, string>>;
    acceptance?: Awaited<ReturnType<typeof readIssueAcceptanceFacts>>;
    predecessorPlan?: ResolvedExecutionPlan | null;
  }
): ProjectIssueStatusInput {
  return {
    detail,
    ...(context.executionRoot === undefined ? {} : { executionRoot: context.executionRoot }),
    ...(context.changesDir === undefined ? {} : { changesDir: context.changesDir }),
    ...(context.storeRoot === undefined ? {} : { storeRoot: context.storeRoot }),
    ...(context.workspaceEntries === undefined ? {} : { workspaceEntries: context.workspaceEntries }),
    ...(context.projectAliases === undefined ? {} : { projectAliases: context.projectAliases }),
    ...(context.acceptance === undefined ? {} : { acceptance: context.acceptance }),
    ...(context.predecessorPlan === undefined ? {} : { predecessorPlan: context.predecessorPlan }),
  };
}

/**
 * The predecessor revision the latest revision's `supersedes` names, when the
 * plan carries one — resolved with the SAME query the latest revision read
 * through, so the revision delta derives from two digest-verified reads. A
 * first revision (or an unreadable predecessor) contributes null, which the
 * projection reads as "no delta section".
 */
export async function resolvePredecessorPlan(
  scope: { store?: string; startPath: string },
  issueId: string,
  supersedes: string | null
): Promise<ResolvedExecutionPlan | null> {
  if (supersedes === null) return null;
  return StoreAggregateQuery.resolveExecutionPlan({
    ...(scope.store === undefined ? {} : { store: scope.store }),
    startPath: scope.startPath,
    issueId,
    revisionId: supersedes,
  });
}

/**
 * The Store-scoped widening inputs, gathered ONCE per command: the resolved
 * Store's registered root (the store-side active-change address for evidence
 * locators), the machine workspace index entries filtered to that Store's
 * uid — exactly the storeUid-first filter `gatherReferenceEvidence` applies,
 * so an index entry from another Store can never masquerade as this one's —
 * and the display aliases read from the Store's own project catalogs (the
 * catalog display `id` when one resolves; display-only composition, never a
 * guess — grouping, gating, and progress key on the project id regardless).
 * Returns an empty widening when no `--store` was given; the Store-scoped
 * query itself refuses that case before any of this matters.
 */
export async function resolveStoreWideningContext(
  store: string | undefined
): Promise<{
  storeId?: string;
  storeUid?: string;
  storeRoot?: string;
  workspaceEntries?: readonly WorkspaceIndexEntry[];
  projectAliases?: Readonly<Record<string, string>>;
}> {
  if (store === undefined) return {};
  const resolved = await resolveQueryStore({ fs: nodeStoreQueryFileSystem }, { store });
  const workspaceEntries = (
    await listAllWorkspaceIndexEntries(productionStoreQueryDependencies.coordination())
  ).filter(entry => entry.storeUid === resolved.storeUid);
  // An invalid catalog (the entry carries a diagnostic) contributes no alias;
  // the lane falls back to the raw id, which never guesses.
  const projectAliases: Record<string, string> = {};
  for (const entry of await listProjectEntries(
    { fs: nodeStoreQueryFileSystem },
    resolved.registeredRoot
  )) {
    if (entry.catalog !== null && entry.catalog.id !== undefined) {
      projectAliases[entry.projectId] = entry.catalog.id;
    }
  }
  return {
    storeId: resolved.storeId,
    storeUid: resolved.storeUid,
    storeRoot: resolved.registeredRoot,
    workspaceEntries,
    projectAliases,
  };
}

/**
 * `list` has the summary page but not the plans, so each Issue's latest plan
 * is resolved here (one `resolveExecutionPlan` per Issue — accepted at
 * single-project scale) and assembled into the `IssueDetail` shape the
 * projection consumes.
 */
async function detailForList(
  scope: { store?: string; startPath: string },
  summary: IssueSummary,
  page: IssueSummaryPage
): Promise<IssueDetail> {
  const plan =
    summary.latestRevisionId === null
      ? null
      : await StoreAggregateQuery.resolveExecutionPlan({
          ...(scope.store === undefined ? {} : { store: scope.store }),
          startPath: scope.startPath,
          issueId: summary.issueId,
        });
  return {
    issue: summary,
    plan,
    complete: plan === null ? page.complete : plan.complete,
    unsearchedRefs: plan === null ? page.unsearchedRefs : plan.unsearchedRefs,
    problems: plan === null ? page.problems : plan.problems,
  };
}

function renderProgress(status: IssueStatus): string {
  return status.progress === null ? '-/-' : `${status.progress.completed}/${status.progress.total}`;
}

/**
 * The name a lane header (and the list's per-project summary) addresses a
 * project by: the supplied display alias, falling back to the raw project id
 * — never a guess. The id rides beside the name on the show header, so the
 * identity is always visible even when the alias does resolve.
 */
function laneDisplayName(lane: IssueStatus['projects'][number]): string {
  return lane.alias ?? lane.projectId;
}

function renderRunStateVisibility(status: IssueStatus): string {
  return status.runStateVisibility.kind === 'execution-root'
    ? `run-state: ${status.runStateVisibility.executionRoot}`
    : 'run-state: none visible from this directory';
}

/**
 * The per-node line the show command prints: identifier, kind, target
 * project, alias, observation, then whatever explains it — a lifecycle that
 * is not required (with the recorded reason a cancelled/superseded node
 * carries), a recorded execution suggestion with its decomposition
 * rationale/uncertainty, a dependency whose work is not complete, or the
 * diagnostic behind an `unknown`. The project, suggestion, and rationale are
 * facts the revision records — shown, never interpreted into any axis. Each
 * blocker names its own target project and observed state on the
 * work-complete basis (the rule `start` enforces), so the line explains
 * exactly what a launch will wait for.
 */
function renderStatusNode(
  node: IssueStatus['nodes'][number],
  statusById: ReadonlyMap<string, IssueStatus['nodes'][number]>
): string {
  const head =
    node.alias === null
      ? `${node.nodeId} ${node.kind} ${node.projectId} — ${node.observation}`
      : `${node.nodeId} ${node.kind} ${node.projectId} ${node.alias} — ${node.observation}`;
  const parts = [head];
  if (node.lifecycle !== 'required') {
    parts.push(node.reason === null ? `(${node.lifecycle})` : `(${node.lifecycle}: ${node.reason})`);
  }
  // The recorded decomposition guidance, when the revision carries it: the
  // suggestion and the reasoning/uncertainty behind it — facts a reviewer
  // reads, shown only when present, interpreted into no axis.
  if (node.suggestedPipeline !== null) parts.push(`(suggest: ${node.suggestedPipeline})`);
  if (node.rationale !== null) parts.push(`(rationale: ${node.rationale})`);
  if (node.uncertainty !== null) parts.push(`(uncertainty: ${node.uncertainty})`);
  if (node.blockedBy.length > 0) {
    const entries = node.blockedBy.map(
      blocker =>
        `${blocker.nodeId}@${blocker.projectId}: ${issueBlockerState(
          statusById.get(blocker.nodeId)
        )}`
    );
    parts.push(`(blockedBy ${entries.join(', ')})`);
  }
  if (node.diagnostic !== null) parts.push(`(${node.diagnostic})`);
  return `      ${parts.join(' ')}`;
}

/**
 * The attribution lines under one node line — the Run/Session facts that join
 * the node's execution back to the Issue (pipeline, locator, durable session
 * pointers, evidence directory). Emitted only when a fact exists to print:
 * an all-null attribution carries no line, the same absence the JSON form's
 * null fields report.
 */
function renderAttributionLines(node: IssueStatus['nodes'][number]): string[] {
  const { attribution, locatedBy } = node;
  const lines: string[] = [];
  if (attribution.pipeline !== null || locatedBy !== null) {
    const located = locatedBy === null ? '' : ` (located by ${locatedBy})`;
    lines.push(`        pipeline: ${attribution.pipeline ?? 'none recorded'}${located}`);
  }
  for (const session of attribution.sessions) {
    const who = [session.runtime, session.role].filter(part => part !== null).join(' ') || 'worker';
    const pointers = [
      ...(session.sessionId === undefined ? [] : [`sessionId=${session.sessionId}`]),
      ...(session.threadId === undefined ? [] : [`threadId=${session.threadId}`]),
      ...(session.transcript === undefined ? [] : [`transcript=${session.transcript}`]),
    ].join(' ');
    lines.push(`        session ${session.stageId} (${who}): ${pointers}`);
  }
  if (attribution.evidenceLocator !== null) {
    lines.push(`        evidence: ${attribution.evidenceLocator}`);
  }
  return lines;
}

function renderStatusProblems(problems: readonly IssueStatusProblem[]): void {
  if (problems.length === 0) return;
  console.log('');
  console.log(`STATUS PROBLEMS: ${problems.length} fact(s) could not be derived.`);
  for (const problem of problems) {
    const at = problem.ref === null ? '' : ` ${problem.ref}`;
    const node = problem.node === null ? '' : ` ${problem.node}`;
    console.log(`  ${problem.kind}${node}${at}: ${problem.reason}`);
  }
}

/**
 * The revision-delta section of `show`: what the latest revision changed
 * against its predecessor — added and removed nodes, retargets, edge
 * changes, lifecycle changes, suggestion changes — the same facts the JSON
 * form carries under `status.delta`. Omitted entirely when there is no delta
 * (a first revision, or a predecessor that did not read back).
 */
function renderRevisionDelta(delta: IssueStatus['delta']): void {
  if (delta === null) return;
  console.log('');
  console.log(`  revision delta: ${delta.revisionId} over ${delta.supersedes}`);
  for (const nodeId of delta.added) {
    console.log(`    + ${nodeId}`);
  }
  for (const nodeId of delta.removed) {
    console.log(`    - ${nodeId}`);
  }
  for (const retarget of delta.retargeted) {
    console.log(
      `    -> ${retarget.nodeId} (${retarget.fromProjectId}/${retarget.fromTargetLineId} -> ${retarget.toProjectId}/${retarget.toTargetLineId})`
    );
  }
  for (const edge of delta.edgeChanges) {
    const added = edge.addedDependencies.map(dep => `+${dep}`).join(' ');
    const removed = edge.removedDependencies.map(dep => `-${dep}`).join(' ');
    const parts = [added, removed].filter(part => part.length > 0).join(' ');
    console.log(`    ~ edges ${edge.nodeId} (${parts})`);
  }
  for (const change of delta.lifecycleChanges) {
    console.log(`    ~ lifecycle ${change.nodeId} (${change.from} -> ${change.to})`);
  }
  for (const change of delta.suggestionChanges) {
    const from = change.from ?? '(none)';
    const to = change.to ?? '(none)';
    console.log(`    ~ suggestion ${change.nodeId} (${from} -> ${to})`);
  }
}

/** One gate blocker's human line — the taxonomy is closed, so it is total. */
function renderAcceptanceBlocker(blocker: IssueAcceptanceBlocker): string {
  switch (blocker.kind) {
    case 'un-terminal-node':
      return `node ${blocker.nodeId} is ${blocker.observation}`;
    case 'failing-node':
      return `node ${blocker.nodeId} is failed`;
    case 'status-problem':
      return `status problem ${blocker.problemKind}${
        blocker.node === null ? '' : ` on ${blocker.node}`
      }: ${blocker.reason}`;
    case 'incomplete-read':
      return blocker.reason;
  }
}

/**
 * The lines one gate evaluation renders beside the acceptance section: the
 * gate line itself, then the lifecycle accounting — cancelled/superseded
 * exclusions with their recorded reasons always, and at a zero required total
 * the statement that no work is demanded with the optional nodes named, so an
 * empty total never hides what the revision says. The same facts the JSON
 * form carries under `status.acceptance.gate` and `status.nodes`.
 */
function renderGateLine(gate: IssueAcceptanceGateEvaluation, status: IssueStatus): string[] {
  const exclusions = gate.exclusions.map(
    exclusion => `      - excluded ${exclusion.nodeId} (${exclusion.lifecycle}): ${exclusion.reason}`
  );
  // The blocked branch carries no snapshot, so the zero-required statement
  // derives from the same status the gate was evaluated over — required
  // CHANGE nodes, the same scoping the projection applies.
  const requiredTotal = status.nodes.filter(
    node => node.kind === 'change' && node.lifecycle === 'required'
  ).length;
  const zeroRequired =
    requiredTotal === 0
      ? [
          '      no required nodes — no work is demanded',
          ...(gate.optionalNodes.length > 0
            ? [`      optional nodes (named, not counted): ${gate.optionalNodes.join(', ')}`]
            : []),
        ]
      : [];
  if (gate.eligible) {
    return [
      `    gate: eligible (would accept conditions revision ${gate.conditionsRevisionId})`,
      ...zeroRequired,
      ...exclusions,
    ];
  }
  if (gate.blockers.length === 0) {
    return [
      `    gate: not eligible — ${gate.message}`,
      ...zeroRequired,
      ...exclusions,
    ];
  }
  return [
    '    gate: not eligible',
    `      ${gate.message.split(' — ')[0]}`,
    ...gate.blockers.map(blocker => `      - ${renderAcceptanceBlocker(blocker)}`),
    ...zeroRequired,
    ...exclusions,
  ];
}

/**
 * The acceptance section of `show` (design D8): the latest conditions with
 * per-item requirement and verification note, the gate line — eligible or
 * every named blocker — and the accepted record when present. Both forms
 * carry the same facts; `--json` carries them via `status.acceptance`.
 */
function renderAcceptanceSection(status: IssueStatus): void {
  if (status.acceptance === null) return;
  const { conditions, gate, record } = status.acceptance;
  // A blank line separates this section from the status block above — the
  // same spacing the UNREADABLE/INCOMPLETE blocks use — so it never reads as
  // a continuation of STATUS PROBLEMS when problems were printed.
  console.log('');
  console.log('  acceptance:');
  if (conditions.revision === null) {
    if (conditions.diagnostic === null) {
      console.log('    conditions: (none published)');
    } else {
      console.log(`    conditions: UNREADABLE revision ${conditions.revisionId ?? '(unknown)'}`);
      console.log(`      ${conditions.diagnostic}`);
    }
  } else {
    console.log(
      `    conditions: revision ${conditions.revision.revisionId} (${conditions.revision.conditions.length} condition(s))`
    );
    for (const condition of conditions.revision.conditions) {
      const verification =
        condition.verification === undefined ? '' : ` (verification: ${condition.verification})`;
      console.log(`      ${condition.id}: ${condition.requirement}${verification}`);
    }
  }
  for (const line of renderGateLine(gate, status)) console.log(line);
  if (record !== null) {
    console.log(
      `    record: accepted ${record.acceptedAt} under revision ${record.conditionsRevisionId} (gate ${record.gate.completed}/${record.gate.total} ${record.gate.health})`
    );
    // The exclusions the record froze, beside the gate snapshot whose total
    // they explain — the same rows the gate line renders for a live
    // evaluation, carried here from the durable record itself.
    for (const exclusion of record.exclusions ?? []) {
      console.log(
        `      excluded ${exclusion.nodeId} (${exclusion.lifecycle}): ${exclusion.reason}`
      );
    }
    if (record.note !== null) console.log(`      note: ${record.note}`);
  } else {
    console.log('    record: (not accepted)');
  }
}

function renderIssueStatus(status: IssueStatus): void {
  console.log('  status:');
  console.log(`    phase: ${status.phase}`);
  console.log(`    health: ${status.health}`);
  console.log(`    progress: ${renderProgress(status)}`);
  console.log(`    ${renderRunStateVisibility(status)}`);
  if (status.nodes.length > 0) {
    console.log('    nodes:');
    // The blocker segment reads each dependency's own row for its state label,
    // so every node line explains its waits without a second copy of the facts.
    const statusById = new Map(status.nodes.map(node => [node.nodeId, node] as const));
    const renderNodeLines = (node: IssueStatus['nodes'][number]): void => {
      console.log(renderStatusNode(node, statusById));
      for (const line of renderAttributionLines(node)) console.log(line);
    };
    if (status.projects.length > 0) {
      // One lane header per member project, that project's node lines under
      // it — the node lines themselves are unchanged; the lane groups them,
      // and the flat `nodes` array stays the truth the lane ids point into.
      for (const lane of status.projects) {
        console.log(
          `      project ${laneDisplayName(lane)} (${lane.projectId}): ` +
            `${lane.progress.completed}/${lane.progress.total}`
        );
        for (const nodeId of lane.nodeIds) {
          const node = statusById.get(nodeId);
          if (node !== undefined) renderNodeLines(node);
        }
      }
    } else {
      // No lanes (an unreadable revision): whatever rows did build print
      // flat, exactly as before lanes existed.
      for (const node of status.nodes) renderNodeLines(node);
    }
  }
  renderStatusProblems(status.problems);
  renderRevisionDelta(status.delta);
}

function renderIssueList(page: IssueSummaryPage, statuses: readonly IssueStatus[] = []): void {
  if (page.issues.length === 0) {
    console.log('No Issues found.');
  }
  page.issues.forEach((summary, index) => {
    const state = summary.record?.state ?? (summary.divergence ? '(divergent)' : '(unknown)');
    const title = summary.record?.title ?? '';
    const status = statuses[index];
    // The per-project progress summary beside the Issue-level pair, lanes in
    // the same order the show headers print — omitted entirely when no lanes
    // derive (the same absence the Issue-level pair reports as `-/-`).
    const laneSegment =
      status !== undefined && status.projects.length > 0
        ? ` [${status.projects
            .map(
              lane =>
                `${laneDisplayName(lane)} ${lane.progress.completed}/${lane.progress.total}`
            )
            .join(' · ')}]`
        : '';
    const statusSegment =
      status === undefined
        ? ''
        : `  ${status.phase}/${status.health} ${renderProgress(status)}${laneSegment}`;
    console.log(`${summary.issueId}  [${state}]${statusSegment}  ${title}`);
    // The reason there is no record, on the item's own line. `(unknown)` names
    // the fact and hides the cause; the machine form carries the cause, so the
    // human form does too.
    if (summary.diagnostic !== null) {
      console.log(`    unreadable record: ${summary.diagnostic}`);
    }
    // A divergence the JSON form reports copy-by-copy, with each copy's
    // digest, must not reach a person as the bare word "(divergent)": a fact
    // reported to a program is never silently dropped from the human form.
    for (const copy of summary.divergence?.copies ?? []) {
      console.log(`    ${copy.storeRef ?? '(local checkout)'}  ${copy.sha256}`);
    }
  });
  // One shared label for the whole listing: run-state visibility comes from
  // the working directory, not from any single Issue.
  if (page.issues.length > 0 && statuses.length > 0) {
    const anyVisible = statuses.some(
      status => status.runStateVisibility.kind === 'execution-root'
    );
    console.log('');
    if (anyVisible) {
      const root = (statuses.find(
        status => status.runStateVisibility.kind === 'execution-root'
      ) as { runStateVisibility: { kind: 'execution-root'; executionRoot: string } })
        .runStateVisibility.executionRoot;
      console.log(`Run-state visible at: ${root}`);
    } else {
      console.log('No local run-state visible: no execution root resolved from this directory.');
    }
  }
  if (page.unsearchedRefs.length > 0) {
    console.log('');
    console.log(`INCOMPLETE: ${page.unsearchedRefs.length} ref(s) could not be read.`);
    for (const ref of page.unsearchedRefs) {
      console.log(`  ${ref.targetLineId} (${ref.storeRef}): ${ref.reason}`);
    }
  }
  renderProblems(page.problems);
}

function renderIssueDetail(detail: IssueDetail, status?: IssueStatus): void {
  const summary = detail.issue;
  console.log(`Issue ${summary.issueId}`);
  if (summary.record) {
    console.log(`  state: ${summary.record.state}`);
    console.log(`  title: ${summary.record.title}`);
  }
  // Independent of the two branches around it, not an `else`: an Issue can be
  // divergent AND carry an unreadable copy, and reporting only the first fact
  // reached would drop the other from the human form alone.
  if (summary.diagnostic !== null) {
    console.log(`  unreadable record: ${summary.diagnostic}`);
  }
  if (summary.divergence) {
    console.log(
      `  DIVERGENT: ${summary.divergence.copies.length} differing copies across Store refs.`
    );
    // Every copy with its digest, the same facts `--json` carries. Naming the
    // count alone would leave a person unable to see WHICH copies differ, and
    // no winner is picked here either.
    for (const copy of summary.divergence.copies) {
      console.log(`    ${copy.storeRef ?? '(local checkout)'}  ${copy.sha256}`);
    }
  }
  console.log(`  revisions: ${summary.revisionIds.join(', ') || '(none)'}`);
  if (detail.plan) {
    console.log(`  latest plan: revision ${detail.plan.revisionId ?? '(none)'}`);
    // The revision's own content digest, which the machine form has always
    // carried. A digest a program can read and a person cannot is exactly the
    // asymmetry "both forms agree" forbids.
    if (detail.plan.revision) {
      console.log(`  plan digest: ${detail.plan.revision.contentSha256}`);
    }
    if (detail.plan.diagnostic !== null) {
      console.log(`  plan PROBLEM: ${detail.plan.diagnostic}`);
    }
  }
  // The tri-axis projection, node by node — the answer to "where is this
  // Issue right now" the record's operator-declared state never carried.
  if (status !== undefined) {
    renderIssueStatus(status);
    // The acceptance section sits beside the status block: conditions, the
    // gate, and the record — visible before the gate is crossed (D8).
    renderAcceptanceSection(status);
  }
  if (detail.unsearchedRefs.length > 0) {
    console.log('');
    console.log(`INCOMPLETE: ${detail.unsearchedRefs.length} ref(s) could not be read.`);
    // The per-ref reason, as the list rendering already does. An unreadable
    // ref is never absence, so the reason is the whole point of the report.
    for (const ref of detail.unsearchedRefs) {
      console.log(`  ${ref.targetLineId} (${ref.storeRef}): ${ref.reason}`);
    }
  }
  renderProblems(detail.problems);
}

// -----------------------------------------------------------------------------
// Launch binding (`start`)
// -----------------------------------------------------------------------------

/**
 * The launch contract in human form. Renderers stay English-literal per this
 * file's convention; both forms carry the same facts (`--json` wraps the
 * binding object unchanged).
 */
function renderLaunchBinding(binding: IssueLaunchBinding): void {
  const modeHead =
    binding.mode === 'fresh'
      ? 'fresh launch'
      : binding.mode === 'already-running'
        ? 'already running (resume-oriented)'
        : 'already complete';
  console.log(`Issue ${binding.issueId} node ${binding.nodeId} — ${modeHead}`);
  console.log(`  change: ${binding.alias ?? '(no alias)'} (${binding.changeInstanceId})`);
  console.log(`  project: ${binding.projectId}  target-line: ${binding.targetLineId}`);
  if (binding.launch !== null) {
    console.log(`  binding: ${binding.launch.form}`);
    console.log(`    cwd: ${binding.launch.cwd}`);
    if (binding.launch.attachedRoots.length > 0) {
      console.log(`    attached: ${binding.launch.attachedRoots.join(', ')}`);
    }
  } else if (binding.mode === 'already-complete') {
    console.log("  no launch contract: the node's work is complete.");
  } else if (binding.launchDiagnostic !== undefined) {
    console.log(`  no launch contract: ${binding.launchDiagnostic}`);
  }
  // A contract that names a pipeline names where it came from — the operator's
  // flag, the run-state's recording, or the plan revision's suggestion — so a
  // suggestion the operator overrode reads as their deliberate choice.
  const pipelineSource =
    binding.pipeline === null || binding.pipelineSource === null
      ? ''
      : binding.pipelineSource === 'operator'
        ? ' (the operator’s choice)'
        : binding.pipelineSource === 'run-state'
          ? ' (recorded in run-state)'
          : ' (from the plan’s suggestion)';
  console.log(`  pipeline: ${binding.pipeline ?? '(chosen at launch)'}${pipelineSource}`);
  if (binding.runStatePath !== null) {
    const located = binding.locatedBy === null ? '' : ` (located by ${binding.locatedBy})`;
    console.log(`  run-state: ${binding.runStatePath}${located}`);
  }
}

/** A binding refusal surfaces with its own taxonomy code, not a generic one. */
function refusalError(refusal: IssueStartRefusal): StoreError {
  const fix = refusalFix(refusal);
  return new StoreError(refusal.message, refusal.code, fix === undefined ? {} : { fix });
}

/**
 * The confirm report in human form: the launchable contract set, the pending
 * Change creation, the nodes waiting on dependency work, and any unprepared
 * binding with its preparation — the same facts the JSON form carries under
 * `report`. Both forms close with the same statement: confirm composes and
 * writes nothing; starting a node remains the operator's per-node act.
 */
function renderConfirmReport(report: IssueConfirmReport): void {
  console.log(`Issue ${report.issueId} — confirm report (revision ${report.revisionId})`);
  console.log(`  launchable: ${report.contracts.length}`);
  for (const binding of report.contracts) {
    console.log('');
    renderLaunchBinding(binding);
  }
  console.log('');
  console.log(`  pending Change creation: ${report.pendingChanges.length}`);
  for (const pending of report.pendingChanges) {
    const lifecycle = pending.lifecycle === 'required' ? '' : ` (${pending.lifecycle})`;
    const suggestion = pending.suggestedPipeline === null ? '' : ` — suggest: ${pending.suggestedPipeline}`;
    console.log(`    ${pending.nodeId}${lifecycle}: ${pending.projectId}/${pending.targetLineId}${suggestion}`);
    console.log(`      ${pending.summary}`);
  }
  if (report.waiting.length > 0) {
    console.log(`  waiting on dependency work: ${report.waiting.length}`);
    for (const waiting of report.waiting) {
      console.log(`    ${waiting.nodeId}: ${waiting.reason}`);
    }
  }
  if (report.unprepared.length > 0) {
    console.log(`  unprepared (no launch binding yet): ${report.unprepared.length}`);
    for (const unprepared of report.unprepared) {
      console.log(`    ${unprepared.nodeId}: ${unprepared.reason}`);
      if (unprepared.preparation !== null) {
        console.log(`      prepare: ${unprepared.preparation}`);
      }
    }
  }
  console.log('');
  console.log('  wrote nothing — confirm composes; starting a node remains a per-node act.');
}

// -----------------------------------------------------------------------------
// The ready answer (`ready`)
// -----------------------------------------------------------------------------

/** One ready member's human line — the same facts the node line carries. */
function renderReadyMember(member: IssueReadyMember): string {
  const head =
    member.alias === null
      ? `${member.nodeId} change ${member.projectId}`
      : `${member.nodeId} change ${member.projectId} ${member.alias}`;
  const parts = [head];
  if (member.lifecycle !== 'required') parts.push(`(${member.lifecycle})`);
  if (member.suggestedPipeline !== null) parts.push(`(suggest: ${member.suggestedPipeline})`);
  return `    ${parts.join(' ')}`;
}

/** One exit reason's human text — the closed vocabulary is total, so is this. */
function renderReadyExit(reason: IssueReadyExit): string {
  switch (reason.kind) {
    case 'cancelled':
      return reason.reason === null ? 'cancelled' : `cancelled (${reason.reason})`;
    case 'superseded':
      return reason.reason === null ? 'superseded' : `superseded (${reason.reason})`;
    case 'pending-change-creation':
      return `pending Change creation (${reason.projectId}/${reason.targetLineId})`;
    case 'running':
      return `running (${reason.observation})`;
    case 'failed':
      return 'failed';
    case 'complete':
      return reason.basis === null ? 'complete' : `complete — ${reason.basis}`;
    case 'blocked':
      return `blocked (${reason.blockers
        .map(blocker => `${blocker.nodeId}@${blocker.projectId}: ${blocker.state}`)
        .join(', ')})`;
    case 'unknown':
      return `unknown (${reason.diagnostic ?? 'its reference or run-state could not be read'})`;
  }
}

/**
 * The ready answer in human form: the members, every non-member with its exit
 * reason, the run-state visibility label, and the status problems — the same
 * facts the `--json` form carries under `ready`. Reading writes nothing, and
 * the answer says so: a node's start remains a per-node act.
 */
function renderReadyAnswer(
  issueId: string,
  revisionId: string,
  ready: IssueReadySet,
  status: IssueStatus
): void {
  console.log(`Issue ${issueId} — ready set (revision ${revisionId})`);
  console.log(`  ready: ${ready.members.length}`);
  for (const member of ready.members) console.log(renderReadyMember(member));
  console.log(`  not ready: ${ready.exits.length}`);
  for (const exit of ready.exits) {
    console.log(`    ${exit.nodeId}: ${renderReadyExit(exit.reason)}`);
  }
  console.log(`  ${renderRunStateVisibility(status)}`);
  renderStatusProblems(status.problems);
  console.log('');
  console.log('  wrote nothing — ready derives; starting a node remains a per-node act.');
}

export function registerStoreIssueCommand(store: Command): void {
  const issue = store.command('issue').description('');

  issue
    .command('new <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--title <title>', '')
    .option('--readme', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        if (options.title === undefined) {
          throw issueError(
            'issue_scope_required',
            "Creating an Issue requires --title; an Issue's title is never inferred.",
            { fix: 'Add --title "<short description>".' }
          );
        }
        const result = await StoreIssuesModuleInstance.create({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          title: options.title,
          ...(options.readme === true ? { readme: true } : {}),
        });
        if (options.json) printJson(issuePayload(result));
        else renderIssueWrite(result);
      } catch (error) {
        emitFailure(options.json, { record: null }, error, 'store_issue_create_failed');
      }
    });

  issue
    .command('list')
    .description('')
    .option('--store <id>', '')
    .option('--state <state>', '')
    .option('--json', '')
    .action(async (options: StoreIssueOptions) => {
      try {
        // A state outside the defined vocabulary filters to nothing, which
        // reads as "no Issues" rather than as "that is not a state". Refused
        // here naming the vocabulary, the same way the mutation surface
        // refuses an undefined state rather than storing it.
        if (options.state !== undefined && !ISSUE_STATES.includes(options.state as IssueState)) {
          throw new StoreError(
            `'${options.state}' is not a defined Issue state.`,
            'issue_state_undefined',
            { fix: `Filter with --state ${ISSUE_STATES.join('|')}, or omit --state.` }
          );
        }
        const page = await StoreAggregateQuery.listIssues({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          ...(options.state === undefined ? {} : { state: options.state as IssueState }),
        });
        const scope = {
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
        };
        const context = await resolveProjectionContext();
        const widening = await resolveStoreWideningContext(options.store);
        const statuses: IssueStatus[] = [];
        for (const summary of page.issues) {
          const detail = await detailForList(scope, summary, page);
          // Done follows the recorded acceptance, so the list's phase needs
          // each Issue's acceptance facts exactly as show's does.
          const acceptance = await readIssueAcceptanceFacts({
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
            issueId: summary.issueId,
          });
          statuses.push(
            await projectIssueStatus(statusInputFor(detail, { ...context, ...widening, acceptance }))
          );
        }
        if (options.json) {
          printJson({
            issues: page.issues.map((summary, index) => ({ ...summary, status: statuses[index] })),
            complete: page.complete,
            unsearchedRefs: page.unsearchedRefs,
            problems: page.problems,
          });
          return;
        }
        renderIssueList(page, statuses);
      } catch (error) {
        emitFailure(options.json, { issues: [] }, error, 'store_issue_list_failed');
      }
    });

  issue
    .command('show <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        const detail = await StoreAggregateQuery.showIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
        });
        const status = await projectIssueStatus(
          statusInputFor(detail, {
            ...(await resolveProjectionContext()),
            ...(await resolveStoreWideningContext(options.store)),
            acceptance: await readIssueAcceptanceFacts({
              ...(options.store === undefined ? {} : { store: options.store }),
              startPath: process.cwd(),
              issueId,
            }),
            // The predecessor the latest revision supersedes, for the revision
            // delta — resolved only when there is one; a first revision
            // contributes nothing and reports no delta section.
            predecessorPlan: await resolvePredecessorPlan(
              {
                ...(options.store === undefined ? {} : { store: options.store }),
                startPath: process.cwd(),
              },
              issueId,
              detail.plan?.revision?.supersedes ?? null
            ),
          })
        );
        if (options.json) {
          printJson({
            issue: detail.issue,
            plan: detail.plan,
            status,
            complete: detail.complete,
            unsearchedRefs: detail.unsearchedRefs,
            problems: detail.problems,
          });
          return;
        }
        renderIssueDetail(detail, status);
      } catch (error) {
        emitFailure(options.json, { issue: null }, error, 'store_issue_show_failed');
      }
    });

  issue
    .command('state <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--state <state>', '')
    .option('--reason <reason>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        if (options.state === undefined) {
          throw new StoreError(
            "Transitioning an Issue's state requires --state.",
            'issue_state_required',
            { fix: 'Add --state open|resolved|dropped.' }
          );
        }
        const result = await StoreIssuesModuleInstance.setState({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          state: options.state as IssueState,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        });
        if (options.json) printJson(issuePayload(result));
        else renderIssueWrite(result);
      } catch (error) {
        emitFailure(options.json, { record: null }, error, 'store_issue_state_failed');
      }
    });

  issue
    .command('plan <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--from-file <path>', '')
    .option('--from-portfolio <parent>', '')
    .option('--from-decomposition <path>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        // A publication takes exactly one of its three sources, and the
        // refusal names them: the three answer different questions (a
        // hand-authored node list, a compiled portfolio run, a
        // machine-proposed decomposition), and guessing a default would
        // publish a plan the operator never chose.
        const sources = [
          ['--from-file', options.fromFile],
          ['--from-portfolio', options.fromPortfolio],
          ['--from-decomposition', options.fromDecomposition],
        ] as const;
        const given = sources.filter(([, value]) => value !== undefined).map(([flag]) => flag);
        const chooseOne =
          'Choose one: --from-file <path to a YAML file with a nodes: list>, --from-portfolio <parent change name>, or --from-decomposition <path to a decomposition document>.';
        if (given.length > 1) {
          const together = given.length === 2 ? 'were both given' : 'were all given';
          throw new StoreError(
            `A plan publication takes exactly one source; ${given.join(' and ')} ${together}.`,
            'issue_plan_source_conflict',
            { fix: chooseOne }
          );
        }
        if (given.length === 0) {
          throw new StoreError(
            'A plan publication requires exactly one source; none of --from-file, --from-portfolio, or --from-decomposition was given.',
            'issue_plan_source_required',
            { fix: chooseOne }
          );
        }
        // The suggestion registry seam, composed ONCE for every source — the
        // same root-aware membership test `store issue start --pipeline`
        // validates through (pipelines visible from the root this command
        // runs in, project-local layers included).
        const context = await resolveProjectionContext();
        const pipelineKnown = (name: string): boolean =>
          listPipelines(context.projectRoot).includes(name.replace(/\.ya?ml$/, ''));
        if (options.fromPortfolio !== undefined) {
          const result = await publishPlanFromPortfolio({
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
            issueId,
            parent: options.fromPortfolio,
          });
          if (options.json) {
            printJson({
              ...(planPayload(result) as Record<string, unknown>),
              source: result.source,
            });
          } else {
            renderPlanWrite(result, portfolioSourceLine(result));
          }
          return;
        }
        if (options.fromDecomposition !== undefined) {
          const result = await publishPlanFromDecomposition({
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
            issueId,
            documentPath: options.fromDecomposition,
            pipelineKnown,
          });
          if (options.json) {
            printJson({
              ...(planPayload(result) as Record<string, unknown>),
              source: result.source,
            });
          } else {
            renderPlanWrite(result, decompositionSourceLine(result));
          }
          return;
        }
        const draft = parseYaml(fs.readFileSync(options.fromFile as string, 'utf8')) as {
          nodes?: readonly ExecutionPlanNodeInput[];
        };
        const result = await StoreIssuesModuleInstance.publishPlan({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          nodes: draft.nodes ?? [],
          pipelineKnown,
        });
        if (options.json) printJson(planPayload(result));
        else renderPlanWrite(result);
      } catch (error) {
        emitFailure(options.json, { revision: null }, error, 'store_issue_plan_failed');
      }
    });

  issue
    .command('acceptance <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--from-file <path>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        if (options.fromFile === undefined) {
          throw issueError(
            'issue_acceptance_from_file_required',
            'Publishing acceptance conditions requires --from-file.',
            { fix: 'Add --from-file <path to a YAML file with a conditions: list>.' }
          );
        }
        const draft = parseYaml(fs.readFileSync(options.fromFile, 'utf8')) as {
          conditions?: readonly AcceptanceConditionInput[];
        };
        if (draft.conditions === undefined) {
          throw issueError(
            'issue_acceptance_conditions_list_required',
            'An acceptance conditions file must carry a conditions: list.',
            { fix: 'Author the file as "conditions:" followed by one "- id/requirement" item per condition.' }
          );
        }
        const result = await StoreIssuesModuleInstance.publishAcceptance({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          conditions: draft.conditions,
        });
        if (options.json) printJson(acceptancePayload(result));
        else renderAcceptanceWrite(result);
      } catch (error) {
        emitFailure(options.json, { revision: null }, error, 'store_issue_acceptance_failed');
      }
    });

  issue
    .command('accept <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--note <note>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        // Evaluate FRESH from this working directory's run-state, then write
        // under the lock with the evaluated snapshot (design D6) — the same
        // machine-local context resolution every read command here performs.
        const context = await resolveProjectionContext();
        const widening = await resolveStoreWideningContext(options.store);
        const result = await acceptIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          ...(options.note === undefined ? {} : { note: options.note }),
          projection: { ...context, ...widening },
        });
        if (options.json) printJson(acceptPayload(result));
        else renderAcceptWrite(result);
      } catch (error) {
        emitFailure(options.json, { record: null }, error, 'store_issue_accept_failed');
      }
    });

  issue
    .command('start <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--node <nodeId>', '')
    .option('--pipeline <name>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        const detail = await StoreAggregateQuery.showIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
        });
        const context = await resolveProjectionContext();
        const widening = await resolveStoreWideningContext(options.store);
        const status = await projectIssueStatus(
          statusInputFor(detail, { ...context, ...widening })
        );
        // The member-project checkout route is the SAME session-launch
        // composition a supervised session uses, addressed by the Store's
        // permanent identity so a display-name collision can never resolve
        // the wrong Store's membership.
        const launchContextFor = (projectId: string) =>
          resolveSessionLaunchContext({
            ...(widening.storeUid === undefined ? {} : { space: `store:${widening.storeUid}` }),
            execution: `project:${projectId}`,
            launchProject: null,
          });
        // Root-aware pipeline validation: the pipelines visible from the root
        // this command runs in (project-local layers included).
        const pipelineKnown = (name: string) =>
          listPipelines(context.projectRoot).includes(name.replace(/\.ya?ml$/, ''));
        const result = await resolveIssueLaunchBinding({
          detail,
          status,
          workspaceEntries: widening.workspaceEntries ?? [],
          launchContextFor,
          ...(options.pipeline === undefined ? {} : { pipeline: options.pipeline, pipelineKnown }),
          ...(options.node === undefined ? {} : { nodeId: options.node }),
          ...(widening.storeId === undefined ? {} : { storeId: widening.storeId }),
        });
        if (!result.ok) throw refusalError(result.refusal);
        if (options.json) printJson({ issueId, binding: result.binding });
        else renderLaunchBinding(result.binding);
      } catch (error) {
        emitFailure(options.json, { issue: null, binding: null }, error, 'store_issue_start_failed');
      }
    });

  issue
    .command('confirm <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--revision <id>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        // The revision confirm composes from: the named one, or the latest
        // readable one. `--revision` re-resolves through the same query and
        // replaces the detail's plan, so both paths feed one composition.
        const summaryDetail = await StoreAggregateQuery.showIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
        });
        const detail: IssueDetail =
          options.revision === undefined
            ? summaryDetail
            : {
                ...summaryDetail,
                plan: await StoreAggregateQuery.resolveExecutionPlan({
                  ...(options.store === undefined ? {} : { store: options.store }),
                  startPath: process.cwd(),
                  issueId,
                  revisionId: options.revision,
                }),
              };
        const context = await resolveProjectionContext();
        const widening = await resolveStoreWideningContext(options.store);
        const status = await projectIssueStatus(
          statusInputFor(detail, { ...context, ...widening })
        );
        const launchContextFor = (projectId: string) =>
          resolveSessionLaunchContext({
            ...(widening.storeUid === undefined ? {} : { space: `store:${widening.storeUid}` }),
            execution: `project:${projectId}`,
            launchProject: null,
          });
        const result = await composeIssueConfirm({
          detail,
          status,
          workspaceEntries: widening.workspaceEntries ?? [],
          launchContextFor,
          ...(options.revision === undefined ? {} : { requestedRevisionId: options.revision }),
        });
        if (!result.ok) {
          const fix =
            result.refusal.code === 'issue_confirm_requires_plan'
              ? 'Publish an Execution Plan revision first: '
                + '`rasen store issue plan <issue-id> --store <store> --from-file <nodes.yaml>` (or --from-decomposition / --from-portfolio).'
              : result.refusal.code === 'issue_confirm_revision_unreadable'
                ? `Read the Issue's revision ordinals first: \`rasen store issue show ${issueId} --store <store>\`, or omit --revision to confirm the latest.`
                : null;
          throw new StoreError(
            result.refusal.message,
            result.refusal.code,
            fix === null ? {} : { fix }
          );
        }
        if (options.json) {
          printJson({ issueId, revisionId: result.report.revisionId, report: result.report });
        } else {
          renderConfirmReport(result.report);
        }
      } catch (error) {
        emitFailure(options.json, { issue: null, report: null }, error, 'store_issue_confirm_failed');
      }
    });

  issue
    .command('ready <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        // Read-only, latest revision only: the scheduler schedules the latest,
        // and addressing an older ordinal is the show and confirm surfaces'
        // concern — hence no --revision here at all.
        const detail = await StoreAggregateQuery.showIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
        });
        const context = await resolveProjectionContext();
        const widening = await resolveStoreWideningContext(options.store);
        const status = await projectIssueStatus(
          statusInputFor(detail, { ...context, ...widening })
        );
        const ready = deriveIssueReadySet(status);
        if (ready === null) {
          // The same refusal shape start/confirm share: no readable revision
          // is a planning truth, not an execution one — "no readable plan" and
          // "nothing runnable" are different answers.
          throw new StoreError(
            `Issue ${issueId} has no readable published Execution Plan revision; `
              + 'the planning phase and its publish action precede scheduling.',
            'issue_ready_requires_plan',
            {
              fix:
                'Publish an Execution Plan revision first: '
                + '`rasen store issue plan <issue-id> --store <store> --from-file <nodes.yaml>` (or --from-decomposition / --from-portfolio).',
            }
          );
        }
        const revisionId = detail.plan?.revisionId ?? null;
        if (options.json) {
          printJson({
            issueId,
            revisionId,
            ready,
            runStateVisibility: status.runStateVisibility,
            problems: status.problems,
          });
          return;
        }
        renderReadyAnswer(issueId, revisionId ?? '(none)', ready, status);
      } catch (error) {
        emitFailure(options.json, { ready: null }, error, 'store_issue_ready_failed');
      }
    });
}
