/**
 * `issue-acceptance-close` task 1.3 — the acceptance-content contracts, pure:
 * revision/digest/anti-rewrite discipline, tamper-refusal on read, the
 * portable-text refusals, deterministic canonical bytes, and the duplicate
 * condition-id refusal.
 *
 * The digest and YAML expectations are LITERALS hand-copied from one real run
 * of the implementation during authoring (the sibling
 * `store-issue-digest-anchors.test.ts` discipline): an "expected" derived by
 * calling the function under test a second time is a symmetric anchor that can
 * never go red. Conditions revision 0001 of `iss-alpha` carries exactly the
 * two conditions below, canonicalized (`cond-1` first regardless of authored
 * order) — pinning BOTH the digest preimage and the serializer's rendering.
 */
import { describe, expect, it } from 'vitest';

import {
  acceptanceConditionsDigest,
  acceptedRecordDigest,
  normalizeAcceptanceConditions,
  parseAcceptanceConditionsRevision,
  parseAcceptedRecord,
  serializeAcceptanceConditionsRevision,
  serializeAcceptedRecord,
} from '../../../src/core/store/issues/acceptance.js';
import {
  StorePlanningValidationError,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseSha256Digest,
} from '../../../src/core/store/planning-validation.js';

const NOW = '2026-01-01T00:00:00.000Z';
const CONDITIONS_DIGEST = '909a3798f95270c6ed8f9f54f673c0d6cebf53d53dd23264e5304b0976ded904';
const RECORD_DIGEST = '3487ff0093d33921ae5c498a1972e755dc56d6bc9bb396457e4c096fb56bb8c8';

const CONDITIONS_INPUT = [
  { id: 'cond-2', requirement: 'Projection shipped' },
  { id: 'cond-1', requirement: 'Binding loop proven', verification: 'dogfood receipts' },
];

function conditionsDraft() {
  return {
    version: 1 as const,
    issueId: parseIssueId('iss-alpha'),
    revisionId: parseExecutionPlanRevisionId('0001'),
    supersedes: null,
    createdAt: NOW,
    conditions: normalizeAcceptanceConditions(CONDITIONS_INPUT),
  };
}

function conditionsRevision() {
  return { ...conditionsDraft(), contentSha256: parseSha256Digest(CONDITIONS_DIGEST) };
}

function recordDraft() {
  return {
    version: 1 as const,
    issueId: parseIssueId('iss-alpha'),
    acceptedAt: '2026-01-02T00:00:00.000Z',
    conditionsRevisionId: parseExecutionPlanRevisionId('0002'),
    conditionsSha256: parseSha256Digest(CONDITIONS_DIGEST),
    gate: { completed: 3, total: 3, health: 'healthy', problemsStanding: 0 },
    note: 'All three children archived',
  };
}

