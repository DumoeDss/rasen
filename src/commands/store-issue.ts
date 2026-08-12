/**
 * `rasen store issue new|list|show|plan|state` — the consumer adapter for the
 * Store-level Issue Module.
 *
 * An Issue is Store-level cross-project INTENT that references project Changes
 * and owns none of them. Every command in this group takes `--store` and
 * refuses to require `--project` or `--target-line`: an Issue spans projects by
 * construction, so demanding one would contradict the resource. `--project` and
 * `--target-line` appear only on `plan`, where they describe A NODE's scope, and
 * are never read as the command's own scope.
 *
 * Issue content is Git-tracked Store content, so every write prints a
 * pathspec-scoped commit suggestion and stages, commits, fetches, and pushes
 * nothing.
 */
import { Command } from 'commander';

import { StoreError } from '../core/store/errors.js';
import { StoreIssuesModule } from '../core/store/issues/index.js';
import type {
  ExecutionPlanNodeInput,
  ExecutionPlanResult,
  IssueRecordResult,
  IssueState,
} from '../core/store/issues/index.js';
import { StoreAggregateQuery } from '../core/store/query/index.js';
import type {
  IssueDetail,
  IssueSummary,
  IssueSummaryPage,
  ResolvedExecutionPlan,
  UnsearchedRef,
} from '../core/store/query/index.js';
import { asErrorMessage, printJson } from './shared-output.js';

export interface StoreIssueOptions {
  store?: string;
  title?: string;
  readme?: boolean;
  state?: string;
  reason?: string;
  project?: string;
  targetLine?: string;
  addChange?: string[];
  addIntent?: string[];
  dependsOn?: string[];
  fromFile?: string;
  revision?: string;
  json?: boolean;
}

function fail(json: boolean | undefined, error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  if (json) {
    printJson({ issue: null, status: [diagnostic] });
  } else {
    console.error(asErrorMessage(diagnostic.message));
    if (diagnostic.fix) console.error(`  fix: ${diagnostic.fix}`);
  }
  process.exitCode = 1;
}

function unsearchedLines(refs: readonly UnsearchedRef[], complete: boolean): void {
  if (complete) return;
  console.log('');
  console.log(`  INCOMPLETE: ${refs.length} store ref(s) could not be searched`);
  for (const ref of refs) {
    console.log(`    ${ref.storeRef} (${ref.targetLineId}): ${ref.reason}`);
  }
}

function writeReportPayload(result: IssueRecordResult | ExecutionPlanResult): unknown {
  return {
    issueId: result.issueId,
    storeId: result.storeId,
    storeUid: result.storeUid,
    checkoutRoot: result.checkoutRoot,
    checkoutRef: result.checkoutRef,
    written: result.written,
    suggestedCommits: result.suggestedCommits,
  };
}

function renderWriteReport(result: IssueRecordResult | ExecutionPlanResult): void {
  console.log(`  checkout: ${result.checkoutRoot}`);
  console.log(`  ref: ${result.checkoutRef ?? '(detached)'}`);
  for (const written of result.written) console.log(`  wrote: ${written}`);
  for (const suggestion of result.suggestedCommits) {
    console.log('');
    console.log(`  ${suggestion.rationale}`);
    console.log(
      `    git -C ${suggestion.repoRoot} commit -m ${JSON.stringify(
        suggestion.message
      )} -- ${suggestion.pathspecs.join(' ')}`
    );
  }
}

function summaryPayload(issue: IssueSummary): unknown {
  return {
    issueId: issue.issueId,
    record: issue.record,
    divergence: issue.divergence,
    revisionIds: issue.revisionIds,
    latestRevisionId: issue.latestRevisionId,
    refs: issue.refs,
    uncommitted: issue.uncommitted,
  };
}

function renderSummary(issue: IssueSummary): void {
  if (issue.divergence !== null) {
    console.log(`  ${issue.issueId}  DIVERGENT across ${issue.divergence.copies.length} copies`);
    for (const copy of issue.divergence.copies) {
      console.log(`    ${copy.storeRef ?? '(working tree)'}: ${copy.sha256.slice(0, 12)}`);
    }
    return;
  }
  const record = issue.record;
  const state = record === null ? 'UNREADABLE' : record.state;
  const title = record === null ? '(record does not validate)' : record.title;
  console.log(
    `  ${issue.issueId}  [${state}]${issue.uncommitted ? ' (uncommitted)' : ''}  ${title}`
  );
  console.log(
    `    revisions: ${issue.revisionIds.length === 0 ? '(none)' : issue.revisionIds.join(', ')}`
  );
}

