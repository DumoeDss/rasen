// @vitest-environment jsdom
/**
 * SpaceSwitcher (management-ui-shell design D3): a dual-namespace control fed
 * by GET /api/v1/spaces — two type-tagged groups, the current route's space
 * selected, navigation as its only effect, no "no space" option, and an
 * explicit hint when the listing is empty.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  listSpaces: vi.fn(),
  getKey: vi.fn(),
}));

import { SpaceSwitcher } from '../../src/components/SpaceSwitcher.js';
import * as client from '../../src/api/client.js';

const SPACES = {
  spaces: [
    { type: 'project', id: 'proj_a', name: 'Project A', root: '/a' },
    { type: 'project', id: 'proj_b', name: 'Project B', root: '/b' },
    { type: 'store', id: 'store_x', name: 'Store X', root: '/x', members: [] },
  ],
};

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, path: string) {
  window.history.replaceState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <SpaceSwitcher />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('SpaceSwitcher', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Recency lives in localStorage; clear it so ordering is deterministic.
    localStorage.clear();
    (client.getKey as any).mockResolvedValue({ entry: { value: [] } });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders projects and stores as two type-tagged groups with the current route space selected', async () => {
    (client.listSpaces as any).mockResolvedValue(SPACES);
    await mountAt(container, '/p/proj_a/board');

    const groups = container.querySelectorAll('optgroup');
    const labels = Array.from(groups).map((g) => g.getAttribute('label'));
    expect(labels).toEqual(['Projects', 'Stores']);

    const projectGroup = Array.from(groups).find((g) => g.getAttribute('label') === 'Projects')!;
    expect(Array.from(projectGroup.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Project A',
      'Project B',
    ]);

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('project:proj_a');
  });

  it('offers no "no space" / global-only option', async () => {
    (client.listSpaces as any).mockResolvedValue(SPACES);
    await mountAt(container, '/p/proj_a/board');
    const optionTexts = Array.from(container.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionTexts).not.toContain('No project (global only)');
    // At a resolved space there is no empty-value placeholder either.
    expect(container.querySelector('option[value=""]')).toBeNull();
  });

  it('selecting a space navigates to that space route for the current section (its only effect)', async () => {
    (client.listSpaces as any).mockResolvedValue(SPACES);
    await mountAt(container, '/p/proj_a/config');

    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'store:store_x';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await flushMicrotasks();
    });

    // Re-scoped to the store, staying on the same section.
    expect(window.location.pathname).toBe('/s/store_x/config');
  });

  it('shows a hint instead of an empty selectable control when no spaces are registered', async () => {
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
    await mountAt(container, '/');
    expect(container.querySelector('[data-testid="space-switcher-empty"]')).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).toContain('rasen ui');
  });

  // 12 project spaces, well past the cap of 8.
  const MANY = {
    spaces: Array.from({ length: 12 }, (_, i) => {
      const id = `proj-${String(i + 1).padStart(2, '0')}`;
      return { type: 'project', id, name: id, root: `/${id}` };
    }),
  };

  function spaceOptions(select: HTMLSelectElement): HTMLOptionElement[] {
    return Array.from(select.querySelectorAll('option')).filter((o) => o.value !== '__all__' && o.value !== '');
  }

  it('caps the switcher at 8 space entries even with far more spaces registered', async () => {
    (client.listSpaces as any).mockResolvedValue(MANY);
    await mountAt(container, '/p/proj-01/board');
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(spaceOptions(select).length).toBe(8);
    // The escape hatch is always present.
    expect(container.querySelector('[data-testid="space-switcher-all"]')).not.toBeNull();
  });

  it('includes a pinned space even when it would otherwise fall outside the cap', async () => {
    (client.listSpaces as any).mockResolvedValue(MANY);
    (client.getKey as any).mockResolvedValue({ entry: { value: ['project:proj-12'] } });
    await mountAt(container, '/p/proj-01/board');
    const select = container.querySelector('select') as HTMLSelectElement;
    const values = spaceOptions(select).map((o) => o.value);
    expect(values).toContain('project:proj-12'); // pinned → included
    expect(values.length).toBe(8);
    // A non-pinned alphabetically-late space was cut to make room.
    expect(values).not.toContain('project:proj-11');
  });

  it('always includes the current space even when it is outside the cap', async () => {
    (client.listSpaces as any).mockResolvedValue(MANY);
    await mountAt(container, '/p/proj-12/board');
    const select = container.querySelector('select') as HTMLSelectElement;
    const values = spaceOptions(select).map((o) => o.value);
    expect(values).toContain('project:proj-12');
    expect(select.value).toBe('project:proj-12');
  });

  it('routes to /spaces via "All spaces…" without changing the current space', async () => {
    (client.listSpaces as any).mockResolvedValue(SPACES);
    await mountAt(container, '/p/proj_a/config');

    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '__all__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(window.location.pathname).toBe('/spaces');
  });
});
