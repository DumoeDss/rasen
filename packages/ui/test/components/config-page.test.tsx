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
  return {
    ...actual,
    listConfig: vi.fn(),
    putKey: vi.fn(),
    deleteKey: vi.fn(),
    listSpaces: vi.fn(),
    getWorkflowEnablement: vi.fn(),
    listProfiles: vi.fn(),
    mutateWorkflowEnablement: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { ConfigPage } from '../../src/components/ConfigPage.js';
import * as client from '../../src/api/client.js';
import {
  configListFixture,
  configListStoreSpaceFixture,
} from '../fixtures/config-list.js';
import type { ListConfigResponse } from '../../src/api/types.js';

// A project space whose Project tab has a project-scoped key (`schema`), so the
// Local Project tab exists and can host the SpaceProfileSelector.
const configWithProjectKey = {
  ...configListFixture,
  entries: [
    ...configListFixture.entries,
    {
      definition: {
        key: 'schema',
        scopes: ['store', 'project'],
        type: 'string',
        defaultValue: 'spec-driven',
        description: 'The change schema this project uses',
        group: 'Project',
        constraints: { type: 'string' },
      },
      value: 'spec-driven',
      source: 'default',
      scopeValues: {},
    },
  ],
} satisfies ListConfigResponse;

const spacesFixtureForSelector = {
  spaces: [{ type: 'project', id: 'proj_x', name: 'Space A', root: '/home/u/space-a' }],
};
const profilesFixtureForSelector = {
  profiles: [
    { name: 'full', builtIn: true, workflows: [] },
    { name: 'core', builtIn: true, workflows: [] },
    { name: 'my-set', builtIn: false, workflows: [] },
  ],
};

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

  it('addresses the config API with the route space selector and defaults to Global mode', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');

    expect(client.listConfig).toHaveBeenCalledWith('project:proj_x');
    const modeGroup = container.querySelector('[data-testid="config-mode"]')!;
    const localChip = [...modeGroup.querySelectorAll('button')].find((b) => b.textContent === 'Local')!;
    const globalChip = [...modeGroup.querySelectorAll('button')].find((b) => b.textContent === 'Global')!;
    // ui-profile-workflow-split: Config now opens on Global.
    expect(globalChip.getAttribute('aria-pressed')).toBe('true');
    expect(localChip.getAttribute('aria-pressed')).toBe('false');
    // No deferral stub anywhere.
    expect(container.querySelector('[data-testid="config-store-deferred"]')).toBeNull();
  });

  it('never renders the Workflow/Autopilot tabs or their keys; Global still reveals Privacy — no reload', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');

    const tabNames = () => {
      const el = container.querySelector('[data-testid="config-tabs"]');
      return el ? [...el.querySelectorAll('button')].map((b) => b.textContent) : [];
    };
    // The interim Workflow tab is gone; the Autopilot group no longer renders
    // here either — those keys are owned by the Pipelines page.
    expect(tabNames()).not.toContain('Workflow');
    expect(tabNames()).not.toContain('Autopilot');

    await act(async () => {
      clickChip(container, 'Global').click();
      await flushMicrotasks();
    });
    // Global mode reveals the global-scoped, non-excluded keys → Privacy + General.
    expect(tabNames()).toContain('Privacy');
    expect(tabNames()).toContain('General');
    expect(tabNames()).not.toContain('Workflow');
    expect(tabNames()).not.toContain('Autopilot');
    // The excluded keys never render as rows in either mode.
    expect(container.querySelector('[data-key="autopilot.gates"]')).toBeNull();
    expect(container.querySelector('[data-key="handoff.threshold"]')).toBeNull();
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
    // Config opens on Global now; switch to Local to see the store's own
    // store/project keys — `schema` renders under the Project tab.
    await act(async () => {
      clickChip(container, 'Local').click();
      await flushMicrotasks();
    });
    const tabNames = [
      ...container.querySelector('[data-testid="config-tabs"]')!.querySelectorAll('button'),
    ].map((b) => b.textContent);
    expect(tabNames).toContain('Project');
    expect(container.querySelector('[data-key="schema"]')).not.toBeNull();
    // Store spaces never render the project Profile selector.
    expect(container.querySelector('[data-testid="config-profile-selector"]')).toBeNull();
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

describe('ConfigPage SpaceProfileSelector (config-ui-package)', () => {
  let container: HTMLElement;

  async function flush(times = 25): Promise<void> {
    for (let i = 0; i < times; i++) await Promise.resolve();
  }

  // The selector fires two chained effects (resolve root → read enablement),
  // each settling across a separate act cycle; run several so the DOM reflects
  // the fully-loaded state before assertions.
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await flush();
      });
    }
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listConfig as any).mockResolvedValue(configWithProjectKey);
    (client.listSpaces as any).mockResolvedValue(spacesFixtureForSelector);
    (client.listProfiles as any).mockResolvedValue(profilesFixtureForSelector);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
  });

  async function mountLocalProject(): Promise<void> {
    window.history.pushState({}, '', '/p/proj_x/config');
    await act(async () => {
      render(
        <LocationProvider>
          <ConfigPage />
        </LocationProvider>,
        container
      );
    });
    await act(async () => {
      await flush();
    });
    // Config opens on Global — switch to Local to reach the Project tab.
    await act(async () => {
      clickChip(container, 'Local').click();
      await flush();
    });
    await settle();
  }

  async function pick(value: string): Promise<void> {
    const picker = container.querySelector('[data-testid="config-profile-picker"]') as HTMLSelectElement;
    await act(async () => {
      picker.value = value;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    await settle();
  }

  it('renders only in the Local Project tab at a project space (not Global)', async () => {
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'profile', units: [] });
    await mountLocalProject();
    expect(container.querySelector('[data-testid="config-profile-selector"]')).not.toBeNull();

    await act(async () => {
      clickChip(container, 'Global').click();
      await flush();
    });
    expect(container.querySelector('[data-testid="config-profile-selector"]')).toBeNull();
  });

  it('shows the locked profile name from the enablement read', async () => {
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'locked-profile', lockedProfile: 'my-set', units: [] });
    await mountLocalProject();

    expect(container.querySelector('[data-testid="config-profile-mode"]')!.textContent).toContain('my-set');
    expect((container.querySelector('[data-testid="config-profile-picker"]') as HTMLSelectElement).value).toBe('my-set');
    expect(client.getWorkflowEnablement).toHaveBeenCalledWith('/home/u/space-a');
  });

  it('requires explicit confirmation before replacing a space override with a profile', async () => {
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'override', units: [] });
    (client.mutateWorkflowEnablement as any).mockResolvedValue({ mode: 'locked-profile', lockedProfile: 'core', units: [] });
    await mountLocalProject();

    expect(container.querySelector('[data-testid="config-profile-override"]')).not.toBeNull();
    await pick('core');
    // Confirmation first — no mutation yet.
    expect(container.querySelector('[data-testid="config-profile-confirm"]')).not.toBeNull();
    expect(client.mutateWorkflowEnablement).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-testid="config-profile-confirm-yes"]') as HTMLElement).click();
      await flush();
    });
    expect(client.mutateWorkflowEnablement).toHaveBeenCalledWith({ root: '/home/u/space-a', op: 'set-profile', profile: 'core' });
  });

  it('clears the lock when the user picks "Follow global profile"', async () => {
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'locked-profile', lockedProfile: 'core', units: [] });
    (client.mutateWorkflowEnablement as any).mockResolvedValue({ mode: 'profile', units: [] });
    await mountLocalProject();

    await pick('');
    expect(client.mutateWorkflowEnablement).toHaveBeenCalledWith({ root: '/home/u/space-a', op: 'clear-profile' });
    expect(container.querySelector('[data-testid="config-profile-mode"]')!.textContent).toContain('user-wide profile');
  });

  it('lists every saved profile including a broken one, rendered non-selectable', async () => {
    (client.listProfiles as any).mockResolvedValue({
      profiles: [
        { name: 'full', builtIn: true, workflows: [] },
        { name: 'core', builtIn: true, workflows: [] },
        { name: 'my-set', builtIn: false, workflows: [] },
        { name: 'broken', builtIn: false, error: 'Invalid profile definition' },
      ],
    });
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'profile', units: [] });
    await mountLocalProject();

    const options = Array.from(
      container.querySelectorAll('[data-testid="config-profile-picker"] option')
    ) as HTMLOptionElement[];
    const broken = options.find((o) => o.textContent?.includes('broken'));
    expect(broken).toBeTruthy();
    expect(broken!.disabled).toBe(true);
    expect(options.find((o) => o.value === 'my-set')).toBeTruthy();
  });

  it('surfaces an apply failure and keeps the actual post-write state', async () => {
    const { ApiError } = await import('../../src/api/client.js');
    (client.getWorkflowEnablement as any).mockResolvedValue({ mode: 'profile', units: [] });
    const failure = new ApiError(422, { error: { code: 'cli_error', message: 'update failed: disk full' } });
    (failure as any).state = { mode: 'locked-profile', lockedProfile: 'core', units: [] };
    (client.mutateWorkflowEnablement as any).mockRejectedValue(failure);
    await mountLocalProject();

    await pick('core');
    expect(container.querySelector('[data-testid="config-profile-mutate-error"]')!.textContent).toContain('disk full');
    // The selector re-renders from the error's carried post-write state.
    expect(container.querySelector('[data-testid="config-profile-mode"]')!.textContent).toContain('core');
  });
});
