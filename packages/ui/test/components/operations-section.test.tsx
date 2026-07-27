// @vitest-environment jsdom
/**
 * Component-level render coverage for OperationsSection (task 14.3/14.4 of
 * `ecp-run-spine`). These tests RENDER the component and assert on its output —
 * they exercise the client→server-truth consumption path through the real UI,
 * not a kernel projector bypass. The HTTP client is mocked (legitimate); what
 * would be illegitimate is asserting on `projectRunView` output with no UI
 * component involved.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getRunDetail: vi.fn(),
  };
});

import { OperationsSection } from '../../src/components/OperationsSection.js';
import * as client from '../../src/api/client.js';
import type { ChangeRunView, RunsResponse } from '../../src/api/types.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Clicks a summary row and waits for the async detail fetch to resolve. */
async function selectRunAndWait(container: HTMLElement): Promise<void> {
  const button = container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement;
  await act(async () => {
    button.click();
    await flushMicrotasks();
  });
  // The fetch resolves in a separate tick; a second act flush ensures the
  // useEffect → getRunDetail → setState chain fully settles.
  await act(async () => {
    await flushMicrotasks(12);
  });
}

/** A full ChangeRunView fixture matching the server's projected shape. */
function makeRunView(overrides: Partial<ChangeRunView> = {}): ChangeRunView {
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: 'run:' + 'a'.repeat(64),
    change: {
      planningSpaceId: 'planning-space:' + 'b'.repeat(64),
      projectId: 'test-project',
      changeId: 'test-change',
      instanceId: 'change-instance:' + 'c'.repeat(64),
    },
    recordVersion: 3,
    status: 'waiting',
    sourceState: 'active',
    workspace: {
      instanceId: 'workspace-instance:' + 'd'.repeat(64),
      scope: 'current',
    },
    drift: {
      definition: 'unchanged',
      sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: [
      {
        kind: 'root-dag',
        version: 1,
        frontier: ['node:' + 'e'.repeat(64)],
        activeInvocations: [
          {
            invocationId: 'invocation:' + 'f'.repeat(64),
            nodeId: 'node:' + 'e'.repeat(64),
            attemptId: 'attempt:' + '1'.repeat(64),
            actionIds: ['action:' + '2'.repeat(64)],
            effects: [],
          },
        ],
        actions: [
          {
            format: 'change-run-action-view/1',
            kind: 'agent',
            actionId: 'action:' + '2'.repeat(64),
            invocationId: 'invocation:' + 'f'.repeat(64),
            attemptId: 'attempt:' + '1'.repeat(64),
            nodeId: 'node:' + 'e'.repeat(64),
            deliveryState: 'granted',
            capability: {
              id: 'bug-fix',
              contractVersion: '1.0.0',
              contractDigest: 'sha256:' + '3'.repeat(64),
              artifactDigest: 'sha256:' + '4'.repeat(64),
            },
            effects: [],
          },
        ],
        waits: [
          {
            waitId: 'wait:' + '5'.repeat(64),
            kind: 'gate',
            nodeId: 'node:gate1',
            invocationId: 'invocation:' + 'f'.repeat(64),
            occurrence: 1,
            gateId: 'gate-1',
            decisionIds: ['approve', 'reject'],
          },
          {
            waitId: 'wait:' + '6'.repeat(64),
            kind: 'domain-blocked',
            nodeId: 'node:blocked1',
            invocationId: 'invocation:' + 'f'.repeat(64),
            occurrence: 1,
            attemptId: 'attempt:' + '1'.repeat(64),
            actionId: 'action:' + '2'.repeat(64),
            effectIds: [],
            reasonCode: 'dependency_unmet',
          },
        ],
        workspace: {
          current: {
            format: 'workspace-revision/1',
            head: { kind: 'commit', digest: 'sha256:' + '7'.repeat(64), detached: false },
            treeDigest: 'sha256:' + '8'.repeat(64),
            dirtyWorktreeDigest: 'sha256:' + '9'.repeat(64),
          },
          expectedByActiveWriters: [],
        },
        effectDiagnostics: [],
        allowedControls: [
          {
            kind: 'decision',
            waitId: 'wait:' + '5'.repeat(64),
            decisionId: 'approve',
            outcomes: ['approve', 'reject'],
          },
          { kind: 'escalate' },
          { kind: 'cancel' },
        ],
      },
    ],
    ...overrides,
  };
}

