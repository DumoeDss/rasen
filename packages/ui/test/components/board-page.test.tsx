// @vitest-environment jsdom
/**
 * Component-level coverage for BoardPage (design.md D7/board-ui spec):
 * column grouping renders per fixture data, and the loading / empty / error
 * states are each distinct (no placeholder/fabricated changes).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listChanges: vi.fn(),
    listRuns: vi.fn(),
  };
});

import { BoardPage } from '../../src/components/BoardPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { changesListFixture } from '../fixtures/changes-list.js';
import { runsListFixture } from '../fixtures/runs-list.js';

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mount(container: HTMLElement) {
  await act(async () => {
    render(<BoardPage />, container);
  });
  // Flush the microtask queue so the mounted useEffect's Promise.all(...).then/.finally
  // chain settles, then let preact re-render with the resulting state update.
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('BoardPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('groups changes into lifecycle columns matching deriveColumn', async () => {
    (client.listChanges as any).mockResolvedValue(changesListFixture);
    (client.listRuns as any).mockResolvedValue(runsListFixture);

    await mount(container);

    const columns = container.querySelectorAll('.board-column');
    expect(columns).toHaveLength(4);

    const cardNames = (col: Element) =>
      Array.from(col.querySelectorAll('.board-card__name')).map((n) => n.textContent);

    expect(cardNames(columns[0]!)).toEqual(['planning-change']); // Planning
    expect(cardNames(columns[1]!)).toEqual(['ready-change']); // Ready
    expect(cardNames(columns[2]!)).toEqual(['in-progress-change']); // In Progress
    expect(cardNames(columns[3]!)).toEqual(['done-change']); // Done

    // The escalated run stage on in-progress-change renders as a badge, not a column.
    const escalatedBadge = columns[2]!.querySelector('.board-card__badge--escalated');
    expect(escalatedBadge).not.toBeNull();
  });

  it('shows an explicit empty state, not a blank page, when there are no active changes', async () => {
    (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__empty')).not.toBeNull();
    expect(container.querySelector('.board')).toBeNull();
    expect(container.textContent).toContain('No active changes');
  });

  it('renders a visibly broken card for a change the server could not read, instead of dropping it silently (review round 1 M2)', async () => {
    (client.listChanges as any).mockResolvedValue({
      changes: [changesListFixture.changes[1]!], // ready-change, still renders normally
      errors: [{ name: 'broken-change', message: "Schema 'does-not-exist' not found." }],
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    // Not the empty state — there is something to show, even though it's broken.
    expect(container.querySelector('.board-page__empty')).toBeNull();
    const broken = container.querySelector('.board-card--broken');
    expect(broken).not.toBeNull();
    expect(broken!.textContent).toContain('broken-change');
    expect(broken!.textContent).toContain('does-not-exist');
    // The healthy change still renders in its column alongside the broken card.
    expect(container.querySelector('.board')).not.toBeNull();
    expect(container.textContent).toContain('ready-change');
  });

  it('shows the broken-card list even when it is the only content (no successful changes at all)', async () => {
    (client.listChanges as any).mockResolvedValue({
      changes: [],
      errors: [{ name: 'broken-change', message: 'boom' }],
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__empty')).toBeNull();
    expect(container.querySelector('.board-card--broken')).not.toBeNull();
    expect(container.querySelector('.board')).toBeNull(); // no columns to show
  });

  it('shows an error state (not partial/stale content) on a non-auth fetch failure', async () => {
    (client.listChanges as any).mockRejectedValue(new ApiError(500, { error: { code: 'internal_error', message: 'boom' } }));
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__error')).not.toBeNull();
    expect(container.textContent).toContain('boom');
  });
});
