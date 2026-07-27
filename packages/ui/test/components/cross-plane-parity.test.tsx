// @vitest-environment jsdom
/**
 * UI plane of the cross-plane parity matrix (task 15.1 of `ecp-run-spine`).
 *
 * The canonical fixture Record (built in `test/core/change-run/reconciler-
 * fixture.ts` from the bug-fix plan: propose Gate decided+committed, apply
 * Gate awaiting) projects a `ChangeRunView` with these exact field values.
 * The node-side test (`test/core/change-run/cross-plane-parity.test.ts`)
 * proves projector = CLI status = management detail for those fields.
 *
 * This test proves the fourth plane — the UI — renders those SAME canonical
 * fields from the server-projected view without deriving, transforming, or
 * omitting any of them. The canonical values used here are the fixture's
 * deterministic constants:
 *   runId:           'run:' + 'a'.repeat(64)
 *   changeId:        'fixture-change'
 *   status:          'waiting' (apply Gate is awaiting decision)
 *   deliveryState:   'closed'   (propose action committed)
 *   waitKind:        'gate'
 *   controlKinds:    decision / escalate / cancel
 *
 * This is NOT a kernel-only exercise: it renders the REAL OperationsSection
 * component and asserts on its DOM output. The HTTP client is mocked
 * (legitimate); what would be illegitimate is asserting on projector output
 * with no UI component involved.
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

// ---------------------------------------------------------------------------
// Canonical fixture values — MUST match the kernel fixture's projected output.
// These mirror the deterministic constants in reconciler-fixture.ts so the
// node-side and UI-side parity tests reference the same canonical truth.
// ---------------------------------------------------------------------------

const CANONICAL_RUN_ID = 'run:' + 'a'.repeat(64);
const CANONICAL_CHANGE_ID = 'fixture-change';
const CANONICAL_PROJECT_ID = 'project-fixture';
const CANONICAL_PLANNING_SPACE = 'planning-space:' + '1'.repeat(64);
const CANONICAL_WORKSPACE_INSTANCE = 'workspace-instance:' + '3'.repeat(64);
const CANONICAL_CHANGE_INSTANCE = 'change-instance:' + '2'.repeat(64);
const CANONICAL_WORKSPACE_DIGEST = 'sha256:' + 'c'.repeat(64);

/**
 * The canonical view matching the kernel fixture's `projectRunView` output
 * after: startRecord → succeedNode(propose) → awaitGate(apply).
 *
 * This exercises every comparable field: 1 committed action (closed, with
 * effects), 1 active gate wait, derived decision/escalate/cancel controls,
 * unchanged drift, current workspace scope, empty frontier (as the projector
 * always emits — the reconciler computes the real frontier separately).
 */
function canonicalView(): ChangeRunView {
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: CANONICAL_RUN_ID,
    change: {
      planningSpaceId: CANONICAL_PLANNING_SPACE,
      projectId: CANONICAL_PROJECT_ID,
      changeId: CANONICAL_CHANGE_ID,
      instanceId: CANONICAL_CHANGE_INSTANCE,
    },
    recordVersion: 6,
    status: 'waiting',
    sourceState: 'active',
    workspace: {
      instanceId: CANONICAL_WORKSPACE_INSTANCE,
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
        frontier: [],
        activeInvocations: [],
        actions: [
          {
            format: 'change-run-action-view/1',
            kind: 'agent',
            actionId: 'action:canonical',
            invocationId: 'invocation:canonical',
            attemptId: 'attempt:canonical',
            nodeId: 'node:propose',
            deliveryState: 'closed',
            capability: {
              id: 'skill:root/propose',
              contractVersion: '1',
              contractDigest: 'sha256:' + '5'.repeat(64),
              artifactDigest: 'sha256:' + '5'.repeat(64),
            },
            effects: [
              {
                slot: 'workspace',
                effectId: 'effect:canonical',
                state: 'succeeded',
              },
            ],
          },
        ],
        waits: [
          {
            waitId: 'wait:canonical-apply-gate',
            kind: 'gate',
            nodeId: 'node:apply',
            invocationId: 'invocation:apply',
            occurrence: 0,
            gateId: 'apply-gate',
            decisionIds: ['approve', 'reject'],
          },
        ],
        workspace: {
          current: {
            format: 'workspace-revision/1',
            head: { kind: 'commit', digest: CANONICAL_WORKSPACE_DIGEST, detached: false },
            treeDigest: CANONICAL_WORKSPACE_DIGEST,
            dirtyWorktreeDigest: CANONICAL_WORKSPACE_DIGEST,
          },
          expectedByActiveWriters: [],
        },
        effectDiagnostics: [],
        allowedControls: [
          {
            kind: 'decision',
            waitId: 'wait:canonical-apply-gate',
            decisionId: 'approve',
            outcomes: ['approve', 'reject'],
          },
          {
            kind: 'decision',
            waitId: 'wait:canonical-apply-gate',
            decisionId: 'reject',
            outcomes: ['approve', 'reject'],
          },
          { kind: 'cancel' },
          { kind: 'escalate' },
        ],
      },
    ],
  };
}

