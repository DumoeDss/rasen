/**
 * `rasen store issue new|list|show|state|plan` — the CLI for the Store-level
 * Issue Module (`StoreIssues`) and the Issue-facing slice of the aggregate
 * query (`StoreAggregateQuery.{listIssues,showIssue}`).
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
  type IssueDetail,
  type IssueSummaryPage,
} from '../core/store/query/index.js';
import { emitFailure, printJson } from './shared-output.js';

export interface StoreIssueOptions {
  store?: string;
  title?: string;
  readme?: boolean;
  state?: string;
  reason?: string;
  fromFile?: string;
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

function renderIssueList(page: IssueSummaryPage): void {
  if (page.issues.length === 0) {
    console.log('No Issues found.');
  }
  for (const summary of page.issues) {
    const state = summary.record?.state ?? (summary.divergence ? '(divergent)' : '(unknown)');
    const title = summary.record?.title ?? '';
    console.log(`${summary.issueId}  [${state}]  ${title}`);
  }
  if (!page.complete) {
    console.log('');
    console.log(`INCOMPLETE: ${page.unsearchedRefs.length} ref(s) could not be read.`);
    for (const ref of page.unsearchedRefs) {
      console.log(`  ${ref.targetLineId} (${ref.storeRef}): ${ref.reason}`);
    }
  }
}

function renderIssueDetail(detail: IssueDetail): void {
  const summary = detail.issue;
  console.log(`Issue ${summary.issueId}`);
  if (summary.record) {
    console.log(`  state: ${summary.record.state}`);
    console.log(`  title: ${summary.record.title}`);
  } else if (summary.divergence) {
    console.log(
      `  DIVERGENT: ${summary.divergence.copies.length} differing copies across Store refs.`
    );
  }
  console.log(`  revisions: ${summary.revisionIds.join(', ') || '(none)'}`);
  if (detail.plan) {
    console.log(`  latest plan: revision ${detail.plan.revisionId ?? '(none)'}`);
  }
  if (!detail.complete) {
    console.log('');
    console.log(`INCOMPLETE: ${detail.unsearchedRefs.length} ref(s) could not be read.`);
  }
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
        const page = await StoreAggregateQuery.listIssues({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          ...(options.state === undefined ? {} : { state: options.state as IssueState }),
        });
        if (options.json) {
          printJson({
            issues: page.issues,
            complete: page.complete,
            unsearchedRefs: page.unsearchedRefs,
          });
          return;
        }
        renderIssueList(page);
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
        if (options.json) {
          printJson({
            issue: detail.issue,
            plan: detail.plan,
            complete: detail.complete,
            unsearchedRefs: detail.unsearchedRefs,
          });
          return;
        }
        renderIssueDetail(detail);
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
}
