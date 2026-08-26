/**
 * `issue-node-lifecycle` task 1.3 — the lifecycle vocabulary at the plan-node
 * schema: the closed enum, default-as-absent, the conditional reason, and the
 * canonical omission that keeps g-001-era digests byte-stable.
 *
 * The digest literal below is LITERAL hex computed from the PRE-CHANGE (g-001)
 * build over the exact fixture spelled beside it — the byte-stability mandate
 * as a pinned anchor, not a recomputation that would move with the
 * implementation. The two `d35cf8f0…`/`0961437e…` literals in
 * `store-issue-plan-canonicalization.test.ts` pin the intent-node side of the
 * same mandate; this suite pins the change-node side.
 */
import { describe, expect, it } from 'vitest';

import {
  executionPlanDigest,
  findPlanNodeSchemaProblems,
  normalizePlanNodes,
  parseExecutionPlanRevision,
  serializeExecutionPlanRevision,
} from '../../../src/core/store/issues/plans.js';
import type { ExecutionPlanNodeInput } from '../../../src/core/store/issues/types.js';
import {
  StorePlanningValidationError,
  parseExecutionPlanRevisionId,
  parseIssueId,
} from '../../../src/core/store/planning-validation.js';

const PROJECT = 'app-a';
const LINE = 'main';

/** `ci_<64 lowercase hex>` — the identity shape the schema demands. */
const ci = (hex: string): string => `ci_${hex.padEnd(64, '0')}`;

const changeNode = (
  overrides: Partial<ExecutionPlanNodeInput> & { nodeId: string }
): ExecutionPlanNodeInput => ({
  kind: 'change',
  projectId: PROJECT,
  targetLineId: LINE,
  changeInstanceId: ci('a1'),
  changeAlias: 'child-a',
  dependsOn: [],
  ...overrides,
});

/** The g-001-shaped two-node revision the digest pin mints: no lifecycle fields. */
const g001ShapedNodes = (): readonly ExecutionPlanNodeInput[] => [
  changeNode({ nodeId: 'g-001', changeInstanceId: ci('a1'), changeAlias: 'child-a', dependsOn: [] }),
  changeNode({
    nodeId: 'g-002',
    changeInstanceId: ci('b2'),
    changeAlias: 'child-b',
    dependsOn: ['g-001'],
  }),
];

const revisionBody = (nodes: readonly ExecutionPlanNodeInput[]) => ({
  version: 1 as const,
  issueId: parseIssueId('iss-lc'),
  revisionId: parseExecutionPlanRevisionId('0001'),
  supersedes: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  nodes: normalizePlanNodes(nodes),
});

function normalizeThrowing(nodes: readonly ExecutionPlanNodeInput[]): unknown {
  try {
    normalizePlanNodes(nodes);
    return null;
  } catch (error) {
    return error;
  }
}

