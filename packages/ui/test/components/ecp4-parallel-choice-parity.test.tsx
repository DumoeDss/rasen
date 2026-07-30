// @vitest-environment jsdom
/**
 * Operations (UI) plane of the ECP-4 `parallel/1` + `choice/1` parity matrix
 * (task 8.6 of `ecp-full-feature`).
 *
 * `test/core/change-run/projector-parallel-choice.test.ts` proves the pure
 * projection, the CLI (`pipeline status --json`) and the Management API
 * (`handleRunDetail`) see byte-identical parallel/choice sections for ONE
 * fixture Record. Per the `cross-plane-parity.test.tsx` convention the fourth
 * plane — Operations — is asserted here, against the SAME fixture, by
 * rendering the REAL `OperationsSection` component and reading its DOM.
 *
 * PROVENANCE of the canonical section constants (ECP-5 task 4.3). They used to
 * be hand-copied into this file, which made the parity relation circular: the
 * only thing pinning them to reality was a reviewer probe that duplicated them
 * a third time. They now live in ONE data module,
 * `../fixtures/canonical-sections.js`, and the node-side
 * `test/core/change-run/ui-constants-provenance.test.ts` deep-equals every one
 * of them against the REAL projector's output for its documented fixture. So
 * these constants are the kernel's answer, and this file asserts the DOM
 * against the kernel rather than against another copy of itself.
 *
 * The assertions below drive the DOM from those objects rather than from
 * re-typed literals, so the UI cannot silently disagree with the fixture: if
 * the component renders a status/count/branch flag it computed itself instead
 * of the projected one, the comparison fails.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getRunDetail: vi.fn(),
  };
});

import { OperationsSection } from '../../src/components/OperationsSection.js';
import * as client from '../../src/api/client.js';
import {
  CANONICAL_CHOICE,
  CANONICAL_CHOICE_UNDECIDED,
  CANONICAL_PARALLEL,
  CANONICAL_PARALLEL_FAILED,
} from '../fixtures/canonical-sections.js';
import type {
  ChangeRunView,
  ChangeRunViewSection,
  ChoiceViewSection,
  ParallelViewSection,
  RunsResponse,
} from '../../src/api/types.js';

const CANONICAL_RUN_ID = 'run:' + 'a'.repeat(64);
const CANONICAL_CHANGE_ID = 'fixture-change';
const CANONICAL_PROJECT_ID = 'project-fixture';
const CANONICAL_PLANNING_SPACE = 'planning-space:' + '1'.repeat(64);
const CANONICAL_WORKSPACE_INSTANCE = 'workspace-instance:' + '3'.repeat(64);
const CANONICAL_CHANGE_INSTANCE = 'change-instance:' + '2'.repeat(64);
const CANONICAL_WORKSPACE_DIGEST = 'sha256:' + 'c'.repeat(64);

/**
 * The root-dag/1 section the projector always emits alongside the additive
 * sections. Kept minimal — this file asserts the ECP-4 sections; the root-dag
 * fields are the subject of `cross-plane-parity.test.tsx`.
 */
function rootDagSection(): ChangeRunViewSection {
  return {
    kind: 'root-dag',
    version: 1,
    frontier: [],
    activeInvocations: [],
    actions: [],
    waits: [],
    workspace: {
      current: {
        format: 'workspace-revision/1',
        head: { kind: 'commit', digest: CANONICAL_WORKSPACE_DIGEST, detached: false },
        treeDigest: CANONICAL_WORKSPACE_DIGEST,
        dirtyWorktreeDigest: CANONICAL_WORKSPACE_DIGEST,
      },
      expectedByActiveWriters: [],
    },
    effectDiagnostics: [],
    allowedControls: [],
  };
}

function viewWith(sections: readonly ChangeRunViewSection[]): ChangeRunView {
  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: CANONICAL_RUN_ID,
    change: {
      planningSpaceId: CANONICAL_PLANNING_SPACE,
      projectId: CANONICAL_PROJECT_ID,
      changeId: CANONICAL_CHANGE_ID,
      instanceId: CANONICAL_CHANGE_INSTANCE,
    },
    recordVersion: 9,
    status: 'running',
    sourceState: 'active',
    workspace: { instanceId: CANONICAL_WORKSPACE_INSTANCE, scope: 'current' },
    drift: {
      definition: 'unchanged',
      sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: [rootDagSection(), ...sections],
  };
}

