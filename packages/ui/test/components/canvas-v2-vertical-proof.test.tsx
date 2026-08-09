// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import type { ChangeRunView, RunsResponse } from '../../src/api/types.js';

interface ManagementCapture {
  readonly format: 'ecp6-vertical-management-capture/1';
  readonly source: Readonly<{
    definitionExport: string;
    generatedBy: string;
  }>;
  readonly views: Readonly<Record<string, ChangeRunView>>;
  readonly runsResponse: RunsResponse;
}

const capturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../rasen/changes/ecp-v2-authoring-loop-vertical-proof/evidence/management-view-capture.json'
);
const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as ManagementCapture;

function root(view: ChangeRunView): any {
  const value = view.sections.find((section) => section.kind === 'root-dag');
  if (value === undefined) throw new Error('root-dag section missing');
  return value;
}

function section(view: ChangeRunView, kind: string): any {
  const value = view.sections.find((candidate) => candidate.kind === kind);
  if (value === undefined) throw new Error(`${kind} section missing`);
  return value;
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function openRun(
  container: HTMLElement,
  view: ChangeRunView
): Promise<void> {
  vi.mocked(client.getRunDetail).mockResolvedValueOnce(view);
  render(
    <OperationsSection
      runsResponse={capture.runsResponse}
      selector="project:ecp6-vertical-project"
      childNames={[
        capture.views['success-terminal']!.change.changeId,
        capture.views['failure-terminal']!.change.changeId,
      ]}
    />,
    container
  );
  const button = container.querySelector(
    `[data-testid="ops-summary-select"][data-run-id="${view.runId}"]`
  ) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => {
    button.click();
    await flush();
  });
  await act(async () => {
    await flush();
  });
}

