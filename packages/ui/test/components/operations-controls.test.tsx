// @vitest-environment jsdom
/**
 * Control-submit render coverage for OperationsSection (task 14.5/14.6 of
 * `ecp-run-spine`). These tests RENDER the component and drive REAL
 * interactions — click a control button, flush the two-phase act pipeline,
 * and assert on the submitted body, the in-flight disable, the conflict
 * refetch, cancel confirmation, and the no-optimistic-mutation invariant.
 *
 * The HTTP client is mocked (legitimate). What would be illegitimate (per the
 * audit verdict + Wave 3 finding) is asserting on `postRunControl` request
 * objects with no UI component rendered — every assertion here is driven
 * through the rendered `<OperationsSection>`.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getRunDetail: vi.fn(),
    postRunControl: vi.fn(),
  };
});

import { OperationsSection } from '../../src/components/OperationsSection.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type {
  AllowedControl,
  ChangeRunView,
  RunControlResponseBody,
  RunsResponse,
} from '../../src/api/types.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Click + flush in two phases (planning-context Wave 3 finding). */
async function clickAndWait(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click();
    await flushMicrotasks();
  });
  await act(async () => {
    await flushMicrotasks(12);
  });
}

const RUN_ID = 'run:' + 'a'.repeat(64);
const WAIT_ID = 'wait:' + '5'.repeat(64);
const DECISION_WAIT_ID = 'wait:' + 'd'.repeat(64);

/** A waiting Run with decision + resume + escalate + cancel + accept-ws controls. */
function makeRunView(overrides: Partial<ChangeRunView> = {}): ChangeRunView {
  const allowedControls: AllowedControl[] = [
    { kind: 'decision', waitId: DECISION_WAIT_ID, decisionId: 'approve', outcomes: ['approve', 'reject'] },
    { kind: 'resume', waitId: WAIT_ID },
    { kind: 'escalate' },
    { kind: 'cancel' },
    {
      kind: 'accept-workspace-revision',
      waitId: 'wait:' + 'w'.repeat(64),
      revision: {
        format: 'workspace-revision/1',
        head: { kind: 'commit', digest: 'sha256:' + '1'.repeat(64), detached: false },
        treeDigest: 'sha256:' + '2'.repeat(64),
        dirtyWorktreeDigest: 'sha256:' + '3'.repeat(64),
      },
    },
  ];
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: RUN_ID,
    change: {
      planningSpaceId: 'planning-space:' + 'b'.repeat(64),
      projectId: 'test-project',
      changeId: 'test-change',
      instanceId: 'change-instance:' + 'c'.repeat(64),
    },
    recordVersion: 7,
    status: 'waiting',
    sourceState: 'active',
    workspace: { instanceId: 'workspace-instance:' + 'd'.repeat(64), scope: 'current' },
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
        actions: [],
        waits: [
          {
            waitId: DECISION_WAIT_ID,
            kind: 'gate',
            nodeId: 'node:gate1',
            invocationId: 'invocation:' + 'f'.repeat(64),
            occurrence: 1,
            gateId: 'gate-1',
            decisionIds: ['approve'],
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
        allowedControls,
      },
    ],
    ...overrides,
  };
}

/** A RunsResponse with one reconciler summary for `test-change`. */
function makeRunsResponse(): RunsResponse {
  return {
    runs: [],
    reconcilerRuns: [
      {
        runId: RUN_ID,
        changeId: 'test-change',
        planningSpaceId: 'planning-space:' + 'b'.repeat(64),
        engine: 'reconciler',
        recordVersion: 7,
        status: 'waiting',
        sourceState: 'active',
        waits: 1,
      },
    ],
    hasMore: false,
  };
}

