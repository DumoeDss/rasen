/**
 * `issue-autodecompose-graph` task 1.1/1.2 — the decomposition-guidance fields
 * at the plan-node schema: optional on both kinds, canonically omitted when
 * absent (so every revision published before these fields re-derives its
 * digest byte-for-byte), portable-text-checked, and the publication-time
 * registry check for `suggestedPipeline` through the injected membership test.
 *
 * Byte-stability is pinned in TWO layers: this suite's round-trip pins the
 * strict read (an old-shaped revision verifies under the new schema with every
 * field absent), and the PRE-EXISTING digest literals in
 * `store-issue-node-lifecycle.test.ts` / `store-issue-plan-canonicalization.test.ts`
 * staying green is the proof the canonical bytes never moved — those literals
 * were computed from builds that predate these fields.
 */
import { describe, expect, it } from 'vitest';

import {
  assertPlanNodeSuggestions,
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

const intentNode = (
  overrides: Partial<ExecutionPlanNodeInput> & { nodeId: string }
): ExecutionPlanNodeInput => ({
  kind: 'intent',
  projectId: PROJECT,
  targetLineId: LINE,
  summary: 'Propose the widget surface',
  dependsOn: [],
  ...overrides,
});

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

/** The pre-fields shape: one change node, one intent node, no guidance fields. */
const preFieldsNodes = (): readonly ExecutionPlanNodeInput[] => [
  intentNode({ nodeId: 'a-intent' }),
  changeNode({ nodeId: 'b-change', dependsOn: ['a-intent'] }),
];

const revisionBody = (nodes: readonly ExecutionPlanNodeInput[]) => ({
  version: 1 as const,
  issueId: parseIssueId('iss-sg'),
  revisionId: parseExecutionPlanRevisionId('0001'),
  supersedes: null,
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

describe('plan-node suggestion fields (issue-autodecompose-graph D4)', () => {
  it('carries the three fields on both kinds and omits them when absent', () => {
    const nodes = normalizePlanNodes([
      intentNode({
        nodeId: 'a-intent',
        suggestedPipeline: 'small-feature',
        rationale: 'the surface must exist before consumers',
        uncertainty: 'unsure whether two nodes or one',
      }),
      changeNode({ nodeId: 'b-change', dependsOn: ['a-intent'] }),
    ]);
    const [intent, change] = nodes as [Record<string, unknown>, Record<string, unknown>];
    expect(intent['suggestedPipeline']).toBe('small-feature');
    expect(intent['rationale']).toBe('the surface must exist before consumers');
    expect(intent['uncertainty']).toBe('unsure whether two nodes or one');
    // Absent fields are OMITTED, not nulled: an authored absence never reads
    // back as an empty string.
    expect('suggestedPipeline' in change).toBe(false);
    expect('rationale' in change).toBe(false);
    expect('uncertainty' in change).toBe(false);
  });

  it('a revision published before these fields reads back with every field absent and its digest still verifying', () => {
    const revision = revisionBody(preFieldsNodes());
    const withDigest = { ...revision, contentSha256: executionPlanDigest(revision) };
    // The strict read: parse verifies the recorded digest against the stored
    // bytes under the NEW schema, and each node carries no suggestion,
    // rationale, or uncertainty.
    const parsed = parseExecutionPlanRevision(
      serializeExecutionPlanRevision(withDigest),
      { verifyDigest: true }
    );
    for (const node of parsed.nodes) {
      expect('suggestedPipeline' in node).toBe(false);
      expect('rationale' in node).toBe(false);
      expect('uncertainty' in node).toBe(false);
    }
  });

  it('the fields are digest-covered: adding a suggestion mints a different digest', () => {
    const without = executionPlanDigest(revisionBody(preFieldsNodes()));
    const withSuggestion = executionPlanDigest(
      revisionBody([
        intentNode({ nodeId: 'a-intent', suggestedPipeline: 'small-feature' }),
        changeNode({ nodeId: 'b-change', dependsOn: ['a-intent'] }),
      ])
    );
    expect(withSuggestion).not.toBe(without);
  });

  it('an unknown suggested pipeline is refused at publication, naming the node and the pipeline', () => {
    const nodes = normalizePlanNodes([
      intentNode({ nodeId: 'a-intent', suggestedPipeline: 'no-such-pipeline' }),
    ]);
    let thrown: unknown;
    try {
      assertPlanNodeSuggestions(nodes, name => name === 'small-feature');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    const error = thrown as StorePlanningValidationError;
    expect(error.code).toBe('invalid_execution_plan');
    expect(error.field).toContain('suggestedPipeline');
    expect(error.message).toContain('a-intent');
    expect(error.message).toContain('no-such-pipeline');
  });

  it('a suggestion with no supplied registry test is refused, never stored unchecked', () => {
    const nodes = normalizePlanNodes([
      intentNode({ nodeId: 'a-intent', suggestedPipeline: 'small-feature' }),
    ]);
    let thrown: unknown;
    try {
      assertPlanNodeSuggestions(nodes, undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).message).toContain('a-intent');
    expect((thrown as StorePlanningValidationError).message).toContain('no pipeline registry');
  });

  it('a known suggestion passes; nodes without a suggestion pass without a test', () => {
    const nodes = normalizePlanNodes([
      intentNode({ nodeId: 'a-intent', suggestedPipeline: 'bug-fix.yaml' }),
    ]);
    // The CLI-composed shape normalizes a .yaml spelling, as start's seam does.
    expect(() =>
      assertPlanNodeSuggestions(nodes, name => ['bug-fix'].includes(name.replace(/\.ya?ml$/, '')))
    ).not.toThrow();
    expect(() => assertPlanNodeSuggestions(normalizePlanNodes(preFieldsNodes()), undefined)).not.toThrow();
  });

  it('a rationale carrying a machine path is refused at the schema, never trimmed', () => {
    const thrown = normalizeThrowing([
      intentNode({ nodeId: 'a-intent', rationale: '/home/dev/notes.txt holds the basis' }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    const error = thrown as StorePlanningValidationError;
    expect(error.code).toBe('invalid_execution_plan');
    expect(error.field).toBe('nodes[0].rationale');
  });

  it('an uncertainty embedding a credential is refused at the schema', () => {
    const thrown = normalizeThrowing([
      intentNode({
        nodeId: 'a-intent',
        suggestedPipeline: 'small-feature',
        uncertainty: 'the upstream fetch at https://user:secret@host.example/x may change',
      }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].uncertainty');
  });

  it('blank or empty guidance values are refused', () => {
    expect(
      normalizeThrowing([intentNode({ nodeId: 'a-intent', suggestedPipeline: '' })])
    ).toBeInstanceOf(StorePlanningValidationError);
    expect(
      normalizeThrowing([intentNode({ nodeId: 'a-intent', rationale: '' })])
    ).toBeInstanceOf(StorePlanningValidationError);
    expect(
      normalizeThrowing([intentNode({ nodeId: 'a-intent', uncertainty: '' })])
    ).toBeInstanceOf(StorePlanningValidationError);
  });

  it('unknown fields are still refused: the strict read recognizes exactly the new fields', () => {
    // The strict read parses the STORED bytes directly, so a misspelled
    // guidance field meets the node schema's `.strict()` by name — exactly as
    // the lifecycle vocabulary's tests pin for their fields.
    const stored = `version: 1
issueId: iss-sg
revisionId: '0001'
supersedes: null
createdAt: '2026-08-21T00:00:00.000Z'
contentSha256: ${'0'.repeat(64)}
nodes:
  - nodeId: a-intent
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Propose the widget surface
    dependsOn: []
    suggestedPipline: small-feature
`;
    let thrown: unknown;
    try {
      parseExecutionPlanRevision(stored);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).message).toContain('suggestedPipline');
    // And the reported-problems boundary over authored inputs stays total:
    // a node whose guidance text is not portable is REPORTED, not thrown.
    const problems = findPlanNodeSchemaProblems([
      intentNode({ nodeId: 'a-intent', rationale: '/etc/passwd holds the basis' }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.nodeId).toBe('a-intent');
    expect(problems[0]?.problem).toContain('rationale');
  });
});
