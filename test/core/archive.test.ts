import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ArchiveCommand } from '../../src/core/archive.js';
import type {
  ArchiveApplyOptions,
  ArchiveApplyResult,
  ArchivePlan,
} from '../../src/core/archive-engine.js';
import {
  applyArchive,
  defaultArchiveEngineAdapters,
  loadStoredArchivePlan,
} from '../../src/core/archive-engine.js';
import { getGlobalDataDir } from '../../src/core/global-config.js';
import { Validator } from '../../src/core/validation/validator.js';
import { promises as fs } from 'fs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'path';
import os from 'os';
import { isolatedGitEnv } from '../helpers/store-git.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn()
}));

describe('ArchiveCommand', () => {
  let tempDir: string;
  let archiveCommand: ArchiveCommand;
  const originalConsoleLog = console.log;
  const originalExitCode = process.exitCode;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  const originalRasenHome = process.env.RASEN_HOME;
  const originalRasenLang = process.env.RASEN_LANG;

  beforeEach(async () => {
    // Create temp directory
    tempDir = path.join(os.tmpdir(), `rasen-archive-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    // Match the product's existing-path canonicalization. On macOS /var may
    // resolve through /private/var, and Windows runners may expose an 8.3
    // short-path alias for the same temporary directory.
    tempDir = await fs.realpath(tempDir);

    // Change to temp directory
    process.chdir(tempDir);

    // Isolate root resolution from any real store registry on the
    // host machine so no-root behavior stays the implicit-root path. The
    // global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_DATA_HOME — clear it so this suite's XDG isolation
    // actually applies.
    delete process.env.RASEN_HOME;
    delete process.env.RASEN_LANG;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'xdg-data');

    // Create Rasen structure
    const openspecDir = path.join(tempDir, 'rasen');
    await fs.mkdir(path.join(openspecDir, 'changes'), { recursive: true });
    await fs.mkdir(path.join(openspecDir, 'specs'), { recursive: true });
    await fs.mkdir(path.join(openspecDir, 'changes', 'archive'), { recursive: true });

    // Suppress console.log during tests
    console.log = vi.fn();

    // Isolate process.exitCode so a failing run can't leak into the next
    // test or skew the vitest process exit status.
    process.exitCode = undefined;

    archiveCommand = new ArchiveCommand();
  });

  afterEach(async () => {
    // Restore console.log
    console.log = originalConsoleLog;

    // Restore process.exitCode (clear anything a test set)
    process.exitCode = originalExitCode;

    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    if (originalRasenHome === undefined) {
      delete process.env.RASEN_HOME;
    } else {
      process.env.RASEN_HOME = originalRasenHome;
    }
    if (originalRasenLang === undefined) {
      delete process.env.RASEN_LANG;
    } else {
      process.env.RASEN_LANG = originalRasenLang;
    }

    // Clear mocks
    vi.clearAllMocks();

    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('execute', () => {
    class TrackingArchiveCommand extends ArchiveCommand {
      applyCalls = 0;

      protected override applyPlannedArchive(
        plan: ArchivePlan,
        options: ArchiveApplyOptions = {}
      ): Promise<ArchiveApplyResult> {
        this.applyCalls += 1;
        return super.applyPlannedArchive(plan, options);
      }
    }

    it('persists an incomplete direct plan before exposing token recovery', async () => {
      const changeName = 'durable-direct-recovery';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      class RecoverableApplyCommand extends ArchiveCommand {
        failedPlan?: ArchivePlan;
        gateObserved = false;

        protected override async applyPlannedArchive(
          plan: ArchivePlan,
          options: ArchiveApplyOptions = {}
        ): Promise<ArchiveApplyResult> {
          this.failedPlan = plan;
          await fs.access(
            path.join(
              getGlobalDataDir(),
              'archive-transactions',
              plan.transactionId,
              'operation.lock'
            )
          );
          this.gateObserved = true;
          return applyArchive(plan, {
            ...options,
            adapters: {
              ...defaultArchiveEngineAdapters,
              fs: {
                ...defaultArchiveEngineAdapters.fs,
                mkdir: async (
                  targetPath: string,
                  mkdirOptions?: { recursive?: boolean }
                ): Promise<string | undefined> => {
                  if (targetPath === plan.paths.final) {
                    const error = new Error('injected final reservation failure');
                    (error as NodeJS.ErrnoException).code = 'EACCES';
                    throw error;
                  }
                  return defaultArchiveEngineAdapters.fs.mkdir(
                    targetPath,
                    mkdirOptions
                  );
                },
              },
            },
          });
        }
      }

      const command = new RecoverableApplyCommand();
      await command.execute(changeName, { yes: true, json: true });
      const output = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(output.archive.status).toBe('recoverable');
      expect(output.archive.recoveryCommand).toMatch(
        /^rasen archive --apply-plan archive-v1:/
      );
      const plan = command.failedPlan;
      expect(plan).toBeDefined();
      expect(command.gateObserved).toBe(true);
      const token = `archive-v1:${plan!.transactionId}:${plan!.planHash}`;
      await expect(
        loadStoredArchivePlan(token, getGlobalDataDir())
      ).resolves.toEqual(plan);
    });

    it('does not mutate a direct archive when plan persistence fails', async () => {
      const changeName = 'direct-persistence-failure';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const canonical = path.join(
        tempDir,
        'rasen',
        'specs',
        'existing',
        'spec.md'
      );
      await fs.mkdir(changeDir, { recursive: true });
      await fs.mkdir(path.dirname(canonical), { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');
      await fs.writeFile(canonical, '# Canonical\n');
      const sourceBefore = await fs.readFile(
        path.join(changeDir, 'tasks.md'),
        'utf8'
      );
      const canonicalBefore = await fs.readFile(canonical, 'utf8');
      process.env.XDG_DATA_HOME = path.join(tempDir, 'isolated-data-home');
      const transactionStore = path.join(
        getGlobalDataDir(),
        'archive-transactions'
      );
      await fs.mkdir(getGlobalDataDir(), { recursive: true });
      await fs.writeFile(transactionStore, 'not a directory\n');
      const command = new TrackingArchiveCommand();

      await command.execute(changeName, { yes: true, json: true });

      const output = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(output.archive).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(command.applyCalls).toBe(0);
      await expect(
        fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8')
      ).resolves.toBe(sourceBefore);
      await expect(fs.readFile(canonical, 'utf8')).resolves.toBe(
        canonicalBefore
      );
      await expect(fs.readdir(archiveDir)).resolves.toEqual([]);
    });

    it('applies an immutable token and never presents completed corruption as auto-resumable', async () => {
      const changeName = 'durable-plan';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      await archiveCommand.execute(changeName, {
        dryRun: true,
        savePlan: true,
        json: true,
        yes: true,
      });
      const preview = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      const token = preview.archive.planToken as string;
      const previewHash = preview.archive.plan.planHash as string;
      expect(token).toContain(previewHash);

      const lateEphemera = path.join(
        tempDir,
        '.rasen',
        'changes',
        changeName,
        'ephemera',
        'late.log'
      );
      await fs.mkdir(path.dirname(lateEphemera), { recursive: true });
      await fs.writeFile(lateEphemera, 'introduced after preview\n');
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        applyPlan: token,
        yes: true,
        json: true,
      });
      const applied = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(applied.archive.mode).toBe('apply');
      expect(applied.archive.result.status).toBe('complete');
      expect(applied.archive.result.planHash).toBe(previewHash);
      expect(await fs.readFile(lateEphemera, 'utf8')).toBe(
        'introduced after preview\n'
      );

      const archivedTask = path.join(applied.archive.result.path, 'tasks.md');
      await fs.writeFile(archivedTask, 'corrupt completed archive\n');
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        applyPlan: token,
        yes: true,
        json: true,
      });
      const rejected = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(rejected.archive.result).toMatchObject({
        status: 'recoverable',
        resumed: true,
        journalPath: applied.archive.result.journalPath,
        manualRecoveryAction: {
          kind: 'manual-recovery-required',
          guidance: expect.stringContaining('Automatic archive resume is disabled'),
        },
      });
      expect(rejected.archive.result.recoveryCommand).toBeUndefined();
      expect(
        JSON.parse(await fs.readFile(applied.archive.result.journalPath, 'utf8'))
      ).toMatchObject({
        phase: 'complete',
        integrityFailure: {
          operation: 'accounting',
          code: 'archive_reservation_ownership_unverified',
        },
      });
      expect(await fs.readFile(archivedTask, 'utf8')).toBe(
        'corrupt completed archive\n'
      );
    });

    it('aborts an unapplied token idempotently and rejects later apply', async () => {
      const changeName = 'aborted-plan';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      await archiveCommand.execute(changeName, {
        dryRun: true,
        savePlan: true,
        json: true,
        yes: true,
      });
      const preview = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      const token = preview.archive.planToken as string;
      process.env.RASEN_LANG = 'ja';
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        abortPlan: token,
        json: true,
      });
      const unconfirmed = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(unconfirmed.status[0]).toMatchObject({
        code: 'archive_abort_confirmation_required',
        message: expect.stringContaining('明示的な確認'),
      });
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
      process.exitCode = undefined;
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        abortPlan: token,
        yes: true,
        json: true,
      });
      const aborted = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(aborted.archive).toMatchObject({
        mode: 'abort',
        result: {
          status: 'aborted',
          change: changeName,
          blockers: [],
        },
      });
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        abortPlan: token,
        yes: true,
      });
      expect(vi.mocked(console.log).mock.calls.at(-1)?.[0]).toContain(
        'すでに中止済み'
      );
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        applyPlan: token,
        yes: true,
        json: true,
      });
      const reapplied = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(reapplied.status[0]).toMatchObject({
        code: 'archive_plan_aborted',
        message: expect.stringContaining('中止済み'),
      });
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });

    it('returns a complete blocked preview with a nonzero status', async () => {
      const changeName = 'blocked-preview';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');
      await fs.writeFile(
        path.join(changeDir, '.rasen-archive-input.json'),
        JSON.stringify({
          schemaVersion: 99,
          change: changeName,
          handoff: { complete: true, decisions: [] },
          probes: [],
        })
      );

      await archiveCommand.execute(changeName, {
        dryRun: true,
        json: true,
        yes: true,
      });
      const preview = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(process.exitCode).toBe(1);
      expect(preview.archive.plan.complete).toBe(false);
      expect(preview.archive.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: 'sidecar-validate' }),
        ])
      );
    });

    it('returns an engine-only blocked plan without calling archive apply', async () => {
      const changeName = 'blocked-sidecar-apply';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const sidecarPath = path.join(changeDir, '.rasen-archive-input.json');
      const sidecarBytes = '{"schemaVersion":99,"change":"blocked-sidecar-apply"}\n';
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');
      await fs.writeFile(sidecarPath, sidecarBytes);

      const trackingCommand = new TrackingArchiveCommand();
      await trackingCommand.execute(changeName, { json: true, yes: true });

      const payload = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(process.exitCode).toBe(1);
      expect(trackingCommand.applyCalls).toBe(0);
      expect(payload.archive).toMatchObject({
        change: changeName,
        status: 'blocked',
        specsUpdated: false,
        totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
        ephemeraDiscarded: [],
        blockers: expect.arrayContaining([
          expect.objectContaining({ operation: 'sidecar-validate' }),
        ]),
      });
      expect(payload.archive.result).toBeUndefined();
      expect(payload.archive.plan.complete).toBe(false);
      expect(payload.plan).toEqual(payload.archive.plan);
      expect(payload.status[0].code).toBe('archive_plan_blocked');
      await expect(fs.readFile(sidecarPath, 'utf8')).resolves.toBe(sidecarBytes);
      await expect(fs.access(payload.plan.paths.stage)).rejects.toThrow();
      await expect(fs.access(payload.plan.paths.journal)).rejects.toThrow();
      await expect(fs.access(payload.plan.paths.final)).rejects.toThrow();
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });

    it('blocks a reserved ship-log heading before archive apply or journal creation', async () => {
      const changeName = 'reserved-archive-heading';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const shipLogPath = path.join(changeDir, 'ship-log.md');
      const shipLog = [
        '# Ship Log',
        '',
        '**Mode:** local',
        '',
        '## Archive',
        'Change-authored placeholder.',
        '',
      ].join('\n');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');
      await fs.writeFile(shipLogPath, shipLog);

      const trackingCommand = new TrackingArchiveCommand();
      await trackingCommand.execute(changeName, {
        json: true,
        yes: true,
        dryRun: true,
        savePlan: true,
      });

      const payload = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(process.exitCode).toBe(1);
      expect(trackingCommand.applyCalls).toBe(0);
      expect(payload.archive.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'evidence',
            code: 'archive_ship_log_reserved_section',
            path: shipLogPath,
          }),
        ])
      );
      expect(payload.archive.plan.shipLog.source).toBe(shipLogPath);
      expect(payload.archive.planToken).toBeUndefined();
      await expect(fs.readFile(shipLogPath, 'utf8')).resolves.toBe(shipLog);
      await expect(fs.access(payload.archive.plan.paths.stage)).rejects.toThrow();
      await expect(fs.access(payload.archive.plan.paths.journal)).rejects.toThrow();
      await expect(fs.access(payload.archive.plan.paths.final)).rejects.toThrow();
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });

    it('keeps an engine-only target inspection failure generic without applying', async () => {
      const changeName = 'blocked-target-inspection';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const finalPath = path.join(
        tempDir,
        'rasen',
        'changes',
        'archive',
        `${new Date().toISOString().split('T')[0]}-${changeName}`
      );
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      const originalLstat = fs.lstat;
      const lstatSpy = vi.spyOn(fs, 'lstat').mockImplementation(async target => {
        if (path.resolve(String(target)) === finalPath) {
          throw Object.assign(new Error(`access denied: ${finalPath}`), {
            code: 'EACCES',
          });
        }
        return originalLstat(target);
      });
      const trackingCommand = new TrackingArchiveCommand();
      try {
        await trackingCommand.execute(changeName, {
          json: true,
          yes: true,
          noValidate: true,
          skipSpecs: true,
        });
      } finally {
        lstatSpy.mockRestore();
      }

      const payload = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(process.exitCode).toBe(1);
      expect(trackingCommand.applyCalls).toBe(0);
      expect(payload.archive).toMatchObject({
        change: changeName,
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({
            operation: 'target-lstat',
            code: 'EACCES',
          }),
        ]),
      });
      expect(payload.archive.result).toBeUndefined();
      expect(payload.plan).toEqual(payload.archive.plan);
      expect(payload.status[0].code).toBe('archive_plan_blocked');
      await expect(fs.access(payload.plan.paths.stage)).rejects.toThrow();
      await expect(fs.access(payload.plan.paths.journal)).rejects.toThrow();
      await expect(fs.access(payload.plan.paths.final)).rejects.toThrow();
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });

    it('saves a fully serializable blocked plan when the requested source is missing', async () => {
      const changeName = 'missing-preview-source';

      await archiveCommand.execute(changeName, {
        dryRun: true,
        savePlan: true,
        json: true,
        yes: true,
      });

      const previewText = vi.mocked(console.log).mock.calls.at(-1)?.[0] as string;
      const preview = JSON.parse(previewText);
      expect(process.exitCode).toBe(1);
      expect(preview.archive.dryRun).toBe(true);
      expect(preview.archive.planToken).toMatch(/^archive-v1:/);
      expect(preview.archive.plan).toEqual(
        expect.objectContaining({
          change: changeName,
          complete: false,
          preconditions: expect.objectContaining({ source: 'missing' }),
          sourceFingerprint: null,
        })
      );
      expect(preview.archive.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'source-lstat',
            code: 'ENOENT',
          }),
        ])
      );
      expect(JSON.parse(JSON.stringify(preview.archive.plan))).toEqual(
        preview.archive.plan
      );
      const transactionId = preview.archive.plan.transactionId as string;
      await expect(
        fs.access(
          path.join(
            process.env.XDG_DATA_HOME!,
            'rasen',
            'archive-transactions',
            transactionId,
            'plan.json'
          )
        )
      ).resolves.toBeUndefined();
      vi.mocked(console.log).mockClear();
      await archiveCommand.execute(undefined, {
        applyPlan: preview.archive.planToken,
        yes: true,
        json: true,
      });
      const blockedApply = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(blockedApply.archive.result.status).toBe('blocked');
      expect(blockedApply.archive.result.recoveryCommand).toBeUndefined();
      vi.mocked(console.log).mockClear();
      await archiveCommand.execute(undefined, {
        applyPlan: preview.archive.planToken,
        yes: true,
      });
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Recovery:')
      );
    });

    it('preserves a structured recoverable JSON result and same-token retry command', async () => {
      const changeName = 'recoverable-json';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');
      await archiveCommand.execute(changeName, {
        dryRun: true,
        savePlan: true,
        yes: true,
        json: true,
      });
      const preview = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      const token = preview.archive.planToken as string;
      await fs.writeFile(path.join(changeDir, 'after-plan.txt'), 'drift\n');
      vi.mocked(console.log).mockClear();

      await archiveCommand.execute(undefined, {
        applyPlan: token,
        yes: true,
        json: true,
      });
      const payload = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      expect(process.exitCode).toBe(1);
      expect(payload.archive.mode).toBe('apply');
      expect(payload.archive.result.status).toBe('recoverable');
      expect(payload.archive.result.planHash).toBe(preview.archive.plan.planHash);
      expect(payload.archive.result.recoveryCommand).toContain(token);
      await expect(fs.access(changeDir)).resolves.toBeUndefined();
    });

    it('should archive a change successfully', async () => {
      // Create a test change
      const changeName = 'test-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Create tasks.md with completed tasks
      const tasksContent = '- [x] Task 1\n- [x] Task 2';
      await fs.writeFile(path.join(changeDir, 'tasks.md'), tasksContent);
      
      // Execute archive with --yes flag
      await archiveCommand.execute(changeName, { yes: true });
      
      // Check that change was moved to archive
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      
      expect(archives.length).toBe(1);
      expect(archives[0]).toMatch(new RegExp(`\\d{4}-\\d{2}-\\d{2}-${changeName}`));
      
      // Verify original change directory no longer exists
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('should warn about incomplete tasks', async () => {
      const changeName = 'incomplete-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Create tasks.md with incomplete tasks
      const tasksContent = '- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3';
      await fs.writeFile(path.join(changeDir, 'tasks.md'), tasksContent);
      
      // Execute archive with --yes flag
      await archiveCommand.execute(changeName, { yes: true });
      
      // Verify warning was logged
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Warning: 2 incomplete task(s) found')
      );
    });

    it('detects incomplete tasks in nested glob tasks.md files (#1202 data-safety gate)', async () => {
      // Before the fix the gate read a fixed changes/<name>/tasks.md, saw zero
      // tasks for a glob-tasks change, and let an unfinished change archive.
      const schemaDir = path.join(tempDir, 'rasen', 'schemas', 'glob-tasks');
      await fs.mkdir(schemaDir, { recursive: true });
      await fs.writeFile(
        path.join(schemaDir, 'schema.yaml'),
        [
          'name: glob-tasks',
          'version: 1',
          'artifacts:',
          '  - id: proposal',
          '    generates: proposal.md',
          '    description: Proposal',
          '    template: proposal.md',
          '    requires: []',
          '  - id: tasks',
          '    generates: "**/tasks.md"',
          '    description: Nested tasks',
          '    template: tasks.md',
          '    requires: [proposal]',
          'apply:',
          '  requires: [tasks]',
          '  tracks: "**/tasks.md"',
          '',
        ].join('\n')
      );

      const changeName = 'glob-incomplete-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(path.join(changeDir, 'backend'), { recursive: true });
      await fs.mkdir(path.join(changeDir, 'frontend'), { recursive: true });
      await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: glob-tasks\n');
      await fs.writeFile(path.join(changeDir, 'backend', 'tasks.md'), '- [x] 1.1 a\n- [x] 1.2 b\n');
      await fs.writeFile(path.join(changeDir, 'frontend', 'tasks.md'), '- [x] 2.1 a\n- [ ] 2.2 b\n- [ ] 2.3 c\n');

      await archiveCommand.execute(changeName, { yes: true, noValidate: true, skipSpecs: true });

      // The gate now sees 5 tasks / 2 incomplete across the nested files.
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('2 incomplete task(s) found')
      );
    });

    it('should update specs when archiving (delta-based ADDED) and include change name in skeleton', async () => {
      const changeName = 'spec-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'test-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create delta-based change spec (ADDED requirement)
      const specContent = `# Test Capability Spec - Changes

## ADDED Requirements

### Requirement: The system SHALL provide test capability

#### Scenario: Basic test
Given a test condition
When an action occurs
Then expected result happens`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Execute archive with --yes flag and skip validation for speed
      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      
      // Verify spec was created from skeleton and ADDED requirement applied
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'test-capability', 'spec.md');
      const updatedContent = await fs.readFile(mainSpecPath, 'utf-8');
      expect(updatedContent).toContain('# test-capability Specification');
      expect(updatedContent).toContain('## Purpose');
      expect(updatedContent).toContain(`created by archiving change ${changeName}`);
      expect(updatedContent).toContain('## Requirements');
      expect(updatedContent).toContain('### Requirement: The system SHALL provide test capability');
      expect(updatedContent).toContain('#### Scenario: Basic test');
    });

    it('should allow REMOVED requirements when creating new spec file (issue #403)', async () => {
      const changeName = 'new-spec-with-removed';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'gift-card');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create delta spec with both ADDED and REMOVED requirements
      // This simulates refactoring where old fields are removed and new ones are added
      const specContent = `# Gift Card - Changes

## ADDED Requirements

### Requirement: Logo and Background Color
The system SHALL support logo and backgroundColor fields for gift cards.

#### Scenario: Display gift card with logo
- **WHEN** a gift card is displayed
- **THEN** it shows the logo and backgroundColor

## REMOVED Requirements

### Requirement: Image Field
### Requirement: Thumbnail Field`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Execute archive - should succeed with warning about REMOVED requirements
      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      
      // Verify warning was logged about REMOVED requirements being ignored
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Warning: gift-card - 2 REMOVED requirement(s) ignored for new spec (nothing to remove).')
      );
      
      // Verify spec was created with only ADDED requirements
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'gift-card', 'spec.md');
      const updatedContent = await fs.readFile(mainSpecPath, 'utf-8');
      expect(updatedContent).toContain('# gift-card Specification');
      expect(updatedContent).toContain('### Requirement: Logo and Background Color');
      expect(updatedContent).toContain('#### Scenario: Display gift card with logo');
      // REMOVED requirements should not be in the final spec
      expect(updatedContent).not.toContain('### Requirement: Image Field');
      expect(updatedContent).not.toContain('### Requirement: Thumbnail Field');
      
      // Verify change was archived successfully
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBeGreaterThan(0);
      expect(archives.some(a => a.includes(changeName))).toBe(true);
    });

    it('should still error on MODIFIED when creating new spec file', async () => {
      const changeName = 'new-spec-with-modified';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'new-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create delta spec with MODIFIED requirement (should fail for new spec)
      const specContent = `# New Capability - Changes

## ADDED Requirements

### Requirement: New Feature
New feature description.

## MODIFIED Requirements

### Requirement: Existing Feature
Modified content.`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Execute archive - should abort with error message (not throw, but log and return)
      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      
      // Verify error message mentions MODIFIED not allowed for new specs
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('new-capability: target spec does not exist; MODIFIED for "### Requirement: Existing Feature" requires an existing spec. Only ADDED requirements are allowed for new specs.')
      );
      expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');
      
      // Verify spec was NOT created
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'new-capability', 'spec.md');
      await expect(fs.access(mainSpecPath)).rejects.toThrow();
      
      // Verify change was NOT archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(false);
    });

    it('should still error on RENAMED when creating new spec file', async () => {
      const changeName = 'new-spec-with-renamed';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'another-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create delta spec with RENAMED requirement (should fail for new spec)
      const specContent = `# Another Capability - Changes

## ADDED Requirements

### Requirement: New Feature
New feature description.

## RENAMED Requirements
- FROM: \`### Requirement: Old Name\`
- TO: \`### Requirement: New Name\``;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Execute archive - should abort with error message (not throw, but log and return)
      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      
      // Verify error message mentions RENAMED not allowed for new specs
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('another-capability: target spec does not exist; RENAMED to "### Requirement: New Name" requires an existing spec. Only ADDED requirements are allowed for new specs.')
      );
      expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');
      
      // Verify spec was NOT created
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'another-capability', 'spec.md');
      await expect(fs.access(mainSpecPath)).rejects.toThrow();
      
      // Verify change was NOT archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(false);
    });

    it('should produce a blocked plan if change does not exist', async () => {
      await archiveCommand.execute('non-existent-change', { yes: true });

      expect(process.exitCode).toBe(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('source-lstat:')
      );
      expect(console.log).toHaveBeenCalledWith(
        'Aborted. No files were changed.'
      );
    });

    it('should throw error if archive already exists', async () => {
      const changeName = 'duplicate-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Create existing archive with same date
      const date = new Date().toISOString().split('T')[0];
      const archivePath = path.join(tempDir, 'rasen', 'changes', 'archive', `${date}-${changeName}`);
      await fs.mkdir(archivePath, { recursive: true });
      
      // Try to archive
      await expect(
        archiveCommand.execute(changeName, { yes: true })
      ).rejects.toThrow(`Archive '${date}-${changeName}' already exists.`);
    });

    it('should handle changes without tasks.md', async () => {
      const changeName = 'no-tasks-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Execute archive without tasks.md
      await archiveCommand.execute(changeName, { yes: true });
      
      // Should complete without warnings
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('incomplete task(s)')
      );
      
      // Verify change was archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBe(1);
    });

    it('should handle changes without specs', async () => {
      const changeName = 'no-specs-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Execute archive without specs
      await archiveCommand.execute(changeName, { yes: true });
      
      // Should complete without spec updates
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Specs to update')
      );
      
      // Verify change was archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBe(1);
    });

    it('applies a recursively nested capability to the matching canonical path', async () => {
      const changeName = 'nested-spec-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const deltaPath = path.join(
        changeDir,
        'specs',
        'platform',
        'routing',
        'spec.md'
      );
      await fs.mkdir(path.dirname(deltaPath), { recursive: true });
      await fs.writeFile(
        deltaPath,
        [
          '## ADDED Requirements',
          '',
          '### Requirement: Nested routing',
          'The system SHALL support nested routing.',
          '',
          '#### Scenario: Route is resolved',
          '- **WHEN** a nested route is requested',
          '- **THEN** the route is resolved',
        ].join('\n')
      );

      await archiveCommand.execute(changeName, { yes: true });

      const canonicalPath = path.join(
        tempDir,
        'rasen',
        'specs',
        'platform',
        'routing',
        'spec.md'
      );
      await expect(fs.readFile(canonicalPath, 'utf8')).resolves.toContain(
        '### Requirement: Nested routing'
      );
    });

    it('should skip spec updates when --skip-specs flag is used', async () => {
      const changeName = 'skip-specs-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'test-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create spec in change
      const specContent = '# Test Capability Spec\n\nTest content';
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Execute archive with --skip-specs flag and noValidate to skip validation
      await archiveCommand.execute(changeName, { yes: true, skipSpecs: true, noValidate: true });
      
      // Verify skip message was logged
      expect(console.log).toHaveBeenCalledWith(
        'Skipping spec updates (--skip-specs flag provided).'
      );
      
      // Verify spec was NOT copied to main specs
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'test-capability', 'spec.md');
      await expect(fs.access(mainSpecPath)).rejects.toThrow();
      
      // Verify change was still archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBe(1);
      expect(archives[0]).toMatch(new RegExp(`\\d{4}-\\d{2}-\\d{2}-${changeName}`));
    });

    it('should skip validation when commander sets validate to false (--no-validate)', async () => {
      const changeName = 'skip-validation-flag';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'unstable-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });

      const deltaSpec = `# Unstable Capability

## ADDED Requirements

### Requirement: Logging Feature
**ID**: REQ-LOG-001

The system will log all events.

#### Scenario: Event recorded
- **WHEN** an event occurs
- **THEN** it is captured`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaSpec);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1\n');

      const deltaSpy = vi.spyOn(Validator.prototype, 'validateChangeDeltaSpecs');
      const specContentSpy = vi.spyOn(Validator.prototype, 'validateSpecContent');

      try {
        await archiveCommand.execute(changeName, { yes: true, skipSpecs: true, validate: false });

        expect(deltaSpy).not.toHaveBeenCalled();
        expect(specContentSpy).not.toHaveBeenCalled();

        const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
        const archives = await fs.readdir(archiveDir);
        expect(archives.length).toBe(1);
        expect(archives[0]).toMatch(new RegExp(`\\d{4}-\\d{2}-\\d{2}-${changeName}`));
      } finally {
        deltaSpy.mockRestore();
        specContentSpy.mockRestore();
      }
    });

    it('should proceed with archive when user declines spec updates', async () => {
      const { confirm } = await import('@inquirer/prompts');
      const mockConfirm = confirm as unknown as ReturnType<typeof vi.fn>;
      
      const changeName = 'decline-specs-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'test-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });
      
      // Create a valid delta spec in the change.
      const specContent = `# Test Capability Spec

## ADDED Requirements

### Requirement: Test capability
The system SHALL provide a test capability.

#### Scenario: Basic test
- **WHEN** an action occurs
- **THEN** the expected result happens`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      
      // Mock confirm to return false (decline spec updates)
      mockConfirm.mockResolvedValueOnce(false);
      
      // Execute archive without --yes flag
      await archiveCommand.execute(changeName);
      
      // Verify user was prompted about specs
      expect(mockConfirm).toHaveBeenCalledWith({
        message: 'Proceed with spec updates?',
        default: true
      });
      
      // Verify skip message was logged
      expect(console.log).toHaveBeenCalledWith(
        'Skipping spec updates. Proceeding with archive.'
      );
      
      // Verify spec was NOT copied to main specs
      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'test-capability', 'spec.md');
      await expect(fs.access(mainSpecPath)).rejects.toThrow();
      
      // Verify change was still archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBe(1);
      expect(archives[0]).toMatch(new RegExp(`\\d{4}-\\d{2}-\\d{2}-${changeName}`));
    });

    it('should support header trim-only normalization for matching', async () => {
      const changeName = 'normalize-headers';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'alpha');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Create existing main spec with a requirement (no extra trailing spaces)
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'alpha');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# alpha Specification