/** A committed view the server returns after applying a control (recordVersion advanced). */
function makePostControlView(recordVersion = 8): ChangeRunView {
  return makeRunView({
    recordVersion,
    status: 'running',
    sections: [
      {
        kind: 'root-dag',
        version: 1,
        frontier: ['node:' + 'e'.repeat(64)],
        activeInvocations: [],
        actions: [],
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
}

async function selectRunAndWait(container: HTMLElement): Promise<void> {
  const button = container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement;
  await clickAndWait(button);
}

describe('OperationsSection control submit (14.5/14.6)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.getRunDetail).mockResolvedValue(makeRunView());
    vi.mocked(client.postRunControl).mockResolvedValue({
      view: makePostControlView(),
      disposition: 'waiting',
      actions: [],
    });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    // mockReset (not just clearAllMocks) clears the one-shot queue — otherwise
    // a mockRejectedValueOnce from a test that aborted before consuming it
    // leaks into the next test and misroutes its first postRunControl call.
    vi.mocked(client.getRunDetail).mockReset();
    vi.mocked(client.postRunControl).mockReset();
  });

  it('renders one interactive control per submittable allowedControl + a read-only badge for accept-workspace-revision', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // Four submittable controls: decision, resume, escalate, cancel.
    const controls = container.querySelectorAll('[data-testid="ops-control"]');
    expect(controls).toHaveLength(4);
    const kinds = Array.from(controls).map((c) => c.getAttribute('data-control-kind'));
    expect(kinds).toEqual(['decision', 'resume', 'escalate', 'cancel']);

    // accept-workspace-revision renders as a READ-ONLY badge (browser can't produce evidence).
    const badges = container.querySelectorAll('[data-testid="ops-control-badge"]');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute('data-control-kind')).toBe('accept-workspace-revision');

    // Decision offers one outcome button per projected outcome.
    const outcomeButtons = container.querySelectorAll('[data-testid="ops-control-decision-outcome"]');
    expect(outcomeButtons).toHaveLength(2);
    expect(Array.from(outcomeButtons).map((b) => b.getAttribute('data-outcome'))).toEqual(['approve', 'reject']);
  });

  it('does NOT render any arbitrary-completion form (Agent/Command/Host complete stays a trusted CLI seam)', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // No completion form/button exists anywhere in the section.
    expect(container.querySelector('[data-testid="ops-control-complete"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-run-complete-form"]')).toBeNull();
    // The number of submittable controls equals the projected submittable
    // allowedControls — nothing extra is synthesised.
    const projectedSubmittable = 4; // decision + resume + escalate + cancel
    expect(container.querySelectorAll('[data-testid="ops-control"]')).toHaveLength(projectedSubmittable);
  });

  it('submits a decision with the exact recordVersion + waitId + decisionId + outcome', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // Click the "approve" outcome button.
    const approveBtn = container.querySelector('[data-testid="ops-control-decision-outcome"][data-outcome="approve"]') as HTMLButtonElement;
    await clickAndWait(approveBtn);

    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    const [changeId, runId, body, space] = vi.mocked(client.postRunControl).mock.calls[0]!;
    expect(changeId).toBe('test-change');
    expect(runId).toBe(RUN_ID);
    expect(space).toBe('project:test');
    expect(body.control.format).toBe('change-run-control/1');
    expect(body.control.ref.change.changeId).toBe('test-change');
    expect(body.control.ref.runId).toBe(RUN_ID);
    // The displayed recordVersion (7) is submitted — not a stale or derived value.
    expect(body.control.expectedRecordVersion).toBe(7);
    // The exact waitId + decisionId + outcome from the projected control.
    expect(body.control.command).toEqual({
      kind: 'decision',
      waitId: DECISION_WAIT_ID,
      decisionId: 'approve',
      outcome: 'approve',
    });
  });

  it('submits resume with the exact recordVersion + waitId', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    expect(resumeBtn.textContent).toBe('Resume');
    await clickAndWait(resumeBtn);

    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    const [, , body] = vi.mocked(client.postRunControl).mock.calls[0]!;
    expect(body.control.expectedRecordVersion).toBe(7);
    expect(body.control.command).toEqual({ kind: 'resume', waitId: WAIT_ID });
  });

  it('presents a projected retryable infrastructure resume as Retry and submits the exact Wait id', async () => {
    const retryView = makeRunView();
    const root = retryView.sections[0]!;
    if (root.kind !== 'root-dag') throw new Error('fixture root section changed');
    vi.mocked(client.getRunDetail).mockResolvedValueOnce({
      ...retryView,
      sections: [{
        ...root,
        waits: [
          {
            waitId: DECISION_WAIT_ID,
            kind: 'gate',
            nodeId: 'node:gate1',
            invocationId: 'invocation:' + 'f'.repeat(64),
            occurrence: 1,
            gateId: 'gate-1',
            decisionIds: ['approve'],
          },
          {
            waitId: WAIT_ID,
            kind: 'infrastructure',
            nodeId: 'node:retry',
            invocationId: 'invocation:' + 'e'.repeat(64),
            occurrence: 1,
            code: 'provider_unavailable',
            retryable: true,
          },
        ],
      }],
    });
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const retryBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    expect(retryBtn.textContent).toBe('Retry');
    await clickAndWait(retryBtn);
    const [, , body] = vi.mocked(client.postRunControl).mock.calls[0]!;
    expect(body.control.expectedRecordVersion).toBe(7);
    expect(body.control.command).toEqual({ kind: 'resume', waitId: WAIT_ID });
  });

  it('submits escalate with the entered reason (schema requires min 1 char)', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // The escalate submit is disabled until a reason is entered.
    const escalateBtnBefore = container.querySelector('[data-testid="ops-control-escalate-submit"]') as HTMLButtonElement;
    expect(escalateBtnBefore.disabled).toBe(true);

    // Type a reason.
    const input = container.querySelector('[data-testid="ops-control-escalate-reason"]') as HTMLInputElement;
    await act(async () => {
      input.value = 'manual escalation — stakeholder override';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Now the submit is enabled.
    const escalateBtnAfter = container.querySelector('[data-testid="ops-control-escalate-submit"]') as HTMLButtonElement;
    expect(escalateBtnAfter.disabled).toBe(false);

    await clickAndWait(escalateBtnAfter);

    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    const [, , body] = vi.mocked(client.postRunControl).mock.calls[0]!;
    expect(body.control.command).toEqual({
      kind: 'escalate',
      reason: 'manual escalation — stakeholder override',
    });
  });

  it('cancel requires confirmation — first click does NOT submit, confirm click does', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const cancelBtn = container.querySelector('[data-testid="ops-control-cancel-submit"]') as HTMLButtonElement;
    expect(cancelBtn.textContent).toBe('Stop Run');
    await clickAndWait(cancelBtn);

    // No submit yet — the first click only reveals the confirmation prompt.
    expect(client.postRunControl).not.toHaveBeenCalled();

    // The confirmation prompt is now visible.
    const confirmBtn = container.querySelector('[data-testid="ops-control-cancel-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn.textContent).toBe('Confirm stop');

    await clickAndWait(confirmBtn);

    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    const [, , body] = vi.mocked(client.postRunControl).mock.calls[0]!;
    expect(body.control.command).toEqual({ kind: 'cancel' });
  });

  it('cancel dismiss returns to the initial state without submitting', async () => {
    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const cancelBtn = container.querySelector('[data-testid="ops-control-cancel-submit"]') as HTMLButtonElement;
    await clickAndWait(cancelBtn);

    const dismissBtn = container.querySelector('[data-testid="ops-control-cancel-dismiss"]') as HTMLButtonElement;
    await clickAndWait(dismissBtn);

    expect(client.postRunControl).not.toHaveBeenCalled();
    // Confirm prompt hidden again.
    expect(container.querySelector('[data-testid="ops-control-cancel-confirm"]')).toBeNull();
    // The cancel button itself is still present.
    expect(container.querySelector('[data-testid="ops-control-cancel-submit"]')).not.toBeNull();
  });

  it('disables every control while a submit is in flight (duplicate suppression)', async () => {
    // Controllable promise: hold the submit open until we resolve it.
    let resolveSubmit: (v: RunControlResponseBody) => void = () => {};
    vi.mocked(client.postRunControl).mockReturnValue(
      new Promise<RunControlResponseBody>((resolve) => {
        resolveSubmit = resolve;
      })
    );

    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // All submit-targets initially enabled.
    const allSubmits = () => container.querySelectorAll('[data-testid^="ops-control-"][data-testid$="-submit"], [data-testid="ops-control-decision-outcome"]');
    const enabledBefore = Array.from(allSubmits()).filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabledBefore.length).toBeGreaterThan(0);

    // Click resume and flush only the in-flight scheduling (don't resolve).
    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    await act(async () => {
      resumeBtn.click();
      await flushMicrotasks(2);
    });

    // Every interactive submit target is now disabled.
    const disabledInFlight = Array.from(allSubmits()).filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabledInFlight.length).toBe(allSubmits().length);

    // postRunControl was called exactly once — the duplicate click path is suppressed.
    expect(client.postRunControl).toHaveBeenCalledTimes(1);

    // Resolve and let the view replace settle.
    resolveSubmit({ view: makePostControlView(), disposition: 'waiting', actions: [] });
    await act(async () => {
      await flushMicrotasks(12);
    });
  });

  it('NEVER optimistically mutates the local view — the rendered recordVersion stays at the displayed value until the response arrives', async () => {
    let resolveSubmit: (v: RunControlResponseBody) => void = () => {};
    vi.mocked(client.postRunControl).mockReturnValue(
      new Promise<RunControlResponseBody>((resolve) => {
        resolveSubmit = resolve;
      })
    );

    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    // The displayed recordVersion before any submit.
    const metaBefore = container.querySelector('.ops-run__meta')!;
    expect(metaBefore.textContent).toContain('v7');

    // Submit (held in flight).
    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    await act(async () => {
      resumeBtn.click();
      await flushMicrotasks(2);
    });

    // While in flight, the rendered recordVersion is STILL 7 — no optimistic patch.
    const metaDuring = container.querySelector('.ops-run__meta')!;
    expect(metaDuring.textContent).toContain('v7');
    expect(metaDuring.textContent).not.toContain('v8');

    // Resolve — the committed view (v8) replaces the local view.
    resolveSubmit({ view: makePostControlView(8), disposition: 'advanced', actions: [] });
    await act(async () => {
      await flushMicrotasks(12);
    });

    const metaAfter = container.querySelector('.ops-run__meta')!;
    expect(metaAfter.textContent).toContain('v8');
  });

  it('on a 409 record_version_conflict, refetches committed truth via getRunDetail and re-renders (never optimistically patches)', async () => {
    // The conflict response body the server returns.
    vi.mocked(client.postRunControl).mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'record_version_conflict',
          message: 'expectedRecordVersion 7 does not match the current Record version 9.',
        },
      })
    );
    // The initial detail fetch returns the original view (v7, with controls);
    // the conflict refetch returns the updated committed view (v9, no controls).
    // mockResolvedValueOnce is FIFO — the first call consumes the first entry.
    vi.mocked(client.getRunDetail)
      .mockResolvedValueOnce(makeRunView())
      .mockResolvedValueOnce(makePostControlView(9));

    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    await clickAndWait(resumeBtn);

    // postRunControl was attempted; on conflict, getRunDetail was refetched.
    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    expect(client.getRunDetail).toHaveBeenCalledTimes(2);
    expect(client.getRunDetail).toHaveBeenLastCalledWith('test-change', RUN_ID, 'project:test');

    // The rendered view is the refetched committed truth (v9), not a local patch.
    const meta = container.querySelector('.ops-run__meta')!;
    expect(meta.textContent).toContain('v9');

    // No error is shown — the conflict was resolved by the refetch.
    expect(container.querySelector('[data-testid="ops-control-error"]')).toBeNull();
  });

  it('on a 403 workspace-scope-mismatch, shows the server error inline and does not crash', async () => {
    vi.mocked(client.postRunControl).mockRejectedValueOnce(
      new ApiError(403, {
        error: {
          code: 'workspace-scope-mismatch',
          message: 'Run belongs to a different workspace. Control is rejected from this workspace.',
        },
      })
    );

    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    await clickAndWait(resumeBtn);

    const error = container.querySelector('[data-testid="ops-control-error"]');
    expect(error).not.toBeNull();
    expect(error!.getAttribute('data-error-code')).toBe('workspace-scope-mismatch');
    expect(error!.textContent).toContain('different workspace');

    // The view is unchanged (no optimistic mutation, no refetch on 403).
    const meta = container.querySelector('.ops-run__meta')!;
    expect(meta.textContent).toContain('v7');

    // Controls are interactive again (in-flight cleared).
    const resumeBtnAfter = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    expect(resumeBtnAfter.disabled).toBe(false);
  });

  it('on a 409 run_terminal, shows the error inline (does NOT treat as a version conflict refetch)', async () => {
    vi.mocked(client.postRunControl).mockRejectedValueOnce(
      new ApiError(409, {
        error: { code: 'run_terminal', message: 'Run is terminal (completed). No control is accepted.' },
      })
    );

    render(
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    const resumeBtn = container.querySelector('[data-testid="ops-control-resume-submit"]') as HTMLButtonElement;
    await clickAndWait(resumeBtn);

    // A terminal-state 409 is NOT a version conflict — no refetch.
    expect(client.getRunDetail).toHaveBeenCalledTimes(1); // only the initial detail fetch

    const error = container.querySelector('[data-testid="ops-control-error"]');
    expect(error).not.toBeNull();
    expect(error!.getAttribute('data-error-code')).toBe('run_terminal');
  });

  it('renders no controls for an other-workspace Run (server-projected allowedControls is empty)', async () => {
    const otherView = makeRunView({
      workspace: { instanceId: 'workspace-instance:' + 'd'.repeat(64), scope: 'other' },
      sections: [
        {
          kind: 'root-dag',
          version: 1,
          frontier: [],
          activeInvocations: [],
          actions: [],
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
      <OperationsSection runsResponse={makeRunsResponse()} selector="project:test" childNames={['test-change']} />,
      container
    );
    await selectRunAndWait(container);

    expect(container.querySelector('[data-testid="ops-control"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-control-badge"]')).toBeNull();
    // The controls section is absent when the server projects no allowedControls
    // (same conditional as actions/waits — terminal/other-worktree Runs).
    expect(container.querySelector('[data-testid="ops-run-controls"]')).toBeNull();
  });
});
