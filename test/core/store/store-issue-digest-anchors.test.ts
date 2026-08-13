/**
 * `store-issue-resources` task 7.1 — pinned-literal anchors for three of this
 * child's five durable-format sites: the Execution Plan digest, the
 * Execution Plan revision's YAML text, and the Issue record's YAML text.
 * (The other two — the Issue-lock filename digest, and the read-side content
 * digest — are anchored in place, next to the existing coverage that already
 * exercises them: `store-issue-locks.test.ts`'s "is deterministic for equal
 * material" case, and `store-aggregate-query.test.ts`'s divergent-Issue
 * case.)
 *
 * Every "expected" value below is a LITERAL string or hex digest, hand-
 * derived from the serialization rules this file's target functions
 * implement — RFC 8785 canonical-JSON key sorting (alphabetical at every
 * level, array order preserved) for the digest, `yaml`'s `stringify()`
 * insertion-order and scalar-quoting rules for the two text sites — and
 * cross-checked once against real output during authoring. No assertion here
 * derives "expected" by calling the function under test a second time: doing
 * that produces a SYMMETRIC anchor that can never go red, because a broken
 * implementation and a broken "expected" call move together. A literal typed
 * into this file does not move when the implementation changes underneath
 * it, so a discriminating mutation (see the sibling mutation-proof notes in
 * `tasks.md` section 7) is exactly what turns these tests red.
 */
import { describe, expect, it } from 'vitest';

import {
  executionPlanDigest,
  serializeExecutionPlanRevision,
} from '../../../src/core/store/issues/plans.js';
import { serializeIssueRecord } from '../../../src/core/store/issues/records.js';
import type {
  ExecutionPlanChangeNode,
  ExecutionPlanRevisionV1,
  IssueRecordV1,
} from '../../../src/core/store/issues/types.js';
import { parseChangeInstanceId } from '../../../src/core/store/planning-identity.js';
import {
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseProjectId,
  parseSha256Digest,
  parseTargetLineId,
} from '../../../src/core/store/planning-validation.js';

describe('durable-format anchors: Issue record YAML (task 7.1)', () => {
  it('pins the exact YAML text for a known record', () => {
    const record: IssueRecordV1 = {
      version: 1,
      id: parseIssueId('iss-alpha'),
      title: 'Cross-project rollout',
      state: 'open',
      reason: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(serializeIssueRecord(record)).toBe(
      'version: 1\n' +
        'id: iss-alpha\n' +
        'title: Cross-project rollout\n' +
        'state: open\n' +
        'reason: null\n' +
        'createdAt: 2026-01-01T00:00:00.000Z\n'
    );
  });
});

describe('durable-format anchors: Execution Plan digest and revision YAML (task 7.1)', () => {
  const NODE: ExecutionPlanChangeNode = {
    nodeId: 'n1',
    kind: 'change',
    projectId: parseProjectId('proj-a'),
    targetLineId: parseTargetLineId('main'),
    changeInstanceId: parseChangeInstanceId(
      'ci_1111111111111111111111111111111111111111111111111111111111111111'
    ),
    dependsOn: [],
  };

  const REVISION_WITHOUT_DIGEST = {
    version: 1 as const,
    issueId: parseIssueId('iss-alpha'),
    revisionId: parseExecutionPlanRevisionId('0001'),
    supersedes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    nodes: [NODE],
  };

  it('pins the digest for a known revision body', () => {
    // The digest body is every OTHER field, canonicalized per RFC 8785 —
    // reordering a JS object literal's own keys would NOT discriminate a
    // broken `executionPlanDigest`, because `canonicalJson` sorts keys
    // itself regardless of source order. What discriminates is a
    // mutation that changes which bytes are covered or how (see 7.3).
    expect(executionPlanDigest(REVISION_WITHOUT_DIGEST)).toBe(
      '275204a66aacf87f72b29986343725e8831f8aacf9b156055c2cb226acf4ee35'
    );
  });

  it('pins the exact YAML text for the same revision, digest included', () => {
    // The digest here is a LITERAL, not a call to `executionPlanDigest` — so
    // this test's "expected" side never touches the digest function at all,
    // and stays a discriminator for `serializeExecutionPlanRevision`'s own
    // rendering even if the digest test above were deleted.
    const revision: ExecutionPlanRevisionV1 = {
      ...REVISION_WITHOUT_DIGEST,
      contentSha256: parseSha256Digest(
        '275204a66aacf87f72b29986343725e8831f8aacf9b156055c2cb226acf4ee35'
      ),
    };

    expect(serializeExecutionPlanRevision(revision)).toBe(
      'version: 1\n' +
        'issueId: iss-alpha\n' +
        'revisionId: "0001"\n' +
        'supersedes: null\n' +
        'createdAt: 2026-01-01T00:00:00.000Z\n' +
        'contentSha256: 275204a66aacf87f72b29986343725e8831f8aacf9b156055c2cb226acf4ee35\n' +
        'nodes:\n' +
        '  - nodeId: n1\n' +
        '    kind: change\n' +
        '    projectId: proj-a\n' +
        '    targetLineId: main\n' +
        '    changeInstanceId: ci_1111111111111111111111111111111111111111111111111111111111111111\n' +
        '    dependsOn: []\n'
    );
  });
});
