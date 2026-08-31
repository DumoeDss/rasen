// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    mutateThresholdScheme: vi.fn(),
    putKey: vi.fn(),
    deleteKey: vi.fn(),
  };
});

import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type {
  StoreLayerRef,
  ThresholdSchemeCatalogResponse,
  WireConfigEntry,
} from '../../src/api/types.js';
import { ThresholdPolicyWorkbench } from '../../src/components/ThresholdPolicyWorkbench.js';
import {
  __resetLocaleForTesting,
  setLocale,
} from '../../src/i18n/store.js';
import { pipelinesFixture, thresholdSchemeCatalogFixture } from '../fixtures/pipelines.js';

function bindingEntry(
  row: 'claude' | 'codex' | 'default',
  value: string,
  source: 'global' | 'store' | 'project',
  scopeValues: WireConfigEntry['scopeValues']
): WireConfigEntry {
  return {
    definition: {
      key: 'thresholds.bindings.*',
      scopes: ['global', 'store', 'project'],
      type: 'string',
      defaultValue: undefined,
      description: 'Runtime threshold scheme binding',
      group: 'Workflow',
      wildcard: true,
      constraints: { type: 'string' },
    },
    instanceKey: `thresholds.bindings.${row}`,
    value,
    source,
    scopeValues,
  };
}

function legacyEntry(
  key: 'handoff.threshold' | `handoff.roles.${string}`,
  value: unknown,
  scopeValues: WireConfigEntry['scopeValues']
): WireConfigEntry {
  return {
    definition: {
      key,
      scopes: ['global', 'store', 'project'],
      type: 'threshold',
      defaultValue: 0.5,
      description: 'Legacy handoff threshold',
      group: 'Workflow',
      constraints: {
        type: 'threshold',
        range: { gt: 0, lte: 1 },
        remainingTokensGt: 0,
      },
    },
    value,
    source: scopeValues.project !== undefined ? 'project' : 'default',
    scopeValues,
  };
}

async function flushMicrotasks(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function click(element: Element | null): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await flushMicrotasks();
  });
}

async function input(element: Element | null, value: string): Promise<void> {
  await act(async () => {
    const control = element as HTMLInputElement;
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();
  });
}

async function change(element: Element | null, value?: string): Promise<void> {
  await act(async () => {
    const control = element as HTMLInputElement | HTMLSelectElement;
    if (value !== undefined) control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();
  });
}

