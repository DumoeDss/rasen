/**
 * `issue-revision-history-preservation` tasks 3.4–3.7 — the durable
 * exclusions carry on the acceptance record: byte identity for the
 * empty-exclusion accept (the absent form, exactly the bytes the field's
 * absence defined), pre-field compatibility (a record written before the
 * field existed reads back with its digest verifying), the tamper path now
 * covering the new field (stripping it, or editing an exclusion's reason,
 * refuses the digest), strictness kept (an unrecognized field still refused),
 * and the carry itself — an accept over a plan with a superseded node writes
 * the gate's exclusion verbatim into the record.
 *
 * The digest-body edge of byte identity is pinned non-symmetrically by the
 * SIBLING `store-issue-acceptance-content.test.ts`, whose hand-copied
 * `RECORD_DIGEST` literal for a no-exclusion record must keep matching after
 * this change — these tests pin the serialized-file edge over the real
 * mutation path.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssueError,
  StoreIssuesModule,
  acceptedRecordDigest,
  parseAcceptedRecord,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type AcceptanceGateSnapshot,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import {
  StorePlanningValidationError,
  parseExecutionPlanRevisionId,
  parseIssueId,
} from '../../../src/core/store/planning-validation.js';
import {
  writeRunState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { acceptIssue, readIssueAcceptanceFacts } from '../../../src/core/issue-acceptance/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-xcl';

const SNAPSHOT: AcceptanceGateSnapshot = {
  completed: 2,
  total: 2,
  health: 'healthy',
  problemsStanding: 0,
};

const CONDITIONS = [
  { id: 'cond-1', requirement: 'The projection is shipped' },
  { id: 'cond-2', requirement: 'The binding loop is proven', verification: 'dogfood receipts' },
];

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

const TERMINAL = () =>
  stages({
    propose: 'done',
    apply: 'done',
    verify: 'done',
    'review-loop': 'done',
    ship: 'done',
    archive: 'done',
  });

describe('the acceptance record\'s durable exclusions carry', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-xcl-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  const acceptedPath = (issueId: string) => f.at('rasen', 'issues', issueId, 'accepted.yaml');

  /** Creates the Issue and publishes one conditions revision. */
  async function setup(issueId: string) {
    await issues().create({ ...scope(), issueId, title: 'Carry target' });
    const published = await issues().publishAcceptance({
      ...scope(),
      issueId,
      conditions: CONDITIONS,
    });
    return published;
  }

  it('writes the absent form for a no-exclusion accept, byte-identical however the input spells it', async () => {
    const published = await setup(ISSUE);
    const accepted = await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: '0001',
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
    });

    // The exact serialized bytes, hand-written: no `exclusions` key exists
    // anywhere in the file. The two digest lines are the only
    // function-derived values (the conditions digest from the published
    // revision, the record digest over exactly these fields).
    const expected =
      'version: 1\n' +
      `issueId: ${ISSUE}\n` +
      `acceptedAt: ${NOW}\n` +
      'conditionsRevisionId: "0001"\n' +
      `conditionsSha256: ${published.revision.contentSha256}\n` +
      'gate:\n' +
      '  completed: 2\n' +
      '  total: 2\n' +
      '  health: healthy\n' +
      '  problemsStanding: 0\n' +
      'note: null\n' +
      `contentSha256: ${accepted.record.contentSha256}\n`;
    const text = fs.readFileSync(acceptedPath(ISSUE), 'utf8');
    expect(text).toBe(expected);
    expect(text.includes('exclusions')).toBe(false);
    // And the digest the record froze is the digest over the absent body.
    expect(
      acceptedRecordDigest({
        version: 1,
        issueId: accepted.record.issueId,
        acceptedAt: NOW,
        conditionsRevisionId: accepted.record.conditionsRevisionId,
        conditionsSha256: published.revision.contentSha256,
        gate: SNAPSHOT,
        note: null,
      })
    ).toBe(accepted.record.contentSha256);
    expect(accepted.record.exclusions).toBeUndefined();

    // The SAME bytes when the caller spells the empty accounting explicitly:
    // an empty array is the absence it is. Two different Issues, each with
    // its own conditions revision — the records differ ONLY in the per-issue
    // identity (the issue id and the two digests that cover it), so the
    // shape — the field set, the order, no exclusions key anywhere — is
    // byte-identical between the absent-spelled and empty-spelled accept.
    const other = 'iss-xcl2';
    const otherPublished = await setup(other);
    const otherAccepted = await issues().accept({
      ...scope(),
      issueId: other,
      conditionsRevisionId: '0001',
      conditionsSha256: otherPublished.revision.contentSha256,
      gate: SNAPSHOT,
      exclusions: [],
    });
    const otherText = fs.readFileSync(acceptedPath(other), 'utf8');
    expect(otherText).toBe(
      text
        .replaceAll(`issueId: ${ISSUE}`, `issueId: ${other}`)
        .replaceAll(
          published.revision.contentSha256,
          otherPublished.revision.contentSha256
        )
        .replaceAll(accepted.record.contentSha256, otherAccepted.record.contentSha256)
    );
    expect(otherText.includes('exclusions')).toBe(false);
  });

  it('reads a pre-field record back unchanged, its digest verifying, with no exclusions', async () => {
    const published = await setup(ISSUE);
    // Hand-assembled pre-field bytes: exactly the YAML the record serialized
    // to before the field existed, digest computed over that same absent
    // body — the shape every record already in a Store today carries.
    const digest = acceptedRecordDigest({
      version: 1,
      issueId: parseIssueId(ISSUE),
      acceptedAt: NOW,
      conditionsRevisionId: parseExecutionPlanRevisionId('0001'),
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
      note: null,
    });
    const preFieldYaml = [
      'version: 1',
      `issueId: ${ISSUE}`,
      `acceptedAt: ${NOW}`,
      'conditionsRevisionId: "0001"',
      `conditionsSha256: ${published.revision.contentSha256}`,
      'gate:',
      '  completed: 2',
      '  total: 2',
      '  health: healthy',
      '  problemsStanding: 0',
      'note: null',
      `contentSha256: ${digest}`,
      '',
    ].join('\n');
    const record = parseAcceptedRecord(preFieldYaml, { verifyDigest: true });
    expect(record.conditionsRevisionId).toBe('0001');
    // No exclusions: reported as the absence it is, never an error.
    expect(record.exclusions).toBeUndefined();

    // A present-but-empty array reads back as the same absence — the
    // canonical form omits the field when no exclusion stood, however the
    // bytes spelled it, and the digest over the omitted body still verifies.
    const presentEmpty = preFieldYaml.replace(
      'note: null',
      'exclusions: []\nnote: null'
    );
    const empty = parseAcceptedRecord(presentEmpty, { verifyDigest: true });
    expect(empty.exclusions).toBeUndefined();
  });

  it('refuses a record whose exclusions were stripped from its bytes — the tamper path covers the new field', async () => {
    const published = await setup(ISSUE);
    const accepted = await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: '0001',
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
      exclusions: [
        { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'folded into g-002 by replanning' },
      ],
    });
    expect(accepted.record.exclusions).toEqual([
      { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'folded into g-002 by replanning' },
    ]);
    const text = fs.readFileSync(acceptedPath(ISSUE), 'utf8');
    // The carried form round-trips: read back, digest verifies, exclusions
    // present with node, lifecycle, and reason.
    const roundTrip = parseAcceptedRecord(text, { verifyDigest: true });
    expect(roundTrip.exclusions).toEqual(accepted.record.exclusions);

    // Strip the exclusions block from the stored bytes without re-digesting:
    // the digest covers the field, so the read refuses.
    const stripped = text.replace(
      /exclusions:\r?\n(?:[^\S\r\n]+\S.*\r?\n)+/u,
      ''
    );
    expect(stripped.includes('exclusions')).toBe(false);
    expect(() => parseAcceptedRecord(stripped, { verifyDigest: true })).toThrow(
      StorePlanningValidationError
    );
    try {
      parseAcceptedRecord(stripped, { verifyDigest: true });
    } catch (error) {
      expect((error as StorePlanningValidationError).code).toBe('invalid_acceptance_record');
      expect((error as Error).message).toContain('does not match the record body');
    }
  });

  it('mutation check: a hand-edited exclusion reason refuses the digest — the carry is covered, not decorative', async () => {
    const published = await setup(ISSUE);
    await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: '0001',
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
      exclusions: [
        { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'folded into g-002 by replanning' },
      ],
    });
    const text = fs.readFileSync(acceptedPath(ISSUE), 'utf8');
    // The reason is carried content under the digest: editing its wording
    // without re-digesting refuses the read, exactly like the note.
    const tampered = text.replace(
      'folded into g-002 by replanning',
      'folded into g-003 by replanning'
    );
    expect(tampered).not.toBe(text);
    expect(() => parseAcceptedRecord(tampered, { verifyDigest: true })).toThrow(
      /does not match the record body/u
    );
  });

  it('refuses an unrecognized extra field and non-portable exclusion text, keeping strictness', async () => {
    const published = await setup(ISSUE);
    const draft = {
      version: 1 as const,
      issueId: parseIssueId(ISSUE),
      acceptedAt: NOW,
      conditionsRevisionId: parseExecutionPlanRevisionId('0001'),
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
      exclusions: [
        { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'descoped after review' },
      ],
      note: null,
    };
    const contentSha256 = acceptedRecordDigest(draft);
    const baseYaml = (extraLine: string | null, digest: string): string =>
      [
        'version: 1',
        `issueId: ${ISSUE}`,
        `acceptedAt: ${NOW}`,
        'conditionsRevisionId: "0001"',
        `conditionsSha256: ${published.revision.contentSha256}`,
        'gate:',
        '  completed: 2',
        '  total: 2',
        '  health: healthy',
        '  problemsStanding: 0',
        ...(extraLine === null ? [] : [extraLine]),
        'note: null',
        `contentSha256: ${digest === '' ? contentSha256 : digest}`,
        '',
      ].join('\n');

    // The exclusions block carrying one reason, spliced in before the note —
    // the shape every carried record serializes to.
    const withExclusions = (reason: string, digest: string): string =>
      baseYaml(null, digest).replace(
        'note: null',
        [
          'exclusions:',
          '  - nodeId: g-sup',
          '    lifecycle: superseded',
          `    reason: ${reason}`,
          'note: null',
        ].join('\n')
      );

    // An unrecognized field is refused — the schema stays strict with the
    // new optional field admitted.
    expect(() => parseAcceptedRecord(baseYaml('mystery: 1', ''), { verifyDigest: false })).toThrow(
      /mystery/u
    );
    // An exclusion whose reason is a machine path is refused at the schema —
    // the reason is durable Store content like the note.
    expect(() =>
      parseAcceptedRecord(withExclusions('C:\\Users\\sayo\\notes.txt', ''), {
        verifyDigest: false,
      })
    ).toThrow(/must not be a machine filesystem path/u);
    // A duplicate exclusion node is refused — one node, one exclusion row.
    const duplicated = {
      ...draft,
      exclusions: [
        { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'descoped after review' },
        { nodeId: 'g-sup', lifecycle: 'cancelled', reason: 'descoped again' },
      ],
    };
    const duplicatedDigest = acceptedRecordDigest(duplicated);
    const duplicatedYaml = baseYaml(null, duplicatedDigest).replace(
      'note: null',
      [
        'exclusions:',
        '  - nodeId: g-sup',
        '    lifecycle: superseded',
        '    reason: descoped after review',
        '  - nodeId: g-sup',
        '    lifecycle: cancelled',
        '    reason: descoped again',
        'note: null',
      ].join('\n')
    );
    expect(() => parseAcceptedRecord(duplicatedYaml, { verifyDigest: true })).toThrow(
      /declared more than once/u
    );
  });

  it('carries the gate evaluation\'s exclusion verbatim when accepting over a plan with a superseded node', async () => {
    // The full orchestration path: a real plan whose required nodes are
    // terminal and whose superseded node names its successor in the reason —
    // the accept writes the evaluation's exclusions into the record itself.
    let execRoot = '';
    let changesDir = '';
    const NO_WORK_DIR = async (): Promise<null> => null;
    const seedAndCommit = (changeId: string, instanceSeed: string): string => {
      const seeded = f.seedChange({
        root: f.storeRoot,
        projectId: PROJECT,
        targetLineId: LINE,
        changeId,
        instanceSeed,
      });
      f.git(f.storeRoot, ['add', '-A']);
      f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
      return seeded.instanceId;
    };

    await issues().create({ ...scope(), issueId: ISSUE, title: 'Carry target' });
    const [a, b, sup] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-sup', 'd4'.repeat(16)),
    ];
    const node = (
      nodeId: string,
      instanceId: string,
      alias: string,
      extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason'>> = {}
    ): ExecutionPlanNodeInput => ({
      nodeId,
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: instanceId,
      changeAlias: alias,
      dependsOn: [],
      ...extra,
    });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        node('g-001', a, 'child-a'),
        node('g-002', b, 'child-b'),
        node('g-sup', sup, 'child-sup', {
          lifecycle: 'superseded',
          reason: 'folded into g-002, which carries the same work',
        }),
      ],
    });
    await issues().publishAcceptance({ ...scope(), issueId: ISSUE, conditions: CONDITIONS });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + conditions']);

    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
    for (const alias of ['child-a', 'child-b']) {
      const dir = ephemeraDir(execRoot, alias);
      writeRunState(dir, TERMINAL());
    }

    const accepted = await acceptIssue({
      ...scope(),
      issueId: ISSUE,
      projection: { executionRoot: execRoot, changesDir, workDirFor: NO_WORK_DIR },
    });
    // The record explains its own total: 2/2 over the required nodes, with
    // the superseded exclusion named beside it — node, lifecycle, reason.
    // (Health freezes waiting-human: all-terminal work with the acceptance
    // itself the thing awaited — the only reachable waiting-human at gate
    // time, exactly as the gate's design states.)
    expect(accepted.record.gate).toEqual({
      completed: 2,
      total: 2,
      health: 'waiting-human',
      problemsStanding: 0,
    });
    expect(accepted.record.exclusions).toEqual([
      {
        nodeId: 'g-sup',
        lifecycle: 'superseded',
        reason: 'folded into g-002, which carries the same work',
      },
    ]);

    // The durable read presents the same carry: the facts reader is the one
    // seam every read surface composes.
    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    expect(facts.acceptedRecord.record?.exclusions).toEqual(accepted.record.exclusions);
    // And the stored bytes carry the field — the absent form is only for the
    // no-exclusion accept.
    expect(fs.readFileSync(acceptedPath(ISSUE), 'utf8')).toContain(
      'folded into g-002, which carries the same work'
    );

    // A re-accept is refused as always — the record is never rewritten,
    // exclusions included.
    let refused: unknown;
    try {
      await acceptIssue({
        ...scope(),
        issueId: ISSUE,
        projection: { executionRoot: execRoot, changesDir, workDirFor: NO_WORK_DIR },
      });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(StoreIssueError);
    expect((refused as StoreIssueError).issueCode).toBe('issue_accept_already_accepted');
  });
});
