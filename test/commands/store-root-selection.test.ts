import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getGlobalDataDir,
  registerStore,
} from '../../src/core/index.js';
import { writeStoreMetadataState } from '../../src/core/store/foundation.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const VALID_DELTA_SPEC = `## ADDED Requirements

### Requirement: Billing SHALL work
The system SHALL create bills.

#### Scenario: Creates bills
- **WHEN** a billing period ends
- **THEN** a bill is created
`;

const INVALID_DELTA_SPEC = `## ADDED Requirements

### Requirement: Billing SHALL work
The system SHALL create bills.
`;

// Targets a spec that does not exist yet: REMOVED deltas are ignored with a
// human-mode warning, which must never leak into JSON stdout.
const REMOVED_ONLY_DELTA_SPEC = `## REMOVED Requirements

### Requirement: Old billing SHALL go away
`;

// MODIFIED deltas against a spec that does not exist make buildUpdatedSpec
// throw during the prepare pass.
const MODIFIED_ONLY_DELTA_SPEC = `## MODIFIED Requirements

### Requirement: Billing SHALL work
The system SHALL create bills differently.

#### Scenario: Creates bills
- **WHEN** a billing period ends
- **THEN** a bill is created
`;

describe('store root selection for normal commands', () => {
  let tempDir: string;
  let appRepo: string;
  let storeRoot: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-root-selection-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    appRepo = path.join(tempDir, 'app-repo');
    fs.mkdirSync(appRepo, { recursive: true });
    storeRoot = await registerStoreFixture('team-context');
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  function createOpenSpecRoot(rootDir: string): void {
    fs.mkdirSync(path.join(rootDir, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  }

  async function registerStoreFixture(id: string): Promise<string> {
    const root = path.join(tempDir, 'stores', id);
    createOpenSpecRoot(root);
    await registerStore({ id, localPath: root, globalDataDir });
    return fs.realpathSync.native(root);
  }

  function createChange(
    rootDir: string,
    name: string,
    options: { deltaSpec?: string | null; tasksDone?: boolean } = {}
  ): string {
    const changeDir = path.join(rootDir, 'rasen', 'changes', name);
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'proposal.md'),
      '## Why\nBilling needs work.\n\n## What Changes\n- **billing:** Add billing\n'
    );
    fs.writeFileSync(
      path.join(changeDir, 'tasks.md'),
      options.tasksDone === false ? '- [ ] Task 1\n' : '- [x] Task 1\n'
    );
    if (options.deltaSpec !== null) {
      const specDir = path.join(changeDir, 'specs', 'billing');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, 'spec.md'), options.deltaSpec ?? VALID_DELTA_SPEC);
    }
    return changeDir;
  }

  function parseJson(result: RunCLIResult): any {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
      );
    }
  }

  function expectNoLocalOpenSpec(): void {
    expect(fs.existsSync(path.join(appRepo, 'rasen'))).toBe(false);
  }

  describe('selecting a registered store by id', () => {
    // Creating a Change in a Store is proven end to end where the layout v2
    // fixture lives: `test/commands/store-v2-planning-scope-journey.test.ts`
    // asserts the same root block (`root.scope` = `store-project`), the same
    // absolute `change.path`, and the partition destination, from a verified
    // planning worktree. It cannot be re-proven HERE, because creation in a
    // layout v2 Store additionally requires that worktree and this suite's
    // fixture is an integration checkout — and a legacy flat Store refuses
    // creation outright (change `store-layout-v2-migration`, `proposal.md`
    // BREAKING bullet 2, task 10b.1).
    //
    // What this suite owns is ROOT SELECTION, and that survives intact: the
    // cases below prove `--store` resolves to the registered Store, names it,
    // and never falls back to a local root — including when the command it
    // selected the root for is then refused.
    it('names the selected store root and refuses to create in its legacy flat layout', async () => {
      const result = await runCLI(['new', 'change', 'add-billing', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });

      expect(result.exitCode).toBe(1);
      // The refusal names the store `--store` selected, which is how the
      // selection is still observable: the "Using Rasen root" notice belongs
      // to a resolution that completed, and this one fails inside it.
      expect(`${result.stdout}${result.stderr}`).toContain('legacy flat planning layout');
      expect(`${result.stdout}${result.stderr}`).toContain('store migrate-layout team-context');
      // Neither root gained the Change: the refusal is not a fallback.
      expect(fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'add-billing'))).toBe(false);
      expectNoLocalOpenSpec();
    });

    it('includes the shared root block for the selected store, with absolute paths', async () => {
      createChange(storeRoot, 'add-billing');
      const result = await runCLI(['list', '--store', 'team-context', '--json'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode, result.stdout || result.stderr).toBe(0);

      const json = parseJson(result);
      // The established compatibility fields are unchanged. `scope` is absent
      // here because only the authoring path resolves a planning scope; the
      // scope block itself is asserted in the layout v2 journey named above.
      expect(json.root).toMatchObject({
        path: storeRoot,
        source: 'store',
        store_id: 'team-context',
      });
      expect(Object.keys(json.root).sort()).toEqual(['path', 'source', 'store_id']);
      expect(path.isAbsolute(json.root.path)).toBe(true);
      expect(json.changes.map((change: { name: string }) => change.name)).toContain('add-billing');
      expectNoLocalOpenSpec();
    });


    it('wins over the nearest local root', async () => {
      const localRepo = path.join(tempDir, 'local-repo');
      createOpenSpecRoot(localRepo);
      createChange(localRepo, 'local-change');
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['list', '--json', '--store', 'team-context'], {
        cwd: localRepo,
        env,
      });
      expect(result.exitCode).toBe(0);

      const json = parseJson(result);
      const names = json.changes.map((change: any) => change.name);
      expect(names).toContain('store-change');
      expect(names).not.toContain('local-change');
      expect(json.root.store_id).toBe('team-context');
    });

    it('lists an empty team store before any changes exist', async () => {
      const blankStoreRoot = path.join(tempDir, 'stores', 'blank-context');
      fs.mkdirSync(path.join(blankStoreRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(blankStoreRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      await writeStoreMetadataState(blankStoreRoot, {
        version: 1,
        id: 'blank-context',
      });
      const registered = await runCLI(
        ['store', 'register', blankStoreRoot, '--json'],
        { cwd: appRepo, env }
      );
      expect(registered.exitCode).toBe(0);

      const result = await runCLI(['list', '--json', '--store', 'blank-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changes).toEqual([]);
      expect(json.root).toEqual({
        path: fs.realpathSync.native(blankStoreRoot),
        source: 'store',
        store_id: 'blank-context',
      });
    });

    it('reads, validates, shows, and reports status in the selected store', async () => {
      createChange(storeRoot, 'store-change');

      const status = await runCLI(
        ['status', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(status.exitCode).toBe(0);
      const statusJson = parseJson(status);
      expect(statusJson.changeName).toBe('store-change');
      expect(statusJson.schemaName).toBe('spec-driven');
      expect(statusJson.root).toEqual({
        path: storeRoot,
        source: 'store',
        store_id: 'team-context',
      });

      const instructions = await runCLI(
        ['instructions', 'design', '--change', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(instructions.exitCode).toBe(0);
      const instructionsJson = parseJson(instructions);
      expect(instructionsJson.artifactId).toBe('design');
      expect(instructionsJson.root.store_id).toBe('team-context');
      expect(path.isAbsolute(instructionsJson.changeDir)).toBe(true);
      expect(instructionsJson.changeDir).toContain(storeRoot);

      const show = await runCLI(
        ['show', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(show.exitCode).toBe(0);
      const showJson = parseJson(show);
      expect(showJson.id).toBe('store-change');
      expect(showJson.root.store_id).toBe('team-context');

      const validate = await runCLI(
        ['validate', 'store-change', '--store', 'team-context', '--json'],
        { cwd: appRepo, env }
      );
      expect(validate.exitCode).toBe(0);
      const validateJson = parseJson(validate);
      expect(validateJson.items[0]).toMatchObject({ id: 'store-change', valid: true });
      expect(validateJson.root.store_id).toBe('team-context');

      expectNoLocalOpenSpec();
    });

    it('lists specs from the store with minimal JSON support', async () => {
      const specDir = path.join(storeRoot, 'rasen', 'specs', 'billing');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(
        path.join(specDir, 'spec.md'),
        '# billing\n\n## Purpose\nBills.\n\n## Requirements\n\n### Requirement: Billing SHALL work\nThe system SHALL bill.\n\n#### Scenario: Bills\n- **WHEN** due\n- **THEN** billed\n'
      );

      const result = await runCLI(['list', '--specs', '--json', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.specs).toEqual([{ id: 'billing', requirementCount: 1 }]);
      expect(json.root.store_id).toBe('team-context');
    });

    it('runs bulk validation against the selected store', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['validate', '--all', '--store', 'team-context', '--json'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.items.map((item: any) => item.id)).toContain('store-change');
      expect(json.root.store_id).toBe('team-context');
    });

    // DELIBERATE REFUSAL. This case used to archive into the selected Store's
    // flat `rasen/changes/archive`, which is exactly the write
    // `specs/store-planning-scope-routing` ("Legacy flat Store refuses planning
    // writes until it is migrated") now forbids and change
    // `store-layout-v2-migration` task 10b.1 implements. Archiving a MIGRATED
    // Store is proved end to end in `test/cli-e2e/store-lifecycle.test.ts`,
    // where it now reaches the finalization gate
    // (`finalization_outcome_required`). What survives here is what this
    // suite owns: the selected Store is still named in the root block, and the
    // app repo still grows nothing.
    it('refuses to archive into a selected legacy flat store, and writes nothing', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['archive', 'store-change', '--store', 'team-context', '--json', '--yes'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);

      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0]).toMatchObject({
        severity: 'error',
        code: 'legacy_flat_store_requires_migration',
        fix: "Run 'rasen store migrate-layout team-context' to migrate this Store, then retry.",
      });
      expect(json.root.store_id).toBe('team-context');

      // Refused before writing, moving, or deleting anything.
      expect(
        fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'store-change'))
      ).toBe(true);
      expect(
        fs.readdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'))
      ).toEqual([]);
      expect(
        fs.existsSync(path.join(storeRoot, 'rasen', 'specs', 'billing'))
      ).toBe(false);
      expectNoLocalOpenSpec();
    });
  });

  describe('human output and stdout purity', () => {
    it('keeps show stdout as the raw markdown payload', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['show', 'store-change', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith('## Why')).toBe(true);
      expect(result.stderr).toContain(`Using Rasen root: team-context (${storeRoot})`);
    });

    it('keeps instructions stdout as the artifact payload', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['instructions', 'design', '--change', 'store-change', '--store', 'team-context'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith('<artifact id="design"')).toBe(true);
      expect(result.stderr).toContain('Using Rasen root: team-context');
    });

    it('writes the status banner to stderr in human mode', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(
        ['status', '--change', 'store-change', '--store', 'team-context'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(`Using Rasen root: team-context (${storeRoot})`);
      expect(result.stdout).toContain('Change: store-change');
      expect(result.stdout).not.toContain('Using Rasen root');
    });
  });

  describe('selector errors', () => {
    it('rejects --store-path with register guidance', async () => {
      const result = await runCLI(['new', 'change', 'nope', '--store-path', '/x'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('store register');
      expect(output).toContain('--store <id>');
      expectNoLocalOpenSpec();
      expect(fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'nope'))).toBe(false);
    });

    it('rejects show --store-path despite allowUnknownOption', async () => {
      const result = await runCLI(['show', '--store-path', '/x'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('store register');
    });

    it('reports unknown stores with the same message across commands', async () => {
      const expected =
        "Unknown store 'team-contxt'. Registered stores: team-context.";

      const status = await runCLI(['status', '--store', 'team-contxt'], { cwd: appRepo, env });
      const list = await runCLI(['list', '--store', 'team-contxt'], { cwd: appRepo, env });

      expect(status.exitCode).toBe(1);
      expect(list.exitCode).toBe(1);
      expect(status.stdout + status.stderr).toContain(expected);
      expect(list.stdout + list.stderr).toContain(expected);
    });

    it('rejects an invalid store id format before registry lookup', async () => {
      const result = await runCLI(['list', '--store', 'Bad_Id'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('kebab-case');
    });

    it('emits machine-readable resolver failures in JSON mode', async () => {
      const result = await runCLI(['status', '--json', '--store', 'team-contxt'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.status[0].code).toBe('unknown_store');
      expect(json.status[0].message).toContain('team-contxt');
    });

    it('reports a corrupt registry as machine-readable JSON, not prose', async () => {
      fs.writeFileSync(
        path.join(globalDataDir, 'stores', 'registry.yaml'),
        '{not yaml: ['
      );

      const result = await runCLI(['status', '--json', '--store', 'team-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.status[0].severity).toBe('error');
      expect(json.status[0].code).toBe('invalid_store_registry');
    });

    it('fails on an unhealthy store root and points to doctor', async () => {
      const brokenRoot = path.join(tempDir, 'stores', 'broken-context');
      fs.mkdirSync(brokenRoot, { recursive: true });
      await writeStoreMetadataState(brokenRoot, { version: 1, id: 'broken-context' });
      await registerStore({
        id: 'broken-context',
        localPath: brokenRoot,
        globalDataDir,
      });

      const result = await runCLI(['list', '--store', 'broken-context'], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('store doctor');
      // No scaffolding or repair happened.
      expect(fs.existsSync(path.join(brokenRoot, 'rasen'))).toBe(false);
    });
  });

  describe('default resolution without --store', () => {
    it('fails with a store hint instead of scaffolding when no root exists', async () => {
      const result = await runCLI(['new', 'change', 'foo'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('team-context');
      expect(output).toContain('--store <id>');
      expect(output).toContain('rasen init');
      expectNoLocalOpenSpec();
    });

    it('treats leftover workspace state as no root at all', async () => {
      fs.mkdirSync(path.join(appRepo, '.rasen-workspace'), { recursive: true });
      fs.writeFileSync(
        path.join(appRepo, '.rasen-workspace', 'view.yaml'),
        'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
      );

      const result = await runCLI(['status'], { cwd: appRepo, env });
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('team-context');
    });

    it('ignores leftover workspace state when a nearby root exists', async () => {
      const localRepo = path.join(tempDir, 'workspace-repo');
      createOpenSpecRoot(localRepo);
      fs.mkdirSync(path.join(localRepo, '.rasen-workspace'), { recursive: true });
      fs.writeFileSync(
        path.join(localRepo, '.rasen-workspace', 'view.yaml'),
        'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
      );
      createChange(localRepo, 'local-change');

      const result = await runCLI(['status', '--change', 'local-change', '--json'], {
        cwd: localRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.schemaName).toBe('spec-driven');
      expect(json.root.source).toBe('nearest');
      expect(json.root.store_id).toBeUndefined();
    });

    it('works inside the standalone repo itself without a flag', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['status', '--change', 'store-change', '--json'], {
        cwd: storeRoot,
        env,
      });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changeName).toBe('store-change');
      expect(json.root).toEqual({ path: storeRoot, source: 'nearest' });
    });

    it('keeps implicit-root behavior when no stores are registered', async () => {
      const isolatedEnv = {
        ...env,
        XDG_DATA_HOME: path.join(tempDir, 'data-empty'),
      };

      const result = await runCLI(['status', '--json'], { cwd: appRepo, env: isolatedEnv });
      expect(result.exitCode).toBe(0);
      const json = parseJson(result);
      expect(json.changes).toEqual([]);
      expect(json.root.source).toBe('implicit');
    });
  });

  describe('archive --json is non-interactive', () => {
    // `rasen archive` against a legacy flat Store is refused now
    // (`legacy_flat_store_requires_migration`; change
    // `store-layout-v2-migration`, task 10b.1), and a layout v2 Store answers
    // `finalization_outcome_required` until one outcome is declared
    // (`store-finalization-outcomes-v2`). So archiving into ANY Store without
    // further setup is unreachable in this suite,
    // and these cases split in two: the ones whose subject is the SELECTED
    // ROOT keep `--store` and assert the deliberate refusal, and the ones whose
    // subject is archive's own JSON discipline move to a standalone root, where
    // that discipline is unchanged and still worth a live gate.
    let standaloneRoot: string;

    beforeEach(() => {
      standaloneRoot = path.join(tempDir, 'archive-standalone');
      createOpenSpecRoot(standaloneRoot);
    });

    function expectBlockedPlanWithNoWrites(json: any): void {
      expect(json.plan.complete).toBe(false);
      expect(json.plan.blockers.length).toBeGreaterThan(0);
      expect(fs.existsSync(json.plan.paths.stage)).toBe(false);
      expect(fs.existsSync(json.plan.paths.journal)).toBe(false);
      expect(fs.existsSync(json.plan.paths.final)).toBe(false);
    }

    it('refuses a selected legacy flat store without opening a picker', async () => {
      createChange(storeRoot, 'store-change');

      const result = await runCLI(['archive', '--store', 'team-context', '--json'], {
        cwd: appRepo,
        env,
      });

      // The subject survives: no picker, exit 1, pure JSON on stdout. What
      // changed is which refusal comes first — the Store's layout is checked
      // before the missing change name.
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0].code).toBe('legacy_flat_store_requires_migration');
      expect(json.status[0].fix).toContain('store migrate-layout team-context');
      expect(
        fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'store-change'))
      ).toBe(true);
    });

    it('refuses a selected empty store without init guidance', async () => {
      const blankStoreRoot = path.join(tempDir, 'stores', 'archive-blank-context');
      fs.mkdirSync(path.join(blankStoreRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(blankStoreRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      await writeStoreMetadataState(blankStoreRoot, {
        version: 1,
        id: 'archive-blank-context',
      });
      const registered = await runCLI(
        ['store', 'register', blankStoreRoot, '--json'],
        { cwd: appRepo, env }
      );
      expect(registered.exitCode).toBe(0);

      const result = await runCLI(
        ['archive', 'missing-change', '--store', 'archive-blank-context', '--json', '--yes'],
        { cwd: appRepo, env }
      );

      expect(result.exitCode).toBe(1);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0].code).toBe('legacy_flat_store_requires_migration');
      // The property this case has always protected: a selected Store never
      // gets told to run `rasen init`. The refusal names the migration instead.
      expect(JSON.stringify(json.status)).not.toContain('rasen init');
      expect(json.status[0].fix).toContain('store migrate-layout archive-blank-context');
    });

    it('reports validation failures as diagnostics without stdout prose', async () => {
      createChange(standaloneRoot, 'bad-change', { deltaSpec: INVALID_DELTA_SPEC });

      const result = await runCLI(['archive', 'bad-change', '--json', '--yes'], {
        cwd: standaloneRoot,
        env,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0]).toEqual({
        severity: 'error',
        code: 'archive_validation_failed',
        message: "Validation failed for change 'bad-change'.",
        fix: 'Run rasen validate bad-change for details, fix the errors, or rerun with --no-validate.',
      });
      expectBlockedPlanWithNoWrites(json);
      expect(json.plan.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ operation: 'validation' })])
      );
      // The change was not archived.
      expect(
        fs.existsSync(path.join(standaloneRoot, 'rasen', 'changes', 'bad-change'))
      ).toBe(true);
    });

    it('keeps stdout pure when REMOVED deltas target a new spec', async () => {
      createChange(standaloneRoot, 'removed-change', { deltaSpec: REMOVED_ONLY_DELTA_SPEC });

      const result = await runCLI(
        ['archive', 'removed-change', '--json', '--yes', '--no-validate'],
        { cwd: standaloneRoot, env }
      );
      expect(result.exitCode).toBe(0);
      // The "REMOVED requirement(s) ignored for new spec" warning must not
      // precede or pollute the JSON payload.
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.archive.change).toBe('removed-change');
    });

    it('writes no spec when any rebuilt spec fails validation', async () => {
      // Two delta specs in one change: 'aaa-good' targets a new spec and
      // rebuilds cleanly; 'zzz-bad' targets an existing spec whose current
      // requirement has no scenarios, so its rebuilt content fails the
      // validator only at the late rebuilt-validation pass (the prepare-time
      // structure check does not catch missing scenarios).
      const changeDir = createChange(standaloneRoot, 'two-spec-change', { deltaSpec: null });
      for (const capability of ['aaa-good', 'zzz-bad']) {
        const specDir = path.join(changeDir, 'specs', capability);
        fs.mkdirSync(specDir, { recursive: true });
        fs.writeFileSync(path.join(specDir, 'spec.md'), VALID_DELTA_SPEC);
      }
      const badTargetDir = path.join(standaloneRoot, 'rasen', 'specs', 'zzz-bad');
      fs.mkdirSync(badTargetDir, { recursive: true });
      const badTargetContent =
        '# zzz-bad\n\n## Purpose\nLegacy.\n\n## Requirements\n\n### Requirement: Old rule SHALL hold\nThe system SHALL hold.\n';
      fs.writeFileSync(path.join(badTargetDir, 'spec.md'), badTargetContent);

      const result = await runCLI(['archive', 'two-spec-change', '--json', '--yes'], {
        cwd: standaloneRoot,
        env,
      });
      expect(result.exitCode).toBe(1);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0]).toEqual({
        severity: 'error',
        code: 'archive_spec_validation_failed',
        message: "Rebuilt spec for 'zzz-bad' failed validation. No files were changed.",
        fix: 'Run rasen validate zzz-bad after fixing the change deltas.',
      });
      expectBlockedPlanWithNoWrites(json);
      expect(json.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_spec_validation_failed',
          }),
        ])
      );

      // "No files were changed" must be true: the good spec was not created
      // and the bad target is byte-identical.
      expect(
        fs.existsSync(path.join(standaloneRoot, 'rasen', 'specs', 'aaa-good', 'spec.md'))
      ).toBe(false);
      expect(fs.readFileSync(path.join(badTargetDir, 'spec.md'), 'utf-8')).toBe(
        badTargetContent
      );
      expect(
        fs.existsSync(path.join(standaloneRoot, 'rasen', 'changes', 'two-spec-change'))
      ).toBe(true);
    });

    it('reports spec-update failures as diagnostics without stdout prose', async () => {
      createChange(standaloneRoot, 'modified-change', { deltaSpec: MODIFIED_ONLY_DELTA_SPEC });

      const result = await runCLI(
        ['archive', 'modified-change', '--json', '--yes', '--no-validate'],
        { cwd: standaloneRoot, env }
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim().startsWith('{')).toBe(true);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0]).toEqual({
        severity: 'error',
        code: 'archive_spec_update_failed',
        message: 'billing: target spec does not exist; only ADDED requirements are allowed for new specs. MODIFIED and RENAMED operations require an existing spec.',
        fix: 'Fix the change delta specs and rerun. No files were changed.',
      });
      expectBlockedPlanWithNoWrites(json);
      expect(json.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_spec_update_failed',
          }),
        ])
      );
      expect(
        fs.existsSync(path.join(standaloneRoot, 'rasen', 'changes', 'modified-change'))
      ).toBe(true);
    });

    it('refuses incomplete tasks without --yes', async () => {
      createChange(standaloneRoot, 'wip-change', { tasksDone: false });

      const result = await runCLI(['archive', 'wip-change', '--json'], {
        cwd: standaloneRoot,
        env,
      });
      expect(result.exitCode).toBe(1);
      const json = parseJson(result);
      expect(json.archive).toBeNull();
      expect(json.status[0]).toEqual({
        severity: 'error',
        code: 'archive_tasks_incomplete',
        message: "1 incomplete task(s) found for change 'wip-change'.",
        fix: 'Complete the tasks or rerun with --yes.',
      });
      expectBlockedPlanWithNoWrites(json);
      expect(json.plan.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ operation: 'tasks' })])
      );
      expect(
        fs.existsSync(path.join(standaloneRoot, 'rasen', 'changes', 'wip-change'))
      ).toBe(true);
    });
  });

  describe('initiative links are retired from normal change flows', () => {
    it('rejects --initiative and creates no files', async () => {
      const localRepo = path.join(tempDir, 'initiative-repo');
      createOpenSpecRoot(localRepo);

      const result = await runCLI(
        ['new', 'change', 'linked-change', '--initiative', 'billing-launch'],
        { cwd: localRepo, env }
      );
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('--initiative is no longer supported');
      expect(
        fs.existsSync(path.join(localRepo, 'rasen', 'changes', 'linked-change'))
      ).toBe(false);
    });

    it('removes openspec set change entirely', async () => {
      const localRepo = path.join(tempDir, 'set-change-repo');
      createOpenSpecRoot(localRepo);
      createChange(localRepo, 'existing-change');
      const metadataPath = path.join(
        localRepo,
        'rasen',
        'changes',
        'existing-change',
        '.openspec.yaml'
      );

      const result = await runCLI(
        ['set', 'change', 'existing-change', '--initiative', 'billing-launch'],
        { cwd: localRepo, env }
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('unknown command');
      expect(fs.existsSync(metadataPath)).toBe(false);

      const help = await runCLI(['--help'], { cwd: localRepo, env });
      expect(help.stdout).not.toContain('Set checked-in Rasen metadata');
      expect(help.stdout).not.toMatch(/^\s*set\s/m);
    });
  });

  describe('setup and register point to --store usage', () => {
    it('shows --store usage after setup', async () => {
      const result = await runCLI(
        ['store', 'setup', 'fresh-context', '--path', path.join(tempDir, 'fresh-context'), '--no-init-git'],
        { cwd: appRepo, env }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('rasen new change <change-id> --store fresh-context');
    });

    it('shows --store usage after register', async () => {
      const registerRoot = path.join(tempDir, 'register-context');
      createOpenSpecRoot(registerRoot);
      await writeStoreMetadataState(registerRoot, {
        version: 1,
        id: 'register-context',
      });

      const result = await runCLI(['store', 'register', registerRoot], {
        cwd: appRepo,
        env,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('rasen new change <change-id> --store register-context');
    });
  });
});
