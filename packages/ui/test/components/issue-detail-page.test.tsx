// @vitest-environment jsdom
/**
 * Component coverage for the Issue Detail (issue-board-ui spec requirements
 * 4 and 5).
 *
 * Same traceability spine as the Board's suite: each assertion reads the value
 * out of the mocked payload and expects THAT value on screen, so a section that
 * re-derived or invented a fact would fail rather than coincidentally agree.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreIssueProjection: vi.fn(),
    getStoreIssueAttention: vi.fn(),
  };
});

import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { IssueDetailPage } from '../../src/components/IssueDetailPage.js';
import * as client from '../../src/api/client.js';
import {
  ISSUE_IDENTITIES,
  issueAttentionNarrowedFixture,
  issueAttentionUnreadableFixture,
  realIssueProjectionFixture,
  unreadableIssueProjectionFixture,
  v2IssueProjectionFixture,
} from '../fixtures/issue-projection.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAtSpace(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <Router>
          <Route path="/s/:storeId/issues/:issueId" component={IssueDetailPage} />
          {/* A second child so `Router`'s children type is the array it
              declares, and a visible marker if the route above ever stops
              matching (which would otherwise look like an empty render). */}
          <Route default component={() => <div data-testid="unmatched-route" />} />
        </Router>
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

const REAL_PATH = `/s/store_x/issues/${ISSUE_IDENTITIES.auto.uid}`;

function RoutedIssueDetail() {
  const { route } = useLocation();
  return (
    <>
      <button data-testid="route-issue-b" onClick={() => route('/s/store%3Aa/issues/issue-b')}>Issue B</button>
      <button data-testid="route-store-b" onClick={() => route('/s/store_b/issues/issue-store-b')}>Store B</button>
      <Router>{[<Route path="/s/:storeId/issues/:issueId" component={IssueDetailPage} />]}</Router>
    </>
  );
}

