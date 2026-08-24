import { describe, expect, it } from 'vitest';

import type {
  StoreIssueAttentionResponse,
  StoreIssueProjectionResponse,
} from '../../src/api/types.js';
import {
  buildIssueProvenance,
  issueAttentionProvenanceFamily,
  issueHealthProvenanceFamily,
  issuePhaseProvenanceFamily,
  issueProvenanceHref,
  type IssueProvenanceEntry,
  type IssueProvenanceFamily,
} from '../../src/components/issue-provenance.js';
import {
  issueAttentionNarrowedFixture,
  issueAttentionUnreadableFixture,
  realIssueProjectionFixture,
  unreadableIssueProjectionFixture,
} from '../fixtures/issue-projection.js';

function resolveTarget(
  entries: IssueProvenanceEntry[],
  family: IssueProvenanceFamily
): IssueProvenanceEntry {
  const href = issueProvenanceHref('/s/store/issues/issue', family);
  const anchor = href.slice(href.indexOf('#') + 1);
  const targets = entries.filter((entry) => entry.anchor === anchor);
  expect(targets, href).toHaveLength(1);
  return targets[0]!;
}

function values(entry: IssueProvenanceEntry, label: string): string[] {
  return entry.facts.filter((fact) => fact.label === label).map((fact) => fact.value);
}

function runtimeFailurePayload(): {
  projection: StoreIssueProjectionResponse;
  attention: StoreIssueAttentionResponse;
} {
  const failedNode = {
    ...realIssueProjectionFixture.status.nodes[1]!,
    observation: 'failed' as const,
    diagnostic: 'stage apply escalated',
    runStatePath: 'E:\\fixture\\active-change\\auto-run.json',
    locatedBy: 'execution-root' as const,
    attribution: {
      ...realIssueProjectionFixture.status.nodes[1]!.attribution,
      evidenceLocator: 'E:\\fixture\\active-change\\evidence',
    },
    delivery: { state: 'not-archived' as const },
  };
  const projection = {
    ...realIssueProjectionFixture,
    issue: {
      ...realIssueProjectionFixture.issue,
      record: { ...realIssueProjectionFixture.issue.record, state: 'open' as const },
    },
    status: {
      ...realIssueProjectionFixture.status,
      phase: 'active' as const,
      health: 'failed' as const,
      progress: { completed: 1, total: 2 },
      nodes: [realIssueProjectionFixture.status.nodes[0]!, failedNode],
      acceptance: null,
    },
  } satisfies StoreIssueProjectionResponse;
  const attention = {
    ...issueAttentionNarrowedFixture,
    scanned: [
      {
        issueId: projection.issue.issueId,
        phase: projection.status.phase,
        health: projection.status.health,
        itemCount: 1,
        runStateVisibility: projection.status.runStateVisibility,
      },
    ],
    items: [
      {
        issueId: projection.issue.issueId,
        phase: projection.status.phase,
        health: projection.status.health,
        nodeId: failedNode.nodeId,
        alias: failedNode.alias,
        kind: 'failure' as const,
        diagnostic: failedNode.diagnostic,
      },
    ],
    counts: {
      failure: 1,
      'blocked-behind': 0,
      'waiting-human': 0,
      'acceptance-awaiting': 0,
      problem: 0,
    },
    total: 1,
  } satisfies StoreIssueAttentionResponse;
  return { projection, attention };
}

