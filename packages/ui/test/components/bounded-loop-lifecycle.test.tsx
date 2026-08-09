// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, getRunDetail: vi.fn() };
});

import * as client from '../../src/api/client.js';
import type {
  BoundedLoopLifecycleViewSection,
  ChangeRunView,
  ChangeRunViewSection,
  RootDagViewSection,
  RunsResponse,
} from '../../src/api/types.js';
import { OperationsSection } from '../../src/components/OperationsSection.js';

const RUN_ID = `run:${'a'.repeat(64)}`;
const CHANGE_ID = 'lifecycle-fixture';
const DIGEST = `sha256:${'b'.repeat(64)}`;

function root(overrides: Partial<RootDagViewSection> = {}): RootDagViewSection {
  return {
    kind: 'root-dag',
    version: 1,
    frontier: [],
    activeInvocations: [],
    actions: [],
    waits: [],
    workspace: {
      current: {
        format: 'workspace-revision/1',
        head: { kind: 'commit', digest: DIGEST, detached: false },
        treeDigest: DIGEST,
        dirtyWorktreeDigest: DIGEST,
      },
      expectedByActiveWriters: [],
    },
    effectDiagnostics: [],
    allowedControls: [],
    ...overrides,
  };
}

function lifecycle(
  overrides: Partial<BoundedLoopLifecycleViewSection> = {}
): BoundedLoopLifecycleViewSection {
  return {
    kind: 'bounded-loop-lifecycle',
    version: 1,
    loopPath: 'root/goal-loop',
    bodyKind: 'goal-cycle',
    state: 'running',
    iteration: 3,
    phase: 'judge',
    limits: {
      iterations: { used: 3, max: 5 },
      actions: { used: 6, max: 12 },
      budget: { used: 6, max: 12 },
    },
    progressFingerprint: DIGEST,
    stallStreak: 1,
    blockedStreak: 0,
    strategy: { attempts: 0, maxAttempts: 2 },
    ...overrides,
  };
}

function view(sections: readonly ChangeRunViewSection[], rootSection = root()): ChangeRunView {
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: RUN_ID,
    change: {
      planningSpaceId: `planning-space:${'1'.repeat(64)}`,
      projectId: 'fixture-project',
      changeId: CHANGE_ID,
      instanceId: `change-instance:${'2'.repeat(64)}`,
    },
    recordVersion: 7,
    status: 'waiting',
    sourceState: 'active',
    workspace: { instanceId: `workspace-instance:${'3'.repeat(64)}`, scope: 'current' },
    drift: {
      definition: 'unchanged',
      sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: [rootSection, ...sections],
  };
}

const runs: RunsResponse = {
  runs: [],
  reconcilerRuns: [{
    runId: RUN_ID,
    changeId: CHANGE_ID,
    planningSpaceId: `planning-space:${'1'.repeat(64)}`,
    engine: 'reconciler',
    recordVersion: 7,
    status: 'waiting',
    sourceState: 'active',
    waits: 1,
  }],
  hasMore: false,
};

