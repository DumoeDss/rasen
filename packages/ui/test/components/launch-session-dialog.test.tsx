// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    launchSession: vi.fn(),
  };
});

import { LaunchSessionDialog } from '../../src/components/LaunchSessionDialog.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type { SessionRecordWire, SpaceMember } from '../../src/api/types.js';

const MEMBERS: SpaceMember[] = [
  { projectId: 'member-a', name: 'Member A', root: '/projects/a' },
  { projectId: 'member-b', name: 'Member B', root: '/projects/b' },
];

const SESSION: SessionRecordWire = {
  id: 'session-1',
  kind: 'auto',
  task: 'work',
  cwd: '/projects/a',
  state: 'running',
  startedAt: 1,
  lastOutputAt: 1,
};

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function inputTask(container: HTMLElement, task: string): Promise<void> {
  const textarea = container.querySelector('textarea[name="task"]') as HTMLTextAreaElement;
  await act(async () => {
    textarea.value = task;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushMicrotasks();
  });
}

async function submit(container: HTMLElement): Promise<void> {
  await act(async () => {
    (container.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushMicrotasks();
  });
}

describe('LaunchSessionDialog Store execution selection', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.launchSession).mockResolvedValue({ session: SESSION });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  function mount(members: readonly SpaceMember[]): void {
    render(
      <LaunchSessionDialog
        space="store:team-store"
        members={members}
        onCancel={() => {}}
        onLaunched={() => {}}
      />,
      container
    );
  }

  it('gates a multi-member Store until the user selects a member, then submits that member', async () => {
    mount(MEMBERS);
    const launch = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(container.querySelector('input[name="execution"]:checked')).toBeNull();
    expect(launch.disabled).toBe(true);

    const memberA = container.querySelector(
      'input[name="execution"][value="project:/projects/a"]'
    ) as HTMLInputElement;
    await act(async () => {
      memberA.click();
      await flushMicrotasks();
    });
    expect(launch.disabled).toBe(false);

    await inputTask(container, 'Run on A');
    await submit(container);
    expect(client.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ execution: 'project:/projects/a', space: 'store:team-store' })
    );
  });

  it('clears an auto-selected sole member when another member arrives', async () => {
    mount([MEMBERS[0]!]);
    expect(
      (
        container.querySelector(
          'input[name="execution"][value="project:/projects/a"]'
        ) as HTMLInputElement
      ).checked
    ).toBe(true);

    await act(async () => {
      mount(MEMBERS);
      await flushMicrotasks();
    });

    expect(container.querySelector('input[name="execution"]:checked')).toBeNull();
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('synchronously gates an auto-selected member when inventory expands before effects flush', async () => {
    mount([MEMBERS[0]!]);
    await inputTask(container, 'Do not infer consent for A');

    // Intentionally do not wrap this refresh in act(): the committed render
    // must already be safe before Preact flushes passive effects.
    mount(MEMBERS);

    const launch = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect.soft(container.querySelector('input[name="execution"]:checked')).toBeNull();
    expect.soft(launch.disabled).toBe(true);
    (container.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(client.launchSession).not.toHaveBeenCalled();
  });

  it('retains an explicit member choice across inventory refreshes while it remains valid', async () => {
    mount(MEMBERS);
    const memberB = container.querySelector(
      'input[name="execution"][value="project:/projects/b"]'
    ) as HTMLInputElement;
    await act(async () => {
      memberB.click();
      await flushMicrotasks();
    });

    await act(async () => {
      mount([
        ...MEMBERS,
        { projectId: 'member-c', name: 'Member C', root: '/projects/c' },
      ]);
      await flushMicrotasks();
    });

    expect(
      (
        container.querySelector(
          'input[name="execution"][value="project:/projects/b"]'
        ) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('drops an explicit project that disappears and safely follows current inventory', async () => {
    mount(MEMBERS);
    const memberA = container.querySelector(
      'input[name="execution"][value="project:/projects/a"]'
    ) as HTMLInputElement;
    await act(async () => {
      memberA.click();
      await flushMicrotasks();
    });

    await act(async () => {
      mount([MEMBERS[1]!]);
      await flushMicrotasks();
    });
    expect(
      (
        container.querySelector(
          'input[name="execution"][value="project:/projects/b"]'
        ) as HTMLInputElement
      ).checked
    ).toBe(true);

    await act(async () => {
      mount([
        MEMBERS[1]!,
        { projectId: 'member-c', name: 'Member C', root: '/projects/c' },
      ]);
      await flushMicrotasks();
    });
    expect(container.querySelector('input[name="execution"]:checked')).toBeNull();
  });

  it('synchronously rejects a removed explicit project before effects flush', async () => {
    mount(MEMBERS);
    const memberA = container.querySelector(
      'input[name="execution"][value="project:/projects/a"]'
    ) as HTMLInputElement;
    await act(async () => {
      memberA.click();
      await flushMicrotasks();
    });
    await inputTask(container, 'Never submit stale A');

    // A disappears into a still-ambiguous inventory. Submission must be
    // blocked by this render, not by later passive reconciliation.
    mount([
      MEMBERS[1]!,
      { projectId: 'member-c', name: 'Member C', root: '/projects/c' },
    ]);

    const launch = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect.soft(container.querySelector('input[name="execution"]:checked')).toBeNull();
    expect.soft(launch.disabled).toBe(true);
    (container.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(client.launchSession).not.toHaveBeenCalled();
  });

  it('distinguishes same-id clones by registered root and submits the selected clone', async () => {
    const clones: SpaceMember[] = [
      { projectId: 'shared-id', name: 'Clone A', root: '/projects/clone-a' },
      { projectId: 'shared-id', name: 'Clone B', root: '/projects/clone-b' },
    ];
    mount(clones);

    const cloneB = container.querySelector(
      'input[name="execution"][value="project:/projects/clone-b"]'
    ) as HTMLInputElement;
    expect(cloneB).not.toBeNull();
    await act(async () => {
      cloneB.click();
      await flushMicrotasks();
    });

    await inputTask(container, 'Run in clone B');
    await submit(container);
    expect(client.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: 'project:/projects/clone-b',
        space: 'store:team-store',
      })
    );
  });

  it('submits planning-only only after that separate option is explicitly selected', async () => {
    mount(MEMBERS);
    const planning = container.querySelector(
      'input[name="execution"][value="planning"]'
    ) as HTMLInputElement;
    expect(planning.checked).toBe(false);
    await act(async () => {
      planning.click();
      await flushMicrotasks();
    });

    await inputTask(container, 'Plan only');
    await submit(container);
    expect(client.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ execution: 'planning' })
    );
  });

  it('retains an explicit planning-only choice across inventory refreshes', async () => {
    mount(MEMBERS);
    const planning = container.querySelector(
      'input[name="execution"][value="planning"]'
    ) as HTMLInputElement;
    await act(async () => {
      planning.click();
      await flushMicrotasks();
    });
    await inputTask(container, 'Keep planning attribution');

    mount([
      ...MEMBERS,
      { projectId: 'member-c', name: 'Member C', root: '/projects/c' },
    ]);

    expect(
      (container.querySelector('input[name="execution"][value="planning"]') as HTMLInputElement)
        .checked
    ).toBe(true);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false
    );
    (container.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(client.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ execution: 'planning' })
    );
  });

  it('invents no project for a zero-member Store and offers only explicit planning-only', () => {
    mount([]);
    expect(container.querySelectorAll('input[name="execution"][value^="project:"]')).toHaveLength(0);
    expect(container.querySelector('.launch-session-dialog__execution-empty')).not.toBeNull();
    expect(
      (container.querySelector('input[name="execution"][value="planning"]') as HTMLInputElement).checked
    ).toBe(false);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the dialog open and renders a stale-member server message verbatim', async () => {
    vi.mocked(client.launchSession).mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'execution_unavailable',
          message: 'Member A is no longer attached to team-store. Choose another execution target.',
        },
      })
    );
    mount([MEMBERS[0]!]);
    await inputTask(container, 'Run on stale A');
    await submit(container);

    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Member A is no longer attached to team-store. Choose another execution target.'
    );
  });

  describe('members with no checkout on this machine', () => {
    // A Store may record a member whose checkout does not exist here
    // (`store-project-membership`): it is listed with identity and name and
    // NO root. `project:${undefined}` is a selector the server rejects, so
    // such a member must never be offered as a choice.
    const ROOTLESS: SpaceMember = { projectId: 'member-c', name: 'Member C' };

    it('never renders a project:undefined selector for a rootless member', () => {
      mount([MEMBERS[0]!, ROOTLESS]);
      expect(container.innerHTML).not.toContain('project:undefined');
      expect(
        container.querySelector('input[name="execution"][value="project:undefined"]')
      ).toBeNull();
    });

    it('lists the rootless member but leaves it unselectable', () => {
      mount([MEMBERS[0]!, ROOTLESS]);
      expect(container.textContent).toContain('Member C');
      const disabled = Array.from(
        container.querySelectorAll('input[name="execution"]')
      ).filter((input) => (input as HTMLInputElement).disabled);
      expect(disabled).toHaveLength(1);
    });

    it('auto-selects the sole LAUNCHABLE member when the other has no checkout', () => {
      mount([MEMBERS[0]!, ROOTLESS]);
      const checked = container.querySelector(
        'input[name="execution"]:checked'
      ) as HTMLInputElement | null;
      expect(checked?.value).toBe('project:/projects/a');
    });

    it('gates the launch when every member is rootless', () => {
      mount([ROOTLESS]);
      expect(container.querySelector('input[name="execution"]:checked')).toBeNull();
      expect(
        (container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled
      ).toBe(true);
    });
  });
});
