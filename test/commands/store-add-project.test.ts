import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { snapshotDirectory as snapshot } from '../helpers/fs-snapshot.js';
import { createOpenSpecRoot, writeSpec } from '../helpers/rasen-fixtures.js';

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

  it('is non-destructive to the project repo (byte-for-byte rasen/ snapshot)', async () => {
    await registerTargetStore();
    const projectRoot = makeProject('my-project', 'billing');
    const before = snapshot(path.join(projectRoot, 'rasen'));
    const projectConfigBefore = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

    const result = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'team-context', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    expect(snapshot(path.join(projectRoot, 'rasen'))).toEqual(before);
    expect(fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8')).toBe(
      projectConfigBefore
    );
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

    const changeResult = await runCLI(
      ['new', 'change', 'store-scoped', '--json', '--store', 'team-context'],
      { cwd: tempDir, env }
    );
    expect(changeResult.exitCode).toBe(0);

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

    const both = await runCLI(['list', '--store', 'elftia', '--project', 'elftia', '--json'], {
      cwd: tempDir,
      env,
    });
    expect(both.exitCode).not.toBe(0);
    expect(parseJson(both).status[0].code).toBe('store_project_mutually_exclusive');

    const storeList = await runCLI(['store', 'list', '--json'], { cwd: tempDir, env });
    const entries = parseJson(storeList).stores.filter((s: any) => s.id === 'elftia');
    expect(entries).toHaveLength(2);
    expect(entries.map((e: any) => e.type).sort()).toEqual(['project', 'store']);
  });
});
