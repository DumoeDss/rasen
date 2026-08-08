import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { snapshotDirectory as snapshot } from '../helpers/fs-snapshot.js';
import {
  createOpenSpecRoot,
  seedFlatStoreChange,
  writeSpec,
} from '../helpers/rasen-fixtures.js';

describe('declared store fallback (3.2)', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;
  let storeRoot: string;
  let pointerRepo: string;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-declared-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });

    storeRoot = path.join(tempDir, 'team-context');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-context', localPath: storeRoot, globalDataDir });

    pointerRepo = path.join(tempDir, 'app-repo');
    fs.mkdirSync(path.join(pointerRepo, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(pointerRepo, 'rasen', 'config.yaml'),
      'store: team-context\n'
    );
  });

  afterEach(() => {
    // Windows can hold a brief handle on a just-exited spawned CLI; retry
    // the recursive remove so EBUSY during teardown does not flake the run.
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }


  it('runs the externalized-planning journey without --store anywhere', async () => {
    const pointerBefore = snapshot(pointerRepo);

    // Creating is the one step this store can no longer serve: a legacy flat
    // store refuses `new change` with `legacy_flat_store_requires_migration`
    // and names the migration (change `store-layout-v2-migration`,
    // `proposal.md` BREAKING bullet 2, task 10b.1). The refusal is asserted
    // HERE, in the declared-pointer journey, because that is where a user
    // meets it: resolution still lands on the store, and the refusal comes
    // from the store's layout rather than from the pointer.
    const created = await runCLI(['new', 'change', 'billing-rework', '--json'], {
      cwd: pointerRepo,
      env,
    });
    expect(created.exitCode).toBe(1);
    expect(`${created.stdout}${created.stderr}`).toContain(
      'legacy_flat_store_requires_migration'
    );
    expect(`${created.stdout}${created.stderr}`).toContain('store migrate-layout');

    // Everything downstream still resolves through the declared pointer, so
    // the Change is seeded into the store the pointer names (see
    // `seedFlatStoreChange`) and the journey continues unchanged.
    seedFlatStoreChange(
      storeRoot,
      'billing-rework',
      '## Why\n\nBilling rework.\n\n## What Changes\n\n- **billing:** Rework billing\n'
    );

    const statusHuman = await runCLI(['status', '--change', 'billing-rework'], {
      cwd: pointerRepo,
      env,
    });
    expect(statusHuman.exitCode).toBe(0);
    expect(statusHuman.stderr).toContain('Using Rasen root: team-context');

    // Hint continuity: follow-ups carry --store (JSON nextSteps is the
    // surface that prints them).
    const statusJson = await runCLI(['status', '--change', 'billing-rework', '--json'], {
      cwd: pointerRepo,
      env,
    });
    expect(parseJson(statusJson).nextSteps.join(' ')).toContain('--store team-context');
    // The established compatibility fields for a DECLARED root are unchanged.
    // The additive `scope` block is not asserted here: only the authoring
    // resolution attaches one, and authoring against a legacy flat store is
    // now refused. It is asserted where a scope is actually produced —
    // `test/commands/store-v2-planning-scope-journey.test.ts` for
    // `store-project` and `store-aggregate`.
    expect(parseJson(statusJson).root).toMatchObject({
      path: fs.realpathSync.native(storeRoot),
      source: 'declared',
      store_id: 'team-context',
    });
    expect(Object.keys(parseJson(statusJson).root).sort()).toEqual([
      'path',
      'source',
      'store_id',
    ]);

    const instructions = await runCLI(
      ['instructions', 'proposal', '--change', 'billing-rework', '--json'],
      { cwd: pointerRepo, env }
    );
    expect(instructions.exitCode).toBe(0);

    const changeDir = path.join(storeRoot, 'rasen', 'changes', 'billing-rework');
    const deltaDir = path.join(changeDir, 'specs', 'billing');
    fs.mkdirSync(deltaDir, { recursive: true });
    fs.writeFileSync(
      path.join(deltaDir, 'spec.md'),
      '## ADDED Requirements\n\n### Requirement: Billing SHALL work\nThe system SHALL bill.\n\n#### Scenario: Bills\n- **WHEN** a period ends\n- **THEN** a bill exists\n'
    );

    const validate = await runCLI(['validate', 'billing-rework', '--json', '--no-interactive'], {
      cwd: pointerRepo,
      env,
    });
    expect(validate.exitCode).toBe(0);

    const list = await runCLI(['list', '--json'], { cwd: pointerRepo, env });
    expect(parseJson(list).root.source).toBe('declared');

    const show = await runCLI(['show', 'billing-rework', '--json', '--type', 'change'], {
      cwd: pointerRepo,
      env,
    });
    expect(show.exitCode).toBe(0);

    // Archiving is the other step this store can no longer serve, and this is
    // the resolution that proves the refusal is REACHABLE. Only the authoring
    // resolution attaches a planning scope; a declared pointer to a legacy flat
    // Store comes back through the frozen compatibility adapter with none, so
    // for a while `rasen new change` refused here while `rasen archive` wrote
    // into the flat tree anyway. `storeFinalizationDiagnostic()` now classifies
    // the resolved root's own Store declaration when no scope is attached
    // (change `store-layout-v2-migration`, task 10b.1).
    const archived = await runCLI(['archive', 'billing-rework', '--yes', '--json'], {
      cwd: pointerRepo,
      env,
    });
    expect(archived.exitCode).toBe(1);
    expect(parseJson(archived).status[0]).toMatchObject({
      code: 'legacy_flat_store_requires_migration',
      fix: "Run 'rasen store migrate-layout team-context' to migrate this Store, then retry.",
    });
    // Refused before moving anything: the Change is still active and the flat
    // archive directory is still empty.
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'billing-rework', 'proposal.md'))
    ).toBe(true);
    expect(fs.readdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([]);

    // The pointer repo is byte-identical: no specs/, no changes/, nothing.
    expect(snapshot(pointerRepo)).toEqual(pointerBefore);
    // Heaviest test in the file (8 CLI subprocess spawns); the 10s default
    // is tight on slow Windows runners.
  }, 60_000);

  it('composes with 3.1: the declared root surfaces the store own references', async () => {
    const upstreamRoot = path.join(tempDir, 'upstream-context');
    createOpenSpecRoot(upstreamRoot);
    writeSpec(upstreamRoot, 'platform-rules', '## Purpose\n\nPlatform rules.\n');
    await registerStore({ id: 'upstream-context', localPath: upstreamRoot, globalDataDir });
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - upstream-context\n'
    );

    // Seeded rather than created: this case's subject is the reference index,
    // and a legacy flat store now refuses `new change` (see
    // `seedFlatStoreChange`).
    seedFlatStoreChange(storeRoot, 'ref-check');

    const instructions = await runCLI(
      ['instructions', 'proposal', '--change', 'ref-check', '--json'],
      { cwd: pointerRepo, env }
    );
    const refs = parseJson(instructions).references;
    expect(refs.map((entry: any) => entry.store_id)).toEqual(['upstream-context']);
  });

  it('refuses init in a pointer repo and creates nothing, then converts cleanly', async () => {
    const before = snapshot(pointerRepo);
    const dataBefore = fs.existsSync(path.join(tempDir, 'data'))
      ? snapshot(path.join(tempDir, 'data'))
      : null;

    const refused = await runCLI(['init', '.'], { cwd: pointerRepo, env });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("externalized to store 'team-context'");
    expect(refused.stderr).toContain('Remove the store: line');
    expect(snapshot(pointerRepo)).toEqual(before);
    if (dataBefore) {
      expect(snapshot(path.join(tempDir, 'data'))).toEqual(dataBefore);
    }

    const refusedNone = await runCLI(['init', '.', '--tools', 'none'], {
      cwd: pointerRepo,
      env,
    });
    expect(refusedNone.exitCode).toBe(1);
    expect(refusedNone.stderr).toContain("externalized to store 'team-context'");
    expect(snapshot(pointerRepo)).toEqual(before);
    if (dataBefore) {
      expect(snapshot(path.join(tempDir, 'data'))).toEqual(dataBefore);
    }

    // Conversion: remove the line, rerun, get a normal local root.
    fs.writeFileSync(path.join(pointerRepo, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const converted = await runCLI(['init', '.', '--tools', 'none'], {
      cwd: pointerRepo,
      env,
    });
    expect(converted.exitCode).toBe(0);
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'specs'))).toBe(true);
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'changes'))).toBe(true);
  });

  it('installs an explicit tool through an alias of the exact pointer root', async () => {
    const pointerAlias = path.join(tempDir, 'app-repo-alias');
    fs.symlinkSync(
      pointerRepo,
      pointerAlias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(path.resolve(pointerAlias)).not.toBe(fs.realpathSync.native(pointerAlias));
    expect(fs.realpathSync.native(pointerAlias)).toBe(fs.realpathSync.native(pointerRepo));

    const installed = await runCLI(['init', pointerAlias, '--tools', 'codex'], {
      cwd: tempDir,
      env,
    });

    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain('Codex');
    expect(
      fs.existsSync(path.join(pointerRepo, '.codex', 'skills', 'rasen-explore', 'SKILL.md'))
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(pointerRepo, 'rasen', 'config.yaml'), 'utf-8')
    ).toContain('store: team-context');
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'specs'))).toBe(false);
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'changes'))).toBe(false);
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'changes', 'archive'))).toBe(false);
  });

  it('refuses init for malformed pointers and from pointer-repo subdirectories', async () => {
    // A broken declaration must not be buried under a scaffold.
    fs.writeFileSync(
      path.join(pointerRepo, 'rasen', 'config.yaml'),
      'store: [team-context]\n'
    );
    const malformed = await runCLI(['init', '.', '--tools', 'codex'], {
      cwd: pointerRepo,
      env,
    });
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain('Fix or remove the store: line');
    expect(fs.existsSync(path.join(pointerRepo, 'rasen', 'specs'))).toBe(false);
    expect(fs.existsSync(path.join(pointerRepo, '.codex'))).toBe(false);

    // And a subdirectory of a pointer repo must not grow a nested root
    // that silently diverts work away from the declared store.
    fs.writeFileSync(
      path.join(pointerRepo, 'rasen', 'config.yaml'),
      'store: team-context\n'
    );
    const subdir = path.join(pointerRepo, 'packages', 'api');
    fs.mkdirSync(subdir, { recursive: true });
    const nested = await runCLI(['init', '.', '--tools', 'codex'], {
      cwd: subdir,
      env,
    });
    expect(nested.exitCode).toBe(1);
    expect(nested.stderr).toContain("externalized to store 'team-context'");
    expect(fs.existsSync(path.join(subdir, 'rasen'))).toBe(false);
    expect(fs.existsSync(path.join(subdir, '.codex'))).toBe(false);
  });

  it('keeps real-root stdout byte-identical when a pointer is present, with one notice', async () => {
    const realRepo = path.join(tempDir, 'real-repo');
    createOpenSpecRoot(realRepo);
    const runs: Record<string, { stdout: string; notices: number }> = {};

    for (const [label, config] of [
      ['without', 'schema: spec-driven\n'],
      ['with', 'schema: spec-driven\nstore: team-context\n'],
    ] as const) {
      fs.writeFileSync(path.join(realRepo, 'rasen', 'config.yaml'), config);
      const result = await runCLI(['list', '--json'], { cwd: realRepo, env });
      expect(result.exitCode).toBe(0);
      runs[label] = {
        stdout: result.stdout,
        // team-context is registered, so the both-present pointer now emits the
        // inheriting-store-config notice (store-config-inheritance), not the old
        // ignored-pointer warning.
        notices: (result.stderr.match(/configuration inherits from that store/g) ?? []).length,
      };
    }

    expect(runs.with.stdout).toBe(runs.without.stdout);
    expect(runs.without.notices).toBe(0);
    expect(runs.with.notices).toBe(1);
  });
});
