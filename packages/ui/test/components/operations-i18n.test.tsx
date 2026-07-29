// @vitest-environment jsdom
/**
 * Operations-plane localization (ECP-5 task 4.2).
 *
 * The Operations plane shipped with every string hardcoded in English. This
 * pins the two halves of the fix that matter, and they pull in opposite
 * directions:
 *
 *  1. Every string the UI itself authors — section labels, field names, the
 *     wait/terminal sentence frames, control affordances, the "nothing yet"
 *     placeholders — comes from the catalog and CHANGES with the locale.
 *  2. Every value the SERVER projected — status, phase, outcome, severity,
 *     finding status, join state, member status, ids, digests — is rendered
 *     verbatim and does NOT change with the locale.
 *
 * (2) is the load-bearing half. The CLI (`pipeline status`), the Management API
 * and Operations are required by ECP-1's shipped delta to say the SAME thing
 * about one Run; translating a kernel token would make this plane disagree with
 * the other two while every parity test stayed green, because the parity suites
 * run under the default locale. So the localized run below asserts the kernel
 * tokens are untouched, not merely that the labels moved.
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
import { translate } from '../../src/i18n/catalog.js';
import { __resetLocaleForTesting, setLocale } from '../../src/i18n/store.js';
import {
  CANONICAL_PARALLEL,
  CANONICAL_REVIEW_CYCLE_ESCALATED,
} from '../fixtures/canonical-sections.js';
import type {
  ChangeRunView,
  ChangeRunViewSection,
  RunsResponse,
} from '../../src/api/types.js';

const CANONICAL_RUN_ID = 'run:' + 'a'.repeat(64);
const CANONICAL_CHANGE_ID = 'fixture-change';
const CANONICAL_WORKSPACE_DIGEST = 'sha256:' + 'c'.repeat(64);

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
      planningSpaceId: 'planning-space:' + '1'.repeat(64),
      projectId: 'project-fixture',
      changeId: CANONICAL_CHANGE_ID,
      instanceId: 'change-instance:' + '2'.repeat(64),
    },
    recordVersion: 9,
    status: 'running',
    sourceState: 'active',
    workspace: { instanceId: 'workspace-instance:' + '3'.repeat(64), scope: 'current' },
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
        planningSpaceId: 'planning-space:' + '1'.repeat(64),
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
  expect(node, testId).not.toBeNull();
  return node!.textContent!;
}

describe('Operations plane localization (ECP-5 4.2)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    __resetLocaleForTesting();
    vi.clearAllMocks();
  });

  it('renders the whole plane from the catalog, including the sections ECP-4 hardcoded', async () => {
    setLocale('zh-cn');
    await openRunDetail(
      container,
      viewWith([CANONICAL_REVIEW_CYCLE_ESCALATED, CANONICAL_PARALLEL])
    );

    // Section shell + run detail chrome.
    expect(container.querySelector('.operations-section__title')!.textContent).toBe(
      translate('zh-cn', 'operations.title')
    );
    // Accessibility attributes count as chrome: a hardcoded aria-label is
    // invisible to a visual pass but is exactly what a screen-reader user
    // hears, and the repo localizes aria-labels everywhere else.
    expect(
      container.querySelector('[data-testid="operations-section"]')!.getAttribute('aria-label')
    ).toBe(translate('zh-cn', 'operations.aria'));
    // The actor slot label is UI copy, so the tooltip that repeats it moves
    // with the locale too — the span and its title must not disagree.
    expect(
      container.querySelector('[data-testid="ops-review-cycle-actor"]')!.getAttribute('title')
    ).toContain(translate('zh-cn', 'operations.review_cycle.actor.fixer'));
    expect(text(container, 'ops-run-detail-close')).toBe(
      translate('zh-cn', 'operations.detail.close')
    );

    // The review-cycle section this change added…
    expect(text(container, 'ops-run-review-cycle')).toContain(
      translate('zh-cn', 'operations.review_cycle.loop')
    );
    expect(text(container, 'ops-review-cycle-actor')).toContain(
      translate('zh-cn', 'operations.review_cycle.actor.fixer')
    );
    // …and the parallel section ECP-4 shipped in English, retrofitted here.
    expect(text(container, 'ops-run-parallel')).toContain(
      translate('zh-cn', 'operations.parallel.fan_out')
    );
    expect(text(container, 'ops-parallel-counts')).toBe(
      translate('zh-cn', 'operations.parallel.counts', {
        active: CANONICAL_PARALLEL.activeCount,
        succeeded: CANONICAL_PARALLEL.succeededCount,
        failed: CANONICAL_PARALLEL.failedCount,
      })
    );
    // The role badge is UI copy, so it moves with the locale.
    expect(text(container, 'ops-parallel-member')).toContain(
      translate('zh-cn', 'operations.parallel.required')
    );

    // Nothing above is the English string any more — a catalog that silently
    // fell back to `en` would pass every assertion so far.
    expect(container.textContent).not.toContain('Fan-out');
    expect(container.textContent).not.toContain('Review cycle');
  });

  it('never translates a value the kernel projected', async () => {
    setLocale('zh-cn');
    await openRunDetail(
      container,
      viewWith([CANONICAL_REVIEW_CYCLE_ESCALATED, CANONICAL_PARALLEL])
    );

    // Loop phase / terminal outcome / finding severity + status are the tokens
    // `pipeline status` prints. Localizing one would split the planes.
    expect(text(container, 'ops-review-cycle-phase')).toBe(
      CANONICAL_REVIEW_CYCLE_ESCALATED.phase
    );
    expect(text(container, 'ops-review-cycle-outcome')).toBe(
      CANONICAL_REVIEW_CYCLE_ESCALATED.outcome
    );
    const finding = container.querySelector('[data-testid="ops-review-cycle-finding"]')!;
    expect(finding.getAttribute('data-severity')).toBe(
      CANONICAL_REVIEW_CYCLE_ESCALATED.findings[0]!.severity
    );
    expect(finding.textContent).toContain(CANONICAL_REVIEW_CYCLE_ESCALATED.findings[0]!.status);

    // Same for the parallel projection's join state and member statuses.
    expect(text(container, 'ops-parallel-join-state')).toBe(CANONICAL_PARALLEL.joinState);
    const memberStatuses = Array.from(
      container.querySelectorAll('[data-testid="ops-parallel-member"]')
    ).map((node) => node.getAttribute('data-member-status'));
    expect(memberStatuses).toEqual(CANONICAL_PARALLEL.members.map((m) => m.status));
    for (const member of CANONICAL_PARALLEL.members) {
      // Both the projected status and the projected condition render verbatim.
      expect(container.textContent).toContain(member.status);
      expect(container.textContent).toContain(member.condition);
    }

    // …and for the run's own core state.
    expect(text(container, 'ops-run-status')).toBe('running');
    expect(text(container, 'ops-run-source-state')).toBe('active');
    // ECP-5 (task 6.2): the engine owner joins that set — `pipeline status`
    // prints the same token, so translating it here would split the planes.
    expect(text(container, 'ops-run-engine')).toBe('reconciler');
  });

  it('keeps every locale key-complete for the plane, so no label falls back to English', () => {
    // The catalog test already enforces en/ja/zh-cn parity globally; this
    // asserts the `operations.*` namespace specifically carries a DISTINCT
    // translation rather than a copied English string, which parity alone
    // cannot detect. Tokens that are deliberately identical across locales
    // (version prefix, the product word "Run") are exempted by name.
    const IDENTICAL_BY_DESIGN = new Set([
      'operations.detail.record_version',
      'operations.detail.run',
    ]);
    const sampled = [
      'operations.title',
      'operations.detail.status',
      'operations.parallel.fan_out',
      'operations.choice.awaiting',
      'operations.review_cycle.in_progress',
      'operations.control.cancel_action',
      'operations.wait.uncertain_effect',
      'operations.terminal.completed',
      'operations.summary.terminal',
      'operations.drift.title',
      'operations.detail.record_version',
    ];
    for (const key of sampled) {
      const en = translate('en', key);
      expect(en, key).not.toBe(key); // present at all
      for (const locale of ['ja', 'zh-cn'] as const) {
        const localized = translate(locale, key);
        expect(localized, `${locale}: ${key}`).not.toBe(key);
        if (!IDENTICAL_BY_DESIGN.has(key)) {
          expect(localized, `${locale} fell back to English for ${key}`).not.toBe(en);
        }
      }
    }
  });
});
