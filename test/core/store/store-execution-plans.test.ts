import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { StorePlanningValidationError } from '../../../src/core/store/planning-foundation.js';
import {
  checkExecutionPlanGraph,
  executionPlanDigest,
  normalizePlanNodes,
  parseExecutionPlanRevision,
  serializeExecutionPlanRevision,
  validateExecutionPlanRevision,
} from '../../../src/core/store/issues/plans.js';
import type {
  ExecutionPlanNodeInput,
  ExecutionPlanRevisionV1,
} from '../../../src/core/store/issues/types.js';

const INSTANCE_A = `ci_${'a1'.repeat(32)}`;
const INSTANCE_B = `ci_${'b2'.repeat(32)}`;
const CREATED_AT = '2026-08-07T00:00:00.000Z';

function revision(
  nodes: readonly ExecutionPlanNodeInput[],
  overrides: Partial<Omit<ExecutionPlanRevisionV1, 'contentSha256' | 'nodes'>> = {}
): ExecutionPlanRevisionV1 {
  const draft = {
    version: 1 as const,
    issueId: 'cross-line-telemetry',
    revisionId: '0001',
    supersedes: null,
    createdAt: CREATED_AT,
    ...overrides,
    nodes: normalizePlanNodes(nodes),
  } as Omit<ExecutionPlanRevisionV1, 'contentSha256'>;
  return { ...draft, contentSha256: executionPlanDigest(draft) };
}

const CHANGE_NODE: ExecutionPlanNodeInput = {
  nodeId: 'elftia-emit',
  kind: 'change',
  projectId: 'elftia',
  targetLineId: 'line-0.2',
  changeInstanceId: INSTANCE_A,
  changeAlias: 'telemetry-emit',
  dependsOn: [],
};

const INTENT_NODE: ExecutionPlanNodeInput = {
  nodeId: 'rocut-consume',
  kind: 'intent',
  projectId: 'rocut',
  targetLineId: 'main',
  summary: 'Consume the unified event shape',
  dependsOn: ['elftia-emit'],
};

describe('Execution Plan revision schema', () => {
  it('round-trips a mixed-kind revision byte-for-byte', () => {
    const first = serializeExecutionPlanRevision(revision([CHANGE_NODE, INTENT_NODE]));
    const parsed = parseExecutionPlanRevision(first, { verifyDigest: true });
    expect(serializeExecutionPlanRevision(parsed)).toBe(first);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.kind).toBe('change');
    expect(parsed.nodes[1]?.kind).toBe('intent');
  });

  it('rejects an unknown field', () => {
    const raw = parseYaml(serializeExecutionPlanRevision(revision([CHANGE_NODE]))) as Record<
      string,
      unknown
    >;
    raw.owner = 'someone';
    expect(() => validateExecutionPlanRevision(raw)).toThrow(StorePlanningValidationError);
  });

  it('rejects an unknown field on a node', () => {
    const raw = parseYaml(serializeExecutionPlanRevision(revision([CHANGE_NODE]))) as {
      nodes: Record<string, unknown>[];
    };
    (raw.nodes[0] as Record<string, unknown>).worktreeRoot = '/tmp/somewhere';
    expect(() => validateExecutionPlanRevision(raw)).toThrow(StorePlanningValidationError);
  });

  it('refuses a node that carries a path, a worktree root, or a branch name', () => {
    for (const field of ['path', 'branch', 'worktree']) {
      const raw = parseYaml(
        serializeExecutionPlanRevision(revision([{ ...INTENT_NODE, dependsOn: [] }]))
      ) as { nodes: Record<string, unknown>[] };
      (raw.nodes[0] as Record<string, unknown>)[field] = 'refs/heads/change/x';
      expect(() => validateExecutionPlanRevision(raw)).toThrow(StorePlanningValidationError);
    }
  });

  it('refuses an intent summary that is a machine path', () => {
    expect(() =>
      normalizePlanNodes([{ ...INTENT_NODE, summary: 'C:\\work\\rocut', dependsOn: [] }])
    ).toThrow(StorePlanningValidationError);
  });

  it('refuses a supersedes ordinal that does not precede the revision', () => {
    expect(() =>
      validateExecutionPlanRevision({
        ...revision([CHANGE_NODE], { revisionId: '0002', supersedes: '0003' }),
      })
    ).toThrow(/must precede/u);
  });

  it('refuses a change alias that is not a Change alias', () => {
    expect(() =>
      normalizePlanNodes([
        { ...CHANGE_NODE, changeAlias: 'refs/heads/change/telemetry', dependsOn: [] },
      ])
    ).toThrow(StorePlanningValidationError);
  });
});

describe('The recorded canonical digest', () => {
  it('covers every field except itself', () => {
    const original = revision([CHANGE_NODE, INTENT_NODE]);
    const relabelled = { ...original, contentSha256: `${'0'.repeat(64)}` } as ExecutionPlanRevisionV1;
    // Changing only the digest must not change what the digest is computed over.
    expect(executionPlanDigest(relabelled)).toBe(original.contentSha256);
  });

  it('reports a hand-edited revision rather than repairing or re-digesting it', () => {
    const serialized = serializeExecutionPlanRevision(revision([CHANGE_NODE]));
    const tampered = serialized.replace('elftia-emit', 'elftia-emit2');
    expect(() => parseExecutionPlanRevision(tampered, { verifyDigest: true })).toThrow(
      /does not match the revision body/u
    );
    // Without digest verification the body still parses, which is what makes
    // the mismatch a REPORT rather than an inability to read the file at all.
    const readAnyway = parseExecutionPlanRevision(tampered);
    expect(readAnyway.nodes[0]?.nodeId).toBe('elftia-emit2');
  });

  it('changes when any covered field changes', () => {
    const base = revision([CHANGE_NODE]);
    const otherTime = revision([CHANGE_NODE], { createdAt: '2026-08-08T00:00:00.000Z' });
    const otherOrdinal = revision([CHANGE_NODE], { revisionId: '0002', supersedes: '0001' });
    expect(otherTime.contentSha256).not.toBe(base.contentSha256);
    expect(otherOrdinal.contentSha256).not.toBe(base.contentSha256);
  });
});

