// @vitest-environment jsdom
/**
 * TaskCard (ui-space-redesign-task-board design D6 / board-ui spec):
 * portfolio vs single progress rendering, the live-run indicator's presence
 * and absence, and a Task-detail link built through `spaceHref` so the opaque
 * space token and Task id round-trip unchanged.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskCard } from '../../src/components/TaskCard.js';
import type { Task } from '../../src/board/columns.js';
import type { Space } from '../../src/store/use-space.js';

const SPACE: Space = { type: 'project', id: 'proj_x', selector: 'project:proj_x' };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'ui-redesign',
    label: 'ui-redesign',
    kind: 'portfolio',
    children: [],
    column: 'in-progress',
    escalated: false,
    progress: { done: 2, total: 3 },
    ...overrides,
  };
}

describe('TaskCard', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders portfolio progress as "N/M changes"', () => {
    render(<TaskCard task={task({ kind: 'portfolio', progress: { done: 2, total: 3 } })} space={SPACE} />, container);
    expect(container.querySelector('.board-card__progress')!.textContent).toBe('2/3 changes');
  });

  it('renders single-item progress as "N/M tasks"', () => {
    render(
      <TaskCard task={task({ id: 'fix-login', label: 'fix-login', kind: 'single', progress: { done: 4, total: 6 } })} space={SPACE} />,
      container
    );
    expect(container.querySelector('.board-card__progress')!.textContent).toBe('4/6 tasks');
  });

  it('shows the live indicator with its stage when the Task is live', () => {
    render(<TaskCard task={task({ liveStage: 'full-feature · apply' })} space={SPACE} />, container);
    const live = container.querySelector('[data-testid="task-card-live"]');
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain('full-feature · apply');
  });

  it('shows no live indicator when the Task is not live', () => {
    render(<TaskCard task={task({ liveStage: undefined })} space={SPACE} />, container);
    expect(container.querySelector('[data-testid="task-card-live"]')).toBeNull();
  });

  it('links the card to the Task detail route through spaceHref (opaque id round-trip)', () => {
    render(<TaskCard task={task({ id: 'ui-redesign' })} space={SPACE} />, container);
    const link = container.querySelector('a.task-card__link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/p/proj_x/task/ui-redesign');
  });

  it('renders without a link when no space is resolvable', () => {
    render(<TaskCard task={task()} space={null} />, container);
    expect(container.querySelector('a.task-card__link')).toBeNull();
    expect(container.querySelector('[data-testid="task-card"]')).not.toBeNull();
  });

  it('shows an escalation badge when any child is escalated', () => {
    render(<TaskCard task={task({ escalated: true })} space={SPACE} />, container);
    expect(container.querySelector('.board-card__badge--escalated')).not.toBeNull();
  });
});
