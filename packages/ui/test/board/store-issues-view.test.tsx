// @vitest-environment jsdom
/**
 * `store-scoped-issues-management` task 10.10 — the Store Issues view test.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    storeIssues: vi.fn(),
    storeIssueDetail: vi.fn(),
  };
});

import { StoreIssuesView } from '../../src/components/StoreIssuesView.js';
import * as client from '../../src/api/client.js';
import type {
  StoreIssueListResponse,
  StoreIssueDetailResponse,
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
  await act(async () => { render(<StoreIssuesView storeUid={storeUid} />, container); });
  await act(async () => { await flushMicrotasks(); });
}

const STORE_UID = 'test-uid-xyz789';

const listFixture: StoreIssueListResponse = {
  issues: [
    {
      issueId: 'cross-line-telemetry',
      record: { version: 1, id: 'cross-line-telemetry', title: 'Unify telemetry', state: 'open', reason: null, createdAt: '2026-08-07T00:00:00.000Z' },
      divergence: null, revisionIds: ['0001'], latestRevisionId: '0001', refs: ['refs/heads/main'], uncommitted: false,
    },
    {
      issueId: 'divergent-issue',
      record: null,
      divergence: {
        copies: [
          { storeRef: 'refs/heads/main', targetLineId: 'main', sha256: 'aaa', record: null, diagnostic: null },
          { storeRef: 'refs/heads/release/0.2', targetLineId: 'line-0.2', sha256: 'bbb', record: null, diagnostic: null },
        ],
      },
      revisionIds: [], latestRevisionId: null, refs: ['refs/heads/main', 'refs/heads/release/0.2'], uncommitted: false,
    },
  ],
  unsearchedRefs: [],
  complete: true,
};

const detailFixture: StoreIssueDetailResponse = {
  issue: listFixture.issues[0],
  plan: {
    issueId: 'cross-line-telemetry', revisionId: '0001',
    revision: {
      version: 1, issueId: 'cross-line-telemetry', revisionId: '0001', supersedes: null,
      createdAt: '2026-08-07T00:00:00.000Z', contentSha256: 'deadbeef',
      nodes: [
        { nodeId: 'emit', kind: 'change', projectId: 'elftia', targetLineId: 'line-0.2', changeInstanceId: 'ci_abc', dependsOn: [] },
        { nodeId: 'consume', kind: 'intent', projectId: 'rocut', targetLineId: 'main', summary: 'Consume events', dependsOn: ['emit'] },
      ],
    },
    diagnostic: null,
    readiness: {
      nodes: [
        {
          node: { nodeId: 'emit', kind: 'change', projectId: 'elftia', targetLineId: 'line-0.2', changeInstanceId: 'ci_abc', dependsOn: [] },
          resolution: { status: 'resolved', outcome: null, archived: false, localLocator: null, claimants: [], searchedRefs: [] },
          readiness: 'finalized', blockedBy: [],
        },
        {
          node: { nodeId: 'consume', kind: 'intent', projectId: 'rocut', targetLineId: 'main', summary: 'Consume events', dependsOn: ['emit'] },
          resolution: { status: 'unresolved', outcome: null, archived: false, localLocator: null, claimants: [], searchedRefs: ['refs/heads/main'] },
          readiness: 'unknown', blockedBy: [],
        },
      ],
      readyToResolve: false,
    },
    unsearchedRefs: [], complete: true,
  },
  unsearchedRefs: [], complete: true,
};

describe('StoreIssuesView', () => {
  beforeEach(() => {
    vi.mocked(client.storeIssues).mockResolvedValue(listFixture);
    vi.mocked(client.storeIssueDetail).mockResolvedValue(detailFixture);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('renders the issue list with state', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const entries = container.querySelectorAll('.issue-entry');
      expect(entries.length).toBe(2);
    });
    expect(container.querySelector('.issue-entry')?.getAttribute('data-issue-state')).toBe('open');
  });

  it('shows divergent issues as divergent, not as an empty cell', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const divergent = container.querySelectorAll('.issue-divergent');
      expect(divergent.length).toBe(1);
    });
    expect(container.querySelector('.issue-divergent')?.textContent).toContain('DIVERGENT');
  });

  it('shows node states as themselves (resolved and unresolved)', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const firstIssue = container.querySelector('.issue-entry') as HTMLElement;
      expect(firstIssue).not.toBeNull();
    });

    await act(async () => {
      const firstIssue = container.querySelector('.issue-entry') as HTMLElement;
      firstIssue.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });

    await waitForState(() => {
      const detail = container.querySelector('[data-testid="issue-detail"]');
      expect(detail).not.toBeNull();
    });

    const detail = container.querySelector('[data-testid="issue-detail"]');
    const resolved = detail?.querySelector('.node-resolved');
    expect(resolved).not.toBeNull();
    const unresolved = detail?.querySelector('.node-unresolved');
    expect(unresolved).not.toBeNull();
    expect(unresolved?.textContent).toContain('unresolved');
  });

  it('addresses the Store by UID', async () => {
    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      expect(client.storeIssues).toHaveBeenCalledWith(STORE_UID);
    });
  });

  it('shows the incomplete-result banner when complete is false', async () => {
    vi.mocked(client.storeIssues).mockResolvedValue({
      ...listFixture,
      complete: false,
      unsearchedRefs: [{ storeRef: 'refs/heads/main', targetLineId: 'main', reason: 'does not resolve' }],
    });

    const container = document.createElement('div');
    await mount(container, STORE_UID);

    await waitForState(() => {
      const banner = container.querySelector('[data-testid="issues-incomplete-banner"]');
      expect(banner).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="issues-incomplete-banner"]')?.textContent).toContain('INCOMPLETE');
  });
});