describe('Graph validation refuses before anything is written', () => {
  it('refuses a dependency cycle naming the cycle', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...CHANGE_NODE, nodeId: 'a', dependsOn: ['b'] },
        { ...INTENT_NODE, nodeId: 'b', dependsOn: ['c'] },
        { ...INTENT_NODE, nodeId: 'c', dependsOn: ['a'] },
      ])
    );
    const cycle = violations.find(entry => entry.code === 'execution_plan_cycle');
    expect(cycle).toBeDefined();
    expect(cycle?.nodes).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(cycle?.message).toContain('->');
  });

  it('refuses a self-dependency', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([{ ...INTENT_NODE, nodeId: 'a', dependsOn: ['a'] }])
    );
    expect(violations.map(entry => entry.code)).toContain('execution_plan_cycle');
    expect(violations[0]?.message).toContain('depends on itself');
  });

  it('refuses a dependency on an unknown node', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([{ ...INTENT_NODE, nodeId: 'a', dependsOn: ['ghost'] }])
    );
    expect(violations[0]?.code).toBe('execution_plan_cycle');
    expect(violations[0]?.message).toContain('unknown node ghost');
  });

  it('refuses a duplicate node identifier', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...INTENT_NODE, nodeId: 'a', dependsOn: [] },
        { ...INTENT_NODE, nodeId: 'a', dependsOn: [] },
      ])
    );
    expect(violations.some(entry => entry.code === 'execution_plan_node_duplicate')).toBe(true);
  });

  it('refuses two nodes naming one Change instance', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...CHANGE_NODE, nodeId: 'first', dependsOn: [] },
        { ...CHANGE_NODE, nodeId: 'second', changeAlias: 'other-alias', dependsOn: [] },
      ])
    );
    const duplicate = violations.find(entry => entry.code === 'execution_plan_node_duplicate');
    expect(duplicate?.message).toContain(INSTANCE_A);
    expect(duplicate?.nodes).toEqual(['first', 'second']);
  });

  it('reports every violation together rather than one per attempt', () => {
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...CHANGE_NODE, nodeId: 'a', dependsOn: ['ghost'] },
        { ...CHANGE_NODE, nodeId: 'b', dependsOn: [] },
      ])
    );
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(new Set(violations.map(entry => entry.code))).toEqual(
      new Set(['execution_plan_cycle', 'execution_plan_node_duplicate'])
    );
  });

  it('accepts a DAG with a diamond', () => {
    expect(
      checkExecutionPlanGraph(
        normalizePlanNodes([
          { ...INTENT_NODE, nodeId: 'root', dependsOn: [] },
          { ...INTENT_NODE, nodeId: 'left', dependsOn: ['root'] },
          { ...INTENT_NODE, nodeId: 'right', dependsOn: ['root'] },
          { ...INTENT_NODE, nodeId: 'join', dependsOn: ['left', 'right'] },
        ])
      )
    ).toEqual([]);
  });

  it('refuses a validated revision whose graph is broken', () => {
    expect(() =>
      validateExecutionPlanRevision({
        version: 1,
        issueId: 'cross-line-telemetry',
        revisionId: '0001',
        supersedes: null,
        createdAt: CREATED_AT,
        contentSha256: '0'.repeat(64),
        nodes: [
          {
            nodeId: 'a',
            kind: 'intent',
            projectId: 'rocut',
            targetLineId: 'main',
            summary: 'x',
            dependsOn: ['a'],
          },
        ],
      })
    ).toThrow(/depends on itself/u);
  });
});

describe('Both node kinds carry their scope', () => {
  it('records the project and target line on an intent node with no Change', () => {
    const [node] = normalizePlanNodes([INTENT_NODE]);
    expect(node).toMatchObject({
      kind: 'intent',
      projectId: 'rocut',
      targetLineId: 'main',
      summary: 'Consume the unified event shape',
    });
    expect(node).not.toHaveProperty('changeInstanceId');
  });

  it('keeps the alias as data and never as a second identity field', () => {
    const [node] = normalizePlanNodes([CHANGE_NODE]);
    expect(node).toMatchObject({ changeInstanceId: INSTANCE_A, changeAlias: 'telemetry-emit' });
    // Two nodes differing ONLY in alias still collide on the instance, which is
    // the shape that proves the instance is what identifies a node's Change.
    const violations = checkExecutionPlanGraph(
      normalizePlanNodes([
        { ...CHANGE_NODE, nodeId: 'x', changeAlias: 'one', dependsOn: [] },
        { ...CHANGE_NODE, nodeId: 'y', changeAlias: 'two', dependsOn: [] },
      ])
    );
    expect(violations.some(entry => entry.code === 'execution_plan_node_duplicate')).toBe(true);
  });

  it('treats two nodes with different instances as distinct', () => {
    expect(
      checkExecutionPlanGraph(
        normalizePlanNodes([
          { ...CHANGE_NODE, nodeId: 'x', changeInstanceId: INSTANCE_A, dependsOn: [] },
          { ...CHANGE_NODE, nodeId: 'y', changeInstanceId: INSTANCE_B, dependsOn: [] },
        ])
      )
    ).toEqual([]);
  });
});