## Purpose
Alpha purpose.

## Requirements

### Requirement: Important Rule
Some details.`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Change attempts to modify the same requirement but with trailing spaces after the name
      const deltaContent = `# Alpha - Changes

## MODIFIED Requirements

### Requirement: Important Rule   
Updated details.`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      const updated = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(updated).toContain('### Requirement: Important Rule');
      expect(updated).toContain('Updated details.');
    });

    it('should apply operations in order: RENAMED → REMOVED → MODIFIED → ADDED', async () => {
      const changeName = 'apply-order';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'beta');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Main spec with two requirements A and B
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'beta');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# beta Specification

## Purpose
Beta purpose.

## Requirements

### Requirement: A
content A

### Requirement: B
content B`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Rename A->C, Remove B, Modify C, Add D
      const deltaContent = `# Beta - Changes

## RENAMED Requirements
- FROM: \`### Requirement: A\`
- TO: \`### Requirement: C\`

## REMOVED Requirements
### Requirement: B

## MODIFIED Requirements
### Requirement: C
updated C

## ADDED Requirements
### Requirement: D
content D`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      const updated = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(updated).toContain('### Requirement: C');
      expect(updated).toContain('updated C');
      expect(updated).toContain('### Requirement: D');
      expect(updated).not.toContain('### Requirement: A');
      expect(updated).not.toContain('### Requirement: B');
    });

    it('should delete a spec whose requirements are all REMOVED by the delta (zero-requirements deletion)', async () => {
      const changeName = 'zero-req-deletion';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'theta');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Existing main spec with a single requirement
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'theta');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# theta Specification