describe('Issue provenance semantics', () => {
  it('targets done at the resolved Issue state and verified acceptance record', () => {
    const entries = buildIssueProvenance(
      realIssueProjectionFixture,
      issueAttentionNarrowedFixture
    );
    const target = resolveTarget(
      entries,
      issuePhaseProvenanceFamily(realIssueProjectionFixture.status.phase)
    );

    expect(target.kind).toBe('git');
    expect(values(target, 'issue.record.state')).toContain(
      realIssueProjectionFixture.issue.record.state
    );
    expect(values(target, 'acceptance.record.contentSha256')).toContain(
      realIssueProjectionFixture.status.acceptance.record.contentSha256
    );
    expect(values(target, 'acceptance.record.conditionsSha256')).toContain(
      realIssueProjectionFixture.status.acceptance.record.conditionsSha256
    );
  });

  it('targets review/waiting at Issue, acceptance, and terminal-node inputs', () => {
    const projection = {
      ...realIssueProjectionFixture,
      issue: {
        ...realIssueProjectionFixture.issue,
        record: { ...realIssueProjectionFixture.issue.record, state: 'open' as const },
      },
      status: {
        ...realIssueProjectionFixture.status,
        phase: 'review' as const,
        health: 'waiting-human' as const,
        acceptance: {
          ...realIssueProjectionFixture.status.acceptance,
          record: null,
        },
      },
    } satisfies StoreIssueProjectionResponse;
    const entries = buildIssueProvenance(projection, null);
    const phaseTarget = resolveTarget(entries, issuePhaseProvenanceFamily(projection.status.phase));
    const healthTarget = resolveTarget(
      entries,
      issueHealthProvenanceFamily(projection.status.phase, projection.status.health)
    );

    expect(phaseTarget).toBe(healthTarget);
    expect(values(phaseTarget, 'issue.record.state')).toContain('open');
    for (const node of projection.status.nodes) {
      expect(values(phaseTarget, `status.${node.nodeId}.lifecycle`)).toContain(node.lifecycle);
      expect(values(phaseTarget, `status.${node.nodeId}.observation`)).toContain(
        node.observation
      );
    }
  });

  it('targets healthy and partial progress at exact lifecycle/observation completion inputs', () => {
    const { projection } = runtimeFailurePayload();
    const healthyProjection = {
      ...projection,
      status: {
        ...projection.status,
        health: 'healthy' as const,
      },
    } satisfies StoreIssueProjectionResponse;
    const entries = buildIssueProvenance(healthyProjection, null);
    const healthTarget = resolveTarget(
      entries,
      issueHealthProvenanceFamily(
        healthyProjection.status.phase,
        healthyProjection.status.health
      )
    );
    const progressTarget = resolveTarget(entries, 'plan-projection');

    expect(values(healthTarget, 'status.health')).toContain('healthy');
    expect(values(progressTarget, 'status.progress.completed')).toContain('1');
    expect(values(progressTarget, 'status.progress.total')).toContain('2');
    for (const node of healthyProjection.status.nodes) {
      expect(values(progressTarget, `${node.nodeId}.lifecycle`)).toContain(node.lifecycle);
      expect(values(progressTarget, `${node.nodeId}.observation`)).toContain(node.observation);
    }
  });

  it('targets a runtime failure at its exact node and runtime locators', () => {
    const { projection, attention } = runtimeFailurePayload();
    const item = attention.items[0]!;
    const target = resolveTarget(
      buildIssueProvenance(projection, attention),
      issueAttentionProvenanceFamily(item)
    );
    const failedNode = projection.status.nodes[1]!;

    expect(target.kind).toBe('runtime');
    expect(values(target, 'attention.kind')).toContain('failure');
    expect(values(target, 'attention.diagnostic')).toContain('stage apply escalated');
    expect(values(target, `support.${failedNode.nodeId}.lifecycle`)).toContain(
      failedNode.lifecycle
    );
    expect(values(target, `support.${failedNode.nodeId}.observation`)).toContain('failed');
    expect(values(target, `support.${failedNode.nodeId}.runStatePath`)).toContain(
      failedNode.runStatePath!
    );
    expect(values(target, `support.${failedNode.nodeId}.evidenceLocator`)).toContain(
      failedNode.attribution.evidenceLocator!
    );
  });

  it('targets a Git readability problem at its exact problem/ref facts, not runtime', () => {
    const item = issueAttentionUnreadableFixture.items[0]!;
    const target = resolveTarget(
      buildIssueProvenance(
        unreadableIssueProjectionFixture,
        issueAttentionUnreadableFixture
      ),
      issueAttentionProvenanceFamily(item)
    );

    expect(target.kind).toBe('git');
    expect(values(target, 'attention.problem.kind')).toContain(item.problem.kind);
    expect(values(target, 'attention.problem.ref')).toContain(item.problem.ref!);
    expect(values(target, 'attention.problem.reason')).toContain(item.problem.reason);
    expect(values(target, 'issue.refs[]')).toContain(
      unreadableIssueProjectionFixture.issue.refs[0]!
    );
    expect(values(target, 'plan.diagnostic')).toContain(
      unreadableIssueProjectionFixture.plan.diagnostic
    );
  });

  it('targets unreadable delivery at its state and invalid archive record locator', () => {
    const problem = {
      kind: 'invalid-archive-record' as const,
      node: realIssueProjectionFixture.status.nodes[0]!.nodeId,
      ref: 'rasen/projects/browser-app/changes/archive/main/broken/archive.json',
      reason: 'archive record failed v2 validation',
    };
    const projection = {
      ...realIssueProjectionFixture,
      status: {
        ...realIssueProjectionFixture.status,
        nodes: realIssueProjectionFixture.status.nodes.map((node, index) =>
          index === 0 ? { ...node, delivery: { state: 'unreadable' as const } } : node
        ),
        problems: [problem],
      },
    } satisfies StoreIssueProjectionResponse;
    const attention = {
      ...issueAttentionNarrowedFixture,
      items: [
        {
          issueId: projection.issue.issueId,
          phase: projection.status.phase,
          health: projection.status.health,
          nodeId: problem.node,
          alias: projection.status.nodes[0]!.alias,
          kind: 'problem' as const,
          problem,
        },
      ],
      counts: {
        failure: 0,
        'blocked-behind': 0,
        'waiting-human': 0,
        'acceptance-awaiting': 0,
        problem: 1,
      },
      total: 1,
    } satisfies StoreIssueAttentionResponse;
    const target = resolveTarget(
      buildIssueProvenance(projection, attention),
      issueAttentionProvenanceFamily(attention.items[0]!)
    );

    expect(target.kind).toBe('git');
    expect(values(target, `${problem.node}.delivery.state`)).toContain('unreadable');
    expect(values(target, 'attention.problem.ref')).toContain(problem.ref);
    expect(values(target, 'attention.problem.reason')).toContain(problem.reason);
  });
});
