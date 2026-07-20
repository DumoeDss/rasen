// @vitest-environment jsdom
/**
 * Component-level coverage for ConfigEntryRow (review round 1, m5): nothing
 * previously rendered this component, which is exactly the layer where B1
 * (project-scope gating) and B2 (stale draft after the entry prop updates)
 * lived — a jsdom render is the only way to catch either.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the API client so a radio-toggle's immediate commit (MIN-M3) resolves
// synchronously with a fake re-resolved entry instead of hitting a real
// server. `ApiError` stays the real class (imported by the component for an
// `instanceof` check on failure).
vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    putKey: vi.fn(),
    deleteKey: vi.fn(),
  };
});

import { ConfigEntryRow } from '../../src/components/ConfigEntryRow.js';
import * as client from '../../src/api/client.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const byKey = (key: string): WireConfigEntry =>
  configListFixture.entries.find((e) => e.definition.key === key)!;

function mount(
  entry: WireConfigEntry,
  projectId: string | undefined,
  container: HTMLElement,
  onEntryUpdated: (entry: WireConfigEntry) => void = () => {}
) {
  // `act` flushes preact's effect queue synchronously so the useEffect
  // resync (B2's fix) has already run before the assertions below query the
  // DOM — without it, `useEffect` runs on a microtask preact schedules
  // itself and a bare `render()` call would race it.
  act(() => {
    render(
      <ConfigEntryRow
        entry={entry}
        projectId={projectId}
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

  it('B2: resyncs the displayed value when the entry prop is replaced (e.g. after an unset)', () => {
    const withProjectValue = byKey('handoff.threshold'); // value 0.8, source project, shadows global 0.6
    mount(withProjectValue, 'proj_abc123', container);

    let input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('0.8');

    // Simulate the server's re-resolved entry after an unset: value reverts
    // to the shadowed global value, source flips to "global".
    const afterUnset: WireConfigEntry = {
      ...withProjectValue,
      value: 0.6,
      source: 'global',
      scopeValues: { global: 0.6 },
    };
    mount(afterUnset, 'proj_abc123', container);

    input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('0.6'); // was stuck at "0.8" before the B2 fix
    expect(container.querySelector('.config-entry__source--global')).not.toBeNull();
  });

  it('B1: a project-only key is disabled with a hint when no project is selected', () => {
    const projectOnly = byKey('autopilot.gates');
    mount(projectOnly, undefined, container);

    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('.control--readonly')).not.toBeNull();
    expect(container.textContent).toContain('select a project above to edit');
  });

  it('B1: the same project-only key becomes editable once a project is selected', () => {
    const projectOnly = byKey('autopilot.gates');
    mount(projectOnly, 'proj_abc123', container);

    expect(container.querySelector('select')).not.toBeNull();
    expect(container.querySelector('.control--readonly')).toBeNull();
  });

  it('B1: a dual-scope key stays editable (global only) with no project selected, and hides the project unset button', () => {
    const dualScope = byKey('handoff.threshold');
    mount(dualScope, undefined, container);

    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).not.toContain('Unset project value');
  });

  it('dual-form threshold: renders the fraction input by default and switches to the remainingTokens input on the absolute-form radio', () => {
    const threshold = byKey('handoff.threshold'); // value 0.8 (fraction form)
    mount(threshold, 'proj_abc123', container);

    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true); // fraction radio starts selected
    expect(radios[1].checked).toBe(false);

    let numberInputs = [...container.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    expect(numberInputs).toHaveLength(1);
    expect(numberInputs[0].value).toBe('0.8');

    act(() => {
      radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    });

    numberInputs = [...container.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    expect(numberInputs).toHaveLength(1);
    // Switched to the absolute-form input, seeded with a value above the floor.
    expect(Number(numberInputs[0].value)).toBeGreaterThan(0);
  });

  it('dual-form threshold: an absolute-form value starts with the remainingTokens radio selected', () => {
    const threshold = byKey('handoff.threshold');
    const absoluteForm: WireConfigEntry = {
      ...threshold,
      value: { remainingTokens: 60_000 },
      scopeValues: { ...threshold.scopeValues, project: { remainingTokens: 60_000 } },
    };
    mount(absoluteForm, 'proj_abc123', container);

    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);

    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput.value).toBe('60000');
  });

  it('MIN-M3: selecting the absolute-form radio commits immediately with a sensible seed, instead of leaving the display diverged from the stored value', async () => {
    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    const threshold = byKey('handoff.threshold'); // value 0.8 (fraction form), project scope
    const updated: WireConfigEntry[] = [];
    putKeyMock.mockResolvedValue({
      entry: { ...threshold, value: { remainingTokens: 50_000 }, scopeValues: { ...threshold.scopeValues, project: { remainingTokens: 50_000 } } },
    });

    mount(threshold, 'proj_abc123', container, (e) => updated.push(e));

    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    await act(async () => {
      radios[1].dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    // The toggle wrote through immediately (not deferred to a subsequent
    // number-input edit) with a sensible, always-valid seed — not the
    // boundary value `remainingTokensGt + 1`.
    expect(putKeyMock).toHaveBeenCalledTimes(1);
    const [, body] = putKeyMock.mock.calls[0];
    expect(body.value).toEqual({ remainingTokens: 50_000 });
    expect(body.scope).toBe('project');
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toEqual({ remainingTokens: 50_000 });
  });

  it('MIN-M3: selecting the fraction-form radio from an absolute value commits immediately', async () => {
    const putKeyMock = client.putKey as unknown as ReturnType<typeof vi.fn>;
    const threshold = byKey('handoff.threshold');
    const absoluteForm: WireConfigEntry = {
      ...threshold,
      value: { remainingTokens: 60_000 },
      scopeValues: { ...threshold.scopeValues, project: { remainingTokens: 60_000 } },
    };
    putKeyMock.mockResolvedValue({
      entry: { ...threshold, value: 0.5, scopeValues: { ...threshold.scopeValues, project: 0.5 } },
    });

    mount(absoluteForm, 'proj_abc123', container);

    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    await act(async () => {
      radios[0].dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(putKeyMock).toHaveBeenCalledTimes(1);
    const [, body] = putKeyMock.mock.calls[0];
    expect(body.value).toBe(0.5);
  });

  it('config-page-coherence: renders a models.* key as a text input with a datalist of known suggestions', () => {
    const modelKey: WireConfigEntry = {
      definition: {
        key: 'models.roles.reviewer',
        scopes: ['global', 'project'],
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
    mount(modelKey, 'proj_abc123', container);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('fable');
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const datalist = document.getElementById(listId!);
    expect(datalist).not.toBeNull();
    const options = [...(datalist?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(options).toContain('sonnet-5');
    expect(options).toContain('fable');

    // A typed id matching no suggestion is still accepted (no allow-list).
    act(() => {
      input.value = 'not-a-real-model-xyz';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(input.value).toBe('not-a-real-model-xyz');
  });
});
