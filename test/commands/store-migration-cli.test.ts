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

  // The destination axis is retired (`config-key-registry` capability): the
  // key is no longer settable in any scope, so there is no config-only
  // destination flip left to hint about.
  it('config set archive.destination is rejected as not settable', async () => {
    const repo = path.join(tempDir, 'app');
    createOpenSpecRoot(repo);
    fs.mkdirSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old', 'p.md'), 'x\n');

    const result = await runCLI(
      ['config', 'set', 'archive.destination', 'external', '--scope', 'project'],
      { cwd: repo, env }
    );
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('archive.destination');
    // No config file gains the retired key.
    const config = fs.readFileSync(path.join(repo, 'rasen', 'config.yaml'), 'utf-8');
    expect(config).not.toContain('destination');
  });

  // The external archive destination is retired (`store-adopt` capability):
  // the flag is refused before anything moves, and no config records it.
  it('store adopt --archive external is rejected as retired', async () => {
    const repo = path.join(tempDir, 'adopt-app');
    createOpenSpecRoot(repo);
    fs.mkdirSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old', 'p.md'),
      'x\n'
    );

    const result = await runCLI(
      ['store', 'adopt', repo, '--to', 'team-store', '--archive', 'external', '--json'],
      { cwd: repo, env }
    );
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.status[0].code).toBe('adopt_external_archive_retired');
    // Nothing moved and no destination was recorded.
    expect(fs.existsSync(path.join(repo, 'rasen', 'changes', 'archive', '2026-07-01-old'))).toBe(
      true
    );
    expect(fs.readdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([]);
    const config = fs.readFileSync(path.join(repo, 'rasen', 'config.yaml'), 'utf-8');
    expect(config).not.toContain('destination');
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

  // Task 10.4 and design D13: BOTH doctors, identical codes and repair
  // commands. `rasen doctor` is the obvious first command for a Store owner and
  // `store doctor`'s findings do not replace it; it reported none of the nine
  // new codes, so a Store owner was told nothing about flat refs, mixed
  // residue, or an interrupted migration.
  it('rasen doctor reports the same planning-layout codes and repairs as rasen store doctor', async () => {
    writeSpec(storeRoot, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'fix-a'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'changes', 'fix-a', 'proposal.md'), '# fix-a\n');

    const storeDoctor = await runCLI(['store', 'doctor', 'team-store', '--json'], {
      cwd: tempDir,
      env,
    });
    const storeFindings = (JSON.parse(storeDoctor.stdout).status as Array<{
      code: string;
      fix?: string;
    }>).filter((entry) => entry.code.startsWith('store_layout_'));
    expect(storeFindings.length).toBeGreaterThan(0);

    const rootDoctor = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    const rootPayload = JSON.parse(rootDoctor.stdout) as {
      storeLayout?: Array<{ code: string; fix?: string }>;
    };
    const rootFindings = (rootPayload.storeLayout ?? []).filter((entry) =>
      entry.code.startsWith('store_layout_')
    );

    // Identical codes AND identical repairs — the same diagnoser answers both,
    // so the two commands cannot drift apart.
    expect(rootFindings.map((entry) => `${entry.code}|${entry.fix ?? ''}`).sort()).toEqual(
      storeFindings.map((entry) => `${entry.code}|${entry.fix ?? ''}`).sort()
    );

    // And the human rendering carries the code, not only the prose.
    const human = await runCLI(['doctor'], { cwd: storeRoot, env });
    for (const finding of rootFindings) {
      expect(human.stdout).toContain(finding.code);
      if (finding.fix) expect(human.stdout).toContain(finding.fix);
    }
  });

  // R2-1. The case above runs ambient, correctly — but against a LEGACY FLAT
  // Store, which resolves as `legacy-store` and never meets the refusal. A
  // MIGRATED Store resolves as a store aggregate, and doctor only asked for the
  // `store-read` intent when `--store` was passed, so the single most likely
  // invocation — stand in the Store you just migrated, type `rasen doctor` —
  // exited 1 with `project_scope_required` and emitted no `storeLayout` at all.
  // The fix for a "one surface is never proof" finding had itself been verified
  // on one surface.
  it('rasen doctor run ambient inside a MIGRATED store reports its layout findings', async () => {
    const migrated = path.join(tempDir, 'migrated-store');
    createOpenSpecRoot(migrated);
    await registerStore({ id: 'migrated-store', localPath: migrated, globalDataDir });
    fs.mkdirSync(path.join(migrated, '.rasen-store', 'projects'), { recursive: true });
    fs.writeFileSync(
      path.join(migrated, '.rasen-store', 'store.yaml'),
      'version: 2\nuid: 44444444-5555-4666-8777-888888888888\nid: migrated-store\nlayoutVersion: 2\n'
    );
    fs.writeFileSync(
      path.join(migrated, '.rasen-store', 'projects', 'elftia.yaml'),
      [
        'version: 2',
        'projectId: elftia',
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'planningBinding:',
        '  state: unbound',
        '',
      ].join('\n')
    );
    // A partition with no catalog, so the Store has a real finding to report and
    // the assertion cannot pass on an empty list.
    fs.mkdirSync(path.join(migrated, 'rasen', 'projects', 'ghost', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(migrated, 'rasen', 'projects', 'ghost', 'specs', 'spec.md'),
      '# ghost\n'
    );

    const ambient = await runCLI(['doctor', '--json'], { cwd: migrated, env });
    expect(ambient.exitCode).toBe(0);
    const payload = JSON.parse(ambient.stdout) as {
      storeLayout?: Array<{ code: string; fix?: string }>;
    };
    expect(payload.storeLayout, 'ambient doctor emitted no storeLayout key').toBeDefined();
    expect((payload.storeLayout ?? []).map((entry) => entry.code)).toContain(
      'store_layout_partition_orphan'
    );

    // Same codes and repairs as the explicit forms — the point of task 10.4.
    const explicit = await runCLI(['doctor', '--store', 'migrated-store', '--json'], {
      cwd: tempDir,
      env,
    });
    const storeDoctor = await runCLI(['store', 'doctor', 'migrated-store', '--json'], {
      cwd: tempDir,
      env,
    });
    const key = (entry: { code: string; fix?: string }): string => `${entry.code}|${entry.fix ?? ''}`;
    const ambientKeys = (payload.storeLayout ?? []).map(key).sort();
    expect(
      ((JSON.parse(explicit.stdout).storeLayout ?? []) as Array<{ code: string; fix?: string }>)
        .map(key)
        .sort()
    ).toEqual(ambientKeys);
    expect(
      ((JSON.parse(storeDoctor.stdout).status ?? []) as Array<{ code: string; fix?: string }>)
        .filter((entry) => entry.code.startsWith('store_layout_'))
        .map(key)
        .sort()
    ).toEqual(ambientKeys);
  });
});
