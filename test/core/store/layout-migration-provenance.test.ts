/**
 * Tasks 3.5 and 3.9 — ownership evidence, its precedence, and the heuristics
 * that are deliberately NOT evidence.
 *
 * `layout-migration-module.test.ts` already covers "no evidence at all" and E1
 * supersession. This suite covers each evidence class on its own, E2/E3
 * conflict, non-member and unrecordable owners, the spec provenance graph's
 * unknown-contributor rule, and — task 3.5 — a fixture built so that every
 * excluded heuristic WOULD produce an owner, proving each one is ignored.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProjectHomeDir } from '../../../src/core/project-registry.js';
import type {
  ProjectRegistrySnapshot,
  StoreLayoutMigrationDependencies,
} from '../../../src/core/store/layout-migration/dependencies.js';
import { migrationItemStateLabel } from '../../../src/core/store/layout-migration/types.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';

function label(item: { state: Parameters<typeof migrationItemStateLabel>[0] } | undefined): string {
  return item === undefined ? '<missing item>' : migrationItemStateLabel(item.state);
}

describe('store layout v2 migration — ownership evidence and provenance', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-provenance-');
  });

  afterEach(() => {
    f.cleanup();
  });

  /** Registers `projectId` on this machine with a work directory for `changeId` (E3). */
  function recordAssociation(projectId: string, homeName: string, changeId: string): void {
    fs.mkdirSync(
      path.join(
        getProjectHomeDir(homeName, { globalDataDir: f.globalDataDir }),
        'changes',
        changeId
      ),
      { recursive: true }
    );
  }

  /** A machine project registry holding exactly these projects. */
  function withProjects(
    entries: ReadonlyArray<{ projectId: string; home: string }>
  ): Partial<StoreLayoutMigrationDependencies> {
    const snapshot: ProjectRegistrySnapshot[] = entries.map((entry) => ({
      root: path.join(f.tempDir, entry.projectId),
      entry: {
        projectId: entry.projectId,
        name: entry.projectId,
        mode: 'in-repo',
        home: entry.home,
        lastSeen: '2026-01-01T00:00:00.000Z',
      },
    }));
    return { snapshotProjects: async () => snapshot };
  }

  it('E1 alone assigns a Change from the identity it records about itself', async () => {
    await f.member('elftia');
    f.writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: elftia\n',
    });
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(item?.owner).toBe('elftia');
    expect(item?.evidence.map((entry) => entry.class)).toContain('E1-recorded-identity');
    expect(item?.evidence.every((entry) => entry.nature === 'derived')).toBe(true);
  });

  it('E2 assigns from a membership adoption list, recorded as derived evidence', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    await f.member('scene-bridge');
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const change = plan.items.find((candidate) => candidate.name === 'fix-a');
    const spec = plan.items.find((candidate) => candidate.kind === 'spec');

    expect(change?.owner).toBe('elftia');
    expect(spec?.owner).toBe('elftia');
    for (const item of [change, spec]) {
      const e2 = item?.evidence.find((entry) => entry.class === 'E2-store-records');
      expect(e2?.nature).toBe('derived');
      expect(e2?.projectId).toBe('elftia');
    }
  });

  it('E3 assigns from a machine association only when the project is a member of THIS Store', async () => {
    await f.member('elftia');
    f.writeChange('fix-a');
    f.writeChange('fix-b');
    f.commitAll();
    recordAssociation('elftia', 'elftia-home', 'fix-a');
    // A project that is NOT a member of this Store: its association proves
    // nothing about this Store's content.
    recordAssociation('stranger', 'stranger-home', 'fix-b');

    const plan = await f
      .migration(
        withProjects([
          { projectId: 'elftia', home: 'elftia-home' },
          { projectId: 'stranger', home: 'stranger-home' },
        ])
      )
      .plan(f.input({ defaultTargetLine: LINE }));

    const assigned = plan.items.find((candidate) => candidate.name === 'fix-a');
    const stranger = plan.items.find((candidate) => candidate.name === 'fix-b');

    expect(assigned?.owner).toBe('elftia');
    expect(assigned?.evidence.map((entry) => entry.class)).toContain('E3-association');
    expect(stranger?.owner).toBeUndefined();
    expect(label(stranger)).toBe('unresolved:unknown-owner');
  });

  it('E2 and E3 disagreeing blocks rather than picking a winner', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge');
    f.writeChange('fix-a');
    f.commitAll();
    recordAssociation('scene-bridge', 'scene-bridge-home', 'fix-a');

    const plan = await f
      .migration(withProjects([{ projectId: 'scene-bridge', home: 'scene-bridge-home' }]))
      .plan(f.input({ defaultTargetLine: LINE }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(label(item)).toBe('unresolved:evidence-conflict');
    expect(item?.owner).toBeUndefined();
    expect(plan.applicable).toBe(false);
  });

  it('evidence naming a non-member project blocks and never falls back to a member', async () => {
    await f.member('elftia');
    f.writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: not-a-member\n',
    });
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(label(item)).toBe('unresolved:non-member-owner');
    expect(item?.owner).toBeUndefined();
  });

  it('an id that fails the portable contract is reported, never sanitized into a valid one', async () => {
    await f.member('elftia');
    f.writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: Not Portable\n',
    });
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(label(item)).toBe('unresolved:unrecordable-identity');
    expect(item?.owner).toBeUndefined();
    // The offending id survives verbatim in the evidence chain — recorded as
    // read, never trimmed or kebab-cased into something that would validate.
    expect(item?.evidence.map((entry) => entry.projectId)).toContain('Not Portable');
    expect(item?.destination).toBeUndefined();
  });

  it('one unresolved contributor keeps a capability unresolved rather than single-owner', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge');
    f.writeSpec('telemetry');
    f.writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    // `mystery` has no evidence at all, so it contributes an UNKNOWN
    // contributor. Dropping it would make `telemetry` look single-owner.
    f.writeChange('mystery', { 'specs/telemetry/spec.md': '# delta\n' });
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const spec = plan.items.find((candidate) => candidate.kind === 'spec');

    expect(label(spec)).toBe('unresolved:unknown-owner');
    expect(spec?.owner).toBeUndefined();
  });

  it('a capability contributed to only by one project is assigned by provenance', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge');
    f.writeSpec('telemetry');
    f.writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const spec = plan.items.find((candidate) => candidate.kind === 'spec');

    expect(spec?.owner).toBe('elftia');
    expect(spec?.contributors).toEqual(['elftia']);
    expect(spec?.evidence.map((entry) => entry.class)).toContain('spec-provenance');
    // The destination is the literal layout v2 address.
    expect(spec?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'specs', 'telemetry')
    );
  });

  /**
   * Task 3.5 — every excluded heuristic, in one fixture built to make each of
   * them fire if it were consulted.
   */
  it('ignores every excluded heuristic even when each one would produce an owner', async () => {
    // 1. change-name prefix: `elftia-rework` starts with a member project's id.
    // 2. Git branch name: the checked-out branch is literally the project id.
    // 3. directory adjacency: `adjacent-change` sits beside a spec the member owns.
    // 4. sibling ordering: `zzz-last` is the only Change after an owned one.
    // 5. single-similar-member: `elftia` is the ONLY member with a planning role,
    //    so "the only similar-looking member project" would resolve everything.
    await f.member('elftia', { specs: ['owned-spec'], changes: ['owned-change'] });
    f.writeSpec('owned-spec');
    f.writeChange('owned-change');
    f.writeChange('elftia-rework');
    f.writeChange('adjacent-change');
    f.writeChange('zzz-last');
    f.commitAll();
    f.git('checkout', '-q', '-b', 'elftia');

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const byName = new Map(plan.items.map((item) => [item.name, item]));

    // The one item with real evidence is assigned; nothing else is.
    expect(byName.get('owned-change')?.owner).toBe('elftia');
    for (const name of ['elftia-rework', 'adjacent-change', 'zzz-last']) {
      expect(label(byName.get(name)), `${name} must stay unresolved`).toBe(
        'unresolved:unknown-owner'
      );
      expect(byName.get(name)?.owner, `${name} must have no owner`).toBeUndefined();
      expect(byName.get(name)?.evidence).toEqual([]);
    }
    expect(plan.applicable).toBe(false);
  });

  it('an operator assertion resolves an unknown owner and is labelled asserted, never derived', async () => {
    await f.member('elftia');
    await f.member('scene-bridge');
    f.writeChange('mystery-change');
    f.commitAll();
    f.write(
      'rasen/mapping.yaml',
      targetLineMapping(LINE, ['elftia', 'scene-bridge'], [
        'changes:',
        '  mystery-change:',
        '    project: scene-bridge',
      ])
    );
    f.commitAll('declare the mapping');

    const plan = await f
      .migration()
      .plan(f.input({ mappingPath: 'rasen/mapping.yaml' }));
    const item = plan.items.find((candidate) => candidate.name === 'mystery-change');

    expect(item?.owner).toBe('scene-bridge');
    const e4 = item?.evidence.find((entry) => entry.class === 'E4-explicit-mapping');
    expect(e4?.nature).toBe('asserted');
    // Every other evidence entry on the item stays derived: the two are never
    // conflated in the plan the receipt is written from.
    expect(
      item?.evidence.filter((entry) => entry.class !== 'E4-explicit-mapping').every(
        (entry) => entry.nature === 'derived'
      )
    ).toBe(true);
  });
});
