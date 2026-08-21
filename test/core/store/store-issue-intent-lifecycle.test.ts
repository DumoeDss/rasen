/**
 * `issue-autodecompose-review-flow` tasks 1.1/1.2 — the intent node's
 * required/optional lifecycle at the plan-node schema, and the authored-input
 * extra-keys refusal.
 *
 * The digest literal below is LITERAL hex computed from the PRE-CHANGE
 * (g-002) build over the exact fixture spelled beside it — an intent revision
 * carrying the decomposition-guidance fields. The byte-stability mandate for
 * the intent-lifecycle widening ("old revisions byte-stable") as one pinned
 * anchor, exactly as `store-issue-node-lifecycle.test.ts` pins the change-node
 * side and `store-issue-plan-canonicalization.test.ts` pins the plain-intent
 * side.
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

const PROJECT = 'proj-a';
const LINE = 'main';

const intent = (
  nodeId: string,
  overrides: Partial<ExecutionPlanNodeInput> = {}
): ExecutionPlanNodeInput => ({
  nodeId,
  kind: 'intent',
  projectId: PROJECT,
  targetLineId: LINE,
  summary: `work ${nodeId}`,
  dependsOn: [],
  ...overrides,
});

/** A g-002-shaped decomposition revision: suggestions + rationale, no lifecycle. */
const g002ShapedNodes = (): readonly ExecutionPlanNodeInput[] => [
  intent('i-a', {
    projectId: 'proj-a',
    suggestedPipeline: 'small-feature',
    rationale: 'why i-a exists',
  }),
  intent('i-b', {
    projectId: 'proj-b',
    dependsOn: ['i-a'],
    suggestedPipeline: 'bug-fix',
    uncertainty: 'unsure about i-b',
  }),
];

