// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider, useLocation } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => [] as string[]);

vi.mock('../../src/api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/client.js')>('../../src/api/client.js');
  return {
    ...actual,
    listSpaces: vi.fn(),
    addProjectToStore: vi.fn(),
    createSpace: vi.fn(),
    listLocalPaths: vi.fn(),
    resolveLocalPath: vi.fn(),
    chooseLocalPath: vi.fn(),
  };
});

vi.mock('../../src/store/space-catalog.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/store/space-catalog.js')>('../../src/store/space-catalog.js');
  return {
    ...actual,
    publishSpace: vi.fn((space: Parameters<typeof actual.publishSpace>[0]) => {
      events.push(`publish:${space.id}`);
      actual.publishSpace(space);
    }),
    refreshSpaceCatalog: vi.fn(() => {
      events.push('refresh');
      return actual.refreshSpaceCatalog();
    }),
  };
});

import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type { StoreSpaceEntry } from '../../src/api/types.js';
import { ProjectIssueOnboardingPage } from '../../src/components/ProjectIssueOnboardingPage.js';
import {
  publishSpace,
  resetSpaceCatalogForTests,
} from '../../src/store/space-catalog.js';

const STORE_A: StoreSpaceEntry = {
  type: 'store',
  id: 'store-a',
  name: 'Store A',
  root: '/stores/a',
  members: [] as Array<{ projectId: string; name: string; root?: string }>,
};
const STORE_B: StoreSpaceEntry = {
  type: 'store',
  id: 'store-b',
  name: 'Store B',
  root: '/stores/b',
  members: [] as Array<{ projectId: string; name: string; root?: string }>,
};
const HOME_LISTING = {
  path: '/home/user',
  parent: null,
  separator: '/',
  home: true,
  entries: [],
};

