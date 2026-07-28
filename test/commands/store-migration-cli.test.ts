import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI } from '../helpers/run-cli.js';
import { createOpenSpecRoot, writeSpec } from '../helpers/rasen-fixtures.js';

describe('store-migration CLI', () => {
  let tempDir: string;
  let env: NodeJS.ProcessEnv;
  let globalDataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migration-cli-'));
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      RASEN_HOME: '',
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('config set archive.destination external hints archive relocate when the repo archive is non-empty', async () => {
    const repo = path.join(tempDir, 'app');
    createOpenSpecRoot(repo);
    fs.mkdirSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old', 'p.md'), 'x\n');

    const result = await runCLI(
      ['config', 'set', 'archive.destination', 'external', '--scope', 'project'],
      { cwd: repo, env }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('archive relocate --to external');
  });

  it('store eject --all --json refuses without --yes and succeeds with it', async () => {
    // A store-mode repo pointing at team-store, with no adoption manifest entry.
    const repo = path.join(tempDir, 'pointer-repo');
    fs.mkdirSync(path.join(repo, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: pid-eject\nstore: team-store\n'
    );
    // Give the store some content to copy back.
    writeSpec(storeRoot, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');

    const refused = await runCLI(
      ['store', 'eject', 'pid-eject', '--from', 'team-store', '--all', '--into', repo, '--json'],
      { cwd: repo, env }
    );
    expect(refused.exitCode).toBe(1);
    const refusedJson = JSON.parse(refused.stdout);
    expect(refusedJson.status[0].code).toBe('eject_all_confirmation_required');

    const ok = await runCLI(
      ['store', 'eject', 'pid-eject', '--from', 'team-store', '--all', '--yes', '--into', repo, '--json'],
      { cwd: repo, env }
    );
    expect(ok.exitCode).toBe(0);
    const okJson = JSON.parse(ok.stdout);
    expect(okJson.eject.specs).toContain('billing');
    expect(fs.existsSync(path.join(repo, 'rasen', 'specs', 'billing'))).toBe(true);
  });
});
