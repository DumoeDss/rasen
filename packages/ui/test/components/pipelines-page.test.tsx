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
    listThresholdSchemes: vi.fn(),
    mutateThresholdScheme: vi.fn(),
    putKey: vi.fn(),
    deleteKey: vi.fn(),
    mutatePipeline: vi.fn(),
    listLocalPaths: vi.fn(),
    resolveLocalPath: vi.fn(),
    chooseLocalPath: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { PipelinesPage } from '../../src/components/PipelinesPage.js';
import { Layout } from '../../src/components/Layout.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import {
  __resetLocaleForTesting,
  setLocale,
} from '../../src/i18n/store.js';
import {
  pipelinesFixture,
  pipelinesConfigFixture,
  thresholdSchemeCatalogFixture,
} from '../fixtures/pipelines.js';

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

function configEntry(key: string, instanceKey?: string) {
  return pipelinesConfigFixture.entries.find((entry) =>
    instanceKey === undefined
      ? entry.instanceKey === undefined && entry.definition.key === key
      : entry.instanceKey === instanceKey
  )!;
}

/** Expands a pipeline's collapsed-by-default Configure disclosure so its per-stage/per-role controls render. */
async function expandConfig(container: HTMLElement, pipeline: string): Promise<void> {
  const section = stageSection(container, pipeline);
  await clickAndFlush(section.querySelector('[data-testid="pipeline-configure"]'));
}