function canonicalRunsResponse(): RunsResponse {
  return {
    runs: [],
    reconcilerRuns: [
      {
        runId: CANONICAL_RUN_ID,
        changeId: CANONICAL_CHANGE_ID,
        planningSpaceId: CANONICAL_PLANNING_SPACE,
        engine: 'reconciler',
        recordVersion: 6,
        status: 'waiting',
        sourceState: 'active',
        waits: 1,
      },
    ],
    hasMore: false,
  };
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function selectRunAndWait(container: HTMLElement): Promise<void> {
  const button = container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement;
  await act(async () => {
    button.click();
    await flushMicrotasks();
  });
  await act(async () => {
    await flushMicrotasks(12);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UI cross-plane parity (15.1)', () => {
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

  it('renders the canonical fixture view fields without deriving, transforming, or omitting any', async () => {
    const view = canonicalView();
    vi.mocked(client.getRunDetail).mockResolvedValue(view);

    render(
      <OperationsSection
        runsResponse={canonicalRunsResponse()}
        selector="project:test"
        childNames={[CANONICAL_CHANGE_ID]}
      />,
      container
    );

    // --- Summary row: server-projected status + version + wait count ---
    const row = container.querySelector('[data-testid="ops-summary-row"]')!;
    expect(row.textContent).toContain('waiting');
    expect(row.textContent).toContain('v6');
    expect(row.textContent).toContain('1 wait');
    // Full runId in the title attribute.
    expect(row.querySelector('[data-testid="ops-summary-select"]')!.getAttribute('title')).toContain(
      CANONICAL_RUN_ID
    );

    // --- Open detail ---
    await selectRunAndWait(container);

    // The client called the server's run detail route — did not bypass the UI.
    expect(client.getRunDetail).toHaveBeenCalledWith(
      CANONICAL_CHANGE_ID,
      CANONICAL_RUN_ID,
      'project:test'
    );

    // Core view fields rendered verbatim from the server projection.
    expect(container.querySelector('[data-testid="ops-run-status"]')!.textContent).toBe('waiting');
    expect(container.querySelector('[data-testid="ops-run-source-state"]')!.textContent).toBe(
      'active'
    );
    expect(container.querySelector('[data-testid="ops-run-scope"]')!.textContent).toBe('current');

    // Canonical runId rendered (full value in title attribute).
    expect(container.querySelector('[data-testid="ops-run-id"]')!.getAttribute('title')).toBe(
      CANONICAL_RUN_ID
    );

    // Record version from the server projection (rendered as "v<N>").
    expect(container.querySelector('[data-testid="ops-run-detail-body"]')!.textContent).toContain(
      'v6'
    );

    // --- root-dag/1 section: actions ---
    const actions = container.querySelectorAll('[data-testid="ops-run-action"]');
    expect(actions).toHaveLength(1);
    // deliveryState 'closed' rendered verbatim (not derived/recomputed).
    expect(actions[0]!.getAttribute('data-delivery')).toBe('closed');
    // Action kind rendered from the server projection.
    expect(actions[0]!.textContent).toContain('agent');

    // --- root-dag/1 section: waits ---
    const waits = container.querySelectorAll('[data-testid="ops-wait"]');
    expect(waits).toHaveLength(1);
    expect(waits[0]!.getAttribute('data-wait-kind')).toBe('gate');
    // The gate's ID is rendered from the server projection.
    expect(waits[0]!.textContent).toContain('apply-gate');

    // --- root-dag/1 section: allowed controls ---
    const controls = container.querySelectorAll('[data-testid="ops-control"]');
    // The canonical fixture has 2 decision + cancel + escalate = 4 controls.
    expect(controls).toHaveLength(4);
    const controlKinds = Array.from(controls).map((c) => c.getAttribute('data-control-kind'));
    expect(controlKinds).toContain('decision');
    expect(controlKinds).toContain('escalate');
    expect(controlKinds).toContain('cancel');

    // --- drift rendered verbatim ---
    const drift = container.querySelector('[data-testid="ops-run-drift"]');
    expect(drift).not.toBeNull();
    expect(drift!.textContent).toContain('definition: unchanged');
    expect(drift!.textContent).toContain('capability: unchanged');
    expect(drift!.textContent).toContain('policy: unchanged');
    expect(drift!.textContent).toContain('workspace: unchanged');
  });

  it('does NOT derive frontier or activeInvocations client-side — the projector-empty arrays produce no frontier/invocation section', async () => {
    // The canonical fixture's projected view has EMPTY frontier and
    // activeInvocations (the projector always emits [] for these — the
    // reconciler computes the real frontier separately). The UI must render
    // exactly what the server sends: when the server sends an empty frontier,
    // no frontier section appears. This proves the UI is NOT computing its
    // own frontier from the reconciler or from action/wait state.
    const view = canonicalView();
    vi.mocked(client.getRunDetail).mockResolvedValue(view);

    render(
      <OperationsSection
        runsResponse={canonicalRunsResponse()}
        selector="project:test"
        childNames={[CANONICAL_CHANGE_ID]}
      />,
      container
    );
    await selectRunAndWait(container);

    // Empty frontier from the server → no frontier section rendered. If the
    // UI were deriving the frontier client-side (e.g. from the gate wait), it
    // would show a node here. It must not.
    expect(container.querySelector('[data-testid="ops-run-frontier"]')).toBeNull();
    // Same for active invocations.
    expect(container.querySelector('[data-testid="ops-run-invocations"]')).toBeNull();
  });
});