/** A RunsResponse with reconciler summaries. */
function makeRunsResponse(overrides: Partial<RunsResponse> = {}): RunsResponse {
  return {
    runs: [],
    reconcilerRuns: [
      {
        runId: 'run:' + 'a'.repeat(64),
        changeId: 'test-change',
        planningSpaceId: 'planning-space:' + 'b'.repeat(64),
        engine: 'reconciler',
        recordVersion: 3,
        status: 'waiting',
        sourceState: 'active',
        waits: 2,
      },
    ],
    hasMore: false,
    ...overrides,
  };
}

describe('OperationsSection (14.3/14.4)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it('renders nothing when there are no reconciler runs', () => {
    const empty: RunsResponse = { runs: [], reconcilerRuns: [], hasMore: false };
    render(
      <OperationsSection runsResponse={empty} selector="project:test" childNames={['test-change']} />,
      container
    );
    expect(container.querySelector('[data-testid="operations-section"]')).toBeNull();
  });

  it('groups runs by child change and shows summary rows with server-projected status', () => {
    const res = makeRunsResponse();
    render(
      <OperationsSection runsResponse={res} selector="project:test" childNames={['test-change']} />,
      container
    );

    const section = container.querySelector('[data-testid="operations-section"]');
    expect(section).not.toBeNull();

    // One group for 'test-change' (matches a child name).
    const groups = container.querySelectorAll('[data-testid="operations-group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.getAttribute('data-change')).toBe('test-change');

    // The summary row shows the server-projected status (not client-derived).
    const rows = container.querySelectorAll('[data-testid="ops-summary-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('waiting');
    expect(rows[0]!.textContent).toContain('2 waits');
    expect(rows[0]!.textContent).toContain('v3');

    // Full runId is in the title attribute (accessible copy affordance).
    const button = rows[0]!.querySelector('[data-testid="ops-summary-select"]')!;
    expect(button.getAttribute('title')).toContain('run:aaaa');
  });

  it('fetches and renders Run detail when a summary is clicked — consuming server truth', async () => {
    const view = makeRunView();
    vi.mocked(client.getRunDetail).mockResolvedValue(view);

    render(
      <OperationsSection
        runsResponse={makeRunsResponse()}
        selector="project:test"
        childNames={['test-change']}
      />,
      container
    );

    // No detail panel before selection.
    expect(container.querySelector('[data-testid="ops-run-detail"]')).toBeNull();

    // Click the summary row and wait for the detail to load.
    await selectRunAndWait(container);

    // Detail panel opens with server-projected fields.
    const detail = container.querySelector('[data-testid="ops-run-detail"]');
    expect(detail).not.toBeNull();

    // The client called the server's run detail route — did not bypass the UI.
    expect(client.getRunDetail).toHaveBeenCalledWith('test-change', 'run:' + 'a'.repeat(64), 'project:test');

    // Server-projected status rendered verbatim.
    expect(container.querySelector('[data-testid="ops-run-status"]')!.textContent).toBe('waiting');
    expect(container.querySelector('[data-testid="ops-run-source-state"]')!.textContent).toBe('active');

    // Frontier rendered from server projection (not client-derived).
    const frontier = container.querySelector('[data-testid="ops-run-frontier"]');
    expect(frontier).not.toBeNull();
    expect(frontier!.textContent).toContain('node:eeee');

    // Waits rendered from server projection — gate + domain-blocked.
    const waits = container.querySelectorAll('[data-testid="ops-wait"]');
    expect(waits).toHaveLength(2);
    expect(waits[0]!.getAttribute('data-wait-kind')).toBe('gate');
    expect(waits[0]!.textContent).toContain('Gate gate-1');
    expect(waits[1]!.getAttribute('data-wait-kind')).toBe('domain-blocked');
    expect(waits[1]!.textContent).toContain('dependency_unmet');

    // Actions rendered from server projection with delivery state.
    const actions = container.querySelectorAll('[data-testid="ops-run-action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.getAttribute('data-delivery')).toBe('granted');

    // Allowed controls rendered as read-only badges (no submit — 14.5/14.6 is later).
    const controls = container.querySelectorAll('[data-testid="ops-control-badge"]');
    expect(controls).toHaveLength(3);
    expect(controls[0]!.getAttribute('data-control-kind')).toBe('decision');
    expect(controls[1]!.getAttribute('data-control-kind')).toBe('escalate');
    expect(controls[2]!.getAttribute('data-control-kind')).toBe('cancel');

    // Drift rendered from server projection.
    const drift = container.querySelector('[data-testid="ops-run-drift"]');
    expect(drift).not.toBeNull();
    expect(drift!.textContent).toContain('definition: unchanged');
    expect(drift!.textContent).toContain('capability: unchanged');
  });

  it('renders terminal Run with the server-projected terminal reason and no actions/waits', async () => {
    const terminalView = makeRunView({
      status: 'completed',
      sections: [
        {
          kind: 'root-dag',
          version: 1,
          frontier: [],
          activeInvocations: [],
          actions: [],
          waits: [],
          terminal: { kind: 'completed', outcome: 'ship_success' },
          workspace: {
            current: {
              format: 'workspace-revision/1',
              head: { kind: 'commit', digest: 'sha256:' + '7'.repeat(64), detached: false },
              treeDigest: 'sha256:' + '8'.repeat(64),
              dirtyWorktreeDigest: 'sha256:' + '9'.repeat(64),
            },
            expectedByActiveWriters: [],
          },
          effectDiagnostics: [],
          allowedControls: [],
        },
      ],
    });
    vi.mocked(client.getRunDetail).mockResolvedValue(terminalView);

    render(
      <OperationsSection
        runsResponse={makeRunsResponse({
          reconcilerRuns: [
            {
              runId: 'run:' + 'a'.repeat(64),
              changeId: 'test-change',
              planningSpaceId: 'planning-space:' + 'b'.repeat(64),
              engine: 'reconciler',
              recordVersion: 5,
              status: 'completed',
              sourceState: 'active',
              terminal: { kind: 'completed', outcome: 'ship_success' },
            },
          ],
        })}
        selector="project:test"
        childNames={['test-change']}
      />,
      container
    );

    // Summary shows terminal marker.
    expect(container.querySelector('[data-testid="ops-summary-terminal"]')).not.toBeNull();

    // Open detail.
    await selectRunAndWait(container);

    // Terminal reason rendered from server projection.
    const terminal = container.querySelector('[data-testid="ops-run-terminal"]');
    expect(terminal).not.toBeNull();
    expect(terminal!.getAttribute('data-terminal-kind')).toBe('completed');
    expect(terminal!.textContent).toContain('ship_success');

    // No actions or waits rendered for a terminal Run.
    expect(container.querySelector('[data-testid="ops-run-actions"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-run-waits"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-run-controls"]')).toBeNull();
  });

  it('renders other-worktree Runs read-only with no controls and no granted actions', async () => {
    // The server sets workspace.scope to 'other', clears allowedControls,
    // and downgrades granted → admitted_undelivered. The UI must render
    // that projection without offering controls.
    const otherView = makeRunView({
      workspace: {
        instanceId: 'workspace-instance:' + 'd'.repeat(64),
        scope: 'other',
      },
      sections: [
        {
          kind: 'root-dag',
          version: 1,
          frontier: ['node:' + 'e'.repeat(64)],
          activeInvocations: [],
          actions: [
            {
              format: 'change-run-action-view/1',
              kind: 'agent',
              actionId: 'action:' + '2'.repeat(64),
              invocationId: 'invocation:' + 'f'.repeat(64),
              attemptId: 'attempt:' + '1'.repeat(64),
              nodeId: 'node:' + 'e'.repeat(64),
              deliveryState: 'admitted_undelivered',
              capability: {
                id: 'bug-fix',
                contractVersion: '1.0.0',
                contractDigest: 'sha256:' + '3'.repeat(64),
                artifactDigest: 'sha256:' + '4'.repeat(64),
              },
              effects: [],
            },
          ],
          waits: [],
          workspace: {
            current: {
              format: 'workspace-revision/1',
              head: { kind: 'commit', digest: 'sha256:' + '7'.repeat(64), detached: false },
              treeDigest: 'sha256:' + '8'.repeat(64),
              dirtyWorktreeDigest: 'sha256:' + '9'.repeat(64),
            },
            expectedByActiveWriters: [],
          },
          effectDiagnostics: [],
          allowedControls: [],
        },
      ],
    });
    vi.mocked(client.getRunDetail).mockResolvedValue(otherView);

    render(
      <OperationsSection
        runsResponse={makeRunsResponse()}
        selector="project:test"
        childNames={['test-change']}
      />,
      container
    );

    await selectRunAndWait(container);

    // Scope badge shows 'other'.
    const scope = container.querySelector('[data-testid="ops-run-scope"]');
    expect(scope!.textContent).toBe('other');

    // Read-only notice is shown.
    expect(container.querySelector('.ops-run__readonly-notice')).not.toBeNull();

    // No controls section (server cleared allowedControls).
    expect(container.querySelector('[data-testid="ops-run-controls"]')).toBeNull();

    // Action is admitted_undelivered (server downgraded granted → admitted_undelivered).
    const action = container.querySelector('[data-testid="ops-run-action"]');
    expect(action!.getAttribute('data-delivery')).toBe('admitted_undelivered');
  });

  it('shows pagination info when the server reports more Runs', () => {
    const res = makeRunsResponse({
      hasMore: true,
      nextCursor: 'eyJhZnRlclJ1bklkIjoidGVzdCJ9',
    });
    render(
      <OperationsSection runsResponse={res} selector="project:test" childNames={['test-change']} />,
      container
    );
    expect(container.querySelector('[data-testid="operations-pagination"]')).not.toBeNull();
  });

  it('shows an error summary for a corrupt Run (server-reported, not client-derived)', () => {
    const res = makeRunsResponse({
      reconcilerRuns: [
        {
          runId: 'corrupt-dir-name',
          changeId: '',
          planningSpaceId: '',
          engine: 'reconciler',
          recordVersion: -1,
          status: 'unknown',
          sourceState: 'missing',
          error: { code: 'run_store_corrupt', message: 'Record JSON parse failed.' },
        },
      ],
    });
    render(
      <OperationsSection runsResponse={res} selector="project:test" childNames={[]} />,
      container
    );

    // The corrupt run appears under "Other changes" (empty changeId matches no child).
    const errorBadge = container.querySelector('[data-testid="ops-summary-error"]');
    expect(errorBadge).not.toBeNull();
    expect(errorBadge!.textContent).toContain('run_store_corrupt');

    // The select button is disabled for a corrupt Run.
    const button = container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('does NOT map Run terminal state to Board/Issue lifecycle (0.2.0 scope)', () => {
    // This test asserts the NEGATIVE: the Operations section renders terminal
    // Runs as terminal — it does not add board-column or issue-lifecycle
    // mapping. That mapping is explicitly 0.2.0 scope.
    render(
      <OperationsSection
        runsResponse={makeRunsResponse({
          reconcilerRuns: [
            {
              runId: 'run:' + 'a'.repeat(64),
              changeId: 'test-change',
              planningSpaceId: 'planning-space:' + 'b'.repeat(64),
              engine: 'reconciler',
              recordVersion: 5,
              status: 'completed',
              sourceState: 'active',
              terminal: { kind: 'completed', outcome: 'ship_success' },
            },
          ],
        })}
        selector="project:test"
        childNames={['test-change']}
      />,
      container
    );

    const section = container.querySelector('[data-testid="operations-section"]')!;
    // No board-column or issue-lifecycle attributes/classes in the Operations section.
    expect(section.querySelector('[data-column]')).toBeNull();
    expect(section.querySelector('[data-issue-status]')).toBeNull();
    expect(section.querySelector('.board-column')).toBeNull();
  });
});
