import type {
  StoreIssueAttentionResponse,
  StoreIssueProjectionResponse,
} from '../api/types.js';

export type IssueProvenanceKind = 'git' | 'runtime';
export type IssueProvenanceFamily =
  | 'issue-record'
  | 'plan-projection'
  | 'acceptance-review'
  | 'runtime'
  | 'delivery'
  | 'attention';

export interface IssueProvenanceFact {
  label: string;
  value: string;
}

export interface IssueProvenanceEntry {
  family: IssueProvenanceFamily;
  anchor: string;
  kind: IssueProvenanceKind;
  labelKey: string;
  facts: IssueProvenanceFact[];
}

/** Closed presentation vocabulary. It classifies sources but derives no Issue state. */
export const ISSUE_PROVENANCE: Record<
  IssueProvenanceFamily,
  { anchor: string; kind: IssueProvenanceKind; labelKey: string }
> = {
  'issue-record': {
    anchor: 'issue-provenance-record',
    kind: 'git',
    labelKey: 'issues.provenance.entry.issue_record',
  },
  'plan-projection': {
    anchor: 'issue-provenance-plan',
    kind: 'git',
    labelKey: 'issues.provenance.entry.plan_projection',
  },
  'acceptance-review': {
    anchor: 'issue-provenance-acceptance',
    kind: 'git',
    labelKey: 'issues.provenance.entry.acceptance_review',
  },
  runtime: {
    anchor: 'issue-provenance-runtime',
    kind: 'runtime',
    labelKey: 'issues.provenance.entry.runtime',
  },
  delivery: {
    anchor: 'issue-provenance-delivery',
    kind: 'git',
    labelKey: 'issues.provenance.entry.delivery',
  },
  attention: {
    anchor: 'issue-provenance-attention',
    kind: 'runtime',
    labelKey: 'issues.provenance.entry.attention',
  },
};

export function issueProvenanceHref(detailHref: string, family: IssueProvenanceFamily): string {
  return `${detailHref}#${ISSUE_PROVENANCE[family].anchor}`;
}

function add(facts: IssueProvenanceFact[], label: string, value: unknown): void {
  if (value === null || value === undefined) return;
  facts.push({ label, value: String(value) });
}

function unavailable(facts: IssueProvenanceFact[], reason?: string | null): void {
  facts.push({ label: 'diagnostic', value: reason ?? 'unavailable' });
}

/**
 * Builds a mount-local presentation index by copying named payload facts.
 * It deliberately does not calculate phase, health, progress, association,
 * membership, lifecycle, attribution, or success.
 */
