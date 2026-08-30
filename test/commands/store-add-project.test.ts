import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import {
  registerProject,
  writeProjectRegistryState,
} from '../../src/core/project-registry.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { snapshotDirectory as snapshot } from '../helpers/fs-snapshot.js';
import {
  createOpenSpecRoot,
  seedFlatStoreChange,
  writeSpec,
} from '../helpers/rasen-fixtures.js';

describe('store add-project', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;
  let targetStoreRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-add-project-'));
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });

    targetStoreRoot = path.join(tempDir, 'team-context');
    createOpenSpecRoot(targetStoreRoot);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  async function registerTargetStore(): Promise<void> {
    await registerStore({ id: 'team-context', localPath: targetStoreRoot, globalDataDir });
  }

  function makeProject(name: string, specId?: string): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    if (specId) {
      writeSpec(root, specId, '## Purpose\n\nProject-local spec.\n\n## Requirements\n\n- r\n');
    }
    return root;
  }

  it('registers the project as a store and adds it to the target store references', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project', 'billing');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.project.id).toBe('my-project');
    expect(payload.project.metadata_created).toBe(true);
    expect(payload.project.already_registered).toBe(false);
    expect(payload.target.id).toBe('team-context');
    expect(payload.target.reference_added).toBe(true);
    expect(payload.target.reference_already_present).toBe(false);

    // Non-destructive: the only new path inside the project is the store
    // identity file; nothing under the project's rasen/ is touched.
    expect(fs.existsSync(path.join(projectRoot, '.rasen-store', 'store.yaml'))).toBe(true);
    const targetConfig = fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(targetConfig).toContain('my-project');
  });

  it('reuses the registered Project identity when the root basename is not a valid Store id', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('rasen-2.0-test');
    const projectId = '8943c3a4-9b59-401a-aea2-4d72b45e98b8';
    await registerProject(
      { projectRoot, projectId, mode: 'in-repo' },
      { globalDataDir }
    );

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode, result.stdout || result.stderr).toBe(0);
    const payload = parseJson(result);
    expect(payload.project.id).toBe(projectId);
    expect(payload.membership.project_id).toBe(projectId);
    expect(
      fs.readFileSync(path.join(projectRoot, '.rasen-store', 'store.yaml'), 'utf-8')
    ).toContain(`id: ${projectId}`);
    expect(
      fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8')
    ).toContain(`project:${projectId}`);
  });

  it('keeps explicit --as ahead of the registered Project identity', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('rasen-2.0-explicit');
    const projectId = '3046e616-fddb-4e08-9722-1d60ac940159';
    await registerProject(
      { projectRoot, projectId, mode: 'in-repo' },
      { globalDataDir }
    );

    const result = await runCLI(
      [
        'store',
        'add-project',
        projectRoot,
        '--to',
        'team-context',
        '--as',
        'explicit-project',
        '--json',
      ],
      { cwd: tempDir, env }
    );

    expect(result.exitCode, result.stdout || result.stderr).toBe(0);
    const payload = parseJson(result);
    expect(payload.project.id).toBe('explicit-project');
    expect(payload.membership.project_id).toBe(projectId);
  });

  it('preserves the existing metadata-vs---as mismatch refusal ahead of registry fallback', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('rasen-2.0-metadata');
    const projectId = '333371fc-a9a3-41c4-be32-6b5b6efc4338';
    await registerProject(
      { projectRoot, projectId, mode: 'in-repo' },
      { globalDataDir }
    );
    const first = await runCLI(
      [
        'store',
        'add-project',
        projectRoot,
        '--to',
        'team-context',
        '--as',
        'metadata-project',
        '--json',
      ],
      { cwd: tempDir, env }
    );
    expect(first.exitCode, first.stdout || first.stderr).toBe(0);

    const conflicting = await runCLI(
      [
        'store',
        'add-project',
        projectRoot,
        '--to',
        'team-context',
        '--as',
        'different-project',
        '--json',
      ],
      { cwd: tempDir, env }
    );

    expect(conflicting.exitCode).not.toBe(0);
    expect(parseJson(conflicting).status[0].code).toBe('store_metadata_id_mismatch');
    expect(
      fs.readFileSync(path.join(projectRoot, '.rasen-store', 'store.yaml'), 'utf-8')
    ).toContain('id: metadata-project');
  });

  it('fails closed when canonical Project registry aliases disagree on identity', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('rasen-2.0-ambiguous');
    const canonicalRoot = fs.realpathSync.native(projectRoot);
    const aliasRoot = `${canonicalRoot}${path.sep}.`;
    await writeProjectRegistryState(
      {
        version: 1,
        projects: {
          [canonicalRoot]: {
            projectId: '8943c3a4-9b59-401a-aea2-4d72b45e98b8',
            name: 'rasen-2-0-ambiguous',
            mode: 'in-repo',
            home: 'project-home-a',
            lastSeen: '2026-08-30T00:00:00.000Z',
          },
          [aliasRoot]: {
            projectId: '3046e616-fddb-4e08-9722-1d60ac940159',
            name: 'rasen-2-0-ambiguous',
            mode: 'in-repo',
            home: 'project-home-b',
            lastSeen: '2026-08-30T00:00:00.000Z',
          },
        },
      },
      { globalDataDir }
    );

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).not.toBe(0);
    expect(parseJson(result).status[0].code).toBe('project_registry_alias_conflict');
    expect(fs.existsSync(path.join(projectRoot, '.rasen-store', 'store.yaml'))).toBe(false);
    expect(
      fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8')
    ).not.toContain('references:');
  });

  it('previews the registered Project identity without writing either repository', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('rasen-2.0-preview');
    const projectId = '80e4add1-291c-474e-a746-42cf9dc494c0';
    await registerProject(
      { projectRoot, projectId, mode: 'in-repo' },
      { globalDataDir }
    );
    const before = snapshot(tempDir);

    const result = await runCLI(
      [
        'store',
        'add-project',
        projectRoot,
        '--to',
        'team-context',
        '--dry-run',
        '--json',
      ],
      { cwd: tempDir, env }
    );

    expect(result.exitCode, result.stdout || result.stderr).toBe(0);
    expect(parseJson(result).project.id).toBe(projectId);
    expect(snapshot(tempDir)).toEqual(before);
  });

  it.runIf(process.platform === 'win32')(
    'matches a registered Project root through Windows path case normalization',
    async () => {
      await registerTargetStore();
      const projectRoot = makeProject('Rasen-2.0-Windows');
      const projectId = '0873678a-0362-4469-b237-fd52ab24812b';
      await registerProject(
        { projectRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      const result = await runCLI(
        ['store', 'add-project', projectRoot.toLowerCase(), '--to', 'team-context', '--json'],
        { cwd: tempDir, env }
      );

      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      expect(parseJson(result).project.id).toBe(projectId);
    }
  );

  it('touches nothing under the project rasen/ except the appended membership hint', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project', 'billing');
    const before = snapshot(path.join(projectRoot, 'rasen'));
    const projectConfigBefore = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);

    // The one amended clause (project-keyed-store-membership): `rasen/config.yaml`
    // gains the membership locator hint — and the project identity that hint's
    // record is keyed by, when the project did not carry one yet. Everything
    // else under rasen/ is byte-for-byte what it was.
    const after = snapshot(path.join(projectRoot, 'rasen'));
    const changed = [...after.keys()].filter((key) => after.get(key) !== before.get(key));
    expect(changed).toEqual(['config.yaml']);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    const projectConfigAfter = fs.readFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'utf-8'
    );
    // Every pre-existing line survives, in order.
    for (const line of projectConfigBefore.split('\n').filter((entry) => entry.trim().length > 0)) {
      expect(projectConfigAfter).toContain(line);
    }
    expect(projectConfigAfter).toContain('storeMemberships:');
    expect(projectConfigAfter).toContain('team-context');
    // The project's own config never gains a referenced-store entry.
    expect(projectConfigAfter).not.toContain('references:');
  });

  it('re-running is a no-op that reports already-registered / reference-already-present', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project');

    const first = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(first.exitCode).toBe(0);

    const second = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(second.exitCode).toBe(0);
    const payload = parseJson(second);
    expect(payload.project.already_registered).toBe(true);
    expect(payload.target.reference_added).toBe(false);
    expect(payload.target.reference_already_present).toBe(true);

    const targetConfig = fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(targetConfig.match(/my-project/gu)?.length).toBe(1);
  });

  it('the idempotent rerun note is namespace-aware ("Project", not "Store") (F-3)', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project');

    await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    const second = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(second.exitCode).toBe(0);
    const payload = parseJson(second);
    expect(payload.status).toEqual([
      expect.objectContaining({
        code: 'store_already_registered',
        message: expect.stringContaining("Project 'my-project'"),
      }),
    ]);
    expect(payload.status[0].message).not.toContain("Store 'my-project'");
  });

  it("indexes the added project's specs when the target store is selected for instructions", async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project', 'billing');

    const add = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(add.exitCode).toBe(0);

    // Seeded rather than created: this case's subject is the reference index,
    // and a legacy flat store now refuses `new change` (see
    // `seedFlatStoreChange`).
    seedFlatStoreChange(targetStoreRoot, 'store-scoped');

    const instructions = await runCLI(
      ['instructions', 'proposal', '--change', 'store-scoped', '--store', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(instructions.exitCode).toBe(0);
    const payload = parseJson(instructions);
    expect(payload.references).toEqual([
      {
        store_id: 'my-project',
        type: 'project',
        root: fs.realpathSync.native(projectRoot),
        specs: [{ id: 'billing', summary: 'Project-local spec.' }],
        fetch: 'rasen show <spec-id> --type spec --project my-project',
        status: [],
      },
    ]);
    // Index, not inline: the spec body never appears in the output.
    expect(instructions.stdout).not.toContain('## Requirements');
  });

  it('keeps the in-repo project resolving as its own root after being added', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project');

    const add = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(add.exitCode).toBe(0);

    // Normal commands from inside the project still resolve to the
    // project's own nearest root, not the target store, and land the
    // new change under the project's own rasen/changes/.
    const changeResult = await runCLI(['new', 'change', 'still-local', '--json'], {
      cwd: projectRoot,
      env,
    });
    expect(changeResult.exitCode).toBe(0);
    expect(
      fs.existsSync(path.join(projectRoot, 'rasen', 'changes', 'still-local'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetStoreRoot, 'rasen', 'changes', 'still-local'))
    ).toBe(false);
  });

  it('compares deltas with canonical specs in a selected registered project', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project');
    const add = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(add.exitCode).toBe(0);
    writeSpec(
      projectRoot,
      'billing',
      [
        '# Billing',
        '',
        '## Purpose',
        'Billing behavior remains deterministic.',
        '',
        '## Requirements',
        '',
        '### Requirement: Billing SHALL work',
        'The system SHALL create bills.',
        '',
        '#### Scenario: Creates bills',
        '- **WHEN** a billing period ends',
        '- **THEN** a bill is created',
        '',
        '#### Scenario: Exports bills',
        '- **WHEN** a bill is exported',
        '- **THEN** an export is created',
      ].join('\n')
    );
    const deltaDir = path.join(
      projectRoot,
      'rasen',
      'changes',
      'project-scenario-loss',
      'specs',
      'billing'
    );
    fs.mkdirSync(deltaDir, { recursive: true });
    fs.writeFileSync(
      path.join(deltaDir, 'spec.md'),
      [
        '## MODIFIED Requirements',
        '',
        '### Requirement: Billing SHALL work',
        'The system SHALL create bills differently.',
        '',
        '#### Scenario: Creates bills',
        '- **WHEN** a billing period ends',
        '- **THEN** a bill is created',
      ].join('\n')
    );

    const result = await runCLI(
      [
        'validate',
        'project-scenario-loss',
        '--project',
        'my-project',
        '--json',
      ],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.root.path).toBe(fs.realpathSync.native(projectRoot));
    expect(payload.items[0].issues).toContainEqual(
      expect.objectContaining({
        level: 'WARNING',
        code: 'spec_modified_scenarios_missing',
        missingScenarios: ['Exports bills'],
      })
    );
  });

  it('rejects an unknown target store with a setup hint', async () => {
    const projectRoot = makeProject('my-project');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'no-such-store', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).not.toBe(0);
    const payload = parseJson(result);
    expect(payload.status[0].message).toContain('not registered');
    expect(payload.status[0].fix).toContain('rasen store setup no-such-store');
    // Target validation fails before registration: the project must stay
    // untouched, not become a store nobody asked it to be.
    expect(fs.existsSync(path.join(projectRoot, '.rasen-store', 'store.yaml'))).toBe(false);
  });

  it('rejects adding a store to itself (same directory)', async () => {
    await registerTargetStore();

    const result = await runCLI(
      ['store', 'add-project', targetStoreRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).not.toBe(0);
    const payload = parseJson(result);
    expect(payload.status[0].message).toContain('cannot be added to itself');
    expect(payload.status[0].code).toBe('store_add_project_self_reference');
    // No reference written on rejection.
    const targetConfig = fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(targetConfig).not.toContain('references');
  });

  it('registers a project into the project namespace, distinct from the store namespace', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(result.exitCode).toBe(0);

    const list = await runCLI(['store', 'list', '--json'], { cwd: tempDir, env });
    const listPayload = parseJson(list);
    const projectEntry = listPayload.stores.find((s: any) => s.id === 'my-project');
    expect(projectEntry.type).toBe('project');

    const targetConfig = fs.readFileSync(path.join(targetStoreRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(targetConfig).toContain('project:my-project');
  });

  it('allows a project with the same id as the target store at a different path (D6)', async () => {
    await registerTargetStore();
    // Same basename as the target store ("team-context") but under a
    // different parent directory, so the inferred id collides while the
    // canonical path does not — the self-reference guard compares paths.
    const projectRoot = makeProject('elsewhere/team-context');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.project.id).toBe('team-context');
    expect(payload.target.id).toBe('team-context');
    expect(payload.target.reference_added).toBe(true);

    const list = await runCLI(['store', 'list', '--json'], { cwd: tempDir, env });
    const listPayload = parseJson(list);
    const storeEntry = listPayload.stores.find((s: any) => s.id === 'team-context' && s.type === 'store');
    const projectEntry = listPayload.stores.find((s: any) => s.id === 'team-context' && s.type === 'project');
    expect(storeEntry).toBeDefined();
    expect(projectEntry).toBeDefined();
    expect(storeEntry.root).not.toBe(projectEntry.root);
  });

  it('a project name colliding with a store name is not reported as a conflict', async () => {
    await registerTargetStore();
    await registerStore({ id: 'my-project', localPath: makeProject('some-other-store'), globalDataDir });
    const projectRoot = makeProject('my-project');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.project.id).toBe('my-project');
  });

  it('CLI e2e: --store and --project select their own same-named entries, and store list differentiates them (8.2)', async () => {
    await registerTargetStore();
    const storeRoot = path.join(tempDir, 'elftia-store-checkout');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'elftia', localPath: storeRoot, globalDataDir });

    const projectRoot = makeProject('elftia');
    const add = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );
    expect(add.exitCode).toBe(0);

    const viaStore = await runCLI(['list', '--store', 'elftia', '--json'], { cwd: tempDir, env });
    expect(viaStore.exitCode).toBe(0);
    expect(parseJson(viaStore).root.path).toBe(fs.realpathSync.native(storeRoot));

    const viaProject = await runCLI(['list', '--project', 'elftia', '--json'], {
      cwd: tempDir,
      env,
    });
    expect(viaProject.exitCode).toBe(0);
    expect(parseJson(viaProject).root.path).toBe(fs.realpathSync.native(projectRoot));

    // DELIBERATE: `store_project_mutually_exclusive` is retired — the two
    // selectors are now orthogonal dimensions (proposal.md BREAKING bullet,
    // design.md D4). The pair must still be REFUSED here, for the real reason:
    // `elftia` is a legacy flat Store with no version 2 project catalog, so
    // there is nothing to validate the project selector against. Answering with
    // the Store's flat root would silently drop `--project`.
    const both = await runCLI(['list', '--store', 'elftia', '--project', 'elftia', '--json'], {
      cwd: tempDir,
      env,
    });
    expect(both.exitCode).not.toBe(0);
    expect(parseJson(both).status[0].code).toBe('project_not_in_store');

    const storeList = await runCLI(['store', 'list', '--json'], { cwd: tempDir, env });
    const entries = parseJson(storeList).stores.filter((s: any) => s.id === 'elftia');
    expect(entries).toHaveLength(2);
    expect(entries.map((e: any) => e.type).sort()).toEqual(['project', 'store']);
  });
});
