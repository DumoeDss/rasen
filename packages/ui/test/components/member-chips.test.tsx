// @vitest-environment jsdom
/**
 * MemberChips (ui-space-redesign-task-board design D4 / board-ui spec): an
 * "All" chip plus one per store member, controlled selection, and no chip row
 * for a project space (the parent simply does not render the component).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberChips } from '../../src/components/MemberChips.js';
import type { SpaceMember } from '../../src/api/types.js';

const MEMBERS: SpaceMember[] = [
  { projectId: 'proj_a', name: 'Repo A', root: '/a' },
  { projectId: 'proj_b', name: 'Repo B', root: '/b' },
];

describe('MemberChips', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders All plus one chip per member, with All selected by default', () => {
    render(<MemberChips members={MEMBERS} selected={null} onSelect={() => {}} />, container);
    const chips = Array.from(container.querySelectorAll('.member-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['All', 'Repo A', 'Repo B']);
    const all = chips[0]!;
    expect(all.classList.contains('member-chip--selected')).toBe(true);
    expect(all.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the selected member chip', () => {
    render(<MemberChips members={MEMBERS} selected="proj_b" onSelect={() => {}} />, container);
    const chips = Array.from(container.querySelectorAll('.member-chip'));
    expect(chips[0]!.classList.contains('member-chip--selected')).toBe(false); // All
    expect(chips[2]!.classList.contains('member-chip--selected')).toBe(true); // Repo B
  });

  it('reports the member id on select and null when All is chosen', async () => {
    const onSelect = vi.fn();
    render(<MemberChips members={MEMBERS} selected="proj_a" onSelect={onSelect} />, container);
    const chips = Array.from(container.querySelectorAll('.member-chip')) as HTMLButtonElement[];

    await act(async () => {
      chips[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // Repo A
    });
    expect(onSelect).toHaveBeenLastCalledWith('proj_a');

    await act(async () => {
      chips[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // All
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
