// @vitest-environment jsdom
/**
 * Component coverage for the Pipelines page and its space-scoped nav entry
 * (pipelines-ui spec): the Defaults table (role-matrix config keys under the
 * Global/Local scope mode), per-pipeline sections with provenance/source
 * badges and the built-in library lock, the two-write "gate small-feature at
 * propose only" scenario (autopilot.gates off + a per-stage gate override), a
 * per-stage override write re-rendering with its source badge, inherit falling
 * back via delete, the always-pausing `vet` gate rendered locked, and the
 * space-scoped nav entry. The `satisfies` fixtures it imports are the tsc
 * drift tripwire.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listConfig: vi.fn(),
    listPipelines: vi.fn(),
    putKey: vi.fn(),
    deleteKey: vi.fn(),
    mutatePipeline: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { PipelinesPage } from '../../src/components/PipelinesPage.js';
import { Layout } from '../../src/components/Layout.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { pipelinesFixture, pipelinesConfigFixture } from '../fixtures/pipelines.js';

async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mount(container: HTMLElement, path = '/p/proj_x/pipelines'): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <PipelinesPage />
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

async function changeValue(el: Element | null, value: string): Promise<void> {
  await act(async () => {
    const input = el as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();
  });
}

function stageControl(container: HTMLElement, testid: string, pipeline: string, stage: string): Element | null {
  return [...container.querySelectorAll(`[data-testid="${testid}"]`)].find(
    (el) => el.getAttribute('data-pipeline') === pipeline && el.getAttribute('data-stage') === stage
  ) ?? null;
}

/** Expands a pipeline's collapsed-by-default Configure disclosure so its per-stage/per-role controls render. */
async function expandConfig(container: HTMLElement, pipeline: string): Promise<void> {
  const section = stageSection(container, pipeline);
  await clickAndFlush(section.querySelector('[data-testid="pipeline-configure"]'));
}

