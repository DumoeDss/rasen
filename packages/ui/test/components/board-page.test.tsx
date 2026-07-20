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
    // createChange is intentionally left as the real implementation (it goes
    // through the single `request()` seam over `fetch`) so the 401 test
    // below exercises the actual markUnauthorized() wiring rather than a
    // hand-rolled stand-in.
  };
});

import { BoardPage } from '../../src/components/BoardPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { onUnauthorized, resetTokenStateForTest } from '../../src/api/token.js';
import { changesListFixture } from '../fixtures/changes-list.js';
import { runsListFixture } from '../fixtures/runs-list.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fillAndSubmitDialog(container: HTMLElement, name: string, description: string) {
  const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
  const descriptionInput = container.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  descriptionInput.value = description;
  descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));
  const form = container.querySelector('.new-change-dialog') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

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

  it('tolerates a server response with no errors field, without crashing the board (review round 2 N2)', async () => {
    // A UI build newer than the serving CLI could talk to a server that
    // predates the `errors[]` field — `changesRes.errors` would be
    // `undefined` on the wire, not `[]`.
    (client.listChanges as any).mockResolvedValue({
      changes: [changesListFixture.changes[1]!], // ready-change
      errors: undefined,
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__error')).toBeNull();
    expect(container.querySelector('.board-card--broken')).toBeNull();
    expect(container.querySelector('.board')).not.toBeNull();
    expect(container.textContent).toContain('ready-change');
  });

  it('shows an error state (not partial/stale content) on a non-auth fetch failure', async () => {
    (client.listChanges as any).mockRejectedValue(new ApiError(500, { error: { code: 'internal_error', message: 'boom' } }));
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__error')).not.toBeNull();
    expect(container.textContent).toContain('boom');
  });

  describe('New change submission (design D4 of platform-slice2-task-submission)', () => {
    beforeEach(() => {
      resetTokenStateForTest();
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('successful submit: form closes, board refetches, and the real new card is highlighted', async () => {
      (client.listChanges as any)
        .mockResolvedValueOnce({ changes: [], errors: [] })
        .mockResolvedValueOnce({
          changes: [
            {
              name: 'submitted-change',
              schemaName: 'spec-driven',
              artifacts: [
                { id: 'proposal', status: 'done' },
                { id: 'design', status: 'ready' },
                { id: 'specs', status: 'blocked' },
                { id: 'tasks', status: 'blocked' },
              ],
              applyReady: false,
              isComplete: false,
              taskProgress: { total: 0, completed: 0 },
              hasRunFiles: false,
            },
          ],
          errors: [],
        });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);
      expect(container.querySelector('.board-page__empty')).not.toBeNull();

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('.new-change-dialog')).not.toBeNull();

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, {
          change: { id: 'submitted-change', path: '/proj/rasen/changes/submitted-change', schema: 'spec-driven' },
        })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'submitted-change', 'A real submission');
        await flushMicrotasks();
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(container.querySelector('.new-change-dialog')).toBeNull();
      expect(container.textContent).toContain('submitted-change');
      const card = Array.from(container.querySelectorAll('.board-card')).find((c) =>
        c.textContent?.includes('submitted-change')
      )!;
      expect(card.classList.contains('board-card--highlighted')).toBe(true);
      expect((client.listChanges as any).mock.calls.length).toBe(2); // initial + post-submit refetch
    });

    it('error path: dialog stays open with input intact and shows the envelope message verbatim', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(422, {
          error: {
            code: 'cli_error',
            message: "Change 'dup-change' already exists at /proj/rasen/changes/dup-change",
            cliExitCode: 1,
            stderr: '',
          },
        })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'dup-change', 'Duplicate attempt');
        await flushMicrotasks();
      });

      expect(container.querySelector('.new-change-dialog')).not.toBeNull();
      expect(container.textContent).toContain("Change 'dup-change' already exists");
      const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
      expect(nameInput.value).toBe('dup-change');
    });

    it('401 during submit triggers the shared re-launch notice mechanism (markUnauthorized)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      const unauthorizedSpy = vi.fn();
      onUnauthorized(unauthorizedSpy);

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' } })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'some-change', 'desc');
        await flushMicrotasks();
      });

      expect(unauthorizedSpy).toHaveBeenCalled();
    });

    it('prevents double submission while a request is in flight', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      let resolveFetch!: (value: Response) => void;
      (fetch as any).mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)));

      await act(async () => {
        fillAndSubmitDialog(container, 'in-flight-change', 'desc');
        await flushMicrotasks();
      });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);

      // A second submit attempt while in flight must not fire a second fetch.
      const form = container.querySelector('.new-change-dialog') as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushMicrotasks();
      });
      expect((fetch as any).mock.calls.length).toBe(1);

      await act(async () => {
        resolveFetch(
          jsonResponse(201, {
            change: { id: 'in-flight-change', path: '/proj/rasen/changes/in-flight-change', schema: 'spec-driven' },
          })
        );
        await flushMicrotasks();
      });
    });
  });
});
