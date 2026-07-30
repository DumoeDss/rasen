// @vitest-environment jsdom
/**
 * Operations (UI) plane of the ECP-1 `review-cycle/1` cross-plane promise
 * (ECP-5 task 4.5, design D5).
 *
 * ECP-1's shipped `executable-review-cycle` delta requires CLI, Management API
 * and Operations to consume the SAME `ChangeRunView` review-cycle section. The
 * CLI renders it (`src/commands/pipeline.ts`), the API returns it, and
 * `test/core/change-run/review-cycle-parity.test.ts` proves those two planes
 * agree with the pure projection. Until this file, `getReviewCycleSection` had
 * ZERO consumers in `packages/ui/src` — the third plane was a false promise.
 * This test asserts it by rendering the REAL `OperationsSection` and reading
 * its DOM.
 *
 * PROVENANCE: the constants come from `../fixtures/canonical-sections.js`, the
 * single data module whose every value the node-side
 * `test/core/change-run/ui-constants-provenance.test.ts` deep-equals against
 * `projectRunView(record, 'active', plan)`. The DOM is therefore compared to
 * the KERNEL's answer, not to a second copy of the UI's own reading.
 *
 * INCOHERENT-SECTION PROBES: with coherent fixtures a UI that recomputes a
 * projected value is indistinguishable from one that consumes it. The last
 * three cases below feed sections whose fields deliberately disagree with each
 * other — states no real projection produces — so only a component that READS
 * `outcome`, `round`, `phase`, `status` and `waitReason` can reproduce them.
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
  CANONICAL_FIXER_ACTOR,
  CANONICAL_REVIEW_CYCLE,
  CANONICAL_REVIEW_CYCLE_ESCALATED,
} from '../fixtures/canonical-sections.js';
import type {
  ChangeRunView,
  ChangeRunViewSection,
  ReviewCycleViewSection,
  RunsResponse,
} from '../../src/api/types.js';

const CANONICAL_RUN_ID = 'run:' + 'a'.repeat(64);
const CANONICAL_CHANGE_ID = 'fixture-change';
const CANONICAL_PROJECT_ID = 'project-fixture';
const CANONICAL_PLANNING_SPACE = 'planning-space:' + '1'.repeat(64);
const CANONICAL_WORKSPACE_INSTANCE = 'workspace-instance:' + '3'.repeat(64);
const CANONICAL_CHANGE_INSTANCE = 'change-instance:' + '2'.repeat(64);
const CANONICAL_WORKSPACE_DIGEST = 'sha256:' + 'c'.repeat(64);

/** The root-dag/1 section the projector always emits alongside the additive ones. */
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