## Purpose
Theta purpose.

## Requirements

### Requirement: Theta Rule
The system SHALL do theta.

#### Scenario: theta works
- **WHEN** theta
- **THEN** done`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Delta REMOVES the only requirement → the rebuilt spec has zero requirements
      const deltaContent = `# Theta - Changes

## REMOVED Requirements

### Requirement: Theta Rule`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      // Validation is ON (no --no-validate): without the zero-req deletion path
      // this would abort on "Spec must have at least one requirement".
      await archiveCommand.execute(changeName, { yes: true });

      // The spec directory is deleted, not left holding an empty spec.md
      await expect(fs.access(path.join(mainSpecDir, 'spec.md'))).rejects.toThrow();
      await expect(fs.access(mainSpecDir)).rejects.toThrow();

      // A clear log line names the deleted capability
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Deleting spec 'theta' — all requirements removed by this change.")
      );

      // Archive did NOT abort on the emptied spec
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Validation errors in rebuilt spec for theta')
      );
      expect(console.log).not.toHaveBeenCalledWith('Aborted. No files were changed.');

      // The change was archived (the delta moves to archive as usual)
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(true);

      // The post-archive main-specs tree validates strictly — mirrors the delta's
      // "validate --strict SHALL pass afterward": no emptied spec is left to fail min(1).
      const strictValidator = new Validator(true);
      const specsRoot = path.join(tempDir, 'rasen', 'specs');
      for (const entry of await fs.readdir(specsRoot)) {
        const specFile = path.join(specsRoot, entry, 'spec.md');
        try { await fs.access(specFile); } catch { continue; }
        const report = await strictValidator.validateSpec(specFile);
        expect(report.valid).toBe(true);
      }
    });

    it('should NOT delete a spec that still has a surviving requirement (zero-req safety boundary)', async () => {
      const changeName = 'partial-removal-keeps-spec';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'iota');
      await fs.mkdir(changeSpecDir, { recursive: true });

      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'iota');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# iota Specification

