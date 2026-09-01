/**
 * Fresh Store-wide Change-to-Issue association read.
 *
 * Links are derived from the current grouped Change evidence and every
 * Issue's latest readable Execution Plan. Nothing in this module writes,
 * locks, caches, or persists a reverse index.
 */
import type { IssueState } from '../store/issues/types.js';
import type { IssueIdentityV2 } from '../store/issues/identity.js';
import type {
  AggregateArchiveEntry,
  AggregateChangeEntry,
  AggregateProblem,
  GroupedChanges,
  IssueSummary,
  StoreQueryModule,
  UnsearchedRef,
} from '../store/query/types.js';
import type { IssueReadScope } from './composition.js';

export type ChangeIssueAssociation = 'linked' | 'unlinked' | 'unknown';

export type ChangeIssueEligibility =
  | 'attachable'
  | 'already-linked'
  | 'identity-missing'
  | 'identity-ambiguous'
  | 'evidence-incomplete';

export type ChangeOccurrence =
  | { readonly kind: 'active'; readonly change: AggregateChangeEntry }
  | { readonly kind: 'archived'; readonly change: AggregateArchiveEntry };

export interface ChangeIssueLink {
  readonly identity: IssueIdentityV2;
  /** @deprecated Use `identity.uid`. */
  readonly issueId: string;
  readonly title: string | null;
  readonly state: IssueState | null;
  readonly revisionId: string;
  readonly nodeIds: readonly string[];
}

export interface ChangeIssueLinkEntry {
  readonly occurrence: ChangeOccurrence;
  readonly association: ChangeIssueAssociation;
  readonly eligibility: ChangeIssueEligibility;
  readonly issues: readonly ChangeIssueLink[];
}

export interface ChangeIssueLinksPayload {
  readonly entries: readonly ChangeIssueLinkEntry[];
  readonly unsearchedRefs: readonly UnsearchedRef[];
  readonly problems: readonly AggregateProblem[];
  readonly complete: boolean;
}

function scopeInput(scope: IssueReadScope): { store?: string; startPath: string } {
  return {
    ...(scope.store === undefined ? {} : { store: scope.store }),
    startPath: scope.startPath,
  };
}

function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function occurrenceOrder(left: ChangeOccurrence, right: ChangeOccurrence): number {
  return (
    codePointOrder(left.change.projectId, right.change.projectId) ||
    codePointOrder(left.change.targetLineId, right.change.targetLineId) ||
    (left.kind === right.kind ? 0 : left.kind === 'active' ? -1 : 1) ||
    codePointOrder(left.change.changeId, right.change.changeId) ||
    codePointOrder(left.change.changeInstanceId ?? '', right.change.changeInstanceId ?? '')
  );
}

function flattenOccurrences(changes: GroupedChanges): ChangeOccurrence[] {
  const occurrences: ChangeOccurrence[] = [];
  for (const group of changes.groups) {
    for (const change of group.active) occurrences.push({ kind: 'active', change });
    for (const change of group.archived) occurrences.push({ kind: 'archived', change });
  }
  return occurrences.sort(occurrenceOrder);
}

function uniqueSorted<T>(values: readonly T[], keyFor: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) byKey.set(keyFor(value), value);
  return [...byKey.entries()]
    .sort(([left], [right]) => codePointOrder(left, right))
    .map(([, value]) => value);
}

function mergeUnsearched(values: readonly UnsearchedRef[]): UnsearchedRef[] {
  return uniqueSorted(
    values,
    value => `${value.targetLineId}\0${value.storeRef}\0${value.reason}`
  );
}

function mergeProblems(values: readonly AggregateProblem[]): AggregateProblem[] {
  return uniqueSorted(
    values,
    value => `${value.kind}\0${value.itemId}\0${value.storeRef ?? ''}\0${value.path}\0${value.reason}`
  );
}

interface MutableIssueLink {
  readonly summary: IssueSummary;
  readonly revisionId: string;
  readonly nodeIds: Set<string>;
}

/**
 * Reads all Change occurrences and latest Issue plans once and derives the
 * closed association/eligibility answer for every occurrence.
 */
