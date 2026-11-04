import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import {
  StoreLayoutMigration,
  productionStoreLayoutMigrationDependencies,
  withDeterministicIdentity,
} from '../../../src/core/store/layout-migration/index.js';
import { migrationItemStateLabel } from '../../../src/core/store/layout-migration/types.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';

const STORE_UID = '11111111-2222-4333-8444-555555555555';

describe('store layout v2 migration module', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let gitEnv: NodeJS.ProcessEnv;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  function git(...args: string[]): void {
    execFileSync('git', ['-C', storeRoot, ...args], {
      env: { ...process.env, ...gitEnv },
      windowsHide: true,
      stdio: 'pipe',
    });
  }

  function writeChange(name: string, extra?: Record<string, string>): void {
    const dir = path.join(storeRoot, 'rasen', 'changes', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), `# ${name}\n`);
    for (const [relative, content] of Object.entries(extra ?? {})) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  function member(projectId: string, adoption?: { specs: string[]; changes: string[] }): void {
    void writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: adoption !== undefined, knowledge: true },
      ...(adoption === undefined
        ? {}
        : { adoption: { ...adoption, adoptedAt: '2026-01-02T03:04:05.000Z' } }),
    });
  }

  function migration(): StoreLayoutMigration {
    return new StoreLayoutMigration(
      withDeterministicIdentity(productionStoreLayoutMigrationDependencies, {
        now: '2026-08-07T00:00:00.000Z',
      }),
      { globalDataDir }
    );
  }

  function planInput(overrides: Record<string, unknown> = {}): never {
    return {
      storeSelector: 'team-store',
      startPath: storeRoot,
      globalDataDir,
      ...overrides,
    } as never;
  }

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-layout-migration-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });
    gitEnv = isolatedGitEnv(tempDir);

    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: STORE_UID,
      id: 'team-store',
    });
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir });
    execFileSync('git', ['init', '-b', 'main', storeRoot], {
      env: { ...process.env, ...gitEnv },
      windowsHide: true,
      stdio: 'pipe',
    });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function commitAll(): void {
    git('add', '-A');
    git('commit', '-m', 'fixture');
  }

  it('inventories a damaged flat Store completely and writes nothing', async () => {
    writeSpec(storeRoot, 'billing', '# billing\n');
    writeChange('add-thing');
    // An unparsable membership record: recorded with its reason, never fatal.
    fs.mkdirSync(path.join(storeRoot, '.rasen-store', 'projects'), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, '.rasen-store', 'projects', 'broken.yaml'),
      ': not yaml : at all\n'
    );
    commitAll();

    const before = snapshotDirectory(storeRoot);
    const inventory = await migration().inventory(planInput());

    expect(inventory.specs).toEqual(['billing']);
    expect(inventory.changes).toEqual(['add-thing']);
    expect(inventory.membershipRecords).toEqual(['broken.yaml']);
    expect(inventory.refs.map((ref) => ref.ref)).toContain('refs/heads/main');
    expect(snapshotDirectory(storeRoot)).toEqual(before);
  });

  it('reports every flat ref and states that migrating one does not migrate the others', async () => {
    writeSpec(storeRoot, 'billing', '# billing\n');
    commitAll();
    git('branch', 'release');

    const inventory = await migration().inventory(planInput());
    const other = inventory.refs.find((ref) => ref.ref === 'refs/heads/release');

    expect(other?.classification).toBe('flat');
    expect(other?.checkedOut).toBe(false);
    expect(other?.notCandidateReason).toContain('checked out in the invoking Store worktree');
    expect(other?.migrateFrom).toContain('refs/heads/release');
  });

  it('never distributes unattributed Changes among member projects', async () => {
    member('elftia', { specs: [], changes: [] });
    member('scene-bridge');
    writeChange('mystery-change');
    commitAll();

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    const item = plan.items.find((candidate) => candidate.name === 'mystery-change');

    expect(migrationItemStateLabel(item?.state ?? { kind: 'resolved' })).toBe(
      'unresolved:unknown-owner'
    );
    expect(item?.owner).toBeUndefined();
    expect(plan.applicable).toBe(false);
  });

  it('keeps a recorded identity binding and records the stale record as superseded', async () => {
    member('elftia', { specs: [], changes: ['fix-a'] });
    member('scene-bridge', { specs: [], changes: [] });
    writeChange('fix-a', {
      '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: scene-bridge\n',
    });
    commitAll();

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(item?.owner).toBe('scene-bridge');
    expect(item?.supersededEvidence.map((entry) => entry.projectId)).toContain('elftia');
  });

  it('blocks a capability contributed to by two projects until it is declared', async () => {
    member('elftia', { specs: [], changes: ['fix-a'] });
    member('scene-bridge', { specs: [], changes: ['fix-b'] });
    writeSpec(storeRoot, 'telemetry', '# telemetry\n');
    writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    writeChange('fix-b', { 'specs/telemetry/spec.md': '# delta\n' });
    commitAll();

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    const spec = plan.items.find((candidate) => candidate.kind === 'spec');

    expect(migrationItemStateLabel(spec?.state ?? { kind: 'resolved' })).toBe(
      'unresolved:shared-spec'
    );
    expect(spec?.contributors).toEqual(['elftia', 'scene-bridge']);
    expect(spec?.repair).toContain('specs.telemetry.owner');
    expect(plan.applicable).toBe(false);
  });

  it('refuses a Change with no declared target line rather than deriving one', async () => {
    member('elftia', { specs: [], changes: ['fix-a'] });
    writeChange('fix-a');
    commitAll();

    const plan = await migration().plan(planInput());
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(migrationItemStateLabel(item?.state ?? { kind: 'resolved' })).toBe(
      'unresolved:missing-target-line'
    );
    // The checked-out branch is `main`; nothing derived a line from it.
    expect(item?.targetLineId).toBeUndefined();
  });

  it('produces an identical plan id for equal inputs', async () => {
    member('elftia', { specs: [], changes: ['fix-a'] });
    writeChange('fix-a');
    commitAll();

    const first = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    const second = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));

    expect(second.planId).toBe(first.planId);
  });

  it('retains Store-level design docs as a stated decision', async () => {
    member('elftia', { specs: [], changes: [] });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'design-docs'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'design-docs', 'cross-cutting.md'), '# doc\n');
    commitAll();

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));

    expect(plan.retainedDesignDocs.map((doc) => doc.name)).toEqual(['cross-cutting.md']);
    const item = plan.items.find((candidate) => candidate.kind === 'design-doc');
    expect(item?.state.kind).toBe('resolved');
    expect(item?.destination).toBe(item?.source);
  });

  it('refuses to apply while any item is unresolved, and writes nothing', async () => {
    member('elftia', { specs: [], changes: [] });
    writeChange('mystery-change');
    commitAll();

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    expect(plan.token).toBeUndefined();

    const before = snapshotDirectory(storeRoot);
    await expect(
      migration().apply({
        planId: plan.planId,
        storeUid: STORE_UID,
        ref: 'refs/heads/main',
        headOid: plan.headOid as string,
        inventoryFingerprint: plan.inventoryFingerprint,
      })
    ).rejects.toThrow(/migration plan|No stored plan/i);
    expect(snapshotDirectory(storeRoot)).toEqual(before);
  });

  it('blocks a dirty source rather than relocating a modified tree', async () => {
    member('elftia', { specs: [], changes: ['fix-a'] });
    writeChange('fix-a');
    commitAll();
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'changes', 'fix-a', 'proposal.md'),
      '# edited\n'
    );

    const plan = await migration().plan(planInput({ defaultTargetLine: 'line-0.2' }));
    const item = plan.items.find((candidate) => candidate.name === 'fix-a');

    expect(migrationItemStateLabel(item?.state ?? { kind: 'resolved' })).toBe(
      'blocked:dirty-source'
    );
  });
});
