// @vitest-environment jsdom
/**
 * Component-level coverage for StoreAggregateBoard (`store-issue-resources`
 * board-ui spec, requirement 1: "A layout v2 Store board groups its changes
 * by project and target line" — the same Change alias under two projects is
 * two board entries, and a group with zero Changes is rendered as an
 * explicit empty group rather than hidden). The `satisfies` fixtures it
 * imports are the `tsc` drift tripwire.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreChanges: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { StoreAggregateBoard } from '../../src/components/StoreAggregateBoard.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { storeChangesFixture } from '../fixtures/store-aggregate.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAtSpace(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <StoreAggregateBoard />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('StoreAggregateBoard', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('renders the same Change alias under two projects as two separate board entries', async () => {
    (client.getStoreChanges as any).mockResolvedValue(storeChangesFixture);
    await mountAtSpace(container, '/s/store_x/board');

    const groups = Array.from(container.querySelectorAll('[data-testid="store-board-group"]'));
    expect(groups.map((g) => `${g.getAttribute('data-project')}::${g.getAttribute('data-target-line')}`)).toEqual([
      'proj_a::main',
      'proj_b::main',
      'proj_a::release-1',
    ]);

    const projA = groups.find((g) => g.getAttribute('data-project') === 'proj_a' && g.getAttribute('data-target-line') === 'main')!;
    const projB = groups.find((g) => g.getAttribute('data-project') === 'proj_b' && g.getAttribute('data-target-line') === 'main')!;
    expect(projA.querySelector('[data-testid="store-board-entry"]')?.getAttribute('data-change')).toBe('add-thing');
    expect(projB.querySelector('[data-testid="store-board-entry"]')?.getAttribute('data-change')).toBe('add-thing');

    expect(client.getStoreChanges).toHaveBeenCalledWith('store:store_x');
  });

  it('shows a group with zero Changes as present-and-empty rather than hiding it', async () => {
    (client.getStoreChanges as any).mockResolvedValue(storeChangesFixture);
    await mountAtSpace(container, '/s/store_x/board');

    const groups = Array.from(container.querySelectorAll('[data-testid="store-board-group"]'));
    const emptyGroup = groups.find(
      (g) => g.getAttribute('data-project') === 'proj_a' && g.getAttribute('data-target-line') === 'release-1'
    )!;
    expect(emptyGroup.querySelector('[data-testid="store-board-group-empty"]')).not.toBeNull();
    expect(emptyGroup.querySelector('[data-testid="store-board-entry"]')).toBeNull();
  });

  it('shows an explicit empty state when the Store has no groups at all', async () => {
    (client.getStoreChanges as any).mockResolvedValue({ unsearchedRefs: [], complete: true, groups: [] });
    await mountAtSpace(container, '/s/store_x/board');

    expect(container.querySelector('[data-testid="store-board-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="store-board-groups"]')).toBeNull();
  });

  it('shows the server fix hint on a failed load and re-fetches on retry', async () => {
    (client.getStoreChanges as any).mockRejectedValueOnce(
      new ApiError(502, { error: { code: 'store_unreachable', message: 'Store unreachable', fix: 'Check the Store path' } })
    );
    (client.getStoreChanges as any).mockResolvedValueOnce(storeChangesFixture);
    await mountAtSpace(container, '/s/store_x/board');

    const errorBox = container.querySelector('[data-testid="store-board-error"]')!;
    expect(errorBox.textContent).toContain('Store unreachable');
    expect(errorBox.textContent).toContain('Check the Store path');

    const retry = errorBox.querySelector('button')!;
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-testid="store-board-groups"]')).not.toBeNull();
    expect(client.getStoreChanges).toHaveBeenCalledTimes(2);
  });
});
