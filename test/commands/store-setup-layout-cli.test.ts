import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getGlobalDataDir,
  getStoreMetadataPath,
  readStoreMetadataState,
} from '../../src/core/index.js';
import { inspectOpenSpecRoot } from '../../src/core/workspace-root.js';
import { readStoreLayoutState } from '../../src/core/store/layout-write-guard.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

/**
 * `rasen store setup --layout 2`: the explicit operator request that authors
 * the layout-v2 declaration at creation. A v2-native store is born with no
 * flat planning tree, so the `store_layout_mixed_residue` retirement dance
 * every migrated store had to run never exists for it; without the flag,
 * setup is exactly what it was (spec `store-planning-layout-v2`).
 */
describe('store setup --layout', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-setup-layout-'));
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
      ...isolatedGitEnv(tempDir),
    };
    globalDataDir = getGlobalDataDir({ env });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function storeRoot(id = 'issue-registry'): string {
    return path.join(tempDir, id);
  }

  it('authors the layout-2 declaration at creation with no flat planning tree', async () => {
    const root = storeRoot();
    const result = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const payload = parseJson(result);
    expect(payload.status).toEqual([]);
    // The v2-native scaffold: the rasen/ root and its config, the identity
    // file, and nothing else — no flat planning tree to retire.
    expect(payload.created_files).toEqual([
      'rasen/',
      'rasen/config.yaml',
      '.rasen-store/store.yaml',
    ]);

    const metadataText = fs.readFileSync(getStoreMetadataPath(root), 'utf-8');
    expect(metadataText).toContain('layoutVersion: 2');
    expect(metadataText).toContain('version: 2');
    const metadata = await readStoreMetadataState(root);
    expect(metadata).toMatchObject({
      version: 2,
      id: 'issue-registry',
      layoutVersion: 2,
    });

    expect(fs.existsSync(path.join(root, 'rasen', 'specs'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'rasen', 'changes'))).toBe(false);

    // Health without the flat directories: planning directories are optional
    // for a healthy root, so the v2-native store is born healthy.
    const inspection = await inspectOpenSpecRoot(root);
    expect(inspection.healthy).toBe(true);
    expect(inspection.present).toBe(true);
    expect(inspection.config.present).toBe(true);
    expect(inspection.specs.present).toBe(false);
    expect(inspection.changes.present).toBe(false);

    // Declared 2 with no flat content: the mixed-residue state every
    // temp-store dogfood had to retire by hand cannot arise here.
    const layout = await readStoreLayoutState(root);
    expect(layout).toEqual({
      declared: 2,
      mixed: false,
      flatContentPresent: false,
      publicationRecorded: false,
      retirementRecorded: false,
    });
  });

  it('initializes Git whose initial commit carries the v2-native shape', async () => {
    const root = storeRoot();
    const result = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.git).toEqual({
      is_repository: true,
      initialized: true,
      committed: true,
    });

    // A clone of the initial commit must find the v2-native shape: config,
    // identity with the declaration, and no flat planning tree.
    const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean)
      .sort();
    expect(tracked).toEqual(['.rasen-store/store.yaml', 'rasen/config.yaml']);
  });

  it('keeps the no-flag default exactly as setup creates it today', async () => {
    const root = storeRoot();
    const result = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );

    expect(result.exitCode).toBe(0);
    expect(parseJson(result).created_files).toEqual([
      'rasen/',
      'rasen/specs/',
      'rasen/changes/',
      'rasen/changes/archive/',
      'rasen/config.yaml',
      'rasen/specs/.gitkeep',
      'rasen/changes/archive/.gitkeep',
      '.rasen-store/store.yaml',
    ]);

    // No declaration is authored, inferred, or added: the default store is a
    // legacy-layout Store exactly as before the capability.
    const metadataText = fs.readFileSync(getStoreMetadataPath(root), 'utf-8');
    expect(metadataText).not.toContain('layoutVersion');
    const layout = await readStoreLayoutState(root);
    expect(layout.declared).toBe(1);
    expect(layout.mixed).toBe(false);
  });

  it('passes an immediate add-project with no mixed residue', async () => {
    const root = storeRoot();
    const setup = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );
    expect(setup.exitCode).toBe(0);

    const projectRoot = path.join(tempDir, 'member-project');
    createOpenSpecRoot(projectRoot);

    const added = await runCLI(
      ['store', 'add-project', projectRoot, '--to', 'issue-registry', '--json'],
      { cwd: tempDir, env }
    );

    // The v2-native store needs no hand-holding: the membership write finds a
    // declared layout 2 with no flat content, so no mixed-residue refusal.
    expect(added.exitCode).toBe(0);
    const payload = parseJson(added);
    const codes = payload.status.map((entry: { code: string }) => entry.code);
    expect(codes).not.toContain('store_layout_mixed_residue');
    expect(payload.membership.record_written).toBe(true);

    const layout = await readStoreLayoutState(root);
    expect(layout.declared).toBe(2);
    expect(layout.mixed).toBe(false);
  });

  it('refuses layout values other than 2, naming the accepted value', async () => {
    for (const value of ['3', '1', 'v2']) {
      const result = await runCLI(
        ['store', 'setup', 'issue-registry', '--path', storeRoot(), '--layout', value, '--no-init-git', '--json'],
        { cwd: tempDir, env }
      );

      expect(result.exitCode).toBe(1);
      const status = parseJson(result).status[0];
      expect(status.code).toBe('store_setup_layout_invalid');
      expect(status.message).toContain(`'${value}'`);
      expect(status.message).toContain('2');
    }

    // Refused before anything is created on disk.
    expect(fs.existsSync(storeRoot())).toBe(false);
  });

  it('refuses --layout 2 against an existing legacy store instead of upgrading it', async () => {
    const root = storeRoot();
    const first = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );
    expect(first.exitCode).toBe(0);

    const rerun = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );

    // The declaration is authored at creation or not by setup at all; an
    // existing record is never upgraded by the flag.
    expect(rerun.exitCode).toBe(1);
    const status = parseJson(rerun).status[0];
    expect(status.code).toBe('store_setup_layout_existing_metadata');
    expect(status.fix).toContain('migrate-layout');

    const metadataText = fs.readFileSync(getStoreMetadataPath(root), 'utf-8');
    expect(metadataText).not.toContain('layoutVersion');
  });

  it('treats a rerun against a store already declaring layout 2 as a no-op success', async () => {
    const root = storeRoot();
    const first = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );
    expect(first.exitCode).toBe(0);

    const rerun = await runCLI(
      ['store', 'setup', 'issue-registry', '--path', root, '--layout', '2', '--no-init-git', '--json'],
      { cwd: tempDir, env }
    );

    // The request is already satisfied by the committed record, so the rerun
    // stays the no-op success setup reruns are.
    expect(rerun.exitCode).toBe(0);
    const payload = parseJson(rerun);
    expect(payload.created_files).toEqual([]);
    expect(payload.registry.already_registered).toBe(true);
    const metadata = await readStoreMetadataState(root);
    expect(metadata.layoutVersion).toBe(2);
  });
});