## Purpose
Iota purpose.

## Requirements

### Requirement: Keep Me
The system SHALL keep this.

#### Scenario: kept
- **WHEN** x
- **THEN** y

### Requirement: Remove Me
The system SHALL remove this.

#### Scenario: removed
- **WHEN** a
- **THEN** b`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Delta removes ONE of two requirements — the spec survives with one left
      const deltaContent = `# Iota - Changes

## REMOVED Requirements

### Requirement: Remove Me`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      await archiveCommand.execute(changeName, { yes: true });

      // The spec still exists with the surviving requirement
      const updated = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(updated).toContain('### Requirement: Keep Me');
      expect(updated).not.toContain('### Requirement: Remove Me');

      // It was NOT treated as a deletion
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining("Deleting spec 'iota'")
      );

      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(true);
    });

    it('should abort with error when MODIFIED/REMOVED reference non-existent requirements', async () => {
      const changeName = 'validate-missing';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'gamma');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Main spec with no requirements
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'gamma');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# gamma Specification

## Purpose
Gamma purpose.

## Requirements`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Delta tries to modify and remove non-existent requirement
      const deltaContent = `# Gamma - Changes

## MODIFIED Requirements
### Requirement: Missing
new text

## REMOVED Requirements
### Requirement: Another Missing`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      // Should not change the main spec and should not archive the change dir
      const still = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(still).toBe(mainContent);
      // Change dir should still exist since operation aborted
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });

    it('should abort stale MODIFIED blocks that would drop current scenarios (issue #1246)', async () => {
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'stale-modified');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainSpecPath = path.join(mainSpecDir, 'spec.md');
      const baseSpec = `# stale-modified Specification

## Purpose
Stale modified purpose.

## Requirements

### Requirement: Shared Rule
The system SHALL support the shared rule.

#### Scenario: Existing behavior
- **WHEN** the original behavior runs
- **THEN** it succeeds`;
      await fs.writeFile(mainSpecPath, baseSpec);

      const changeA = 'modify-shared-a';
      const changeADir = path.join(tempDir, 'rasen', 'changes', changeA);
      const changeASpecDir = path.join(changeADir, 'specs', 'stale-modified');
      await fs.mkdir(changeASpecDir, { recursive: true });
      await fs.writeFile(path.join(changeASpecDir, 'spec.md'), `# Stale Modified - Change A

## MODIFIED Requirements

### Requirement: Shared Rule
The system SHALL support the shared rule.

#### Scenario: Existing behavior
- **WHEN** the original behavior runs
- **THEN** it succeeds

#### Scenario: Behavior from A
- **WHEN** change A behavior runs
- **THEN** it succeeds`);

      const changeB = 'modify-shared-b';
      const changeBDir = path.join(tempDir, 'rasen', 'changes', changeB);
      const changeBSpecDir = path.join(changeBDir, 'specs', 'stale-modified');
      await fs.mkdir(changeBSpecDir, { recursive: true });
      await fs.writeFile(path.join(changeBSpecDir, 'spec.md'), `# Stale Modified - Change B

## MODIFIED Requirements

### Requirement: Shared Rule
The system SHALL support the shared rule.

#### Scenario: Existing behavior
- **WHEN** the original behavior runs
- **THEN** it succeeds

#### Scenario: Behavior from B
- **WHEN** change B behavior runs
- **THEN** it succeeds`);

      await archiveCommand.execute(changeA, { yes: true, noValidate: true });
      await archiveCommand.execute(changeB, { yes: true, noValidate: true });

      const updated = await fs.readFile(mainSpecPath, 'utf-8');
      expect(updated).toContain('#### Scenario: Existing behavior');
      expect(updated).toContain('#### Scenario: Behavior from A');
      expect(updated).not.toContain('#### Scenario: Behavior from B');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'stale-modified MODIFIED failed for header "### Requirement: Shared Rule" - current spec contains scenario(s) not present in the modified block: "Behavior from A"'
        )
      );
      expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');

      await expect(fs.access(changeBDir)).resolves.not.toThrow();
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeA))).toBe(true);
      expect(archives.some(a => a.includes(changeB))).toBe(false);
    });

    it('should abort with a structural error when target spec hides requirements outside ## Requirements', async () => {
      const changeName = 'hidden-requirement-target';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'delta-target');
      await fs.mkdir(changeSpecDir, { recursive: true });

      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'delta-target');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const malformedMain = `# delta-target Specification

## Purpose
Delta target purpose.

## Requirements

### Requirement: A
The system SHALL do A.

#### Scenario: A works
- **WHEN** foo
- **THEN** bar

## Edge Cases

### Requirement: B
The system SHALL do B.

#### Scenario: B works
- **WHEN** baz
- **THEN** qux`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), malformedMain);

      const deltaContent = `# Delta Target Changes

## MODIFIED Requirements

### Requirement: B
The system SHALL do B differently.

#### Scenario: B changes
- **WHEN** baz changes
- **THEN** qux changes`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('delta-target: target spec is structurally invalid and cannot be updated until fixed:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Requirement header "### Requirement: B" appears outside the main ## Requirements section.')
      );
      expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');

      const still = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(still).toBe(malformedMain);

      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(false);
    });

    it('should require MODIFIED to reference the NEW header when a rename exists (error format)', async () => {
      const changeName = 'rename-modify-new-header';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'delta');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Main spec with Old
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'delta');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# delta Specification