async function open(container: HTMLElement, projected: ChangeRunView): Promise<void> {
  vi.mocked(client.getRunDetail).mockResolvedValue(projected);
  render(
    <OperationsSection runsResponse={runs} selector="project:fixture" childNames={[CHANGE_ID]} />,
    container
  );
  await act(async () => {
    (container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement).click();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

describe('Operations bounded-loop lifecycle composition', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
  });

  it('renders Goal domain truth beside lifecycle truth without duplicate counters', async () => {
    await open(container, view([
      lifecycle(),
      {
        kind: 'goal',
        version: 1,
        loopPath: 'root/goal-loop',
        variant: 'measure',
        round: 3,
        phase: 'judge',
        lastScore: 0.72,
        lastGaps: [],
      },
    ]));

    expect(container.querySelector('[data-testid="ops-loop-lifecycle-limits"]')!.textContent)
      .toContain('3/5');
    const goal = container.querySelector('[data-testid="ops-run-goal"]')!;
    expect(goal.getAttribute('data-variant')).toBe('measure');
    expect(goal.textContent).toContain('0.72');
    expect(goal.textContent).not.toContain('3/5');
    expect(goal.textContent).not.toContain('stall 1');
    expect(goal.querySelector('[data-testid="ops-goal-outcome"]')!.textContent)
      .toContain('in progress');
  });

  it('renders review and generic Composite lifecycle panels as separate projections', async () => {
    await open(container, view([
      lifecycle({ loopPath: 'root/review-loop', bodyKind: 'review-cycle' }),
      lifecycle({ loopPath: 'root/composite-loop', bodyKind: 'composite', phase: 'stage:verify' }),
      {
        kind: 'review-cycle',
        version: 1,
        loopPath: 'root/review-loop',
        round: 3,
        phase: 're-review',
        findings: [{ id: 'M1', severity: 'Major', status: 'open', claim: 'Still open' }],
        actors: {},
        maxRounds: 5,
      },
    ]));

    expect(container.querySelectorAll('[data-testid="ops-run-loop-lifecycle"]')).toHaveLength(2);
    expect(container.querySelector('[data-body-kind="composite"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ops-run-review-cycle"]')!.textContent)
      .toContain('M1');
  });

  it('shows exact human evidence and truthful non-success lifecycle controls', async () => {
    const waitId = `wait:${'c'.repeat(64)}`;
    const humanWait = {
      waitId,
      kind: 'human-required' as const,
      nodeId: `node:${'4'.repeat(64)}`,
      invocationId: `invocation:${'5'.repeat(64)}`,
      occurrence: 1,
      attemptId: `attempt:${'6'.repeat(64)}`,
      actionId: `action:${'7'.repeat(64)}`,
      effectIds: [],
      loopPath: 'root/goal-loop',
      phase: 'judge',
      blockerFingerprint: DIGEST,
      reasonCode: 'dependency_unavailable',
      outcome: 'operator-escalated',
      evidence: [{
        format: 'change-run-evidence-ref/1' as const,
        store: 'change-run' as const,
        evidenceDigest: `sha256:${'8'.repeat(64)}`,
        contentDigest: `sha256:${'9'.repeat(64)}`,
        mediaType: 'application/json',
        size: 321,
        observationKind: 'blocked-dependency-report',
        producer: { id: 'fixture-agent', version: '2', identityDigest: DIGEST },
        binding: {
          planningSpaceId: `planning-space:${'1'.repeat(64)}`,
          changeInstanceId: `change-instance:${'2'.repeat(64)}`,
          projectId: 'fixture-project',
          changeId: CHANGE_ID,
          runId: RUN_ID,
          actionId: `action:${'7'.repeat(64)}`,
          schema: 'blocked-report/1',
        },
      }],
      decisionIds: ['retry', 'escalate'] as const,
    };
    const humanRoot = root({
      waits: [humanWait],
      allowedControls: [
        { kind: 'decision', waitId, decisionId: 'retry', outcomes: ['retry', 'escalate'] },
        { kind: 'decision', waitId, decisionId: 'escalate', outcomes: ['retry', 'escalate'] },
        { kind: 'cancel' },
      ],
    });
    await open(container, view([
      lifecycle({
        state: 'human-required',
        blockedStreak: 2,
        wait: { waitId, kind: 'human-required', reasonCode: 'dependency_unavailable' },
      }),
      {
        kind: 'goal', version: 1, loopPath: 'root/goal-loop', variant: 'research',
        round: 3, phase: 'judge', outcome: 'exhausted', lastGaps: ['missing-source'],
      },
    ], humanRoot));

    const evidence = container.querySelector('[data-testid="ops-human-required-evidence-item"]')!;
    expect(evidence.textContent).toContain('blocked-dependency-report');
    expect(evidence.textContent).toContain('application/json');
    expect(evidence.textContent).toContain('321');
    expect(evidence.textContent).toContain('fixture-agent@2');
    expect(container.querySelectorAll('[data-testid="ops-control"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="ops-goal-outcome"]')!.textContent)
      .toBe('exhausted');
  });

  it('warns for old Goal Runs and suppresses controls for unknown lifecycle versions', async () => {
    const goal: ChangeRunViewSection = {
      kind: 'goal', version: 1, loopPath: 'root/goal-loop', variant: 'evaluate',
      round: 1, phase: 'judge', lastGaps: ['gap-a'],
    };
    await open(container, view([goal]));
    expect(container.querySelector('[data-testid="ops-loop-lifecycle-missing"]')).not.toBeNull();

    render(null, container);
    const actionableRoot = root({ allowedControls: [{ kind: 'cancel' }] });
    await open(container, view([
      goal,
      { kind: 'bounded-loop-lifecycle', version: 2, loopPath: 'root/goal-loop', future: true },
    ], actionableRoot));
    const warning = container.querySelector('[data-testid="ops-loop-lifecycle-unsupported"]')!;
    expect(warning.getAttribute('data-version')).toBe('2');
    expect(container.querySelector('[data-testid="ops-run-controls"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-run-goal"]')).not.toBeNull();
  });
});
