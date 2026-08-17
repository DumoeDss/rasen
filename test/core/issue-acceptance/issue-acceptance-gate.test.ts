/**
 * `issue-acceptance-close` task 3.3 — the gate table (design D3) and the
 * done-rule replacement (design D4), over a REAL Git Store fixture.
 *
 * Run-state below is FIXTURE-SHAPED but real-bytes: every file is written with
 * the frozen pipeline-registry writers (`writeRunState` / `writePortfolioState`)
 * into a real execution root, so the gate evaluates exactly the observations
 * the projection derives from the bytes the LEAD produces. The failed-health
 * HOLD especially: no real failure exists in this portfolio to receipt, and
 * fabricating one in real run-state would be theater — the fixture here is
 * labelled as a fixture.
 *
 * The gate is evaluated BOTH ways: through the projection (the
 * `status.acceptance.gate` block, the way `show` renders it) and directly
 * over an assembled view (the way `acceptIssue` re-checks it).
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
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import {
  writePortfolioState,
  writeRunState,
  type PortfolioState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { writePortfolioState as writePortfolio } from '../../../src/core/pipeline-registry/portfolio-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';
import {
  evaluateIssueAcceptanceGate,
  readIssueAcceptanceFacts,
} from '../../../src/core/issue-acceptance/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-gate';

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

describe('the acceptance gate', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-acceptance-gate-',
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

  function writeRunStateFor(alias: string, state: RunState): string {
    const dir = ephemeraDir(execRoot, alias);
    writeRunState(dir, state);
    return path.join(dir, 'auto-run.json');
  }

  function writePortfolioFor(alias: string, state: PortfolioState): string {
    const dir = ephemeraDir(execRoot, alias);
    writePortfolio(dir, state);
    return path.join(dir, 'portfolio-run.json');
  }

  /** Creates the Issue, a three-node plan, and one conditions revision. */
  async function setupPlannedAndConditioned(
    ids: readonly string[]
  ): Promise<void> {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Gate target' });
    const nodes: readonly ExecutionPlanNodeInput[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[1],
        changeAlias: 'child-b',
        dependsOn: ['g-001'],
      },
      {
        nodeId: 'g-003',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[2],
        changeAlias: 'child-c',
        dependsOn: ['g-001', 'g-002'],
      },
    ];
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [
        { id: 'cond-1', requirement: 'The projection is shipped' },
        { id: 'cond-2', requirement: 'The binding loop is proven' },
      ],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + conditions']);
  }

  async function gateOf(): Promise<{
    status: Awaited<ReturnType<typeof projectIssueStatus>>;
    facts: Awaited<ReturnType<typeof readIssueAcceptanceFacts>>;
  }> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: facts,
    });
    return { status, facts };
  }

  it('reports eligible when every node is terminal, naming the conditions revision', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', TERMINAL());
    writeRunStateFor('child-b', TERMINAL());
    writeRunStateFor('child-c', TERMINAL());
    const { status } = await gateOf();
    const gate = status.acceptance?.gate;
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      expect(gate.conditionsRevisionId).toBe('0001');
      // The snapshot's health is the projection's at gate time: an all-
      // terminal open Issue reads review/waiting-human, and D3 says exactly
      // that waiting-human never holds the gate — the human is the accepter.
      expect(gate.snapshot).toEqual({
        completed: 3,
        total: 3,
        health: 'waiting-human',
        problemsStanding: 0,
      });
    }
  });

  it('names an un-terminal node with its observation, together with every other blocker', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', TERMINAL());
    // g-002 is in flight.
    writeRunStateFor('child-b', stages({ propose: 'done', apply: 'in_progress' }));
    // g-003's run-state exists but is invalid — a status problem.
    const corruptPath = path.join(ephemeraDir(execRoot, 'child-c'), 'auto-run.json');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{corrupt', 'utf8');

    const { status } = await gateOf();
    const gate = status.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_blocked');
      const unTerminal = gate.blockers.filter(blocker => blocker.kind === 'un-terminal-node');
      const problems = gate.blockers.filter(blocker => blocker.kind === 'status-problem');
      expect(unTerminal).toEqual([
        { kind: 'un-terminal-node', nodeId: 'g-002', observation: 'in-flight' },
        // An invalid run-state observes `unknown`, which is not terminal.
        { kind: 'un-terminal-node', nodeId: 'g-003', observation: 'unknown' },
      ]);
      expect(problems.map(blocker => blocker.problemKind)).toEqual(['invalid-run-state']);
      expect(gate.message).toContain('node g-002 is in-flight');
      expect(gate.message).toContain('invalid-run-state');
    }
  });

  it('holds the gate on failed health, naming the node whose recorded failure drives it', async () => {
    // FIXTURE (design D9): no real failure exists in this portfolio to
    // receipt, so the failed observation below comes from a portfolio record
    // with an escalated child — real-shaped bytes from the frozen
    // `writePortfolioState` writer, labelled here as a fixture.
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
    ];
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Gate target' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'g-001',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: ids[0],
          changeAlias: 'child-a',
          dependsOn: [],
        },
        {
          nodeId: 'g-002',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: ids[1],
          changeAlias: 'child-b',
          dependsOn: ['g-001'],
        },
      ],
    });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Nothing failed' }],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + conditions']);
    writeRunStateFor('child-a', TERMINAL());
    writePortfolioFor('child-b', {
      parent: 'child-b',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    });

    const { status } = await gateOf();
    expect(status.health).toBe('failed');
    const gate = status.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_blocked');
      // The node is named as un-terminal AND as the failure driving health —
      // both facts, together, not one or the other.
      expect(gate.blockers).toContainEqual({
        kind: 'un-terminal-node',
        nodeId: 'g-002',
        observation: 'failed',
      });
      expect(gate.blockers).toContainEqual({ kind: 'failing-node', nodeId: 'g-002' });
      expect(gate.message).toContain('node g-002 is failed');
    }
  });

  it('refuses structurally: dropped, already accepted, planless, conditions-less', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);

    // Dropped: the state alone answers, no gate facts consulted.
    await issues().setState({
      ...scope(),
      issueId: ISSUE,
      state: 'dropped',
      reason: 'Abandoned for this scenario',
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'drop']);
    let gate = (await gateOf()).status.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_dropped');
      expect(gate.blockers).toEqual([]);
    }

    // A fresh open Issue with no plan at all.
    await issues().create({ ...scope(), issueId: 'iss-planless', title: 'No plan' });
    const planlessDetail = await new StoreQueryModuleImpl().showIssue({
      ...scope(),
      issueId: 'iss-planless',
    });
    const planlessStatus = await projectIssueStatus({
      detail: planlessDetail,
      workDirFor: NO_WORK_DIR,
      acceptance: {
        conditions: { revision: null, revisionId: null, diagnostic: null, path: null },
        acceptedRecord: { present: false, record: null, diagnostic: null, path: null },
      },
    });
    gate = planlessStatus.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_requires_plan');
    }

    // A planned Issue with no conditions revision.
    await issues().create({ ...scope(), issueId: 'iss-unconditioned', title: 'No conditions' });
    await issues().publishPlan({
      ...scope(),
      issueId: 'iss-unconditioned',
      nodes: [
        {
          nodeId: 'g-001',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: ids[0],
          changeAlias: 'child-a',
          dependsOn: [],
        },
      ],
    });
    const unconditionedFacts = await readIssueAcceptanceFacts({
      ...scope(),
      issueId: 'iss-unconditioned',
    });
    const unconditionedStatus = await projectIssueStatus({
      detail: await new StoreQueryModuleImpl().showIssue({
        ...scope(),
        issueId: 'iss-unconditioned',
      }),
      workDirFor: NO_WORK_DIR,
      acceptance: unconditionedFacts,
    });
    gate = unconditionedStatus.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_conditions_required');
      expect(gate.message).toContain('no acceptance conditions revision exists');
    }

    // Already accepted: present beats everything else.
    await issues().create({ ...scope(), issueId: 'iss-accepted', title: 'Already' });
    await issues().publishAcceptance({
      ...scope(),
      issueId: 'iss-accepted',
      conditions: [{ id: 'cond-1', requirement: 'Done already' }],
    });
    await issues().accept({
      ...scope(),
      issueId: 'iss-accepted',
      conditionsRevisionId: '0001',
      conditionsSha256: (
        await readIssueAcceptanceFacts({ ...scope(), issueId: 'iss-accepted' })
      ).conditions.revision?.contentSha256 as string,
      gate: { completed: 0, total: 0, health: 'healthy', problemsStanding: 0 },
    });
    const acceptedFacts = await readIssueAcceptanceFacts({ ...scope(), issueId: 'iss-accepted' });
    const acceptedStatus = await projectIssueStatus({
      detail: await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: 'iss-accepted' }),
      workDirFor: NO_WORK_DIR,
      acceptance: acceptedFacts,
    });
    gate = acceptedStatus.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_already_accepted');
    }
  });

  it('names an unreadable latest conditions revision when that is why none reads back', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Gate target' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'g-001',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: ids[0],
          changeAlias: 'child-a',
          dependsOn: [],
        },
      ],
    });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Shipped' }],
    });
    // Tamper the revision without re-digesting.
    const revisionPath = f.at('rasen', 'issues', ISSUE, 'acceptance', '0001.yaml');
    fs.writeFileSync(
      revisionPath,
      fs.readFileSync(revisionPath, 'utf8').replace('Shipped', 'SHIPPED'),
      'utf8'
    );

    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    expect(facts.conditions.revision).toBeNull();
    expect(facts.conditions.revisionId).toBe('0001');
    expect(facts.conditions.diagnostic).toContain('does not match');
    const status = await projectIssueStatus({
      detail: await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE }),
      workDirFor: NO_WORK_DIR,
      acceptance: facts,
    });
    // Unreadable acceptance content is a status problem, never silent.
    expect(
      status.problems.filter(problem => problem.kind === 'unreadable-acceptance')
    ).toHaveLength(1);
    const gate = status.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_conditions_required');
      expect(gate.message).toContain("'0001' does not read back");
    }
    expect(status.complete).toBe(false);
  });

  it('never presents done from unreadable acceptance bytes', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', TERMINAL());
    await issues().setState({ ...scope(), issueId: ISSUE, state: 'resolved' });
    // Accept through the mutation, then tamper the record.
    const factsBefore = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: '0001',
      conditionsSha256: factsBefore.conditions.revision?.contentSha256 as string,
      gate: { completed: 1, total: 1, health: 'healthy', problemsStanding: 0 },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'resolve + accept']);
    const acceptedPath = f.at('rasen', 'issues', ISSUE, 'accepted.yaml');
    fs.writeFileSync(
      acceptedPath,
      fs.readFileSync(acceptedPath, 'utf8').replace('issueId: ' + ISSUE, 'issueId: tampered'),
      'utf8'
    );

    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    expect(facts.acceptedRecord.present).toBe(true);
    expect(facts.acceptedRecord.record).toBeNull();
    const status = await projectIssueStatus({
      detail: await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE }),
      workDirFor: NO_WORK_DIR,
      acceptance: facts,
    });
    expect(status.phase).toBe('review');
    expect(status.problems.some(problem => problem.kind === 'unreadable-acceptance')).toBe(true);
  });

  it('reproduces C2 behavior for omitted acceptance inputs, byte-for-byte', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });

    const omitted = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    // Every pre-acceptance derivation is IDENTICAL when the same Issue is
    // projected with empty acceptance facts — the omission changes nothing
    // but the acceptance block itself (null vs a conditions-required gate).
    const empty = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: {
        conditions: { revision: null, revisionId: null, diagnostic: null, path: null },
        acceptedRecord: { present: false, record: null, diagnostic: null, path: null },
      },
    });
    expect(omitted.acceptance).toBeNull();
    expect({ ...omitted, acceptance: undefined }).toEqual({ ...empty, acceptance: undefined });
    expect(empty.acceptance?.gate).toBeDefined();
    if (empty.acceptance && !empty.acceptance.gate.eligible) {
      expect(empty.acceptance.gate.refusalCode).toBe('issue_accept_conditions_required');
    }
  });

  it('freezes what was accepted: a later conditions revision changes neither the record nor done', async () => {
    // Info-3's pin, straight from the delta's scenario: the record names the
    // conditions revision it accepted, and a later revision does not change
    // what the record says was accepted.
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', TERMINAL());
    writeRunStateFor('child-b', TERMINAL());
    writeRunStateFor('child-c', TERMINAL());
    const before = await gateOf();
    const beforeGate = before.status.acceptance?.gate;
    expect(beforeGate?.eligible).toBe(true);
    if (beforeGate?.eligible) {
      await issues().accept({
        ...scope(),
        issueId: ISSUE,
        conditionsRevisionId: beforeGate.conditionsRevisionId,
        conditionsSha256: before.facts.conditions.revision?.contentSha256 as string,
        gate: beforeGate.snapshot,
      });
    }
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'accept under 0001']);

    // A later conditions revision the record never named.
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-new', requirement: 'Tightened after the acceptance' }],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'publish conditions 0002']);

    const after = await gateOf();
    // The record still names 0001 and its digest; the Issue stays done.
    expect(after.status.phase).toBe('done');
    expect(after.status.acceptance?.record?.conditionsRevisionId).toBe('0001');
    expect(after.status.acceptance?.record?.conditionsSha256).toBe(
      before.facts.conditions.revision?.contentSha256
    );
    // The LATEST revision the facts read names is 0002 — the separation the
    // freeze guarantees: latest ≠ accepted.
    expect(after.status.acceptance?.conditions.revision?.revisionId).toBe('0002');
  });

  it('evaluates the same rule directly over a view as through the projection', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await setupPlannedAndConditioned(ids);
    writeRunStateFor('child-a', TERMINAL());
    const { status, facts } = await gateOf();
    const direct = evaluateIssueAcceptanceGate(
      {
        issueState: (await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE }))
          .issue.record?.state ?? null,
        nodes: status.nodes,
        problems: status.problems,
        health: status.health,
        complete: status.complete,
      },
      facts
    );
    expect(direct).toEqual(status.acceptance?.gate);
  });
});
