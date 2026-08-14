/**
 * `store-issue-resources` round-1 MAJOR-1 and round-2 MINOR-R2-1: the two
 * things `normalizePlanNodes` declares and did not do.
 *
 * MAJOR-1 is the spec scenario "Two spellings of one plan are one plan"
 * (`specs/store-issue-resources/spec.md`): two plans differing only in node
 * ordering normalize to the same canonical plan. Before this suite the
 * normalizer was a pure `.map()` that preserved whatever order the author
 * typed, so the same plan authored twice minted two revisions differing in
 * nothing but their bytes. Not one existing test moved either way, which is
 * precisely why the behaviour needs its own suite rather than an assumption.
 *
 * MINOR-R2-1 is `NodeSchema` being declared (`plans.ts`) and never run: the
 * normalizer cast to `z.output<typeof NodeSchema>` instead of parsing, so a
 * 501-character summary was first refused at serialize time (after the Git ref
 * reads) and a non-string `nodeId` was not refused at all but raised a
 * `TypeError` from inside `assertPortableSegment`.
 *
 * The two digest expectations below are LITERAL hex, derived once from real
 * output during authoring and typed in. A digest recomputed inside the test
 * would be a symmetric anchor that moves with the implementation and can never
 * go red; the equality-between-two-spellings assertions beside them are
 * relational, and relational assertions are blind to any change that moves
 * both sides at once. Each form covers what the other cannot: the literals pin
 * the canonical bytes, the equalities pin that the two spellings reach them.
 */
import { describe, expect, it } from 'vitest';

import {
  executionPlanDigest,
  findPlanNodeSchemaProblems,
  normalizePlanNodes,
} from '../../../src/core/store/issues/plans.js';
import type { ExecutionPlanNodeInput } from '../../../src/core/store/issues/types.js';
import {
  StorePlanningValidationError,
  parseExecutionPlanRevisionId,
  parseIssueId,
} from '../../../src/core/store/planning-validation.js';

const intent = (
  nodeId: string,
  dependsOn: readonly string[] = []
): ExecutionPlanNodeInput => ({
  nodeId,
  kind: 'intent',
  projectId: 'proj-a',
  targetLineId: 'main',
  summary: `work ${nodeId}`,
  dependsOn,
});

/** The same revision body around whatever node list is being spelled. */
const revisionOf = (nodes: readonly ExecutionPlanNodeInput[]) => ({
  version: 1 as const,
  issueId: parseIssueId('iss-alpha'),
  revisionId: parseExecutionPlanRevisionId('0001'),
  supersedes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  nodes: normalizePlanNodes(nodes),
});

describe('plan node canonicalization (round-1 MAJOR-1)', () => {
  it('orders nodes by nodeId, whatever order they were authored in', () => {
    expect(normalizePlanNodes([intent('c'), intent('a'), intent('b')]).map(node => node.nodeId))
      .toEqual(['a', 'b', 'c']);
    // Already canonical input is left where it is, not reversed or rotated.
    expect(normalizePlanNodes([intent('a'), intent('b'), intent('c')]).map(node => node.nodeId))
      .toEqual(['a', 'b', 'c']);
  });

  it("orders each node's dependsOn", () => {
    const nodes = normalizePlanNodes([intent('a', ['y', 'x']), intent('x'), intent('y')]);
    expect(nodes.map(node => node.nodeId)).toEqual(['a', 'x', 'y']);
    expect(nodes[0]?.dependsOn).toEqual(['x', 'y']);
  });

  it('mints one digest for two plans that differ only in node ordering', () => {
    const authored = executionPlanDigest(revisionOf([intent('c'), intent('a'), intent('b')]));
    const reAuthored = executionPlanDigest(revisionOf([intent('a'), intent('b'), intent('c')]));

    expect(authored).toBe(reAuthored);
    // The canonical value itself, pinned. Without this literal the assertion
    // above would still pass if BOTH spellings stopped being canonicalized.
    expect(authored).toBe(
      'd35cf8f0492f639c9a5d044d583f4e8657cb3b15a0cc1434a950badeb449ee54'
    );
  });

  it('mints one digest for two plans that differ only in dependsOn ordering', () => {
    const authored = executionPlanDigest(
      revisionOf([intent('a', ['y', 'x']), intent('x'), intent('y')])
    );
    const reAuthored = executionPlanDigest(
      revisionOf([intent('a', ['x', 'y']), intent('x'), intent('y')])
    );

    expect(authored).toBe(reAuthored);
    // A second independent vector, pinned from its own input rather than
    // derived from the first: chaining one golden value into the next makes a
    // single wrong literal look self-consistent.
    expect(authored).toBe(
      '0961437ebd9e417a5cac9198053275e134d8828d554a127f4ec33652b61032c5'
    );
  });

  it('orders lexically, not numerically', () => {
    // Honest about what this can and cannot prove. The reason the sort uses
    // code-point comparison rather than `localeCompare` is that the order is a
    // digest preimage and ICU collation data varies between runtimes, which no
    // single-machine test can observe: swept over every legal kebab id up to
    // four characters, this Node's root collation agrees with code-point order
    // on every pair. What IS observable, and is asserted here, is the other
    // plausible wrong choice: a numeric-aware collation
    // (`localeCompare(.., { numeric: true })`) puts `a-2` first, and would
    // therefore mint a different digest for this plan.
    expect(normalizePlanNodes([intent('a-2'), intent('a-10')]).map(node => node.nodeId))
      .toEqual(['a-10', 'a-2']);
  });
});

