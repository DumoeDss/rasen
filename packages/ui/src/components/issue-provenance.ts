import type {
  StoreIssueAttentionItem,
  StoreIssueHealth,
  StoreIssueNodeStatus,
  StoreIssuePhase,
  StoreIssueAttentionResponse,
  StoreIssueProjectionResponse,
  StoreIssueStatusProblem,
  StoreIssueStatusProblemKind,
} from '../api/types.js';

export type IssueProvenanceKind = 'git' | 'runtime';
export type IssueProvenanceFamily =
  | 'issue-record'
  | 'plan-projection'
  | 'acceptance-review'
  | 'runtime'
  | 'delivery'
  | 'attention-git'
  | 'attention-runtime';

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
  'attention-git': {
    anchor: 'issue-provenance-attention-git',
    kind: 'git',
    labelKey: 'issues.provenance.entry.attention',
  },
  'attention-runtime': {
    anchor: 'issue-provenance-attention-runtime',
    kind: 'runtime',
    labelKey: 'issues.provenance.entry.attention',
  },
};

export function issueProvenanceHref(detailHref: string, family: IssueProvenanceFamily): string {
  return `${detailHref}#${ISSUE_PROVENANCE[family].anchor}`;
}

/** Selects a provenance target for an already-projected phase; it never computes the phase. */
export function issuePhaseProvenanceFamily(phase: StoreIssuePhase): IssueProvenanceFamily {
  return phase === 'done' || phase === 'review' ? 'acceptance-review' : 'plan-projection';
}

/** Selects the inputs for an already-projected health value; it never recomputes health. */
export function issueHealthProvenanceFamily(
  phase: StoreIssuePhase,
  health: StoreIssueHealth
): IssueProvenanceFamily {
  if (health === 'failed') return 'attention-runtime';
  if (health === 'waiting-human') {
    return phase === 'review' ? 'acceptance-review' : 'attention-runtime';
  }
  return 'plan-projection';
}

function problemProvenanceFamily(kind: StoreIssueStatusProblemKind): IssueProvenanceFamily {
  if (kind === 'invalid-run-state') return 'attention-runtime';
  if (kind === 'invalid-archive-record') return 'delivery';
  if (kind === 'unreadable-acceptance') return 'acceptance-review';
  return 'attention-git';
}

/** Distinguishes the source of an existing attention item without deriving one. */
export function issueAttentionProvenanceFamily(
  item: StoreIssueAttentionItem
): IssueProvenanceFamily {
  if (item.kind === 'acceptance-awaiting') return 'acceptance-review';
  if (item.kind === 'problem') return problemProvenanceFamily(item.problem.kind);
  return 'attention-runtime';
}

function add(facts: IssueProvenanceFact[], label: string, value: unknown): void {
  if (value === null || value === undefined) return;
  facts.push({ label, value: String(value) });
}

function unavailable(facts: IssueProvenanceFact[], reason?: string | null): void {
  facts.push({ label: 'diagnostic', value: reason ?? 'unavailable' });
}

function addProblem(
  facts: IssueProvenanceFact[],
  prefix: string,
  problem: StoreIssueStatusProblem
): void {
  add(facts, `${prefix}.kind`, problem.kind);
  add(facts, `${prefix}.node`, problem.node);
  add(facts, `${prefix}.ref`, problem.ref);
  add(facts, `${prefix}.reason`, problem.reason);
}