function renderPlan(plan: ResolvedExecutionPlan): void {
  if (plan.revision === null) {
    console.log(
      `  no readable Execution Plan revision${plan.diagnostic === null ? '' : `: ${plan.diagnostic}`}`
    );
    return;
  }
  console.log(
    `  plan ${plan.revisionId}${
      plan.revision.supersedes === null ? '' : ` (supersedes ${plan.revision.supersedes})`
    }`
  );
  for (const entry of plan.readiness.nodes) {
    const node = entry.node;
    const scope = `${node.projectId}/${node.targetLineId}`;
    const identity =
      node.kind === 'change' ? node.changeInstanceId : `intent: ${node.summary}`;
    console.log(`    ${node.nodeId} [${node.kind}] ${scope}`);
    console.log(`      ${identity}`);
    console.log(
      `      state: ${entry.resolution.status}, readiness: ${entry.readiness}${
        entry.resolution.outcome === null ? '' : `, outcome: ${entry.resolution.outcome}`
      }`
    );
    if (entry.resolution.status === 'ambiguous') {
      for (const claimant of entry.resolution.claimants) {
        console.log(
          `      claimant: ${claimant.projectId}/${claimant.changeId} at ${claimant.foundAtRef}`
        );
      }
    }
    if (entry.resolution.status === 'unresolved') {
      console.log(
        `      searched: ${entry.resolution.searchedRefs.join(', ') || '(no readable ref)'}`
      );
    }
    if (entry.blockedBy.length > 0) {
      console.log(`      blocked by: ${entry.blockedBy.join(', ')}`);
    }
    if (node.kind === 'change' && node.changeAlias !== undefined) {
      console.log(`      alias (never resolved by): ${node.changeAlias}`);
    }
  }
  console.log(`  ready to resolve: ${plan.readiness.readyToResolve ? 'yes' : 'no'}`);
}

function planPayload(plan: ResolvedExecutionPlan): unknown {
  return {
    issueId: plan.issueId,
    revisionId: plan.revisionId,
    revision: plan.revision,
    diagnostic: plan.diagnostic,
    readiness: plan.readiness,
    unsearchedRefs: plan.unsearchedRefs,
    complete: plan.complete,
  };
}

/**
 * Parses `--add-change nodeId=instance[,alias]` and
 * `--add-intent nodeId=summary`, both scoped by the `--project` /
 * `--target-line` that PRECEDE them logically. A node's scope is explicit here
 * for the same reason it is explicit in the record: ownership is declared from
 * the first draft.
 */