describe('plan-node lifecycle schema (issue-node-lifecycle D1/D2)', () => {
  it('reads an absent lifecycle back as required: the node carries neither field', () => {
    const [node] = normalizePlanNodes(g001ShapedNodes());
    expect(node?.kind).toBe('change');
    if (node?.kind !== 'change') return;
    expect('lifecycle' in node).toBe(false);
    expect('reason' in node).toBe(false);
    expect(node.lifecycle).toBeUndefined();
    expect(node.reason).toBeUndefined();
  });

  it('digest pin: a g-001-shaped change-node revision re-derives its published digest', () => {
    // The literal was computed from the PRE-CHANGE dist over these exact
    // inputs. If the schema change altered any byte of the canonical body for
    // absent-lifecycle revisions, this literal stops matching — the mandate
    // "EXISTING revision digests stay byte-stable" as one pinned fact.
    expect(executionPlanDigest(revisionBody(g001ShapedNodes()))).toBe(
      '07e5b12c6c75e14d1b72a52765eb165b0d47ae83da0146a7f0ce6c7dd22b64a1'
    );
  });

  it('an explicit required normalizes to absent: two spellings, one digest', () => {
    const spelled = g001ShapedNodes().map(node =>
      node.kind === 'change' ? { ...node, lifecycle: 'required' } : node
    );
    const absent = normalizePlanNodes(g001ShapedNodes());
    const explicit = normalizePlanNodes(spelled);
    // Neither node carries the field in canonical form...
    for (const node of explicit) {
      if (node.kind === 'change') expect('lifecycle' in node).toBe(false);
    }
    // ...and the two spellings mint one digest — the same literal the pin above
    // anchors, so this equality cannot pass against a drifting body either.
    expect(executionPlanDigest({ ...revisionBody([]), nodes: explicit })).toBe(
      executionPlanDigest({ ...revisionBody([]), nodes: absent })
    );
    expect(executionPlanDigest({ ...revisionBody([]), nodes: explicit })).toBe(
      '07e5b12c6c75e14d1b72a52765eb165b0d47ae83da0146a7f0ce6c7dd22b64a1'
    );
  });

  it('refuses a cancelled node without a reason, naming the node and the rule', () => {
    const thrown = normalizeThrowing([
      changeNode({ nodeId: 'g-002', lifecycle: 'cancelled' }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].reason');
    expect((thrown as Error).message).toContain('g-002');
    expect((thrown as Error).message).toContain('cancelled');
    expect((thrown as Error).message).toContain('recorded reason');

    expect(
      findPlanNodeSchemaProblems([changeNode({ nodeId: 'g-002', lifecycle: 'cancelled' })])
    ).toEqual([
      { nodeId: 'g-002', problem: expect.stringContaining('reason') },
    ]);
  });

  it('refuses a superseded node without a reason', () => {
    const thrown = normalizeThrowing([
      changeNode({ nodeId: 'g-003', lifecycle: 'superseded' }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('g-003');
    expect((thrown as Error).message).toContain('superseded');
    expect((thrown as Error).message).toContain('recorded reason');
  });

  it('refuses a non-portable reason at the schema rather than trimming it', () => {
    const pathReason = normalizeThrowing([
      changeNode({ nodeId: 'g-002', lifecycle: 'cancelled', reason: 'C:\\work\\logs\\why.txt' }),
    ]);
    expect(pathReason).toBeInstanceOf(StorePlanningValidationError);
    expect((pathReason as StorePlanningValidationError).field).toBe('nodes[0].reason');
    expect((pathReason as Error).message).toContain('machine filesystem path');

    const credentialReason = normalizeThrowing([
      changeNode({
        nodeId: 'g-002',
        lifecycle: 'cancelled',
        reason: 'see https://user:secret@example.com/repo for why',
      }),
    ]);
    expect(credentialReason).toBeInstanceOf(StorePlanningValidationError);
    expect((credentialReason as Error).message).toContain('credentials');
  });

  it('refuses an out-of-vocabulary lifecycle, naming the value and every defined one', () => {
    const thrown = normalizeThrowing([
      changeNode({ nodeId: 'g-002', lifecycle: 'dropped' }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('dropped');
    // Widened by issue-deferral-record: `deferred` joined the closed
    // vocabulary, so the refusal names five values, not four.
    for (const value of ['required', 'optional', 'cancelled', 'superseded', 'deferred']) {
      expect((thrown as Error).message).toContain(value);
    }

    expect(
      findPlanNodeSchemaProblems([changeNode({ nodeId: 'g-002', lifecycle: 'dropped' })])
    ).toEqual([
      {
        nodeId: 'g-002',
        problem: expect.stringContaining('superseded'),
      },
    ]);
  });

  it('refuses an intent node carrying a lifecycle or a reason, by name', () => {
    const intentBase = {
      kind: 'intent' as const,
      projectId: PROJECT,
      targetLineId: LINE,
      summary: 'work declared, no Change yet',
      dependsOn: [],
    };
    const withLifecycle = normalizeThrowing([
      { nodeId: 'i-001', ...intentBase, lifecycle: 'cancelled' },
    ]);
    expect(withLifecycle).toBeInstanceOf(StorePlanningValidationError);
    expect((withLifecycle as Error).message).toContain('lifecycle');

    const withReason = normalizeThrowing([
      { nodeId: 'i-001', ...intentBase, reason: 'why' },
    ]);
    expect(withReason).toBeInstanceOf(StorePlanningValidationError);
    expect((withReason as Error).message).toContain('reason');
  });

  it('refuses a reason on wanted work — it explains only work the plan does not demand', () => {
    const thrown = normalizeThrowing([
      changeNode({ nodeId: 'g-001', reason: 'nice to have' }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].reason');
    // Reworded by issue-deferral-record: the reason-bearing family gained
    // `deferred`, whose work IS still wanted, so the refusal says the plan
    // does not DEMAND the work toward Done rather than no longer wants it.
    expect((thrown as Error).message).toContain('cancelled, superseded, or deferred');
    expect((thrown as Error).message).toContain('does not demand toward Done');
  });

  it('carries a cancelled node with its reason through normalize, serialize, and read-back', () => {
    const nodes = normalizePlanNodes([
      changeNode({
        nodeId: 'g-002',
        changeInstanceId: ci('b2'),
        changeAlias: 'child-b',
        lifecycle: 'cancelled',
        reason: 'descoped from this milestone',
        dependsOn: [],
      }),
      changeNode({ nodeId: 'g-003', lifecycle: 'optional', dependsOn: [] }),
    ]);
    const cancelled = nodes.find(node => node.nodeId === 'g-002');
    expect(cancelled).toMatchObject({ lifecycle: 'cancelled', reason: 'descoped from this milestone' });
    const optional = nodes.find(node => node.nodeId === 'g-003');
    expect(optional).toMatchObject({ lifecycle: 'optional' });
    expect(optional && 'reason' in optional).toBe(false);

    // Full revision round trip: the digest covers the carried fields, and the
    // serialized bytes read back identical.
    const body = revisionBody([
      changeNode({
        nodeId: 'g-002',
        changeInstanceId: ci('b2'),
        changeAlias: 'child-b',
        lifecycle: 'cancelled',
        reason: 'descoped from this milestone',
        dependsOn: [],
      }),
      changeNode({ nodeId: 'g-003', lifecycle: 'optional', dependsOn: [] }),
    ]);
    const revision = { ...body, contentSha256: executionPlanDigest(body) };
    const serialized = serializeExecutionPlanRevision(revision);
    const reread = parseExecutionPlanRevision(serialized, { verifyDigest: true });
    expect(reread.nodes.find(node => node.nodeId === 'g-002')).toMatchObject({
      lifecycle: 'cancelled',
      reason: 'descoped from this milestone',
    });
    // The stored form omits the field for wanted work.
    expect(serialized).not.toContain('lifecycle: required');
  });
});
