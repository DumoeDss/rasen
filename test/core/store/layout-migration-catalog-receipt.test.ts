/**
 * Task 7.6 — the v1 record to v2 catalog upgrade, and the committed receipt.
 *
 * The receipt is the only durable explanation of a migration, and it is the
 * only place the dropped adoption name lists survive. So the two properties
 * that matter are: the upgrade never invents a fact the v1 record did not
 * carry, and the receipt loses nothing the catalog dropped.
 */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  migrationReceiptPath,
  readMigrationReceipt,
  serializeMigrationReceipt,
  withMigrationReceiptPhase,
  type MigrationReceipt,
} from '../../../src/core/store/layout-migration/index.js';
import { migrationItemStateLabel } from '../../../src/core/store/layout-migration/types.js';
import { serializeStoreProjectCatalogV2 } from '../../../src/core/store/planning-catalogs.js';
import { serializeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  targetLineMappingV2,
  MIGRATION_FIXTURE_STORE_UID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

describe('store layout v2 migration — catalog upgrade and receipt', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-receipt-');
  });

  afterEach(() => {
    f.cleanup();
  });

  function catalogFor(projectId: string): Record<string, unknown> {
    return parseYaml(
      fs.readFileSync(f.at('.rasen-store', 'projects', `${projectId}.yaml`), 'utf8')
    ) as Record<string, unknown>;
  }

  it('carries every v1 field forward and binds only from adoption evidence', async () => {
    f.write(
      '.rasen-store/projects/elftia.yaml',
      [
        'version: 1',
        'projectId: elftia',
        'id: elftia',
        'remote: https://example.com/elftia.git',
        'knowledgeBundle: bundles/elftia',
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'adoption:',
        '  specs:',
        '    - billing',
        '  changes:',
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    // A roster-only member: membership alone never produces `bound`.
    await f.member('scene-bridge');
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia', 'scene-bridge']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);

    const upgraded = catalogFor('elftia');
    expect(upgraded).toMatchObject({
      version: 2,
      projectId: 'elftia',
      id: 'elftia',
      remote: 'https://example.com/elftia.git',
      knowledgeBundle: 'bundles/elftia',
      roles: { planning: true, knowledge: true },
      // `boundAt` is the canonicalized `adoptedAt`, not the clock.
      planningBinding: { state: 'bound', boundAt: '2026-01-02T03:04:05.000Z' },
    });
    expect(Object.keys(upgraded)).not.toContain('adoption');

    expect(catalogFor('scene-bridge')).toMatchObject({
      version: 2,
      projectId: 'scene-bridge',
      planningBinding: { state: 'unbound' },
    });
  });

  it('blocks rather than widening a role when a record records adoption without the planning role', async () => {
    f.write(
      '.rasen-store/projects/elftia.yaml',
      [
        'version: 1',
        'projectId: elftia',
        'roles:',
        '  planning: false',
        '  knowledge: true',
        'adoption:',
        '  specs: []',
        '  changes:',
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    expect(plan.applicable).toBe(false);
    const blocked = plan.blockers.map((item) => migrationItemStateLabel(item.state));
    expect(blocked).toContain('blocked:unrecordable-catalog-field');
    expect(plan.blockers.map((item) => item.reason).join('\n')).toContain('roles.planning');
    // Nothing was written: the record is still v1.
    expect(catalogFor('elftia').version).toBe(1);
  });

  it('blocks a v1 value the stricter v2 validators reject, telling the operator what to change it to', async () => {
    // The subject is a field v2 is genuinely stricter about. This case used to
    // use `id: Not A Portable Id`, which pinned R2-4 — the display name being
    // validated as an identifier — as if it were the intended contract. A
    // credential-bearing remote is a real v1-accepts / v2-rejects divergence,
    // and one the v2 catalog SHOULD refuse: it is committed and shared.
    f.write(
      '.rasen-store/projects/elftia.yaml',
      [
        'version: 1',
        'projectId: elftia',
        'id: Elftia',
        'remote: https://user:s3cr3t@example.com/elftia.git',
        'roles:',
        '  planning: true',
        '  knowledge: false',
        'adoption:',
        '  specs: []',
        '  changes:',
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    expect(plan.applicable).toBe(false);
    const blocker = plan.blockers.find(
      (item) => migrationItemStateLabel(item.state) === 'blocked:unrecordable-catalog-field'
    );
    expect(blocker).toBeDefined();
    // The reason still names the field and the objecting validator, for the
    // record. The REPAIR has to name the remedy — what to change the value to —
    // because migration deliberately never rewrites it for them.
    expect(blocker?.reason).toContain('remote');
    expect(blocker?.repair).toContain('credential-free');
    expect(blocker?.repair).not.toContain('never rewrites a value to make it fit');
    // And the display name is not what blocked it.
    expect(blocker?.reason).not.toContain('kebab');
  });

  /**
   * R2-4. `id` is the project's human display name in the v1 record, in
   * `StoreMembershipRecord`, and in `MembershipMutationInput.projectDisplayId`.
   * The v2 catalog used to validate it with `parseChangeId`, so a Store whose
   * record held what the field is documented to hold could not be migrated at
   * all — the entry point of the whole portfolio, blocked on a display string.
   *
   * The invariant, stated over the v1 schema's own accepted set rather than over
   * a list of examples: a migration must never block on data the schema it
   * migrates FROM accepted.
   */
  it('accepts every display name the v1 record accepts, so no real Store is unmigratable', () => {
    const names = ['elftia', 'Elftia', 'my app', 'elftia-website', 'Elftia · 前端', 'a'];
    for (const id of names) {
      const v1 = { version: 1 as const, projectId: 'elftia', id, roles: { planning: true, knowledge: true } };
      expect(() => serializeStoreProjectRecord(v1), `v1 rejected ${id}`).not.toThrow();
      expect(() =>
        serializeStoreProjectCatalogV2({
          version: 2,
          projectId: 'elftia',
          id,
          roles: { planning: true, knowledge: true },
          planningBinding: { state: 'unbound' },
        } as never),
        `v2 rejected ${id}, which v1 accepts`
      ).not.toThrow();
    }
  });

  it('migrates a Store whose membership record carries a human display name', async () => {
    f.write(
      '.rasen-store/projects/elftia.yaml',
      [
        'version: 1',
        'projectId: elftia',
        'id: Elftia',
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'adoption:',
        '  specs: []',
        '  changes:',
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(
      plan.blockers.map((item) => `${item.name}: ${item.reason}`),
      'a display name must not block the migration'
    ).toEqual([]);
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);

    // Carried forward verbatim — migration neither blocks on it nor rewrites it.
    expect(catalogFor('elftia')).toMatchObject({ version: 2, projectId: 'elftia', id: 'Elftia' });
  });

  it('preserves in the receipt everything the catalog and the flat tree dropped', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    await f.member('scene-bridge', { specs: [], changes: ['fix-b'] });
    f.writeSpec('billing');
    f.writeSpec('telemetry');
    f.writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    f.writeChange('fix-b', { 'specs/telemetry/spec.md': '# delta\n' });
    f.writeArchiveEntry('2026-07-01-old-thing');
    f.write('rasen/design-docs/cross-cutting.md', '# doc\n');
    f.write('.rasen-store/adoptions.yaml', 'version: 1\nadoptions:\n  elftia:\n    specs: [billing]\n');
    f.write(
      MAPPING,
      targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
        'archive:',
        '  2026-07-01-old-thing:',
        '    project: elftia',
        'specs:',
        '  telemetry:',
        '    owner: elftia',
      ])
    );
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    const result = await f.migration().apply(plan.token!);

    const receiptFile = migrationReceiptPath(f.storeRoot, plan.planId);
    expect(result.receiptPath).toBe(receiptFile);
    const raw = fs.readFileSync(receiptFile, 'utf8');
    const receipt = JSON.parse(raw) as MigrationReceipt;

    // The adoption name lists the v2 catalog drops survive here and nowhere else.
    expect(receipt.droppedAdoption).toContainEqual({
      projectId: 'elftia',
      specs: ['billing'],
      changes: ['fix-a'],
      adoptedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(receipt.legacyAdoptionsManifest).toContain('adoptions:');
    // A relocated legacy Archive entry is labelled, never upgraded.
    const archived = receipt.items.find((item) => item.kind === 'archive-entry');
    expect(archived?.recordSchema).toBe('legacy');
    expect(archived?.destination).toBe(
      `rasen/projects/elftia/changes/archive/${LINE}/2026-07-01-old-thing`
    );
    // The shared-spec resolution keeps every contributor, including the one
    // that did not win the capability.
    expect(receipt.sharedSpecResolutions).toContainEqual({
      capability: 'telemetry',
      mode: 'owner',
      projects: ['elftia'],
      contributors: ['elftia', 'scene-bridge'],
    });
    expect(receipt.retainedDesignDocs).toEqual(['rasen/design-docs/cross-cutting.md']);
    expect(receipt.targetLineCatalogs).toEqual([`.rasen-store/target-lines/${LINE}.yaml`]);
    expect(receipt.storeUid).toBe(MIGRATION_FIXTURE_STORE_UID);
    expect(receipt.mapping?.digest).toMatch(/^[0-9a-f]{64}$/u);
    // Every relocated Change's old alias maps to its new instance id.
    expect(receipt.changeInstances.map((entry) => entry.oldAlias).sort()).toEqual([
      'fix-a',
      'fix-b',
    ]);
    for (const instance of receipt.changeInstances) {
      expect(instance.changeInstanceId).toMatch(/^ci_/u);
      expect(instance.planningScopeId).toMatch(/^ps_/u);
    }
    // The committed record says which phases actually completed, so a published
    // migration is distinguishable from an abandoned staging run.
    expect(receipt.phases.map((phase) => phase.phase)).toEqual(['staged', 'published']);

    await f.migration().recover(f.input({ action: 'retire-flat' }));
    const afterRetirement = JSON.parse(
      fs.readFileSync(receiptFile, 'utf8')
    ) as MigrationReceipt;
    expect(afterRetirement.phases.map((phase) => phase.phase)).toEqual([
      'staged',
      'published',
      'retired',
    ]);
    // Retirement is re-runnable, and re-running does not duplicate the record.
    await f.migration().recover(f.input({ action: 'retire-flat' }));
    expect(
      (JSON.parse(fs.readFileSync(receiptFile, 'utf8')) as MigrationReceipt).phases
    ).toEqual(afterRetirement.phases);
  });

  it('serializes deterministically: UTF-8, no BOM, trailing newline, and a byte-identical round trip', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    await f.migration().apply(plan.token!);

    const bytes = fs.readFileSync(migrationReceiptPath(f.storeRoot, plan.planId));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\uFFFD');

    const parsed = JSON.parse(text) as MigrationReceipt;
    expect(serializeMigrationReceipt(parsed)).toBe(text);
    expect(readMigrationReceipt(text)).toMatchObject({
      ok: true,
      receipt: { schemaVersion: 1, planId: plan.planId },
    });
    const legitimateNonAscii = JSON.parse(text) as MigrationReceipt;
    (legitimateNonAscii.items[0] as { name: string }).name = 'Ãurea âncora 中文';
    expect(readMigrationReceipt(`${JSON.stringify(legitimateNonAscii)}\n`)).toMatchObject({
      ok: true,
    });
    expect(readMigrationReceipt(`\ufeff${text}`)).toMatchObject({ ok: false });
    expect(
      readMigrationReceipt(text.replace('billing', 'replacement \uFFFD marker'))
    ).toMatchObject({
      ok: false,
    });
    expect(readMigrationReceipt(text.replace('billing', 'FranÃ§ais double decode'))).toMatchObject({
      ok: false,
    });
    expect(readMigrationReceipt(text.replace('billing', '鏂囦欢 double decode'))).toMatchObject({
      ok: false,
    });

    const nestedUnknown = JSON.parse(text) as Record<string, unknown>;
    (nestedUnknown.items as Record<string, unknown>[])[0]!.codeCommit = 'not permitted';
    expect(readMigrationReceipt(`${JSON.stringify(nestedUnknown)}\n`)).toMatchObject({
      ok: false,
    });
  });

  it('round-trips strict receipt v2 with Store provenance, conversion digests, and unproven terminal acceptance', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.writeChange('release-coordinator');
    f.writeArchiveEntry('historical-coordinator');
    f.writePlanInput(
      'rasen/migration-inputs/release-plan.yaml',
      [
        'nodes:',
        '  - nodeId: guide',
        '    kind: intent',
        '    projectId: elftia',
        `    targetLineId: ${LINE}`,
        '    summary: Publish the guide',
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    f.write(
      MAPPING,
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
        '    plan: rasen/migration-inputs/release-plan.yaml',
        'archive:',
        '  historical-coordinator:',
        '    kind: store-issue',
        '    issueId: historical-coordinator',
        '    title: Historical coordination',
        '    state: dropped',
        '    reason: Operator declares this historical work abandoned.',
      ])
    );
    f.commitAll('declare receipt-v2 conversions');

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    await f.migration().apply(plan.token!);
    const text = fs.readFileSync(migrationReceiptPath(f.storeRoot, plan.planId), 'utf8');
    const read = readMigrationReceipt(text);
    expect(read.ok).toBe(true);
    if (!read.ok || read.receipt.schemaVersion !== 2) throw new Error('expected receipt v2');
    expect(read.receipt.sourceRevision).toEqual({
      repositoryKind: 'store',
      role: 'planning-source',
      storeUid: MIGRATION_FIXTURE_STORE_UID,
      ref: 'refs/heads/main',
      headOid: plan.headOid,
    });
    expect(read.receipt.mapping?.schemaVersion).toBe(2);
    expect(read.receipt.conversions.find(entry => entry.source.alias === 'release-coordinator'))
      .toMatchObject({
        issue: { state: 'open', reason: null, stateNature: 'migration-default-open' },
        planInput: {
          path: 'rasen/migration-inputs/release-plan.yaml',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        outputs: expect.arrayContaining([
          expect.objectContaining({ role: 'issue-record', schemaVersion: 1 }),
          expect.objectContaining({ role: 'execution-plan', schemaVersion: 1 }),
        ]),
      });
    const activeConversion = read.receipt.conversions.find(
      entry => entry.source.alias === 'release-coordinator'
    )!;
    const committedSource = f.git(
      'show',
      `${plan.headOid}:${activeConversion.source.path}/proposal.md`
    );
    const committedFileDigest = createHash('sha256')
      .update(committedSource, 'utf8')
      .digest('hex');
    expect(
      createHash('sha256')
        .update(`dir\0proposal.md\0${committedFileDigest}\0`, 'utf8')
        .digest('hex')
    ).toBe(activeConversion.source.digest);
    expect(read.receipt.conversions.find(entry => entry.source.alias === 'historical-coordinator'))
      .toMatchObject({
        issue: {
          state: 'dropped',
          reason: 'Operator declares this historical work abandoned.',
          stateNature: 'operator-asserted',
          acceptanceEvidence: 'unproven',
        },
      });
    expect(text).not.toContain('codeCommit');
    expect(serializeMigrationReceipt(read.receipt)).toBe(text);
    expect(withMigrationReceiptPhase(text, 'published', '2099-01-01T00:00:00.000Z')).toBe(text);

    const tampered = JSON.parse(text) as {
      sourceRevision: { storeUid: string };
      conversions: Array<{ issue: Record<string, unknown> }>;
    };
    tampered.conversions[0]!.issue.codeCommit = 'forbidden';
    expect(readMigrationReceipt(`${JSON.stringify(tampered)}\n`)).toMatchObject({ ok: false });
    tampered.conversions[0]!.issue = { state: 'open' };
    tampered.sourceRevision.storeUid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(readMigrationReceipt(`${JSON.stringify(tampered)}\n`)).toMatchObject({ ok: false });

    await f.migration().recover(f.input({ action: 'retire-flat' }));
    expect(fs.existsSync(f.at(...activeConversion.source.path.split('/')))).toBe(false);
    expect(fs.existsSync(f.issueAt('release-coordinator', 'issue.yaml'))).toBe(true);
    expect(fs.existsSync(f.at('rasen', 'migration-inputs', 'release-plan.yaml'))).toBe(true);
    expect(
      createHash('sha256')
        .update(
          `dir\0proposal.md\0${createHash('sha256')
            .update(
              f.git('show', `${plan.headOid}:${activeConversion.source.path}/proposal.md`),
              'utf8'
            )
            .digest('hex')}\0`,
          'utf8'
        )
        .digest('hex')
    ).toBe(activeConversion.source.digest);
  }, 180_000);

  it('records the superseded evidence a recorded identity outranked', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge');
    f.writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: scene-bridge\n',
    });
    f.write(MAPPING, targetLineMapping(LINE, ['elftia', 'scene-bridge']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    await f.migration().apply(plan.token!);

    const receipt = JSON.parse(
      fs.readFileSync(migrationReceiptPath(f.storeRoot, plan.planId), 'utf8')
    ) as MigrationReceipt;

    expect(receipt.supersededEvidence).toContainEqual(
      expect.objectContaining({ item: 'change:fix-a', projectId: 'elftia' })
    );
    // The stale record was reported, not obeyed.
    expect(receipt.items.find((item) => item.name === 'fix-a')?.owner).toBe('scene-bridge');
  });
});
