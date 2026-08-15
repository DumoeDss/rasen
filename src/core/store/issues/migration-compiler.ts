/**
 * Pure compatibility compiler used only by flat-to-v2 layout migration.
 *
 * It deliberately accepts canonical Issue-domain values rather than legacy
 * paths or aliases.  Filesystem, Git, locking and publication stay owned by
 * the layout-migration transaction.
 */
import { createHash } from 'node:crypto';

import { executionPlanDigest, normalizePlanNodes, serializeExecutionPlanRevision } from './plans.js';
import { serializeIssueRecord, validateIssueRecord } from './records.js';
import type {
  ExecutionPlanNodeInput,
  ExecutionPlanRevisionV1,
  IssueRecordV1,
  IssueState,
} from './types.js';

export type MigrationIssueFileRole = 'issue-record' | 'execution-plan';

export interface CompiledMigrationIssueFile {
  readonly role: MigrationIssueFileRole;
  /** Path below the generated Issue root, always POSIX for plan portability. */
  readonly relativePath: string;
  readonly content: string;
  readonly digest: string;
}

export interface CompiledMigrationIssueTree {
  readonly issueId: string;
  readonly state: IssueState;
  readonly rootRelative: string;
  readonly files: readonly CompiledMigrationIssueFile[];
}

export interface MigrationIssueInput {
  readonly issueId: string;
  readonly title: string;
  readonly state: IssueState;
  readonly reason: string | null;
  readonly createdAt: string;
  /** Already canonical runtime inputs. Migration selectors are not accepted. */
  readonly nodes?: readonly ExecutionPlanNodeInput[];
}

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function compileMigrationIssueTree(
  input: MigrationIssueInput
): CompiledMigrationIssueTree {
  if (input.state === 'open' && input.reason !== null) {
    throw new Error("A migration-authored open Issue must have reason: null.");
  }
  if (
    input.state !== 'open' &&
    (input.reason === null || input.reason.trim().length === 0)
  ) {
    throw new Error(`A migration-authored ${input.state} Issue requires an operator reason.`);
  }

  const record = validateIssueRecord({
    version: 1,
    id: input.issueId,
    title: input.title,
    state: input.state,
    reason: input.reason,
    createdAt: input.createdAt,
  }) as IssueRecordV1;
  const issueContent = serializeIssueRecord(record);
  const files: CompiledMigrationIssueFile[] = [
    {
      role: 'issue-record',
      relativePath: 'issue.yaml',
      content: issueContent,
      digest: digest(issueContent),
    },
  ];

  if (input.nodes !== undefined) {
    const nodes = normalizePlanNodes(input.nodes);
    const draft = {
      version: 1 as const,
      issueId: record.id,
      revisionId: '0001' as ExecutionPlanRevisionV1['revisionId'],
      supersedes: null,
      createdAt: input.createdAt,
      nodes,
    };
    const revision: ExecutionPlanRevisionV1 = {
      ...draft,
      contentSha256: executionPlanDigest(draft),
    };
    const planContent = serializeExecutionPlanRevision(revision);
    files.push({
      role: 'execution-plan',
      relativePath: 'plans/0001.yaml',
      content: planContent,
      digest: digest(planContent),
    });
  }

  return Object.freeze({
    issueId: record.id,
    state: record.state,
    rootRelative: `rasen/issues/${record.id}`,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  });
}
