// @vitest-environment jsdom
/**
 * Component-level coverage for ConfigEntryRow after the W2 redesign: the
 * per-row Scope select is gone (scope comes from the page mode via props), the
 * row titles on a human label with the dot-path as secondary text, and layer
 * transparency renders as an inherited-value line (with a store-edit link when
 * the store provides the value) or a shadowed reveal.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, putKey: vi.fn(), deleteKey: vi.fn() };
});

import { ConfigEntryRow } from '../../src/components/ConfigEntryRow.js';
import * as client from '../../src/api/client.js';
import {
  configListFixture,
  configListInheritedFixture,
  configListStoreSpaceFixture,
} from '../fixtures/config-list.js';
import type { StoreLayerRef, WireConfigEntry } from '../../src/api/types.js';
import type { ConfigMode, SpaceType } from '../../src/config/controls.js';

const byKey = (key: string): WireConfigEntry =>
  configListFixture.entries.find((e) => e.definition.key === key)!;
const inheritedByKey = (key: string): WireConfigEntry =>
  configListInheritedFixture.entries.find((e) => e.definition.key === key)!;
const storeSpaceByKey = (key: string): WireConfigEntry =>
  configListStoreSpaceFixture.entries.find((e) => e.definition.key === key)!;

interface MountOpts {
  mode?: ConfigMode;
  spaceType?: SpaceType;
  spaceSelector?: string;
  storeRef?: StoreLayerRef | null;
}

function mount(
  entry: WireConfigEntry,
  container: HTMLElement,
  opts: MountOpts = {},
  onEntryUpdated: (entry: WireConfigEntry) => void = () => {}
) {
  const {
    mode = 'local',
    spaceType = 'project',
    spaceSelector = 'project:proj_abc123',
    storeRef = null,
  } = opts;
  act(() => {
    render(
      <ConfigEntryRow
        entry={entry}
        mode={mode}
        spaceType={spaceType}
        spaceSelector={spaceSelector}
        storeRef={storeRef}
        onPageError={() => {}}
        onEntryUpdated={onEntryUpdated}
      />,
      container
    );
  });
}

describe('ConfigEntryRow', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.restoreAllMocks();
  });

  it('titles on a human label with the dot-path as secondary text, and renders no scope select', () => {
    mount(byKey('handoff.threshold'), container);
    expect(container.querySelector('.config-entry__label')?.textContent).toBe('Handoff threshold');
    expect(container.querySelector('.config-entry__key')?.textContent).toBe('handoff.threshold');
    // The per-row Scope select is gone — the only <select> a row can now show
    // is an enum control, and handoff.threshold is a threshold, not an enum.
    expect(container.querySelector('.config-entry__scope-choice')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('B2: resyncs the displayed value when the entry prop is replaced (e.g. after an unset)', () => {
    const withProjectValue = byKey('handoff.threshold'); // value 0.8, source project
    mount(withProjectValue, container);
    let input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('0.8');

    const afterUnset: WireConfigEntry = {
      ...withProjectValue,
      value: 0.6,
      source: 'global',
      scopeValues: { global: 0.6 },
    };
    mount(afterUnset, container);
    input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('0.6');
    expect(container.querySelector('.config-entry__source--global')).not.toBeNull();
  });

  it('mode selects the write target: Global mode writes the global scope', async () => {
    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    putKeyMock.mockResolvedValue({ entry: byKey('proactive'), store: null });
    mount(byKey('proactive'), container, { mode: 'global' }); // proactive: global-only boolean

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(putKeyMock).toHaveBeenCalledTimes(1);
    const [, body] = putKeyMock.mock.calls[0];
    expect(body.scope).toBe('global');
  });

  it('mode selects the write target: Local mode at a project space writes the project scope', async () => {
    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    putKeyMock.mockResolvedValue({ entry: byKey('autopilot.gates'), store: null });
    mount(byKey('autopilot.gates'), container, { mode: 'local', spaceType: 'project' });

    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'off';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    const [, body] = putKeyMock.mock.calls[0];
    expect(body.scope).toBe('project');
  });

  it('Local mode at a store space writes the store scope', async () => {
    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    putKeyMock.mockResolvedValue({ entry: storeSpaceByKey('schema'), store: null });
    mount(storeSpaceByKey('schema'), container, {
      mode: 'local',
      spaceType: 'store',
      spaceSelector: 'store:shared-store',
    });

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      input.value = 'other-schema';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    const [key, body, selector] = putKeyMock.mock.calls[0];
    expect(key).toBe('schema');
    expect(body.scope).toBe('store');
    expect(selector).toBe('store:shared-store');
  });

  it('inherited-from-store row is read-only, names the store, and links to edit in the store', () => {
    const storeRef = { id: 'shared-store', root: '/Users/dev/shared-store' };
    mount(inheritedByKey('autopilot.gates'), container, {
      mode: 'local',
      spaceType: 'project',
      storeRef,
    });

    // Read-only: no enum select, a readonly value span instead.
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('.control--readonly')?.textContent).toContain('off');
    expect(container.textContent).toContain('Inherited from store shared-store: off');

    const link = container.querySelector('a.config-entry__store-edit') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/s/shared-store/config');
    expect(link.textContent).toContain('Edit in store shared-store');
  });

  it('inherited-from-global row shows the global value and remains editable', () => {
    const inheritedFromGlobal: WireConfigEntry = {
      ...byKey('handoff.threshold'),
      value: 0.6,
      source: 'global',
      scopeValues: { global: 0.6 },
    };
    mount(inheritedFromGlobal, container, { mode: 'local', spaceType: 'project' });
    expect(container.textContent).toContain('Inherited from global: 0.6');
    // Editable — the threshold control still renders.
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(container.querySelector('a.config-entry__store-edit')).toBeNull();
  });

  it('renders no store affordance when there is no store ref (no store noise without inheritance)', () => {
    mount(byKey('handoff.threshold'), container, { mode: 'local', spaceType: 'project', storeRef: null });
    expect(container.querySelector('a.config-entry__store-edit')).toBeNull();
    expect(container.textContent).not.toContain('Inherited from store');
  });

  it('unset follows the mode: a single unset button carries the active mode scope', async () => {
    const deleteKeyMock = client.deleteKey as unknown as ReturnType<typeof vi.fn>;
    deleteKeyMock.mockResolvedValue({ entry: byKey('handoff.threshold'), store: null });
    // Local mode at a project space, handoff.threshold has a project value → one unset button.
    mount(byKey('handoff.threshold'), container, { mode: 'local', spaceType: 'project' });

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Unset project value');

    await act(async () => {
      buttons[0]!.click();
      await Promise.resolve();
    });
    const [, scope] = deleteKeyMock.mock.calls[0];
    expect(scope).toBe('project');
  });

  it('unset is not offered when the active mode scope holds no value', () => {
    // Global mode: handoff.threshold has a global value → unset shows "global".
    mount(byKey('autopilot.gates'), container, { mode: 'local', spaceType: 'project' });
    // autopilot.gates is source 'default' with empty scopeValues → no project value → no unset.
    expect(container.querySelector('button')).toBeNull();
  });

  it('dual-form threshold: renders the fraction input by default and switches to the remainingTokens input on the absolute-form radio', () => {
    mount(byKey('handoff.threshold'), container, { mode: 'local', spaceType: 'project' });
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);

    let numberInputs = [...container.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    expect(numberInputs[0].value).toBe('0.8');

    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    putKeyMock.mockResolvedValue({ entry: byKey('handoff.threshold'), store: null });
    act(() => {
      radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    numberInputs = [...container.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    expect(numberInputs).toHaveLength(1);
    expect(Number(numberInputs[0].value)).toBeGreaterThan(0);
  });

  it('config-page-coherence: renders a models.* key as a text input with a datalist of known suggestions', () => {
    const modelKey: WireConfigEntry = {
      definition: {
        key: 'models.roles.reviewer',
        scopes: ['global', 'store', 'project'],
        type: 'string',
        defaultValue: undefined,
        description: 'Per-role model override for the reviewer role',
        group: 'Workflow',
        constraints: { type: 'string' },
      },
      value: 'fable',
      source: 'default',
      scopeValues: {},
    };
    mount(modelKey, container, { mode: 'local', spaceType: 'project' });

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('fable');
    const listId = input.getAttribute('list');
    const datalist = document.getElementById(listId!);
    const options = [...(datalist?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(options).toContain('sonnet-5');
    expect(options).toContain('fable');
  });
});