/** Renders the section, opens the canonical Run's detail. */
async function openRunDetail(container: HTMLElement, view: ChangeRunView): Promise<void> {
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

function text(container: HTMLElement, testId: string): string {
  const node = container.querySelector(`[data-testid="${testId}"]`);
  expect(node).not.toBeNull();
  return node!.textContent!;
}

describe('Operations plane: review-cycle/1 section parity (ECP-5 4.5)', () => {
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

  it('renders the projected loop path, round against the cap, phase and wait reason', async () => {
    await openRunDetail(container, viewWith([CANONICAL_REVIEW_CYCLE]));

    const panel = container.querySelector('[data-testid="ops-run-review-cycle"]');
    expect(panel).not.toBeNull();

    expect(
      container.querySelector('[data-testid="ops-review-cycle-loop"]')!.getAttribute('title')
    ).toBe(CANONICAL_REVIEW_CYCLE.loopPath);
    expect(text(container, 'ops-review-cycle-round')).toBe(
      `${CANONICAL_REVIEW_CYCLE.round}/${CANONICAL_REVIEW_CYCLE.maxRounds}`
    );
    expect(text(container, 'ops-review-cycle-phase')).toBe(CANONICAL_REVIEW_CYCLE.phase);
    expect(panel!.getAttribute('data-phase')).toBe(CANONICAL_REVIEW_CYCLE.phase);
    expect(text(container, 'ops-review-cycle-wait')).toBe(CANONICAL_REVIEW_CYCLE.waitReason);
  });

  it('shows no committed outcome while the loop is still running', async () => {
    await openRunDetail(container, viewWith([CANONICAL_REVIEW_CYCLE]));
    // The kernel emits no `outcome` until the loop terminates; the wire drops
    // the key entirely, and the UI must not invent one from the findings.
    expect(CANONICAL_REVIEW_CYCLE.outcome).toBeUndefined();
    expect(text(container, 'ops-review-cycle-outcome')).toBe('in progress');
    expect(
      container
        .querySelector('[data-testid="ops-run-review-cycle"]')!
        .hasAttribute('data-outcome')
    ).toBe(false);
  });

  it('renders every projected finding with its severity and status verbatim', async () => {
    await openRunDetail(container, viewWith([CANONICAL_REVIEW_CYCLE]));

    const rows = Array.from(
      container.querySelectorAll('[data-testid="ops-review-cycle-finding"]')
    );
    expect(rows).toHaveLength(CANONICAL_REVIEW_CYCLE.findings.length);
    CANONICAL_REVIEW_CYCLE.findings.forEach((finding, index) => {
      const row = rows[index]!;
      expect(row.getAttribute('data-finding-id')).toBe(finding.id);
      // Severity and status are the kernel's — the triage/re-review reducers
      // own them, and the UI never re-derives a status from a verdict.
      expect(row.getAttribute('data-severity')).toBe(finding.severity);
      expect(row.getAttribute('data-status')).toBe(finding.status);
      expect(row.textContent).toContain(finding.claim);
      if (finding.location !== undefined) {
        expect(row.textContent).toContain(finding.location);
      }
    });
  });

  it('renders the bound actors the kernel committed, and only those', async () => {
    await openRunDetail(container, viewWith([CANONICAL_REVIEW_CYCLE]));

    const slots = Array.from(
      container.querySelectorAll('[data-testid="ops-review-cycle-actor"]')
    ).map((node) => node.getAttribute('data-actor-slot'));
    // Mid-round: a fixer is bound, the verifier slot is still empty — the UI
    // shows exactly the slots the projection carries.
    expect(slots).toEqual(['fixer', 'last']);
    expect(
      container
        .querySelector('[data-testid="ops-review-cycle-actor"][data-actor-slot="fixer"]')!
        .getAttribute('data-actor-identity')
    ).toBe(CANONICAL_FIXER_ACTOR.identityDigest);
  });

  it('renders the exhausted outcome and the independent verifier at the round cap', async () => {
    await openRunDetail(container, viewWith([CANONICAL_REVIEW_CYCLE_ESCALATED]));

    expect(text(container, 'ops-review-cycle-outcome')).toBe('exhausted');
    expect(
      container.querySelector('[data-testid="ops-run-review-cycle"]')!.getAttribute('data-outcome')
    ).toBe('exhausted');
    expect(text(container, 'ops-review-cycle-round')).toBe('1/1');
    // Terminal loop → no wait reason at all (absent, not an empty row).
    expect(container.querySelector('[data-testid="ops-review-cycle-wait"]')).toBeNull();

    const slots = Array.from(
      container.querySelectorAll('[data-testid="ops-review-cycle-actor"]')
    ).map((node) => node.getAttribute('data-actor-slot'));
    expect(slots).toEqual(['fixer', 'verifier', 'last']);

    // The Major is still open — the shape a UI must render without ever
    // concluding "clean" for itself.
    const statuses = Array.from(
      container.querySelectorAll('[data-testid="ops-review-cycle-finding"]')
    ).map((node) => node.getAttribute('data-status'));
    expect(statuses).toEqual(CANONICAL_REVIEW_CYCLE_ESCALATED.findings.map((f) => f.status));
  });

  it('renders no review-cycle panel when the view carries no review-cycle section', async () => {
    await openRunDetail(container, viewWith([]));
    expect(container.querySelector('[data-testid="ops-run-review-cycle"]')).toBeNull();
  });

  it('does NOT derive the outcome from the findings', async () => {
    // INCOHERENT PROBE: the server projected `clean` while a Blocker is open.
    // No real projection is like this — the ship guard forbids it. Only a UI
    // that READS `outcome` can reproduce it; a UI that inspects findings to
    // decide cleanliness renders "in progress" and fails here.
    const incoherent: ReviewCycleViewSection = {
      ...CANONICAL_REVIEW_CYCLE,
      outcome: 'clean',
      findings: [
        {
          id: 'F-9',
          severity: 'blocker',
          status: 'open',
          claim: 'A Blocker the server nonetheless called clean.',
        },
      ],
    };
    await openRunDetail(container, viewWith([incoherent]));

    expect(text(container, 'ops-review-cycle-outcome')).toBe('clean');
    expect(
      container.querySelector('[data-testid="ops-run-review-cycle"]')!.getAttribute('data-outcome')
    ).toBe('clean');
    expect(
      container
        .querySelector('[data-testid="ops-review-cycle-finding"]')!
        .getAttribute('data-status')
    ).toBe('open');
  });

  it('does NOT derive the round or the phase from the committed actors', async () => {
    // INCOHERENT PROBE: a fixer and a verifier are bound (which only happens
    // after a re-review) while the section reports round 3 of 3 in the `review`
    // phase. Counting phases or rounds client-side cannot produce this.
    const incoherent: ReviewCycleViewSection = {
      ...CANONICAL_REVIEW_CYCLE_ESCALATED,
      round: 3,
      maxRounds: 3,
      phase: 'review',
      outcome: undefined,
    };
    await openRunDetail(container, viewWith([incoherent]));

    expect(text(container, 'ops-review-cycle-round')).toBe('3/3');
    expect(text(container, 'ops-review-cycle-phase')).toBe('review');
    expect(
      container.querySelector('[data-testid="ops-run-review-cycle"]')!.getAttribute('data-phase')
    ).toBe('review');
    expect(
      Array.from(container.querySelectorAll('[data-testid="ops-review-cycle-actor"]')).map(
        (node) => node.getAttribute('data-actor-slot')
      )
    ).toEqual(['fixer', 'verifier', 'last']);
  });

  it('does NOT derive the wait reason from the phase or the outcome', async () => {
    // INCOHERENT PROBE: a terminal loop that nonetheless carries a wait reason.
    // The projector never emits both; a UI inferring "waiting" from the phase
    // or suppressing it because the loop is terminal disagrees with the server.
    const incoherent: ReviewCycleViewSection = {
      ...CANONICAL_REVIEW_CYCLE_ESCALATED,
      waitReason: 'committed-failure',
    };
    await openRunDetail(container, viewWith([incoherent]));

    expect(text(container, 'ops-review-cycle-wait')).toBe('committed-failure');
    expect(text(container, 'ops-review-cycle-outcome')).toBe('exhausted');
  });
});