describe('plan node schema enforcement (round-2 MINOR-R2-1)', () => {
  it('normalizes a well-formed node unchanged', () => {
    const [node] = normalizePlanNodes([intent('a')]);
    expect(node).toMatchObject({ nodeId: 'a', kind: 'intent', summary: 'work a' });
    expect(findPlanNodeSchemaProblems([intent('a')])).toEqual([]);
  });

  it('refuses a summary past the declared 500-character maximum, naming the node', () => {
    const tooLong: ExecutionPlanNodeInput = {
      nodeId: 'a',
      kind: 'intent',
      projectId: 'proj-a',
      targetLineId: 'main',
      summary: 'x'.repeat(501),
      dependsOn: [],
    };

    let thrown: unknown;
    try {
      normalizePlanNodes([tooLong]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0]');
    expect((thrown as Error).message).toContain('summary');
    // 500 exactly is accepted: the refusal is the declared boundary, not a
    // stricter rule invented by the check.
    expect(
      normalizePlanNodes([{ ...tooLong, summary: 'x'.repeat(500) }])[0]?.summary
    ).toHaveLength(500);

    expect(findPlanNodeSchemaProblems([tooLong])).toEqual([
      { nodeId: 'a', problem: expect.stringContaining('summary') },
    ]);
  });

  it('refuses a non-string nodeId as a named field, never as a TypeError', () => {
    const numericNodeId = { ...intent('a'), nodeId: 7 } as unknown as ExecutionPlanNodeInput;

    let thrown: unknown;
    try {
      normalizePlanNodes([numericNodeId]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('nodeId');
    // The pre-fix symptom, stated so a regression is recognizable: the raw
    // `String.prototype.includes` fault out of `assertPortableSegment`.
    expect((thrown as Error).message).not.toContain('value.includes is not a function');

    expect(findPlanNodeSchemaProblems([numericNodeId])).toEqual([
      { nodeId: '(unnamed node)', problem: expect.stringContaining('nodeId') },
    ]);
  });

  it('refuses a string dependsOn rather than exploding it into one dependency per character', () => {
    const stringDeps = {
      ...intent('a'),
      dependsOn: 'bc',
    } as unknown as ExecutionPlanNodeInput;

    expect(() => normalizePlanNodes([stringDeps])).toThrow(StorePlanningValidationError);
    expect(findPlanNodeSchemaProblems([stringDeps])).toEqual([
      { nodeId: 'a', problem: expect.stringContaining('dependsOn') },
    ]);
  });

  it('names an undefined kind through the discriminator rather than assuming intent', () => {
    const taskKind = { ...intent('a'), kind: 'task' } as unknown as ExecutionPlanNodeInput;

    expect(() => normalizePlanNodes([taskKind])).toThrow(StorePlanningValidationError);
    expect(findPlanNodeSchemaProblems([taskKind])).toEqual([
      { nodeId: 'a', problem: expect.stringContaining('kind') },
    ]);
  });
});
