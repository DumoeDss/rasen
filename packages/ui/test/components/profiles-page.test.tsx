// @vitest-environment jsdom
/**
 * Component coverage for the Profiles page (profiles-ui spec): the picker lists
 * built-ins + saved (a broken file flagged), built-ins render read-only with
 * inert switches + a duplicate path, a saved profile's switches edit a draft
 * (dirty → Save posts the draft and re-renders from the server's normalized
 * definition; Discard restores), Create seeds membership from the selection,
 * Delete warns about locked-space fallback, and the nav entry/route render.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listProfiles: vi.fn(),
    listWorkflows: vi.fn(),
    mutateProfile: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { ProfilesPage } from '../../src/components/ProfilesPage.js';
import { Layout } from '../../src/components/Layout.js';
import * as client from '../../src/api/client.js';
import { workflowsListFixture } from '../fixtures/workflows.js';
import type { ProfileListResponse } from '../../src/api/types.js';

const profilesFixture = {
  profiles: [
    { name: 'full', builtIn: true, workflows: ['plan-build', 'team-flow', 'deep-research'] },
    { name: 'core', builtIn: true, workflows: ['plan-build'] },
    { name: 'my-set', builtIn: false, workflows: ['plan-build', 'team-flow'] },
    { name: 'broken', builtIn: false, error: 'Invalid profile definition: workflows must be an array' },
  ],
} satisfies ProfileListResponse;

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mount(container: HTMLElement): Promise<void> {
  window.history.pushState({}, '', '/profiles');
  await act(async () => {
    render(
      <LocationProvider>
        <ProfilesPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

async function clickAndFlush(el: Element | null): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await flushMicrotasks();
  });
}

async function selectProfile(container: HTMLElement, name: string): Promise<void> {
  const picker = container.querySelector('[data-testid="profiles-picker"]') as HTMLSelectElement;
  await act(async () => {
    picker.value = name;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();
  });
}

function setInput(el: Element | null, value: string): void {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ProfilesPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listProfiles as any).mockResolvedValue(profilesFixture);
    (client.listWorkflows as any).mockResolvedValue(workflowsListFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('lists built-in and saved profiles in the picker, flagging a broken one', async () => {
    await mount(container);
    const options = Array.from(container.querySelectorAll('[data-testid="profiles-picker"] option')).map(
      (o) => o.textContent
    );
    expect(options).toContain('full');
    expect(options).toContain('core');
    expect(options).toContain('my-set');
    expect(options.some((o) => o?.includes('broken') && o?.includes('(broken)'))).toBe(true);
  });

  it('renders a built-in read-only: inert switches, no Save, a duplicate path', async () => {
    await mount(container);
    await selectProfile(container, 'full');

    expect(container.querySelector('[data-testid="profiles-readonly-note"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="profile-save"]')).toBeNull();
    expect(container.querySelector('[data-testid="profile-delete"]')).toBeNull();
    expect(container.querySelector('[data-testid="profile-duplicate"]')).not.toBeNull();

    // A member card shows an inert (disabled) switch reflecting membership.
    const planBuild = container.querySelector('[data-id="plan-build"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    expect(planBuild).not.toBeNull();
    expect(planBuild.getAttribute('aria-checked')).toBe('true');
    expect(planBuild.disabled).toBe(true);
  });

  it('edits a saved profile as a draft: toggle → dirty → Save posts the draft and re-renders from the normalized response', async () => {
    // The server re-adds team-flow through closure expansion (design D5): the
    // switch snaps back ON after save even though the draft dropped it.
    (client.mutateProfile as any).mockResolvedValue({
      profile: { name: 'my-set', builtIn: false, workflows: ['plan-build', 'team-flow'] },
    });
    await mount(container);
    await selectProfile(container, 'my-set');

    const teamFlow = container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    expect(teamFlow.getAttribute('aria-checked')).toBe('true');
    expect(teamFlow.disabled).toBe(false);

    // Toggle team-flow OFF → the page marks unsaved changes; the store is unchanged.
    await clickAndFlush(teamFlow);
    expect(container.querySelector('[data-testid="profiles-dirty"]')).not.toBeNull();
    expect(client.mutateProfile).not.toHaveBeenCalled();

    await clickAndFlush(container.querySelector('[data-testid="profile-save"]'));
    expect(client.mutateProfile).toHaveBeenCalledWith({ op: 'update', name: 'my-set', workflows: ['plan-build'] });

    // Re-seeded from the normalized response: team-flow is back ON, dirty cleared.
    const reRendered = container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    expect(reRendered.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[data-testid="profiles-dirty"]')).toBeNull();

    // After save the page states that locked spaces apply on their next apply
    // (profiles-ui: saving edits only the list; design D5 THEN-clause).
    const savedNote = container.querySelector('[data-testid="profiles-saved-note"]')!;
    expect(savedNote).not.toBeNull();
    expect(savedNote.textContent!.toLowerCase()).toContain('next apply');
  });

  it('keeps the listing authoritative after save: switching away and back reflects the saved membership', async () => {
    // Save my-set with team-flow removed, then revisit via the picker — the
    // re-seed must read the SAVED membership, not the pre-save snapshot.
    (client.mutateProfile as any).mockResolvedValue({
      profile: { name: 'my-set', builtIn: false, workflows: ['plan-build'] },
    });
    await mount(container);
    await selectProfile(container, 'my-set');

    await clickAndFlush(container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]'));
    await clickAndFlush(container.querySelector('[data-testid="profile-save"]'));
    expect(client.mutateProfile).toHaveBeenCalledWith({ op: 'update', name: 'my-set', workflows: ['plan-build'] });

    // Switch to core, then back to my-set — no re-fetch happened.
    await selectProfile(container, 'core');
    await selectProfile(container, 'my-set');

    const teamFlow = container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    const planBuild = container.querySelector('[data-id="plan-build"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    expect(teamFlow.getAttribute('aria-checked')).toBe('false'); // saved removal survives
    expect(planBuild.getAttribute('aria-checked')).toBe('true');
    // Revisiting is a fresh selection, so it is not marked dirty.
    expect(container.querySelector('[data-testid="profiles-dirty"]')).toBeNull();
  });

  it('disables Refresh while a draft is dirty so unsaved edits are not silently discarded', async () => {
    await mount(container);
    await selectProfile(container, 'my-set');
    // Clean: Refresh enabled.
    expect((container.querySelector('[data-testid="profiles-refresh"]') as HTMLButtonElement).disabled).toBe(false);

    await clickAndFlush(container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]'));
    // Dirty: Refresh disabled (guards against re-seed wiping the draft).
    expect(container.querySelector('[data-testid="profiles-dirty"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="profiles-refresh"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('discards unsaved membership edits back to the stored definition', async () => {
    await mount(container);
    await selectProfile(container, 'my-set');

    const teamFlow = container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    await clickAndFlush(teamFlow);
    expect((container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[data-testid="profiles-dirty"]')).not.toBeNull();

    await clickAndFlush(container.querySelector('[data-testid="profile-discard"]'));
    expect((container.querySelector('[data-id="team-flow"] [data-testid="workflow-card-toggle"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[data-testid="profiles-dirty"]')).toBeNull();
  });

  it('creates a new profile seeded from the selected profile', async () => {
    (client.mutateProfile as any).mockResolvedValue({ profile: { name: 'my-copy', builtIn: false, workflows: ['plan-build'] } });
    await mount(container);
    await selectProfile(container, 'core');

    await clickAndFlush(container.querySelector('[data-testid="profile-new"]'));
    expect(container.querySelector('[data-testid="profile-dialog"]')).not.toBeNull();
    // The seed hint reflects core's single member.
    expect(container.querySelector('[data-testid="profile-create-seed"]')!.textContent).toContain('1 workflow');

    await act(async () => {
      setInput(container.querySelector('[data-testid="profile-create-name"]'), 'my-copy');
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="profile-create-submit"]'));

    expect(client.mutateProfile).toHaveBeenCalledWith({ op: 'create', name: 'my-copy', workflows: ['plan-build'] });
  });

  it('rejects a reserved / malformed name client-side before any request', async () => {
    await mount(container);
    await selectProfile(container, 'core');
    await clickAndFlush(container.querySelector('[data-testid="profile-new"]'));

    await act(async () => {
      setInput(container.querySelector('[data-testid="profile-create-name"]'), 'core');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="profile-create-client-error"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="profile-create-submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(client.mutateProfile).not.toHaveBeenCalled();
  });

  it('warns about locked-space fallback before deleting a saved profile', async () => {
    (client.mutateProfile as any).mockResolvedValue({ deleted: 'my-set' });
    await mount(container);
    await selectProfile(container, 'my-set');

    await clickAndFlush(container.querySelector('[data-testid="profile-delete"]'));
    const warning = container.querySelector('[data-testid="profile-delete-warning"]')!;
    expect(warning.textContent).toContain('fall back to the user-wide profile');

    await clickAndFlush(container.querySelector('[data-testid="profile-delete-confirm"]'));
    expect(client.mutateProfile).toHaveBeenCalledWith({ op: 'delete', name: 'my-set' });
  });
});

describe('Profiles nav entry (Layout)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
  });

  it('renders the Profiles entry with no resolved space and marks it active on /profiles', async () => {
    window.history.pushState({}, '', '/profiles');
    await act(async () => {
      render(
        <LocationProvider>
          <Layout>
            <div />
          </Layout>
        </LocationProvider>,
        container
      );
    });
    const nav = container.querySelector('[data-testid="nav-profiles"]');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('href')).toBe('/profiles');
    expect(nav!.getAttribute('aria-current')).toBe('page');
  });
});