describe('PipelinesPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listConfig as any).mockResolvedValue(pipelinesConfigFixture);
    (client.listPipelines as any).mockResolvedValue(pipelinesFixture);
    (client.putKey as any).mockResolvedValue({ entry: pipelinesConfigFixture.entries[3], store: null });
    (client.deleteKey as any).mockResolvedValue({ entry: pipelinesConfigFixture.entries[0], store: null });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('addresses both APIs with the route space selector and renders defaults + pipeline sections', async () => {
    await mount(container);
    expect(client.listConfig).toHaveBeenCalledWith('project:proj_x');
    expect(client.listPipelines).toHaveBeenCalledWith('project:proj_x');

    expect(container.querySelector('[data-testid="pipelines-defaults"]')).not.toBeNull();
    const sections = [...container.querySelectorAll('[data-testid="pipeline-section"]')];
    expect(sections.map((s) => s.getAttribute('data-pipeline'))).toEqual([
      'small-feature',
      'my-flow',
      'forked-flow',
    ]);

    // Provenance + source-layer badges.
    const builtIn = sections.find((s) => s.getAttribute('data-pipeline') === 'small-feature')!;
    expect(builtIn.querySelector('[data-testid="pipeline-provenance"]')!.textContent).toBe('built-in');
    expect(builtIn.querySelector('[data-testid="pipeline-source-layer"]')!.textContent).toBe('package');
  });

  it('exposes export/delete only for user-library pipelines; built-in AND project-layer are locked', async () => {
    await mount(container);
    const builtIn = stageSection(container, 'small-feature'); // sourceLayer package
    const user = stageSection(container, 'my-flow'); // sourceLayer user
    const project = stageSection(container, 'forked-flow'); // sourceLayer project

    // Built-in (package): locked, no export AND no delete — the CLI refuses both.
    expect(builtIn.querySelector('[data-testid="pipeline-lock"]')).not.toBeNull();
    expect(builtIn.querySelector('[data-testid="pipeline-export"]')).toBeNull();
    expect(builtIn.querySelector('[data-testid="pipeline-delete"]')).toBeNull();

    // Project-layer (provenance 'user' but sourceLayer 'project'): also locked —
    // `exportPipeline`/`deletePipeline` both refuse `source !== 'user'`.
    expect(project.querySelector('[data-testid="pipeline-lock"]')).not.toBeNull();
    expect(project.querySelector('[data-testid="pipeline-export"]')).toBeNull();
    expect(project.querySelector('[data-testid="pipeline-delete"]')).toBeNull();

    // User-library: both offered.
    expect(user.querySelector('[data-testid="pipeline-export"]')).not.toBeNull();
    expect(user.querySelector('[data-testid="pipeline-delete"]')).not.toBeNull();
  });

  it('gates small-feature at propose only: two writes — autopilot.gates off + a per-stage gate override', async () => {
    await mount(container);

    // Default Local mode at a project space → writes target the project scope.
    // 1) autopilot.gates → off (a Defaults config row).
    const autopilotRow = container.querySelector('[data-key="autopilot.gates"]')!;
    await changeValue(autopilotRow.querySelector('select'), 'off');
    expect(client.putKey).toHaveBeenCalledWith('autopilot.gates', { scope: 'project', value: 'off' }, 'project:proj_x');

    // 2) the propose stage gate → on (a per-stage family instance), reached by
    // expanding the pipeline's Configure disclosure first.
    await expandConfig(container, 'small-feature');
    const gate = stageControl(container, 'stage-gate', 'small-feature', 'propose');
    await changeValue(gate!.querySelector('[data-testid="stage-gate-select"]'), 'on');
    expect(client.putKey).toHaveBeenCalledWith(
      'pipelines.small-feature.gates.propose',
      { scope: 'project', value: 'on' },
      'project:proj_x'
    );
    // The stage write re-fetches the pipelines listing so effective values re-resolve.
    expect(client.listPipelines).toHaveBeenCalledTimes(2);
  });

  it('renders a per-stage override with its scope-qualified source and inherits via delete', async () => {
    await mount(container);
    await expandConfig(container, 'small-feature');
    const model = stageControl(container, 'stage-model', 'small-feature', 'implement')!;
    // Effective model came from a project-scope instance → override source badge.
    expect((model.querySelector('[data-testid="stage-model-input"]') as HTMLInputElement).value).toBe('opus-4');
    expect(model.querySelector('[data-testid="stage-source"]')!.textContent).toBe('stage-override-project');

    // Inherit clears the override at the active scope.
    await clickAndFlush(model.querySelector('[data-testid="stage-model-inherit"]'));
    expect(client.deleteKey).toHaveBeenCalledWith('pipelines.small-feature.models.implement', 'project', 'project:proj_x');

    // The per-role runtime select reflects the project override (codex).
    const runtime = [...container.querySelectorAll('[data-testid="role-runtime"]')].find(
      (el) => el.getAttribute('data-role') === 'implementer' && el.getAttribute('data-pipeline') === 'small-feature'
    )!;
    expect((runtime.querySelector('[data-testid="role-runtime-select"]') as HTMLSelectElement).value).toBe('codex');
  });

  it('renders every stage gate as an ordinary control — no vet lock remains', async () => {
    await mount(container);
    await expandConfig(container, 'small-feature');
    const gate = stageControl(container, 'stage-gate', 'small-feature', 'gate-review')!;
    // The vet type is retired: the reviewer stage's gate is an ordinary
    // configurable control, not a locked always-pausing badge.
    expect(gate.querySelector('[data-testid="stage-gate-vet"]')).toBeNull();
    const select = gate.querySelector('[data-testid="stage-gate-select"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('inherit');
  });

  it('imports a pipeline through the bridge and refreshes without a reload', async () => {
    (client.mutatePipeline as any).mockResolvedValue({ path: '/pkgs', imported: ['new-pipe'], digests: {} });
    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-import"]'));
    await act(async () => {
      const input = container.querySelector('[data-testid="pipeline-import-path"]') as HTMLInputElement;
      input.value = '/pkgs/new-pipe';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-import-submit"]'));
    expect(client.mutatePipeline).toHaveBeenCalledWith({ op: 'import', path: '/pkgs/new-pipe', force: false });
    expect(container.querySelector('[data-testid="pipeline-import-result"]')!.textContent).toContain('new-pipe');
  });

  it('surfaces a guarded-delete refusal verbatim then deletes only after an explicit force confirmation', async () => {
    const refusal = 'Pipeline "my-flow" is still referenced by ledger:autopilot';
    (client.mutatePipeline as any)
      .mockRejectedValueOnce(new ApiError(422, { error: { code: 'cli_error', message: refusal } }))
      .mockResolvedValueOnce({ deleted: 'my-flow', forcedReferrers: ['ledger:autopilot'] });

    await mount(container);
    const user = stageSection(container, 'my-flow');
    await clickAndFlush(user.querySelector('[data-testid="pipeline-delete"]'));
    await clickAndFlush(container.querySelector('[data-testid="pipeline-delete-confirm"]'));
    expect(container.querySelector('[data-testid="pipeline-delete-refusal"]')!.textContent).toBe(refusal);

    await clickAndFlush(container.querySelector('[data-testid="pipeline-delete-force"]'));
    expect(client.mutatePipeline).toHaveBeenCalledTimes(1);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-delete-force-confirm"]'));
    expect(client.mutatePipeline).toHaveBeenLastCalledWith({ op: 'delete', name: 'my-flow', force: true });
  });

  it('prompts to pick a space when none is resolved', async () => {
    await mount(container, '/pipelines'); // no /p or /s prefix
    expect(container.querySelector('[data-testid="pipelines-no-space"]')).not.toBeNull();
    expect(client.listPipelines).not.toHaveBeenCalled();
  });

  it('offers exactly one creation entry (New pipeline) besides Import — no scaffold-to-disk dialog', async () => {
    await mount(container);
    // The single creation entry is the canvas-first "New pipeline"; the old
    // scaffold-to-disk init entry is gone.
    expect(container.querySelector('[data-testid="pipeline-new"]')!.textContent).toContain('New pipeline');
    expect(container.querySelector('[data-testid="pipeline-init-name"]')).toBeNull();
    // Opening it starts the name-first canvas assembly flow.
    await clickAndFlush(container.querySelector('[data-testid="pipeline-new"]'));
    expect(container.querySelector('[data-testid="pipeline-assemble-name"]')).not.toBeNull();
  });

  it('collapses per-pipeline configuration behind the Configure disclosure until expanded', async () => {
    await mount(container);
    const section = stageSection(container, 'small-feature');
    // The scannable summary is always present.
    expect(section.querySelector('[data-testid="pipeline-lane"]')).not.toBeNull();
    // Config controls are hidden until the disclosure is expanded.
    expect(section.querySelector('[data-testid="pipeline-config"]')).toBeNull();
    expect(section.querySelector('[data-testid="stage-gate-select"]')).toBeNull();
    const toggle = section.querySelector('[data-testid="pipeline-configure"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await expandConfig(container, 'small-feature');
    const expanded = stageSection(container, 'small-feature');
    expect(expanded.querySelector('[data-testid="pipeline-config"]')).not.toBeNull();
    expect(expanded.querySelector('[data-testid="stage-gate-select"]')).not.toBeNull();
  });

  it('rejects a malformed name and, once valid, navigates to the graph route in edit mode (pipeline-canvas-edit)', async () => {
    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="pipeline-new"]'));
    const nameInput = container.querySelector('[data-testid="pipeline-assemble-name"]') as HTMLInputElement;

    await act(async () => {
      nameInput.value = 'Not Valid!';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-assemble-submit"]'));
    expect(container.querySelector('[data-testid="pipeline-dialog-error"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/p/proj_x/pipelines');

    await act(async () => {
      nameInput.value = 'my-new-pipeline';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-assemble-submit"]'));
    expect(window.location.pathname).toBe('/p/proj_x/pipelines/my-new-pipeline');
  });
});

function stageSection(container: HTMLElement, name: string): Element {
  return [...container.querySelectorAll('[data-testid="pipeline-section"]')].find(
    (s) => s.getAttribute('data-pipeline') === name
  )!;
}

describe('Pipelines nav entry (Layout)', () => {
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

  async function mountLayout(path: string): Promise<void> {
    window.history.pushState({}, '', path);
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
  }

  it('renders a space-scoped Pipelines entry that is active on the pipelines route', async () => {
    await mountLayout('/p/proj_x/pipelines');
    const nav = container.querySelector('[data-testid="nav-pipelines"]');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('href')).toBe('/p/proj_x/pipelines');
    expect(nav!.getAttribute('aria-current')).toBe('page');
  });

  it('locks the content area to the viewport on a pipeline canvas route, but not on the list route', async () => {
    // ui-profile-workflow-split design D8: the viewport lock now clamps BOTH the
    // shell (definite height) and the content (flexed, min-height:0), so assert
    // both modifier classes on the canvas route and neither off it.
    await mountLayout('/p/proj_x/pipelines/small-feature');
    expect(container.querySelector('.app-shell')!.classList.contains('app-shell--canvas')).toBe(true);
    expect(container.querySelector('main')!.classList.contains('app-content--canvas')).toBe(true);

    render(null, container);
    await mountLayout('/p/proj_x/pipelines');
    expect(container.querySelector('.app-shell')!.classList.contains('app-shell--canvas')).toBe(false);
    expect(container.querySelector('main')!.classList.contains('app-content--canvas')).toBe(false);
  });

  it('omits the Pipelines entry only when no space is resolved AND none was ever visited', async () => {
    // The agnostic-route nav falls back to the most recent space, so the
    // entry disappears only on a truly fresh session (no route space, no
    // recency). Clear the recency other tests in this file recorded.
    localStorage.removeItem('rasen.recentSpaces');
    await mountLayout('/'); // bootstrap: no space
    expect(container.querySelector('[data-testid="nav-pipelines"]')).toBeNull();
  });
});