describe('IssueDetailPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.getStoreIssueProjection as any).mockResolvedValue(realIssueProjectionFixture);
    (client.getStoreIssueAttention as any).mockResolvedValue(issueAttentionNarrowedFixture);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('fetches the Issue named by the URL and its narrowed attention scan', async () => {
    await mountAtSpace(container, REAL_PATH);
    expect((client.getStoreIssueProjection as any).mock.calls[0]).toEqual([
      ISSUE_IDENTITIES.auto.uid,
      'store:store_x',
    ]);
    expect((client.getStoreIssueAttention as any).mock.calls[0]).toEqual([
      'store:store_x',
      ISSUE_IDENTITIES.auto.uid,
    ]);
  });

  it('shows the human key and UID, and replaces a compatible legacy deep link with the canonical UID route', async () => {
    await mountAtSpace(container, '/s/store_x/issues/issue-autodecompose-uplift');
    await act(async () => { await flushMicrotasks(20); });

    expect(container.querySelector('[data-testid="issue-detail-key"]')?.textContent)
      .toBe(ISSUE_IDENTITIES.auto.key);
    expect(container.querySelector('[data-testid="issue-detail-uid"]')?.textContent)
      .toBe(ISSUE_IDENTITIES.auto.uid);
    expect(window.location.pathname).toBe(REAL_PATH);
    expect((client.getStoreIssueProjection as any).mock.calls).toContainEqual([
      'issue-autodecompose-uplift',
      'store:store_x',
    ]);
    expect((client.getStoreIssueProjection as any).mock.calls).toContainEqual([
      ISSUE_IDENTITIES.auto.uid,
      'store:store_x',
    ]);
  });

  it('renders version-2 Issue, plan, acceptance-conditions, and accepted-record resources', async () => {
    (client.getStoreIssueProjection as any).mockResolvedValue(v2IssueProjectionFixture);
    await mountAtSpace(container, REAL_PATH);

    expect(container.querySelector('[data-testid="issue-detail-record-identity"]')?.textContent)
      .toContain('v2');
    expect(container.querySelector('[data-testid="issue-detail-record-identity"]')?.textContent)
      .toContain(ISSUE_IDENTITIES.auto.key);
    expect(container.querySelector('[data-testid="issue-detail-plan"]')?.textContent)
      .toContain(v2IssueProjectionFixture.plan!.revision!.revisionId);
    expect(container.querySelector('[data-testid="issue-detail-acceptance"]')?.textContent)
      .toContain(v2IssueProjectionFixture.status.acceptance!.record!.acceptedAt);
  });

  it('renders one exact provenance target per state family and preserves payload locators verbatim', async () => {
    await mountAtSpace(container, REAL_PATH);
    const entries = [...container.querySelectorAll('[data-testid="issue-provenance-entry"]')];
    expect(entries).toHaveLength(7);
    expect(entries.map((entry) => entry.getAttribute('data-provenance-kind'))).toEqual([
      'git', 'git', 'git', 'runtime', 'git', 'git', 'runtime',
    ]);
    for (const anchor of [
      'issue-provenance-record',
      'issue-provenance-plan',
      'issue-provenance-acceptance',
      'issue-provenance-runtime',
      'issue-provenance-delivery',
      'issue-provenance-attention-git',
      'issue-provenance-attention-runtime',
    ]) {
      expect(container.querySelectorAll(`#${anchor}`), anchor).toHaveLength(1);
    }

    const record = container.querySelector('#issue-provenance-record')!;
    expect(record.textContent).toContain(realIssueProjectionFixture.issue.refs[0]!);
    expect(record.textContent).toContain(realIssueProjectionFixture.issue.latestRevisionId);
    const plan = container.querySelector('#issue-provenance-plan')!;
    expect(plan.textContent).toContain(realIssueProjectionFixture.plan.revision.contentSha256);
    expect(plan.textContent).toContain(realIssueProjectionFixture.plan.revision.nodes[0]!.changeInstanceId!);
    const acceptance = container.querySelector('#issue-provenance-acceptance')!;
    expect(acceptance.textContent).toContain(realIssueProjectionFixture.status.acceptance.record.contentSha256);
    expect(acceptance.textContent).toContain(realIssueProjectionFixture.review.threads[0]!.names[0]!);
    const runtime = container.querySelector('#issue-provenance-runtime')!;
    expect(runtime.textContent).toContain(realIssueProjectionFixture.status.runStateVisibility.executionRoot);
    expect(runtime.textContent).toContain(realIssueProjectionFixture.status.nodes[1]!.attribution.evidenceLocator!);
    const delivery = container.querySelector('#issue-provenance-delivery')!;
    const recordDelivery = realIssueProjectionFixture.status.nodes[0]!.delivery;
    if (recordDelivery?.state !== 'record') throw new Error('fixture must carry record delivery');
    expect(delivery.textContent).toContain(recordDelivery.foundAtRef);
    expect(delivery.textContent).toContain(recordDelivery.blobPath);
    expect(delivery.textContent).toContain(recordDelivery.codeCommit!);
    expect(delivery.textContent).toContain(recordDelivery.evidence![0]!.sha256);
    const attention = container.querySelector('#issue-provenance-attention-runtime')!;
    const scannedVisibility = issueAttentionNarrowedFixture.scanned[0]!.runStateVisibility;
    if (scannedVisibility.kind !== 'execution-root') throw new Error('fixture must carry an execution root');
    expect(attention.textContent).toContain(scannedVisibility.executionRoot);

    const phaseLink = container.querySelector('[data-testid="issue-detail-phase"]') as HTMLAnchorElement;
    expect(phaseLink.getAttribute('href')).toBe('#issue-provenance-acceptance');
    await act(async () => {
      phaseLink.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.location.hash).toBe('#issue-provenance-acceptance');
  });

  it('offers ordinary read-only links to this Store Operations and Unlinked Changes', async () => {
    await mountAtSpace(container, REAL_PATH);
    const operations = container.querySelector('[data-testid="issue-action-operations"]') as HTMLAnchorElement;
    const unlinked = container.querySelector('[data-testid="issue-action-unlinked"]') as HTMLAnchorElement;
    expect(operations.tagName).toBe('A');
    expect(operations.getAttribute('href')).toBe('/s/store_x/operations');
    expect(unlinked.getAttribute('href')).toBe('/s/store_x/unlinked-changes');
    expect(container.querySelector('a[href*="/task/"]')).toBeNull();
    expect(container.querySelector('a[href^="/p/"]')).toBeNull();
  });

  it('presents the three axes separately, each equal to its payload field', async () => {
    await mountAtSpace(container, REAL_PATH);
    const status = realIssueProjectionFixture.status;
    const axes = container.querySelector('[data-testid="issue-detail-axes"]')!;
    expect(axes.querySelector('[data-testid="issue-detail-phase"]')?.textContent).toBe('Done');
    expect(axes.querySelector('[data-testid="issue-detail-health"]')?.textContent).toBe('healthy');
    expect(axes.querySelector('[data-testid="issue-detail-progress"]')?.textContent).toBe(
      `${status.progress.completed}/${status.progress.total}`
    );
    expect(axes.querySelector('[data-testid="issue-detail-state"]')?.textContent).toContain(
      realIssueProjectionFixture.issue.record.state
    );
    expect(axes.querySelector('[data-testid="issue-detail-run-state"]')?.textContent).toContain(
      status.runStateVisibility.executionRoot
    );
  });

  it('renders the background and acceptance facts from their payload fields', async () => {
    await mountAtSpace(container, REAL_PATH);
    const acceptance = realIssueProjectionFixture.status.acceptance;
    const section = container.querySelector('[data-testid="issue-detail-background"]')!;
    expect(section.textContent).toContain(realIssueProjectionFixture.issue.record.createdAt);
    expect(section.textContent).toContain('0001, 0002, 0003, 0004');
    expect(section.querySelector('[data-testid="issue-detail-record-identity"]')?.textContent).toContain(
      realIssueProjectionFixture.issue.record.title
    );
    expect(section.textContent).toContain(realIssueProjectionFixture.issue.latestRevisionId);
    expect(section.textContent).toContain(realIssueProjectionFixture.issue.refs[0]!);
    expect(
      section.querySelector('[data-testid="issue-detail-acceptance-conditions"]')?.textContent
    ).toContain(acceptance.conditions.revisionId);
    expect(section.querySelector('[data-testid="issue-detail-condition"]')?.textContent).toContain(
      acceptance.conditions.revision.conditions[0]!.requirement
    );
    expect(section.querySelector('[data-testid="issue-detail-conditions-metadata"]')?.textContent).toContain(
      acceptance.conditions.revision.contentSha256
    );
    // The gate is presented as the gate reported it — its refusal code and its
    // own message, not a re-evaluation.
    expect(section.querySelector('[data-testid="issue-detail-gate"]')?.textContent).toContain(
      acceptance.gate.message
    );
    expect(section.querySelector('[data-testid="issue-detail-gate"]')?.textContent).toContain(
      acceptance.gate.refusalCode
    );
    expect(section.querySelector('[data-testid="issue-detail-accepted-record"]')?.textContent).toContain(
      acceptance.record.acceptedAt
    );
    const acceptedFacts = section.querySelector('[data-testid="issue-detail-accepted-record-facts"]')!;
    expect(acceptedFacts.textContent).toContain(acceptance.record.conditionsSha256);
    expect(acceptedFacts.textContent).toContain(acceptance.record.note!);
    expect(acceptedFacts.textContent).toContain(acceptance.record.contentSha256);
  });

  it('renders every plan node with its lifecycle, observation, target, suggestion, and diagnostic', async () => {
    await mountAtSpace(container, REAL_PATH);
    const nodes = [...container.querySelectorAll('[data-testid="issue-detail-node"]')];
    expect(nodes.map((node) => node.getAttribute('data-node'))).toEqual(
      realIssueProjectionFixture.status.nodes.map((node) => node.nodeId)
    );

    const first = realIssueProjectionFixture.status.nodes[0]!;
    const firstNode = nodes[0]!;
    expect(firstNode.querySelector('[data-testid="issue-detail-node-lifecycle"]')?.textContent).toContain(
      'required'
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-observation"]')?.textContent).toBe(
      'finalized'
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-target"]')?.textContent).toContain(
      first.projectId
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-target"]')?.textContent).toContain(
      first.targetLineId
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-suggestion"]')?.textContent).toContain(
      first.suggestedPipeline!
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-diagnostic"]')?.textContent).toBe(
      first.diagnostic
    );
    expect(firstNode.querySelector('[data-testid="issue-detail-node-plan-facts"]')?.textContent).toContain(
      realIssueProjectionFixture.plan.revision.nodes[0]!.changeInstanceId!
    );
  });

  it('renders the revision delta when the latest revision supersedes one', async () => {
    await mountAtSpace(container, REAL_PATH);
    const delta = realIssueProjectionFixture.status.delta;
    const block = container.querySelector('[data-testid="issue-detail-delta"]')!;
    expect(block.textContent).toContain(delta.revisionId);
    expect(block.textContent).toContain(delta.supersedes);
  });

  it('groups Changes by member project, each group carrying its own progress', async () => {
    await mountAtSpace(container, REAL_PATH);
    const lane = realIssueProjectionFixture.status.projects[0]!;
    const rendered = container.querySelector(
      `[data-testid="issue-detail-lane"][data-project="${lane.projectId}"]`
    )!;
    expect(rendered.querySelector('.issue-detail__lane-name')?.textContent).toBe(lane.alias);
    expect(rendered.querySelector('[data-testid="issue-detail-lane-progress"]')?.textContent).toBe(
      `${lane.progress.completed}/${lane.progress.total}`
    );
    expect(
      [...rendered.querySelectorAll('[data-testid="issue-detail-lane-node"]')].map((row) =>
        row.textContent?.split(' — ')[0]
      )
    ).toEqual([...lane.nodeIds]);
  });

  it('labels each cross-project blocker with the node, project, and state the projection reported', async () => {
    const blocked = {
      ...realIssueProjectionFixture,
      status: {
        ...realIssueProjectionFixture.status,
        nodes: realIssueProjectionFixture.status.nodes.map((node, index) =>
          index === 1
            ? {
                ...node,
                blockedBy: [
                  {
                    nodeId: 'upstream-node',
                    projectId: 'other-project',
                    observation: 'in-flight' as const,
                  },
                ],
              }
            : node
        ),
      },
    };
    (client.getStoreIssueProjection as any).mockResolvedValue(blocked);
    await mountAtSpace(container, REAL_PATH);

    const dependency = container.querySelector('[data-testid="issue-detail-dependency"]')!;
    expect(dependency.getAttribute('data-node')).toBe('issue-autodecompose-review-flow');
    expect(dependency.querySelector('.issue-detail__dependency-blockers')?.textContent).toBe(
      'upstream-node@other-project: in flight'
    );
  });

  it('renders run/session attribution, per-node delivery states, and the rollup counts', async () => {
    const withEverySessionPointer = {
      ...realIssueProjectionFixture,
      status: {
        ...realIssueProjectionFixture.status,
        nodes: realIssueProjectionFixture.status.nodes.map((node) =>
          node.nodeId === 'issue-autodecompose-review-flow'
            ? {
                ...node,
                attribution: {
                  ...node.attribution,
                  sessions: node.attribution.sessions.map((session) => ({
                    ...session,
                    threadId: 'thread_1',
                    transcript: 'sessions/thread_1/rollout.jsonl',
                  })),
                },
              }
            : node
        ),
      },
    };
    (client.getStoreIssueProjection as any).mockResolvedValue(withEverySessionPointer);
    await mountAtSpace(container, REAL_PATH);
    const counts = realIssueProjectionFixture.delivery.counts;
    const attributed = container.querySelector(
      '[data-testid="issue-detail-attribution"][data-node="issue-autodecompose-review-flow"]'
    )!;
    expect(attributed.querySelector('[data-testid="issue-detail-pipeline"]')?.textContent).toContain(
      'small-feature'
    );
    expect(attributed.querySelector('[data-testid="issue-detail-session"]')?.textContent).toContain('apply');
    const sessionPointers = attributed.querySelector('[data-testid="issue-detail-session-pointers"]')!;
    expect(sessionPointers.textContent).toContain('sess_1');
    expect(sessionPointers.textContent).toContain('thread_1');
    expect(sessionPointers.textContent).toContain('sessions/thread_1/rollout.jsonl');
    expect(attributed.querySelector('[data-testid="issue-detail-evidence-locator"]')?.textContent).toBe(
      'rasen/changes/issue-autodecompose-review-flow/evidence'
    );
    expect(attributed.querySelector('[data-testid="issue-detail-node-delivery"]')?.textContent).toContain(
      'not archived'
    );

    const recorded = container.querySelector(
      '[data-testid="issue-detail-attribution"][data-node="issue-autodecompose-graph"]'
    )!;
    const recordDelivery = realIssueProjectionFixture.status.nodes[0]!.delivery;
    if (recordDelivery?.state !== 'record') throw new Error('fixture must carry record delivery');
    const recordFacts = recorded.querySelector('[data-testid="issue-detail-record-delivery-facts"]')!;
    expect(recordFacts.textContent).toContain(recordDelivery.planningBranch!);
    expect(recordFacts.textContent).toContain(recordDelivery.entryName);
    expect(recordFacts.textContent).toContain(recordDelivery.foundAtRef);
    expect(recordFacts.textContent).toContain(recordDelivery.blobPath);
    expect(recordFacts.textContent).toContain(recordDelivery.evidence![0]!.path);
    expect(recordFacts.textContent).toContain(recordDelivery.evidence![0]!.sha256);
    expect(recordFacts.textContent).toContain(recordDelivery.missing![0]!);

    const rollup = container.querySelector('[data-testid="issue-detail-delivery-counts"]')!;
    expect(rollup.textContent).toContain(String(counts.record));
    expect(rollup.textContent).toContain('not-archived');
  });

  it('renders the review determination, its threads, and the verification summary', async () => {
    await mountAtSpace(container, REAL_PATH);
    const review = realIssueProjectionFixture.review;
    expect(container.querySelector('[data-testid="issue-detail-determination"]')?.textContent).toContain(
      'accepted'
    );
    expect(container.querySelector('[data-testid="issue-detail-determination"]')?.textContent).toContain(
      review.determination.acceptedAt
    );
    const thread = container.querySelector('[data-testid="issue-detail-thread"]')!;
    expect(thread.textContent).toContain(review.threads[0]!.nodeId);
    expect(thread.textContent).toContain(review.threads[0]!.names[0]!);
    expect(container.querySelector('[data-testid="issue-detail-verification"]')?.textContent).toContain(
      `${review.verification.progress.completed}/${review.verification.progress.total}`
    );
    expect(container.querySelector('[data-testid="issue-detail-verification"]')?.textContent).toBe(
      'Required work 2/2 · 2 record · 0 no-record · 0 not-archived · 0 unreadable · 0 unattributed'
    );
    expect(container.querySelector('[data-testid="issue-detail-determination"]')?.textContent).toContain(
      review.determination.conditionsRevisionId
    );
  });

  it('names the empty attention state rather than rendering nothing', async () => {
    await mountAtSpace(container, REAL_PATH);
    expect(container.querySelector('[data-testid="issue-detail-attention-empty"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="issue-detail-attention-item"]')).toHaveLength(0);
    const summary = container.querySelector('[data-testid="issue-detail-attention-summary"]')!;
    expect(summary.textContent).toContain(String(issueAttentionNarrowedFixture.scannedCount));
    expect(summary.textContent).toContain(issueAttentionNarrowedFixture.issueId!);
  });

  it('announces narrowed-attention incompleteness and attention-only unsearched refs', async () => {
    const attentionOnlyRef = {
      targetLineId: 'attention-only-line',
      storeRef: 'refs/heads/attention-only',
      reason: 'attention scan could not search this ref',
    };
    (client.getStoreIssueAttention as any).mockResolvedValue({
      ...issueAttentionNarrowedFixture,
      complete: false,
      unsearchedRefs: [attentionOnlyRef],
    });

    await mountAtSpace(container, REAL_PATH);

    expect(container.querySelector('[data-testid="issue-detail-incomplete"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issue-detail-unsearched"]')?.textContent).toContain(
      attentionOnlyRef.storeRef
    );
  });

  it('renders every material fact carried by an acceptance-awaiting attention gate', async () => {
    const gate = realIssueProjectionFixture.status.acceptance.gate;
    (client.getStoreIssueAttention as any).mockResolvedValue({
      ...issueAttentionNarrowedFixture,
      scanned: issueAttentionNarrowedFixture.scanned.map((entry) => ({ ...entry, itemCount: 1 })),
      items: [
        {
          issueId: realIssueProjectionFixture.issue.issueId,
          phase: realIssueProjectionFixture.status.phase,
          health: realIssueProjectionFixture.status.health,
          nodeId: null,
          alias: null,
          kind: 'acceptance-awaiting' as const,
          gate,
        },
      ],
      counts: {
        ...issueAttentionNarrowedFixture.counts,
        'acceptance-awaiting': 1,
      },
      total: 1,
    });

    await mountAtSpace(container, REAL_PATH);

    const rendered = container.querySelector('[data-testid="issue-detail-attention-gate"]')!;
    if (gate.eligible) throw new Error('fixture must carry an ineligible gate');
    expect(rendered.textContent).toContain(gate.refusalCode);
    expect(rendered.textContent).toContain(gate.message);
  });

  it('still renders what derived for an Issue whose plan did not read back, with the problem beside it', async () => {
    (client.getStoreIssueProjection as any).mockResolvedValue(unreadableIssueProjectionFixture);
    (client.getStoreIssueAttention as any).mockResolvedValue(issueAttentionUnreadableFixture);
    await mountAtSpace(container, `/s/store_x/issues/${ISSUE_IDENTITIES.broken.uid}`);

    // The read is present: axes, sections, review determination.
    expect(container.querySelector('[data-testid="issue-detail-axes"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issue-detail-determination"]')?.textContent).toContain(
      'no plan'
    );
    // And the problem is beside it, carrying the reported reason — not instead
    // of the read, and not converted into an error page.
    expect(container.querySelector('[data-testid="issue-detail-error"]')).toBeNull();
    const problem = container.querySelector('[data-testid="issue-detail-status-problem"]')!;
    expect(problem.textContent).toContain(
      unreadableIssueProjectionFixture.status.problems[0]!.reason
    );
    expect(container.querySelector('[data-testid="issue-detail-run-state"]')?.textContent).toContain(
      'committed evidence only'
    );
    // The attention item the scan reported for it is listed.
    expect(container.querySelector('[data-testid="issue-detail-attention-item"]')?.getAttribute('data-kind')).toBe(
      'problem'
    );
    expect(container.querySelector('[data-testid="issue-detail-attention-problem"]')?.textContent).toContain(
      issueAttentionUnreadableFixture.items[0]!.problem.ref!
    );
    expect(container.querySelector('#issue-provenance-plan')?.textContent).toContain(
      unreadableIssueProjectionFixture.plan.diagnostic
    );
    expect(container.querySelector('#issue-provenance-runtime')?.textContent).toContain(
      'Evidence unavailable'
    );
  });

  it('re-fetches on refresh and writes nothing to client storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await mountAtSpace(container, REAL_PATH);
    expect((client.getStoreIssueProjection as any).mock.calls).toHaveLength(1);

    (client.getStoreIssueProjection as any).mockResolvedValue({
      ...realIssueProjectionFixture,
      status: { ...realIssueProjectionFixture.status, health: 'failed' as const },
    });
    const refresh = container.querySelector('[data-testid="issue-detail-refresh"]') as HTMLButtonElement;
    await act(async () => {
      refresh.click();
    });
    await act(async () => {
      await flushMicrotasks(20);
    });

    expect((client.getStoreIssueProjection as any).mock.calls).toHaveLength(2);
    expect(container.querySelector('[data-testid="issue-detail-health"]')?.textContent).toBe('failed');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('keys state by opaque Store selector and Issue id across real same-component routes', async () => {
    let resolveAProjection!: (value: typeof realIssueProjectionFixture) => void;
    let resolveAAttention!: (value: typeof issueAttentionNarrowedFixture) => void;
    const aProjection = new Promise<typeof realIssueProjectionFixture>((resolve) => { resolveAProjection = resolve; });
    const aAttention = new Promise<typeof issueAttentionNarrowedFixture>((resolve) => { resolveAAttention = resolve; });
    const detailFor = (issueId: string, title: string) => ({
      ...realIssueProjectionFixture,
      issue: {
        ...realIssueProjectionFixture.issue,
        identity: { ...realIssueProjectionFixture.issue.identity!, uid: issueId },
        issueId,
        record: { ...realIssueProjectionFixture.issue.record, id: issueId, title },
      },
      review: { ...realIssueProjectionFixture.review, issueId },
    });
    const attentionFor = (issueId: string) => ({
      ...issueAttentionNarrowedFixture,
      issueId,
      scanned: issueAttentionNarrowedFixture.scanned.map((entry) => ({ ...entry, issueId })),
    });
    (client.getStoreIssueProjection as any).mockImplementation((issueId: string, selector: string) => {
      if (issueId === 'issue-a' && selector === 'store:store:a') return aProjection;
      if (issueId === 'issue-b') return Promise.resolve(detailFor(issueId, 'Issue B only'));
      return Promise.resolve(detailFor(issueId, 'Store B only'));
    });
    (client.getStoreIssueAttention as any).mockImplementation((selector: string, issueId: string) => {
      if (issueId === 'issue-a' && selector === 'store:store:a') return aAttention;
      return Promise.resolve(attentionFor(issueId));
    });

    window.history.pushState({}, '', '/s/store%3Aa/issues/issue-a');
    await act(async () => {
      render(<LocationProvider><RoutedIssueDetail /></LocationProvider>, container);
      await flushMicrotasks();
    });
    await act(async () => {
      (container.querySelector('[data-testid="route-issue-b"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushMicrotasks(40);
    });
    expect(container.textContent).toContain('Issue B only');
    expect(container.textContent).not.toContain('Issue layer Phase 4');

    resolveAProjection(realIssueProjectionFixture);
    resolveAAttention(issueAttentionNarrowedFixture);
    await act(async () => { await flushMicrotasks(20); });
    expect(container.textContent).toContain('Issue B only');
    expect(container.textContent).not.toContain('Issue layer Phase 4');

    await act(async () => {
      (container.querySelector('[data-testid="route-store-b"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushMicrotasks(40);
    });
    expect(container.textContent).toContain('Store B only');
    expect((client.getStoreIssueProjection as any).mock.calls).toContainEqual(['issue-store-b', 'store:store_b']);
    expect((client.getStoreIssueAttention as any).mock.calls).toContainEqual(['store:store_b', 'issue-store-b']);
    expect(container.querySelector('[data-testid="issue-detail-error"]')).toBeNull();
  });
});
