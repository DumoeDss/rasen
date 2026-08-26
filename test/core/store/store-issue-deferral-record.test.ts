/**
 * `issue-deferral-record` tasks 1.3/1.4 — the fifth lifecycle at the two Store
 * schemas it widens: the plan-node vocabulary (publication, the mandatory
 * reason, the intent-node refusal, the canonical omission) and the acceptance
 * record's exclusion enum (round-trip, absent-when-none, pre-field bytes, the
 * duplicate refusal over the widened union).
 *
 * Both halves are PURE over their inputs, so this suite touches no filesystem
 * and no Git: the store-mutation seam that carries a standing deferral into
 * `accepted.yaml` is pinned over a real fixture by
 * `test/core/issue-acceptance/issue-acceptance-gate-deferral.test.ts`.
 *
 * The `07e5b12c…` literal below is the SAME pre-vocabulary digest
 * `store-issue-node-lifecycle.test.ts` pins for a four-value-era revision: it
 * is copied, not recomputed, so a canonical-body drift introduced by widening
 * the enum stops it matching here exactly as it would there.
 */
import { describe, expect, it } from 'vitest';

import {
  acceptedRecordDigest,
  executionPlanDigest,
  normalizePlanNodes,
  parseAcceptedRecord,
  parseExecutionPlanRevision,
  serializeAcceptedRecord,
  serializeExecutionPlanRevision,
  type AcceptanceGateSnapshot,
  type ExecutionPlanNodeInput,
  type IssueAcceptedRecordV1,
} from '../../../src/core/store/issues/index.js';
import { findPlanNodeSchemaProblems } from '../../../src/core/store/issues/plans.js';
import {
  StorePlanningValidationError,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseSha256Digest,
} from '../../../src/core/store/planning-validation.js';

const PROJECT = 'app-a';
const LINE = 'main';
const NOW = '2026-08-23T00:00:00.000Z';
const ISSUE = 'iss-defer';

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

