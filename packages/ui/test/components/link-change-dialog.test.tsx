// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreIssueProjection: vi.fn(),
    getStoreChangeIssueLinks: vi.fn(),
    publishStoreExecutionPlan: vi.fn(),
    createStoreIssue: vi.fn(),
  };
});

import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type {
  StoreChangeIssueLinkEntry,
  StoreChangeIssueLinksResponse,
  StoreExecutionPlanPublishResponse,
  StoreIssueProjectionEntry,
  StoreIssueProjectionResponse,
  StoreIssueRecordResponse,
} from '../../src/api/types.js';
import { LinkChangeDialog } from '../../src/components/LinkChangeDialog.js';
import {
  issueProjectionsFixture,
  realIssueProjectionFixture,
} from '../fixtures/issue-projection.js';

const selector = 'store:store_x';
const entry: StoreChangeIssueLinkEntry = {
  occurrence: {
    kind: 'active',
    change: {
      changeId: 'existing-node',
      changeInstanceId: 'change-new',
      projectId: 'project-a',
      targetLineId: 'main',
      foundAtRef: 'refs/heads/main',
      localLocator: null,
    },
  },
  association: 'unlinked',
  eligibility: 'attachable',
  issues: [],
};

const openIssue = issueProjectionsFixture.issues.find(issue => issue.issueId === 'issue-ready')!;
const issueChoices: readonly StoreIssueProjectionEntry[] = [openIssue];

function detailFor(issueId = 'issue-ready', revisionId = '0007'): StoreIssueProjectionResponse {
  const issue = {
    ...openIssue,
    issueId,
    record: { ...openIssue.record!, id: issueId, state: 'open' as const },
    latestRevisionId: revisionId,
    revisionIds: [revisionId],
  };
  return {
    ...realIssueProjectionFixture,
    issue,
    plan: {
      ...realIssueProjectionFixture.plan!,
      issueId,
      revisionId,
      revision: {
        ...realIssueProjectionFixture.plan!.revision!,
        issueId,
        revisionId,
        supersedes: revisionId === '0001' ? null : '0006',
        nodes: [
          {
            nodeId: 'existing-node',
            kind: 'change',
            projectId: 'project-b',
            targetLineId: 'release',
            dependsOn: ['intent-node'],
            changeInstanceId: 'change-existing',
            changeAlias: 'existing-change',
            lifecycle: 'deferred',
            reason: 'scheduled later',
            suggestedPipeline: 'small-feature',
            rationale: 'preserve the rationale',
            uncertainty: 'preserve the uncertainty',
          },
          {
            nodeId: 'intent-node',
            kind: 'intent',
            projectId: 'project-a',
            targetLineId: 'main',
            dependsOn: [],
            summary: 'operator intent',
            lifecycle: 'optional',
            reason: 'preserve the intent reason',
            suggestedPipeline: 'full-feature',
            rationale: 'preserve intent rationale',
            uncertainty: 'preserve intent uncertainty',
          },
        ],
      },
    },
  };
}

function linkPayload(candidate: StoreChangeIssueLinkEntry = entry): StoreChangeIssueLinksResponse {
  return { complete: true, unsearchedRefs: [], problems: [], entries: [candidate] };
}

function createResponse(issueId: string): StoreIssueRecordResponse {
  return {
    issueId,
    storeId: 'store_x',
    storeUid: 'store-uid',
    checkoutRoot: 'C:\\planning\\store-x',
    checkoutRef: 'refs/heads/main',
    written: [`rasen/issues/${issueId}/issue.yaml`],
    suggestedCommits: [],
    record: {
      version: 1,
      id: issueId,
      title: 'New Issue',
      state: 'open',
      reason: null,
      createdAt: '2026-08-24T00:00:00.000Z',
    },
  };
}

function publishResponse(issueId: string): StoreExecutionPlanPublishResponse {
  return {
    issueId,
    storeId: 'store_x',
    storeUid: 'store-uid',
    checkoutRoot: 'C:\\planning\\store-x',
    checkoutRef: 'refs/heads/main',
    written: [`rasen/issues/${issueId}/plans/0001.yaml`],
    suggestedCommits: [],
    revision: {
      version: 1,
      issueId,
      revisionId: '0001',
      supersedes: null,
      createdAt: '2026-08-24T00:00:00.000Z',
      contentSha256: 'a'.repeat(64),
      nodes: [],
    },
  };
}