const revisionBody = (nodes: readonly ExecutionPlanNodeInput[]) => ({
  version: 1 as const,
  issueId: parseIssueId('iss-intent-pin'),
  revisionId: parseExecutionPlanRevisionId('0002'),
  supersedes: parseExecutionPlanRevisionId('0001'),
  createdAt: '2026-08-21T00:00:00.000Z',
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

describe('intent-node lifecycle schema (review-flow D1, task 1.1)', () => {
  it('reads an absent lifecycle back as required: the node carries no field', () => {
    const [node] = normalizePlanNodes(g002ShapedNodes());
    expect(node?.kind).toBe('intent');
    if (node?.kind !== 'intent') return;
    expect('lifecycle' in node).toBe(false);
    expect(node.lifecycle).toBeUndefined();
  });

  it('digest pin: a g-002-shaped intent revision re-derives its published digest', () => {
    // The literal was computed from the PRE-change build over these exact
    // inputs (an intent revision carrying suggestions and rationale, the exact
    // shape g-002 published for the dogfood Issue). If the intent-lifecycle
    // widening altered any byte of the canonical body for absent-lifecycle
    // revisions, this literal stops matching.
    expect(executionPlanDigest(revisionBody(g002ShapedNodes()))).toBe(
      '39ecc5de659e2cf29ea75a778c43ca78e61e2878cd49425f35166e8251b134f3'
    );
  });

  it('carries an optional intent node through normalize, serialize, and read-back', () => {
    const nodes = normalizePlanNodes([
      intent('i-a', { lifecycle: 'optional', suggestedPipeline: 'small-feature' }),
      intent('i-b', { dependsOn: ['i-a'] }),
    ]);
    const optional = nodes.find(node => node.nodeId === 'i-a');
    expect(optional).toMatchObject({ kind: 'intent', lifecycle: 'optional' });
    // An explicit required canonicalizes to absent: two spellings of WANTED
    // work — one authored silent, one authored `required` — mint one digest.
    const absent = normalizePlanNodes([
      intent('i-a', { suggestedPipeline: 'small-feature' }),
      intent('i-b', { dependsOn: ['i-a'] }),
    ]);
    const spelled = normalizePlanNodes([
      intent('i-a', { lifecycle: 'required', suggestedPipeline: 'small-feature' }),
      intent('i-b', { dependsOn: ['i-a'] }),
    ]);
    expect('lifecycle' in (spelled[0] as object)).toBe(false);
    expect(executionPlanDigest(revisionBody(spelled))).toBe(
      executionPlanDigest(revisionBody(absent))
    );
    // The full round trip: the digest covers the carried field, the stored
    // form omits `required`, and the bytes read back identical.
    const body = revisionBody([
      intent('i-a', { lifecycle: 'optional', suggestedPipeline: 'small-feature' }),
      intent('i-b', { dependsOn: ['i-a'] }),
    ]);
    const revision = { ...body, contentSha256: executionPlanDigest(body) };
    const serialized = serializeExecutionPlanRevision(revision);
    const reread = parseExecutionPlanRevision(serialized, { verifyDigest: true });
    expect(reread.nodes.find(node => node.nodeId === 'i-a')).toMatchObject({
      lifecycle: 'optional',
    });
    expect(serialized).not.toContain('lifecycle: required');
  });

  it('refuses cancelled/superseded on an intent node, naming the node, the value, and omission', () => {
    for (const value of ['cancelled', 'superseded'] as const) {
      const thrown = normalizeThrowing([intent('i-cut', { lifecycle: value })]);
      expect(thrown).toBeInstanceOf(StorePlanningValidationError);
      expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].lifecycle');
      expect((thrown as Error).message).toContain('i-cut');
      expect((thrown as Error).message).toContain(value);
      expect((thrown as Error).message).toContain('omitting the node from the next revision');
    }
    // The reporting path refuses the same input with the same naming.
    expect(
      findPlanNodeSchemaProblems([intent('i-cut', { lifecycle: 'cancelled' })])
    ).toEqual([
      {
        nodeId: 'i-cut',
        problem: expect.stringContaining('omitting the node from the next revision'),
      },
    ]);
  });

  it('refuses an undefined intent lifecycle, naming the value and the values for the kind', () => {
    const thrown = normalizeThrowing([intent('i-x', { lifecycle: 'dropped' })]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('dropped');
    expect((thrown as Error).message).toContain("'required' | 'optional'");
    expect((thrown as Error).message).toContain('intent node');
  });

  it('still refuses a reason on an intent node', () => {
    const thrown = normalizeThrowing([intent('i-a', { reason: 'why' })]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('reason');
  });
});

describe('authored-input extra-keys refusal (review-flow D3, task 1.2)', () => {
  it('refuses a misspelled suggestion key BY NAME, on the throwing path', () => {
    const thrown = normalizeThrowing([
      intent('i-a', { sugesstedPipeline: 'small-feature' } as Partial<ExecutionPlanNodeInput>),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain("'sugesstedPipeline'");
    expect((thrown as Error).message).toContain('i-a');
    expect((thrown as Error).message).toContain('intent');
  });

  it('refuses the same misspelling on the reporting path, never dropping it', () => {
    expect(
      findPlanNodeSchemaProblems([
        intent('i-a', { sugesstedPipeline: 'small-feature' } as Partial<ExecutionPlanNodeInput>),
      ])
    ).toEqual([
      {
        nodeId: 'i-a',
        problem: expect.stringContaining("'sugesstedPipeline'"),
      },
    ]);
  });

  it('names every unknown field, in a stable order, and refuses rather than publishing', () => {
    const thrown = normalizeThrowing([
      intent('i-a', {
        rationalee: 'typo',
        zzz: 1,
      } as Partial<ExecutionPlanNodeInput>),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    const message = (thrown as Error).message;
    expect(message).toContain("'rationalee'");
    expect(message).toContain("'zzz'");
    expect(message.indexOf("'rationalee'")).toBeLessThan(message.indexOf("'zzz'"));
  });

  it('refuses a change-only field on an intent node and an intent-only field on a change node', () => {
    const changeExtras = normalizeThrowing([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci_'.padEnd(67, '0'),
        dependsOn: [],
        summary: 'a summary a change node does not carry',
      },
    ]);
    expect(changeExtras).toBeInstanceOf(StorePlanningValidationError);
    expect((changeExtras as Error).message).toContain("'summary'");
    expect((changeExtras as Error).message).toContain('change');

    const intentExtras = normalizeThrowing([
      intent('i-a', { changeInstanceId: 'ci_'.padEnd(67, '0') } as Partial<ExecutionPlanNodeInput>),
    ]);
    expect(intentExtras).toBeInstanceOf(StorePlanningValidationError);
    expect((intentExtras as Error).message).toContain("'changeInstanceId'");
    expect((intentExtras as Error).message).toContain('intent');
  });

  it('every documented field still parses: the known sets match the schemas', () => {
    // The full declared vocabulary for both kinds goes through unchanged —
    // the strictness refusal must bite ONLY on fields outside the schema.
    const nodes = normalizePlanNodes([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci_'.padEnd(67, '1'),
        changeAlias: 'child-a',
        lifecycle: 'optional',
        reason: undefined,
        dependsOn: [],
        suggestedPipeline: 'small-feature',
        rationale: 'why',
        uncertainty: 'unsure',
      },
      intent('i-a', {
        lifecycle: 'optional',
        dependsOn: ['g-001'],
        suggestedPipeline: 'bug-fix',
        rationale: 'why',
        uncertainty: 'unsure',
      }),
    ]);
    expect(nodes).toHaveLength(2);
    expect(findPlanNodeSchemaProblems(nodes as readonly ExecutionPlanNodeInput[])).toEqual([]);
  });
});