/** The four-value-era two-node revision the copied digest literal covers. */
const preDeferralNodes = (): readonly ExecutionPlanNodeInput[] => [
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

describe('the deferred lifecycle at the plan-node schema (issue-deferral-record D1)', () => {
  it('publishes a deferred node and reads its recorded reason back verbatim', () => {
    const reason = 'postponed to the next milestone; the Issue still intends this work';
    const body = revisionBody([
      changeNode({ nodeId: 'g-001', changeInstanceId: ci('a1'), changeAlias: 'child-a' }),
      changeNode({
        nodeId: 'g-def',
        changeInstanceId: ci('b2'),
        changeAlias: 'child-b',
        lifecycle: 'deferred',
        reason,
      }),
    ]);
    const revision = { ...body, contentSha256: executionPlanDigest(body) };
    const serialized = serializeExecutionPlanRevision(revision);
    const reread = parseExecutionPlanRevision(serialized, { verifyDigest: true });
    expect(reread.nodes.find(node => node.nodeId === 'g-def')).toMatchObject({
      lifecycle: 'deferred',
      reason,
    });
    // Stored in the canonical form exactly as the other non-required values
    // are: the value is written, and only `required` is ever omitted.
    expect(serialized).toContain('lifecycle: deferred');
    expect(serialized).not.toContain('lifecycle: required');
    // The required sibling carries neither field.
    const required = reread.nodes.find(node => node.nodeId === 'g-001');
    expect(required && 'lifecycle' in required).toBe(false);
    expect(required && 'reason' in required).toBe(false);
  });

  it('refuses a deferred node without a reason, naming the node and the rule', () => {
    const thrown = normalizeThrowing([changeNode({ nodeId: 'g-def', lifecycle: 'deferred' })]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].reason');
    expect((thrown as Error).message).toContain('g-def');
    expect((thrown as Error).message).toContain('deferred');
    expect((thrown as Error).message).toContain('recorded reason');

    expect(
      findPlanNodeSchemaProblems([changeNode({ nodeId: 'g-def', lifecycle: 'deferred' })])
    ).toEqual([{ nodeId: 'g-def', problem: expect.stringContaining('reason') }]);
  });

  it('refuses a deferred reason that is not portable durable text, at the schema', () => {
    const thrown = normalizeThrowing([
      changeNode({
        nodeId: 'g-def',
        lifecycle: 'deferred',
        reason: 'C:\\work\\logs\\why.txt',
      }),
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].reason');
    expect((thrown as Error).message).toContain('machine filesystem path');
  });

  it('refuses a deferred lifecycle on an intent node, pointing at optional or omission', () => {
    const thrown = normalizeThrowing([
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'work declared, no Change yet',
        dependsOn: [],
        lifecycle: 'deferred',
      },
    ]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].lifecycle');
    const message = (thrown as Error).message;
    expect(message).toContain('i-001');
    expect(message).toContain('deferred');
    // The refusal names both spellings intent postponement actually has.
    expect(message).toContain("'optional'");
    expect(message).toContain('omitting the node from the next revision');
  });

  it('still refuses a reason on wanted work, now phrased for a vocabulary that defers', () => {
    for (const lifecycle of [undefined, 'required', 'optional'] as const) {
      const thrown = normalizeThrowing([
        changeNode({
          nodeId: 'g-001',
          ...(lifecycle === undefined ? {} : { lifecycle }),
          reason: 'nice to have',
        }),
      ]);
      expect(thrown).toBeInstanceOf(StorePlanningValidationError);
      expect((thrown as StorePlanningValidationError).field).toBe('nodes[0].reason');
      const message = (thrown as Error).message;
      expect(message).toContain('cancelled, superseded, or deferred');
      // The reworded rule: `deferred` work IS still wanted, so the old
      // "work the plan no longer wants" phrasing would be false.
      expect(message).toContain('does not demand toward Done');
      expect(message).not.toContain('no longer wants');
    }
  });

  it('names all five values when refusing an out-of-vocabulary lifecycle', () => {
    const thrown = normalizeThrowing([changeNode({ nodeId: 'g-001', lifecycle: 'dropped' })]);
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    for (const value of ['required', 'optional', 'cancelled', 'superseded', 'deferred']) {
      expect((thrown as Error).message).toContain(value);
    }
    expect((thrown as Error).message).toContain('dropped');
  });

  it('digest pin: a pre-deferral revision re-derives the digest the four-value era published', () => {
    // Copied from `store-issue-node-lifecycle.test.ts`, not recomputed: adding
    // a fifth value must move NO byte of a revision that carries none of it.
    expect(executionPlanDigest(revisionBody(preDeferralNodes()))).toBe(
      '07e5b12c6c75e14d1b72a52765eb165b0d47ae83da0146a7f0ce6c7dd22b64a1'
    );
  });

  it('canonical omission is unchanged: an explicit required still normalizes to absent', () => {
    const spelled = preDeferralNodes().map(node =>
      node.kind === 'change' ? { ...node, lifecycle: 'required' } : node
    );
    const explicit = normalizePlanNodes(spelled);
    for (const node of explicit) {
      if (node.kind === 'change') expect('lifecycle' in node).toBe(false);
    }
    expect(executionPlanDigest({ ...revisionBody([]), nodes: explicit })).toBe(
      '07e5b12c6c75e14d1b72a52765eb165b0d47ae83da0146a7f0ce6c7dd22b64a1'
    );
  });

  it('changes a lifecycle only through a new revision: the predecessor keeps its bytes', () => {
    const wanted = revisionBody([
      changeNode({ nodeId: 'g-001', changeInstanceId: ci('a1'), changeAlias: 'child-a' }),
      changeNode({
        nodeId: 'g-opt',
        changeInstanceId: ci('b2'),
        changeAlias: 'child-b',
        lifecycle: 'optional',
      }),
    ]);
    const first = { ...wanted, contentSha256: executionPlanDigest(wanted) };
    const firstBytes = serializeExecutionPlanRevision(first);

    const deferredBody = {
      ...revisionBody([
        changeNode({ nodeId: 'g-001', changeInstanceId: ci('a1'), changeAlias: 'child-a' }),
        changeNode({
          nodeId: 'g-opt',
          changeInstanceId: ci('b2'),
          changeAlias: 'child-b',
          lifecycle: 'deferred',
          reason: 'postponed beyond this Issue; re-published when the milestone opens',
        }),
      ]),
      revisionId: parseExecutionPlanRevisionId('0002'),
      supersedes: parseExecutionPlanRevisionId('0001'),
    };
    const second = { ...deferredBody, contentSha256: executionPlanDigest(deferredBody) };
    expect(second.contentSha256).not.toBe(first.contentSha256);
    // The earlier revision's bytes, including that node's previous lifecycle,
    // are untouched by the deferral that follows it.
    expect(serializeExecutionPlanRevision(first)).toBe(firstBytes);
    expect(firstBytes).toContain('lifecycle: optional');
    expect(serializeExecutionPlanRevision(second)).toContain('lifecycle: deferred');
  });
});

// -----------------------------------------------------------------------------
// The acceptance record's exclusion enum (task 1.4)
// -----------------------------------------------------------------------------

const SNAPSHOT: AcceptanceGateSnapshot = {
  completed: 2,
  total: 2,
  health: 'healthy',
  problemsStanding: 0,
};

const CONDITIONS_DIGEST = parseSha256Digest('c'.repeat(64), 'conditionsSha256');

function recordDraft(
  exclusions?: readonly { nodeId: string; lifecycle: 'cancelled' | 'superseded' | 'deferred'; reason: string }[]
): Omit<IssueAcceptedRecordV1, 'contentSha256'> {
  return {
    version: 1,
    issueId: parseIssueId(ISSUE),
    acceptedAt: NOW,
    conditionsRevisionId: parseExecutionPlanRevisionId('0001'),
    conditionsSha256: CONDITIONS_DIGEST,
    gate: SNAPSHOT,
    ...(exclusions === undefined ? {} : { exclusions }),
    note: null,
  };
}

function sealed(
  exclusions?: readonly { nodeId: string; lifecycle: 'cancelled' | 'superseded' | 'deferred'; reason: string }[]
): IssueAcceptedRecordV1 {
  const draft = recordDraft(exclusions);
  return { ...draft, contentSha256: acceptedRecordDigest(draft) };
}

describe('the deferred exclusion in the acceptance record (issue-deferral-record D3)', () => {
  it('round-trips a deferred exclusion: serialize, digest, read back verbatim', () => {
    const reason = 'postponed past this Issue; the work is planned, not abandoned';
    const record = sealed([{ nodeId: 'g-def', lifecycle: 'deferred', reason }]);
    const text = serializeAcceptedRecord(record);
    expect(text).toContain('lifecycle: deferred');
    const reread = parseAcceptedRecord(text, { verifyDigest: true });
    expect(reread.exclusions).toEqual([{ nodeId: 'g-def', lifecycle: 'deferred', reason }]);
    expect(reread.contentSha256).toBe(record.contentSha256);
    // The digest covers the deferral: rewording the reason without
    // re-digesting refuses the read, exactly as it does for the other two.
    const tampered = text.replace(reason, 'abandoned outright');
    expect(tampered).not.toBe(text);
    expect(() => parseAcceptedRecord(tampered, { verifyDigest: true })).toThrow(
      /does not match the record body/u
    );
  });

  it('carries all three not-demanded lifecycles side by side in one record', () => {
    const record = sealed([
      { nodeId: 'g-cut', lifecycle: 'cancelled', reason: 'descoped and abandoned' },
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed beyond this Issue' },
      { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'folded into g-001' },
    ]);
    const reread = parseAcceptedRecord(serializeAcceptedRecord(record), { verifyDigest: true });
    expect(reread.exclusions?.map(exclusion => [exclusion.nodeId, exclusion.lifecycle])).toEqual([
      ['g-cut', 'cancelled'],
      ['g-def', 'deferred'],
      ['g-sup', 'superseded'],
    ]);
  });

  it('leaves the absent-when-none form and a pre-field record byte-untouched', () => {
    const none = sealed();
    const text = serializeAcceptedRecord(none);
    expect(text.includes('exclusions')).toBe(false);
    // The exact pre-field bytes, hand-assembled: adding a value to the
    // exclusion enum moves no byte of a record that carries no exclusion.
    expect(text).toBe(
      [
        'version: 1',
        `issueId: ${ISSUE}`,
        `acceptedAt: ${NOW}`,
        'conditionsRevisionId: "0001"',
        `conditionsSha256: ${CONDITIONS_DIGEST}`,
        'gate:',
        '  completed: 2',
        '  total: 2',
        '  health: healthy',
        '  problemsStanding: 0',
        'note: null',
        `contentSha256: ${none.contentSha256}`,
        '',
      ].join('\n')
    );
    const reread = parseAcceptedRecord(text, { verifyDigest: true });
    expect(reread.exclusions).toBeUndefined();
    // A present-but-empty array still reads back as the absence it is.
    const presentEmpty = text.replace('note: null', 'exclusions: []\nnote: null');
    expect(parseAcceptedRecord(presentEmpty, { verifyDigest: true }).exclusions).toBeUndefined();
  });

  it('refuses a duplicate node across the widened union — one node, one exclusion row', () => {
    const duplicated = sealed([
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed beyond this Issue' },
      { nodeId: 'g-def', lifecycle: 'cancelled', reason: 'and then abandoned' },
    ]);
    expect(() =>
      parseAcceptedRecord(serializeAcceptedRecord(duplicated), { verifyDigest: true })
    ).toThrow(/declared more than once/u);

    // Two deferrals of the same node are refused the same way: the rule is
    // per node, not per lifecycle pair.
    const twice = sealed([
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed once' },
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed twice' },
    ]);
    expect(() =>
      parseAcceptedRecord(serializeAcceptedRecord(twice), { verifyDigest: true })
    ).toThrow(/declared more than once/u);
  });

  it('refuses a deferred exclusion whose reason is not portable durable text', () => {
    const record = sealed([
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed; see the log' },
    ]);
    const text = serializeAcceptedRecord(record).replace(
      'postponed; see the log',
      'C:\\Users\\sayo\\notes.txt'
    );
    expect(() => parseAcceptedRecord(text, { verifyDigest: false })).toThrow(
      /must not be a machine filesystem path/u
    );
  });

  it('refuses a lifecycle outside the widened enum, keeping the vocabulary closed', () => {
    const record = sealed([
      { nodeId: 'g-def', lifecycle: 'deferred', reason: 'postponed beyond this Issue' },
    ]);
    const text = serializeAcceptedRecord(record).replace(
      'lifecycle: deferred',
      'lifecycle: postponed'
    );
    expect(() => parseAcceptedRecord(text, { verifyDigest: false })).toThrow();
  });
});