describe('acceptance conditions revisions', () => {
  it('pins the digest and the exact YAML text for a known revision', () => {
    // The digest is over the CANONICAL body: authored order reversed, the
    // published order canonicalized, one digest. A mutation that changes what
    // the digest covers (or what canonical means) moves this literal's match.
    expect(acceptanceConditionsDigest(conditionsDraft())).toBe(CONDITIONS_DIGEST);
    expect(serializeAcceptanceConditionsRevision(conditionsRevision())).toBe(
      'version: 1\n' +
        'issueId: iss-alpha\n' +
        'revisionId: "0001"\n' +
        'supersedes: null\n' +
        'createdAt: 2026-01-01T00:00:00.000Z\n' +
        `contentSha256: ${CONDITIONS_DIGEST}\n` +
        'conditions:\n' +
        '  - id: cond-1\n' +
        '    requirement: Binding loop proven\n' +
        '    verification: dogfood receipts\n' +
        '  - id: cond-2\n' +
        '    requirement: Projection shipped\n'
    );
  });

  it('canonicalizes authored order, so one checklist is one revision however it is spelled', () => {
    const forward = normalizeAcceptanceConditions([
      { id: 'cond-1', requirement: 'Projection shipped' },
      { id: 'cond-2', requirement: 'Binding loop proven' },
    ]);
    const backward = normalizeAcceptanceConditions([
      { id: 'cond-2', requirement: 'Binding loop proven' },
      { id: 'cond-1', requirement: 'Projection shipped' },
    ]);
    expect(forward.map(condition => condition.id)).toEqual(['cond-1', 'cond-2']);
    expect(backward).toEqual(forward);
    // Two spellings, one digest preimage.
    const bodyOf = (order: typeof forward) => ({
      version: 1 as const,
      issueId: parseIssueId('iss-beta'),
      revisionId: parseExecutionPlanRevisionId('0001'),
      supersedes: null,
      createdAt: NOW,
      conditions: order,
    });
    expect(acceptanceConditionsDigest(bodyOf(forward))).toBe(
      acceptanceConditionsDigest(bodyOf(backward))
    );
  });

  it('round-trips published bytes: serialize then parse verifies the digest', () => {
    const revision = parseAcceptanceConditionsRevision(
      serializeAcceptanceConditionsRevision(conditionsRevision()),
      { verifyDigest: true }
    );
    expect(revision.conditions).toHaveLength(2);
    expect(revision.conditions[0]).toMatchObject({
      id: 'cond-1',
      requirement: 'Binding loop proven',
      verification: 'dogfood receipts',
    });
  });

  it('refuses altered content on read, naming the mismatch, returning nothing', () => {
    const text = serializeAcceptanceConditionsRevision(conditionsRevision());
    // A hand edit of the requirement without re-digesting.
    const tampered = text.replace('Binding loop proven', 'Binding loop PROVEN');
    expect(() => parseAcceptanceConditionsRevision(tampered, { verifyDigest: true })).toThrow(
      StorePlanningValidationError
    );
    try {
      parseAcceptanceConditionsRevision(tampered, { verifyDigest: true });
    } catch (error) {
      expect((error as StorePlanningValidationError).code).toBe('invalid_acceptance_conditions');
      expect((error as StorePlanningValidationError).field).toBe('contentSha256');
      expect((error as Error).message).toContain('does not match the revision body');
    }
  });

  it('refuses a machine path or an embedded credential at the schema, writing nothing', () => {
    // The shared portable-durable-text contract (one definition across Issue
    // content): a text field that IS an absolute path is refused, and so is
    // one that embeds credentials — at the schema, never trimmed.
    expect(() =>
      normalizeAcceptanceConditions([
        { id: 'cond-1', requirement: 'C:\\Users\\sayo\\notes.txt' },
      ])
    ).toThrow(/must not be a machine filesystem path/u);
    expect(() =>
      normalizeAcceptanceConditions([{ id: 'cond-1', requirement: '/home/sayo/notes.txt' }])
    ).toThrow(/must not be a machine filesystem path/u);
    expect(() =>
      normalizeAcceptanceConditions([
        { id: 'cond-1', requirement: 'ok', verification: 'https://alice:secret@example.com/x' },
      ])
    ).toThrow(/must not embed credentials/u);
  });

  it('refuses duplicate condition identifiers within one revision', () => {
    expect(() =>
      normalizeAcceptanceConditions([
        { id: 'cond-1', requirement: 'First' },
        { id: 'cond-1', requirement: 'Second' },
      ])
    ).toThrow(/declared more than once/u);
    // And on the read side too — the schema is the same gate.
    const revision = conditionsRevision();
    const duplicated = {
      ...revision,
      conditions: [
        { id: 'cond-1', requirement: 'First' },
        { id: 'cond-1', requirement: 'Second' },
      ],
    };
    expect(() => serializeAcceptanceConditionsRevision(duplicated as never)).toThrow(
      /declared more than once/u
    );
  });

  it('refuses a revision with no conditions and a non-canonical condition id', () => {
    expect(() => normalizeAcceptanceConditions([])).toThrow(/at least one condition/u);
    const empty = { ...conditionsRevision(), conditions: [] };
    expect(() => serializeAcceptanceConditionsRevision(empty as never)).toThrow(
      /at least one condition/u
    );
    expect(() => normalizeAcceptanceConditions([{ id: 'Cond 1', requirement: 'x' }])).toThrow(
      StorePlanningValidationError
    );
  });

  it('refuses a supersedes that does not precede the revision', () => {
    const revision = {
      ...conditionsRevision(),
      revisionId: parseExecutionPlanRevisionId('0002'),
      supersedes: parseExecutionPlanRevisionId('0002'),
    };
    expect(() => serializeAcceptanceConditionsRevision(revision)).toThrow(
      /must precede revision '0002'/u
    );
  });
});