describe('ThresholdPolicyWorkbench', () => {
  let container: HTMLElement;
  let refresh: ReturnType<typeof vi.fn>;
  let pageError: ReturnType<typeof vi.fn>;

  function mount(options: {
    catalog?: ThresholdSchemeCatalogResponse;
    entries?: WireConfigEntry[];
    mode?: 'global' | 'local';
    spaceType?: 'project' | 'store';
    storeRef?: StoreLayerRef | null;
  } = {}): void {
    render(
      <ThresholdPolicyWorkbench
        catalog={options.catalog ?? thresholdSchemeCatalogFixture}
        entries={options.entries ?? []}
        pipelines={pipelinesFixture.pipelines}
        mode={options.mode ?? 'local'}
        spaceType={options.spaceType ?? 'project'}
        selector="project:proj_x"
        storeRef={options.storeRef ?? null}
        onRefresh={refresh}
        onPageError={pageError}
      />,
      container
    );
  }

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    refresh = vi.fn().mockResolvedValue(undefined);
    pageError = vi.fn();
    (client.mutateThresholdScheme as any).mockResolvedValue({
      op: 'create',
      name: 'focused',
      scheme: { handoff: 0.5, reuse: 0.25 },
    });
    (client.putKey as any).mockResolvedValue({});
    (client.deleteKey as any).mockResolvedValue({});
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    __resetLocaleForTesting();
    vi.resetAllMocks();
  });

  it('renders valid and invalid schemes plus immutable preset provenance', () => {
    mount();

    const valid = container.querySelector(
      '[data-testid="threshold-scheme-card"][data-scheme="balanced"]'
    )!;
    expect(valid.textContent).toContain('0.5');
    expect(valid.textContent).toContain('48000');
    expect(
      container.querySelector(
        '[data-testid="threshold-scheme-invalid"][data-scheme="broken"]'
      )!.textContent
    ).toContain('handoff is required');

    const preset = container.querySelector(
      '[data-testid="threshold-preset-card"][data-preset="gpt-5"]'
    )!;
    expect(preset.textContent).toContain('100000');
    expect(preset.textContent).toContain('Model preset');
    expect(preset.textContent).toContain('Built-in default');
    expect(preset.querySelector('[data-testid="threshold-scheme-edit"]')).toBeNull();
  });

  it('seeds a complete unsaved preset draft and writes only after a named confirmation', async () => {
    mount();
    const preset = container.querySelector(
      '[data-testid="threshold-preset-card"][data-preset="gpt-5"]'
    )!;
    await click(preset.querySelector('[data-testid="threshold-preset-seed"]'));

    expect(client.mutateThresholdScheme).not.toHaveBeenCalled();
    expect(
      (container.querySelector('[data-testid="scheme-handoff-value"]') as HTMLInputElement)
        .value
    ).toBe('100000');
    expect(
      (container.querySelector('[data-testid="scheme-reuse-value"]') as HTMLInputElement)
        .value
    ).toBe('0.25');

    await input(container.querySelector('[data-testid="threshold-editor-name"]'), 'seeded');
    await click(container.querySelector('[data-testid="threshold-editor-save"]'));
    expect(client.mutateThresholdScheme).toHaveBeenCalledWith({
      op: 'create',
      name: 'seeded',
      scheme: {
        handoff: { remainingTokens: 100000 },
        handoffRoles: {},
        reuse: 0.25,
        reuseRoles: {},
      },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('creates a dual-form scheme with constrained handoff and reuse role maps', async () => {
    mount();
    await click(container.querySelector('[data-testid="threshold-scheme-new"]'));
    await input(container.querySelector('[data-testid="threshold-editor-name"]'), 'focused');

    const handoffAbsolute = container.querySelectorAll(
      'input[name="scheme-handoff-form"]'
    )[1];
    await change(handoffAbsolute);
    await input(container.querySelector('[data-testid="scheme-handoff-value"]'), '60000');
    await change(
      container.querySelector('[data-testid="scheme-handoff-role-reviewer"]')
    );
    await input(
      container.querySelector('[data-testid="scheme-handoff-role-reviewer-value"]'),
      '0.65'
    );
    await change(
      container.querySelector('[data-testid="scheme-reuse-role-implementer"]')
    );

    await click(container.querySelector('[data-testid="threshold-editor-save"]'));
    expect(client.mutateThresholdScheme).toHaveBeenCalledWith({
      op: 'create',
      name: 'focused',
      scheme: {
        handoff: { remainingTokens: 60000 },
        handoffRoles: { reviewer: 0.65 },
        reuse: 0.25,
        reuseRoles: { implementer: 0.25 },
      },
    });
  });

  it('keeps an authoritative create-conflict error and the unsaved draft open across refresh renders', async () => {
    (client.mutateThresholdScheme as any).mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'conflict',
          message: 'Threshold scheme "balanced" already exists.',
        },
      })
    );
    mount();
    await click(container.querySelector('[data-testid="threshold-scheme-new"]'));
    await input(container.querySelector('[data-testid="threshold-editor-name"]'), 'balanced');
    await input(container.querySelector('[data-testid="scheme-reuse-value"]'), '0.31');
    await click(container.querySelector('[data-testid="threshold-editor-save"]'));

    expect(container.querySelector('[data-testid="threshold-editor"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="threshold-editor-error"]')!.textContent
    ).toBe('Threshold scheme "balanced" already exists.');
    expect(
      (container.querySelector('[data-testid="threshold-editor-name"]') as HTMLInputElement)
        .value
    ).toBe('balanced');

    mount({ catalog: { ...thresholdSchemeCatalogFixture } });
    expect(
      (container.querySelector('[data-testid="threshold-editor-name"]') as HTMLInputElement)
        .value
    ).toBe('balanced');
    expect(
      (container.querySelector('[data-testid="scheme-reuse-value"]') as HTMLInputElement)
        .value
    ).toBe('0.31');
  });

  it('edits without offering rename and deletes only after separate confirmation', async () => {
    mount();
    const card = container.querySelector(
      '[data-testid="threshold-scheme-card"][data-scheme="balanced"]'
    )!;
    await click(card.querySelector('[data-testid="threshold-scheme-edit"]'));
    expect(container.querySelector('[data-testid="threshold-editor-name"]')).toBeNull();
    await input(container.querySelector('[data-testid="scheme-reuse-value"]'), '0.3');
    await click(container.querySelector('[data-testid="threshold-editor-save"]'));
    expect(client.mutateThresholdScheme).toHaveBeenLastCalledWith(
      expect.objectContaining({
        op: 'update',
        name: 'balanced',
        scheme: expect.objectContaining({ reuse: 0.3 }),
      })
    );

    mount();
    const refreshedCard = container.querySelector(
      '[data-testid="threshold-scheme-card"][data-scheme="balanced"]'
    )!;
    (client.mutateThresholdScheme as any).mockClear();
    await click(refreshedCard.querySelector('[data-testid="threshold-scheme-delete"]'));
    expect(client.mutateThresholdScheme).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="threshold-delete-dialog"]')!.textContent
    ).toContain('bindings are not removed');
    await click(container.querySelector('[data-testid="threshold-delete-confirm"]'));
    expect(client.mutateThresholdScheme).toHaveBeenCalledWith({
      op: 'delete',
      name: 'balanced',
    });
  });

  it('uses only server eligible rows and writes explicit/default bindings at the active scope', async () => {
    mount();
    const rows = [
      ...container.querySelectorAll('[data-testid="threshold-binding-row"]'),
    ];
    expect(rows.map((row) => row.getAttribute('data-row'))).toEqual([
      'claude',
      'codex',
      'default',
    ]);
    expect(container.textContent).not.toContain('zed');
    expect(container.querySelector('[data-testid="threshold-bindings-empty"]')).not.toBeNull();

    const codex = rows.find((row) => row.getAttribute('data-row') === 'codex')!;
    await change(
      codex.querySelector('[data-testid="threshold-binding-select"]'),
      'balanced'
    );
    expect(client.putKey).toHaveBeenCalledWith(
      'thresholds.bindings.codex',
      { scope: 'project', value: 'balanced' },
      'project:proj_x'
    );

    const defaultRow = rows.find((row) => row.getAttribute('data-row') === 'default')!;
    await change(
      defaultRow.querySelector('[data-testid="threshold-binding-select"]'),
      'balanced'
    );
    expect(client.putKey).toHaveBeenCalledWith(
      'thresholds.bindings.default',
      { scope: 'project', value: 'balanced' },
      'project:proj_x'
    );
  });

  it('unsets only the active binding scope and displays all raw scope values', async () => {
    const entry = bindingEntry('codex', 'balanced', 'project', {
      global: 'global-policy',
      store: 'store-policy',
      project: 'balanced',
    });
    mount({ entries: [entry] });
    const row = container.querySelector(
      '[data-testid="threshold-binding-row"][data-row="codex"]'
    )!;
    expect(row.textContent).toContain('global: global-policy');
    expect(row.textContent).toContain('store: store-policy');
    expect(row.textContent).toContain('project: balanced');

    await change(row.querySelector('[data-testid="threshold-binding-select"]'), '');
    expect(client.deleteKey).toHaveBeenCalledWith(
      'thresholds.bindings.codex',
      'project',
      'project:proj_x'
    );
  });

  it('makes inherited store rows read-only with an edit-in-store affordance', () => {
    mount({
      entries: [
        bindingEntry('claude', 'balanced', 'store', { store: 'balanced' }),
      ],
      storeRef: {
        id: 'Team Store',
        uid: '11111111-2222-4333-8444-555555555555',
        root: '/stores/team-store',
      },
    });
    const row = container.querySelector(
      '[data-testid="threshold-binding-row"][data-row="claude"]'
    )!;
    expect(
      (row.querySelector('[data-testid="threshold-binding-select"]') as HTMLSelectElement)
        .disabled
    ).toBe(true);
    expect(row.querySelector('a')!.getAttribute('href')).toContain(
      '/s/11111111-2222-4333-8444-555555555555/pipelines'
    );
  });

  it('shows dangling and server fallback diagnostics without performing a binding write', () => {
    mount({
      entries: [
        bindingEntry('codex', 'missing-project-policy', 'project', {
          project: 'missing-project-policy',
        }),
      ],
    });
    const row = container.querySelector(
      '[data-testid="threshold-binding-row"][data-row="codex"]'
    )!;
    expect(row.textContent).toContain('missing-project-policy');
    expect(row.textContent).toContain(
      'Project binding references missing scheme "missing-project-policy".'
    );
    expect(client.putKey).not.toHaveBeenCalled();
    expect(client.deleteKey).not.toHaveBeenCalled();
  });

  it('does not render migration guidance or mutate legacy values when bindings coexist', () => {
    mount({
      entries: [
        bindingEntry('codex', 'balanced', 'project', { project: 'balanced' }),
        legacyEntry('handoff.threshold', 0.7, { project: 0.7 }),
      ],
    });
    expect(
      container.querySelector('[data-testid="threshold-migration-guidance"]')
    ).toBeNull();
    expect(client.mutateThresholdScheme).not.toHaveBeenCalled();
    expect(client.putKey).not.toHaveBeenCalled();
    expect(client.deleteKey).not.toHaveBeenCalled();
  });

  it.each([
    ['missing scheme', 'missing-project-policy'],
    ['invalid scheme', 'broken'],
  ])(
    'does not show migration guidance for a %s binding plus legacy values',
    (_case, scheme) => {
      mount({
        entries: [
          bindingEntry('codex', scheme, 'project', { project: scheme }),
          legacyEntry('handoff.threshold', 0.7, { project: 0.7 }),
        ],
      });

      expect(
        container.querySelector('[data-testid="threshold-migration-guidance"]')
      ).toBeNull();
      expect(client.mutateThresholdScheme).not.toHaveBeenCalled();
      expect(client.putKey).not.toHaveBeenCalled();
      expect(client.deleteKey).not.toHaveBeenCalled();
    }
  );

  it('localizes populated handoff and reuse role labels across a live locale switch', async () => {
    const rawRoleIdentifiers = /\b(?:planner|implementer|reviewer|fixer|shipper)\b/;
    const localizedRoles = {
      en: {
        all: ['Planner', 'Implementer', 'Reviewer', 'Fixer', 'Shipper'],
        handoff: 'Reviewer',
        reuse: 'Implementer',
      },
      'zh-cn': {
        all: ['规划者', '实现者', '审查者', '修复者', '交付者'],
        handoff: '审查者',
        reuse: '实现者',
      },
      ja: {
        all: ['プランナー', '実装担当', 'レビュー担当', '修正担当', '出荷担当'],
        handoff: 'レビュー担当',
        reuse: '実装担当',
      },
    } as const;

    const expectLocalizedRoleSurfaces = (
      locale: keyof typeof localizedRoles
    ): void => {
      const expected = localizedRoles[locale];
      const card = container.querySelector(
        '[data-testid="threshold-scheme-card"][data-scheme="balanced"]'
      )!;
      const editor = container.querySelector('[data-testid="threshold-editor"]')!;
      const handoffOverride = container
        .querySelector('[data-testid="scheme-handoff-role-reviewer"]')!
        .closest('.threshold-editor__role')!;
      const reuseOverride = container
        .querySelector('[data-testid="scheme-reuse-role-implementer"]')!
        .closest('.threshold-editor__role')!;

      expect(card.textContent).toContain(expected.handoff);
      expect(card.textContent).toContain(expected.reuse);
      expect(handoffOverride.textContent).toContain(expected.handoff);
      expect(reuseOverride.textContent).toContain(expected.reuse);
      for (const role of expected.all) {
        expect(editor.textContent).toContain(role);
      }
      expect(card.textContent).not.toMatch(rawRoleIdentifiers);
      expect(editor.textContent).not.toMatch(rawRoleIdentifiers);
    };

    mount();
    const card = container.querySelector(
      '[data-testid="threshold-scheme-card"][data-scheme="balanced"]'
    )!;
    await click(card.querySelector('[data-testid="threshold-scheme-edit"]'));
    expectLocalizedRoleSurfaces('en');

    await act(async () => {
      setLocale('zh-cn');
      await flushMicrotasks();
    });
    expectLocalizedRoleSurfaces('zh-cn');

    await act(async () => {
      setLocale('ja');
      await flushMicrotasks();
    });
    expectLocalizedRoleSurfaces('ja');
  });

  it('re-localizes every feature surface through en, zh-cn, and ja without losing a draft', async () => {
    mount();
    await click(container.querySelector('[data-testid="threshold-scheme-new"]'));
    await input(container.querySelector('[data-testid="threshold-editor-name"]'), 'draft-name');
    expect(container.textContent).toContain('Create threshold scheme');

    await act(async () => {
      setLocale('zh-cn');
      await flushMicrotasks();
    });
    expect(container.textContent).toContain('创建阈值方案');
    expect(
      (container.querySelector('[data-testid="threshold-editor-name"]') as HTMLInputElement)
        .value
    ).toBe('draft-name');

    await act(async () => {
      setLocale('ja');
      await flushMicrotasks();
    });
    expect(container.textContent).toContain('しきい値スキームを作成');
    expect(container.textContent).not.toContain('pipelines.threshold.');
    expect(
      (container.querySelector('[data-testid="threshold-editor-name"]') as HTMLInputElement)
        .value
    ).toBe('draft-name');
  });
});