function addNodeInputs(
  facts: IssueProvenanceFact[],
  node: StoreIssueNodeStatus,
  prefix = node.nodeId
): void {
  add(facts, `${prefix}.kind`, node.kind);
  add(facts, `${prefix}.projectId`, node.projectId);
  add(facts, `${prefix}.targetLineId`, node.targetLineId);
  add(facts, `${prefix}.lifecycle`, node.lifecycle);
  add(facts, `${prefix}.reason`, node.reason);
  add(facts, `${prefix}.observation`, node.observation);
  add(facts, `${prefix}.diagnostic`, node.diagnostic);
  add(facts, `${prefix}.runStatePath`, node.runStatePath);
  add(facts, `${prefix}.locatedBy`, node.locatedBy);
  add(facts, `${prefix}.evidenceLocator`, node.attribution.evidenceLocator);
  for (const blocker of node.blockedBy) {
    add(facts, `${prefix}.blockedBy.nodeId`, blocker.nodeId);
    add(facts, `${prefix}.blockedBy.projectId`, blocker.projectId);
    add(facts, `${prefix}.blockedBy.observation`, blocker.observation);
  }
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
  add(issueFacts, 'issue.identity.uid', projection.issue.identity?.uid);
  add(issueFacts, 'issue.identity.key', projection.issue.identity?.key);
  add(issueFacts, 'issue.identity.slug', projection.issue.identity?.slug);
  for (const alias of projection.issue.identity?.aliases ?? []) {
    add(issueFacts, `issue.identity.alias.${alias.kind}`, alias.value);
  }
  add(issueFacts, 'issue.record.state', projection.issue.record?.state);
  add(issueFacts, 'issue.record.reason', projection.issue.record?.reason);
  add(issueFacts, 'issue.record.createdAt', projection.issue.record?.createdAt);
  add(issueFacts, 'issue.latestRevisionId', projection.issue.latestRevisionId);
  for (const revisionId of projection.issue.revisionIds) add(issueFacts, 'issue.revisionIds[]', revisionId);
  for (const ref of projection.issue.refs) add(issueFacts, 'issue.refs[]', ref);
  add(issueFacts, 'issue.uncommitted', projection.issue.uncommitted);
  add(issueFacts, 'issue.diagnostic', projection.issue.diagnostic);
  for (const copy of projection.issue.divergence?.copies ?? []) {
    add(issueFacts, 'issue.copy.storeRef', copy.storeRef);
    add(issueFacts, 'issue.copy.targetLineId', copy.targetLineId);
    add(issueFacts, 'issue.copy.sha256', copy.sha256);
    add(issueFacts, 'issue.copy.diagnostic', copy.diagnostic);
  }
  if (issueFacts.length === 1) unavailable(issueFacts, projection.issue.diagnostic);

  const planFacts: IssueProvenanceFact[] = [];
  add(planFacts, 'status.phase', projection.status.phase);
  add(planFacts, 'status.health', projection.status.health);
  add(planFacts, 'status.progress.completed', projection.status.progress?.completed);
  add(planFacts, 'status.progress.total', projection.status.progress?.total);
  add(planFacts, 'status.complete', projection.status.complete);
  add(planFacts, 'issue.record.state', projection.issue.record?.state);
  if (projection.plan === null) {
    unavailable(planFacts, 'plan unavailable');
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
      add(planFacts, `${node.nodeId}.lifecycle`, node.lifecycle ?? 'required');
      add(planFacts, `${node.nodeId}.reason`, node.reason);
    }
    for (const entry of projection.plan.readiness.nodes) {
      add(planFacts, `${entry.node.nodeId}.resolution.status`, entry.resolution.status);
      add(planFacts, `${entry.node.nodeId}.resolution.archived`, entry.resolution.archived);
      add(planFacts, `${entry.node.nodeId}.readiness`, entry.readiness);
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
  }
  for (const node of projection.status.nodes) addNodeInputs(planFacts, node);
  projection.status.problems.forEach((problem, index) =>
    addProblem(planFacts, `status.problems[${index}]`, problem)
  );
  for (const ref of projection.unsearchedRefs) {
    add(planFacts, 'projection.unsearchedRefs[].targetLineId', ref.targetLineId);
    add(planFacts, 'projection.unsearchedRefs[].storeRef', ref.storeRef);
    add(planFacts, 'projection.unsearchedRefs[].reason', ref.reason);
  }
  for (const problem of projection.problems) {
    add(planFacts, 'projection.problem.kind', problem.kind);
    add(planFacts, 'projection.problem.itemId', problem.itemId);
    add(planFacts, 'projection.problem.storeRef', problem.storeRef);
    add(planFacts, 'projection.problem.path', problem.path);
    add(planFacts, 'projection.problem.reason', problem.reason);
  }

  const acceptanceFacts: IssueProvenanceFact[] = [];
  add(acceptanceFacts, 'issue.record.state', projection.issue.record?.state);
  add(acceptanceFacts, 'status.phase', projection.status.phase);
  add(acceptanceFacts, 'status.health', projection.status.health);
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
    add(acceptanceFacts, 'acceptance.record.acceptedAt', acceptance.record?.acceptedAt);
    add(acceptanceFacts, 'acceptance.record.conditionsRevisionId', acceptance.record?.conditionsRevisionId);
    add(acceptanceFacts, 'acceptance.record.gate.completed', acceptance.record?.gate.completed);
    add(acceptanceFacts, 'acceptance.record.gate.total', acceptance.record?.gate.total);
    add(acceptanceFacts, 'acceptance.record.gate.health', acceptance.record?.gate.health);
    add(
      acceptanceFacts,
      'acceptance.record.gate.problemsStanding',
      acceptance.record?.gate.problemsStanding
    );
    add(acceptanceFacts, 'acceptance.gate.eligible', acceptance.gate.eligible);
    if (acceptance.gate.eligible) {
      add(acceptanceFacts, 'acceptance.gate.conditionsRevisionId', acceptance.gate.conditionsRevisionId);
      add(acceptanceFacts, 'acceptance.gate.snapshot.completed', acceptance.gate.snapshot.completed);
      add(acceptanceFacts, 'acceptance.gate.snapshot.total', acceptance.gate.snapshot.total);
      add(acceptanceFacts, 'acceptance.gate.snapshot.health', acceptance.gate.snapshot.health);
      add(
        acceptanceFacts,
        'acceptance.gate.snapshot.problemsStanding',
        acceptance.gate.snapshot.problemsStanding
      );
    } else {
      add(acceptanceFacts, 'acceptance.gate.refusalCode', acceptance.gate.refusalCode);
      add(acceptanceFacts, 'acceptance.gate.message', acceptance.gate.message);
    }
  }
  for (const node of projection.status.nodes) addNodeInputs(acceptanceFacts, node, `status.${node.nodeId}`);
  projection.status.problems.forEach((problem, index) =>
    addProblem(acceptanceFacts, `status.problems[${index}]`, problem)
  );
  add(acceptanceFacts, 'review.revisionId', projection.review.revisionId);
  add(acceptanceFacts, 'review.determination.kind', projection.review.determination.kind);
  for (const thread of projection.review.threads) add(acceptanceFacts, 'review.thread', JSON.stringify(thread));

  const runtimeFacts: IssueProvenanceFact[] = [];
  if (projection.status.runStateVisibility.kind === 'execution-root') {
    add(runtimeFacts, 'runStateVisibility.executionRoot', projection.status.runStateVisibility.executionRoot);
  }
  for (const node of projection.status.nodes) {
    add(runtimeFacts, `${node.nodeId}.lifecycle`, node.lifecycle);
    add(runtimeFacts, `${node.nodeId}.observation`, node.observation);
    add(runtimeFacts, `${node.nodeId}.reason`, node.reason);
    add(runtimeFacts, `${node.nodeId}.diagnostic`, node.diagnostic);
    add(runtimeFacts, `${node.nodeId}.runStatePath`, node.runStatePath);
    add(runtimeFacts, `${node.nodeId}.locatedBy`, node.locatedBy);
    add(runtimeFacts, `${node.nodeId}.evidenceLocator`, node.attribution.evidenceLocator);
    for (const session of node.attribution.sessions) {
      add(runtimeFacts, `${node.nodeId}.sessionId`, session.sessionId);
      add(runtimeFacts, `${node.nodeId}.threadId`, session.threadId);
      add(runtimeFacts, `${node.nodeId}.transcript`, session.transcript);
    }
  }
  projection.status.problems
    .filter((problem) => problem.kind === 'invalid-run-state')
    .forEach((problem, index) => addProblem(runtimeFacts, `status.problems[${index}]`, problem));
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
    const resolution = projection.plan?.readiness.nodes.find(
      (entry) => entry.node.nodeId === node.nodeId
    )?.resolution;
    add(deliveryFacts, `${node.nodeId}.resolution.status`, resolution?.status);
    add(deliveryFacts, `${node.nodeId}.resolution.archived`, resolution?.archived);
    add(deliveryFacts, `${node.nodeId}.resolution.outcome`, resolution?.outcome);
    for (const ref of resolution?.searchedRefs ?? []) {
      add(deliveryFacts, `${node.nodeId}.resolution.searchedRefs[]`, ref);
    }
    for (const claimant of resolution?.claimants ?? []) {
      add(deliveryFacts, `${node.nodeId}.resolution.claimant.foundAtRef`, claimant.foundAtRef);
      add(deliveryFacts, `${node.nodeId}.resolution.claimant.changeId`, claimant.changeId);
    }
  }
  add(deliveryFacts, 'delivery.revisionId', projection.delivery?.revisionId);
  if (projection.delivery !== null) {
    for (const [state, count] of Object.entries(projection.delivery.counts)) {
      add(deliveryFacts, `delivery.counts.${state}`, count);
    }
  }
  projection.status.problems
    .filter((problem) => problem.kind === 'invalid-archive-record')
    .forEach((problem, index) => addProblem(deliveryFacts, `status.problems[${index}]`, problem));
  if (deliveryFacts.length === 0) unavailable(deliveryFacts);

  const gitAttentionFacts: IssueProvenanceFact[] = [];
  const runtimeAttentionFacts: IssueProvenanceFact[] = [];
  add(gitAttentionFacts, 'status.phase', projection.status.phase);
  add(gitAttentionFacts, 'status.health', projection.status.health);
  add(gitAttentionFacts, 'issue.latestRevisionId', projection.issue.latestRevisionId);
  for (const ref of projection.issue.refs) add(gitAttentionFacts, 'issue.refs[]', ref);
  add(gitAttentionFacts, 'plan.revisionId', projection.plan?.revisionId);
  add(gitAttentionFacts, 'plan.diagnostic', projection.plan?.diagnostic);
  add(
    gitAttentionFacts,
    'plan.revision.contentSha256',
    projection.plan?.revision?.contentSha256
  );
  for (const entry of projection.plan?.readiness.nodes ?? []) {
    add(gitAttentionFacts, `${entry.node.nodeId}.resolution.status`, entry.resolution.status);
    for (const ref of entry.resolution.searchedRefs) {
      add(gitAttentionFacts, `${entry.node.nodeId}.searchedRefs[]`, ref);
    }
    for (const claimant of entry.resolution.claimants) {
      add(
        gitAttentionFacts,
        `${entry.node.nodeId}.claimant.foundAtRef`,
        claimant.foundAtRef
      );
    }
  }
  add(runtimeAttentionFacts, 'status.phase', projection.status.phase);
  add(runtimeAttentionFacts, 'status.health', projection.status.health);
  if (attention === null) {
    unavailable(gitAttentionFacts, 'attention unavailable');
    unavailable(runtimeAttentionFacts, 'attention unavailable');
  } else {
    for (const scanned of attention.scanned) {
      if (scanned.runStateVisibility.kind === 'execution-root') {
        add(
          runtimeAttentionFacts,
          `${scanned.issueId}.runStateVisibility.executionRoot`,
          scanned.runStateVisibility.executionRoot
        );
      }
    }
    for (const item of attention.items) {
      const family = issueAttentionProvenanceFamily(item);
      const facts =
        family === 'attention-runtime'
          ? runtimeAttentionFacts
          : family === 'delivery'
            ? deliveryFacts
            : family === 'acceptance-review'
              ? acceptanceFacts
              : gitAttentionFacts;
      add(facts, 'attention.kind', item.kind);
      add(facts, 'attention.issueId', item.issueId);
      add(facts, 'attention.phase', item.phase);
      add(facts, 'attention.health', item.health);
      add(facts, 'attention.nodeId', item.nodeId);
      add(facts, 'attention.alias', item.alias);
      if (item.kind === 'failure') add(facts, 'attention.diagnostic', item.diagnostic);
      if (item.kind === 'blocked-behind') {
        for (const blocker of item.blockers) {
          add(facts, 'attention.blocker.nodeId', blocker.nodeId);
          add(facts, 'attention.blocker.projectId', blocker.projectId);
          add(facts, 'attention.blocker.state', blocker.state);
        }
      }
      if (item.kind === 'problem') {
        addProblem(facts, 'attention.problem', item.problem);
      }
      if (family === 'attention-runtime' && item.nodeId !== null) {
        const node = projection.status.nodes.find((candidate) => candidate.nodeId === item.nodeId);
        if (node !== undefined) addNodeInputs(facts, node, `support.${node.nodeId}`);
      }
      if (family === 'attention-runtime' && item.kind === 'blocked-behind') {
        for (const blocker of item.blockers) {
          const node = projection.status.nodes.find(
            (candidate) => candidate.nodeId === blocker.nodeId
          );
          if (node !== undefined) addNodeInputs(facts, node, `support.${node.nodeId}`);
        }
      }
    }
    for (const ref of attention.unsearchedRefs) {
      add(gitAttentionFacts, 'attention.unsearchedRefs[].targetLineId', ref.targetLineId);
      add(gitAttentionFacts, 'attention.unsearchedRefs[].storeRef', ref.storeRef);
      add(gitAttentionFacts, 'attention.unsearchedRefs[].reason', ref.reason);
    }
    if (gitAttentionFacts.length === 0) unavailable(gitAttentionFacts);
    if (runtimeAttentionFacts.length === 0) unavailable(runtimeAttentionFacts);
  }

  const factsByFamily: Record<IssueProvenanceFamily, IssueProvenanceFact[]> = {
    'issue-record': issueFacts,
    'plan-projection': planFacts,
    'acceptance-review': acceptanceFacts,
    runtime: runtimeFacts,
    delivery: deliveryFacts,
    'attention-git': gitAttentionFacts,
    'attention-runtime': runtimeAttentionFacts,
  };
  return (Object.keys(ISSUE_PROVENANCE) as IssueProvenanceFamily[]).map((family) => ({
    family,
    ...ISSUE_PROVENANCE[family],
    facts: factsByFamily[family],
  }));
}
