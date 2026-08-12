import { describe, expect, it } from 'vitest';

import {
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getShipCommandSkillTemplate,
  getSyncSpecsSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import type { SkillTemplate } from '../../../src/core/templates/skill-templates.js';

/**
 * `store-layout-v2-migration` task 10b.2.
 *
 * The four generated-skill gate paragraphs are the agent-facing half of the
 * legacy flat Store write refusal. In `store-planning-scope-routing` the CLI
 * half was removed and these paragraphs were narrowed to match — and the
 * narrowing was missed on the way back (round-3 finding R3-1) precisely
 * because nothing read them. The pinned-hash parity suite notices that a
 * template CHANGED; only this guard notices that the clause is GONE.
 */
const GATED_TEMPLATES: readonly (readonly [string, () => SkillTemplate])[] = [
  ['rasen-archive-change', getArchiveChangeSkillTemplate],
  ['rasen-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
  ['rasen-ship', getShipCommandSkillTemplate],
  ['rasen-sync-specs', getSyncSpecsSkillTemplate],
];

function templateText(template: SkillTemplate): string {
  return JSON.stringify(template);
}

describe('generated skill gate paragraphs', () => {
  it('keeps the legacy flat Store refusal clause in every gated workflow template', () => {
    for (const [name, createTemplate] of GATED_TEMPLATES) {
      const text = templateText(createTemplate());
      expect(text, `${name} must name the legacy-store scope`).toContain("'legacy-store'");
      expect(text, `${name} must refuse with the stable diagnostic code`).toContain(
        'legacy_flat_store_requires_migration'
      );
      expect(text, `${name} must name the repairing command`).toContain(
        'rasen store migrate-layout'
      );
    }
  });

  /**
   * `store-finalization-outcomes-v2` task 11.4.
   *
   * The routing slice's deferral is RETIRED: `store_v2_finalization_unavailable`
   * no longer exists in the product, so a template still naming it would tell
   * an agent to refuse an operation the CLI now performs. What must survive is
   * the store-project ARM itself — every gated template still has to say what a
   * Store v2 scope requires — which is the same class of omission the deferral
   * check used to catch (child 2's round-3 finding R3-1).
   */
  it('names the store-project arm in every gated template and no longer cites the retired deferral', () => {
    for (const [name, createTemplate] of GATED_TEMPLATES) {
      const text = templateText(createTemplate());
      expect(text, `${name} must still name the store-project scope`).toContain(
        "'store-project'"
      );
      expect(
        text,
        `${name} must not cite the retired store_v2_finalization_unavailable deferral`
      ).not.toContain('store_v2_finalization_unavailable');
    }
  });

  /**
   * The three surfaces that FINALIZE must carry the outcome rule; `sync-specs`
   * must instead name the landed finalization as the only route to a
   * partition's canonical specs. Enumerated per template with its reason rather
   * than asserted uniformly, so a template that quietly loses its own half of
   * the rule still fails.
   */
  it('states the Store v2 outcome rule each finalizing template owns', () => {
    const archive = templateText(getArchiveChangeSkillTemplate());
    expect(archive, 'archive must require an explicit outcome').toContain('--outcome');
    expect(archive, 'archive must present all four outcomes').toContain("'abandoned'");
    expect(archive, 'archive must forbid choosing one for the user').toContain(
      'NEVER choose one yourself'
    );

    const bulk = templateText(getBulkArchiveChangeSkillTemplate());
    expect(bulk, 'bulk must require a per-change outcome').toContain('its OWN explicitly declared');
    expect(bulk, 'bulk must refuse the whole batch when one is missing').toContain(
      'REFUSE the entire batch'
    );

    const ship = templateText(getShipCommandSkillTemplate());
    expect(ship, 'ship must pass an explicit landed outcome').toContain('--outcome landed');
    expect(ship, 'ship must treat delivery alone as insufficient').toContain(
      'NOT sufficient on its own'
    );
    expect(ship, 'ship must not substitute another outcome').toContain(
      'NEVER retry by choosing another outcome'
    );

    const sync = templateText(getSyncSpecsSkillTemplate());
    expect(sync, 'sync-specs must refuse a Store v2 partition').toContain(
      'REFUSE to write'
    );
    expect(sync, 'sync-specs must name the landed finalization as the route').toContain(
      'rasen archive <change> --outcome landed'
    );
  });

  it('does not tell agents that a legacy flat Store proceeds normally', () => {
    for (const [name, createTemplate] of GATED_TEMPLATES) {
      expect(
        templateText(createTemplate()),
        `${name} must not carry the pre-refusal wording`
      ).not.toContain("including 'legacy-store', proceeds normally");
    }
  });
});
