// @vitest-environment jsdom
/**
 * Component-level coverage for StoreIssuesView (`store-issue-resources`
 * board-ui spec): the Store-level Issues list + detail, requirement 2
 * ("Cross-project Issues are a Store-level view... an unreadable reference is
 * shown with the reason, never omitted") on the plan-node render, and
 * requirement 3 ("An aggregate mutation never submits with incomplete scope;
 * a sole candidate is not adopted") on the publish-plan form. The `satisfies`
 * fixtures it imports are the `tsc` drift tripwire.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreIssues: vi.fn(),
    getStoreIssue: vi.fn(),
    getStoreProjects: vi.fn(),
    getStoreTargetLines: vi.fn(),
    createStoreIssue: vi.fn(),
    setStoreIssueState: vi.fn(),
    publishStoreExecutionPlan: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { StoreIssuesView } from '../../src/components/StoreIssuesView.js';
import * as client from '../../src/api/client.js';
import {
  storeIssueDetailFixture,
  storeIssuesFixture,
  storeProjectsFixture,
  storeTargetLinesFixture,
} from '../fixtures/store-aggregate.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAtSpace(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <StoreIssuesView />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

async function selectIssue(container: HTMLElement): Promise<void> {
  const row = container.querySelector('[data-testid="store-issue-row"][data-issue="iss_1"]') as HTMLButtonElement;
  await act(async () => {
    row.click();
    await flushMicrotasks();
  });
}

describe('StoreIssuesView', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.getStoreIssues as any).mockResolvedValue(storeIssuesFixture);
    (client.getStoreIssue as any).mockResolvedValue(storeIssueDetailFixture);
    (client.getStoreProjects as any).mockResolvedValue(storeProjectsFixture);
    (client.getStoreTargetLines as any).mockResolvedValue(storeTargetLinesFixture);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('lists Issues and loads a selected Issue\'s detail via the Store selector', async () => {
    await mountAtSpace(container, '/s/store_x/board');

    const rows = Array.from(container.querySelectorAll('[data-testid="store-issue-row"]'));
    expect(rows.map((r) => r.getAttribute('data-issue'))).toEqual(['iss_1']);
    expect(client.getStoreIssues).toHaveBeenCalledWith('store:store_x');

    await selectIssue(container);

    expect(client.getStoreIssue).toHaveBeenCalledWith('iss_1', 'store:store_x');
    expect(container.querySelector('[data-testid="store-issue-detail"]')?.getAttribute('data-issue')).toBe('iss_1');
    expect(container.querySelector('[data-testid="store-issue-detail-state"]')?.textContent).toContain('open');
  });

  it('shows every plan node, marking an unreadable reference with its status rather than omitting it', async () => {
    await mountAtSpace(container, '/s/store_x/board');
    await selectIssue(container);

    const nodes = Array.from(container.querySelectorAll('[data-testid="store-issue-plan-node"]'));
    expect(nodes.map((n) => n.getAttribute('data-node'))).toEqual(['n1', 'n2']);

    const readableNode = nodes.find((n) => n.getAttribute('data-node') === 'n1')!;
    expect(readableNode.getAttribute('data-status')).toBe('resolved');
    expect(readableNode.getAttribute('data-readable')).toBe('true');
    expect(readableNode.querySelector('[data-testid="store-issue-plan-node-unreadable"]')).toBeNull();

    const unreadableNode = nodes.find((n) => n.getAttribute('data-node') === 'n2')!;
    expect(unreadableNode.getAttribute('data-status')).toBe('unresolved');
    expect(unreadableNode.getAttribute('data-readable')).toBe('false');
    const badge = unreadableNode.querySelector('[data-testid="store-issue-plan-node-unreadable"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('unresolved');
  });

  it('never pre-selects the publish-plan scope, even with exactly one project and one target line', async () => {
    await mountAtSpace(container, '/s/store_x/board');
    await selectIssue(container);

    const projectSelect = container.querySelector('[data-testid="store-plan-node-0-project"]') as HTMLSelectElement;
    const targetLineSelect = container.querySelector('[data-testid="store-plan-node-0-target-line"]') as HTMLSelectElement;
    // Exactly one non-placeholder option is available on each — the sole
    // candidate must still not be adopted automatically.
    expect(projectSelect.querySelectorAll('option')).toHaveLength(2);
    expect(targetLineSelect.querySelectorAll('option')).toHaveLength(2);
    expect(projectSelect.value).toBe('');
    expect(targetLineSelect.value).toBe('');

    const submit = container.querySelector('[data-testid="store-plan-submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('blocks Publish while the draft node scope is incomplete, then submits once every field is filled', async () => {
    await mountAtSpace(container, '/s/store_x/board');
    await selectIssue(container);

    const submit = container.querySelector('[data-testid="store-plan-submit"]') as HTMLButtonElement;
    const idInput = container.querySelector('[data-testid="store-plan-node-0-id"]') as HTMLInputElement;
    const changeIdInput = container.querySelector('[data-testid="store-plan-node-0-change-instance-id"]') as HTMLInputElement;

    // Fill everything except scope: still disabled.
    await act(async () => {
      setValue(idInput, 'n9');
      setValue(changeIdInput, 'chg_9');
      await flushMicrotasks();
    });
    expect(submit.disabled).toBe(true);
    expect(client.publishStoreExecutionPlan).not.toHaveBeenCalled();

    const projectSelect = container.querySelector('[data-testid="store-plan-node-0-project"]') as HTMLSelectElement;
    const targetLineSelect = container.querySelector('[data-testid="store-plan-node-0-target-line"]') as HTMLSelectElement;
    await act(async () => {
      setValue(projectSelect, 'proj_a');
      setValue(targetLineSelect, 'main');
      await flushMicrotasks();
    });
    expect(submit.disabled).toBe(false);

    (client.publishStoreExecutionPlan as any).mockResolvedValue({
      unsearchedRefs: [],
      complete: true,
      revision: storeIssueDetailFixture.plan!.revision,
      report: { proposedNew: [], claimed: [], skipped: [], resultingNodeCount: 1, priorRevisionId: '0001' },
    });

    await act(async () => {
      submit.click();
      await flushMicrotasks();
    });

    expect(client.publishStoreExecutionPlan).toHaveBeenCalledWith(
      {
        issueId: 'iss_1',
        nodes: [
          {
            nodeId: 'n9',
            kind: 'change',
            projectId: 'proj_a',
            targetLineId: 'main',
            changeInstanceId: 'chg_9',
            changeAlias: undefined,
          },
        ],
      },
      'store:store_x'
    );
  });

  it('submits a new Issue only once both id and title are filled', async () => {
    await mountAtSpace(container, '/s/store_x/board');

    const submit = container.querySelector('[data-testid="store-issue-create-submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const idInput = container.querySelector('[data-testid="store-issue-create-id"]') as HTMLInputElement;
    const titleInput = container.querySelector('[data-testid="store-issue-create-title"]') as HTMLInputElement;
    await act(async () => {
      setValue(idInput, 'iss_2');
      setValue(titleInput, 'New rollout');
      await flushMicrotasks();
    });
    expect(submit.disabled).toBe(false);

    (client.createStoreIssue as any).mockResolvedValue({
      unsearchedRefs: [],
      complete: true,
      issue: storeIssuesFixture.issues[0],
      report: { created: true, updated: false, conflicted: false },
    });

    await act(async () => {
      submit.click();
      await flushMicrotasks();
    });

    expect(client.createStoreIssue).toHaveBeenCalledWith(
      { issueId: 'iss_2', title: 'New rollout', readme: false },
      'store:store_x'
    );
  });

  it('submits a state change for the selected Issue', async () => {
    await mountAtSpace(container, '/s/store_x/board');
    await selectIssue(container);

    const stateSelect = container.querySelector('[data-testid="store-issue-state-select"]') as HTMLSelectElement;
    const reasonInput = container.querySelector('[data-testid="store-issue-state-reason"]') as HTMLTextAreaElement;
    await act(async () => {
      setValue(stateSelect, 'resolved');
      setValue(reasonInput, 'shipped');
      await flushMicrotasks();
    });

    (client.setStoreIssueState as any).mockResolvedValue({
      unsearchedRefs: [],
      complete: true,
      issue: storeIssuesFixture.issues[0],
      report: { created: false, updated: true, conflicted: false },
    });

    const submit = container.querySelector('[data-testid="store-issue-state-submit"]') as HTMLButtonElement;
    await act(async () => {
      submit.click();
      await flushMicrotasks();
    });

    expect(client.setStoreIssueState).toHaveBeenCalledWith(
      { issueId: 'iss_1', state: 'resolved', reason: 'shipped' },
      'store:store_x'
    );
  });

  it('shows an explicit empty state when the Store has no Issues', async () => {
    (client.getStoreIssues as any).mockResolvedValue({ unsearchedRefs: [], complete: true, issues: [] });
    await mountAtSpace(container, '/s/store_x/board');

    expect(container.querySelector('[data-testid="store-issues-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="store-issues-list"]')).toBeNull();
  });
});
