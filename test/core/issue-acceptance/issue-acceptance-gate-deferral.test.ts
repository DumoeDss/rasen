/**
 * `issue-deferral-record` tasks 2.2/2.3 — the acceptance gate and its record
 * under the fifth lifecycle, over a REAL Git Store fixture (the discipline
 * `issue-acceptance-gate-lifecycle.test.ts` set for the other two
 * not-demanded values, which stays the authority for their rows).
 *
 * The claim under test is "a deferral never holds Done but is recorded":
 * excluded from the required total with its reason named on the eligible AND
 * the blocked evaluation, never an un-terminal or a failing-node blocker, and
 * frozen into `accepted.yaml` when it stands at acceptance.
 *
 * The last row is a NEGATIVE pin over the pure gate: the five refusal codes
 * shadow in order, and this change adds none to that ladder (g-002's finding
 * — a multi-cause refusal presents only its first cause, so an inserted code
 * would silently change which cause an operator sees).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  parseAcceptedRecord,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import {
  writePortfolioState,
  type PortfolioState,
} from '../../../src/core/pipeline-registry/portfolio-state.js';
import {
  writeRunState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';
import type { IssueNodeStatus } from '../../../src/core/issue-status/index.js';
import {
  acceptIssue,
  evaluateIssueAcceptanceGate,
  readIssueAcceptanceFacts,
} from '../../../src/core/issue-acceptance/index.js';
import type { IssueAcceptanceFacts } from '../../../src/core/issue-acceptance/types.js';
import type {
  AcceptanceConditionsRevisionV1,
  ExecutionPlanRevisionId,
  Sha256Digest,
} from '../../../src/core/store/issues/index.js';

const NOW = '2026-08-23T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-gate-defer';

// Short on purpose: the record's YAML folds a long scalar across lines, and
// one row asserts the reason appears in the stored bytes verbatim.
const DEFERRAL_REASON = 'postponed beyond this Issue to the next milestone';

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

const IN_FLIGHT = () => stages({ propose: 'done', apply: 'in_progress' });

describe('the acceptance gate under a deferred node', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  let issueUid: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-gate-deferral-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function seedAndCommit(changeId: string, instanceSeed: string): string {
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
  }

  function writeRunStateFor(alias: string, state: RunState): void {
    writeRunState(ephemeraDir(execRoot, alias), state);
  }

  function writePortfolioFor(alias: string, state: PortfolioState): void {
    writePortfolioState(ephemeraDir(execRoot, alias), state);
  }

  const node = (
    nodeId: string,
    changeInstanceId: string,
    alias: string,
    extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason' | 'dependsOn'>> = {}
  ): ExecutionPlanNodeInput => ({
    nodeId,
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    changeInstanceId,
    changeAlias: alias,
    dependsOn: [],
    ...extra,
  });

  async function setup(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    const created = await issues().create({ ...scope(), issueId: ISSUE, title: 'Gate deferral' });
    issueUid = created.identity.uid;
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'The deferral semantics are shipped' }],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + conditions']);
  }

  async function gateOf() {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: facts,
    });
    return { status, gate: status.acceptance?.gate };
  }

  it('excludes an incomplete deferred node with its reason, and reports eligible', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-def', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: DEFERRAL_REASON }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // The deferred node's work is mid-flight and will never finish under THIS
    // Issue: the postponement is exactly what the operator recorded.
    writeRunStateFor('child-def', IN_FLIGHT());

    const { status, gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      // Eligible over the required nodes alone — the deferral held nothing.
      expect(gate.snapshot).toEqual({
        completed: 1,
        total: 1,
        health: 'waiting-human',
        problemsStanding: 0,
      });
      expect(gate.exclusions).toEqual([
        { nodeId: 'g-def', lifecycle: 'deferred', reason: DEFERRAL_REASON },
      ]);
      // Postponed is neither optional-but-wanted nor counted.
      expect(gate.optionalNodes).toEqual([]);
    }
    // Its observation stays reported on its node line: outside the graph,
    // still observed.
    const deferredRow = status.nodes.find(entry => entry.nodeId === 'g-def');
    expect(deferredRow?.observation).toBe('in-flight');
    expect(deferredRow?.lifecycle).toBe('deferred');
    expect(deferredRow?.reason).toBe(DEFERRAL_REASON);
  });

  it('rides a BLOCKED evaluation with the same exclusion, explaining the smaller total', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-def', 'c3'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-002', ids[1], 'child-b'),
      node('g-def', ids[2], 'child-def', { lifecycle: 'deferred', reason: DEFERRAL_REASON }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // g-002 required and un-terminal: the gate is blocked on IT alone.
    writeRunStateFor('child-b', IN_FLIGHT());

    const { gate } = await gateOf();
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_blocked');
      expect(gate.blockers).toEqual([
        { kind: 'un-terminal-node', nodeId: 'g-002', observation: 'in-flight' },
      ]);
      // The deferral is named beside the blocked gate exactly as beside an
      // eligible one — the exclusion account is not an eligible-only fact.
      expect(gate.exclusions).toEqual([
        { nodeId: 'g-def', lifecycle: 'deferred', reason: DEFERRAL_REASON },
      ]);
      expect(gate.blockers.map(blocker => 'nodeId' in blocker && blocker.nodeId)).not.toContain(
        'g-def'
      );
    }
  });

  it('never names a deferred node a failing-node blocker, while a wanted node still is', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-def', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: DEFERRAL_REASON }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // The deferred node carries a live failure escalation: history, not
    // health, and no blocker — only the exclusion names it.
    writePortfolioFor('child-def', {
      parent: 'child-def',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    });
    const deferred = await gateOf();
    expect(deferred.status.health).not.toBe('failed');
    expect(deferred.gate?.eligible).toBe(true);
    if (deferred.gate?.eligible) {
      expect(deferred.gate.snapshot.total).toBe(1);
      expect(deferred.gate.exclusions.map(exclusion => exclusion.nodeId)).toEqual(['g-def']);
    }

    // The discriminating half: the SAME failure on a WANTED node still holds
    // the gate as a failing-node blocker, so the skip above is scoped to the
    // lifecycle rather than blanket-swallowing failures.
    writePortfolioFor('child-a', {
      parent: 'child-a',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    });
    const wanted = await gateOf();
    expect(wanted.status.health).toBe('failed');
    expect(wanted.gate?.eligible).toBe(false);
    if (wanted.gate && !wanted.gate.eligible) {
      expect(wanted.gate.blockers).toContainEqual({ kind: 'failing-node', nodeId: 'g-001' });
      expect(wanted.gate.blockers).not.toContainEqual({ kind: 'failing-node', nodeId: 'g-def' });
    }
  });

  it('reports eligible 0/0 for a plan of optional, cancelled, superseded, and deferred nodes', async () => {
    const ids = [
      seedAndCommit('child-opt', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
      seedAndCommit('child-sup', 'c3'.repeat(16)),
      seedAndCommit('child-def', 'd4'.repeat(16)),
    ];
    await setup([
      node('g-opt', ids[0], 'child-opt', { lifecycle: 'optional' }),
      node('g-cut', ids[1], 'child-cut', { lifecycle: 'cancelled', reason: 'descoped and abandoned' }),
      node('g-sup', ids[2], 'child-sup', { lifecycle: 'superseded', reason: 'folded into g-opt' }),
      node('g-def', ids[3], 'child-def', { lifecycle: 'deferred', reason: DEFERRAL_REASON }),
    ]);
    const { gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      expect(gate.snapshot).toEqual({
        completed: 0,
        total: 0,
        health: 'waiting-human',
        problemsStanding: 0,
      });
      // All three not-demanded values ride the same account, each naming its
      // own lifecycle — the reviewer reads WHY the total is empty. The order
      // is the revision's canonical node order (code point by node id), not
      // an order the accounting invents.
      expect(gate.exclusions).toEqual([
        { nodeId: 'g-cut', lifecycle: 'cancelled', reason: 'descoped and abandoned' },
        { nodeId: 'g-def', lifecycle: 'deferred', reason: DEFERRAL_REASON },
        { nodeId: 'g-sup', lifecycle: 'superseded', reason: 'folded into g-opt' },
      ]);
      expect(gate.optionalNodes).toEqual(['g-opt']);
    }
  });

  it('freezes a standing deferral into the acceptance record, inside the digest body', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-def', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: DEFERRAL_REASON }),
    ]);
    writeRunStateFor('child-a', TERMINAL());

    const accepted = await acceptIssue({
      ...scope(),
      issueId: ISSUE,
      projection: { executionRoot: execRoot, changesDir, workDirFor: NO_WORK_DIR },
    });
    expect(accepted.record.gate).toEqual({
      completed: 1,
      total: 1,
      health: 'waiting-human',
      problemsStanding: 0,
    });
    expect(accepted.record.exclusions).toEqual([
      { nodeId: 'g-def', lifecycle: 'deferred', reason: DEFERRAL_REASON },
    ]);

    // The stored bytes carry the deferral, and the record's own digest covers
    // it: the read verifies, and stripping the block refuses.
    const acceptedPath = f.at('rasen', 'issues', issueUid, 'accepted.yaml');
    const text = fs.readFileSync(acceptedPath, 'utf8');
    expect(text).toContain('lifecycle: deferred');
    expect(text).toContain(DEFERRAL_REASON);
    expect(parseAcceptedRecord(text, { verifyDigest: true }).exclusions).toEqual(
      accepted.record.exclusions
    );
    const stripped = text.replace(/exclusions:\r?\n(?:[^\S\r\n]+\S.*\r?\n)+/u, '');
    expect(stripped.includes('exclusions')).toBe(false);
    expect(() => parseAcceptedRecord(stripped, { verifyDigest: true })).toThrow(
      /does not match the record body/u
    );

    // The durable read presents the same carry.
    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    expect(facts.acceptedRecord.record?.exclusions).toEqual(accepted.record.exclusions);
  });

  it('still writes the absent form when no exclusion stood — the deferral did not widen the empty case', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await setup([node('g-001', ids[0], 'child-a')]);
    writeRunStateFor('child-a', TERMINAL());

    const accepted = await acceptIssue({
      ...scope(),
      issueId: ISSUE,
      projection: { executionRoot: execRoot, changesDir, workDirFor: NO_WORK_DIR },
    });
    expect(accepted.record.exclusions).toBeUndefined();
    const text = fs.readFileSync(f.at('rasen', 'issues', issueUid, 'accepted.yaml'), 'utf8');
    expect(text.includes('exclusions')).toBe(false);
    expect(parseAcceptedRecord(text, { verifyDigest: true }).exclusions).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// The refusal ladder: order shadows, and this change inserted nothing (g-002)
// -----------------------------------------------------------------------------

const REVISION = '0001' as ExecutionPlanRevisionId;
const DIGEST = 'a'.repeat(64) as Sha256Digest;

const CONDITIONS: AcceptanceConditionsRevisionV1 = {
  version: 1,
  issueId: ISSUE,
  revisionId: REVISION,
  supersedes: null,
  createdAt: NOW,
  contentSha256: DIGEST,
  conditions: [{ id: 'cond-1', requirement: 'The unit condition' }],
};

function factsWith(options: {
  conditions?: boolean;
  accepted?: boolean;
}): IssueAcceptanceFacts {
  return {
    conditions: options.conditions === false
      ? { revision: null, revisionId: null, diagnostic: null, path: null }
      : { revision: CONDITIONS, revisionId: REVISION, diagnostic: null, path: null },
    acceptedRecord: options.accepted === true
      ? {
          present: true,
          record: {
            version: 1,
            issueId: ISSUE,
            acceptedAt: NOW,
            conditionsRevisionId: REVISION,
            conditionsSha256: DIGEST,
            gate: { completed: 1, total: 1, health: 'healthy', problemsStanding: 0 },
            note: null,
            contentSha256: DIGEST,
          },
          diagnostic: null,
          path: null,
        }
      : { present: false, record: null, diagnostic: null, path: null },
  };
}

function deferredRow(nodeId: string): IssueNodeStatus {
  return {
    nodeId,
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    lifecycle: 'deferred',
    reason: DEFERRAL_REASON,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: nodeId,
    observation: 'in-flight',
    blockedBy: [],
    diagnostic: null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
    delivery: null,
  };
}

describe('the gate refusal ladder is unchanged by the deferral vocabulary', () => {
  // Every structural condition holds AT ONCE over a plan whose only node is
  // deferred. The ladder is ordered, so exactly one code presents each time —
  // and peeling the conditions off walks the same five rungs the four-value
  // era walked, in the same order, with no deferral rung inserted anywhere.
  const nodes = [deferredRow('g-def')];
  const view = (issueState: 'open' | 'dropped') => ({
    issueState,
    nodes,
    problems: [],
    health: 'healthy',
    complete: true,
  });

  it('presents the five codes in the order that shadows, deferral inserting none', () => {
    // 1. dropped outranks everything, even an existing record.
    expect(
      evaluateIssueAcceptanceGate(view('dropped'), factsWith({ accepted: true, conditions: false }))
    ).toMatchObject({ eligible: false, refusalCode: 'issue_accept_dropped' });
    // 2. already_accepted outranks the missing plan and the missing conditions.
    expect(
      evaluateIssueAcceptanceGate(view('open'), factsWith({ accepted: true, conditions: false }))
    ).toMatchObject({ eligible: false, refusalCode: 'issue_accept_already_accepted' });
    // 3. requires_plan outranks the missing conditions (empty node list).
    expect(
      evaluateIssueAcceptanceGate(
        { ...view('open'), nodes: [] },
        factsWith({ conditions: false })
      )
    ).toMatchObject({ eligible: false, refusalCode: 'issue_accept_requires_plan' });
    // 4. conditions_required outranks the fact blockers.
    expect(
      evaluateIssueAcceptanceGate(
        { ...view('open'), problems: [
          { kind: 'unreadable-plan' as const, node: null, ref: null, reason: 'damaged' },
        ], complete: false },
        factsWith({ conditions: false })
      )
    ).toMatchObject({ eligible: false, refusalCode: 'issue_accept_conditions_required' });
    // 5. blocked is the last rung — and a deferred node is not what blocks it.
    const blocked = evaluateIssueAcceptanceGate(
      {
        ...view('open'),
        problems: [{ kind: 'unreadable-plan' as const, node: null, ref: null, reason: 'damaged' }],
        complete: false,
      },
      factsWith({})
    );
    expect(blocked).toMatchObject({ eligible: false, refusalCode: 'issue_accept_blocked' });
    if (!blocked.eligible) {
      expect(blocked.blockers.map(blocker => blocker.kind)).toEqual(['status-problem']);
    }
  });

  it('reports a lone deferred node as eligible 0/0 — the ladder falls through to the gate', () => {
    const evaluation = evaluateIssueAcceptanceGate(view('open'), factsWith({}));
    expect(evaluation.eligible).toBe(true);
    if (evaluation.eligible) {
      expect(evaluation.snapshot).toMatchObject({ completed: 0, total: 0 });
      expect(evaluation.exclusions).toEqual([
        { nodeId: 'g-def', lifecycle: 'deferred', reason: DEFERRAL_REASON },
      ]);
    }
  });
});
