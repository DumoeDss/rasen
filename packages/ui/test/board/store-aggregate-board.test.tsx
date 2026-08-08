// @vitest-environment jsdom
/**
 * `store-scoped-issues-management` task 10.10 — the Store aggregate board test.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    storeProjects: vi.fn(),
    storeChanges: vi.fn(),
  };
});

import { StoreAggregateBoard } from '../../src/components/StoreAggregateBoard.js';
import * as client from '../../src/api/client.js';
import type {
  StoreProjectRollupResponse,
  StoreAggregateChangesResponse,
} from '../../src/api/types.js';

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function waitForState(
  check: () => void,
  { timeoutMs = 2000 }: { timeoutMs?: number } = {}
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    try { check(); return; } catch (e) { lastError = e; }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForState timed out: ${lastError instanceof Error ? lastError.message : ''}`);
    }
    await act(async () => { await flushMicrotasks(); });
  }
}

async function mount(container: HTMLElement, storeUid: string): Promise<void> {
  await act(async () => { render(<StoreAggregateBoard storeUid={storeUid} />, container); });
  await act(async () => { await flushMicrotasks(); });
}

const STORE_UID = 'test-uid-abc123';

const rollupFixture: StoreProjectRollupResponse = {
  storeId: 'team-store',
  storeUid: STORE_UID,
  projects: [
    { projectId: 'elftia', targetLines: ['line-0.2'], activeChangeCount: 1, archivedChangeCount: 0, roles: null, diagnostic: null },
    { projectId: 'rocut', targetLines: ['main'], activeChangeCount: 0, archivedChangeCount: 1, roles: null, diagnostic: null },
  ],
  targetLines: [
    { targetLineId: 'line-0.2', storeRef: 'refs/heads/release/0.2', projects: ['elftia'], activeChangeCount: 1, archivedChangeCount: 0, diagnostic: null },
    { targetLineId: 'main', storeRef: 'refs/heads/main', projects: ['rocut'], activeChangeCount: 0, archivedChangeCount: 1, diagnostic: null },
  ],
  unsearchedRefs: [],
  complete: true,
};

const changesFixture: StoreAggregateChangesResponse = {
  groups: [
    {
      projectId: 'elftia', targetLineId: 'line-0.2',
      active: [{ changeId: 'telemetry-emit', changeInstanceId: 'ci_abc123', projectId: 'elftia', targetLineId: 'line-0.2', foundAtRef: 'refs/heads/release/0.2', localLocator: null }],
      archived: [],
    },
  ],
  unsearchedRefs: [],
  complete: true,
};

describe('StoreAggregateBoard', () => {
  beforeEach(() => {
    vi.mocked(client.storeProjects).mockResolvedValue(rollupFixture);
    vi.mocked(client.storeChanges).mockResolvedValue(changesFixture);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the project rollup and addresses the Store by UID', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const options = container.querySelectorAll('select[aria-label="Project"] option');
      expect(options.length).toBe(3);
    });

    expect(client.storeProjects).toHaveBeenCalledWith(STORE_UID);
    const board = container.querySelector('.store-aggregate-board');
    expect(board).not.toBeNull();
  });

  it('disables the create button until a project AND target line are chosen', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const btn = container.querySelector('[data-testid="create-change-btn"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('shows the incomplete-result banner when complete is false', async () => {
    vi.mocked(client.storeChanges).mockResolvedValue({
      groups: [{ projectId: 'elftia', targetLineId: 'line-0.2', active: [], archived: [] }],
      unsearchedRefs: [{ storeRef: 'refs/heads/main', targetLineId: 'main', reason: 'does not resolve' }],
      complete: false,
    });

    const container = document.createElement('div');
    await mount(container, STORE_UID);

    // Wait for the project selector to appear.
    await waitForState(() => {
      const sel = container.querySelector('select[aria-label="Project"]');
      expect(sel).not.toBeNull();
    });

    // Select a project.
    await act(async () => {
      const projectSelect = container.querySelector('select[aria-label="Project"]') as HTMLSelectElement;
      projectSelect.value = 'elftia';
      projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flushMicrotasks();
    });

    // Wait for the target-line selector to become enabled, then select a line.
    await waitForState(() => {
      const lineSelect = container.querySelector('select[aria-label="Target line"]') as HTMLSelectElement;
      expect(lineSelect.disabled).toBe(false);
    });

    await act(async () => {
      const lineSelect = container.querySelector('select[aria-label="Target line"]') as HTMLSelectElement;
      lineSelect.value = 'line-0.2';
      lineSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await flushMicrotasks();
    });

    // Wait for the incomplete banner to appear.
    await waitForState(() => {
      const banner = container.querySelector('[data-testid="incomplete-banner"]');
      expect(banner).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="incomplete-banner"]')?.textContent).toContain('INCOMPLETE');
  });
});