describe('the acceptance record', () => {
  it('pins the digest and the exact YAML text for a known record', () => {
    expect(acceptedRecordDigest(recordDraft())).toBe(RECORD_DIGEST);
    expect(
      serializeAcceptedRecord({ ...recordDraft(), contentSha256: parseSha256Digest(RECORD_DIGEST) })
    ).toBe(
      'version: 1\n' +
        'issueId: iss-alpha\n' +
        'acceptedAt: 2026-01-02T00:00:00.000Z\n' +
        'conditionsRevisionId: "0002"\n' +
        `conditionsSha256: ${CONDITIONS_DIGEST}\n` +
        'gate:\n' +
        '  completed: 3\n' +
        '  total: 3\n' +
        '  health: healthy\n' +
        '  problemsStanding: 0\n' +
        'note: All three children archived\n' +
        `contentSha256: ${RECORD_DIGEST}\n`
    );
  });

  it('round-trips and refuses a tampered record on read', () => {
    const text = serializeAcceptedRecord({
      ...recordDraft(),
      contentSha256: parseSha256Digest(RECORD_DIGEST),
    });
    expect(
      parseAcceptedRecord(text, { verifyDigest: true }).conditionsRevisionId
    ).toBe('0002');
    // A hand edit of the note without re-digesting: the digest mismatch is
    // the refusal (the snapshot-contradiction path has its own test below).
    const tampered = text.replace('All three children archived', 'All three children ARCHIVED');
    try {
      parseAcceptedRecord(tampered, { verifyDigest: true });
      throw new Error('expected the tampered record to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(StorePlanningValidationError);
      expect((error as StorePlanningValidationError).code).toBe('invalid_acceptance_record');
      expect((error as Error).message).toContain('does not match the record body');
    }
  });

  it('refuses a snapshot with standing problems, an unknown health, or incoherent counts', () => {
    // Close evidence is coherent by definition: each candidate carries a
    // self-consistent digest over its own (contradictory) body, so what fails
    // is the CONTRADICTION, not a stale digest.
    const withSnapshot = (gate: Record<string, unknown>) => {
      const draft = { ...recordDraft(), gate };
      return { ...draft, contentSha256: acceptedRecordDigest(draft) };
    };
    expect(() => serializeAcceptedRecord(withSnapshot({ completed: 3, total: 3, health: 'healthy', problemsStanding: 2 }))).toThrow(
      /problemsStanding must be zero/u
    );
    expect(() => serializeAcceptedRecord(withSnapshot({ completed: 4, total: 3, health: 'healthy', problemsStanding: 0 }))).toThrow(
      /exceeds total/u
    );
    expect(() => serializeAcceptedRecord(withSnapshot({ completed: 3, total: 3, health: 'on-fire', problemsStanding: 0 }))).toThrow(
      /health vocabulary/u
    );
    // The two invariants a re-digesting author could otherwise smuggle
    // through: partial completion and a failed health (review Minor-2).
    expect(() => serializeAcceptedRecord(withSnapshot({ completed: 1, total: 3, health: 'healthy', problemsStanding: 0 }))).toThrow(
      /completed \(1\) must equal total \(3\)/u
    );
    expect(() => serializeAcceptedRecord(withSnapshot({ completed: 3, total: 3, health: 'failed', problemsStanding: 0 }))).toThrow(
      /health must not be failed/u
    );
  });

  it('refuses a hand-crafted re-digested contradictory record on READ, never presenting done', () => {
    // Minor-2's exact scenario: a tamperer who re-digests over a
    // contradiction (completed 1/3, health failed) produces bytes that
    // digest-VERIFY — and are still refused by the coherence invariants, on
    // the read path the projection's facts reader takes. The YAML is
    // hand-assembled with the recomputed digest precisely because the
    // serializer refuses to mint this contradiction in the first place.
    const draft = {
      ...recordDraft(),
      gate: { completed: 1, total: 3, health: 'failed', problemsStanding: 0 },
    };
    const yaml = [
      'version: 1',
      'issueId: iss-alpha',
      'acceptedAt: 2026-01-02T00:00:00.000Z',
      'conditionsRevisionId: "0002"',
      `conditionsSha256: ${CONDITIONS_DIGEST}`,
      'gate:',
      '  completed: 1',
      '  total: 3',
      '  health: failed',
      '  problemsStanding: 0',
      'note: All three children archived',
      `contentSha256: ${acceptedRecordDigest(draft)}`,
      '',
    ].join('\n');
    expect(() => parseAcceptedRecord(yaml, { verifyDigest: true })).toThrow(
      /completed \(1\) must equal total \(3\)/u
    );
    // The failed-health row refuses a record that only contradicts THERE.
    const failedOnly = {
      ...recordDraft(),
      gate: { completed: 3, total: 3, health: 'failed', problemsStanding: 0 },
    };
    const failedYaml = [
      'version: 1',
      'issueId: iss-alpha',
      'acceptedAt: 2026-01-02T00:00:00.000Z',
      'conditionsRevisionId: "0002"',
      `conditionsSha256: ${CONDITIONS_DIGEST}`,
      'gate:',
      '  completed: 3',
      '  total: 3',
      '  health: failed',
      '  problemsStanding: 0',
      'note: All three children archived',
      `contentSha256: ${acceptedRecordDigest(failedOnly)}`,
      '',
    ].join('\n');
    expect(() => parseAcceptedRecord(failedYaml, { verifyDigest: true })).toThrow(
      /health must not be failed/u
    );
  });

  it('refuses a note that is not portable durable text', () => {
    const draft = { ...recordDraft(), note: '/home/sayo/acceptance.txt' };
    expect(() =>
      serializeAcceptedRecord({ ...draft, contentSha256: acceptedRecordDigest(draft) })
    ).toThrow(/must not be a machine filesystem path/u);
  });
});
