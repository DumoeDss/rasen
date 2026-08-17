/**
 * `issue-acceptance-close` task 2.3 — the two Issue mutations over a REAL Git
 * Store fixture: `publishAcceptance` and `accept`, every refusal row of the
 * D5 state matrix, lock serialization (concurrent accepts leave one record),
 * failed-mutation lock release, and the state-transition refusal surface
 * staying exactly what it was.
 *
 * The mutations take the already-evaluated gate snapshot as input and perform
 * no run-state reads (design D6), so these tests need no execution root —
 * what they exercise is the store-side write discipline: the layout
 * addresses, the ordinal allocation, the anti-overwrite refusals, the
 * one-record-per-Issue rule, and the commit-suggestion contract (nothing
 * staged, pathspec named).
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
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type AcceptanceGateSnapshot,
} from '../../../src/core/store/issues/index.js';
import { StorePlanningValidationError } from '../../../src/core/store/planning-validation.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-acc';

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

describe('the acceptance mutations', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-acceptance-',
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

  const acceptedPath = () => f.at('rasen', 'issues', ISSUE, 'accepted.yaml');
  const conditionsPath = (revision: string) =>
    f.at('rasen', 'issues', ISSUE, 'acceptance', `${revision}.yaml`);

  /** Creates the Issue and publishes one conditions revision. */
  async function setup(publishConditions = true) {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Acceptance target' });
    if (!publishConditions) return null;
    const published = await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: CONDITIONS,
    });
    return published;
  }

  function expectRefusal(thrown: unknown, code: string): StoreIssueError {
    expect(thrown).toBeInstanceOf(StoreIssueError);
    const refusal = thrown as StoreIssueError;
    expect(refusal.issueCode).toBe(code);
    return refusal;
  }

  it('publishes conditions as an ordinal-addressed immutable revision', async () => {
    const published = await setup();
    expect(published?.revision.revisionId).toBe('0001');
    expect(published?.revision.supersedes).toBeNull();
    expect(published?.revision.conditions.map(condition => condition.id)).toEqual([
      'cond-1',
      'cond-2',
    ]);
    expect(fs.existsSync(conditionsPath('0001'))).toBe(true);
    // The write report names the checkout, the pathspec, and stages nothing.
    expect(published?.written).toEqual([conditionsPath('0001')]);
    expect(published?.suggestedCommits[0].pathspecs).toEqual([
      `rasen/issues/${ISSUE}/acceptance/0001.yaml`,
    ]);
    // `-uall` so the untracked `rasen/issues/` tree lists per file rather
    // than collapsing to its directory — the fixture seeds no Issue content.
    const status = f.git(f.storeRoot, ['status', '--porcelain', '-uall']).split(/\r?\n/u);
    expect(status.some(line => line.includes('acceptance/0001.yaml'))).toBe(true);
    // Nothing staged: the porcelain form of a staged file is 'A ', unstaged '??'.
    expect(status.some(line => line.startsWith('A ') && line.includes('acceptance'))).toBe(false);
  });

  it('publishes a second revision at the next ordinal and never rewrites the first', async () => {
    const first = await setup();
    const firstBytes = fs.readFileSync(conditionsPath('0001'), 'utf8');
    const second = await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Tightened after review' }],
    });
    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');
    expect(fs.readFileSync(conditionsPath('0001'), 'utf8')).toBe(firstBytes);
    expect(first?.revision.revisionId).toBe('0001');
  });

  it('refuses publication without conditions and for an unknown Issue, writing nothing', async () => {
    await setup();
    let thrown: unknown;
    try {
      await issues().publishAcceptance({ ...scope(), issueId: ISSUE, conditions: [] });
    } catch (error) {
      thrown = error;
    }
    // The pure-schema refusal surfaces as the planning validation error, the
    // same shape `publishPlan` gives an invalid node list.
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('at least one condition');
    expect(fs.existsSync(conditionsPath('0002'))).toBe(false);

    thrown = undefined;
    try {
      await issues().publishAcceptance({
        ...scope(),
        issueId: 'no-such-issue',
        conditions: CONDITIONS,
      });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_not_found');
    expect(fs.existsSync(f.at('rasen', 'issues', 'no-such-issue'))).toBe(false);
  });

  it('accepts an open Issue: record + resolved state in one serialized mutation pair', async () => {
    const published = await setup();
    const result = await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: published!.revision.revisionId,
      conditionsSha256: published!.revision.contentSha256,
      gate: SNAPSHOT,
      note: 'Closing after dogfood',
    });
    expect(result.state).toBe('resolved');
    expect(result.record.conditionsRevisionId).toBe('0001');
    expect(result.record.note).toBe('Closing after dogfood');
    expect(result.record.gate).toEqual(SNAPSHOT);
    // Both files moved and both pathspecs are named, in one suggestion.
    expect(result.written).toEqual([acceptedPath(), f.at('rasen', 'issues', ISSUE, 'issue.yaml')]);
    expect(result.suggestedCommits[0].pathspecs).toEqual([
      `rasen/issues/${ISSUE}/accepted.yaml`,
      `rasen/issues/${ISSUE}/issue.yaml`,
    ]);
    expect(fs.existsSync(acceptedPath())).toBe(true);
    const record = fs.readFileSync(f.at('rasen', 'issues', ISSUE, 'issue.yaml'), 'utf8');
    expect(record).toContain('state: resolved');
  });

  it('upgrades a legacy resolved close in place: record only, no transition', async () => {
    const published = await setup();
    await issues().setState({ ...scope(), issueId: ISSUE, state: 'resolved' });
    const recordBefore = fs.readFileSync(f.at('rasen', 'issues', ISSUE, 'issue.yaml'), 'utf8');
    const result = await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: published!.revision.revisionId,
      conditionsSha256: published!.revision.contentSha256,
      gate: SNAPSHOT,
    });
    expect(result.state).toBe('resolved');
    // The record is the ONLY write; the Issue record's bytes are untouched.
    expect(result.written).toEqual([acceptedPath()]);
    expect(fs.readFileSync(f.at('rasen', 'issues', ISSUE, 'issue.yaml'), 'utf8')).toBe(
      recordBefore
    );
  });

  it('refuses a dropped Issue, an already-accepted Issue, and a tampered existing record', async () => {
    const published = await setup();
    // Dropped.
    const dropped = f.beside('dropped-copy');
    fs.mkdirSync(dropped, { recursive: true });
    await issues().setState({
      ...scope(),
      issueId: ISSUE,
      state: 'dropped',
      reason: 'Superseded by other work',
    });
    let thrown: unknown;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_accept_dropped');
    expect(fs.existsSync(acceptedPath())).toBe(false);

    // A fresh open Issue that gets accepted, then re-accepted.
    await issues().create({ ...scope(), issueId: 'iss-two', title: 'Second' });
    const twoPublished = await issues().publishAcceptance({
      ...scope(),
      issueId: 'iss-two',
      conditions: CONDITIONS,
    });
    await issues().accept({
      ...scope(),
      issueId: 'iss-two',
      conditionsRevisionId: twoPublished.revision.revisionId,
      conditionsSha256: twoPublished.revision.contentSha256,
      gate: SNAPSHOT,
    });
    const recordBytes = fs.readFileSync(f.at('rasen', 'issues', 'iss-two', 'accepted.yaml'), 'utf8');
    thrown = undefined;
    try {
      await issues().accept({
        ...scope(),
        issueId: 'iss-two',
        conditionsRevisionId: twoPublished.revision.revisionId,
        conditionsSha256: twoPublished.revision.contentSha256,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    const refusal = expectRefusal(thrown, 'issue_accept_already_accepted');
    expect(refusal.message).toContain('already carries an acceptance record');
    expect(refusal.diagnostic.fix).toContain('never rewritten');
    expect(fs.readFileSync(f.at('rasen', 'issues', 'iss-two', 'accepted.yaml'), 'utf8')).toBe(
      recordBytes
    );

    // An existing record that no longer verifies is STILL an existing record.
    fs.writeFileSync(
      f.at('rasen', 'issues', 'iss-two', 'accepted.yaml'),
      recordBytes.replace('issueId: iss-two', 'issueId: iss-TWO'),
      'utf8'
    );
    thrown = undefined;
    try {
      await issues().accept({
        ...scope(),
        issueId: 'iss-two',
        conditionsRevisionId: twoPublished.revision.revisionId,
        conditionsSha256: twoPublished.revision.contentSha256,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    const tamperedRefusal = expectRefusal(thrown, 'issue_accept_already_accepted');
    expect(tamperedRefusal.message).toContain('does not read back');
  });

  it('refuses an acceptance whose conditions revision is missing, mismatched, or unreadable', async () => {
    const published = await setup();
    // Absent ordinal.
    let thrown: unknown;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: '0009',
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_accept_conditions_unreadable');

    // Digest that disagrees with the named revision.
    thrown = undefined;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: '0'.repeat(64) as `${string}`,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_accept_conditions_unreadable');

    // A tampered on-disk revision: the store-side re-read refuses it.
    const bytes = fs.readFileSync(conditionsPath('0001'), 'utf8');
    fs.writeFileSync(conditionsPath('0001'), bytes.replace('shipped', 'SHIPPED'), 'utf8');
    thrown = undefined;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: '0001',
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
      });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_accept_conditions_unreadable');
    expect(fs.existsSync(acceptedPath())).toBe(false);
  });

  it('refuses an incoherent snapshot and a blank note, writing nothing', async () => {
    const published = await setup();
    let thrown: unknown;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: published!.revision.contentSha256,
        gate: { completed: 2, total: 2, health: 'healthy', problemsStanding: 3 },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorePlanningValidationError);
    expect((thrown as Error).message).toContain('problemsStanding must be zero');
    expect(fs.existsSync(acceptedPath())).toBe(false);

    thrown = undefined;
    try {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
        note: '   ',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreIssueError);
    expect((thrown as StoreIssueError).issueCode).toBe('issue_accept_note_invalid');
    expect(fs.existsSync(acceptedPath())).toBe(false);
  });

  it('serializes concurrent accepts: one record, one refusal naming already-accepted', async () => {
    const published = await setup();
    const attempt = () =>
      issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
      });
    const outcomes = await Promise.allSettled([attempt(), attempt(), attempt()]);
    const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const rejection of rejected) {
      expectRefusal(rejection.reason, 'issue_accept_already_accepted');
    }
    // Exactly one accepted.yaml, and one resolved record — the loser wrote
    // nothing at all.
    expect(fs.existsSync(acceptedPath())).toBe(true);
    expect(fs.readFileSync(f.at('rasen', 'issues', ISSUE, 'issue.yaml'), 'utf8')).toContain(
      'state: resolved'
    );
  });

  it('releases the lock after a refused mutation', async () => {
    const published = await setup();
    // A refused accept (dropped state) must not leave the issue lock held.
    await issues().setState({
      ...scope(),
      issueId: ISSUE,
      state: 'dropped',
      reason: 'No longer wanted',
    });
    await expect(
      issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: published!.revision.revisionId,
        conditionsSha256: published!.revision.contentSha256,
        gate: SNAPSHOT,
      })
    ).rejects.toBeInstanceOf(StoreIssueError);
    // A later mutation on the SAME issue still runs to completion.
    const next = await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Posthumous revision' }],
    });
    expect(next.revision.revisionId).toBe('0002');
  });

  it('keeps the state-transition refusal surface exactly what it was', async () => {
    await setup();
    await issues().setState({ ...scope(), issueId: ISSUE, state: 'resolved' });
    let thrown: unknown;
    try {
      await issues().setState({ ...scope(), issueId: ISSUE, state: 'dropped', reason: 'x' });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_state_transition_refused');
    // And a resolved-with-record Issue still refuses any setState the same way.
    const published = await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: CONDITIONS,
    });
    await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: published.revision.revisionId,
      conditionsSha256: published.revision.contentSha256,
      gate: SNAPSHOT,
    });
    thrown = undefined;
    try {
      await issues().setState({ ...scope(), issueId: ISSUE, state: 'dropped', reason: 'x' });
    } catch (error) {
      thrown = error;
    }
    expectRefusal(thrown, 'issue_state_transition_refused');
  });
});