function canonicalRunsResponse(): RunsResponse {
  return {
    runs: [],
    reconcilerRuns: [
      {
        runId: CANONICAL_RUN_ID,
        changeId: CANONICAL_CHANGE_ID,
        planningSpaceId: CANONICAL_PLANNING_SPACE,
        engine: 'reconciler',
        recordVersion: 9,
        status: 'running',
        sourceState: 'active',
        waits: 0,
      },
    ],
    hasMore: false,
  };
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Renders the section, opens the canonical Run's detail, returns the container. */
async function openRunDetail(
  container: HTMLElement,
  view: ChangeRunView
): Promise<void> {
  vi.mocked(client.getRunDetail).mockResolvedValue(view);
  render(
    <OperationsSection
      runsResponse={canonicalRunsResponse()}
      selector="project:test"
      childNames={[CANONICAL_CHANGE_ID]}
    />,
    container
  );
  const button = container.querySelector('[data-testid="ops-summary-select"]') as HTMLButtonElement;
  await act(async () => {
    button.click();
    await flushMicrotasks();
  });
  await act(async () => {
    await flushMicrotasks(12);
  });
}

describe('Operations plane: parallel/1 section parity (ECP-4 8.6)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it('renders every projected member status, role and condition verbatim', async () => {
    await openRunDetail(container, viewWith([CANONICAL_PARALLEL]));

    const panel = container.querySelector('[data-testid="ops-run-parallel"]');
    expect(panel).not.toBeNull();

    const members = Array.from(container.querySelectorAll('[data-testid="ops-parallel-member"]'));
    // One rendered row per projected member, in the projected order.
    expect(members).toHaveLength(CANONICAL_PARALLEL.members.length);
    CANONICAL_PARALLEL.members.forEach((member, index) => {
      const row = members[index]!;
      // Status comes from the projection — not recomputed from anything local.
      expect(row.getAttribute('data-member-status')).toBe(member.status);
      expect(row.getAttribute('data-member-required')).toBe(member.required ? 'true' : 'false');
      // Full member path + condition are preserved in the title attribute.
      expect(row.getAttribute('title')).toBe(`${member.path}\ncondition: ${member.condition}`);
      expect(row.textContent).toContain(member.status);
      expect(row.textContent).toContain(member.condition);
      expect(row.textContent).toContain(member.required ? 'required' : 'optional');
    });
  });

  it('renders the projected join state, budget usage, cap and frontier counts', async () => {
    await openRunDetail(container, viewWith([CANONICAL_PARALLEL]));

    expect(
      container.querySelector('[data-testid="ops-parallel-join-state"]')!.textContent
    ).toBe(CANONICAL_PARALLEL.joinState);
    expect(container.querySelector('[data-testid="ops-run-parallel"]')!.getAttribute('data-join-state')).toBe(
      CANONICAL_PARALLEL.joinState
    );
    expect(container.querySelector('[data-testid="ops-parallel-join-path"]')!.getAttribute('title')).toBe(
      CANONICAL_PARALLEL.joinPath
    );
    expect(container.querySelector('[data-testid="ops-parallel-fan-out"]')!.getAttribute('title')).toBe(
      CANONICAL_PARALLEL.fanOutPath
    );
    expect(container.querySelector('[data-testid="ops-parallel-budget"]')!.textContent).toBe(
      `${CANONICAL_PARALLEL.budget.used}/${CANONICAL_PARALLEL.budget.max}`
    );
    expect(container.querySelector('[data-testid="ops-parallel-cap"]')!.textContent).toBe(
      String(CANONICAL_PARALLEL.concurrencyCap)
    );

    // The member frontier is the projector's own count — the UI must not
    // recompute which members are in flight (same discipline as the root-DAG
    // frontier, which it also renders only from the projection).
    const counts = container.querySelector('[data-testid="ops-parallel-counts"]')!.textContent!;
    expect(counts).toContain(`${CANONICAL_PARALLEL.activeCount} active`);
    expect(counts).toContain(`${CANONICAL_PARALLEL.succeededCount} succeeded`);
    expect(counts).toContain(`${CANONICAL_PARALLEL.failedCount} failed`);

    // Empty keyBlockers → no blocker list at all (absent, not an empty shell).
    expect(container.querySelector('[data-testid="ops-parallel-blockers"]')).toBeNull();
  });

  it('surfaces the projected key blockers when a required member failed', async () => {
    await openRunDetail(container, viewWith([CANONICAL_PARALLEL_FAILED]));

    expect(
      container.querySelector('[data-testid="ops-parallel-join-state"]')!.textContent
    ).toBe('failed');

    const blockers = Array.from(container.querySelectorAll('[data-testid="ops-parallel-blocker"]'));
    expect(blockers.map((node) => node.textContent)).toEqual(
      CANONICAL_PARALLEL_FAILED.keyBlockers
    );

    // The failed required member is rendered as failed; the optional member
    // that succeeded and the suppressed one keep their projected statuses.
    const statuses = Array.from(
      container.querySelectorAll('[data-testid="ops-parallel-member"]')
    ).map((node) => node.getAttribute('data-member-status'));
    expect(statuses).toEqual(CANONICAL_PARALLEL_FAILED.members.map((m) => m.status));
  });

  it('renders no parallel panel when the view carries no parallel section', async () => {
    await openRunDetail(container, viewWith([]));
    expect(container.querySelector('[data-testid="ops-run-parallel"]')).toBeNull();
  });

  it('does NOT recompute the frontier counts from member statuses', async () => {
    // A deliberately INCOHERENT section: the counts disagree with what any
    // client-side tally of `members` would produce. The UI must show the
    // server's numbers. With coherent fixtures a recomputing UI is
    // indistinguishable from a consuming one, so the disagreement is the only
    // way to pin the behaviour.
    const incoherent: ParallelViewSection = {
      ...CANONICAL_PARALLEL,
      activeCount: 7,
      succeededCount: 5,
      failedCount: 3,
      budget: { used: 11, max: 13 },
    };
    await openRunDetail(container, viewWith([incoherent]));

    const counts = container.querySelector('[data-testid="ops-parallel-counts"]')!.textContent!;
    expect(counts).toContain('7 active');
    expect(counts).toContain('5 succeeded');
    expect(counts).toContain('3 failed');
    expect(container.querySelector('[data-testid="ops-parallel-budget"]')!.textContent).toBe('11/13');
  });

  it('does NOT recompute the join state from member statuses', async () => {
    // Every member succeeded, yet the server projected `waiting`. The UI shows
    // `waiting` — the join barrier is the reconciler's call, not the UI's.
    const incoherent: ParallelViewSection = {
      ...CANONICAL_PARALLEL,
      members: CANONICAL_PARALLEL.members.map((m) => ({ ...m, status: 'succeeded' as const })),
      joinState: 'waiting',
    };
    await openRunDetail(container, viewWith([incoherent]));
    expect(
      container.querySelector('[data-testid="ops-parallel-join-state"]')!.textContent
    ).toBe('waiting');
  });
});

