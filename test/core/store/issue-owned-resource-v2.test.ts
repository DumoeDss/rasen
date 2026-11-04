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
  executionPlanDigest,
  normalizePlanNodes,
  parseExecutionPlanRevision,
  serializeExecutionPlanRevision,
} from '../../../src/core/store/issues/plans.js';
import {
  parseExecutionPlanRevisionId,
  parseIssueUid,
  parseSha256Digest,
} from '../../../src/core/store/planning-validation.js';

const ISSUE_UID = parseIssueUid('75f3d57b-57e4-46ab-88e4-cbfec96bd257');
const REVISION_ID = parseExecutionPlanRevisionId('0002');
const SUPERSEDES_V1 = parseExecutionPlanRevisionId('0001');

function planDraft() {
  return {
    version: 2 as const,
    issueUid: ISSUE_UID,
    revisionId: REVISION_ID,
    supersedes: SUPERSEDES_V1,
    createdAt: '2026-08-31T00:00:00.000Z',
    nodes: normalizePlanNodes([
      {
        nodeId: 'work-a',
        kind: 'intent' as const,
        projectId: 'app-a',
        targetLineId: 'main',
        summary: 'Ship identity',
        dependsOn: [],
      },
    ]),
  };
}

function conditionsDraft() {
  return {
    version: 2 as const,
    issueUid: ISSUE_UID,
    revisionId: REVISION_ID,
    supersedes: SUPERSEDES_V1,
    createdAt: '2026-08-31T01:00:00.000Z',
    conditions: normalizeAcceptanceConditions([
      { id: 'identity-stable', requirement: 'Issue identity is stable' },
    ]),
  };
}

function recordDraft(conditionsSha256: ReturnType<typeof parseSha256Digest>) {
  return {
    version: 2 as const,
    issueUid: ISSUE_UID,
    acceptedAt: '2026-08-31T02:00:00.000Z',
    conditionsRevisionId: REVISION_ID,
    conditionsSha256,
    gate: { completed: 1, total: 1, health: 'healthy', problemsStanding: 0 },
    note: null,
  };
}

describe('version-2 Issue-owned resource codecs', () => {
  it('pins a V2 plan that supersedes a V1 ordinal', () => {
    const draft = planDraft();
    const digest = executionPlanDigest(draft);
    expect(digest).toBe('1d99737af20cd653985f3ece19829599c99394f3f86a1d5da1995c235afb0069');

    const yaml = serializeExecutionPlanRevision({
      ...draft,
      contentSha256: parseSha256Digest(digest),
    });
    expect(yaml).toBe(
      'version: 2\n' +
        'issueUid: 75f3d57b-57e4-46ab-88e4-cbfec96bd257\n' +
        'revisionId: "0002"\n' +
        'supersedes: "0001"\n' +
        'createdAt: 2026-08-31T00:00:00.000Z\n' +
        `contentSha256: ${digest}\n` +
        'nodes:\n' +
        '  - nodeId: work-a\n' +
        '    kind: intent\n' +
        '    projectId: app-a\n' +
        '    targetLineId: main\n' +
        '    summary: Ship identity\n' +
        '    dependsOn: []\n'
    );
    const parsed = parseExecutionPlanRevision(yaml, { verifyDigest: true });
    expect(parsed).toMatchObject({ version: 2, issueUid: ISSUE_UID, supersedes: '0001' });
  });

  it('pins V2 acceptance conditions on the same mixed-history ordinal', () => {
    const draft = conditionsDraft();
    const digest = acceptanceConditionsDigest(draft);
    expect(digest).toBe('113416978fb2bdd8d0f6418adf890a0f553c792eaf6a3d5472bbe871d1702ff5');

    const yaml = serializeAcceptanceConditionsRevision({
      ...draft,
      contentSha256: parseSha256Digest(digest),
    });
    expect(yaml).toBe(
      'version: 2\n' +
        'issueUid: 75f3d57b-57e4-46ab-88e4-cbfec96bd257\n' +
        'revisionId: "0002"\n' +
        'supersedes: "0001"\n' +
        'createdAt: 2026-08-31T01:00:00.000Z\n' +
        `contentSha256: ${digest}\n` +
        'conditions:\n' +
        '  - id: identity-stable\n' +
        '    requirement: Issue identity is stable\n'
    );
    const parsed = parseAcceptanceConditionsRevision(yaml, { verifyDigest: true });
    expect(parsed).toMatchObject({ version: 2, issueUid: ISSUE_UID, supersedes: '0001' });
  });

  it('pins a V2 accepted record owner and digest', () => {
    const conditionsSha256 = parseSha256Digest(acceptanceConditionsDigest(conditionsDraft()));
    const draft = recordDraft(conditionsSha256);
    const digest = acceptedRecordDigest(draft);
    expect(digest).toBe('f15a039410fad8eb393c05ec96e0796abf87cc990d105a6f60c72ae96cdbe0ed');

    const yaml = serializeAcceptedRecord({
      ...draft,
      contentSha256: parseSha256Digest(digest),
    });
    expect(yaml).toBe(
      'version: 2\n' +
        'issueUid: 75f3d57b-57e4-46ab-88e4-cbfec96bd257\n' +
        'acceptedAt: 2026-08-31T02:00:00.000Z\n' +
        'conditionsRevisionId: "0002"\n' +
        `conditionsSha256: ${conditionsSha256}\n` +
        'gate:\n' +
        '  completed: 1\n' +
        '  total: 1\n' +
        '  health: healthy\n' +
        '  problemsStanding: 0\n' +
        'note: null\n' +
        `contentSha256: ${digest}\n`
    );
    const parsed = parseAcceptedRecord(yaml, { verifyDigest: true });
    expect(parsed).toMatchObject({ version: 2, issueUid: ISSUE_UID });
  });
});
