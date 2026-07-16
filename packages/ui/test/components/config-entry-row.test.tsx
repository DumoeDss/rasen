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
import { ConfigEntryRow } from '../../src/components/ConfigEntryRow.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const byKey = (key: string): WireConfigEntry =>
  configListFixture.entries.find((e) => e.definition.key === key)!;

function mount(entry: WireConfigEntry, projectId: string | undefined, container: HTMLElement) {
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
        onEntryUpdated={() => {}}
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
});