function memberStore(store: StoreSpaceEntry, projectId: string): StoreSpaceEntry {
  return { ...store, members: [{ projectId, name: projectId, root: `/projects/${projectId}` }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function Harness() {
  const { route } = useLocation();
  return (
    <>
      <button type="button" data-testid="switch-project" onClick={() => route('/p/project-b/issues')}>
        switch
      </button>
      <ProjectIssueOnboardingPage />
    </>
  );
}

async function mount(container: HTMLElement, path = '/p/project-a/issues'): Promise<void> {
  window.history.replaceState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <Harness />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

async function click(element: Element | null): Promise<void> {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
    await flushMicrotasks();
  });
}

function chooseStore(container: HTMLElement, root: string): HTMLInputElement {
  const input = container.querySelector(`input[value="${root}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  input.click();
  return input;
}

describe('ProjectIssueOnboardingPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSpaceCatalogForTests();
    events.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
    (client.listLocalPaths as any).mockResolvedValue(HOME_LISTING);
    (client.resolveLocalPath as any).mockImplementation(async (path: string) => ({
      path,
      kind: 'directory',
      separator: '/',
    }));
    (client.chooseLocalPath as any).mockResolvedValue({ status: 'unavailable', reason: 'headless' });
  });

  afterEach(() => {
    act(() => render(null, container));
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
  });

  it('waits for the entry refresh to settle before deriving zero membership', async () => {
    const listing = deferred<{ spaces: StoreSpaceEntry[] }>();
    (client.listSpaces as any).mockReturnValue(listing.promise);
    await mount(container);
    expect(container.querySelector('[data-testid="onboarding-catalog-loading"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Connect this Project to a Store');

    await act(async () => {
      listing.resolve({ spaces: [STORE_A] });
      await flushMicrotasks();
    });
    expect(container.textContent).toContain('Connect this Project to a Store');
  });

  it('does not route from retained rows after catalog failure and retries successfully', async () => {
    publishSpace(memberStore(STORE_A, 'project-a'));
    events.length = 0;
    (client.listSpaces as any).mockRejectedValueOnce(
      new ApiError(503, { error: { code: 'temporarily_unavailable', message: 'catalog unavailable' } })
    );
    await mount(container);

    expect(window.location.pathname).toBe('/p/project-a/issues');
    expect(container.querySelector('[data-testid="onboarding-catalog-error"]')?.textContent).toContain('catalog unavailable');
    expect(container.querySelector('[data-testid="onboarding-catalog-error"]')?.textContent).toContain('Store A');

    (client.listSpaces as any).mockResolvedValueOnce({ spaces: [memberStore(STORE_A, 'project-a')] });
    await click(container.querySelector('[data-testid="onboarding-catalog-error"] button'));
    expect(window.location.pathname).toBe('/s/store-a/issues');
  });

  it('replace-routes exactly one membership to the canonical Store Issues home', async () => {
    (client.listSpaces as any).mockResolvedValue({ spaces: [memberStore(STORE_A, 'project-a')] });
    const replace = vi.spyOn(window.history, 'replaceState');
    await mount(container);
    expect(window.location.pathname).toBe('/s/store-a/issues');
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  it('matches canonical Project identity while preserving an uppercase route token', async () => {
    const projectId = '8A8B8C8D-1111-4222-8333-444455556666';
    (client.listSpaces as any).mockResolvedValue({
      spaces: [memberStore(STORE_A, projectId.toLowerCase())],
    });

    await mount(container, `/p/${projectId}/issues`);

    expect(window.location.pathname).toBe('/s/store-a/issues');
    expect(client.addProjectToStore).not.toHaveBeenCalled();
  });

  it('requires an explicit choice when the Project belongs to multiple Stores', async () => {
    (client.listSpaces as any).mockResolvedValue({
      spaces: [memberStore(STORE_A, 'project-a'), memberStore(STORE_B, 'project-a')],
    });
    await mount(container);
    expect(window.location.pathname).toBe('/p/project-a/issues');
    const buttons = Array.from(container.querySelectorAll('.project-issues-onboarding__store-action'));
    expect(buttons).toHaveLength(2);
    await click(buttons.find((button) => button.textContent?.includes('Store B')) ?? null);
    expect(window.location.pathname).toBe('/s/store-b/issues');
  });

  it('joins an empty Store with exact ids and orders publish, refresh, then replace navigation', async () => {
    const joined = memberStore(STORE_A, 'project-a');
    (client.listSpaces as any)
      .mockResolvedValueOnce({ spaces: [STORE_A] })
      .mockResolvedValue({ spaces: [joined] });
    (client.addProjectToStore as any).mockImplementation(async (projectId: string, storeId: string) => {
      events.push(`join:${projectId}:${storeId}`);
      return { operation: 'store-add-project', space: joined };
    });
    await mount(container);
    events.length = 0;

    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    const originalReplace = window.history.replaceState.bind(window.history);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
      events.push(`replace:${String(url)}`);
      originalReplace(data, unused, url);
    });
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));

    expect(client.addProjectToStore).toHaveBeenCalledWith('project-a', 'store-a');
    expect(events.slice(0, 4)).toEqual([
      'join:project-a:store-a',
      'publish:store-a',
      'refresh',
      'replace:/s/store-a/issues',
    ]);
    expect(window.location.pathname).toBe('/s/store-a/issues');
    replace.mockRestore();
  });

  it('preserves the exact target after failure and retries only the idempotent membership call', async () => {
    const joined = memberStore(STORE_A, 'project-a');
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A, STORE_B] });
    (client.addProjectToStore as any)
      .mockRejectedValueOnce(new ApiError(409, { error: { code: 'busy', message: 'try again' } }))
      .mockResolvedValueOnce({ operation: 'store-add-project', space: joined });
    await mount(container);
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));

    expect(container.querySelector('[data-testid="onboarding-join-error"]')?.textContent).toContain('try again');
    expect((container.querySelector('input[value="/stores/a"]') as HTMLInputElement).checked).toBe(true);
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));
    expect(client.addProjectToStore).toHaveBeenCalledTimes(2);
    expect(client.addProjectToStore).toHaveBeenNthCalledWith(1, 'project-a', 'store-a');
    expect(client.addProjectToStore).toHaveBeenNthCalledWith(2, 'project-a', 'store-a');
  });

  it('bounds repeated submission to one request while membership is pending', async () => {
    const join = deferred<{ operation: 'store-add-project'; space: StoreSpaceEntry }>();
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A] });
    (client.addProjectToStore as any).mockReturnValue(join.promise);
    await mount(container);
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });

    const submit = container.querySelector('.project-issues-onboarding__actions .btn--primary') as HTMLButtonElement;
    await click(submit);
    expect(submit.disabled).toBe(true);
    await click(submit);
    expect(client.addProjectToStore).toHaveBeenCalledTimes(1);

    await act(async () => {
      join.resolve({ operation: 'store-add-project', space: memberStore(STORE_A, 'project-a') });
      await flushMicrotasks();
    });
  });

  it('uses a newly selected Store after a failed membership attempt', async () => {
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A, STORE_B] });
    (client.addProjectToStore as any)
      .mockRejectedValueOnce(new ApiError(409, { error: { code: 'busy', message: 'first target failed' } }))
      .mockResolvedValueOnce({
        operation: 'store-add-project',
        space: memberStore(STORE_B, 'project-a'),
      });
    await mount(container);
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));
    expect(container.querySelector('[data-testid="onboarding-join-error"]')?.textContent).toContain('first target failed');

    await act(async () => {
      chooseStore(container, '/stores/b');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="onboarding-join-error"]')).toBeNull();
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));

    expect(client.addProjectToStore).toHaveBeenCalledTimes(2);
    expect(client.addProjectToStore).toHaveBeenNthCalledWith(1, 'project-a', 'store-a');
    expect(client.addProjectToStore).toHaveBeenNthCalledWith(2, 'project-a', 'store-b');
    expect(window.location.pathname).toBe('/s/store-b/issues');
  });

  it('recomputes membership when the shared catalog publishes a fresh Store row', async () => {
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A] });
    await mount(container);
    expect(container.textContent).toContain('Connect this Project to a Store');

    await act(async () => {
      publishSpace(memberStore(STORE_A, 'project-a'));
      await flushMicrotasks();
    });

    expect(window.location.pathname).toBe('/s/store-a/issues');
  });

  it('publishes and navigates with the API-returned Store id instead of the selected row id', async () => {
    const returned = memberStore(
      { ...STORE_B, id: 'server-returned-store', name: 'Server Returned Store' },
      'project-a'
    );
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A] });
    (client.addProjectToStore as any).mockImplementation(async (projectId: string, storeId: string) => {
      events.push(`join:${projectId}:${storeId}`);
      return { operation: 'store-add-project', space: returned };
    });
    await mount(container);
    events.length = 0;
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    const originalReplace = window.history.replaceState.bind(window.history);
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
      events.push(`replace:${String(url)}`);
      originalReplace(data, unused, url);
    });

    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));

    expect(client.addProjectToStore).toHaveBeenCalledWith('project-a', 'store-a');
    expect(events.slice(0, 4)).toEqual([
      'join:project-a:store-a',
      'publish:server-returned-store',
      'refresh',
      'replace:/s/server-returned-store/issues',
    ]);
    expect(window.location.pathname).toBe('/s/server-returned-store/issues');
    replace.mockRestore();
  });

  it('keeps a created Store after membership failure and retries without recreating it', async () => {
    const created = { ...STORE_A, id: 'created-store', name: 'Created Store', root: '/home/user/created-store' };
    const joined = memberStore(created, 'project-a');
    (client.listSpaces as any)
      .mockResolvedValueOnce({ spaces: [] })
      .mockRejectedValue(new ApiError(503, { error: { code: 'refresh_failed', message: 'background refresh failed' } }));
    (client.createSpace as any).mockResolvedValue({ operation: 'store-setup', space: created });
    (client.addProjectToStore as any)
      .mockRejectedValueOnce(new ApiError(503, { error: { code: 'busy', message: 'membership pending' } }))
      .mockResolvedValueOnce({ operation: 'store-add-project', space: joined });
    await mount(container);
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create Store') ?? null);
    await act(async () => {
      const input = container.querySelector('input[name="storeId"]') as HTMLInputElement;
      input.value = 'created-store';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));

    expect(container.querySelector('[data-testid="onboarding-partial-success"]')?.textContent).toContain('Created Store');
    expect(container.querySelector('[data-testid="onboarding-join-error"]')?.textContent).toContain('membership pending');
    expect(client.createSpace).toHaveBeenCalledTimes(1);
    expect(client.addProjectToStore).toHaveBeenCalledWith('project-a', 'created-store');

    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));
    expect(client.createSpace).toHaveBeenCalledTimes(1);
    expect(client.addProjectToStore).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/s/created-store/issues');
  });

  it('drops a late catalog result after a Project transition', async () => {
    const oldListing = deferred<{ spaces: StoreSpaceEntry[] }>();
    (client.listSpaces as any)
      .mockReturnValueOnce(oldListing.promise)
      .mockResolvedValueOnce({ spaces: [STORE_B] });
    await mount(container);
    await click(container.querySelector('[data-testid="switch-project"]'));
    expect(window.location.pathname).toBe('/p/project-b/issues');

    await act(async () => {
      oldListing.resolve({ spaces: [memberStore(STORE_A, 'project-a')] });
      await flushMicrotasks();
    });
    expect(window.location.pathname).toBe('/p/project-b/issues');
  });

  it('does not publish or navigate when a late join settles after a Project transition', async () => {
    const join = deferred<{ operation: 'store-add-project'; space: StoreSpaceEntry }>();
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A] });
    (client.addProjectToStore as any).mockReturnValue(join.promise);
    await mount(container);
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));
    await click(container.querySelector('[data-testid="switch-project"]'));
    events.length = 0;

    await act(async () => {
      join.resolve({ operation: 'store-add-project', space: memberStore(STORE_A, 'project-a') });
      await flushMicrotasks();
    });
    expect(events).not.toContain('publish:store-a');
    expect(window.location.pathname).toBe('/p/project-b/issues');
  });

  it('does not publish, join, or navigate when Store creation settles after the keyed child unmounts', async () => {
    const creation = deferred<{ operation: 'store-setup'; space: StoreSpaceEntry }>();
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
    (client.createSpace as any).mockReturnValue(creation.promise);
    await mount(container);
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create Store') ?? null);
    await act(async () => {
      const input = container.querySelector('input[name="storeId"]') as HTMLInputElement;
      input.value = 'store-a';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));
    await click(container.querySelector('[data-testid="switch-project"]'));
    events.length = 0;

    await act(async () => {
      creation.resolve({ operation: 'store-setup', space: STORE_A });
      await flushMicrotasks();
    });
    expect(events).not.toContain('publish:store-a');
    expect(client.addProjectToStore).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/p/project-b/issues');
  });

  it('drops a late membership result after the whole onboarding tree unmounts', async () => {
    const join = deferred<{ operation: 'store-add-project'; space: StoreSpaceEntry }>();
    (client.listSpaces as any).mockResolvedValue({ spaces: [STORE_A] });
    (client.addProjectToStore as any).mockReturnValue(join.promise);
    await mount(container);
    await act(async () => {
      chooseStore(container, '/stores/a');
      await flushMicrotasks();
    });
    await click(container.querySelector('.project-issues-onboarding__actions .btn--primary'));
    act(() => render(null, container));
    events.length = 0;

    await act(async () => {
      join.resolve({ operation: 'store-add-project', space: memberStore(STORE_A, 'project-a') });
      await flushMicrotasks();
    });
    expect(events).not.toContain('publish:store-a');
    expect(window.location.pathname).toBe('/p/project-a/issues');
  });
});
