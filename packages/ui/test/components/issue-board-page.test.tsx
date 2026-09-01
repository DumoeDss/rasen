// @vitest-environment jsdom
/**
 * Component coverage for the Issue Board (issue-board-ui spec requirements
 * 1, 2, 3, and 5).
 *
 * The spine of this file is TRACEABILITY: every assertion compares what the DOM
 * shows against the corresponding field of the mocked payload, because the
 * spec's completion-evidence line is "every displayed axis, count, label, and
 * item equals the corresponding payload field's value". A test that asserted a
 * hard-coded string would pass just as happily against a Board that invented
 * the value.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    createStoreIssue: vi.fn(),
    getStoreIssueProjections: vi.fn(),
    getStoreIssueAttention: vi.fn(),
    getStoreProjects: vi.fn(),
  };
});

import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { IssueBoardPage } from '../../src/components/IssueBoardPage.js';
import * as client from '../../src/api/client.js';
import type { StoreIssueIdentity } from '../../src/api/types.js';
import {
  ISSUE_IDENTITIES,
  issueAttentionFixture,
  issueProjectionsFixture,
} from '../fixtures/issue-projection.js';

const CREATED_IDENTITY = {
  uid: '20000000-0000-4000-8000-000000000001',
  key: 'ISS-0000000000000010',
  slug: null,
  aliases: [],
} as const;

const SECOND_CREATED_IDENTITY = {
  uid: '20000000-0000-4000-8000-000000000003',
  key: 'ISS-0000000000000012',
  slug: null,
  aliases: [],
} as const;

function createdResponse(
  identity: StoreIssueIdentity = CREATED_IDENTITY,
  title = '修复登录超时'
) {
  return {
    identity,
    issueId: identity.uid,
    storeId: 'store_x',
    storeUid: 'store-uid',
    record: {
      version: 2 as const,
      identity,
      title,
      state: 'open' as const,
      reason: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    },
  };
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAtSpace(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <IssueBoardPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function cardsInLane(container: HTMLElement, phase: string): HTMLElement[] {
  const lane = container.querySelector(`[data-testid="issue-lane"][data-phase="${phase}"]`);
  return [...(lane?.querySelectorAll('[data-testid="issue-card"]') ?? [])] as HTMLElement[];
}

function cardFor(container: HTMLElement, issueId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="issue-card"][data-issue="${issueId}"]`);
}

function RoutedIssueBoard() {
  const { route } = useLocation();
  return (
    <>
      <button data-testid="route-store-b" onClick={() => route('/s/store_b/issues')}>route Store B</button>
      <Router>{[<Route path="/s/:storeId/issues" component={IssueBoardPage} />]}</Router>
    </>
  );
}

describe('IssueBoardPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.getStoreIssueProjections as any).mockResolvedValue(issueProjectionsFixture);
    (client.getStoreIssueAttention as any).mockResolvedValue(issueAttentionFixture);
    (client.createStoreIssue as any).mockResolvedValue(createdResponse());
    (client.getStoreProjects as any).mockResolvedValue({
      storeId: 'store_x',
      storeUid: 'store-uid',
      projects: [
        {
          projectId: 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7',
          roles: { planning: true, knowledge: true },
          diagnostic: null,
          targetLines: ['line-0.2'],
          activeChangeCount: 0,
          archivedChangeCount: 2,
        },
        {
          projectId: '11111111-2222-3333-4444-555555555555',
          roles: { planning: false, knowledge: true },
          diagnostic: null,
          targetLines: ['line-0.1'],
          activeChangeCount: 1,
          archivedChangeCount: 0,
        },
        {
          projectId: 'member-without-issue-lane',
          roles: { planning: false, knowledge: true },
          diagnostic: null,
          targetLines: [],
          activeChangeCount: 0,
          archivedChangeCount: 0,
        },
      ],
      complete: true,
      unsearchedRefs: [],
      problems: [],
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('places every card in the lane its projected phase names, and renders all five lanes', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    const lanes = [...container.querySelectorAll('[data-testid="issue-lane"]')].map((lane) =>
      lane.getAttribute('data-phase')
    );
    expect(lanes).toEqual(['planning', 'ready', 'active', 'review', 'done']);

    // Traceability: the lane an Issue's card sits in equals its payload phase,
    // for every Issue in the payload — and it appears in exactly one lane.
    for (const entry of issueProjectionsFixture.issues) {
      expect(cardsInLane(container, entry.status.phase).map((card) => card.getAttribute('data-issue'))).toContain(
        entry.identity?.uid ?? entry.issueId
      );
      expect(container.querySelectorAll(`[data-testid="issue-card"][data-issue="${entry.identity?.uid ?? entry.issueId}"]`)).toHaveLength(1);
    }
  });

  it('offers no raw project Change creation form on the Store Issue Board', async () => {
    await mountAtSpace(container, '/s/store_x/issues');
    expect(container.querySelector('.new-change-dialog')).toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'New change')).toBe(false);
  });

  it('creates a Store Issue from a non-ASCII title only, presents its server identity, and refreshes server truth', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    const create = container.querySelector('[data-testid="issue-board-create"]') as HTMLButtonElement;
    expect(create).not.toBeNull();
    await act(async () => {
      create.click();
    });

    const dialog = container.querySelector('[data-testid="new-issue-dialog"]') as HTMLFormElement;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('input[name="issueId"]')).toBeNull();
    const title = dialog.querySelector('input[name="title"]') as HTMLInputElement;
    await act(async () => {
      title.value = '修复登录超时';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await act(async () => {
      dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks(20);
    });

    expect(client.createStoreIssue).toHaveBeenCalledWith(
      { title: '修复登录超时' },
      'store:store_x'
    );
    expect(container.querySelector('[data-testid="new-issue-dialog"]')).toBeNull();
    const created = container.querySelector('[data-testid="issue-board-created"] a');
    expect(created?.textContent).toBe(CREATED_IDENTITY.key);
    expect(created?.getAttribute('href')).toBe(`/s/store_x/issues/${CREATED_IDENTITY.uid}`);
    expect(client.getStoreIssueProjections).toHaveBeenCalledTimes(2);
    expect(client.getStoreIssueAttention).toHaveBeenCalledTimes(2);
    expect(client.getStoreProjects).toHaveBeenCalledTimes(2);
  });

  it('submits repeated titles unchanged and trusts each distinct server-assigned identity', async () => {
    (client.createStoreIssue as any)
      .mockResolvedValueOnce(createdResponse(CREATED_IDENTITY, 'Repeated title'))
      .mockResolvedValueOnce(createdResponse(SECOND_CREATED_IDENTITY, 'Repeated title'));
    await mountAtSpace(container, '/s/store_x/issues');

    for (const expected of [CREATED_IDENTITY, SECOND_CREATED_IDENTITY]) {
      await act(async () => {
        (container.querySelector('[data-testid="issue-board-create"]') as HTMLButtonElement).click();
      });
      const dialog = container.querySelector('[data-testid="new-issue-dialog"]') as HTMLFormElement;
      expect(dialog.querySelector('input[name="issueId"]')).toBeNull();
      const title = dialog.querySelector('input[name="title"]') as HTMLInputElement;
      await act(async () => {
        title.value = 'Repeated title';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushMicrotasks(30);
      });
      await act(async () => { await flushMicrotasks(30); });
      const created = container.querySelector('[data-testid="issue-board-created"] a');
      expect(created?.textContent).toBe(expected.key);
      expect(created?.getAttribute('href')).toBe(`/s/store_x/issues/${expected.uid}`);
    }

    expect((client.createStoreIssue as any).mock.calls).toEqual([
      [{ title: 'Repeated title' }, 'store:store_x'],
      [{ title: 'Repeated title' }, 'store:store_x'],
    ]);
  });

  it('renders all five empty lanes when the Store has no Issues', async () => {
    (client.getStoreIssueProjections as any).mockResolvedValue({
      ...issueProjectionsFixture,
      issues: [],
      complete: true,
      unsearchedRefs: [],
      problems: [],
    });
    (client.getStoreIssueAttention as any).mockResolvedValue({
      ...issueAttentionFixture,
      scannedCount: 0,
      scanned: [],
      items: [],
      counts: {
        failure: 0,
        'blocked-behind': 0,
        'waiting-human': 0,
        'acceptance-awaiting': 0,
        problem: 0,
      },
      total: 0,
      unsearchedRefs: [],
      complete: true,
    });

    await mountAtSpace(container, '/s/store_x/issues');

    expect(container.querySelector('[data-testid="issue-board-empty"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('[data-testid="issue-lane"]')].map((lane) =>
        lane.getAttribute('data-phase')
      )
    ).toEqual(['planning', 'ready', 'active', 'review', 'done']);
    expect(container.querySelectorAll('[data-testid="issue-card"]')).toHaveLength(0);
  });

  it('presents phase, health, and progress as three separate facts equal to their payload fields', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    const active = issueProjectionsFixture.issues.find((entry) => entry.identity?.uid === ISSUE_IDENTITIES.active.uid)!;
    const card = cardFor(container, ISSUE_IDENTITIES.active.uid)!;
    // Phase: the lane placement, and the card's own recorded phase.
    expect(card.getAttribute('data-phase')).toBe(active.status.phase);
    // Health: its own indicator, not folded into the lane.
    expect(card.getAttribute('data-health')).toBe(active.status.health);
    expect(card.querySelector('[data-testid="issue-card-health"]')?.textContent).toBe('failed');
    // Progress: the completed-over-total pair, verbatim.
    expect(card.querySelector('[data-testid="issue-card-progress"]')?.textContent).toBe(
      `${active.status.progress!.completed}/${active.status.progress!.total}`
    );

    // An Issue with no readable revision reports no pair rather than 0/0.
    const planningCard = cardFor(container, 'issue-planning')!;
    expect(planningCard.querySelector('[data-testid="issue-card-progress"]')?.textContent).toBe('-/-');

    const readyCard = cardFor(container, ISSUE_IDENTITIES.ready.uid)!;
    expect(readyCard.querySelector('.issue-card__title')?.textContent).toBe('Ready Issue');
    expect(readyCard.querySelector('.issue-card__id')?.textContent).toBe(ISSUE_IDENTITIES.ready.key);
  });

  it('shows the first item in the scan`s own ordering and no others, and nothing when there are none', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    // The scan's items are already fail-first ordered; `issue-active` has two
    // and the card must show only the FIRST — showing the second would be the
    // Board choosing its own ranking.
    const attentions = cardFor(container, ISSUE_IDENTITIES.active.uid)!.querySelectorAll(
      '[data-testid="issue-card-attention"]'
    );
    expect(attentions).toHaveLength(1);
    const firstForActive = issueAttentionFixture.items.find((item) => item.issueId === ISSUE_IDENTITIES.active.uid)!;
    expect(attentions[0]!.textContent).toContain(firstForActive.nodeId!);
    expect(attentions[0]!.textContent).toContain('failure');
    // The second item's node must NOT appear on the card.
    expect(attentions[0]!.textContent).not.toContain('n2b');

    // An Issue the scan reported no items for shows no attention line at all.
    expect(
      cardFor(container, ISSUE_IDENTITIES.auto.uid)!.querySelector('[data-testid="issue-card-attention"]')
    ).toBeNull();
  });

  it('keeps the card a summary — no Changes, nodes, or threads listed on it', async () => {
    await mountAtSpace(container, '/s/store_x/issues');
    // The Done Issue's projection carries two named nodes, a project lane, a
    // delivery rollup, and a review thread. None of that belongs on a card
    // (spec requirement 1) — it is the Detail's surface.
    const card = cardFor(container, ISSUE_IDENTITIES.auto.uid)!;
    for (const nodeId of ['issue-autodecompose-graph', 'issue-autodecompose-review-flow']) {
      expect(card.textContent).not.toContain(nodeId);
    }
    expect(card.textContent).not.toContain('evidence-missing');
    expect(card.querySelectorAll('li')).toHaveLength(0);
  });

  it('keeps an unreadable or divergent Issue on the board, carrying the reported reason', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    const unreadable = cardFor(container, 'issue-planning')!;
    // Not dropped, and not given a fabricated title: the id stands in.
    expect(unreadable.querySelector('.issue-card__title')?.textContent).toBe('issue-planning');
    expect(unreadable.querySelector('[data-testid="issue-card-unreadable"]')?.textContent).toContain(
      'record does not parse'
    );

    expect(cardFor(container, ISSUE_IDENTITIES.review.uid)!.querySelector('[data-testid="issue-card-divergent"]')).not.toBeNull();
    expect(cardFor(container, ISSUE_IDENTITIES.ready.uid)!.querySelector('[data-testid="issue-card-uncommitted"]')).not.toBeNull();
  });

  it('announces every incompleteness fact the payloads report', async () => {
    const attentionOnlyRef = {
      targetLineId: 'attention-only-line',
      storeRef: 'refs/heads/attention-only',
      reason: 'attention scan could not search this ref',
    };
    (client.getStoreIssueAttention as any).mockResolvedValue({
      ...issueAttentionFixture,
      unsearchedRefs: [attentionOnlyRef],
    });
    await mountAtSpace(container, '/s/store_x/issues');

    const notices = container.querySelector('[data-testid="issue-board-notices"]')!;
    expect(notices.querySelector('[data-testid="issue-board-incomplete"]')).not.toBeNull();
    expect(notices.querySelector('[data-testid="issue-board-problem"]')?.textContent).toContain(
      issueProjectionsFixture.problems[0]!.reason
    );
    const unsearched = [...notices.querySelectorAll('[data-testid="issue-board-unsearched"]')]
      .map((notice) => notice.textContent)
      .join('\n');
    expect(unsearched).toContain(issueProjectionsFixture.unsearchedRefs[0]!.storeRef);
    expect(unsearched).toContain(attentionOnlyRef.storeRef);
  });

  it('discloses run-state visibility, both when an execution root was in scope and when none was', async () => {
    await mountAtSpace(container, '/s/store_x/issues');
    expect(container.querySelector('[data-testid="issue-board-run-state"]')?.textContent).toContain(
      'E:\\repos\\rasen'
    );

    // A payload in which no read saw an execution root must say so rather than
    // omit the fact (design D4: honest degradation, disclosed).
    const blind = {
      ...issueProjectionsFixture,
      issues: issueProjectionsFixture.issues.map((entry) => ({
        ...entry,
        status: { ...entry.status, runStateVisibility: { kind: 'none' as const } },
      })),
    };
    (client.getStoreIssueProjections as any).mockResolvedValue(blind);
    const second = document.createElement('div');
    document.body.appendChild(second);
    await mountAtSpace(second, '/s/store_x/issues');
    expect(second.querySelector('[data-testid="issue-board-run-state-none"]')).not.toBeNull();
    expect(second.querySelector('[data-testid="issue-board-run-state"]')).toBeNull();
    document.body.removeChild(second);
  });

  it('filters with member chips without repartitioning the lanes', async () => {
    await mountAtSpace(container, '/s/store_x/issues');

    // The roster comes from the Store catalog; lanes only supply aliases.
    const chipLabels = [...container.querySelectorAll('.member-chip')].map((chip) => chip.textContent);
    expect(chipLabels).toContain('rasen');
    expect(chipLabels).toContain('11111111-2222-3333-4444-555555555555');
    expect(chipLabels).toContain('member-without-issue-lane');

    const beforeLanes = [...container.querySelectorAll('[data-testid="issue-lane"]')].map((lane) =>
      lane.getAttribute('data-phase')
    );

    const rasenChip = [...container.querySelectorAll('.member-chip')].find(
      (chip) => chip.textContent === 'rasen'
    ) as HTMLButtonElement;
    await act(async () => {
      rasenChip.click();
      await flushMicrotasks();
    });

    // Only cards whose projection carries a lane for that project remain...
    const visible = [...container.querySelectorAll('[data-testid="issue-card"]')].map((card) =>
      card.getAttribute('data-issue')
    );
    expect(visible).toContain(ISSUE_IDENTITIES.ready.uid);
    expect(visible).toContain(ISSUE_IDENTITIES.review.uid);
    expect(visible).not.toContain(ISSUE_IDENTITIES.active.uid);
    // ...each still in its own phase lane, and the lanes themselves unchanged.
    expect(cardsInLane(container, 'ready').map((card) => card.getAttribute('data-issue'))).toEqual([
      ISSUE_IDENTITIES.ready.uid,
    ]);
    expect(
      [...container.querySelectorAll('[data-testid="issue-lane"]')].map((lane) => lane.getAttribute('data-phase'))
    ).toEqual(beforeLanes);
  });

  it('offers a Store member with no Issue lane and filters to an empty five-lane board', async () => {
    await mountAtSpace(container, '/s/store_x/issues');
    const memberChip = [...container.querySelectorAll('.member-chip')].find(
      (chip) => chip.textContent === 'member-without-issue-lane'
    ) as HTMLButtonElement;
    expect(memberChip).toBeDefined();

    await act(async () => {
      memberChip.click();
      await flushMicrotasks();
    });

    expect(container.querySelectorAll('[data-testid="issue-card"]')).toHaveLength(0);
    expect(
      [...container.querySelectorAll('[data-testid="issue-lane"]')].map((lane) =>
        lane.getAttribute('data-phase')
      )
    ).toEqual(['planning', 'ready', 'active', 'review', 'done']);
  });

  it('does not offer stale projection lanes as member chips, while keeping their Issues under All', async () => {
    const historicalProjectId = 'historical-project';
    const historicalIssueId = ISSUE_IDENTITIES.active.uid;
    (client.getStoreIssueProjections as any).mockResolvedValue({
      ...issueProjectionsFixture,
      issues: issueProjectionsFixture.issues.map((entry) =>
        entry.issueId === historicalIssueId
          ? {
              ...entry,
              status: {
                ...entry.status,
                projects: [
                  ...entry.status.projects,
                  {
                    projectId: historicalProjectId,
                    alias: null,
                    nodeIds: ['historical-node'],
                    progress: { completed: 1, total: 1 },
                  },
                ],
              },
            }
          : entry
      ),
    });

    await mountAtSpace(container, '/s/store_x/issues');

    const chipLabels = [...container.querySelectorAll('.member-chip')].map((chip) => chip.textContent);
    expect(chipLabels).not.toContain(historicalProjectId);
    expect((container.querySelector('.member-chip') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(cardFor(container, historicalIssueId)).not.toBeNull();
  });

  it('does not persist the chip selection across a remount, and touches no client storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await mountAtSpace(container, '/s/store_x/issues');
    const rasenChip = [...container.querySelectorAll('.member-chip')].find(
      (chip) => chip.textContent === 'rasen'
    ) as HTMLButtonElement;
    await act(async () => {
      rasenChip.click();
      await flushMicrotasks();
    });
    expect(rasenChip.getAttribute('aria-pressed')).toBe('true');

    const revisited = document.createElement('div');
    document.body.appendChild(revisited);
    await mountAtSpace(revisited, '/s/store_x/issues');
    const allChip = revisited.querySelector('.member-chip') as HTMLButtonElement;
    expect(allChip.getAttribute('aria-pressed')).toBe('true');
    expect(
      [...revisited.querySelectorAll('[data-testid="issue-card"]')].map((card) => card.getAttribute('data-issue'))
    ).toHaveLength(issueProjectionsFixture.issues.length);
    document.body.removeChild(revisited);

    // Nothing was persisted, so there is nothing to rebuild.
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('re-derives from the server on refresh, reusing nothing from before', async () => {
    await mountAtSpace(container, '/s/store_x/issues');
    expect((client.getStoreIssueProjections as any).mock.calls).toHaveLength(1);

    // The server's truth changes between the two reads; the refreshed Board
    // must show the NEW fact, which is only possible if it re-fetched.
    (client.getStoreIssueProjections as any).mockResolvedValue({
      ...issueProjectionsFixture,
      issues: issueProjectionsFixture.issues.map((entry) =>
        entry.issueId === ISSUE_IDENTITIES.active.uid
          ? { ...entry, status: { ...entry.status, phase: 'done' as const } }
          : entry
      ),
    });
    const refresh = container.querySelector('[data-testid="issue-board-refresh"]') as HTMLButtonElement;
    await act(async () => {
      refresh.click();
    });
    // The refetch runs through the effect, `Promise.all`, `.then`, `.finally`
    // and a re-render, so the flush is its own `act` pass — the same shape
    // `mountAtSpace` uses.
    await act(async () => {
      await flushMicrotasks(20);
    });

    expect((client.getStoreIssueProjections as any).mock.calls).toHaveLength(2);
    expect((client.getStoreIssueAttention as any).mock.calls).toHaveLength(2);
    expect((client.getStoreProjects as any).mock.calls).toHaveLength(2);
    expect(cardsInLane(container, 'done').map((card) => card.getAttribute('data-issue'))).toContain(
      ISSUE_IDENTITIES.active.uid
    );
    expect(cardsInLane(container, 'active')).toHaveLength(0);
  });

  it('addresses the Store by the route`s opaque selector and links each card to its detail', async () => {
    await mountAtSpace(container, '/s/store%3Aabc/issues');
    expect((client.getStoreIssueProjections as any).mock.calls[0][0]).toBe('store:store:abc');
    expect(cardFor(container, ISSUE_IDENTITIES.ready.uid)?.querySelector('[data-testid="issue-card-main"]')?.getAttribute('href')).toBe(
      `/s/store%3Aabc/issues/${ISSUE_IDENTITIES.ready.uid}`
    );
    expect(cardFor(container, ISSUE_IDENTITIES.ready.uid)?.querySelector('[data-testid="issue-card-phase-evidence"]')?.getAttribute('href')).toBe(
      `/s/store%3Aabc/issues/${ISSUE_IDENTITIES.ready.uid}#issue-provenance-plan`
    );
  });

  it('synchronously replaces Store A ownership before late A reads can commit under Store B', async () => {
    let resolveAProjections!: (value: typeof issueProjectionsFixture) => void;
    let resolveAAttention!: (value: typeof issueAttentionFixture) => void;
    let resolveAProjects!: (value: any) => void;
    const aProjections = new Promise<typeof issueProjectionsFixture>((resolve) => { resolveAProjections = resolve; });
    const aAttention = new Promise<typeof issueAttentionFixture>((resolve) => { resolveAAttention = resolve; });
    const aProjects = new Promise<any>((resolve) => { resolveAProjects = resolve; });
    const bEntry = {
      ...issueProjectionsFixture.issues[0]!,
      identity: {
        uid: '30000000-0000-4000-8000-000000000001',
        key: 'ISS-0000000000000020',
        slug: 'issue-store-b',
        aliases: [{ kind: 'legacy-id' as const, value: 'issue-store-b' }],
      },
      issueId: '30000000-0000-4000-8000-000000000001',
      record: {
        version: 1 as const,
        id: 'issue-store-b',
        title: 'Store B only',
        state: 'open' as const,
        reason: null,
        createdAt: '2026-08-24T00:00:00.000Z',
      },
      diagnostic: null,
    };
    const bProjections = {
      ...issueProjectionsFixture,
      issues: [bEntry],
      problems: [],
      unsearchedRefs: [],
      complete: true,
    };
    const bAttention = {
      ...issueAttentionFixture,
      scannedCount: 1,
      scanned: [],
      items: [],
      counts: { failure: 0, 'blocked-behind': 0, 'waiting-human': 0, 'acceptance-awaiting': 0, problem: 0 },
      total: 0,
      complete: true,
    };
    const bProjects = {
      storeId: 'store_b',
      storeUid: 'uid-b',
      projects: [{ projectId: 'project-b', roles: null, diagnostic: null, targetLines: [], activeChangeCount: 0, archivedChangeCount: 0 }],
      complete: true,
      unsearchedRefs: [],
      problems: [],
    };
    (client.getStoreIssueProjections as any).mockImplementation((selector: string) =>
      selector === 'store:store_x' ? aProjections : Promise.resolve(bProjections)
    );
    (client.getStoreIssueAttention as any).mockImplementation((selector: string) =>
      selector === 'store:store_x' ? aAttention : Promise.resolve(bAttention)
    );
    (client.getStoreProjects as any).mockImplementation((selector: string) =>
      selector === 'store:store_x' ? aProjects : Promise.resolve(bProjects)
    );

    window.history.pushState({}, '', '/s/store_x/issues');
    await act(async () => {
      render(<LocationProvider><RoutedIssueBoard /></LocationProvider>, container);
      await flushMicrotasks();
    });
    await act(async () => {
      (container.querySelector('[data-testid="route-store-b"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushMicrotasks(40);
    });
    expect(container.textContent).toContain('Store B only');
    expect(container.textContent).not.toContain('Ready Issue');
    expect((container.querySelector('.member-chip') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

    resolveAProjections(issueProjectionsFixture);
    resolveAAttention(issueAttentionFixture);
    resolveAProjects({ storeId: 'store_x', storeUid: 'uid-a', projects: [], complete: true, unsearchedRefs: [], problems: [] });
    await act(async () => { await flushMicrotasks(20); });

    expect(container.textContent).toContain('Store B only');
    expect(container.textContent).not.toContain('Ready Issue');
    expect(container.querySelector('[data-testid="issue-board-error"]')).toBeNull();
  });
});