async function flush(times = 16): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === text);
  if (!button) throw new Error(`button not found: ${text}`);
  await act(async () => {
    button.click();
    await flush();
  });
  await act(async () => { await flush(); });
}

async function inputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
  await act(async () => { await flush(); });
}

async function mount(
  container: HTMLElement,
  mode: 'attach' | 'create',
  callbacks: { onClose: () => void; onRefresh: () => void | Promise<void> }
): Promise<void> {
  await act(async () => {
    render(
      <LinkChangeDialog
        entry={entry}
        issues={issueChoices}
        selector={selector}
        initialMode={mode}
        onClose={callbacks.onClose}
        onRefresh={callbacks.onRefresh}
      />,
      container
    );
    await flush();
  });
  await act(async () => { await flush(); });
}

describe('LinkChangeDialog', () => {
  let container: HTMLElement;
  let onClose: ReturnType<typeof vi.fn>;
  let onRefresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onClose = vi.fn();
    onRefresh = vi.fn();
    vi.mocked(client.getStoreIssueProjection).mockResolvedValue(detailFor());
    vi.mocked(client.getStoreChangeIssueLinks).mockResolvedValue(linkPayload());
    vi.mocked(client.createStoreIssue).mockResolvedValue(createResponse('issue-new'));
    vi.mocked(client.publishStoreExecutionPlan).mockResolvedValue(publishResponse('issue-ready'));
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('previews before writing, rejects a duplicate node id, and preserves the full graph on attach', async () => {
    await mount(container, 'attach', { onClose, onRefresh });
    await clickButton(container, 'Load Issue');
    const nodeInput = container.querySelector('.link-change-dialog__node input') as HTMLInputElement;
    expect(nodeInput.value).toBe('existing-node-2');

    await inputValue(nodeInput, 'existing-node');
    expect(container.textContent).toContain('That node ID already exists in this plan.');
    expect((container.querySelector('.link-change-dialog > button') as HTMLButtonElement).disabled).toBe(true);
    await inputValue(nodeInput, 'new-change-node');
    await clickButton(container, 'Preview');
    expect(client.publishStoreExecutionPlan).not.toHaveBeenCalled();
    expect(container.textContent).toContain('base 0007');
    expect(container.textContent).toContain('preserving 2 existing node(s)');

    await clickButton(container, 'Confirm and write');
    expect(client.publishStoreExecutionPlan).toHaveBeenCalledTimes(1);
    const [request, requestSelector] = vi.mocked(client.publishStoreExecutionPlan).mock.calls[0]!;
    expect(requestSelector).toBe(selector);
    expect(request.expectedRevisionId).toBe('0007');
    expect(request.nodes).toEqual([
      {
        nodeId: 'existing-node',
        kind: 'change',
        projectId: 'project-b',
        targetLineId: 'release',
        dependsOn: ['intent-node'],
        changeInstanceId: 'change-existing',
        changeAlias: 'existing-change',
        lifecycle: 'deferred',
        reason: 'scheduled later',
        suggestedPipeline: 'small-feature',
        rationale: 'preserve the rationale',
        uncertainty: 'preserve the uncertainty',
      },
      {
        nodeId: 'intent-node',
        kind: 'intent',
        projectId: 'project-a',
        targetLineId: 'main',
        dependsOn: [],
        summary: 'operator intent',
        lifecycle: 'optional',
        reason: 'preserve the intent reason',
        suggestedPipeline: 'full-feature',
        rationale: 'preserve intent rationale',
        uncertainty: 'preserve intent uncertainty',
      },
      {
        nodeId: 'new-change-node',
        kind: 'change',
        projectId: 'project-a',
        targetLineId: 'main',
        changeInstanceId: 'change-new',
        changeAlias: 'existing-node',
        dependsOn: [],
      },
    ]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes nothing optimistic on a stale revision and refetches both Store-link and Issue truth', async () => {
    vi.mocked(client.getStoreIssueProjection)
      .mockResolvedValueOnce(detailFor('issue-ready', '0007'))
      .mockResolvedValueOnce(detailFor('issue-ready', '0008'));
    vi.mocked(client.publishStoreExecutionPlan).mockRejectedValueOnce(new ApiError(409, {
      error: { code: 'execution_plan_revision_conflict', message: 'stale revision' },
    }));
    await mount(container, 'attach', { onClose, onRefresh });
    await clickButton(container, 'Load Issue');
    await clickButton(container, 'Preview');
    await clickButton(container, 'Confirm and write');

    expect(client.publishStoreExecutionPlan).toHaveBeenCalledTimes(1);
    expect(client.getStoreChangeIssueLinks).toHaveBeenCalledTimes(1);
    expect(client.getStoreIssueProjection).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('The Issue plan changed.');
  });

  it('creates authored Issue intent, then conditionally publishes one exact-scope node', async () => {
    await mount(container, 'create', { onClose, onRefresh });
    const inputs = [...container.querySelectorAll('.link-change-dialog__form input')] as HTMLInputElement[];
    await inputValue(inputs[0]!, 'issue-new');
    await inputValue(inputs[1]!, 'Operator-authored title');
    await inputValue(container.querySelector('.link-change-dialog__node input') as HTMLInputElement, 'new-node');
    await clickButton(container, 'Preview');
    expect(client.createStoreIssue).not.toHaveBeenCalled();
    expect(client.publishStoreExecutionPlan).not.toHaveBeenCalled();
    await clickButton(container, 'Confirm and write');

    expect(client.createStoreIssue).toHaveBeenCalledWith(
      { issueId: 'issue-new', title: 'Operator-authored title' },
      selector
    );
    expect(client.publishStoreExecutionPlan).toHaveBeenCalledWith({
      issueId: 'issue-new',
      expectedRevisionId: null,
      nodes: [{
        nodeId: 'new-node',
        kind: 'change',
        projectId: 'project-a',
        targetLineId: 'main',
        changeInstanceId: 'change-new',
        changeAlias: 'existing-node',
        dependsOn: [],
      }],
    }, selector);
    expect(vi.mocked(client.createStoreIssue).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(client.publishStoreExecutionPlan).mock.invocationCallOrder[0]!);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not publish when Issue creation is refused as a duplicate', async () => {
    vi.mocked(client.createStoreIssue).mockRejectedValueOnce(new ApiError(409, {
      error: { code: 'issue_exists', message: 'Issue already exists' },
    }));
    await mount(container, 'create', { onClose, onRefresh });
    const inputs = [...container.querySelectorAll('.link-change-dialog__form input')] as HTMLInputElement[];
    await inputValue(inputs[0]!, 'issue-ready');
    await inputValue(inputs[1]!, 'Duplicate title');
    await clickButton(container, 'Preview');
    await clickButton(container, 'Confirm and write');

    expect(client.publishStoreExecutionPlan).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Issue already exists');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports an honest partial create outcome and offers attach recovery to the durable Issue', async () => {
    vi.mocked(client.publishStoreExecutionPlan).mockRejectedValueOnce(new ApiError(400, {
      error: { code: 'invalid_execution_plan', message: 'plan refused' },
    }));
    vi.mocked(client.getStoreIssueProjection).mockResolvedValue(detailFor('issue-new', '0001'));
    await mount(container, 'create', { onClose, onRefresh });
    const inputs = [...container.querySelectorAll('.link-change-dialog__form input')] as HTMLInputElement[];
    await inputValue(inputs[0]!, 'issue-new');
    await inputValue(inputs[1]!, 'New Issue');
    await clickButton(container, 'Preview');
    await clickButton(container, 'Confirm and write');

    expect(container.querySelector('[data-testid="unlinked-partial-outcome"]')?.textContent)
      .toContain('Issue issue-new was created, but the Change remains unlinked: plan refused');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await clickButton(container, 'Recover by attaching to this Issue');
    expect(client.getStoreIssueProjection).toHaveBeenCalledWith('issue-new', selector);
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('issue-new');
    expect(container.querySelector('[data-testid="unlinked-partial-outcome"]')).toBeNull();
  });
});