export function buildIssueProvenance(
  projection: StoreIssueProjectionResponse,
  attention: StoreIssueAttentionResponse | null
): IssueProvenanceEntry[] {
  const issueFacts: IssueProvenanceFact[] = [];
  add(issueFacts, 'issue.issueId', projection.issue.issueId);
  add(issueFacts, 'issue.latestRevisionId', projection.issue.latestRevisionId);
  for (const revisionId of projection.issue.revisionIds) add(issueFacts, 'issue.revisionIds[]', revisionId);
  for (const ref of projection.issue.refs) add(issueFacts, 'issue.refs[]', ref);
  add(issueFacts, 'issue.diagnostic', projection.issue.diagnostic);
  for (const copy of projection.issue.divergence?.copies ?? []) {
    add(issueFacts, 'issue.copy.storeRef', copy.storeRef);
    add(issueFacts, 'issue.copy.targetLineId', copy.targetLineId);
    add(issueFacts, 'issue.copy.sha256', copy.sha256);
    add(issueFacts, 'issue.copy.diagnostic', copy.diagnostic);
  }
  if (issueFacts.length === 1) unavailable(issueFacts, projection.issue.diagnostic);

  const planFacts: IssueProvenanceFact[] = [];
  if (projection.plan === null) {
    unavailable(planFacts);
  } else {
    add(planFacts, 'plan.revisionId', projection.plan.revisionId);
    add(planFacts, 'plan.diagnostic', projection.plan.diagnostic);
    add(planFacts, 'plan.revision.supersedes', projection.plan.revision?.supersedes);
    add(planFacts, 'plan.revision.contentSha256', projection.plan.revision?.contentSha256);
    for (const node of projection.plan.revision?.nodes ?? []) {
      add(planFacts, `${node.nodeId}.projectId`, node.projectId);
      add(planFacts, `${node.nodeId}.targetLineId`, node.targetLineId);
      add(planFacts, `${node.nodeId}.changeInstanceId`, node.changeInstanceId);
      add(planFacts, `${node.nodeId}.changeAlias`, node.changeAlias);
    }
    for (const entry of projection.plan.readiness.nodes) {
      for (const ref of entry.resolution.searchedRefs) {
        add(planFacts, `${entry.node.nodeId}.searchedRefs[]`, ref);
      }
      for (const claimant of entry.resolution.claimants) {
        add(planFacts, `${entry.node.nodeId}.claimant.changeId`, claimant.changeId);
        add(planFacts, `${entry.node.nodeId}.claimant.projectId`, claimant.projectId);
        add(planFacts, `${entry.node.nodeId}.claimant.targetLineId`, claimant.targetLineId);
        add(planFacts, `${entry.node.nodeId}.claimant.foundAtRef`, claimant.foundAtRef);
      }
      add(planFacts, `${entry.node.nodeId}.localLocator.root`, entry.resolution.localLocator?.root);
    }
    for (const ref of projection.plan.unsearchedRefs) add(planFacts, 'plan.unsearchedRefs[]', ref.storeRef);
    for (const problem of projection.plan.problems) add(planFacts, 'plan.problem', problem.reason);
    if (planFacts.length === 0) unavailable(planFacts, projection.plan.diagnostic);
  }

  const acceptanceFacts: IssueProvenanceFact[] = [];
  const acceptance = projection.status.acceptance;
  if (acceptance === null) {
    unavailable(acceptanceFacts);
  } else {
    add(acceptanceFacts, 'acceptance.conditions.path', acceptance.conditions.path);
    add(acceptanceFacts, 'acceptance.conditions.revisionId', acceptance.conditions.revisionId);
    add(acceptanceFacts, 'acceptance.conditions.contentSha256', acceptance.conditions.revision?.contentSha256);
    add(acceptanceFacts, 'acceptance.conditions.diagnostic', acceptance.conditions.diagnostic);
    add(acceptanceFacts, 'acceptance.record.conditionsSha256', acceptance.record?.conditionsSha256);
    add(acceptanceFacts, 'acceptance.record.contentSha256', acceptance.record?.contentSha256);
  }
  add(acceptanceFacts, 'review.revisionId', projection.review.revisionId);
  add(acceptanceFacts, 'review.determination.kind', projection.review.determination.kind);
  for (const thread of projection.review.threads) add(acceptanceFacts, 'review.thread', JSON.stringify(thread));

  const runtimeFacts: IssueProvenanceFact[] = [];
  if (projection.status.runStateVisibility.kind === 'execution-root') {
    add(runtimeFacts, 'runStateVisibility.executionRoot', projection.status.runStateVisibility.executionRoot);
  }
  for (const node of projection.status.nodes) {
    add(runtimeFacts, `${node.nodeId}.runStatePath`, node.runStatePath);
    add(runtimeFacts, `${node.nodeId}.locatedBy`, node.locatedBy);
    add(runtimeFacts, `${node.nodeId}.evidenceLocator`, node.attribution.evidenceLocator);
    for (const session of node.attribution.sessions) {
      add(runtimeFacts, `${node.nodeId}.sessionId`, session.sessionId);
      add(runtimeFacts, `${node.nodeId}.threadId`, session.threadId);
      add(runtimeFacts, `${node.nodeId}.transcript`, session.transcript);
    }
  }
  if (runtimeFacts.length === 0) unavailable(runtimeFacts);

  const deliveryFacts: IssueProvenanceFact[] = [];
  for (const node of projection.status.nodes) {
    const delivery = node.delivery;
    if (delivery === null) continue;
    add(deliveryFacts, `${node.nodeId}.delivery.state`, delivery.state);
    if (delivery.state === 'record') {
      add(deliveryFacts, `${node.nodeId}.delivery.foundAtRef`, delivery.foundAtRef);
      add(deliveryFacts, `${node.nodeId}.delivery.blobPath`, delivery.blobPath);
      add(deliveryFacts, `${node.nodeId}.delivery.codeCommit`, delivery.codeCommit);
      add(deliveryFacts, `${node.nodeId}.delivery.planningBranch`, delivery.planningBranch);
      for (const evidence of delivery.evidence ?? []) {
        add(deliveryFacts, `${node.nodeId}.delivery.evidence.path`, evidence.path);
        add(deliveryFacts, `${node.nodeId}.delivery.evidence.sha256`, evidence.sha256);
      }
      for (const missing of delivery.missing ?? []) add(deliveryFacts, `${node.nodeId}.delivery.missing[]`, missing);
    } else if (delivery.state === 'no-record') {
      add(deliveryFacts, `${node.nodeId}.delivery.foundAtRef`, delivery.foundAtRef);
      add(deliveryFacts, `${node.nodeId}.delivery.blobPath`, delivery.blobPath);
    }
  }
  if (deliveryFacts.length === 0) unavailable(deliveryFacts);

  const attentionFacts: IssueProvenanceFact[] = [];
  if (attention === null) {
    unavailable(attentionFacts);
  } else {
    for (const scanned of attention.scanned) {
      if (scanned.runStateVisibility.kind === 'execution-root') {
        add(
          attentionFacts,
          `${scanned.issueId}.runStateVisibility.executionRoot`,
          scanned.runStateVisibility.executionRoot
        );
      }
    }
    for (const item of attention.items) {
      add(attentionFacts, 'attention.kind', item.kind);
      add(attentionFacts, 'attention.nodeId', item.nodeId);
      if (item.kind === 'failure') add(attentionFacts, 'attention.diagnostic', item.diagnostic);
      if (item.kind === 'problem') {
        add(attentionFacts, 'attention.problem.kind', item.problem.kind);
        add(attentionFacts, 'attention.problem.ref', item.problem.ref);
        add(attentionFacts, 'attention.problem.reason', item.problem.reason);
      }
    }
    for (const ref of attention.unsearchedRefs) add(attentionFacts, 'attention.unsearchedRefs[]', ref.storeRef);
    if (attentionFacts.length === 0) unavailable(attentionFacts);
  }

  const factsByFamily: Record<IssueProvenanceFamily, IssueProvenanceFact[]> = {
    'issue-record': issueFacts,
    'plan-projection': planFacts,
    'acceptance-review': acceptanceFacts,
    runtime: runtimeFacts,
    delivery: deliveryFacts,
    attention: attentionFacts,
  };
  return (Object.keys(ISSUE_PROVENANCE) as IssueProvenanceFamily[]).map((family) => ({
    family,
    ...ISSUE_PROVENANCE[family],
    facts: factsByFamily[family],
  }));
}
