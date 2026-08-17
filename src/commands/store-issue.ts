/**
 * `rasen store issue new|list|show|state|plan|start` — the CLI for the
 * Store-level Issue Module (`StoreIssues`) and the Issue-facing slice of the
 * aggregate query (`StoreAggregateQuery.{listIssues,showIssue}`).
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
  type ExecutionPlanNodeInput,
  type ExecutionPlanResult,
  type IssueRecordResult,
  type IssueState,
  type SuggestedIssueCommit,
} from '../core/store/issues/index.js';
import {
  StoreAggregateQuery,
  nodeStoreQueryFileSystem,
  productionStoreQueryDependencies,
  resolveQueryStore,
  type AggregateProblem,
  type IssueDetail,
  type IssueSummary,
  type IssueSummaryPage,
} from '../core/store/query/index.js';
import {
  listAllWorkspaceIndexEntries,
  type WorkspaceIndexEntry,
} from '../core/store/workspace/registry.js';
import { listPipelines } from '../core/pipeline-registry/resolver.js';
import { resolveSessionLaunchContext } from '../core/management-api/session-launch-context.js';
import {
  projectIssueStatus,
  type IssueStatus,
  type IssueStatusProblem,
  type ProjectIssueStatusInput,
} from '../core/issue-status/index.js';
import {
  refusalFix,
  resolveIssueLaunchBinding,
  type IssueLaunchBinding,
  type IssueStartRefusal,
} from '../core/issue-execution/index.js';
import {
  resolvedExecutionProjectRoot,
  resolveOpenSpecRoot,
} from '../core/root-selection.js';
import { emitFailure, printJson } from './shared-output.js';

export interface StoreIssueOptions {
  store?: string;
  title?: string;
  readme?: boolean;
  state?: string;
  reason?: string;
  fromFile?: string;
  node?: string;
  pipeline?: string;
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

function renderPlanWrite(result: ExecutionPlanResult): void {
  console.log(`Issue ${result.issueId}: Execution Plan revision ${result.revision.revisionId}`);
  console.log(`  supersedes: ${result.revision.supersedes ?? '(none)'}`);
  console.log(`  nodes: ${result.revision.nodes.length}`);
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
 */
async function resolveProjectionContext(): Promise<{
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

function statusInputFor(
  detail: IssueDetail,
  context: {
    executionRoot?: string;
    changesDir?: string;
    storeRoot?: string;
    workspaceEntries?: readonly WorkspaceIndexEntry[];
  }
): ProjectIssueStatusInput {
  return {
    detail,
    ...(context.executionRoot === undefined ? {} : { executionRoot: context.executionRoot }),
    ...(context.changesDir === undefined ? {} : { changesDir: context.changesDir }),
    ...(context.storeRoot === undefined ? {} : { storeRoot: context.storeRoot }),
    ...(context.workspaceEntries === undefined ? {} : { workspaceEntries: context.workspaceEntries }),
  };
}

/**
 * The Store-scoped widening inputs, gathered ONCE per command: the resolved
 * Store's registered root (the store-side active-change address for evidence
 * locators) and the machine workspace index entries filtered to that Store's
 * uid — exactly the storeUid-first filter `gatherReferenceEvidence` applies,
 * so an index entry from another Store can never masquerade as this one's.
 * Returns an empty widening when no `--store` was given; the Store-scoped
 * query itself refuses that case before any of this matters.
 */
async function resolveStoreWideningContext(
  store: string | undefined
): Promise<{
  storeId?: string;
  storeUid?: string;
  storeRoot?: string;
  workspaceEntries?: readonly WorkspaceIndexEntry[];
}> {
  if (store === undefined) return {};
  const resolved = await resolveQueryStore({ fs: nodeStoreQueryFileSystem }, { store });
  const workspaceEntries = (
    await listAllWorkspaceIndexEntries(productionStoreQueryDependencies.coordination())
  ).filter(entry => entry.storeUid === resolved.storeUid);
  return {
    storeId: resolved.storeId,
    storeUid: resolved.storeUid,
    storeRoot: resolved.registeredRoot,
    workspaceEntries,
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

function renderRunStateVisibility(status: IssueStatus): string {
  return status.runStateVisibility.kind === 'execution-root'
    ? `run-state: ${status.runStateVisibility.executionRoot}`
    : 'run-state: none visible from this directory';
}

/**
 * The per-node line the show command prints: identifier, kind, alias,
 * observation, then whatever explains it — a dependency that has not
 * finalized, or the diagnostic behind an `unknown`.
 */
function renderStatusNode(node: IssueStatus['nodes'][number]): string {
  const head =
    node.alias === null
      ? `${node.nodeId} ${node.kind} — ${node.observation}`
      : `${node.nodeId} ${node.kind} ${node.alias} — ${node.observation}`;
  const parts = [head];
  if (node.blockedBy.length > 0) parts.push(`(blockedBy ${node.blockedBy.join(', ')})`);
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

function renderIssueStatus(status: IssueStatus): void {
  console.log('  status:');
  console.log(`    phase: ${status.phase}`);
  console.log(`    health: ${status.health}`);
  console.log(`    progress: ${renderProgress(status)}`);
  console.log(`    ${renderRunStateVisibility(status)}`);
  if (status.nodes.length > 0) {
    console.log('    nodes:');
    for (const node of status.nodes) {
      console.log(renderStatusNode(node));
      for (const line of renderAttributionLines(node)) console.log(line);
    }
  }
  renderStatusProblems(status.problems);
}

function renderIssueList(page: IssueSummaryPage, statuses: readonly IssueStatus[] = []): void {
  if (page.issues.length === 0) {
    console.log('No Issues found.');
  }
  page.issues.forEach((summary, index) => {
    const state = summary.record?.state ?? (summary.divergence ? '(divergent)' : '(unknown)');
    const title = summary.record?.title ?? '';
    const status = statuses[index];
    const statusSegment =
      status === undefined ? '' : `  ${status.phase}/${status.health} ${renderProgress(status)}`;
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
  if (status !== undefined) renderIssueStatus(status);
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
  console.log(`  pipeline: ${binding.pipeline ?? '(chosen at launch)'}`);
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
          statuses.push(await projectIssueStatus(statusInputFor(detail, { ...context, ...widening })));
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
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        if (options.fromFile === undefined) {
          throw new StoreError(
            'Publishing an Execution Plan revision requires --from-file.',
            'issue_plan_from_file_required',
            { fix: 'Add --from-file <path to a YAML file with a nodes: list>.' }
          );
        }
        const draft = parseYaml(fs.readFileSync(options.fromFile, 'utf8')) as {
          nodes?: readonly ExecutionPlanNodeInput[];
        };
        const result = await StoreIssuesModuleInstance.publishPlan({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          nodes: draft.nodes ?? [],
        });
        if (options.json) printJson(planPayload(result));
        else renderPlanWrite(result);
      } catch (error) {
        emitFailure(options.json, { revision: null }, error, 'store_issue_plan_failed');
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
}
