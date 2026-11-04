// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreChangeIssueLinks: vi.fn(),
    getStoreIssueProjections: vi.fn(),
    getStoreIssueProjection: vi.fn(),
    createStoreIssue: vi.fn(),
    publishStoreExecutionPlan: vi.fn(),
  };
});

import * as client from '../../src/api/client.js';
import type {
  StoreChangeIssueLinkEntry,
  StoreChangeIssueLinksResponse,
} from '../../src/api/types.js';
import { UnlinkedChangesPage } from '../../src/components/UnlinkedChangesPage.js';
import { ISSUE_IDENTITIES, issueProjectionsFixture } from '../fixtures/issue-projection.js';

function activeEntry(input: {
  changeId: string;
  instance: string | null;
  project: string;
  line: string;
  association: StoreChangeIssueLinkEntry['association'];
  eligibility: StoreChangeIssueLinkEntry['eligibility'];
}): StoreChangeIssueLinkEntry {
  return {
    occurrence: {
      kind: 'active',
      change: {
        changeId: input.changeId,
        changeInstanceId: input.instance,
        projectId: input.project,
        targetLineId: input.line,
        foundAtRef: `refs/heads/${input.line}`,
        localLocator: null,
      },
    },
    association: input.association,
    eligibility: input.eligibility,
    issues: input.association === 'linked'
      ? [{ identity: ISSUE_IDENTITIES.ready, issueId: ISSUE_IDENTITIES.ready.uid, title: 'Ready Issue', state: 'open', revisionId: '0001', nodeIds: ['node-a'] }]
      : [],
  };
}

const payload = {
  complete: false,
  unsearchedRefs: [{ targetLineId: 'release', storeRef: 'refs/heads/release', reason: 'unreadable' }],
  problems: [{
    kind: 'issue',
    itemId: 'issue-unreadable',
    storeRef: 'refs/heads/main',
    path: 'rasen/issues/issue-unreadable/plans/0001.yaml',
    reason: 'unreadable',
  }],
  entries: [
    activeEntry({
      changeId: 'active-unlinked', instance: 'change-active', project: 'project-a', line: 'main',
      association: 'unlinked', eligibility: 'attachable',
    }),
    {
      occurrence: {
        kind: 'archived',
        change: {
          changeId: 'archived-unlinked',
          changeInstanceId: 'change-archived',
          projectId: 'project-b',
          targetLineId: 'release',
          entryName: '2026-08-24-archived-unlinked--abcdef123456',
          archiveDate: '2026-08-24',
          outcome: 'landed',
          legacyRecord: false,
          foundAtRef: 'refs/heads/release',
        },
      },
      association: 'unlinked',
      eligibility: 'attachable',
      issues: [],
    },
    activeEntry({
      changeId: 'already-linked', instance: 'change-linked', project: 'project-a', line: 'main',
      association: 'linked', eligibility: 'already-linked',
    }),
    activeEntry({
      changeId: 'missing-identity', instance: null, project: 'project-a', line: 'main',
      association: 'unknown', eligibility: 'identity-missing',
    }),
    activeEntry({
      changeId: 'ambiguous-identity', instance: 'change-ambiguous', project: 'project-b', line: 'main',
      association: 'unknown', eligibility: 'identity-ambiguous',
    }),
    activeEntry({
      changeId: 'incomplete-evidence', instance: 'change-incomplete', project: 'project-c', line: 'main',
      association: 'unknown', eligibility: 'evidence-incomplete',
    }),
  ],
} satisfies StoreChangeIssueLinksResponse;

async function flush(times = 16): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function mount(container: HTMLElement): Promise<void> {
  window.history.pushState({}, '', '/s/store_x/unlinked-changes');
  await act(async () => {
    render(<LocationProvider><UnlinkedChangesPage /></LocationProvider>, container);
    await flush();
  });
  await act(async () => { await flush(); });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await flush();
  });
}

async function inputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

function RoutedUnlinkedChanges() {
  const { route } = useLocation();
  return (
    <>
      <button data-testid="route-store-b" onClick={() => route('/s/store_b/unlinked-changes')}>
        route store B
      </button>
      <Router>{[
        <Route path="/s/:storeId/unlinked-changes" component={UnlinkedChangesPage} />
      ]}</Router>
    </>
  );
}