function parseNodes(options: StoreIssueOptions): readonly ExecutionPlanNodeInput[] {
  const project = options.project;
  const targetLine = options.targetLine;
  const dependsOn = options.dependsOn ?? [];
  const nodes: ExecutionPlanNodeInput[] = [];

  const requireScope = (): { projectId: string; targetLineId: string } => {
    if (project === undefined || targetLine === undefined) {
      throw new StoreError(
        'Every plan node names its project and its target line, whether or not its Change exists yet.',
        'issue_scope_required',
        {
          target: 'node.scope',
          fix: 'Add --project <id> and --target-line <id>; they scope the NODE, never the Issue.',
        }
      );
    }
    return { projectId: project, targetLineId: targetLine };
  };

  for (const raw of options.addChange ?? []) {
    const [nodeId, rest] = splitOnce(raw, '=');
    const [changeInstanceId, changeAlias] = splitOnce(rest, ',');
    const scope = requireScope();
    nodes.push({
      nodeId,
      kind: 'change',
      ...scope,
      changeInstanceId,
      ...(changeAlias.length === 0 ? {} : { changeAlias }),
      dependsOn: dependenciesFor(nodeId, dependsOn),
    });
  }
  for (const raw of options.addIntent ?? []) {
    const [nodeId, summary] = splitOnce(raw, '=');
    const scope = requireScope();
    nodes.push({
      nodeId,
      kind: 'intent',
      ...scope,
      summary,
      dependsOn: dependenciesFor(nodeId, dependsOn),
    });
  }
  return nodes;
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  if (index < 0) return [value, ''];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

/** `--depends-on nodeId:dependencyId` entries, grouped by the node they name. */
function dependenciesFor(nodeId: string, raw: readonly string[]): readonly string[] {
  return raw
    .map(entry => splitOnce(entry, ':'))
    .filter(([owner]) => owner === nodeId)
    .map(([, dependency]) => dependency)
    .filter(dependency => dependency.length > 0);
}

async function readNodesFromFile(filePath: string): Promise<readonly ExecutionPlanNodeInput[]> {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('yaml');
  const text = await readFile(filePath, 'utf8');
  const parsed = parse(text) as { nodes?: unknown } | null;
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : parsed;
  if (!Array.isArray(nodes)) {
    throw new StoreError(
      `${filePath} does not contain a node list.`,
      'invalid_execution_plan',
      { target: filePath, fix: 'Provide a YAML document with a top-level `nodes:` list.' }
    );
  }
  return nodes as readonly ExecutionPlanNodeInput[];
}

export function registerStoreIssueCommand(store: Command): void {
  const issue = store.command('issue').description('');
  const issues = new StoreIssuesModule();

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
          throw new StoreError(
            'An Issue records a title so a cross-project intent is legible without opening its plan.',
            'issue_scope_required',
            { target: 'title', fix: 'Add --title "<what this work is>".' }
          );
        }
        const result = await issues.create({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          title: options.title,
          ...(options.readme === true ? { readme: true } : {}),
        });
        if (options.json) {
          printJson({ ...(writeReportPayload(result) as object), record: result.record });
        } else {
          console.log(`Issue ${result.issueId} opened in store ${result.storeId}`);
          renderWriteReport(result);
        }
      } catch (error) {
        fail(options.json, error, 'store_issue_new_failed');
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
        const page: IssueSummaryPage = await StoreAggregateQuery.listIssues({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          ...(options.state === undefined ? {} : { state: options.state as IssueState }),
        });
        if (options.json) {
          printJson({
            issues: page.issues.map(summaryPayload),
            unsearchedRefs: page.unsearchedRefs,
            complete: page.complete,
          });
          return;
        }
        if (page.issues.length === 0) console.log('  no issues');
        for (const summary of page.issues) renderSummary(summary);
        unsearchedLines(page.unsearchedRefs, page.complete);
      } catch (error) {
        fail(options.json, error, 'store_issue_list_failed');
      }
    });

  issue
    .command('show <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        const detail: IssueDetail = await StoreAggregateQuery.showIssue({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
        });
        if (options.json) {
          printJson({
            issue: summaryPayload(detail.issue),
            plan: detail.plan === null ? null : planPayload(detail.plan),
            unsearchedRefs: detail.unsearchedRefs,
            complete: detail.complete,
          });
          return;
        }
        renderSummary(detail.issue);
        if (detail.plan !== null) renderPlan(detail.plan);
        unsearchedLines(detail.unsearchedRefs, detail.complete);
      } catch (error) {
        fail(options.json, error, 'store_issue_show_failed');
      }
    });

  issue
    .command('plan <issue-id>')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--target-line <id>', '')
    .option('--add-change <node=instance[,alias]>', '', collect, [])
    .option('--add-intent <node=summary>', '', collect, [])
    .option('--depends-on <node:dependency>', '', collect, [])
    .option('--from-file <path>', '')
    .option('--revision <id>', '')
    .option('--json', '')
    .action(async (issueId: string, options: StoreIssueOptions) => {
      try {
        // With no node input this is a READ of the addressed (or latest)
        // revision, which is what makes `plan` usable for inspection without a
        // second verb.
        const authored =
          options.fromFile !== undefined ||
          (options.addChange ?? []).length > 0 ||
          (options.addIntent ?? []).length > 0;
        if (!authored) {
          const plan = await StoreAggregateQuery.resolveExecutionPlan({
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
            issueId,
            ...(options.revision === undefined ? {} : { revisionId: options.revision }),
          });
          if (options.json) printJson(planPayload(plan));
          else {
            renderPlan(plan);
            unsearchedLines(plan.unsearchedRefs, plan.complete);
          }
          return;
        }
        const nodes =
          options.fromFile === undefined
            ? parseNodes(options)
            : await readNodesFromFile(options.fromFile);
        const result = await issues.publishPlan({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          nodes,
        });
        if (options.json) {
          printJson({ ...(writeReportPayload(result) as object), revision: result.revision });
        } else {
          console.log(
            `Execution Plan revision ${result.revision.revisionId} published for issue ${result.issueId}`
          );
          renderWriteReport(result);
        }
      } catch (error) {
        fail(options.json, error, 'store_issue_plan_failed');
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
            "An Issue's state is operator-declared; readiness derived from its plan informs the decision and never makes it.",
            'issue_state_transition_refused',
            { target: 'state', fix: 'Add --state resolved or --state dropped --reason "<why>".' }
          );
        }
        const result = await issues.setState({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          issueId,
          state: options.state as IssueState,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        });
        if (options.json) {
          printJson({ ...(writeReportPayload(result) as object), record: result.record });
        } else {
          console.log(`Issue ${result.issueId} is now ${result.record.state}`);
          renderWriteReport(result);
        }
      } catch (error) {
        fail(options.json, error, 'store_issue_state_failed');
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
