/**
 * Task 4.6 — the mapping file, the operator's one committed statement about
 * facts the old layout never recorded.
 *
 * The mapping file is the ONLY escape from the resolution gates, so every one
 * of its own refusals matters: a mapping that names something false must be an
 * error in the file rather than a silently ignored line, or the receipt ends up
 * claiming an assertion migration never honored.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  migrationItemStateLabel,
  type ImmutableMigrationPlan,
} from '../../../src/core/store/layout-migration/types.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

describe('store layout v2 migration — mapping file', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-mapping-');
  });

  afterEach(() => {
    f.cleanup();
  });

  async function seedTwoContributorSpec(): Promise<void> {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge', { specs: [], changes: ['fix-b'] });
    f.writeSpec('telemetry');
    f.writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    f.writeChange('fix-b', { 'specs/telemetry/spec.md': '# delta\n' });
  }

  function planWith(mapping: string): Promise<ImmutableMigrationPlan> {
    f.write(MAPPING, mapping);
    f.commitAll('declare the mapping');
    return f.migration().plan(f.input({ mappingPath: MAPPING }));
  }

  it('refuses a mapping file that is not the declared schema', async () => {
    await f.member('elftia');
    f.commitAll();

    await expect(planWith('version: 2\nwhatever: true\n')).rejects.toMatchObject({
      diagnostic: { code: 'migration_mapping_invalid' },
    });
  });

  it('refuses an unknown key rather than ignoring an operator declaration', async () => {
    await f.member('elftia');
    f.commitAll();

    await expect(
      planWith(['version: 1', 'changesets:', '  fix-a:', '    project: elftia', ''].join('\n'))
    ).rejects.toMatchObject({ diagnostic: { code: 'migration_mapping_invalid' } });
  });

  it('refuses a mapping file outside the Store worktree, so the plan stays reviewable', async () => {
    await f.member('elftia');
    f.commitAll();
    const outside = path.join(f.tempDir, 'mapping.yaml');

    await expect(
      f.migration().plan(f.input({ mappingPath: outside }))
    ).rejects.toMatchObject({
      diagnostic: { code: 'migration_mapping_outside_store' },
    });
  });

  it('refuses a mapping entry that contradicts a recorded identity', async () => {
    await f.member('elftia');
    await f.member('scene-bridge');
    f.writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: elftia\n',
    });

    await expect(
      planWith(
        targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
          'changes:',
          '  fix-a:',
          '    project: scene-bridge',
        ])
      )
    ).rejects.toThrow(/mapping-contradicts-recorded-identity/u);
  });

  it('refuses a mapping entry naming an item the inventory does not contain', async () => {
    await f.member('elftia');
    f.writeChange('fix-a');

    await expect(
      planWith(
        targetLineMapping(LINE, ['elftia'], ['changes:', '  no-such-change:', '    project: elftia'])
      )
    ).rejects.toThrow(/no-such-change.*inventory does not contain/su);
  });

  it('refuses a mapping entry naming a project that is not a member', async () => {
    await f.member('elftia');
    f.writeChange('fix-a');

    await expect(
      planWith(
        targetLineMapping(LINE, ['elftia'], ['changes:', '  fix-a:', '    project: outsider'])
      )
    ).rejects.toThrow(/outsider.*not a member/su);
  });

  it('refuses an id that is not portable, in every section that names one', async () => {
    await f.member('elftia');
    f.writeChange('fix-a');

    await expect(
      planWith(
        targetLineMapping(LINE, ['elftia'], ['changes:', '  fix-a:', '    project: Not Portable'])
      )
    ).rejects.toThrow(/not a portable project id/u);
  });

  it('resolves a shared spec with an owner, recording every other contributor', async () => {
    await seedTwoContributorSpec();

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
        'specs:',
        '  telemetry:',
        '    owner: elftia',
      ])
    );

    const spec = plan.items.find((item) => item.kind === 'spec');
    expect(migrationItemStateLabel(spec!.state)).toBe('resolved');
    expect(spec?.owner).toBe('elftia');
    expect(spec?.destination).toBe(f.at('rasen', 'projects', 'elftia', 'specs', 'telemetry'));
    expect(plan.sharedSpecResolutions).toEqual([
      {
        capability: 'telemetry',
        mode: 'owner',
        projects: ['elftia'],
        contributors: ['elftia', 'scene-bridge'],
      },
    ]);
  });

  it('resolves a shared spec with a split, copying the identical bytes into each partition', async () => {
    await seedTwoContributorSpec();

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
        'specs:',
        '  telemetry:',
        '    split:',
        '      - elftia',
        '      - scene-bridge',
      ])
    );

    expect(plan.sharedSpecResolutions).toEqual([
      {
        capability: 'telemetry',
        mode: 'split',
        projects: ['elftia', 'scene-bridge'],
        contributors: ['elftia', 'scene-bridge'],
      },
    ]);
    const specDestinations = plan.items
      .filter((item) => item.kind === 'spec')
      .map((item) => item.destination);
    expect(specDestinations).toEqual([
      f.at('rasen', 'projects', 'elftia', 'specs', 'telemetry'),
      f.at('rasen', 'projects', 'scene-bridge', 'specs', 'telemetry'),
    ]);
    expect(plan.applicable).toBe(true);
  });

  it('does not let a mapping entry relabel a capability provenance already assigned', async () => {
    // Design D4: E4 resolves an UNKNOWN. `session-relay` has exactly one
    // contributing archived Change, owned by `elftia`, so provenance assigns it
    // cleanly — and the operator's mapping file, carried over from a draft
    // written when the capability was shared, still says `rocut`. The identical
    // entry against a CHANGE is already ignored; specs returned on the
    // declaration before the graph was consulted at all.
    await f.member('elftia', { specs: [], changes: ['relay-work'] });
    await f.member('rocut', { specs: [], changes: [] });
    f.writeSpec('session-relay');
    f.writeChange('relay-work', { 'specs/session-relay/spec.md': '# delta\n' });

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia', 'rocut'], [
        'specs:',
        '  session-relay:',
        '    owner: rocut',
      ])
    );

    const spec = plan.items.find((item) => item.kind === 'spec');
    expect(spec?.owner).toBe('elftia');
    expect(spec?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'specs', 'session-relay')
    );
    expect(spec?.evidence.map((entry) => entry.class)).toEqual(['spec-provenance']);
    // The disagreement is not silence: the receipt carries the assertion that
    // lost, which `supersededEvidence: []` hard-coded away.
    expect(spec?.supersededEvidence).toEqual([
      expect.objectContaining({ class: 'E4-explicit-mapping', projectId: 'rocut' }),
    ]);
    // Single contributor, so nothing here is a shared-spec resolution either.
    expect(plan.sharedSpecResolutions).toEqual([]);
  });

  it('refuses a split that repeats a project id', async () => {
    await seedTwoContributorSpec();

    await expect(
      planWith(
        targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
          'specs:',
          '  telemetry:',
          '    split:',
          '      - elftia',
          '      - elftia',
        ])
      )
    ).rejects.toThrow(/repeats a project id/u);
  });

  it('writes each declared target-line catalog as a plan output, from the declaration only', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia'])
    );

    expect(plan.targetLineCatalogs).toHaveLength(1);
    const catalog = plan.targetLineCatalogs[0]!;
    expect(catalog.targetLineId).toBe(LINE);
    expect(catalog.destination).toBe(f.at('.rasen-store', 'target-lines', `${LINE}.yaml`));
    expect(catalog.catalogYaml).toContain('storeRef: refs/heads/main');
    expect(catalog.catalogYaml).toContain('codeRef: refs/heads/main');
    expect(plan.mappingDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.mappingPath).toBeTruthy();
  });

  it('blocks when a declared target line disagrees with a catalog already in the Store', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write(
      `.rasen-store/target-lines/${LINE}.yaml`,
      [
        'version: 1',
        `id: ${LINE}`,
        'storeRef: refs/heads/release/0.2',
        'projects:',
        '  elftia:',
        '    codeRef: refs/heads/release/0.2',
        '',
      ].join('\n')
    );

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia'])
    );

    expect(plan.applicable).toBe(false);
    expect(
      plan.blockers.map((item) => migrationItemStateLabel(item.state))
    ).toContain('blocked:target-line-catalog-conflict');
  });

  it('reclassifies a Store design doc into a project only when the mapping says so', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write('rasen/design-docs/retained.md', '# retained\n');
    f.write('rasen/design-docs/assigned.md', '# assigned\n');

    const plan = await planWith(
      targetLineMapping(LINE, ['elftia'], ['designDocs:', '  assigned.md: elftia'])
    );

    const docs = new Map(
      plan.items.filter((item) => item.kind === 'design-doc').map((item) => [item.name, item])
    );
    expect(docs.get('assigned.md')?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'design-docs', 'assigned.md')
    );
    // Retention is the default and stays a stated decision, not an omission.
    expect(docs.get('retained.md')?.destination).toBe(docs.get('retained.md')?.source);
    expect(plan.retainedDesignDocs.map((doc) => doc.name)).toEqual(['retained.md']);
  });
});
