// @vitest-environment jsdom
/**
 * Component-level render coverage for EngineSupportPanel (task 14.7/14.8 of
 * `ecp-run-spine`). These tests RENDER the component and assert on its output —
 * exercising the server-truth consumption path (availableEngines/
 * reconcilerSupport/profileDigest/reason) through the real UI component.
 *
 * The panel renders the SAME shared analyzer output that `pipeline show`,
 * `pipeline start`, and the management detail endpoint produce. LEGACY_NORMALIZED
 * (executionMode) is kept as separate compatibility information.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineSupportPanel } from '../../src/canvas/EngineSupportPanel.js';
import type { WirePipeline } from '../../src/api/types.js';

/** Minimal pipeline fixture with the additive engine-support fields. */
function makePipeline(overrides: Partial<WirePipeline> = {}): WirePipeline {
  return {
    name: 'bug-fix',
    description: 'Simple bug fix',
    provenance: 'built-in',
    sourceLayer: 'package',
    stages: [],
    ...overrides,
  };
}

describe('EngineSupportPanel (14.7/14.8)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders nothing when the server did not include additive engine fields (pre-reconciler)', () => {
    // No availableEngines, no reconcilerSupport — panel is absent, not empty.
    const pipeline = makePipeline();
    render(<EngineSupportPanel pipeline={pipeline} />, container);
    expect(container.querySelector('[data-testid="engine-support-panel"]')).toBeNull();
  });

  it('renders availableEngines badges from the shared analyzer (not name guessing)', () => {
    const pipeline = makePipeline({
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_root_dag_bug_fix',
        profileDigest: 'sha256:' + 'a'.repeat(64),
      },
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    const panel = container.querySelector('[data-testid="engine-support-panel"]');
    expect(panel).not.toBeNull();

    const engines = container.querySelectorAll('[data-testid="engine-support-engine"]');
    expect(engines).toHaveLength(2);
    expect(engines[0]!.getAttribute('data-engine')).toBe('legacy');
    expect(engines[1]!.getAttribute('data-engine')).toBe('reconciler');
  });

  it('shows reconciler supported verdict, reason, and profileDigest from server truth', () => {
    const digest = 'sha256:' + 'b'.repeat(64);
    const pipeline = makePipeline({
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_root_dag_bug_fix',
        profileDigest: digest,
      },
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    const verdict = container.querySelector('[data-testid="engine-support-verdict"]')!;
    expect(verdict.getAttribute('data-supported')).toBe('true');
    expect(verdict.textContent).toContain('supported');

    const reason = container.querySelector('[data-testid="engine-support-reason"]')!;
    expect(reason.textContent).toContain('Supported: root-DAG bug-fix');

    const digestEl = container.querySelector('[data-testid="engine-support-digest"]')!;
    // The digest is shortened for display but full value in title.
    expect(digestEl.getAttribute('title')).toBe(digest);
    expect(digestEl.textContent).toContain('…');
  });

  it('shows unsupported verdict with the reason when reconciler cannot run the pipeline', () => {
    const pipeline = makePipeline({
      availableEngines: ['legacy'],
      reconcilerSupport: {
        supported: false,
        reason: 'unsupported_pipeline_shape',
        profileDigest: 'sha256:' + 'c'.repeat(64),
      },
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    const verdict = container.querySelector('[data-testid="engine-support-verdict"]')!;
    expect(verdict.getAttribute('data-supported')).toBe('false');
    expect(verdict.textContent).toContain('unsupported');

    const reason = container.querySelector('[data-testid="engine-support-reason"]')!;
    expect(reason.textContent).toContain('Unsupported: pipeline shape');

    // Only 'legacy' engine is available — reconciler is absent.
    const engines = container.querySelectorAll('[data-testid="engine-support-engine"]');
    expect(engines).toHaveLength(1);
    expect(engines[0]!.getAttribute('data-engine')).toBe('legacy');
  });

  it('keeps LEGACY_NORMALIZED executionMode as SEPARATE compatibility info', () => {
    const pipeline = makePipeline({
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_root_dag_bug_fix',
        profileDigest: 'sha256:' + 'a'.repeat(64),
      },
      executionMode: 'legacy',
      unavailableReason: undefined,
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    // The legacy section is rendered separately from the reconciler support section.
    const legacy = container.querySelector('[data-testid="engine-support-legacy"]');
    expect(legacy).not.toBeNull();
    expect(legacy!.textContent).toContain('legacy');

    // Both the reconciler verdict and legacy mode are present, in separate sections.
    const reconciler = container.querySelector('[data-testid="engine-support-reconciler"]');
    expect(reconciler).not.toBeNull();
    expect(reconciler!.textContent).toContain('supported');

    // They are NOT the same DOM node.
    expect(legacy).not.toBe(reconciler);
  });

  it('shows unavailableReason in the legacy section when present', () => {
    const pipeline = makePipeline({
      availableEngines: [],
      reconcilerSupport: {
        supported: false,
        reason: 'unsupported_definition_version',
        profileDigest: 'sha256:' + 'd'.repeat(64),
      },
      executionMode: 'unavailable',
      unavailableReason: 'No valid definition source found.',
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    const legacyReason = container.querySelector('[data-testid="engine-support-legacy-reason"]');
    expect(legacyReason).not.toBeNull();
    expect(legacyReason!.textContent).toContain('No valid definition source found.');
  });

  it('renders an unsupported pipeline shape verdict (not just supported/unsupported binary)', () => {
    const pipeline = makePipeline({
      availableEngines: [],
      reconcilerSupport: {
        supported: false,
        reason: 'unsupported_definition_version',
        profileDigest: 'sha256:' + 'd'.repeat(64),
      },
    });
    render(<EngineSupportPanel pipeline={pipeline} />, container);

    // No engines available at all (v2 pipeline that neither engine supports yet).
    const engines = container.querySelectorAll('[data-testid="engine-support-engine"]');
    expect(engines).toHaveLength(0);

    const reason = container.querySelector('[data-testid="engine-support-reason"]')!;
    expect(reason.textContent).toContain('Unsupported: definition version');
  });
});
