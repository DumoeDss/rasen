// @vitest-environment jsdom
/**
 * Component coverage for GatesInventoryPanel (config-page-coherence D6): the
 * read-only gates inventory rendered inside the Autopilot group.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listPipelines: vi.fn(),
  };
});

import { GatesInventoryPanel } from '../../src/components/GatesInventoryPanel.js';
import * as client from '../../src/api/client.js';
import type { ListPipelinesResponse } from '../../src/api/types.js';

const fixture: ListPipelinesResponse = {
  pipelines: [
    {
      name: 'bug-fix',
      description: 'Minimal bug-fix pipeline',
      stages: [
        { id: 'propose', role: 'planner', skill: 'rasen-propose', gate: true },
        { id: 'apply', role: 'implementer', skill: 'rasen-apply-change', gate: false },
      ],
    },
    {
      name: 'goal-loop-measure',
      description: 'Goal-driven iteration',
      stages: [
        { id: 'define-goal', role: 'planner', skill: 'rasen-goal-plan', gate: 'vet' },
        { id: 'ship', role: 'shipper', skill: 'rasen-ship', gate: true },
      ],
    },
  ],
};

describe('GatesInventoryPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.restoreAllMocks();
  });

  it('lists each pipeline and its gated stages, skipping non-gated stages', async () => {
    const listPipelinesMock = client.listPipelines as unknown as ReturnType<typeof vi.fn>;
    listPipelinesMock.mockResolvedValue(fixture);

    await act(async () => {
      render(<GatesInventoryPanel />, container);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-pipeline="bug-fix"]')).not.toBeNull();
    expect(container.querySelector('[data-pipeline="bug-fix"] [data-stage="propose"]')).not.toBeNull();
    // "apply" has gate: false — not listed.
    expect(container.querySelector('[data-pipeline="bug-fix"] [data-stage="apply"]')).toBeNull();
  });

  it('marks a vet gate as always-pausing, distinctly from an ordinary gate', async () => {
    const listPipelinesMock = client.listPipelines as unknown as ReturnType<typeof vi.fn>;
    listPipelinesMock.mockResolvedValue(fixture);

    await act(async () => {
      render(<GatesInventoryPanel />, container);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const vetStage = container.querySelector('[data-stage="define-goal"]');
    expect(vetStage?.className).toContain('gates-inventory__stage--vet');
    expect(vetStage?.textContent).toContain('Always pauses');
    expect(vetStage?.textContent).toContain('cannot be disabled by gates-off');

    const ordinaryStage = container.querySelector('[data-stage="ship"]');
    expect(ordinaryStage?.className).toContain('gates-inventory__stage--gate');
    expect(ordinaryStage?.textContent).not.toContain('Always pauses');
  });

  it('offers no gate-editing control (read-only)', async () => {
    const listPipelinesMock = client.listPipelines as unknown as ReturnType<typeof vi.fn>;
    listPipelinesMock.mockResolvedValue(fixture);

    await act(async () => {
      render(<GatesInventoryPanel />, container);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