describe('PipelinesPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listConfig as any).mockResolvedValue(pipelinesConfigFixture);
    (client.listPipelines as any).mockResolvedValue(pipelinesFixture);
    (client.listThresholdSchemes as any).mockResolvedValue(thresholdSchemeCatalogFixture);
    (client.mutateThresholdScheme as any).mockResolvedValue({
      op: 'create',
      name: 'new-scheme',
      scheme: { handoff: 0.5, reuse: 0.25 },
    });
    (client.putKey as any).mockResolvedValue({ entry: pipelinesConfigFixture.entries[3], store: null });
    (client.deleteKey as any).mockResolvedValue({ entry: pipelinesConfigFixture.entries[0], store: null });
    (client.listLocalPaths as any).mockResolvedValue({
      path: '/home/user',
      parent: null,
      separator: '/',
      home: true,
      entries: [{ name: 'new-pipe.rasenpkg', isDir: false, isGitRepo: false }],
    });
    (client.resolveLocalPath as any).mockImplementation(async (candidate: string) => ({
      path: candidate,
      kind: candidate.endsWith('.rasenpkg') ? 'file' : 'directory',
      separator: '/',
    }));
    (client.chooseLocalPath as any).mockResolvedValue({ status: 'unavailable', reason: 'headless' });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    __resetLocaleForTesting();
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

  it('renders the complete six-row Model/Effort defaults matrix from registry entries', async () => {
    await mount(container);
    const matrix = container.querySelector('[data-testid="defaults-matrix"]')!;
    expect(matrix.parentElement?.getAttribute('data-testid')).toBe('defaults-matrix-scroll');
    expect(matrix.parentElement?.classList.contains('defaults-matrix-scroll')).toBe(true);
    expect([...matrix.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual([
      'Role',
      'Model',
      'Effort',
    ]);
    expect([...matrix.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-role'))).toEqual([
      'default',
      'planner',
      'implementer',
      'reviewer',
      'fixer',
      'shipper',
    ]);
    const effortSelects = matrix.querySelectorAll('[data-testid="defaults-effort-select"]');
    expect(effortSelects).toHaveLength(6);
    expect([...effortSelects[0]!.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'inherit',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('writes fixed efforts at project/global scope and re-renders role inheritance from the API response', async () => {
    (client.putKey as any).mockImplementation(async (key: string, body: { scope: string; value: string }) => {
      const entry = configEntry(key);
      return {
        entry: {
          ...entry,
          value: body.value,
          source: body.scope,
          scopeValues: { ...entry.scopeValues, [body.scope]: body.value },
        },
        store: null,
      };
    });
    const reviewer = configEntry('efforts.roles.reviewer');
    (client.deleteKey as any).mockResolvedValue({
      entry: {
        ...reviewer,
        value: 'medium',
        source: 'global',
        scopeValues: { global: 'medium' },
      },
      store: null,
    });

    await mount(container);
    const baseCell = container.querySelector('[data-key="efforts.default"]')!;
    await changeValue(baseCell.querySelector('[data-testid="defaults-effort-select"]'), 'high');
    expect(client.putKey).toHaveBeenCalledWith(
      'efforts.default',
      { scope: 'project', value: 'high' },
      'project:proj_x'
    );
    expect(baseCell.querySelector('[data-testid="defaults-effort-effective"]')!.textContent).toContain('high');

    await clickAndFlush([...container.querySelectorAll('[data-testid="pipelines-mode"] button')][0]);
    await changeValue(baseCell.querySelector('[data-testid="defaults-effort-select"]'), 'max');
    expect(client.putKey).toHaveBeenCalledWith(
      'efforts.default',
      { scope: 'global', value: 'max' },
      'project:proj_x'
    );

    await clickAndFlush([...container.querySelectorAll('[data-testid="pipelines-mode"] button')][1]);
    const reviewerCell = container.querySelector('[data-key="efforts.roles.reviewer"]')!;
    await changeValue(reviewerCell.querySelector('[data-testid="defaults-effort-select"]'), 'inherit');
    expect(client.deleteKey).toHaveBeenCalledWith(
      'efforts.roles.reviewer',
      'project',
      'project:proj_x'
    );
    expect((reviewerCell.querySelector('[data-testid="defaults-effort-select"]') as HTMLSelectElement).value).toBe('inherit');
    expect(reviewerCell.querySelector('[data-testid="defaults-effort-effective"]')!.textContent).toContain('medium');
    expect(reviewerCell.querySelector('[data-testid="defaults-source"]')!.textContent).toBe('global');
  });

  it('keeps a store-inherited role effort read-only in project Local mode', async () => {
    const config = structuredClone(pipelinesConfigFixture) as any;
    config.store = { id: 'team-store', root: '/stores/team-store' };
    (client.listConfig as any).mockResolvedValue(config);

    await mount(container);
    const cell = container.querySelector('[data-role="implementer"] .defaults-cell--readonly')!;
    expect(cell.querySelector('[data-testid="defaults-effort-select"]')).toBeNull();
    expect(cell.querySelector('.config-entry__store-edit')!.textContent).toContain('team-store');
  });

  it('offers Luna/Terra on both model surfaces and writes arbitrary custom ids unchanged', async () => {
    const customId = 'vendor/future-model-42';
    (client.putKey as any).mockImplementation(async (key: string, body: { scope: string; value: string }) => ({
      entry: {
        ...(configEntry(key) ?? configEntry('pipelines.<name>.efforts.<stage>')),
        value: body.value,
        source: body.scope,
        scopeValues: { [body.scope]: body.value },
        ...(key.startsWith('pipelines.') ? { instanceKey: key } : {}),
      },
      store: null,
    }));

    await mount(container);
    const defaultsInput = container.querySelector('[data-key="models.default"] [data-testid="defaults-model-input"]') as HTMLInputElement;
    const defaultsList = document.getElementById(defaultsInput.getAttribute('list')!)!;
    expect([...defaultsList.querySelectorAll('option')].map((option) => option.value)).toEqual(
      expect.arrayContaining(['gpt-5.6-luna', 'gpt-5.6-terra', 'sonnet-5', 'gpt-5'])
    );
    await changeValue(defaultsInput, customId);
    expect(client.putKey).toHaveBeenCalledWith(
      'models.default',
      { scope: 'project', value: customId },
      'project:proj_x'
    );

    await expandConfig(container, 'small-feature');
    const stageInput = stageControl(container, 'stage-model', 'small-feature', 'propose')!
      .querySelector('[data-testid="stage-model-input"]') as HTMLInputElement;
    const stageList = document.getElementById(stageInput.getAttribute('list')!)!;
    expect([...stageList.querySelectorAll('option')].map((option) => option.value)).toEqual(
      expect.arrayContaining(['gpt-5.6-luna', 'gpt-5.6-terra', 'opus-4', 'fable'])
    );
    await changeValue(stageInput, customId);
    expect(client.putKey).toHaveBeenCalledWith(
      'pipelines.small-feature.models.propose',
      { scope: 'project', value: customId },
      'project:proj_x'
    );
  });

  it('shows keepalive enabled in Global and project Local modes, but omits store Local mode', async () => {
    await mount(container);
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')).not.toBeNull();

    await clickAndFlush([...container.querySelectorAll('[data-testid="pipelines-mode"] button')][0]);
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')).not.toBeNull();

    render(null, container);
    vi.clearAllMocks();
    (client.listConfig as any).mockResolvedValue(pipelinesConfigFixture);
    (client.listPipelines as any).mockResolvedValue(pipelinesFixture);
    await mount(container, '/s/store_x/pipelines');
    expect(client.listConfig).toHaveBeenCalledWith('store:store_x');
    expect(container.querySelector('[data-testid="pipelines-defaults-keepalive"]')).toBeNull();

    await clickAndFlush([...container.querySelectorAll('[data-testid="pipelines-mode"] button')][0]);
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')).not.toBeNull();
  });

  it('re-renders enabled state/source after a project unset without changing beatSeconds', async () => {
    const config = structuredClone(pipelinesConfigFixture) as typeof pipelinesConfigFixture;
    const enabled = config.entries.find((entry) => entry.definition.key === 'keepalive.enabled')!;
    Object.assign(enabled, {
      value: true,
      source: 'project',
      scopeValues: { global: false, project: true },
    });
    (client.listConfig as any).mockResolvedValue(config);
    (client.deleteKey as any).mockResolvedValue({
      entry: {
        ...enabled,
        value: false,
        source: 'global',
        scopeValues: { global: false },
      },
      store: null,
    });

    await mount(container);
    const beatBefore = (container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement).value;
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')!.getAttribute('aria-checked')).toBe('true');
    await clickAndFlush(container.querySelector('[data-testid="keepalive-enabled-unset"]'));

    expect(client.deleteKey).toHaveBeenCalledWith('keepalive.enabled', 'project', 'project:proj_x');
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')!.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[data-testid="keepalive-enabled-source"]')!.textContent).toBe('global');
    expect((container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement).value).toBe(beatBefore);
  });

  it('re-renders from the API response after toggling enabled at project scope', async () => {
    const enabled = pipelinesConfigFixture.entries.find(
      (entry) => entry.definition.key === 'keepalive.enabled'
    )!;
    (client.putKey as any).mockResolvedValue({
      entry: { ...enabled, value: false, source: 'project', scopeValues: { project: false } },
      store: null,
    });

    await mount(container);
    await clickAndFlush(container.querySelector('[data-testid="keepalive-enabled-toggle"]'));

    expect(client.putKey).toHaveBeenCalledWith(
      'keepalive.enabled',
      { scope: 'project', value: false },
      'project:proj_x'
    );
    expect(container.querySelector('[data-testid="keepalive-enabled-toggle"]')!.getAttribute('aria-checked')).toBe('false');
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

  it('renders all registry-provided effort choices and writes a project-scoped stage effort', async () => {
    const refreshed = structuredClone(pipelinesFixture) as any;
    const gateReview = refreshed.pipelines[0].stages.find((stage: any) => stage.id === 'gate-review');
    gateReview.effectiveEffort = { value: 'max', source: 'stage-override-project' };
    (client.listPipelines as any)
      .mockResolvedValueOnce(pipelinesFixture)
      .mockResolvedValueOnce(refreshed);
    const template = configEntry('pipelines.<name>.efforts.<stage>');
    (client.putKey as any).mockResolvedValue({
      entry: {
        ...template,
        value: 'max',
        source: 'project',
        scopeValues: { global: 'medium', project: 'max' },
        instanceKey: 'pipelines.small-feature.efforts.gate-review',
      },
      store: null,
    });

    await mount(container);
    await expandConfig(container, 'small-feature');
    const effort = stageControl(container, 'stage-effort', 'small-feature', 'gate-review')!;
    const select = effort.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      'inherit',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(select.value).toBe('inherit');
    expect(effort.querySelector('[data-testid="stage-effort-effective"]')!.textContent).toContain('Runtime default');
    expect(effort.querySelector('[data-testid="stage-source"]')!.textContent).toBe('default');

    await changeValue(select, 'max');
    expect(client.putKey).toHaveBeenCalledWith(
      'pipelines.small-feature.efforts.gate-review',
      { scope: 'project', value: 'max' },
      'project:proj_x'
    );
    expect(client.listPipelines).toHaveBeenCalledTimes(2);
    expect((effort.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('max');
    expect(effort.querySelector('[data-testid="stage-effort-effective"]')!.textContent).toContain('max');
    expect(effort.querySelector('[data-testid="stage-source"]')!.textContent).toBe('stage-override-project');
  });

  it('deletes only the active project effort and refreshes the lower effective winner', async () => {
    const refreshed = structuredClone(pipelinesFixture) as any;
    const implement = refreshed.pipelines[0].stages.find((stage: any) => stage.id === 'implement');
    implement.effectiveEffort = { value: 'low', source: 'stage-override-global' };
    (client.listPipelines as any)
      .mockResolvedValueOnce(pipelinesFixture)
      .mockResolvedValueOnce(refreshed);
    const configured = configEntry(
      'pipelines.<name>.efforts.<stage>',
      'pipelines.small-feature.efforts.implement'
    );
    (client.deleteKey as any).mockResolvedValue({
      entry: {
        ...configured,
        value: 'low',
        source: 'global',
        scopeValues: { global: 'low' },
      },
      store: null,
    });

    await mount(container);
    await expandConfig(container, 'small-feature');
    const effort = stageControl(container, 'stage-effort', 'small-feature', 'implement')!;
    const select = effort.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement;
    expect(select.value).toBe('max');
    await changeValue(select, 'inherit');

    expect(client.deleteKey).toHaveBeenCalledWith(
      'pipelines.small-feature.efforts.implement',
      'project',
      'project:proj_x'
    );
    expect((effort.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('inherit');
    expect(effort.querySelector('[data-testid="stage-effort-effective"]')!.textContent).toContain('low');
    expect(effort.querySelector('[data-testid="stage-source"]')!.textContent).toBe('stage-override-global');
  });

  it('edits a shadowed Global effort by exact instance identity without replacing its sibling', async () => {
    const configured = configEntry(
      'pipelines.<name>.efforts.<stage>',
      'pipelines.small-feature.efforts.implement'
    );
    (client.deleteKey as any).mockResolvedValue({
      entry: {
        ...configured,
        value: 'max',
        source: 'project',
        scopeValues: { project: 'max' },
      },
      store: null,
    });

    await mount(container);
    await clickAndFlush([...container.querySelectorAll('[data-testid="pipelines-mode"] button')][0]);
    await expandConfig(container, 'small-feature');
    const implement = stageControl(container, 'stage-effort', 'small-feature', 'implement')!;
    const propose = stageControl(container, 'stage-effort', 'small-feature', 'propose')!;
    expect((implement.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('low');
    expect(implement.querySelector('[data-testid="stage-effort-effective"]')!.textContent).toContain('max');
    expect((propose.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('medium');

    await changeValue(implement.querySelector('[data-testid="stage-effort-select"]'), 'inherit');
    expect(client.deleteKey).toHaveBeenCalledWith(
      'pipelines.small-feature.efforts.implement',
      'global',
      'project:proj_x'
    );
    expect((implement.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('inherit');
    expect(implement.querySelector('[data-testid="stage-effort-effective"]')!.textContent).toContain('max');
    expect((propose.querySelector('[data-testid="stage-effort-select"]') as HTMLSelectElement).value).toBe('medium');
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
      const input = container.querySelector('.local-path-picker__path-input') as HTMLInputElement;
      input.value = '/pkgs/new-pipe.rasenpkg';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    await clickAndFlush(container.querySelector('[data-testid="pipeline-import-submit"]'));
    expect(client.mutatePipeline).toHaveBeenCalledWith({ op: 'import', path: '/pkgs/new-pipe.rasenpkg', force: false });
    expect(container.querySelector('[data-testid="pipeline-import-result"]')!.textContent).toContain('new-pipe');
  });

  it('uses a selected Windows directory for export preview and submission', async () => {
    (client.listLocalPaths as any).mockResolvedValue({
      path: 'D:\\packages',
      parent: null,
      separator: '\\',
      home: true,
      entries: [],
    });
    (client.resolveLocalPath as any).mockResolvedValue({
      path: 'D:\\packages',
      kind: 'directory',
      separator: '\\',
    });
    (client.mutatePipeline as any).mockResolvedValue({
      pipeline: { path: 'D:\\packages\\my-flow.rasenpkg' },
    });
    await mount(container);
    await clickAndFlush(
      stageSection(container, 'my-flow').querySelector('[data-testid="pipeline-export"]')
    );
    expect(
      container.querySelector('[data-testid="pipeline-export-destination"]')?.textContent
    ).toContain('D:\\packages\\my-flow.rasenpkg');
    await clickAndFlush(container.querySelector('[data-testid="pipeline-export-submit"]'));
    expect(client.mutatePipeline).toHaveBeenCalledWith({
      op: 'export',
      name: 'my-flow',
      path: 'D:\\packages\\my-flow.rasenpkg',
      force: false,
    });
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

  it('keeps legacy and scoped stage handoff editors out of Pipelines while retaining Configure controls', async () => {
    await mount(container);
    const defaults = container.querySelector('[data-testid="pipelines-defaults"]')!;
    const headings = [...defaults.querySelectorAll('[data-testid="defaults-matrix"] thead th')]
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Role', 'Model', 'Effort']);
    expect(defaults.querySelector('[data-key="handoff.threshold"]')).toBeNull();
    expect(container.querySelector('[data-testid="pipelines-advanced"]')).toBeNull();

    await expandConfig(container, 'small-feature');
    const section = stageSection(container, 'small-feature');
    expect(section.querySelector('[data-testid="pipeline-stage-advanced"]')).toBeNull();
    expect(section.querySelector('[data-testid="stage-handoff"]')).toBeNull();
    expect(section.querySelector('[data-testid="stage-gate"]')).not.toBeNull();
    expect(section.querySelector('[data-testid="stage-model"]')).not.toBeNull();
    expect(section.querySelector('[data-testid="stage-effort"]')).not.toBeNull();
    expect(section.querySelector('[data-testid="role-runtime"]')).not.toBeNull();
  });

  it('keeps every lifecycle key together in Defaults and respects global-only scopes', async () => {
    await mount(container);
    expect(container.querySelector('[data-testid="pipelines-defaults-keepalive"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pipelines-keepalive-lifecycle"]')).toBeNull();

    const globalButton = [...container.querySelectorAll('[data-testid="pipelines-mode"] button')]
      .find((button) => button.textContent === 'Global')!;
    await clickAndFlush(globalButton);

    expect(container.querySelector('[data-testid="pipelines-defaults-keepalive"]')).not.toBeNull();
    const lifecycle = container.querySelector('[data-testid="pipelines-keepalive-lifecycle"]')!;
    expect(lifecycle.querySelector('[data-key="keepalive.runtimes.claude"]')).not.toBeNull();
    expect(lifecycle.querySelector('[data-key="keepalive.runtimes.codex"]')).not.toBeNull();
    expect(lifecycle.querySelector('[data-key="keepalive.contextFloor"]')).not.toBeNull();
    expect(lifecycle.textContent).toContain('lifecycle and cache behavior');
    expect(lifecycle.querySelector('[data-key="handoff.threshold"]')).toBeNull();
  });

  it('re-localizes the visible Keepalive lifecycle rows without remounting', async () => {
    await mount(container);
    const globalButton = [...container.querySelectorAll('[data-testid="pipelines-mode"] button')]
      .find((button) => button.textContent === 'Global')!;
    await clickAndFlush(globalButton);

    const lifecycle = container.querySelector('[data-testid="pipelines-keepalive-lifecycle"]')!;
    expect(lifecycle.textContent).toContain('Claude keepalive');
    expect(lifecycle.textContent).toContain('Keepalive context floor');
    expect(lifecycle.textContent).toContain('Allow keepalive beats under the Claude Code runtime');
    expect(lifecycle.textContent).toContain('Minimum context tokens required for keepalive parking');

    await act(async () => {
      setLocale('zh-cn');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="pipelines-keepalive-lifecycle"]')).toBe(lifecycle);
    expect(lifecycle.textContent).toContain('Claude 保活');
    expect(lifecycle.textContent).toContain('保活上下文下限');
    expect(lifecycle.textContent).toContain('允许 Claude Code 运行时使用 keepalive 心跳');
    expect(lifecycle.textContent).toContain('允许 keepalive 停驻所需的最少上下文 token 数');

    await act(async () => {
      setLocale('ja');
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="pipelines-keepalive-lifecycle"]')).toBe(lifecycle);
    expect(lifecycle.textContent).toContain('Claude keepalive');
    expect(lifecycle.textContent).toContain('keepalive コンテキスト下限');
    expect(lifecycle.textContent).toContain('Claude Code ランタイムで keepalive ビートを許可');
    expect(lifecycle.textContent).toContain('keepalive 待機に必要な最小コンテキストトークン数');
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