describe('UnlinkedChangesPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.getStoreChangeIssueLinks).mockResolvedValue(payload);
    vi.mocked(client.getStoreIssueProjections).mockResolvedValue(issueProjectionsFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders active/archive Change facts, excludes linked rows from attachable groups, and disables every unknown reason', async () => {
    await mount(container);

    expect(client.getStoreChangeIssueLinks).toHaveBeenCalledWith('store:store_x');
    expect(client.getStoreIssueProjections).toHaveBeenCalledWith('store:store_x', 'open');
    const attachable = container.querySelector('.unlinked-page__attachable')!;
    expect(attachable.textContent).toContain('active-unlinked');
    expect(attachable.textContent).toContain('archived-unlinked');
    expect(attachable.textContent).toContain('2026-08-24-archived-unlinked--abcdef123456');
    expect(attachable.textContent).not.toContain('already-linked');
    expect(attachable.querySelectorAll('[data-testid="unlinked-change-row"]')).toHaveLength(2);
    expect(attachable.querySelectorAll('button')).toHaveLength(4);

    const unknown = [...container.querySelectorAll('[data-association="unknown"]')];
    expect(unknown).toHaveLength(3);
    expect(unknown.flatMap(row => [...row.querySelectorAll('button')])).toHaveLength(0);
    expect(container.textContent).toContain('identity-missing');
    expect(container.textContent).toContain('identity-ambiguous');
    expect(container.textContent).toContain('evidence-incomplete');
    expect(container.textContent).toContain('Some Store evidence is incomplete.');

    // A bare Change never borrows the Issue projection's title or status axes.
    expect(attachable.textContent).not.toContain('Ready Issue');
    expect(attachable.textContent).not.toContain('healthy');
    expect(attachable.textContent).not.toContain('progress');
  });

  it('keeps project filtering mount-local and opens actions only from provably unlinked rows', async () => {
    await mount(container);
    await click([...container.querySelectorAll('.member-chip')].find(button => button.textContent === 'project-b')!);
    expect(container.querySelector('.unlinked-page__attachable')?.textContent).toContain('archived-unlinked');
    expect(container.querySelector('.unlinked-page__attachable')?.textContent).not.toContain('active-unlinked');
    expect(localStorage.getItem('rasen.unlinked.project')).toBeNull();

    const attach = [...container.querySelectorAll('.unlinked-page__attachable button')]
      .find(button => button.textContent === 'Attach to Issue')!;
    await click(attach);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('archived-unlinked');
    expect(container.querySelector('[role="dialog"] button[aria-pressed="true"]')?.textContent).toBe('Attach to Issue');
  });

  it('explicit refresh re-reads both link and open-Issue truth', async () => {
    await mount(container);
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh')!);
    expect(client.getStoreChangeIssueLinks).toHaveBeenCalledTimes(2);
    expect(client.getStoreIssueProjections).toHaveBeenCalledTimes(2);
  });

  it('retires a confirmed Store A dialog and its unresolved write preflight on a same-component route to Store B', async () => {
    const storeAEntry = activeEntry({
      changeId: 'store-a-change', instance: 'store-a-instance', project: 'shared-project', line: 'main',
      association: 'unlinked', eligibility: 'attachable',
    });
    const storeBEntry = activeEntry({
      changeId: 'store-b-change', instance: 'store-b-instance', project: 'shared-project', line: 'main',
      association: 'unlinked', eligibility: 'attachable',
    });
    const storeAPayload: StoreChangeIssueLinksResponse = {
      complete: true, unsearchedRefs: [], problems: [], entries: [storeAEntry],
    };
    const storeBPayload: StoreChangeIssueLinksResponse = {
      complete: true, unsearchedRefs: [], problems: [], entries: [storeBEntry],
    };
    let resolveStoreAPreflight!: (value: StoreChangeIssueLinksResponse) => void;
    const storeAPreflight = new Promise<StoreChangeIssueLinksResponse>(resolve => {
      resolveStoreAPreflight = resolve;
    });
    let storeAReads = 0;
    vi.mocked(client.getStoreChangeIssueLinks).mockImplementation(currentSelector => {
      if (currentSelector === 'store:store_b') return Promise.resolve(storeBPayload);
      storeAReads += 1;
      return storeAReads === 1 ? Promise.resolve(storeAPayload) : storeAPreflight;
    });

    window.history.pushState({}, '', '/s/store_a/unlinked-changes');
    await act(async () => {
      render(<LocationProvider><RoutedUnlinkedChanges /></LocationProvider>, container);
      await flush();
    });
    await act(async () => { await flush(); });

    const create = [...container.querySelectorAll('.unlinked-page__attachable button')]
      .find(button => button.textContent === 'Create Issue')!;
    await click(create);
    const authored = [...container.querySelectorAll('.link-change-dialog__form input')] as HTMLInputElement[];
    expect(authored).toHaveLength(1);
    await inputValue(authored[0]!, 'Store A intent');
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Preview')!);
    expect(container.querySelector('[data-testid="unlinked-confirmation"]')).not.toBeNull();

    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Confirm and write')!);
    expect(storeAReads).toBe(2);
    expect(client.createStoreIssue).not.toHaveBeenCalled();

    await click(container.querySelector('[data-testid="route-store-b"]')!);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await flush(32);
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('store-a-change');

    resolveStoreAPreflight(storeAPayload);
    await act(async () => { await flush(32); });

    expect(container.textContent).toContain('store-b-change');
    expect(container.textContent).not.toContain('store-a-change');
    expect(client.createStoreIssue).not.toHaveBeenCalled();
    expect(client.publishStoreExecutionPlan).not.toHaveBeenCalled();
    expect(client.getStoreChangeIssueLinks).toHaveBeenCalledWith('store:store_b');
  });
});