describe('Operations consumes the real ECP-6 Management capture', () => {
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

  it('renders the captured Run, Action, effect, loop, required-member, Join, wait, and controls verbatim', async () => {
    expect(capture.format).toBe('ecp6-vertical-management-capture/1');
    expect(capture.source).toEqual({
      definitionExport:
        'packages/ui/test/fixtures/canvas-v2-authoring.ts#CANVAS_V2_AUTHORING_DEFINITION',
      generatedBy: 'test/core/change-run/canvas-v2-vertical-proof.test.ts',
    });
    const view = capture.views['success-waiting']!;
    await openRun(container, view);

    expect(container.querySelector('[data-testid="ops-run-id"]')!.getAttribute('title'))
      .toBe(view.runId);
    expect(container.querySelector('[data-testid="ops-run-status"]')!.textContent)
      .toBe(view.status);

    const projectedRoot = root(view);
    const actionRows = Array.from(
      container.querySelectorAll('[data-testid="ops-run-action"]')
    );
    expect(actionRows).toHaveLength(projectedRoot.actions.length);
    projectedRoot.actions.forEach((action: any, index: number) => {
      expect(actionRows[index]!.getAttribute('title')).toContain(action.actionId);
      expect(actionRows[index]!.getAttribute('data-delivery')).toBe(
        action.deliveryState
      );
    });

    const projectedEffects = projectedRoot.actions.flatMap(
      (action: any) => action.effects
    );
    const effectRows = Array.from(
      container.querySelectorAll('[data-testid="ops-run-effect"]')
    );
    expect(effectRows).toHaveLength(projectedEffects.length);
    projectedEffects.forEach((effect: any, index: number) => {
      expect(effectRows[index]!.getAttribute('title')).toContain(effect.effectId);
      expect(effectRows[index]!.getAttribute('data-effect-state')).toBe(
        effect.state
      );
    });

    const loop = section(view, 'bounded-loop-lifecycle');
    const loopPanel = container.querySelector(
      '[data-testid="ops-run-loop-lifecycle"]'
    )!;
    expect(loopPanel.getAttribute('data-state')).toBe(loop.state);
    expect(loopPanel.getAttribute('data-body-kind')).toBe(loop.bodyKind);
    expect(
      container.querySelector('[data-testid="ops-loop-lifecycle-limits"]')!
        .textContent
    ).toContain(`${loop.limits.iterations.used}/${loop.limits.iterations.max}`);

    const parallel = section(view, 'parallel');
    expect(
      container.querySelector('[data-testid="ops-parallel-join-state"]')!
        .textContent
    ).toBe(parallel.joinState);
    const member = container.querySelector(
      '[data-testid="ops-parallel-member"]'
    )!;
    expect(member.getAttribute('title')).toContain(parallel.members[0].path);
    expect(member.getAttribute('data-member-required')).toBe('true');
    expect(member.getAttribute('data-member-status')).toBe(
      parallel.members[0].status
    );

    const wait = projectedRoot.waits[0];
    expect(container.querySelector('[data-testid="ops-wait"]')!.getAttribute('title'))
      .toContain(wait.waitId);
    expect(
      Array.from(container.querySelectorAll('[data-testid="ops-control"]')).some(
        (control) => control.getAttribute('title')?.includes(wait.waitId)
      )
    ).toBe(true);
  });

  it('renders the captured success and required-member failure terminal meanings without deriving them', async () => {
    const success = capture.views['success-terminal']!;
    await openRun(container, success);
    expect(container.querySelector('[data-testid="ops-run-terminal"]')!.getAttribute('data-terminal-kind'))
      .toBe(root(success).terminal.kind);
    expect(container.querySelector('[data-testid="ops-run-terminal"]')!.textContent)
      .toContain(root(success).terminal.outcome);

    render(null, container);
    const failure = capture.views['failure-terminal']!;
    await openRun(container, failure);
    expect(container.querySelector('[data-testid="ops-run-terminal"]')!.getAttribute('data-terminal-kind'))
      .toBe(root(failure).terminal.kind);
    expect(container.querySelector('[data-testid="ops-run-terminal"]')!.textContent)
      .toContain(root(failure).terminal.code);
    const parallel = section(failure, 'parallel');
    expect(container.querySelector('[data-testid="ops-parallel-join-state"]')!.textContent)
      .toBe(parallel.joinState);
    expect(
      Array.from(container.querySelectorAll('[data-testid="ops-parallel-blocker"]')).map(
        (blocker) => blocker.textContent
      )
    ).toEqual(parallel.keyBlockers);
    expect(container.querySelector('[data-testid="ops-parallel-member"]')!.getAttribute('data-member-status'))
      .toBe(parallel.members[0].status);
  });

  it('refetches the captured committed view on a Record-version conflict instead of merging stale state', async () => {
    const stale = capture.views['success-waiting']!;
    const committed = capture.views['success-terminal']!;
    vi.mocked(client.getRunDetail)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(committed);
    vi.mocked(client.postRunControl).mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'record_version_conflict',
          message: 'The captured Record head advanced.',
        },
      })
    );
    render(
      <OperationsSection
        runsResponse={capture.runsResponse}
        selector="project:ecp6-vertical-project"
        childNames={[stale.change.changeId]}
      />,
      container
    );
    const select = container.querySelector(
      `[data-testid="ops-summary-select"][data-run-id="${stale.runId}"]`
    ) as HTMLButtonElement;
    await act(async () => {
      select.click();
      await flush();
    });
    await act(async () => {
      await flush();
    });
    const approve = container.querySelector(
      '[data-testid="ops-control-decision-outcome"][data-outcome="approved"]'
    ) as HTMLButtonElement;
    expect(approve).not.toBeNull();
    await act(async () => {
      approve.click();
      await flush();
    });
    await act(async () => {
      await flush();
    });

    expect(client.postRunControl).toHaveBeenCalledTimes(1);
    expect(client.getRunDetail).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="ops-run-status"]')!.textContent)
      .toBe(committed.status);
    expect(container.querySelector('[data-testid="ops-run-terminal"]')!.getAttribute('data-terminal-kind'))
      .toBe(root(committed).terminal.kind);
    expect(container.querySelector('[data-testid="ops-run-controls"]')).toBeNull();
    expect(container.querySelector('[data-testid="ops-control-error"]')).toBeNull();
  });
});
