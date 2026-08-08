import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';
import { registerProject, getProjectHomeDir } from '../../src/core/project-registry.js';
import { getGlobalDataDir } from '../../src/core/global-config.js';
import { registerStore } from '../../src/core/store/registry.js';
import {
  applyWorkMigration,
  defaultWorkMigrationFileSystem,
  planWorkMigration,
} from '../../src/core/work-migration.js';
import {
  applyPlannedWorkMigration,
  registerWorkCommand,
  workMigrationRootContext,
  type WorkMigrateCommandDependencies,
} from '../../src/commands/work.js';

/**
 * `rasen work migrate` CLI surface — INVERTED direction (design
 * `file-placement-collapse-archive` D6): scans machine-home work directories
 * for legacy state and moves it to terminal file-placement locations.
 *
 * dry-run moves nothing, --json without --yes is a preview, --yes executes,
 * --change scopes, and exit codes are honest about failure vs. success.
 */
describe('rasen work migrate', () => {
  let tempDir: string;
  let projectRoot: string;
  let env: NodeJS.ProcessEnv;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-migrate-')));
    projectRoot = path.join(tempDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    createOpenSpecRoot(projectRoot);
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    cleanupTempPath(tempDir);
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function gdd(): string {
    return getGlobalDataDir({ env });
  }

  function resolvedCommandRoot() {
    return {
      path: projectRoot,
      changesDir: path.join(projectRoot, 'rasen', 'changes'),
      specsDir: path.join(projectRoot, 'rasen', 'specs'),
      archiveDir: path.join(projectRoot, 'rasen', 'changes', 'archive'),
      defaultSchema: 'spec-driven' as const,
      source: 'nearest' as const,
    };
  }

  async function runInProcessCommand(
    args: string[],
    dependencies: WorkMigrateCommandDependencies
  ): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerWorkCommand(program, dependencies);
    await program.parseAsync(['node', 'rasen', ...args]);
  }

  /** Creates an in-repo change directory (needed for discoverChangeDirs + routing). */
  function makeChange(name: string): string {
    const dir = path.join(projectRoot, 'rasen', 'changes', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  /**
   * Registers the project's machine identity and creates a machine-home work
   * directory for `changeName`. Returns the work dir path (the SOURCE of
   * legacy files in the inverted model) and the in-repo change dir (a
   * routing target).
   */
  async function setupWorkDir(
    changeName: string,
    options: { register?: boolean } = {}
  ): Promise<{ workDir: string; changeDir: string }> {
    const changeDir = makeChange(changeName);

    if (options.register !== false) {
      const { entry } = await registerProject(
        { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir: gdd() }
      );
      const homeDir = getProjectHomeDir(entry.home, { globalDataDir: gdd() });
      const workDir = path.join(homeDir, 'changes', changeName, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      return { workDir, changeDir };
    }

    return { workDir: '', changeDir };
  }

  it('--dry-run previews without moving files', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
    const payload = parseJson(result);
    expect(Object.keys(payload).sort()).toEqual([
      'blockers',
      'changes',
      'designDocs',
      'dryRun',
      'executed',
      'notes',
      'probeDirs',
      'summary',
    ]);
    expect(payload.executed).toBe(false);
    expect(payload.dryRun).toBe(true);
    expect(payload.summary.totalCandidates).toBe(1);
    // auto-run.json is classified as run-state → would move to ephemera.
    expect(payload.changes[0].moved).toEqual(['auto-run.json']);
  });

  it('--json without --yes previews without moving files', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'ship-log.md'), '# ship\n');

    const result = await runCLI(['work', 'migrate', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workDir, 'ship-log.md'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.executed).toBe(false);
    expect(payload.summary.totalCandidates).toBe(1);
  });

  it('--json --yes executes and moves the file', async () => {
    const { workDir, changeDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    // File is gone from the machine-home work directory.
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(false);
    const payload = parseJson(result);
    expect(payload.executed).toBe(true);
    expect(payload.summary.moved).toBe(1);
    // File landed in the execution root's ephemera area.
    const ephemeraPath = path.join(projectRoot, '.rasen', 'changes', 'foo', 'ephemera', 'auto-run.json');
    expect(fs.existsSync(ephemeraPath)).toBe(true);
  });

  it('keeps an explicitly project-selected root as planning, execution, and legacy owner', () => {
    const selected = path.join(tempDir, 'selected-project');
    const decoyCwd = path.join(tempDir, 'other-checkout');
    const context = workMigrationRootContext(
      {
        path: selected,
        changesDir: path.join(selected, 'rasen', 'changes'),
        specsDir: path.join(selected, 'rasen', 'specs'),
        archiveDir: path.join(selected, 'rasen', 'changes', 'archive'),
        defaultSchema: 'spec-driven',
        source: 'store',
        storeId: 'selected-project-id',
        storeType: 'project',
      },
      decoyCwd
    );

    expect(context).toMatchObject({
      planningRoot: selected,
      executionRoot: selected,
      legacyHomeOwnerRoot: selected,
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('passes the exact previewed plan to apply and reports source drift without replanning', async () => {
    const archiveName = '2026-07-31-frozen';
    const changeDir = path.join(projectRoot, 'rasen', 'changes', 'archive', archiveName);
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n');
    const { entry } = await registerProject(
      { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
      { globalDataDir: gdd() }
    );
    const workDir = path.join(
      getProjectHomeDir(entry.home, { globalDataDir: gdd() }),
      'changes',
      'archive',
      archiveName,
      'work'
    );
    fs.mkdirSync(workDir, { recursive: true });
    const source = path.join(workDir, 'auto-run.json');
    fs.writeFileSync(source, '{"before":true}');
    const plan = await planWorkMigration(
      workMigrationRootContext({
        path: projectRoot,
        changesDir: path.join(projectRoot, 'rasen', 'changes'),
        specsDir: path.join(projectRoot, 'rasen', 'specs'),
        archiveDir: path.join(projectRoot, 'rasen', 'changes', 'archive'),
        defaultSchema: 'spec-driven',
        source: 'nearest',
      }),
      { globalDataDir: gdd() }
    );
    const decoyCwd = path.join(tempDir, 'decoy-cwd');
    fs.mkdirSync(decoyCwd, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(decoyCwd);
    fs.writeFileSync(source, '{"after":true}');
    const laterCandidate = path.join(workDir, 'ship-log.md');
    fs.writeFileSync(laterCandidate, '# later\n');
    let receivedPlan: typeof plan | undefined;

    const report = await applyPlannedWorkMigration(plan, async received => {
      receivedPlan = received;
      return applyWorkMigration(received);
    });

    expect(receivedPlan).toBe(plan);
    expect(report.plan).toBe(plan);
    expect(report.outcomes).toEqual([
      expect.objectContaining({ status: 'conflict', code: 'ESTALE', source }),
    ]);
    expect(fs.readFileSync(source, 'utf8')).toBe('{"after":true}');
    expect(fs.readFileSync(laterCandidate, 'utf8')).toBe('# later\n');
    expect(fs.existsSync(path.join(decoyCwd, '.rasen'))).toBe(false);
  });

  it('the registered command confirms and applies the exact previewed plan after drift', async () => {
    const archiveName = '2026-07-31-command-frozen';
    const changeDir = path.join(projectRoot, 'rasen', 'changes', 'archive', archiveName);
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n');
    const { entry } = await registerProject(
      { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
      { globalDataDir: gdd() }
    );
    const workDir = path.join(
      getProjectHomeDir(entry.home, { globalDataDir: gdd() }),
      'changes',
      'archive',
      archiveName,
      'work'
    );
    fs.mkdirSync(workDir, { recursive: true });
    const source = path.join(workDir, 'auto-run.json');
    fs.writeFileSync(source, '{"before":true}');
    const laterCandidate = path.join(workDir, 'ship-log.md');
    const decoyCwd = path.join(tempDir, 'command-decoy-cwd');
    fs.mkdirSync(decoyCwd, { recursive: true });

    let previewedPlan: Awaited<ReturnType<typeof planWorkMigration>> | undefined;
    let receivedPlan: Awaited<ReturnType<typeof planWorkMigration>> | undefined;
    let applyResult: Awaited<ReturnType<typeof applyWorkMigration>> | undefined;
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(' '));
    });
    const planner: NonNullable<WorkMigrateCommandDependencies['planner']> = vi.fn(
      async (rootContext, options) => {
      const plan = await planWorkMigration(rootContext, {
        ...options,
        globalDataDir: gdd(),
      });
      previewedPlan = plan;
      return plan;
      }
    );
    const confirm: NonNullable<WorkMigrateCommandDependencies['confirm']> = vi.fn(async () => {
      expect(logs.join('\n')).toContain('Work migration (preview)');
      fs.writeFileSync(source, '{"after":true}');
      fs.writeFileSync(laterCandidate, '# discovered after preview\n');
      vi.spyOn(process, 'cwd').mockReturnValue(decoyCwd);
      return true;
    });
    const apply: NonNullable<WorkMigrateCommandDependencies['apply']> = vi.fn(async plan => {
      receivedPlan = plan;
      applyResult = await applyWorkMigration(plan);
      return applyResult;
    });

    await runInProcessCommand(['work', 'migrate'], {
      rootResolver: async () => resolvedCommandRoot(),
      planner,
      confirm,
      apply,
    });

    expect(planner).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(receivedPlan).toBe(previewedPlan);
    expect(applyResult?.outcomes).toEqual([
      expect.objectContaining({ status: 'conflict', code: 'ESTALE', source }),
    ]);
    expect(logs.join('\n')).toContain('Work migration (result)');
    expect(logs.join('\n')).toContain('Conflicts, left in place');
    expect(fs.readFileSync(source, 'utf8')).toBe('{"after":true}');
    expect(fs.readFileSync(laterCandidate, 'utf8')).toBe('# discovered after preview\n');
    expect(fs.existsSync(path.join(decoyCwd, '.rasen'))).toBe(false);
  });

  it('JSON previews surface typed blockers and --yes fails without applying', async () => {
    const { workDir } = await setupWorkDir('foo');
    const source = path.join(workDir, 'review-report.md');
    fs.writeFileSync(source, 'unchanged');
    const blockedFileSystem = {
      ...defaultWorkMigrationFileSystem,
      readdir: (target: string) =>
        target === workDir
          ? Promise.reject(Object.assign(new Error('work scan denied'), { code: 'EACCES' }))
          : defaultWorkMigrationFileSystem.readdir(target),
    };
    const planner: NonNullable<WorkMigrateCommandDependencies['planner']> = vi.fn(
      (rootContext, options) =>
        planWorkMigration(rootContext, {
          ...options,
          globalDataDir: gdd(),
          fileSystem: blockedFileSystem,
        })
    );
    const apply = vi.fn(applyWorkMigration);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(' '));
    });
    const dependencies: WorkMigrateCommandDependencies = {
      rootResolver: async () => resolvedCommandRoot(),
      planner,
      apply,
    };

    await runInProcessCommand(['work', 'migrate', '--json'], dependencies);

    expect(process.exitCode).toBe(originalExitCode);
    const preview = JSON.parse(logs.at(-1)!);
    expect(preview.executed).toBe(false);
    expect(preview.status).toBeUndefined();
    expect(preview.blockers).toEqual([
      expect.objectContaining({
        operation: 'readdir',
        path: workDir,
        code: 'EACCES',
      }),
    ]);

    logs.length = 0;
    await runInProcessCommand(
      ['work', 'migrate', '--json', '--yes'],
      dependencies
    );

    expect(process.exitCode).toBe(1);
    const blockedApply = JSON.parse(logs.at(-1)!);
    expect(blockedApply.executed).toBe(false);
    expect(blockedApply.status).toEqual([
      expect.objectContaining({ code: 'work_migrate_plan_incomplete' }),
    ]);
    expect(blockedApply.blockers).toEqual([
      expect.objectContaining({
        operation: 'readdir',
        path: workDir,
        code: 'EACCES',
      }),
    ]);
    expect(apply).not.toHaveBeenCalled();
    expect(fs.readFileSync(source, 'utf8')).toBe('unchanged');
  });

  it('human --yes prints blocker operation, path, and code then fails closed', async () => {
    const { workDir } = await setupWorkDir('foo');
    const source = path.join(workDir, 'review-report.md');
    fs.writeFileSync(source, 'unchanged');
    const blockedFileSystem = {
      ...defaultWorkMigrationFileSystem,
      readdir: (target: string) =>
        target === workDir
          ? Promise.reject(Object.assign(new Error('work scan denied'), { code: 'EPERM' }))
          : defaultWorkMigrationFileSystem.readdir(target),
    };
    const apply = vi.fn(applyWorkMigration);
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      errors.push(values.map(String).join(' '));
    });

    await runInProcessCommand(['work', 'migrate', '--yes'], {
      rootResolver: async () => resolvedCommandRoot(),
      planner: (rootContext, options) =>
        planWorkMigration(rootContext, {
          ...options,
          globalDataDir: gdd(),
          fileSystem: blockedFileSystem,
        }),
      apply,
    });

    const output = logs.join('\n');
    expect(output).toContain('Work migration (preview)');
    expect(output).toContain('Planning blockers:');
    expect(output).toContain(`readdir ${workDir} [EPERM]`);
    expect(errors.join('\n')).toContain('Migration apply was blocked');
    expect(process.exitCode).toBe(1);
    expect(apply).not.toHaveBeenCalled();
    expect(fs.readFileSync(source, 'utf8')).toBe('unchanged');
  });

  it('a second --yes run reports nothing to migrate (idempotent)', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const first = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(first.exitCode).toBe(0);

    const second = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(second.exitCode).toBe(0);
    const payload = parseJson(second);
    expect(payload.executed).toBe(true);
    expect(payload.summary.totalCandidates).toBe(0);
  });

  it('--change scopes migration to a single change', async () => {
    const foo = await setupWorkDir('foo');
    const bar = await setupWorkDir('bar');
    fs.writeFileSync(path.join(foo.workDir, 'auto-run.json'), '{}');
    fs.writeFileSync(path.join(bar.workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes', '--change', 'foo'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(foo.workDir, 'auto-run.json'))).toBe(false);
    expect(fs.existsSync(path.join(bar.workDir, 'auto-run.json'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].change).toBe('foo');
  });

  it('--change matching nothing exits non-zero with a diagnostic', async () => {
    makeChange('foo');

    const result = await runCLI(['work', 'migrate', '--json', '--yes', '--change', 'does-not-exist'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(1);
    const payload = parseJson(result);
    expect(payload.status?.[0]?.code).toBe('work_migrate_change_not_found');
  });

  it('human mode --dry-run prints the preview and exits 0', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Work migration (preview)');
    expect(result.stdout).toContain('auto-run.json');
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
  });

  it('human cancellation leaves the previewed source in place', async () => {
    const { workDir } = await setupWorkDir('foo');
    const source = path.join(workDir, 'auto-run.json');
    fs.writeFileSync(source, '{}');

    const result = await runCLI(['work', 'migrate'], {
      cwd: projectRoot,
      env,
      input: 'n\n',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Work migration (preview)');
    expect(result.stdout).toContain('Migration cancelled.');
    expect(fs.existsSync(source)).toBe(true);
  });

  it('--discard-absorbed-conclusions applies the previewed destructive action', async () => {
    const { workDir } = await setupWorkDir('foo');
    const homeDir = path.resolve(workDir, '..', '..', '..');
    const conclusions = path.join(homeDir, 'probe', 'research-conclusions');
    fs.mkdirSync(conclusions, { recursive: true });
    fs.writeFileSync(path.join(conclusions, 'notes.md'), '# absorbed\n');

    const result = await runCLI(
      ['work', 'migrate', '--discard-absorbed-conclusions', '--json', '--yes'],
      { cwd: projectRoot, env }
    );

    expect(result.exitCode).toBe(0);
    expect(parseJson(result).summary.discarded).toBe(1);
    expect(fs.existsSync(conclusions)).toBe(false);
  });

  it('M1: --dry-run on an unregistered project never mints identity (config.yaml and registry untouched)', async () => {
    // Create an in-repo change dir but do NOT register the project.
    const dir = makeChange('foo');
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    const configBefore = fs.readFileSync(configPath, 'utf-8');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    // No machine home → no work directories scanned → 0 candidates.
    expect(payload.summary.totalCandidates).toBe(0);
    // No work directory was resolved (workDir is null for each change).
    expect(payload.changes[0].workDir).toBeNull();
    // Identity was never minted: config and data dir are untouched.
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(configBefore);
    expect(fs.existsSync(path.join(tempDir, 'data', 'rasen', 'projects'))).toBe(false);
  });

  it('--json --yes does not mint identity or replan when the preview has no machine home', async () => {
    makeChange('foo');
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    const configBefore = fs.readFileSync(configPath, 'utf8');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.executed).toBe(true);
    expect(payload.summary.totalCandidates).toBe(0);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(configBefore);
    expect(fs.existsSync(path.join(tempDir, 'data', 'rasen', 'projects'))).toBe(false);
  });

  // DELIBERATE BREAKING CHANGE (proposal.md BREAKING bullet): a legacy flat
  // Store's planning tree is read-only until it is migrated, and `work migrate`
  // writes planning-owned files (evidence, handoff, design docs) INTO it. The
  // refusal is the designed behavior, not a missing capability, and it names
  // the real cause and repair.
  it('deliberately refuses legacy flat Store migration as read-only and moves nothing', async () => {
    const storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    const storeId = 'team-store';
    await registerStore({ id: storeId, localPath: storeRoot, globalDataDir: gdd() });
    const storeChange = path.join(storeRoot, 'rasen', 'changes', 'foo');
    fs.mkdirSync(storeChange, { recursive: true });
    fs.writeFileSync(path.join(storeChange, 'proposal.md'), '# proposal\n');

    const memberRoot = path.join(tempDir, 'member-worktree');
    createOpenSpecRoot(memberRoot);
    fs.mkdirSync(path.join(memberRoot, '.git'), { recursive: true });
    const memberId = randomUUID();
    fs.writeFileSync(
      path.join(memberRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${memberId}\nstore: ${storeId}\n`
    );
    const { entry } = await registerProject(
      { projectRoot: memberRoot, projectId: memberId, mode: 'store' },
      { globalDataDir: gdd() }
    );
    const memberHome = getProjectHomeDir(entry.home, { globalDataDir: gdd() });
    const workDir = path.join(memberHome, 'changes', 'foo', 'work');
    fs.mkdirSync(path.join(workDir, 'handoff'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'review-report.md'), '# report\n');
    fs.writeFileSync(path.join(workDir, 'handoff', 'implementer-1.md'), '# handoff\n');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');
    fs.mkdirSync(path.join(memberHome, 'design-docs'), { recursive: true });
    fs.writeFileSync(path.join(memberHome, 'design-docs', 'routing.md'), '# design\n');
    fs.mkdirSync(path.join(memberHome, 'probe', 'driver'), { recursive: true });
    fs.writeFileSync(path.join(memberHome, 'probe', 'driver', 'run.ts'), 'export {};\n');

    const result = await runCLI(
      ['work', 'migrate', '--store', storeId, '--json', '--yes'],
      { cwd: memberRoot, env }
    );

    expect(result.exitCode).toBe(1);
    expect(parseJson(result)).toMatchObject({
      changes: [],
      summary: null,
      status: [{ code: 'legacy_flat_store_requires_migration' }],
    });
    expect(fs.existsSync(path.join(workDir, 'review-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'handoff', 'implementer-1.md'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
    expect(fs.existsSync(path.join(memberHome, 'design-docs', 'routing.md'))).toBe(true);
    expect(fs.existsSync(path.join(memberHome, 'probe', 'driver', 'run.ts'))).toBe(true);
    expect(fs.existsSync(path.join(storeChange, 'evidence'))).toBe(false);
    expect(fs.existsSync(path.join(storeRoot, '.rasen'))).toBe(false);
    expect(fs.existsSync(path.join(memberRoot, '.rasen'))).toBe(false);
  });

  // Same DELIBERATE refusal from both a main checkout and a linked worktree:
  // the read-only legacy Store decides it, so neither member worktree can
  // migrate into the Store and neither writes anything.
  it('deliberately refuses legacy flat Store migration from both member worktrees', async () => {
    const storeRoot = path.join(tempDir, 'worktree-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({
      id: 'worktree-store',
      localPath: storeRoot,
      globalDataDir: gdd(),
    });
    for (const name of ['main-change', 'linked-change']) {
      const changeDir = path.join(storeRoot, 'rasen', 'changes', name);
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n');
    }

    const mainRoot = path.join(tempDir, 'member-main');
    const linkedRoot = path.join(tempDir, 'member-linked');
    createOpenSpecRoot(mainRoot);
    const projectId = randomUUID();
    fs.writeFileSync(
      path.join(mainRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\nstore: worktree-store\n`
    );
    execFileSync('git', ['init'], { cwd: mainRoot, stdio: 'ignore' });
    const gitEnv = { ...process.env, ...isolatedGitEnv(mainRoot) };
    execFileSync('git', ['add', '-A'], { cwd: mainRoot, env: gitEnv });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });
    execFileSync('git', ['worktree', 'add', '-b', 'linked-test', linkedRoot], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });
    const { entry } = await registerProject(
      { projectRoot: mainRoot, projectId, mode: 'store' },
      { globalDataDir: gdd() }
    );
    const sharedHome = getProjectHomeDir(entry.home, { globalDataDir: gdd() });

    const seedLegacy = (changeName: string, probeName: string): void => {
      const workDir = path.join(sharedHome, 'changes', changeName, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'review-report.md'), `# ${changeName}\n`);
      fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');
      const probe = path.join(sharedHome, 'probe', probeName);
      fs.mkdirSync(probe, { recursive: true });
      fs.writeFileSync(path.join(probe, 'run.ts'), 'export {};\n');
    };

    seedLegacy('main-change', 'driver-main');
    const mainResult = await runCLI(
      ['work', 'migrate', '--store', 'worktree-store', '--json', '--yes'],
      { cwd: mainRoot, env }
    );
    expect(mainResult.exitCode).toBe(1);
    expect(parseJson(mainResult)).toMatchObject({
      changes: [],
      summary: null,
      status: [{ code: 'legacy_flat_store_requires_migration' }],
    });
    expect(fs.existsSync(path.join(sharedHome, 'changes', 'main-change', 'work', 'review-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(sharedHome, 'changes', 'main-change', 'work', 'auto-run.json'))).toBe(true);
    expect(fs.existsSync(path.join(sharedHome, 'probe', 'driver-main', 'run.ts'))).toBe(true);
    expect(fs.existsSync(path.join(mainRoot, '.rasen'))).toBe(false);
    expect(fs.existsSync(path.join(linkedRoot, '.rasen'))).toBe(false);

    seedLegacy('linked-change', 'driver-linked');
    const linkedResult = await runCLI(
      ['work', 'migrate', '--store', 'worktree-store', '--json', '--yes'],
      { cwd: linkedRoot, env }
    );
    expect(linkedResult.exitCode).toBe(1);
    expect(parseJson(linkedResult)).toMatchObject({
      changes: [],
      summary: null,
      status: [{ code: 'legacy_flat_store_requires_migration' }],
    });
    expect(fs.existsSync(path.join(sharedHome, 'changes', 'linked-change', 'work', 'review-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(sharedHome, 'changes', 'linked-change', 'work', 'auto-run.json'))).toBe(true);
    expect(fs.existsSync(path.join(sharedHome, 'probe', 'driver-linked', 'run.ts'))).toBe(true);
    expect(fs.existsSync(path.join(mainRoot, '.rasen'))).toBe(false);
    expect(fs.existsSync(path.join(linkedRoot, '.rasen'))).toBe(false);
    for (const name of ['main-change', 'linked-change']) {
      expect(
        fs.existsSync(
          path.join(
            storeRoot,
            'rasen',
            'changes',
            name,
            'evidence',
            'review-report.md'
          )
        )
      ).toBe(false);
    }
    expect(fs.existsSync(path.join(storeRoot, '.rasen'))).toBe(false);
  });

  it('rejects mutually exclusive Store and project selectors before planning', async () => {
    const result = await runCLI(
      ['work', 'migrate', '--store', 'one', '--project', 'two', '--json'],
      { cwd: projectRoot, env }
    );

    expect(result.exitCode).toBe(1);
    expect(parseJson(result).summary).toBeNull();
  });

  it('M2: the inverted migrator does not depend on git (corrupted index does not block migration)', async () => {
    // The OLD migrator classified files as tracked/untracked via git
    // ls-files, so a corrupted index caused a hard failure. The inverted
    // migrator scans machine-home only — git state is irrelevant. Verify a
    // corrupted git index does NOT block migration.
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    const gitExecEnv = { ...process.env, ...isolatedGitEnv(projectRoot) };
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, env: gitExecEnv, stdio: 'ignore' });
    // Corrupt the index: rev-parse still confirms a repo, but ls-files fails.
    fs.writeFileSync(path.join(projectRoot, '.git', 'index'), 'not a valid index file, corrupted');

    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    // The inverted migrator succeeds — it does not query git at all.
    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.summary.moved).toBe(1);
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(false);
  });
});
