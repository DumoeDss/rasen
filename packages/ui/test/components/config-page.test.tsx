// @vitest-environment jsdom
/**
 * Page-level coverage for ConfigPage after the W2 redesign: the Global / Local
 * segmented control is both the write target and the visibility filter, keys
 * render in scope-filtered tabs, empty tabs are omitted, and a store space
 * edits its own values (the deferral stub is gone).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, listConfig: vi.fn(), putKey: vi.fn(), deleteKey: vi.fn() };
});
vi.mock('../../src/components/GatesInventoryPanel.js', () => ({
  GatesInventoryPanel: () => <div data-testid="gates-inventory" />,
}));

import { LocationProvider } from 'preact-iso';
import { ConfigPage } from '../../src/components/ConfigPage.js';
import * as client from '../../src/api/client.js';
import {
  configListFixture,
  configListStoreSpaceFixture,
} from '../fixtures/config-list.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, path: string) {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <ConfigPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function clickChip(container: HTMLElement, label: string) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`no chip labelled "${label}"`);
  return btn;
}

describe('ConfigPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('addresses the config API with the route space selector and defaults to Local mode', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');

    expect(client.listConfig).toHaveBeenCalledWith('project:proj_x');
    const modeGroup = container.querySelector('[data-testid="config-mode"]')!;
    const localChip = [...modeGroup.querySelectorAll('button')].find((b) => b.textContent === 'Local')!;
    const globalChip = [...modeGroup.querySelectorAll('button')].find((b) => b.textContent === 'Global')!;
    expect(localChip.getAttribute('aria-pressed')).toBe('true');
    expect(globalChip.getAttribute('aria-pressed')).toBe('false');
    // No deferral stub anywhere.
    expect(container.querySelector('[data-testid="config-store-deferred"]')).toBeNull();
  });

  it('filters tabs by mode: Local hides the global-only Privacy tab; Global reveals it — no reload', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');

    // Default Local mode at a project space: only project-settable keys →
    // Workflow tab only; Privacy (telemetry, global-only) is omitted.
    const tabNames = () =>
      [...container.querySelector('[data-testid="config-tabs"]')!.querySelectorAll('button')].map(
        (b) => b.textContent
      );
    expect(tabNames()).toContain('Workflow');
    expect(tabNames()).not.toContain('Privacy');

    await act(async () => {
      clickChip(container, 'Global').click();
      await flushMicrotasks();
    });
    // Global mode reveals every global-scoped key → Privacy now present.
    expect(tabNames()).toContain('Privacy');
    expect(tabNames()).toContain('General');
    // Re-filter happened without re-fetching.
    expect(client.listConfig).toHaveBeenCalledTimes(1);
  });

  it('shows a tab’s keys and can switch tabs to reveal another group', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');
    await act(async () => {
      clickChip(container, 'Global').click();
      await flushMicrotasks();
    });

    // Switch to Privacy and confirm the telemetry key renders there.
    await act(async () => {
      clickChip(container, 'Privacy').click();
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-key="telemetry.enabled"]')).not.toBeNull();
  });

  it('renders a store space’s own entries (deferral stub gone)', async () => {
    (client.listConfig as any).mockResolvedValue(configListStoreSpaceFixture);
    await mountAt(container, '/s/shared-store/config');

    expect(client.listConfig).toHaveBeenCalledWith('store:shared-store');
    expect(container.querySelector('[data-testid="config-store-deferred"]')).toBeNull();
    // Default Local mode at a store space: the store's own store/project keys
    // are visible — `schema` renders under the Project tab.
    const tabNames = [
      ...container.querySelector('[data-testid="config-tabs"]')!.querySelectorAll('button'),
    ].map((b) => b.textContent);
    expect(tabNames).toContain('Project');
    expect(container.querySelector('[data-key="schema"]')).not.toBeNull();
  });

  it('surfaces a page-level error as a banner above the list', async () => {
    const { ApiError } = await import('../../src/api/client.js');
    (client.listConfig as any).mockRejectedValue(
      new ApiError(404, { error: { code: 'project_not_found', message: 'No such space.' } })
    );
    await mountAt(container, '/p/ghost/config');
    expect(container.querySelector('.config-page__error')?.textContent).toContain('No such space.');
  });
});
