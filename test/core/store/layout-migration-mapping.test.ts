/**
 * Task 4.6 — the mapping file, the operator's one committed statement about
 * facts the old layout never recorded.
 *
 * The mapping file is the ONLY escape from the resolution gates, so every one
 * of its own refusals matters: a mapping that names something false must be an
 * error in the file rather than a silently ignored line, or the receipt ends up
 * claiming an assertion migration never honored.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../src/core/canonical-json.js';
import {
  canonicalPlanId,
  readImmutableMigrationPlan,
} from '../../../src/core/store/layout-migration/plan.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
} from '../../../src/core/store/planning-identity.js';
import {
  migrationItemStateLabel,
  type ImmutableMigrationPlan,
} from '../../../src/core/store/layout-migration/types.js';
import {
  createLayoutMigrationFixture,
  MIGRATION_FIXTURE_STORE_UID,
  targetLineMapping,
  targetLineMappingV2,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

function identityYaml(
  projectId: string,
  targetLineId: string,
  seed = 'ab'.repeat(16),
  storeUid = MIGRATION_FIXTURE_STORE_UID
): { readonly content: string; readonly instanceId: string } {
  const planningScopeId = derivePlanningScopeId({
    storeUid,
    projectId,
    targetLineId,
  });
  const instanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed: seed });
  return {
    instanceId,
    content: [
      'schema: spec-driven',
      'identity:',
      '  version: 2',
      `  instanceSeed: ${JSON.stringify(seed)}`,
      `  instanceId: ${JSON.stringify(instanceId)}`,
      `  storeUid: ${JSON.stringify(storeUid)}`,
      `  projectId: ${JSON.stringify(projectId)}`,
      `  targetLineId: ${JSON.stringify(targetLineId)}`,
      '',
    ].join('\n'),
  };
}

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

  it('strictly decodes mapping bytes without rejecting legitimate non-ASCII text', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');
    const mappingForTitle = (title: string): string =>
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        `    title: ${JSON.stringify(title)}`,
      ]);

    const clean = await planWith(mappingForTitle('协调发布 — Ãurea âncora'));
    const generated = clean.items.find((item) => item.name === 'release-coordinator')
      ?.materialization;
    expect(generated?.kind).toBe('generated-tree');
    expect(generated?.kind === 'generated-tree' ? generated.files[0]?.content : '').toContain(
      '协调发布 — Ãurea âncora'
    );

    for (const unsafe of [
      `\ufeff${mappingForTitle('BOM')}`,
      mappingForTitle('replacement \ufffd marker'),
      mappingForTitle('FranÃ§ais double decode'),
      mappingForTitle('鏂囦欢 double decode'),
    ]) {
      await expect(planWith(unsafe)).rejects.toMatchObject({
        diagnostic: { code: 'migration_mapping_invalid' },
      });
    }

    fs.writeFileSync(f.at(...MAPPING.split('/')), Buffer.from([0xff, 0xfe, 0xfd]));
    f.git('add', '--', MAPPING);
    f.commitAll('commit invalid mapping bytes');
    await expect(f.migration().plan(f.input({ mappingPath: MAPPING }))).rejects.toMatchObject({
      diagnostic: { code: 'migration_mapping_invalid' },
    });
  }, 180_000);

  it('keeps the complete mapping-v1 canonical body, bytes, token, and destinations stable', async () => {
    await f.member('elftia', { specs: [], changes: ['adopted-change'] });
    await f.member('scene-bridge');
    f.writeChange('adopted-change');
    f.writeChange('recorded-change', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: scene-bridge\n',
    });
    f.writeChange('mapped-change');

    const mapping = targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
      'changes:',
      '  mapped-change:',
      '    project: elftia',
    ]);
    const first = await planWith(mapping);
    const second = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const { planId, token, ...body } = first;
    const { planId: secondId, token: secondToken, ...secondBody } = second;

    expect(first.schemaVersion).toBe(1);
    expect(first.items.map((item) => [item.name, item.owner])).toEqual(
      expect.arrayContaining([
        ['adopted-change', 'elftia'],
        ['recorded-change', 'scene-bridge'],
        ['mapped-change', 'elftia'],
      ])
    );
    expect(first.items.every((item) =>
      item.materialization === undefined &&
      item.disposition === undefined &&
      item.sourceLifecycle === undefined &&
      item.planInput === undefined
    )).toBe(true);
    expect(canonicalPlanId(body)).toBe(planId);
    expect(canonicalJson(secondBody)).toBe(canonicalJson(body));
    expect(secondId).toBe(planId);
    expect(secondToken).toEqual(token);
    expect(first.items.filter((item) => item.kind === 'change').map((item) => item.destinationRelative))
      .toEqual([
        'rasen/projects/elftia/changes/adopted-change',
        'rasen/projects/elftia/changes/mapped-change',
        'rasen/projects/scene-bridge/changes/recorded-change',
      ]);
  }, 120_000);

  it('strictly dispatches closed immutable plan v1/v2 schemas without shape inference', async () => {
    await f.member('elftia', { specs: [], changes: ['project-change'] });
    f.writeChange('project-change');
    const v1 = await planWith(targetLineMapping(LINE, ['elftia']));
    expect(readImmutableMigrationPlan(v1)).toBe(v1);

    const reseal = (value: Record<string, unknown>): Record<string, unknown> => {
      const { planId: _planId, token, ...body } = value;
      const planId = canonicalPlanId(body);
      return {
        planId,
        ...body,
        ...(token === undefined
          ? {}
          : { token: { ...(token as Record<string, unknown>), planId } }),
      };
    };
    const v1WithV2Field = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    (v1WithV2Field.items as Record<string, unknown>[])[0]!.materialization = {
      kind: 'retain',
      destination: 'x',
      destinationRelative: 'x',
    };
    expect(() => readImmutableMigrationPlan(reseal(v1WithV2Field))).toThrow(
      /closed schema v1|unrecognized key|materialization/iu
    );

    f.writeChange('release-coordinator');
    const v2 = await planWith(
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
      ])
    );
    expect(readImmutableMigrationPlan(v2)).toBe(v2);

    const v2WithUnknownFileField = JSON.parse(JSON.stringify(v2)) as Record<string, unknown>;
    const generated = (v2WithUnknownFileField.items as Record<string, unknown>[]).find(
      item => (item.disposition as { kind?: unknown } | undefined)?.kind === 'store-issue'
    )!;
    const files = (generated.materialization as { files: Record<string, unknown>[] }).files;
    files[0]!.legacySource = 'forbidden';
    expect(() => readImmutableMigrationPlan(reseal(v2WithUnknownFileField))).toThrow(
      /closed schema v2|unrecognized key|legacySource/iu
    );

    const unknownVersion = reseal({
      ...(JSON.parse(JSON.stringify(v2)) as Record<string, unknown>),
      schemaVersion: 99,
    });
    expect(() => readImmutableMigrationPlan(unknownVersion)).toThrow(/unsupported schemaVersion/iu);
  }, 180_000);

  it('classifies an explicitly declared active coordinator as an open Store Issue', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');

    const plan = await planWith(
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
      ])
    );

    const coordinator = plan.items.find((item) => item.name === 'release-coordinator');
    expect(coordinator).toMatchObject({
      disposition: { kind: 'store-issue', state: 'open', reason: null },
      materialization: { kind: 'generated-tree', role: 'store-issue' },
      destination: f.issueAt('release-coordinator'),
    });
    expect(coordinator).not.toHaveProperty('owner');
    expect(plan.schemaVersion).toBe(2);
    expect(plan.applicable).toBe(true);
  });

  it('compiles a tracked sourceChange plan input to the frozen canonical identity', async () => {
    await f.member('elftia');
    f.writeChange('child-change');
    f.writeChange('release-coordinator');
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: child',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        '    sourceChange: child-change',
        '    dependsOn: []',
        '',
      ].join('\n')
    );

    const plan = await planWith(
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  child-change:',
        '    kind: project-change',
        '    project: elftia',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
        '    plan: rasen/migration-inputs/release-plan.yaml',
      ])
    );

    const coordinator = plan.items.find((item) => item.name === 'release-coordinator');
    const generated = coordinator?.materialization?.kind === 'generated-tree'
      ? coordinator.materialization.files.find((file) => file.role === 'execution-plan')
      : undefined;
    const identity = plan.mintedIdentities.find((entry) => entry.oldAlias === 'child-change');
    expect(generated?.content).toContain(`changeInstanceId: ${identity?.changeInstanceId}`);
    expect(generated?.content).not.toContain('sourceChange');
    expect(coordinator?.planInput).toMatchObject({
      relative: 'rasen/migration-inputs/release-plan.yaml',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('uses complete Store reference evidence for canonical ids and refuses every unsafe arm', async () => {
    await f.member('elftia');
    await f.member('scene-bridge');
    const existing = identityYaml('elftia', LINE);
    const foreign = identityYaml(
      'elftia',
      LINE,
      'cd'.repeat(16),
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    );
    f.writeChange('new-child');
    f.writeChange('release-coordinator');
    f.commitAll('flat migration source');
    f.switchRef('evidence', true);
    f.write('rasen/projects/elftia/changes/existing-child/.openspec.yaml', existing.content);
    f.write('rasen/projects/elftia/changes/foreign-child/.openspec.yaml', foreign.content);
    f.commitAll('committed Store reference evidence');
    f.switchRef('main');
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: existing',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${existing.instanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    const mapping = targetLineMappingV2(LINE, ['elftia', 'scene-bridge'], [
      'changes:',
      '  new-child:',
      '    kind: project-change',
      '    project: elftia',
      '  release-coordinator:',
      '    kind: store-issue',
      '    issueId: release-coordinator',
      '    title: Coordinate the release',
      '    plan: rasen/migration-inputs/release-plan.yaml',
    ]).replaceAll('refs/heads/main', 'refs/heads/evidence');
    const accepted = await planWith(mapping);
    const generated = accepted.items
      .find((item) => item.name === 'release-coordinator')
      ?.materialization;
    expect(generated?.kind === 'generated-tree' ? generated.files[1]?.content : '')
      .toContain(existing.instanceId);

    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: wrong-scope',
        '    kind: change',
        '    projectId: scene-bridge',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${existing.instanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    await expect(planWith(mapping)).rejects.toThrow(/scope.*conflict|declares scene-bridge.*committed as elftia/isu);

    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: foreign',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${foreign.instanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    await expect(planWith(mapping)).rejects.toThrow(/belongs to Store.*not to/isu);

    const minted = accepted.mintedIdentities.find((entry) => entry.oldAlias === 'new-child');
    expect(minted?.minted).toBe(true);
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: newly-minted',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${minted?.changeInstanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    await expect(planWith(mapping)).rejects.toThrow(/No committed Change metadata|unresolved/iu);

    f.switchRef('evidence');
    f.write('rasen/projects/elftia/changes/duplicate-existing-child/.openspec.yaml', existing.content);
    f.commitAll('duplicate claimant');
    f.switchRef('main');
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: duplicate',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${existing.instanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    await expect(planWith(mapping)).rejects.toThrow(/claimed by 2 candidates|ambiguous/iu);

    const unreadableMapping = mapping.replaceAll(
      'refs/heads/evidence',
      'refs/heads/missing-evidence'
    );
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: unreadable',
        '    kind: change',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ci_${'ef'.repeat(32)}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    await expect(planWith(unreadableMapping)).rejects.toThrow(/could not read 1 Store ref|unreadable/iu);
  }, 300_000);

  it('refuses sourceChange scope mismatch and non-active project-change selectors', async () => {
    await f.member('elftia');
    f.writeChange('child-change');
    f.writeChange('other-coordinator');
    f.writeChange('release-coordinator');
    f.writeArchiveEntry('historical-child');
    const planPath = 'rasen/migration-inputs/release-plan.yaml';
    const mapping = targetLineMappingV2(LINE, ['elftia'], [
      'changes:',
      '  child-change:',
      '    kind: project-change',
      '    project: elftia',
      '  other-coordinator:',
      '    kind: store-issue',
      '    issueId: other-coordinator',
      '    title: Other coordinator',
      '  release-coordinator:',
      '    kind: store-issue',
      '    issueId: release-coordinator',
      '    title: Release coordinator',
      `    plan: ${planPath}`,
      'archive:',
      '  historical-child:',
      '    kind: project-change',
      '    project: elftia',
    ]);
    const writeSelector = (selector: string, project = 'elftia'): void => {
      f.writePlanInput(planPath, [
        'nodes:',
        '  - nodeId: selected',
        '    kind: change',
        `    projectId: ${project}`,
        `    targetLineId: ${LINE}`,
        `    sourceChange: ${selector}`,
        '    dependsOn: []',
        '',
      ].join('\n'));
    };

    writeSelector('child-change', 'scene-bridge');
    await expect(planWith(mapping)).rejects.toThrow(/declares scene-bridge.*Change is elftia/isu);
    for (const selector of ['missing-child', 'historical-child', 'other-coordinator']) {
      writeSelector(selector);
      await expect(planWith(mapping)).rejects.toThrow(/0 active project-change claimant/iu);
    }
  }, 180_000);

  it('refuses external, BOM, replacement-character, invalid-byte, and drifted plan inputs', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');
    const planPath = 'rasen/migration-inputs/release-plan.yaml';
    const mappingFor = (value: string): string => targetLineMappingV2(LINE, ['elftia'], [
      'changes:',
      '  release-coordinator:',
      '    kind: store-issue',
      '    issueId: release-coordinator',
      '    title: Release coordinator',
      `    plan: ${value}`,
    ]);
    const valid = [
      'nodes:',
      '  - nodeId: intent',
      '    kind: intent',
      '    projectId: elftia',
      `    targetLineId: ${LINE}`,
      '    summary: Publish the guide',
      '    dependsOn: []',
      '',
    ].join('\n');

    const outside = path.join(f.tempDir, 'outside-plan.yaml');
    fs.writeFileSync(outside, valid, 'utf8');
    await expect(planWith(mappingFor('../outside-plan.yaml'))).rejects.toThrow(/outside the Store/iu);
    const alias = f.at('rasen', 'migration-inputs', 'outside-alias.yaml');
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    try {
      fs.symlinkSync(outside, alias, 'file');
      await expect(
        planWith(mappingFor('rasen/migration-inputs/outside-alias.yaml'))
      ).rejects.toThrow(/outside the Store/iu);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') throw error;
    }

    for (const unsafe of [
      `\ufeff${valid}`,
      valid.replace('Publish', 'Publish \ufffd'),
      valid.replace('Publish the guide', 'Publish FranÃ§ais double decode'),
      valid.replace('Publish the guide', 'Publish 鏂囦欢 double decode'),
    ]) {
      f.writePlanInput(planPath, unsafe);
      await expect(planWith(mappingFor(planPath))).rejects.toThrow(/BOM|strict UTF-8|mojibake/iu);
    }
    fs.writeFileSync(f.at(...planPath.split('/')), Buffer.from([0xff, 0xfe, 0xfd]));
    f.git('add', '--', planPath);
    await expect(planWith(mappingFor(planPath))).rejects.toThrow(/strict UTF-8/iu);

    f.writePlanInput(
      planPath,
      valid.replace('Publish the guide', 'Coordonner âprement — 中文计划')
    );
    const nonAsciiPlan = await planWith(mappingFor(planPath));
    const generated = nonAsciiPlan.items.find((item) => item.name === 'release-coordinator')
      ?.materialization;
    expect(generated?.kind).toBe('generated-tree');
    expect(generated?.kind === 'generated-tree' ? generated.files[1]?.content : '').toContain(
      'Coordonner âprement — 中文计划'
    );

    f.writePlanInput(planPath, [
      'nodes:',
      '  - nodeId: one',
      '    kind: intent',
      '    projectId: elftia',
      `    targetLineId: ${LINE}`,
      '    summary: One',
      '    dependsOn: [two]',
      '  - nodeId: two',
      '    kind: intent',
      '    projectId: elftia',
      `    targetLineId: ${LINE}`,
      '    summary: Two',
      '    dependsOn: [one]',
      '',
    ].join('\n'));
    await expect(planWith(mappingFor(planPath))).rejects.toMatchObject({
      diagnostic: { code: 'migration_issue_compilation_failed' },
    });

    f.writePlanInput(planPath, valid);
    const plan = await planWith(mappingFor(planPath));
    f.write(planPath, valid.replace('Publish the guide', 'Publish a changed guide'));
    await expect(f.migration().apply(plan.token!)).rejects.toThrow(
      /no longer a valid plan input|byte-identical/iu
    );
  }, 240_000);

  it('requires explicit legal lifecycle and reason fields for archived Issue imports', async () => {
    await f.member('elftia');
    f.writeArchiveEntry('historical-coordinator');

    await expect(
      planWith(
        targetLineMappingV2(LINE, ['elftia'], [
          'archive:',
          '  historical-coordinator:',
          '    kind: store-issue',
          '    issueId: historical-coordinator',
          '    title: Historical coordination',
          '    state: resolved',
        ])
      )
    ).rejects.toThrow(/reason.*required/su);

    const plan = await planWith(
      targetLineMappingV2(LINE, ['elftia'], [
        'archive:',
        '  historical-coordinator:',
        '    kind: store-issue',
        '    issueId: historical-coordinator',
        '    title: Historical coordination',
        '    state: dropped',
        '    reason: Operator declares that this historical intent was abandoned.',
      ])
    );
    expect(plan.items.find((item) => item.name === 'historical-coordinator')).toMatchObject({
      sourceLifecycle: 'archive-entry',
      disposition: {
        kind: 'store-issue',
        state: 'dropped',
        reason: 'Operator declares that this historical intent was abandoned.',
      },
    });
  });

  it('refuses an E1-recorded Change relabelled as an Issue', async () => {
    await f.member('elftia');
    f.writeChange('owned-change', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: elftia\n',
    });

    await expect(
      planWith(
        targetLineMappingV2(LINE, ['elftia'], [
          'changes:',
          '  owned-change:',
          '    kind: store-issue',
          '    issueId: owned-change',
          '    title: Must remain project-owned',
        ])
      )
    ).rejects.toThrow(/records identity.*mapping-contradicts-recorded-identity/su);
  });

  it('keeps trustworthy E2 ownership when mapping v2 has no redundant work declaration', async () => {
    await f.member('elftia', { specs: [], changes: ['owned-by-adoption'] });
    f.writeChange('owned-by-adoption');
    f.writeChange('coordinator');

    const plan = await planWith(
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  coordinator:',
        '    kind: store-issue',
        '    issueId: coordinator',
        '    title: Coordinator',
      ])
    );
    expect(plan.items.find((item) => item.name === 'owned-by-adoption')).toMatchObject({
      owner: 'elftia',
      disposition: { kind: 'project-change', nature: 'derived' },
      materialization: { kind: 'copy-tree' },
    });
  });

  it('lets a mapping-v2 project assertion override lower-priority E2 while preserving evidence', async () => {
    await f.member('elftia', { specs: [], changes: ['reassigned'] });
    await f.member('scene-bridge');
    f.writeChange('reassigned');
    f.writeChange('coordinator');

    const plan = await planWith(
      targetLineMappingV2(LINE, ['elftia', 'scene-bridge'], [
        'changes:',
        '  reassigned:',
        '    kind: project-change',
        '    project: scene-bridge',
        '  coordinator:',
        '    kind: store-issue',
        '    issueId: coordinator',
        '    title: Coordinator',
      ])
    );
    const item = plan.items.find((candidate) => candidate.name === 'reassigned');
    expect(item).toMatchObject({
      owner: 'scene-bridge',
      disposition: { kind: 'project-change', nature: 'operator-asserted' },
    });
    expect(item?.evidence).toEqual([
      expect.objectContaining({ class: 'E2-store-records', projectId: 'elftia' }),
      expect.objectContaining({ class: 'E4-explicit-mapping', projectId: 'scene-bridge' }),
    ]);
  });

  it('rejects cross-branch fields and case-fold-colliding Issue ids', async () => {
    await f.member('elftia');
    f.writeChange('one');
    f.writeChange('two');

    await expect(
      planWith(
        targetLineMappingV2(LINE, ['elftia'], [
          'changes:',
          '  one:',
          '    kind: store-issue',
          '    issueId: coordinator',
          '    title: One',
          '    project: elftia',
        ])
      )
    ).rejects.toThrow(/project|unrecognized|invalid/iu);

    await expect(
      planWith(
        targetLineMappingV2(LINE, ['elftia'], [
          'changes:',
          '  one:',
          '    kind: store-issue',
          '    issueId: coordinator',
          '    title: One',
          '  two:',
          '    kind: store-issue',
          '    issueId: coordinator',
          '    title: Two',
        ])
      )
    ).rejects.toThrow(/collides.*case folding/iu);
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
