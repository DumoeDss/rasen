// @vitest-environment jsdom
/**
 * Component coverage for the Workflows page and its nav entry (workflows-ui
 * spec): category-sectioned listing (driver / task / expert, internal behind
 * the driver disclosure) with the unused badge, per-card provenance (source
 * badge + built-in lock) inside a mixed section, and the invalid group; the
 * built-in lock (no delete affordance); the guarded-delete → force path; the
 * export overwrite retry; import success refreshing the listing without a
 * reload; the always-rendered nav entry with no resolved space; and the absence
 * of any model / handoff / gate control. The `satisfies` fixtures it imports are
 * the `tsc` drift tripwire.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    validateWorkflow: vi.fn(),
    mutateWorkflow: vi.fn(),
    listLocalPaths: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { WorkflowsPage } from '../../src/components/WorkflowsPage.js';
import { Layout } from '../../src/components/Layout.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import {
  workflowsListFixture,
  workflowDetailFixture,
  workflowDetailFixtureNoTitle,
} from '../fixtures/workflows.js';

async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mount(container: HTMLElement, path = '/workflows'): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <WorkflowsPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function click(el: Element | null): void {
  (el as HTMLElement).click();
}

async function clickAndFlush(el: Element | null): Promise<void> {
  await act(async () => {
    click(el);
    await flushMicrotasks();
  });
}

function setInput(el: Element | null, value: string): void {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// The home listing the shared LocalPathPicker loads on mount (a folder and a
// selectable .rasenpkg file). `home: true` so "Up" is disabled at the floor.
const HOME_LISTING = {
  path: '/home/user',
  parent: null,
  separator: '/',
  home: true,
  entries: [
    { name: 'pkgs', isDir: true, isGitRepo: false },
    { name: 'team-flow.rasenpkg', isDir: false, isGitRepo: false },
  ],
};

describe('WorkflowsPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listWorkflows as any).mockResolvedValue(workflowsListFixture);
    (client.getWorkflow as any).mockResolvedValue(workflowDetailFixture);
    (client.listLocalPaths as any).mockResolvedValue(HOME_LISTING);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('lists workflows in category sections (driver, task, expert) with no per-card kind chip', async () => {
    await mount(container);

    // Sections render in the user-specified order driver, task, expert; internal
    // is collapsed by default so its list is not a top-level section in the DOM.
    const sections = Array.from(
      container.querySelectorAll('section[data-testid^="workflows-section-"]')
    ).map((s) => s.getAttribute('data-testid'));
    expect(sections).toEqual([
      'workflows-section-driver',
      'workflows-section-task',
      'workflows-section-expert',
    ]);

    // The enclosing section conveys the category, so cards carry no kind chip.
    expect(container.querySelector('[data-testid="workflow-kind"]')).toBeNull();

    // Every workflow sits under the section matching its kind.
    const driver = container.querySelector('[data-testid="workflows-section-driver"]')!;
    const task = container.querySelector('[data-testid="workflows-section-task"]')!;
    const expert = container.querySelector('[data-testid="workflows-section-expert"]')!;
    expect(driver.querySelector('[data-id="review-cycle"]')).not.toBeNull();
    expect(driver.querySelector('[data-id="plan-build"]')).not.toBeNull();
    expect(task.querySelector('[data-id="team-flow"]')).not.toBeNull();
    expect(expert.querySelector('[data-id="deep-research"]')).not.toBeNull();

    // Provenance stays visible inside a mixed section: the built-in card carries
    // the lock and its source, the user card shows its own source, both in driver.
    const builtInCard = driver.querySelector('[data-id="review-cycle"]')!;
    const userCard = driver.querySelector('[data-id="plan-build"]')!;
    expect(builtInCard.querySelector('[data-testid="workflow-lock"]')).not.toBeNull();
    expect(builtInCard.getAttribute('data-source')).toBe('built-in');
    expect(userCard.querySelector('[data-testid="workflow-lock"]')).toBeNull();
    expect(userCard.getAttribute('data-source')).toBe('user');
    expect(userCard.querySelector('.workflow-card__source')!.textContent).toBe('user');

    // The unused marker still rides on the card (team-flow is unused).
    expect(task.querySelector('[data-id="team-flow"] [data-testid="workflow-unused"]')).not.toBeNull();
    expect(builtInCard.querySelector('[data-testid="workflow-unused"]')).toBeNull();

    // The invalid section still renders after the category sections.
    expect(container.querySelector('[data-testid="workflows-group-invalid"]')).not.toBeNull();
  });

  it('shows the declared title on the card, falling back to the skill name when none is declared', async () => {
    await mount(container);

    // review-cycle declares a title: the card shows it instead of the skill name.
    const titled = container.querySelector('[data-id="review-cycle"]')!;
    expect(titled.querySelector('.workflow-card__name')!.textContent).toBe('Review Cycle');
    expect(titled.querySelector('.workflow-card__name')!.textContent).not.toBe('rasen-review-cycle');

    // plan-build declares no title (null): the card falls back to the skill name.
    const untitled = container.querySelector('[data-id="plan-build"]')!;
    expect(untitled.querySelector('.workflow-card__name')!.textContent).toBe('rasen-plan-build');
  });

  it('omits a category section that has no workflows', async () => {
    // A task-only library: the driver and expert sections must be absent.
    (client.listWorkflows as any).mockResolvedValue({
      workflows: [
        {
          id: 'solo-task',
          source: 'user',
          sourcePath: '/home/u/.rasen/workflows/solo-task',
          digest: 'aa11bb22cc33dd44ee',
          kind: 'task',
          skillName: 'rasen-solo-task',
          unused: false,
        },
      ],
      invalid: [],
      diagnostics: [],
    });
    await mount(container);

    expect(container.querySelector('[data-testid="workflows-section-task"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workflows-section-driver"]')).toBeNull();
    expect(container.querySelector('[data-testid="workflows-section-expert"]')).toBeNull();
    // No internal workflows and no driver → no disclosure toggle either.
    expect(container.querySelector('[data-testid="workflows-internal-toggle"]')).toBeNull();
  });

  it('hides internal workflows behind the driver disclosure until the toggle is clicked', async () => {
    await mount(container);

    const driver = container.querySelector('[data-testid="workflows-section-driver"]')!;
    const toggle = driver.querySelector('[data-testid="workflows-internal-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('Show internal (1)');

    // Collapsed by default: the internal card is not in the DOM at all.
    expect(container.querySelector('[data-testid="workflows-section-internal"]')).toBeNull();
    expect(container.querySelector('[data-id="resolve-deps"]')).toBeNull();

    await clickAndFlush(toggle);

    const internal = driver.querySelector('[data-testid="workflows-section-internal"]');
    expect(internal).not.toBeNull();
    expect(internal!.querySelector('[data-id="resolve-deps"]')).not.toBeNull();
  });

  it('omits the internal disclosure when the library has no internal workflows', async () => {
    (client.listWorkflows as any).mockResolvedValue({
      workflows: [
        {
          id: 'review-cycle',
          source: 'built-in',
          sourcePath: null,
          digest: 'abcdef0123456789aa',
          kind: 'driver',
          skillName: 'rasen-review-cycle',
          unused: false,
        },
      ],
      invalid: [],
      diagnostics: [],
    });
    await mount(container);

    expect(container.querySelector('[data-testid="workflows-section-driver"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workflows-internal-toggle"]')).toBeNull();
  });

  it('locks built-ins: no delete or export control on a built-in card, both on a user card', async () => {
    await mount(container);
    const driver = container.querySelector('[data-testid="workflows-section-driver"]')!;
    const task = container.querySelector('[data-testid="workflows-section-task"]')!;
    const builtIn = driver.querySelector('[data-id="review-cycle"]')!;
    const user = task.querySelector('[data-id="team-flow"]')!;

    expect(builtIn.querySelector('[data-testid="workflow-delete"]')).toBeNull();
    expect(builtIn.querySelector('[data-testid="workflow-export"]')).toBeNull();
    expect(user.querySelector('[data-testid="workflow-delete"]')).not.toBeNull();
    expect(user.querySelector('[data-testid="workflow-export"]')).not.toBeNull();
  });

  it('surfaces a guarded-delete refusal verbatim then deletes only after an explicit force confirmation', async () => {
    const refusal = 'Workflow "team-flow" is still referenced by pipeline:user:my-pipe';
    (client.mutateWorkflow as any)
      .mockRejectedValueOnce(new ApiError(422, { error: { code: 'cli_error', message: refusal } }))
      .mockResolvedValueOnce({ deleted: 'team-flow', forcedReferrers: ['pipeline:user:my-pipe'] });

    await mount(container);
    const user = container
      .querySelector('[data-testid="workflows-section-task"]')!
      .querySelector('[data-id="team-flow"]')!;
    await clickAndFlush(user.querySelector('[data-testid="workflow-delete"]'));

    // Confirm the delete → the CLI refusal is surfaced verbatim.
    await clickAndFlush(container.querySelector('[data-testid="workflow-delete-confirm"]'));
    const refusalEl = container.querySelector('[data-testid="workflow-delete-refusal"]');
    expect(refusalEl!.textContent).toBe(refusal);

    // A single "force" click only reveals the second confirmation — no delete yet.
    await clickAndFlush(container.querySelector('[data-testid="workflow-delete-force"]'));
    expect(client.mutateWorkflow).toHaveBeenCalledTimes(1);

    // The second explicit confirmation issues the forced delete and refreshes.
    await clickAndFlush(container.querySelector('[data-testid="workflow-delete-force-confirm"]'));
    expect(client.mutateWorkflow).toHaveBeenCalledTimes(2);
    expect(client.mutateWorkflow).toHaveBeenLastCalledWith({ op: 'delete', id: 'team-flow', force: true });
    // Listing re-fetched after the successful mutation (refresh without reload).
    expect(client.listWorkflows).toHaveBeenCalledTimes(2);
  });

  it('exports to a folder picked through the local-path browser, offering an overwrite retry on refusal', async () => {
    (client.mutateWorkflow as any)
      .mockRejectedValueOnce(new ApiError(422, { error: { code: 'cli_error', message: 'Export destination already exists' } }))
      .mockResolvedValueOnce({ workflow: { id: 'team-flow', path: '/home/user/team-flow.rasenpkg' } });

    await mount(container);
    const user = container
      .querySelector('[data-testid="workflows-section-task"]')!
      .querySelector('[data-id="team-flow"]')!;
    await clickAndFlush(user.querySelector('[data-testid="workflow-export"]'));

    // The dialog drives the shared local-path browser (the MINOR-1 fix), which
    // loaded the home listing → destination folder = /home/user, filename
    // defaults to <id>.rasenpkg → /home/user/team-flow.rasenpkg.
    expect(container.querySelector('[data-testid="path-picker"]')).not.toBeNull();
    await clickAndFlush(container.querySelector('[data-testid="workflow-export-submit"]'));

    // The refusal is shown and an overwrite retry offered.
    expect(container.querySelector('[data-testid="workflow-dialog-error"]')!.textContent).toContain('already exists');
    const overwrite = container.querySelector('[data-testid="workflow-export-overwrite"]');
    expect(overwrite).not.toBeNull();

    await clickAndFlush(overwrite);
    expect(client.mutateWorkflow).toHaveBeenLastCalledWith({
      op: 'export',
      id: 'team-flow',
      path: '/home/user/team-flow.rasenpkg',
      force: true,
    });
    expect(container.querySelector('[data-testid="workflow-export-result"]')).not.toBeNull();
  });

  it('imports a .rasenpkg file picked through the local-path browser and refreshes without a reload', async () => {
    (client.mutateWorkflow as any).mockResolvedValue({ imported: ['new-flow'], reused: [], roots: ['new-flow'] });

    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="workflow-import"]'));

    // The browser lists files too; pick the .rasenpkg entry directly.
    const fileEntry = Array.from(container.querySelectorAll('[data-testid="dir-entries"] button')).find((b) =>
      b.textContent?.includes('team-flow.rasenpkg')
    );
    expect(fileEntry).toBeTruthy();
    await clickAndFlush(fileEntry!);
    expect(container.querySelector('[data-testid="workflow-import-source"]')!.textContent).toContain(
      '/home/user/team-flow.rasenpkg'
    );
    await clickAndFlush(container.querySelector('[data-testid="workflow-import-submit"]'));

    expect(client.mutateWorkflow).toHaveBeenCalledWith({ op: 'import', path: '/home/user/team-flow.rasenpkg' });
    expect(container.querySelector('[data-testid="workflow-import-result"]')!.textContent).toContain('new-flow');
    // Refetched after success (no full reload).
    expect(client.listWorkflows).toHaveBeenCalledTimes(2);
  });

  it('imports a draft directory via "use this folder" (browse-to-dir, no file wire needed)', async () => {
    (client.mutateWorkflow as any).mockResolvedValue({ imported: ['draft-flow'], reused: [], roots: ['draft-flow'] });

    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="workflow-import"]'));

    // Home listing loaded → current folder is /home/user; "use this folder"
    // selects it as a draft-directory import source.
    await clickAndFlush(container.querySelector('[data-testid="workflow-import-use-dir"]'));
    expect(container.querySelector('[data-testid="workflow-import-source"]')!.textContent).toContain('/home/user');
    await clickAndFlush(container.querySelector('[data-testid="workflow-import-submit"]'));

    expect(client.mutateWorkflow).toHaveBeenCalledWith({ op: 'import', path: '/home/user' });
  });

  it('scaffolds a draft into a parent folder picked through the browser (output = parent/<id>)', async () => {
    (client.mutateWorkflow as any).mockResolvedValue({ workflow: { id: 'my-flow', output: '/home/user/my-flow' } });

    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="workflow-new"]'));

    await act(async () => {
      setInput(container.querySelector('[data-testid="workflow-init-id"]'), 'my-flow');
      await flushMicrotasks();
    });
    // The picker loaded /home/user as the parent → preview shows the computed output.
    expect(container.querySelector('[data-testid="workflow-init-output-preview"]')!.textContent).toContain(
      '/home/user/my-flow'
    );
    await clickAndFlush(container.querySelector('[data-testid="workflow-init-submit"]'));

    expect(client.mutateWorkflow).toHaveBeenCalledWith({ op: 'init', id: 'my-flow', output: '/home/user/my-flow' });
    expect(container.querySelector('[data-testid="workflow-init-result"]')!.textContent).toContain('/home/user/my-flow');
  });

  it('opens a detail view showing the four requires slots, files, and usage referrers', async () => {
    await mount(container);
    const user = container
      .querySelector('[data-testid="workflows-section-task"]')!
      .querySelector('[data-id="team-flow"]')!;
    await clickAndFlush(user.querySelector('[data-testid="workflow-open"]'));

    const detail = container.querySelector('[data-testid="workflow-detail"]');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain('dep-a'); // requires.workflows
    expect(container.querySelector('[data-testid="workflow-detail-files"]')!.textContent).toContain('workflow.yaml');
    expect(container.querySelector('[data-testid="workflow-detail-usage"]')!.textContent).toContain('user:my-pipe');

    // The facts list shows kind / source / skill / digest and, since the command
    // surface retired, no "Command" row (guards the remnant from returning).
    const facts = container.querySelector('.workflow-detail__facts')!;
    expect(facts.textContent).toContain('Kind');
    expect(facts.textContent).toContain('task');
    expect(facts.textContent).toContain('Source');
    expect(facts.textContent).toContain('user');
    expect(facts.textContent).toContain('Skill');
    expect(facts.textContent).toContain('rasen-team-flow');
    expect(facts.textContent).toContain('Digest');
    expect(facts.textContent).not.toContain('Command');

    // The detail fixture declares title/category/tags: all three rows render.
    expect(facts.textContent).toContain('Title');
    expect(facts.textContent).toContain('Team Flow');
    expect(facts.textContent).toContain('Category');
    expect(facts.textContent).toContain('collaboration');
    expect(facts.textContent).toContain('Tags');
    expect(facts.textContent).toContain('team, flow');
  });

  it('omits the Title/Category/Tags rows when the workflow declares none of them', async () => {
    (client.getWorkflow as any).mockResolvedValue(workflowDetailFixtureNoTitle);
    await mount(container);
    const driver = container.querySelector('[data-testid="workflows-section-driver"]')!;
    await clickAndFlush(driver.querySelector('[data-id="plan-build"] [data-testid="workflow-open"]'));

    const facts = container.querySelector('.workflow-detail__facts')!;
    // Kind/Source/Skill/Digest still render — only the presentation rows are absent.
    expect(facts.textContent).toContain('Kind');
    expect(facts.textContent).not.toContain('Title');
    expect(facts.textContent).not.toContain('Category');
    expect(facts.textContent).not.toContain('Tags');
  });

  it('offers no model, handoff, gate, or per-space enablement control anywhere on the page', async () => {
    await mount(container);
    // Library-only surface (workflows-ui delta): per-space enablement moved to
    // the Config Profile selector, so the space picker and its switches are
    // gone; Fork 4B (model/handoff/gate controls) stays rejected.
    expect(container.querySelector('[data-testid="workflows-enablement-space-picker"]')).toBeNull();
    expect(container.querySelector('[data-testid="workflow-card-toggle"]')).toBeNull();
    expect(container.querySelectorAll('select').length).toBe(0);
    expect(container.querySelector('[data-testid*="model"]')).toBeNull();
    expect(container.querySelector('[data-testid*="handoff"]')).toBeNull();
    expect(container.querySelector('[data-testid*="gate"]')).toBeNull();
    expect(container.textContent!.toLowerCase()).not.toContain('handoff');
  });
});

describe('Workflows nav entry (Layout)', () => {
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

  it('renders the Workflows entry even with no resolved space', async () => {
    window.history.pushState({}, '', '/'); // bootstrap: no /p or /s prefix
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
    const nav = container.querySelector('[data-testid="nav-workflows"]');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('href')).toBe('/workflows');
    // Space-scoped links are absent with no space resolved; the two
    // space-agnostic entries (Workflows, Profiles) remain.
    expect(Array.from(container.querySelectorAll('nav a')).map((a) => a.textContent)).toEqual([
      'Workflows',
      'Profiles',
    ]);
  });

  it('marks the Workflows entry active on the /workflows route', async () => {
    window.history.pushState({}, '', '/workflows');
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
    const nav = container.querySelector('[data-testid="nav-workflows"]');
    expect(nav!.getAttribute('aria-current')).toBe('page');
  });
});
