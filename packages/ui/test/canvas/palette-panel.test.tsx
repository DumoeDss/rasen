// @vitest-environment jsdom
/**
 * PalettePanel grouped rendering (canvas-palette-grouping design D3): the
 * panel renders `groupPaletteSkills` output in BOTH branches — the v1
 * draggable card list and the v2 Stage expansion — with stable section
 * testids so order is assertable without layout claims. Bindability semantics
 * (isBindableSkill gating, disabled state labels, drag start) are unchanged
 * per entry; only the grouping is new.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PalettePanel } from '../../src/canvas/PalettePanel.js';
import type { PipelineCatalogSkill } from '../../src/api/types.js';

function skill(
  id: string,
  kind: PipelineCatalogSkill['kind'] | undefined,
  extra: Partial<PipelineCatalogSkill> = {}
): PipelineCatalogSkill {
  return {
    id,
    description: `${id} description`,
    enabled: true,
    kind,
    capability: {
      id: `skill:${id}`,
      version: `digest-${id}`,
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
    },
    ...extra,
  };
}

/**
 * A catalog delivered in NON-pipeline order with every bucket occupied: the
 * five core ids scrambled, a task and a driver, two experts, two internals,
 * one kind-less skill (older server), and one disabled expert — so a single
 * fixture exercises ordering, membership, tolerance, and bindability-at-rest
 * in both branches.
 */
const FIXTURE: PipelineCatalogSkill[] = [
  skill('rasen-ship', 'task'),
  skill('rasen-cso', 'expert'),
  skill('rasen-explore', 'task'),
  skill('rasen-review-fix', 'internal'),
  skill('rasen-propose', 'task'),
  skill('rasen-goal', 'driver'),
  skill('rasen-archive-change', 'task'),
  skill('rasen-review', 'expert', { enabled: false }),
  skill('rasen-task-loop', 'internal'),
  skill('rasen-review-cycle', 'task'),
  skill('rasen-legacy-no-kind', undefined),
  skill('rasen-apply-change', 'task'),
];

const CORE_PIPELINE_ORDER = [
  'rasen-propose',
  'rasen-apply-change',
  'rasen-review-cycle',
  'rasen-ship',
  'rasen-archive-change',
];

const SECTION_ORDER = ['core', 'workflows', 'experts', 'internal'];

/** Section ids in DOM order. */
function sectionIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid^="palette-section-"]')
  ).map((section) => section.getAttribute('data-testid')!.replace('palette-section-', ''));
}

/** The entry skill ids inside one section, in DOM order, for one branch. */
function sectionSkillIds(
  container: HTMLElement,
  sectionId: string,
  entrySelector: string,
  stripPrefix = ''
): string[] {
  const section = container.querySelector(`[data-testid="palette-section-${sectionId}"]`);
  expect(section, `missing section palette-section-${sectionId}`).not.toBeNull();
  return Array.from(section!.querySelectorAll(entrySelector)).map((entry) => {
    const raw = entry.getAttribute('data-skill') ?? entry.getAttribute('data-testid')!;
    return stripPrefix ? raw.replace(stripPrefix, '') : raw;
  });
}