## Purpose
Delta purpose.

## Requirements

### Requirement: Old
old body`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Delta: rename Old->New, but MODIFIED references Old (should abort)
      const badDelta = `# Delta - Changes

## RENAMED Requirements
- FROM: \`### Requirement: Old\`
- TO: \`### Requirement: New\`

## MODIFIED Requirements
### Requirement: Old
new body`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), badDelta);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      const unchanged = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(unchanged).toBe(mainContent);
      // Assert error message format and abort notice
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('delta validation failed')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Aborted. No files were changed.')
      );

      // Fix MODIFIED to reference New (should succeed)
      const goodDelta = `# Delta - Changes

## RENAMED Requirements
- FROM: \`### Requirement: Old\`
- TO: \`### Requirement: New\`

## MODIFIED Requirements
### Requirement: New
new body`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), goodDelta);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });
      const updated = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
      expect(updated).toContain('### Requirement: New');
      expect(updated).toContain('new body');
      expect(updated).not.toContain('### Requirement: Old');
    });

    it('should process multiple specs atomically (any failure aborts all)', async () => {
      const changeName = 'multi-spec-atomic';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const spec1Dir = path.join(changeDir, 'specs', 'epsilon');
      const spec2Dir = path.join(changeDir, 'specs', 'zeta');
      await fs.mkdir(spec1Dir, { recursive: true });
      await fs.mkdir(spec2Dir, { recursive: true });

      // Existing main specs
      const epsilonMain = path.join(tempDir, 'rasen', 'specs', 'epsilon', 'spec.md');
      await fs.mkdir(path.dirname(epsilonMain), { recursive: true });
      await fs.writeFile(epsilonMain, `# epsilon Specification

## Purpose
Epsilon purpose.

## Requirements

### Requirement: E1
e1`);

      const zetaMain = path.join(tempDir, 'rasen', 'specs', 'zeta', 'spec.md');
      await fs.mkdir(path.dirname(zetaMain), { recursive: true });
      await fs.writeFile(zetaMain, `# zeta Specification

## Purpose
Zeta purpose.

## Requirements

### Requirement: Z1
z1`);

      // Delta: epsilon is valid modification; zeta tries to remove non-existent -> should abort both
      await fs.writeFile(path.join(spec1Dir, 'spec.md'), `# Epsilon - Changes

## MODIFIED Requirements
### Requirement: E1
E1 updated`);

      await fs.writeFile(path.join(spec2Dir, 'spec.md'), `# Zeta - Changes

## REMOVED Requirements
### Requirement: Missing`);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      const e1 = await fs.readFile(epsilonMain, 'utf-8');
      const z1 = await fs.readFile(zetaMain, 'utf-8');
      expect(e1).toContain('### Requirement: E1');
      expect(e1).not.toContain('E1 updated');
      expect(z1).toContain('### Requirement: Z1');
      // changeDir should still exist
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });

    it('returns one deterministic blocker for every spec reconciliation failure', async () => {
      const changeName = 'multi-spec-reconciliation-blockers';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const mainSpecsDir = path.join(tempDir, 'rasen', 'specs');
      const capabilities = ['alpha-inventory', 'zeta-inventory'];
      const originalByCapability = new Map<string, string>();

      for (const capability of capabilities) {
        const changeSpecDir = path.join(changeDir, 'specs', capability);
        const mainSpecDir = path.join(mainSpecsDir, capability);
        await fs.mkdir(changeSpecDir, { recursive: true });
        await fs.mkdir(mainSpecDir, { recursive: true });
        const original = [
          `# ${capability}`,
          '',
          '## Purpose',
          'Inventory behavior remains deterministic.',
          '',
          '## Requirements',
          '',
          '### Requirement: Inventory lookup',
          'The system SHALL return inventory.',
          '',
          '#### Scenario: Alpha remains',
          '- **WHEN** inventory is checked',
          '- **THEN** alpha is returned',
          '',
          '#### Scenario: Beta remains',
          '- **WHEN** inventory is checked',
          '- **THEN** beta is returned',
        ].join('\n');
        originalByCapability.set(capability, original);
        await fs.writeFile(path.join(mainSpecDir, 'spec.md'), original);
        await fs.writeFile(
          path.join(changeSpecDir, 'spec.md'),
          [
            '## MODIFIED Requirements',
            '',
            '### Requirement: Inventory lookup',
            'The system SHALL return refreshed inventory.',
            '',
            '#### Scenario: Alpha remains',
            '- **WHEN** inventory is refreshed',
            '- **THEN** updated alpha is returned',
          ].join('\n')
        );
      }
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

      await archiveCommand.execute(changeName, {
        dryRun: true,
        json: true,
        yes: true,
        noValidate: true,
      });

      const preview = JSON.parse(
        vi.mocked(console.log).mock.calls.at(-1)?.[0] as string
      );
      const reconciliationBlockers = preview.archive.plan.blockers.filter(
        (blocker: { operation: string; code?: string }) =>
          blocker.operation === 'spec' &&
          blocker.code === 'spec_modified_scenarios_missing'
      );
      expect(reconciliationBlockers).toHaveLength(2);
      expect(
        reconciliationBlockers.map(
          (blocker: { path: string }) =>
            path.basename(path.dirname(blocker.path))
        )
      ).toEqual(capabilities);
      for (const blocker of reconciliationBlockers) {
        expect(blocker.message).toContain('"Beta remains"');
      }
      for (const capability of capabilities) {
        expect(
          await fs.readFile(path.join(mainSpecsDir, capability, 'spec.md'), 'utf8')
        ).toBe(originalByCapability.get(capability));
      }
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });

    it('should display aggregated totals across multiple specs', async () => {
      const changeName = 'multi-spec-totals';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const spec1Dir = path.join(changeDir, 'specs', 'omega');
      const spec2Dir = path.join(changeDir, 'specs', 'psi');
      await fs.mkdir(spec1Dir, { recursive: true });
      await fs.mkdir(spec2Dir, { recursive: true });

      // Existing main specs
      const omegaMain = path.join(tempDir, 'rasen', 'specs', 'omega', 'spec.md');
      await fs.mkdir(path.dirname(omegaMain), { recursive: true });
      await fs.writeFile(omegaMain, `# omega Specification\n\n## Purpose\nOmega purpose.\n\n## Requirements\n\n### Requirement: O1\no1`);

      const psiMain = path.join(tempDir, 'rasen', 'specs', 'psi', 'spec.md');
      await fs.mkdir(path.dirname(psiMain), { recursive: true });
      await fs.writeFile(psiMain, `# psi Specification\n\n## Purpose\nPsi purpose.\n\n## Requirements\n\n### Requirement: P1\np1`);

      // Deltas: omega add one, psi rename and modify -> totals: +1, ~1, -0, →1
      await fs.writeFile(path.join(spec1Dir, 'spec.md'), `# Omega - Changes\n\n## ADDED Requirements\n\n### Requirement: O2\nnew`);
      await fs.writeFile(path.join(spec2Dir, 'spec.md'), `# Psi - Changes\n\n## RENAMED Requirements\n- FROM: \`### Requirement: P1\`\n- TO: \`### Requirement: P2\`\n\n## MODIFIED Requirements\n### Requirement: P2\nupdated`);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      // Verify aggregated totals line was printed
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Totals: + 1, ~ 1, - 0, → 1')
      );
    });
  });

  describe('exit code on blocked archive (human mode)', () => {
    // Regression for the silent-exit-0 bug: when archive is blocked in
    // human mode it must set a non-zero exit code so scripts/CI can detect
    // the failure, mirroring the JSON-mode behavior.
    it('sets exit code 1 when delta spec validation fails', async () => {
      const changeName = 'exit-delta-fail';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'bad-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Delta spec missing required SHALL/MUST keyword -> validation error
      const specContent = `# Bad Capability - Changes

## ADDED Requirements

### Requirement: Logging Feature

The system will log all events.

#### Scenario: Event recorded
- **WHEN** an event occurs
- **THEN** it is captured`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1\n');

      await archiveCommand.execute(changeName, { yes: true, skipSpecs: true });

      expect(process.exitCode).toBe(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('validation: Archive validation did not pass.')
      );

      // Change must NOT have been archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(false);
    });

    it('sets exit code 1 when spec rebuild fails (MODIFIED on new spec)', async () => {
      const changeName = 'exit-rebuild-fail';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'new-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // MODIFIED on a non-existent target spec aborts the rebuild
      const specContent = `# New Capability - Changes

## ADDED Requirements

### Requirement: New Feature
New feature description.

## MODIFIED Requirements

### Requirement: Existing Feature
Modified content.`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), specContent);

      await archiveCommand.execute(changeName, { yes: true, noValidate: true });

      expect(process.exitCode).toBe(1);
      expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');

      const mainSpecPath = path.join(tempDir, 'rasen', 'specs', 'new-capability', 'spec.md');
      await expect(fs.access(mainSpecPath)).rejects.toThrow();

      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(false);
    });

    it('sets exit code 1 when rebuilt spec fails validateSpecContent', async () => {
      // Spot 3 is defensive: spot 1 (validateChangeDeltaSpecs) already
      // enforces SHALL/MUST/scenario rules on the delta, and buildUpdatedSpec
      // pre-validates target structure, so a real delta almost never reaches
      // this branch. Spy on validateSpecContent (the existing --no-validate
      // test uses the same spy pattern) to force the rebuilt spec invalid
      // while buildUpdatedSpec runs for real — exercising the exit-code fix.
      const changeName = 'exit-rebuilt-validate-fail';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      const changeSpecDir = path.join(changeDir, 'specs', 'rebuilt-capability');
      await fs.mkdir(changeSpecDir, { recursive: true });

      // Existing main spec so MODIFIED targets a real spec and buildUpdatedSpec
      // succeeds (does not throw).
      const mainSpecDir = path.join(tempDir, 'rasen', 'specs', 'rebuilt-capability');
      await fs.mkdir(mainSpecDir, { recursive: true });
      const mainContent = `# rebuilt-capability Specification

## Purpose
Rebuilt capability purpose.

## Requirements

### Requirement: Existing Feature
The system SHALL do the thing.

#### Scenario: works
- **WHEN** x
- **THEN** y`;
      await fs.writeFile(path.join(mainSpecDir, 'spec.md'), mainContent);

      // Valid MODIFIED delta (passes spot 1 delta validation).
      const deltaContent = `# Rebuilt Capability - Changes

## MODIFIED Requirements

### Requirement: Existing Feature
The system SHALL do the thing differently.

#### Scenario: works
- **WHEN** x
- **THEN** z`;
      await fs.writeFile(path.join(changeSpecDir, 'spec.md'), deltaContent);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1\n');

      const specContentSpy = vi
        .spyOn(Validator.prototype, 'validateSpecContent')
        .mockResolvedValue({
          valid: false,
          issues: [
            { level: 'ERROR', path: 'requirements[0]', message: 'mocked rebuilt-spec failure' },
          ],
          summary: { errors: 1, warnings: 0, info: 0 },
        });

      try {
        await archiveCommand.execute(changeName, { yes: true });

        expect(process.exitCode).toBe(1);
        // buildUpdatedSpec ran for real and the spy made its output "invalid"
        expect(specContentSpy).toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Validation errors in rebuilt spec for rebuilt-capability')
        );
        expect(console.log).toHaveBeenCalledWith('Aborted. No files were changed.');

        // Main spec must be unchanged (no writes happened)
        const still = await fs.readFile(path.join(mainSpecDir, 'spec.md'), 'utf-8');
        expect(still).toBe(mainContent);

        // Change must NOT have been archived
        const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
        const archives = await fs.readdir(archiveDir);
        expect(archives.some(a => a.includes(changeName))).toBe(false);
      } finally {
        specContentSpy.mockRestore();
      }
    });

    it('leaves exit code 0 on successful archive (no leak from prior test)', async () => {
      const changeName = 'exit-ok';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });

      await archiveCommand.execute(changeName, { yes: true });

      expect(process.exitCode).toBeUndefined();

      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives.some(a => a.includes(changeName))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should report a blocked plan when the openspec directory does not exist', async () => {
      // Remove openspec directory
      await fs.rm(path.join(tempDir, 'rasen'), { recursive: true });

      await archiveCommand.execute('any-change', { yes: true });

      expect(process.exitCode).toBe(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('source-lstat:')
      );
      expect(console.log).toHaveBeenCalledWith(
        'Aborted. No files were changed.'
      );
    });
  });

  describe('interactive mode', () => {
    it('should use select prompt for change selection', async () => {
      const { select } = await import('@inquirer/prompts');
      const mockSelect = select as unknown as ReturnType<typeof vi.fn>;
      
      // Create test changes
      const change1 = 'feature-a';
      const change2 = 'feature-b';
      await fs.mkdir(path.join(tempDir, 'rasen', 'changes', change1), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'rasen', 'changes', change2), { recursive: true });
      
      // Mock select to return first change
      mockSelect.mockResolvedValueOnce(change1);
      
      // Execute without change name
      await archiveCommand.execute(undefined, { yes: true });
      
      // Verify select was called with correct options (values matter, names may include progress)
      expect(mockSelect).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Select a change to archive',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: change1 }),
          expect.objectContaining({ value: change2 })
        ])
      }));
      
      // Verify the selected change was archived
      const archiveDir = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archives = await fs.readdir(archiveDir);
      expect(archives[0]).toContain(change1);
    });

    it('should use confirm prompt for task warnings', async () => {
      const { confirm } = await import('@inquirer/prompts');
      const mockConfirm = confirm as unknown as ReturnType<typeof vi.fn>;
      
      const changeName = 'incomplete-interactive';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Create tasks.md with incomplete tasks
      const tasksContent = '- [ ] Task 1';
      await fs.writeFile(path.join(changeDir, 'tasks.md'), tasksContent);
      
      // Mock confirm to return true (proceed)
      mockConfirm.mockResolvedValueOnce(true);
      
      // Execute without --yes flag
      await archiveCommand.execute(changeName);
      
      // Verify confirm was called
      expect(mockConfirm).toHaveBeenCalledWith({
        message: 'Warning: 1 incomplete task(s) found. Continue?',
        default: false
      });
    });

    it('should cancel when user declines task warning', async () => {
      const { confirm } = await import('@inquirer/prompts');
      const mockConfirm = confirm as unknown as ReturnType<typeof vi.fn>;
      
      const changeName = 'cancel-test';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      
      // Create tasks.md with incomplete tasks
      const tasksContent = '- [ ] Task 1';
      await fs.writeFile(path.join(changeDir, 'tasks.md'), tasksContent);
      
      // Mock confirm to return false (cancel) for validation skip
      mockConfirm.mockResolvedValueOnce(false);
      // Mock another false for task warning
      mockConfirm.mockResolvedValueOnce(false);
      
      // Execute without --yes flag but skip validation to test task warning
      await archiveCommand.execute(changeName, { noValidate: true });
      
      // Verify archive was cancelled
      expect(console.log).toHaveBeenCalledWith('Archive cancelled.');
      
      // Verify change was not archived
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });
  });

  // The destination axis is retired (`archive-destination` capability):
  // bookkeeping always lands in the planning root, no configuration can
  // redirect it, and nothing is ever deleted or moved to the machine home.
  describe('archive bookkeeping location (destination axis retired)', () => {
    let gitEnvBackup: Record<string, string | undefined>;

    async function writeConfig(content: string): Promise<void> {
      await fs.writeFile(path.join(tempDir, 'rasen', 'config.yaml'), content);
    }

    function setUpGitRepo(): void {
      const env = isolatedGitEnv(tempDir);
      gitEnvBackup = {};
      for (const key of Object.keys(env)) {
        gitEnvBackup[key] = process.env[key];
        process.env[key] = env[key];
      }
      execFileSync('git', ['init'], { cwd: tempDir });
      writeFileSync(path.join(tempDir, '.gitignore'), 'xdg-data/\n');
    }

    function commitAll(message: string): void {
      execFileSync('git', ['add', '-A'], { cwd: tempDir });
      execFileSync('git', ['commit', '-m', message], { cwd: tempDir });
    }

    afterEach(() => {
      if (gitEnvBackup) {
        for (const [key, value] of Object.entries(gitEnvBackup)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    function parseLoggedArchive(): any {
      const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join('\n');
      return JSON.parse(logged);
    }

    async function seedChange(changeName: string): Promise<string> {
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1');
      return changeDir;
    }

    it('a config still carrying destination: external still archives in-repo', async () => {
      await writeConfig('schema: spec-driven\narchive:\n  destination: external\n');
      setUpGitRepo();

      const changeName = 'external-config-feature';
      const changeDir = await seedChange(changeName);
      commitAll('add change');

      await archiveCommand.execute(changeName, { yes: true, json: true });

      const parsed = parseLoggedArchive();
      const inRepoArchive = path.join(tempDir, 'rasen', 'changes', 'archive');
      expect(parsed.archive.path.startsWith(inRepoArchive)).toBe(true);
      expect(parsed.archive.destination).toBeUndefined();
      await expect(fs.access(parsed.archive.path)).resolves.not.toThrow();
      await expect(fs.access(changeDir)).rejects.toThrow();

      // Nothing moved to the machine home, and no identity was minted for it.
      const globalDataDir = process.env.XDG_DATA_HOME!;
      const mintedProjects = await fs
        .access(path.join(globalDataDir, 'rasen', 'projects'))
        .then(() => true)
        .catch(() => false);
      expect(mintedProjects).toBe(false);
    });

    it('a config still carrying destination: prune archives instead of deleting', async () => {
      await writeConfig('schema: spec-driven\narchive:\n  destination: prune\n');
      setUpGitRepo();

      const changeName = 'prune-config-feature';
      const changeDir = await seedChange(changeName);
      commitAll('add change');

      await archiveCommand.execute(changeName, { yes: true, json: true });

      const parsed = parseLoggedArchive();
      // The change is ARCHIVED, not deleted: an archive copy exists.
      expect(parsed.archive.archivedAs).toContain(changeName);
      await expect(fs.access(parsed.archive.path)).resolves.not.toThrow();
      await expect(fs.access(changeDir)).rejects.toThrow();
      expect(parsed.archive.pruned).toBeUndefined();
    });

    it('archives an uncommitted change directory — no destructive-destination precondition remains', async () => {
      await writeConfig('schema: spec-driven\narchive:\n  destination: external\n');
      setUpGitRepo();
      commitAll('initial');

      const changeName = 'uncommitted-feature';
      const changeDir = await seedChange(changeName);
      // Deliberately NOT committed: the retired external/prune paths refused
      // here; the in-repo move never removes the repo's only copy, so there is
      // nothing left to guard.

      await archiveCommand.execute(changeName, { yes: true, json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.status).toBeUndefined();
      await expect(fs.access(parsed.archive.path)).resolves.not.toThrow();
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('default (no archive block) is unchanged: in-repo move', async () => {
      setUpGitRepo();
      commitAll('initial');

      const changeName = 'default-feature';
      const changeDir = await seedChange(changeName);

      await archiveCommand.execute(changeName, { yes: true, json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.archive.path.startsWith(path.join(tempDir, 'rasen', 'changes', 'archive'))).toBe(
        true
      );
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('timing guard refuses on-merge + pr-delivered ship log without --yes', async () => {
      const changeName = 'shipped-pr-feature';
      const changeDir = await seedChange(changeName);
      await fs.writeFile(
        path.join(changeDir, 'ship-log.md'),
        '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/1\n'
      );

      await archiveCommand.execute(changeName, { json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.status[0].code).toBe('archive_merge_confirmation_required');
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });

    it('timing guard reads the ship log from the evidence directory first', async () => {
      const changeName = 'shipped-pr-evidence-feature';
      const changeDir = await seedChange(changeName);
      const evidence = path.join(changeDir, 'evidence');
      await fs.mkdir(evidence, { recursive: true });
      await fs.writeFile(
        path.join(evidence, 'ship-log.md'),
        '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/1\n'
      );

      await archiveCommand.execute(changeName, { json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.status[0].code).toBe('archive_merge_confirmation_required');
      await expect(fs.access(changeDir)).resolves.not.toThrow();
    });

    it('timing guard proceeds with --yes treating it as the merge confirmation', async () => {
      const changeName = 'shipped-pr-feature-yes';
      const changeDir = await seedChange(changeName);
      await fs.writeFile(
        path.join(changeDir, 'ship-log.md'),
        '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/1\n'
      );

      await archiveCommand.execute(changeName, { yes: true, json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.archive.archivedAs).toContain(changeName);
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('saved on-merge plan accepts --yes only when applying the exact token', async () => {
      const changeName = 'shipped-pr-saved-plan';
      const changeDir = await seedChange(changeName);
      await fs.writeFile(
        path.join(changeDir, 'ship-log.md'),
        '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/1\n'
      );

      await archiveCommand.execute(changeName, {
        dryRun: true,
        savePlan: true,
        json: true,
      });
      const preview = parseLoggedArchive();
      expect(preview.archive.plan.complete).toBe(false);
      expect(preview.archive.plan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'archive_merge_confirmation_required',
            operation: 'timing',
          }),
        ])
      );

      class PreciseRecoveryCommand extends ArchiveCommand {
        protected override applyPlannedArchive(
          plan: ArchivePlan
        ): Promise<ArchiveApplyResult> {
          return Promise.resolve({
            status: 'blocked',
            transactionId: plan.transactionId,
            planHash: plan.planHash,
            change: plan.change,
            path: plan.paths.final,
            journalPath: plan.paths.journal,
            resumed: false,
            specsUpdated: false,
            totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
            ephemeraDiscarded: [],
            ephemeraPreserved: plan.cleaner.effectivePreserve,
            blockers: [
              {
                operation: 'timing',
                path: plan.paths.active,
                message: 'Injected retry disposition.',
              },
            ],
            recoveryCommand:
              `rasen archive --apply-plan ${preview.archive.planToken}` +
              ' --yes --json',
          });
        }
      }
      await new PreciseRecoveryCommand().execute(undefined, {
        applyPlan: preview.archive.planToken,
      });
      expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
        `rasen archive --apply-plan ${preview.archive.planToken} --yes --json`
      );

      vi.mocked(console.log).mockClear();
      await archiveCommand.execute(undefined, {
        applyPlan: preview.archive.planToken,
        yes: true,
        json: true,
      });

      const applied = parseLoggedArchive();
      expect(applied.archive.result.status).toBe('complete');
      expect(applied.archive.result.planHash).toBe(preview.archive.plan.planHash);
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('timing guard does not fire for a push-mode ship log', async () => {
      const changeName = 'shipped-push-feature';
      const changeDir = await seedChange(changeName);
      await fs.writeFile(path.join(changeDir, 'ship-log.md'), '# Ship Log\n\n**Mode:** push\n');

      await archiveCommand.execute(changeName, { json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.archive.archivedAs).toContain(changeName);
      await expect(fs.access(changeDir)).rejects.toThrow();
    });

    it('timing guard does not fire under in-ship timing even for a pr-mode ship log', async () => {
      await writeConfig('schema: spec-driven\narchive:\n  timing: in-ship\n');

      const changeName = 'inship-pr-feature';
      const changeDir = await seedChange(changeName);
      await fs.writeFile(
        path.join(changeDir, 'ship-log.md'),
        '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/1\n'
      );

      await archiveCommand.execute(changeName, { json: true });

      const parsed = parseLoggedArchive();
      expect(parsed.archive.archivedAs).toContain(changeName);
      await expect(fs.access(changeDir)).rejects.toThrow();
    });
  });

  describe('quality capture and retention (archive no longer codifies)', () => {
    async function archivedDir(): Promise<string> {
      const archiveRoot = path.join(tempDir, 'rasen', 'changes', 'archive');
      const entries = await fs.readdir(archiveRoot);
      expect(entries).toHaveLength(1);
      return path.join(archiveRoot, entries[0]);
    }

    it('preserves existing quality-rules byte-for-byte and never appends [RULE] markers', async () => {
      const configPath = path.join(tempDir, 'rasen', 'config.yaml');
      const configBefore = 'schema: spec-driven\nquality-rules:\n  - Always run the locale sweep\n';
      await fs.writeFile(configPath, configBefore);

      const changeName = 'rule-marker-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1');
      await fs.writeFile(
        path.join(changeDir, 'code-review.md'),
        '# Review\n\nFindings: 2\n[RULE] Prefer path.join over string concat\n[RULE] Add a regression test\n'
      );

      await archiveCommand.execute(changeName, { yes: true });

      // The project config is untouched — no rule appended, no reordering.
      expect(await fs.readFile(configPath, 'utf-8')).toBe(configBefore);

      // The [RULE] lines survive as ordinary archived artifact content.
      const archived = await archivedDir();
      const reviewText = await fs.readFile(path.join(archived, 'code-review.md'), 'utf-8');
      expect(reviewText).toContain('[RULE] Prefer path.join over string concat');

      // Quality summary is captured, but no extracted-rule count is reported.
      const meta = await fs.readFile(path.join(archived, '.openspec.yaml'), 'utf-8');
      expect(meta).toContain('quality:');
      expect(meta).toContain('code-review.md');
      expect(meta).not.toContain('rulesExtracted');
    });

    it('does not create a quality-rules key when the project has none', async () => {
      const configPath = path.join(tempDir, 'rasen', 'config.yaml');
      await fs.writeFile(configPath, 'schema: spec-driven\n');

      const changeName = 'no-rules-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1');
      await fs.writeFile(
        path.join(changeDir, 'security-audit.md'),
        '# Audit\n\nIssues: 1\n[RULE] Validate untrusted input at the boundary\n'
      );

      await archiveCommand.execute(changeName, { yes: true });

      expect(await fs.readFile(configPath, 'utf-8')).not.toContain('quality-rules');
    });

    it('does not report an extracted-rule count in its summary output', async () => {
      const changeName = 'summary-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1');
      await fs.writeFile(path.join(changeDir, 'qa-report.md'), '# Report\n\nScenarios: 3\n[RULE] X\n');

      await archiveCommand.execute(changeName, { yes: true });

      const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(logged).not.toContain('Rules extracted');
      expect(logged).not.toMatch(/quality rule\(s\) to config/);
    });

    it('archives a report-mode retro.md as ordinary change content', async () => {
      const changeName = 'report-mode-feature';
      const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Task 1');
      // report mode writes retro.md before archive begins.
      await fs.writeFile(path.join(changeDir, 'retro.md'), '# Retrospective\n\nWhat went well.\n');

      await archiveCommand.execute(changeName, { yes: true });

      const archived = await archivedDir();
      expect(await fs.readFile(path.join(archived, 'retro.md'), 'utf-8')).toContain('Retrospective');
      // The original change dir is gone (retro.md moved with the rest).
      await expect(fs.access(path.join(changeDir, 'retro.md'))).rejects.toThrow();
    });
  });
});
