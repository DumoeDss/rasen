// @vitest-environment jsdom
/**
 * The shared sectioned-card presentation (ui-profile-workflow-split design D6):
 * one component rendered by both the Workflows page (no toggle context → empty
 * switch slot) and the Profiles page (a ToggleContext → a corner switch bound to
 * draft membership). Internal-kind units never get a switch on either surface.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowSection, type ToggleContext } from '../../src/components/workflow-cards.js';
import type { WorkflowListEntry } from '../../src/api/types.js';

const ENTRIES: WorkflowListEntry[] = [
  { id: 'plan-build', source: 'user', sourcePath: '/x/plan-build', digest: 'facefeed0011', kind: 'driver', skillName: 'rasen-plan-build', title: null, unused: false },
];
const INTERNAL: WorkflowListEntry[] = [
  { id: 'resolve-deps', source: 'built-in', sourcePath: null, digest: 'ba5eba11cafe', kind: 'internal', skillName: 'rasen-resolve-deps', title: null, unused: false },
];

function noop() {}

describe('shared workflow-cards', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  function mount(toggle?: ToggleContext): void {
    act(() => {
      render(
        <WorkflowSection
          heading="Driver"
          testid="workflows-section-driver"
          entries={ENTRIES}
          internal={INTERNAL}
          onOpen={noop}
          onExport={noop}
          onDelete={noop}
          toggle={toggle}
        />,
        container
      );
    });
  }

  it('renders no corner switch without a toggle context', () => {
    mount();
    expect(container.querySelector('[data-id="plan-build"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workflow-card-toggle"]')).toBeNull();
  });

  it('renders a corner switch reflecting draft membership when a toggle context is passed', () => {
    const onToggle = vi.fn();
    const toggle: ToggleContext = {
      stateFor: (id) => (id === 'plan-build' ? { checked: true, disabled: false } : null),
      onToggle,
    };
    mount(toggle);

    const card = container.querySelector('[data-id="plan-build"]')!;
    const sw = card.querySelector('[data-testid="workflow-card-toggle"]') as HTMLButtonElement;
    expect(sw).not.toBeNull();
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');

    act(() => sw.click());
    expect(onToggle).toHaveBeenCalledWith('plan-build', false);
  });

  it('never renders a switch on internal-kind units, even with a toggle context', () => {
    const toggle: ToggleContext = {
      // stateFor would return a state for everything, but the card must still
      // suppress the switch for internal-kind units.
      stateFor: () => ({ checked: false, disabled: false }),
      onToggle: noop,
    };
    mount(toggle);
    // Reveal the internal disclosure so its cards are in the DOM.
    act(() => (container.querySelector('[data-testid="workflows-internal-toggle"]') as HTMLElement).click());
    const internalCard = container.querySelector('[data-id="resolve-deps"]')!;
    expect(internalCard.querySelector('[data-testid="workflow-card-toggle"]')).toBeNull();
  });
});