describe('PalettePanel grouped sections (both branches)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  it('v2 Stage expansion: the core five lead in pipeline order with every section testid present', () => {
    render(
      <PalettePanel
        skills={FIXTURE}
        loading={false}
        definitionVersion={2}
        onAddStage={() => {}}
      />,
      container
    );
    expect(sectionIds(container)).toEqual(SECTION_ORDER);
    // The Stage gesture group is INSIDE the palette; the sections nest in it.
    expect(
      container.querySelector('[data-testid="v2-palette-gesture-stage"] [data-testid="palette-section-core"]')
    ).not.toBeNull();
    expect(sectionSkillIds(container, 'core', '[data-testid^="v2-palette-gesture-stage-"]',
      'v2-palette-gesture-stage-'
    )).toEqual(
      CORE_PIPELINE_ORDER
    );
  });

  it('v2: experts section contains exactly the expert-kind skills; internal renders after experts', () => {
    render(
      <PalettePanel
        skills={FIXTURE}
        loading={false}
        definitionVersion={2}
        onAddStage={() => {}}
      />,
      container
    );
    expect(sectionSkillIds(container, 'experts', '[data-testid^="v2-palette-gesture-stage-"]',
      'v2-palette-gesture-stage-'
    )).toEqual([
      'rasen-cso',
      'rasen-review',
    ]);
    const order = sectionIds(container);
    expect(order.indexOf('internal')).toBeGreaterThan(order.indexOf('experts'));
    expect(sectionSkillIds(container, 'internal', '[data-testid^="v2-palette-gesture-stage-"]',
      'v2-palette-gesture-stage-'
    )).toEqual([
      'rasen-review-fix',
      'rasen-task-loop',
    ]);
  });

  it('v2: a skill without kind lands in workflows (driver and kind-less both there)', () => {
    render(
      <PalettePanel
        skills={FIXTURE}
        loading={false}
        definitionVersion={2}
        onAddStage={() => {}}
      />,
      container
    );
    expect(sectionSkillIds(container, 'workflows', '[data-testid^="v2-palette-gesture-stage-"]',
      'v2-palette-gesture-stage-'
    )).toEqual([
      'rasen-explore',
      'rasen-goal',
      'rasen-legacy-no-kind',
    ]);
  });

  it('v2: a disabled skill renders disabled INSIDE its group (bindability unchanged by grouping)', () => {
    render(
      <PalettePanel
        skills={FIXTURE}
        loading={false}
        definitionVersion={2}
        onAddStage={() => {}}
      />,
      container
    );
    const card = container.querySelector(
      '[data-testid="palette-section-experts"] [data-testid="v2-palette-gesture-stage-rasen-review"]'
    ) as HTMLButtonElement;
    expect(card, 'the disabled expert must still render in the experts section').not.toBeNull();
    expect(card.disabled).toBe(true);
    expect(card.className).toContain('palette-card--disabled');
    const named = card.querySelector('[data-testid="palette-card-disabled-state"]');
    expect(named?.textContent).toBe('disabled');
  });

  it('v1 cards: same sections, core first in pipeline order, disabled skill greyed in its group, no kind -> workflows', () => {
    render(<PalettePanel skills={FIXTURE} loading={false} definitionVersion={1} />, container);
    expect(sectionIds(container)).toEqual(SECTION_ORDER);
    expect(sectionSkillIds(container, 'core', '[data-testid="palette-card"]')).toEqual(
      CORE_PIPELINE_ORDER
    );
    expect(sectionSkillIds(container, 'workflows', '[data-testid="palette-card"]')).toEqual([
      'rasen-explore',
      'rasen-goal',
      'rasen-legacy-no-kind',
    ]);
    expect(sectionSkillIds(container, 'experts', '[data-testid="palette-card"]')).toEqual([
      'rasen-cso',
      'rasen-review',
    ]);
    const disabledCard = container.querySelector(
      '[data-testid="palette-section-experts"] [data-skill="rasen-review"]'
    ) as HTMLElement;
    expect(disabledCard.className).toContain('palette-card--disabled');
    expect(disabledCard.getAttribute('draggable')).toBe('false');
    expect(disabledCard.querySelector('[data-testid="palette-card-disabled-state"]')?.textContent).toBe(
      'disabled'
    );
  });

  it('v1 and v2 produce the SAME grouped order for the same fixture', () => {
    render(
      <PalettePanel skills={FIXTURE} loading={false} definitionVersion={2} onAddStage={() => {}} />,
      container
    );
    const v2 = Object.fromEntries(
      SECTION_ORDER.map((id) => [
        id,
        sectionSkillIds(
          container,
          id,
          '[data-testid^="v2-palette-gesture-stage-"]',
          'v2-palette-gesture-stage-'
        ),
      ])
    );
    document.body.removeChild(container);
    container = document.createElement('div');
    document.body.appendChild(container);
    render(<PalettePanel skills={FIXTURE} loading={false} definitionVersion={1} />, container);
    const v1 = Object.fromEntries(
      SECTION_ORDER.map((id) => [id, sectionSkillIds(container, id, '[data-testid="palette-card"]')])
    );
    expect(v1).toEqual(v2);
  });

  it('v2 non-Stage gestures are untouched by grouping', () => {
    render(
      <PalettePanel
        skills={FIXTURE}
        loading={false}
        definitionVersion={2}
        disabledGestures={[]}
        onAddStage={() => {}}
        onAddGesture={() => {}}
      />,
      container
    );
    // The three non-Stage gesture buttons render after the Stage group, in
    // gesture order, exactly as before this change. (Everything starting
    // `v2-palette-gesture-stage` — the group AND its per-skill buttons — is
    // the Stage expansion this test deliberately excludes.)
    const gestureIds = Array.from(
      container.querySelectorAll('[data-testid^="v2-palette-gesture-"]')
    )
      .map((el) => el.getAttribute('data-testid')!)
      .filter((id) => !id.startsWith('v2-palette-gesture-stage'));
    expect(gestureIds).toEqual([
      'v2-palette-gesture-parallel',
      'v2-palette-gesture-loop',
      'v2-palette-gesture-finish',
    ]);
  });
});
