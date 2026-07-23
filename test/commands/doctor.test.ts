import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { getProjectHomeDir, registerProject } from '../../src/core/project-registry.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { runCLI, cliProjectRoot, type RunCLIResult } from '../helpers/run-cli.js';
import { createOpenSpecRoot, writeSpec } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { snapshotDirectory as snapshot } from '../helpers/fs-snapshot.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

describe('rasen doctor (3.6)', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;
  let storeRoot: string;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-doctor-')));
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
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function mkdir(relativePath: string): string {
    const dir = path.join(tempDir, relativePath);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('reports ok everywhere for a healthy store-backed root, all session shapes', async () => {
    // A resolvable reference.
    const upstream = path.join(tempDir, 'upstream-context');
    createOpenSpecRoot(upstream);
    writeSpec(upstream, 'rules', '## Purpose\n\nRules.\n');
    await registerStore({ id: 'upstream-context', localPath: upstream, globalDataDir });
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - upstream-context\n'
    );

    // Explicit --store session.
    const flagged = await runCLI(['doctor', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });
    expect(flagged.exitCode).toBe(0);
    const health = parseJson(flagged);
    expect(health.root).toEqual({
      path: storeRoot,
      source: 'store',
      store_id: 'team-context',
      healthy: true,
      status: [],
    });
    expect(health.store).toEqual({
      id: 'team-context',
      metadata: { present: true, valid: true },
      status: [],
    });
    expect(health.references).toEqual([
      { store_id: 'upstream-context', type: 'store', root: upstream, status: [] },
    ]);
    expect('specs' in health.references[0]).toBe(false);
    expect(health.status).toEqual([]);

    // Banner on stderr in human mode; sections in the transcript voice.
    const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
    expect(human.exitCode).toBe(0);
    expect(human.stderr).toContain('Using Rasen root: team-context');
    expect(human.stdout).toContain('Root');
    expect(human.stdout).toContain('  Store: team-context (metadata ok)');
    expect(human.stdout).toContain(`  - upstream-context: ok (${upstream})`);

    // Nearest-root session.
    const nearest = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    expect(parseJson(nearest).root.source).toBe('nearest');

    // Declared-pointer session.
    const pointerRepo = mkdir('app-repo');
    fs.mkdirSync(path.join(pointerRepo, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(pointerRepo, 'rasen', 'config.yaml'), 'store: team-context\n');
    const declared = await runCLI(['doctor', '--json'], { cwd: pointerRepo, env });
    expect(parseJson(declared).root.source).toBe('declared');
    expect(parseJson(declared).store.id).toBe('team-context');
  });

  it('renders none-declared sections distinguishably', async () => {
    const result = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('References\n  (none declared)');
    const json = await runCLI(['doctor', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });
    expect(parseJson(json).references).toEqual([]);
  });

  it('shows broken relationships with pasteable fixes at exit 0', async () => {
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\n' +
        'references:\n  - { id: design-system, remote: https://192.0.2.1/ds.git }\n'
    );

    const result = await runCLI(['doctor', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });
    expect(result.exitCode).toBe(0);
    const health = parseJson(result);
    expect(health.references[0].status[0]).toEqual(
      expect.objectContaining({
        code: 'reference_unresolved',
        fix: expect.stringContaining('git clone -- https://192.0.2.1/ds.git'),
      })
    );

    const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
    expect(human.stdout).toContain('Fix: git clone --');
  });

  it('distinguishes an empty registry from an unreadable one', async () => {
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - ghost-context\n'
    );

    // Corrupt registry: top-level cause + per-reference blast radius.
    const registryPath = path.join(globalDataDir, 'stores', 'registry.yaml');
    const original = fs.readFileSync(registryPath, 'utf-8');
    fs.writeFileSync(registryPath, ':[ broken');
    const corrupt = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    const corruptHealth = parseJson(corrupt);
    expect(corruptHealth.status[0].code).toBe('relationship_registry_unreadable');
    expect(corruptHealth.references[0].status[0].code).toBe('reference_registry_unreadable');
    fs.writeFileSync(registryPath, original);

    // Empty-but-readable registry: unresolved references.
    fs.rmSync(registryPath);
    const empty = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    const emptyHealth = parseJson(empty);
    expect(emptyHealth.status).toEqual([]);
    expect(emptyHealth.references[0].status[0].code).toBe('reference_unresolved');
  });

  it('surfaces both-shapes and inert-pointer wrong turns', async () => {
    // Both shapes: a real root whose config declares a pointer.
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: team-context\n'
    );
    const bothShapes = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    expect(parseJson(bothShapes).status[0]).toEqual(
      expect.objectContaining({ code: 'root_pointer_ignored' })
    );
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    // Inert pointer declarations, including from a subdirectory.
    const pointerRepo = mkdir('app-repo');
    fs.mkdirSync(path.join(pointerRepo, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(pointerRepo, 'rasen', 'config.yaml'),
      'store: team-context\nreferences:\n  - wrong-context\n'
    );
    const subdir = mkdir('app-repo/packages/api');
    const inert = await runCLI(['doctor', '--json'], { cwd: subdir, env });
    const entry = parseJson(inert).status.find(
      (item: any) => item.code === 'pointer_declarations_inert'
    );
    expect(entry).toBeDefined();
    expect(entry.message).toContain('references');
  });

  it('notes remote divergence as info in the store section', async () => {
    fs.writeFileSync(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      'version: 1\nid: team-context\nremote: https://192.0.2.1/canon.git\n'
    );
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init'], { cwd: storeRoot });
    execFileSync('git', ['remote', 'add', 'origin', 'https://192.0.2.2/fork.git'], {
      cwd: storeRoot,
    });

    const result = await runCLI(['doctor', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });
    const store = parseJson(result).store;
    expect(store.metadata.remote).toBe('https://192.0.2.1/canon.git');
    expect(store.origin_url).toBe('https://192.0.2.2/fork.git');
    expect(store.status[0]).toEqual(
      expect.objectContaining({ severity: 'info', code: 'store_remote_divergence' })
    );
    expect(result.exitCode).toBe(0);
  });

  it('fails with the null-shape payload on command failures', async () => {
    const unknown = await runCLI(['doctor', '--json', '--store', 'missing-store'], {
      cwd: tempDir,
      env,
    });
    expect(unknown.exitCode).toBe(1);
    const payload = parseJson(unknown);
    expect(payload.root).toBeNull();
    expect(payload.store).toBeNull();
    expect(payload.references).toEqual([]);
    expect(payload.status[0].code).toBe('unknown_store');

    const bare = mkdir('bare-dir');
    const noRoot = await runCLI(['doctor', '--json'], { cwd: bare, env });
    expect(noRoot.exitCode).toBe(1);
    expect(parseJson(noRoot).root).toBeNull();
  });

  it('prints taxonomy errors in human mode instead of stack traces', async () => {
    const bare = mkdir('bare-dir-human');
    const result = await runCLI(['doctor'], { cwd: bare, env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: No Rasen root found');
    expect(result.stderr).not.toContain('at ');
  });

  it('distinguishes self-reference omission from none declared', async () => {
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - team-context\n'
    );
    const result = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
    expect(result.stdout).toContain('(declared references all resolve to this root)');
    expect(result.stdout).not.toContain('References\n  (none declared)');
  });

  it('surfaces a malformed pointer on a real root', async () => {
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: [broken]\n'
    );
    const result = await runCLI(['doctor', '--json'], { cwd: storeRoot, env });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).status[0]).toEqual(
      expect.objectContaining({ code: 'root_pointer_invalid' })
    );
  });

  it('is read-only and changes nothing elsewhere', async () => {
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const rootBefore = snapshot(storeRoot);
    const dataBefore = snapshot(path.join(tempDir, 'data'));

    const listBefore = await runCLI(['list', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });
    await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env });
    const listAfter = await runCLI(['list', '--json', '--store', 'team-context'], {
      cwd: tempDir,
      env,
    });

    expect(snapshot(storeRoot)).toEqual(rootBefore);
    expect(snapshot(path.join(tempDir, 'data'))).toEqual(dataBefore);
    expect(listAfter.stdout).toBe(listBefore.stdout);
  });

  describe('machine home (6.x)', () => {
    it('reports this project\'s registered entry', async () => {
      const projectId = randomUUID();
      const { entry } = await registerProject(
        { projectRoot: storeRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      const result = await runCLI(['doctor', '--json', '--store', 'team-context'], {
        cwd: tempDir,
        env,
      });
      const health = parseJson(result);
      expect(health.machineHome.registered).toBe(true);
      expect(health.machineHome.entry).toEqual(
        expect.objectContaining({ project_id: projectId, home: entry.home })
      );
      expect(health.machineHome.dangling).toEqual([]);
    });

    it('reports an unregistered project and no dangling entries by default', async () => {
      const result = await runCLI(['doctor', '--json', '--store', 'team-context'], {
        cwd: tempDir,
        env,
      });
      const health = parseJson(result);
      expect(health.machineHome.registered).toBe(false);
      expect(health.machineHome.entry).toBeUndefined();
      expect(health.machineHome.dangling).toEqual([]);
    });

    it('reports a dangling entry with a --gc suggestion in human output, and --gc removes it plus its orphaned home', async () => {
      const doomedRoot = path.join(tempDir, 'doomed-project');
      fs.mkdirSync(doomedRoot, { recursive: true });
      const { entry, canonicalPath } = await registerProject(
        { projectRoot: doomedRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );
      fs.rmSync(doomedRoot, { recursive: true, force: true });

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.stdout).toContain('Dangling entries: 1');
      expect(human.stdout).toContain(canonicalPath);
      expect(human.stdout).toContain('rasen doctor --gc');

      const jsonBefore = parseJson(
        await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env })
      );
      expect(jsonBefore.machineHome.dangling).toEqual([
        { path: canonicalPath, home: entry.home },
      ]);

      const gcResult = await runCLI(['doctor', '--json', '--gc', '--store', 'team-context'], {
        cwd: tempDir,
        env,
      });
      const afterGc = parseJson(gcResult);
      expect(afterGc.machineHome.dangling).toEqual([]);
      expect(afterGc.gc.removed_entries).toEqual([{ path: canonicalPath, home: entry.home }]);
      expect(afterGc.gc.removed_homes).toEqual([entry.home]);
      expect(fs.existsSync(getProjectHomeDir(entry.home, { globalDataDir }))).toBe(false);
    });

    it('reports worktree-duplicate entries with a --gc hint, and --gc collapses them keeping the shared home (worktree-aware-spaces D5)', async () => {
      const repoRoot = path.join(tempDir, 'wt-dup-repo');
      fs.mkdirSync(repoRoot, { recursive: true });
      const gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });

      const worktreePath = path.join(tempDir, 'wt-dup-linked');
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const canonicalWt = fs.realpathSync.native(worktreePath);

      // Seed a legacy worktree-keyed duplicate sharing the main entry's home.
      const registryPath = path.join(globalDataDir, 'projects', 'registry.json');
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      registry.projects[canonicalWt] = { ...main.entry, name: 'wt-dup-linked', lastSeen: '2026-07-09T12:00:00.000Z' };
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.stdout).toContain('Worktree-duplicate entries: 1');
      expect(human.stdout).toContain(canonicalWt);
      expect(human.stdout).toContain('rasen doctor --gc');

      const jsonBefore = parseJson(
        await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env })
      );
      expect(jsonBefore.machineHome.worktreeDuplicates).toEqual([
        { path: canonicalWt, home: main.entry.home, mainRoot: main.canonicalPath },
      ]);

      const afterGc = parseJson(
        await runCLI(['doctor', '--json', '--gc', '--store', 'team-context'], { cwd: tempDir, env })
      );
      expect(afterGc.machineHome.worktreeDuplicates).toEqual([]);
      expect(afterGc.gc.removed_entries).toEqual([{ path: canonicalWt, home: main.entry.home }]);
      // The shared home is referenced by the surviving main entry — kept.
      expect(afterGc.gc.removed_homes).toEqual([]);
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
    });

    it('hints at migratable legacy ephemera for a registered project (migrate-legacy-ephemera 3.1)', async () => {
      const projectId = randomUUID();
      await registerProject({ projectRoot: storeRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const changeDir = path.join(storeRoot, 'rasen', 'changes', 'foo');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'auto-run.json'), '{}');

      const json = await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env });
      const health = parseJson(json);
      // storeRoot is a plain (non-git) directory in this fixture, so the
      // split is fully determined: 1 untracked, 0 tracked (review m1).
      expect(health.machineHome.migratableEphemera).toEqual({
        total: 1,
        untracked: 1,
        tracked: 0,
        splitUnavailable: false,
        hint: 'rasen work migrate',
      });

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.stdout).toContain('Migratable legacy ephemera: 1 untracked');
      expect(human.stdout).toContain('rasen work migrate');

      // Doctor stays read-only: the hint never moves the file itself.
      expect(fs.existsSync(path.join(changeDir, 'auto-run.json'))).toBe(true);
    });

    it('splits tracked from untracked in the migration hint (review m1)', async () => {
      await registerProject(
        { projectRoot: storeRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );
      const changeDir = path.join(storeRoot, 'rasen', 'changes', 'foo');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'review-report.md'), '# review\n');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(storeRoot) };
      execFileSync('git', ['init'], { cwd: storeRoot, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: storeRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: storeRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.writeFileSync(path.join(changeDir, 'auto-run.json'), '{}'); // never committed

      const json = await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env });
      const health = parseJson(json);
      expect(health.machineHome.migratableEphemera).toEqual({
        total: 2,
        untracked: 1,
        tracked: 1,
        splitUnavailable: false,
        hint: 'rasen work migrate',
      });

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.stdout).toContain('1 untracked (+1 tracked, needs --include-tracked)');
    });

    it('omits the migration hint for a clean registered project', async () => {
      await registerProject(
        { projectRoot: storeRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );

      const json = await runCLI(['doctor', '--json', '--store', 'team-context'], { cwd: tempDir, env });
      const health = parseJson(json);
      expect(health.machineHome.migratableEphemera).toBeUndefined();

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.stdout).not.toContain('Migratable legacy ephemera');
    });

    it('surfaces a corrupt registry as a diagnostic instead of masking it as "Not registered" (MAJOR-2)', async () => {
      const registryPath = path.join(globalDataDir, 'projects', 'registry.json');
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, '{not valid json');

      const json = await runCLI(['doctor', '--json', '--store', 'team-context'], {
        cwd: tempDir,
        env,
      });
      const health = parseJson(json);
      expect(json.exitCode).toBe(0);
      expect(health.machineHome.error).toBeDefined();
      expect(health.machineHome.error.message).toContain('Invalid project registry state');
      // The healthy-path shape stays backward compatible: registered/dangling
      // are still present (just uninformative), not replaced by the error.
      expect(health.machineHome.registered).toBe(false);
      expect(health.machineHome.dangling).toEqual([]);

      const human = await runCLI(['doctor', '--store', 'team-context'], { cwd: tempDir, env });
      expect(human.exitCode).toBe(0);
      expect(human.stdout).toContain('Machine home');
      expect(human.stdout).toContain('Error: Invalid project registry state');
      expect(human.stdout).not.toContain('Not registered');
    });
  });

  describe('machine-root relocation (relocate-machine-home D4)', () => {
    // These tests deliberately do NOT set XDG_DATA_HOME/XDG_CONFIG_HOME so the
    // default ~/.rasen resolution actually engages. To keep them fully
    // sandboxed (never touching this machine's real home), USERPROFILE/HOME
    // AND LOCALAPPDATA/APPDATA are all redirected under a fixture directory —
    // oldSchemeDataDir/oldSchemeConfigDir prefer LOCALAPPDATA/APPDATA over
    // homedir on win32, so both must be redirected together.
    let relocTempDir: string;
    let fixtureHome: string;
    let relocEnv: NodeJS.ProcessEnv;
    let relocProjectRoot: string;

    beforeEach(() => {
      relocTempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-doctor-reloc-')));
      fixtureHome = path.join(relocTempDir, 'home');
      relocEnv = {
        OPEN_SPEC_INTERACTIVE: '0',
        RASEN_TELEMETRY: '0',
        // run-cli.ts's default isolation sets XDG_DATA_HOME/XDG_CONFIG_HOME
        // (and blanks RASEN_HOME) to protect the real home by default; these
        // tests need the actual default (~/.rasen) resolution to engage, so
        // blank the XDG defaults back out (blank == unset, see resolveRasenHome).
        XDG_DATA_HOME: '',
        XDG_CONFIG_HOME: '',
        USERPROFILE: fixtureHome,
        HOME: fixtureHome,
        LOCALAPPDATA: path.join(fixtureHome, 'AppData', 'Local'),
        APPDATA: path.join(fixtureHome, 'AppData', 'Roaming'),
      };
      relocProjectRoot = path.join(relocTempDir, 'project');
      createOpenSpecRoot(relocProjectRoot);
    });

    afterEach(() => {
      cleanupTempPath(relocTempDir);
    });

    function oldDataDir(): string {
      // Mirrors oldSchemeDataDir (global-config.ts): win32 prefers
      // LOCALAPPDATA/rasen; POSIX uses ~/.local/share/rasen.
      return process.platform === 'win32'
        ? path.join(fixtureHome, 'AppData', 'Local', 'rasen')
        : path.join(fixtureHome, '.local', 'share', 'rasen');
    }

    function newRoot(): string {
      return path.join(fixtureHome, '.rasen');
    }

    it('reports a clean state when no old-scheme directory exists', async () => {
      const json = await runCLI(['doctor', '--json'], { cwd: relocProjectRoot, env: relocEnv });
      const health = parseJson(json);
      expect(health.machineHome.relocation).toEqual({ lingering: [], pendingOrFailed: [] });

      const human = await runCLI(['doctor'], { cwd: relocProjectRoot, env: relocEnv });
      expect(human.stdout).not.toContain('Legacy data dir');
      expect(human.stdout).not.toContain('Relocation pending');
    });

    it('notes a lingering old-scheme directory after a successful startup adoption', async () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      const human = await runCLI(['doctor'], { cwd: relocProjectRoot, env: relocEnv });
      expect(human.exitCode).toBe(0);
      // Startup adoption ran before doctor gathered health: the target is populated.
      expect(fs.existsSync(path.join(newRoot(), 'projects', 'registry.json'))).toBe(true);
      // The old directory is copy-only — never deleted — so it lingers.
      expect(fs.existsSync(path.join(oldDataDir(), 'projects', 'registry.json'))).toBe(true);
      expect(human.stdout).toContain(`Legacy data dir at ${oldDataDir()}`);
      expect(human.stdout).toContain('safe to delete after verifying');

      const json = await runCLI(['doctor', '--json'], { cwd: relocProjectRoot, env: relocEnv });
      const health = parseJson(json);
      expect(health.machineHome.relocation.lingering).toEqual([
        { path: oldDataDir(), target: newRoot() },
      ]);
      expect(health.machineHome.relocation.pendingOrFailed).toEqual([]);
    });

    it('warns loudly when relocation failed and the old-scheme directory still exists', async () => {
      fs.mkdirSync(path.join(oldDataDir(), 'projects'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'registry.json'), '{"version":1,"projects":{}}');

      // Block adoption: the target already exists as a *file*, so every
      // per-child copy fails during startup — this exercises the genuine
      // failure path (as opposed to an old dir that just hasn't been
      // encountered by the CLI yet).
      fs.mkdirSync(fixtureHome, { recursive: true });
      fs.writeFileSync(newRoot(), 'blocking file, not a directory\n');

      const human = await runCLI(['doctor'], { cwd: relocProjectRoot, env: relocEnv });
      expect(human.exitCode).toBe(0);
      expect(human.stdout).toContain('Relocation pending');
      expect(human.stdout).toContain(oldDataDir());
      expect(human.stdout).toContain('Fix: run the CLI again to retry automatically');
      // Doctor is read-only: the blocking file and the old dir are both untouched.
      expect(fs.readFileSync(newRoot(), 'utf-8')).toBe('blocking file, not a directory\n');
      expect(fs.existsSync(path.join(oldDataDir(), 'projects', 'registry.json'))).toBe(true);

      const json = await runCLI(['doctor', '--json'], { cwd: relocProjectRoot, env: relocEnv });
      const health = parseJson(json);
      expect(health.machineHome.relocation.pendingOrFailed).toEqual([
        { path: oldDataDir(), target: newRoot() },
      ]);
      expect(health.machineHome.relocation.lingering).toEqual([]);
    });

    // Round-1 review-loop follow-on: the startup adoption's never-overwrite
    // skip note (global-config.ts adoptProjectsSubtree) is emitted via
    // console.error (stderr) unconditionally before any command output runs,
    // including --json commands. Confirm the two streams stay genuinely
    // separate: stdout must remain parseable JSON, and the skip note must be
    // observable on stderr, not interleaved into stdout.
    it('keeps startup adoption skip notes on stderr, never corrupting --json stdout', async () => {
      // Force a per-home skip: the SAME home dir already exists at both the
      // old scheme dir and the (about-to-be-created) new root.
      fs.mkdirSync(path.join(oldDataDir(), 'projects', 'already-there'), { recursive: true });
      fs.writeFileSync(path.join(oldDataDir(), 'projects', 'already-there', 'marker.txt'), 'old\n');
      fs.mkdirSync(path.join(newRoot(), 'projects', 'already-there'), { recursive: true });
      fs.writeFileSync(path.join(newRoot(), 'projects', 'already-there', 'marker.txt'), 'current\n');

      const json = await runCLI(['doctor', '--json'], { cwd: relocProjectRoot, env: relocEnv });

      // stdout must be valid, parseable JSON — untouched by the skip note.
      expect(() => JSON.parse(json.stdout)).not.toThrow();
      const health = parseJson(json);
      expect(health.machineHome).toBeDefined();

      // The skip note landed on stderr, not stdout.
      expect(json.stderr).toContain('left behind');
      expect(json.stdout).not.toContain('left behind');

      // Never-overwrite held: neither home was clobbered.
      expect(
        fs.readFileSync(path.join(newRoot(), 'projects', 'already-there', 'marker.txt'), 'utf-8')
      ).toBe('current\n');
    });
  });

  describe('skill-version mismatch finding (delivery-reliability-version-guard)', () => {
    let projectRoot: string;

    beforeEach(() => {
      projectRoot = mkdir('mismatch-project');
      createOpenSpecRoot(projectRoot);
    });

    function writeStaleSkill(version: string): void {
      const skillDir = path.join(projectRoot, '.claude', 'skills', 'rasen-explore');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: rasen-explore\nmetadata:\n  generatedBy: "${version}"\n---\n\nContent\n`
      );
    }

    it('reports the mismatch in human output with a Fix hint', async () => {
      writeStaleSkill('0.0.1-stale');

      const result = await runCLI(['doctor'], { cwd: projectRoot, env });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0.0.1-stale');
      expect(result.stdout).toContain('Fix: rasen update');
    });

    it('includes the mismatch in --json output', async () => {
      writeStaleSkill('0.0.1-stale');

      const result = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      const health = parseJson(result);
      expect(health.status).toContainEqual(
        expect.objectContaining({ code: 'skill_version_mismatch', fix: 'rasen update' })
      );
    });

    it('reports nothing when the installed skills match the running CLI', async () => {
      const { version } = JSON.parse(
        fs.readFileSync(path.join(cliProjectRoot, 'package.json'), 'utf-8')
      );
      writeStaleSkill(version);

      const human = await runCLI(['doctor'], { cwd: projectRoot, env });
      expect(human.stdout).not.toContain('skill_version_mismatch');
      expect(human.stdout).not.toContain('rasen update');

      const json = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      const health = parseJson(json);
      expect(health.status.some((entry: { code: string }) => entry.code === 'skill_version_mismatch')).toBe(
        false
      );
    });

    it('still reports the mismatch even after the ambient warning already fired and debounced', async () => {
      writeStaleSkill('0.0.1-stale');
      // Mint the machine-local home first so the ambient warning (a
      // separate mechanism from this finding) actually has debounce state
      // to consult; otherwise it would warn on every command instead.
      await resolveProjectHome(projectRoot, { globalDataDir });

      // First doctor run: this itself is a project-scoped command, so it
      // also trips (and debounces) the ambient warning from
      // resolveRootForCommand — independent of the health finding below.
      const first = await runCLI(['doctor'], { cwd: projectRoot, env });
      expect(first.stderr).toContain('0.0.1-stale');

      const second = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      // The ambient warning is debounced (stderr silent this time)...
      expect(second.stderr).not.toContain('0.0.1-stale');
      // ...but doctor's own finding, re-derived independently, still fires.
      const health = parseJson(second);
      expect(health.status).toContainEqual(
        expect.objectContaining({ code: 'skill_version_mismatch' })
      );
    });
  });
});