export async function composeChangeIssueLinks(
  query: StoreQueryModule,
  scope: IssueReadScope
): Promise<ChangeIssueLinksPayload> {
  const input = scopeInput(scope);
  const changes = await query.listChanges(input);
  const issues = await query.listIssues(input);
  const occurrences = flattenOccurrences(changes);

  const claims = new Map<string, number>();
  for (const occurrence of occurrences) {
    const instanceId = occurrence.change.changeInstanceId;
    if (instanceId !== null) claims.set(instanceId, (claims.get(instanceId) ?? 0) + 1);
  }

  const linksByInstance = new Map<string, Map<string, MutableIssueLink>>();
  const unsearched: UnsearchedRef[] = [...changes.unsearchedRefs, ...issues.unsearchedRefs];
  const problems: AggregateProblem[] = [...changes.problems, ...issues.problems];
  let complete = changes.complete && issues.complete;

  for (const summary of issues.issues) {
    if (summary.latestRevisionId === null) continue;
    if (summary.identity === null) {
      const copy = summary.divergence?.copies[0];
      problems.push({
        kind: 'issue',
        itemId: summary.issueId,
        storeRef: copy?.storeRef ?? null,
        path: `rasen/issues/${String(copy?.storageKey ?? summary.issueId)}/issue.yaml`,
        reason:
          summary.divergence === null
            ? `Issue identity is unreadable; Execution Plan revision '${summary.latestRevisionId}' cannot be checked for Change links.`
            : `Issue records diverge; Execution Plan revision '${summary.latestRevisionId}' has no coherent owner for Change-link resolution.`,
      });
      complete = false;
      continue;
    }
    const plan = await query.resolveExecutionPlan({
      ...input,
      issueId: summary.identity.uid,
      revisionId: summary.latestRevisionId,
    });
    unsearched.push(...plan.unsearchedRefs);
    problems.push(...plan.problems);
    complete = complete && plan.complete && plan.revision !== null;
    if (plan.revision === null || plan.revisionId === null) continue;

    for (const node of plan.revision.nodes) {
      if (node.kind !== 'change') continue;
      let byIssue = linksByInstance.get(node.changeInstanceId);
      if (byIssue === undefined) {
        byIssue = new Map<string, MutableIssueLink>();
        linksByInstance.set(node.changeInstanceId, byIssue);
      }
      let link = byIssue.get(summary.identity.uid);
      if (link === undefined) {
        link = { summary, revisionId: plan.revisionId, nodeIds: new Set<string>() };
        byIssue.set(summary.identity.uid, link);
      }
      link.nodeIds.add(node.nodeId);
    }
  }

  const entries = occurrences.map((occurrence): ChangeIssueLinkEntry => {
    const instanceId = occurrence.change.changeInstanceId;
    if (instanceId === null) {
      return {
        occurrence,
        association: 'unknown',
        eligibility: 'identity-missing',
        issues: [],
      };
    }
    if ((claims.get(instanceId) ?? 0) > 1) {
      return {
        occurrence,
        association: 'unknown',
        eligibility: 'identity-ambiguous',
        issues: [],
      };
    }

    const issueLinks = [...(linksByInstance.get(instanceId)?.values() ?? [])]
      .map((link): ChangeIssueLink => ({
        identity: link.summary.identity as IssueIdentityV2,
        issueId: (link.summary.identity as IssueIdentityV2).uid,
        title: link.summary.record?.title ?? null,
        state: link.summary.record?.state ?? null,
        revisionId: link.revisionId,
        nodeIds: [...link.nodeIds].sort(codePointOrder),
      }))
      .sort((left, right) => codePointOrder(left.issueId, right.issueId));
    if (issueLinks.length > 0) {
      return {
        occurrence,
        association: 'linked',
        eligibility: 'already-linked',
        issues: issueLinks,
      };
    }
    if (!complete) {
      return {
        occurrence,
        association: 'unknown',
        eligibility: 'evidence-incomplete',
        issues: [],
      };
    }
    return {
      occurrence,
      association: 'unlinked',
      eligibility: 'attachable',
      issues: [],
    };
  });

  return {
    entries,
    unsearchedRefs: mergeUnsearched(unsearched),
    problems: mergeProblems(problems),
    complete,
  };
}