describe('Operations plane: choice/1 section parity (ECP-4 8.6)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it('renders the selected outcome and marks exactly the projected active branch', async () => {
    await openRunDetail(container, viewWith([CANONICAL_CHOICE]));

    expect(container.querySelector('[data-testid="ops-choice-path"]')!.getAttribute('title')).toBe(
      CANONICAL_CHOICE.choicePath
    );
    expect(container.querySelector('[data-testid="ops-choice-outcome"]')!.textContent).toBe(
      CANONICAL_CHOICE.outcome
    );
    expect(container.querySelector('[data-testid="ops-run-choice"]')!.getAttribute('data-outcome')).toBe(
      CANONICAL_CHOICE.outcome
    );

    const branches = Array.from(container.querySelectorAll('[data-testid="ops-choice-branch"]'));
    expect(branches).toHaveLength(CANONICAL_CHOICE.branches.length);
    CANONICAL_CHOICE.branches.forEach((branch, index) => {
      const row = branches[index]!;
      expect(row.getAttribute('data-outcome')).toBe(branch.outcome);
      // Activation is the projector's, never re-derived from `outcome`.
      expect(row.getAttribute('data-active')).toBe(branch.active ? 'true' : 'false');
      expect(row.getAttribute('title')).toBe(branch.path);
      expect(row.textContent).toContain(branch.active ? 'active' : 'inactive');
    });
  });

  it('shows no committed outcome and no active branch before the choice commits', async () => {
    await openRunDetail(container, viewWith([CANONICAL_CHOICE_UNDECIDED]));

    expect(container.querySelector('[data-testid="ops-choice-outcome"]')!.textContent).toBe(
      'awaiting decision'
    );
    expect(container.querySelector('[data-testid="ops-run-choice"]')!.hasAttribute('data-outcome')).toBe(
      false
    );
    const active = Array.from(container.querySelectorAll('[data-testid="ops-choice-branch"]')).map(
      (node) => node.getAttribute('data-active')
    );
    expect(active).toEqual(['false', 'false']);
  });

  it('does NOT recompute branch activation from the selected outcome', async () => {
    // The server projected `complex` as the outcome but marked `simple` active.
    // No real projection is incoherent this way — that is the point: only a UI
    // that READS `branch.active` can reproduce it, a UI that recomputes
    // `outcome === branch.outcome` cannot.
    const incoherent: ChoiceViewSection = {
      ...CANONICAL_CHOICE,
      outcome: 'complex',
      branches: [
        { outcome: 'simple', path: 'root:simple-path', active: true },
        { outcome: 'complex', path: 'root:complex-path', active: false },
      ],
    };
    await openRunDetail(container, viewWith([incoherent]));

    expect(container.querySelector('[data-testid="ops-choice-outcome"]')!.textContent).toBe(
      'complex'
    );
    const active = Array.from(container.querySelectorAll('[data-testid="ops-choice-branch"]')).map(
      (node) => node.getAttribute('data-active')
    );
    expect(active).toEqual(['true', 'false']);
  });

  it('renders no choice panel when the view carries no choice section', async () => {
    await openRunDetail(container, viewWith([]));
    expect(container.querySelector('[data-testid="ops-run-choice"]')).toBeNull();
  });

  it('renders both ECP-4 sections together when the plan carries a FanOut and a Choice', async () => {
    await openRunDetail(container, viewWith([CANONICAL_PARALLEL, CANONICAL_CHOICE]));
    expect(container.querySelector('[data-testid="ops-run-parallel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ops-run-choice"]')).not.toBeNull();
  });
});
