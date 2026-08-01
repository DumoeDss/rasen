import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverChangeDirs,
  scanMachineHomeWorkDir,
  countMigratableEphemera,
  applyWorkMigration,
  archiveNameMatches,
  defaultWorkMigrationFileSystem,
  isPathWithin,
  pathsEqualForPlatform,
  freezeWorkMigrationRootContext,
  planWorkMigration,
  runWorkMigration,
  RUN_ARTIFACT_CAVEAT_NOTE,
  type WorkMigrationFileSystem,
  type WorkMigrationRootContext,
} from '../../src/core/work-migration.js';
import { resolveProjectHome } from '../../src/core/project-home.js';

function injectedFileSystem(
  overrides: Partial<WorkMigrationFileSystem> = {}
): WorkMigrationFileSystem {
  return { ...defaultWorkMigrationFileSystem, ...overrides };
}

function fsError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function hashTree(root: string): string {
  const hash = createHash('sha256');
  function walk(target: string, prefix: string): void {
    for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const absolute = path.join(target, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(relative);
      hash.update('\0');
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        hash.update(fs.readFileSync(absolute));
        hash.update('\0');
      }
    }
  }
  walk(root, '');
  return hash.digest('hex');
}

/**
 * Tests for the inverted migrator (design D6/D7): legacy machine-home state →
 * terminal file-placement locations. Reports → evidence, handoff → handoff dir,
 * run-state → ephemera (archived: discard + list), probe dirs reclassified
 * one-by-one, design-docs → planning root. Never-overwrite on conflict.
 */
describe('work-migration (inverted)', () => {
  let projectRoot: string;
  let changesDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-mig-'));
    changesDir = path.join(projectRoot, 'rasen', 'changes');
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-mig-gdd-'));
    fs.mkdirSync(changesDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  /** Pre-registers machine identity for tests focused on move mechanics. */
  async function mintIdentity(): Promise<void> {
    const home = await resolveProjectHome(projectRoot, { ensure: true, globalDataDir });
    if (home) homeDir = home.homeDir;
  }

  /** Cached home directory (set in beforeEach after mintIdentity). */
  let homeDir: string;

  /** Gets the machine-home work directory for a change. */
  function workDirFor(changeName: string): string {
    return path.join(homeDir, 'changes', changeName, 'work');
  }

  /** Creates an active change directory in-repo. */
  function makeActiveChange(name: string): string {
    const dir = path.join(changesDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  /** Creates an archived change directory in-repo. */
  function makeArchivedChange(dirName: string): string {
    const dir = path.join(changesDir, 'archive', dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  /** Writes a file under the machine-home work directory. */
  function writeWorkFile(changeName: string, relativePath: string, content = 'content'): string {
    const dir = workDirFor(changeName);
    const abs = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  }

  // -------------------------------------------------------------------
  // Scanner (machine-home work directory)
  // -------------------------------------------------------------------

  describe('scanMachineHomeWorkDir', () => {
    it('classifies reports, handoff, and run-state correctly', async () => {
      const dir = path.join(globalDataDir, 'test-scan');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'review-report.md'), 'r');
      fs.writeFileSync(path.join(dir, 'ship-log.md'), 's');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      fs.writeFileSync(path.join(dir, 'proposal.md'), '# p');
      fs.mkdirSync(path.join(dir, 'handoff'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'handoff', 'implementer-1.md'), 'h');

      const { candidates, notes } = await scanMachineHomeWorkDir(dir);

      const kinds = candidates.map((c) => c.kind).sort();
      expect(kinds).toEqual(['handoff', 'report', 'report', 'run-state']);

      // proposal.md is review material — never moved, only noted.
      expect(notes.some((n) => n.includes('proposal.md'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // discoverChangeDirs
  // -------------------------------------------------------------------

  describe('discoverChangeDirs', () => {
    it('finds active and archived change directories', async () => {
      makeActiveChange('foo');
      makeArchivedChange('2026-01-01-bar');

      const discovered = await discoverChangeDirs(changesDir);
      expect(discovered).toHaveLength(2);
      expect(discovered.find((d) => d.name === 'foo')?.archived).toBe(false);
      expect(discovered.find((d) => d.name === '2026-01-01-bar')?.archived).toBe(true);
    });

    it('scopes by change name', async () => {
      makeActiveChange('foo');
      makeActiveChange('baz');
      makeArchivedChange('2026-01-01-foo');

      const discovered = await discoverChangeDirs(changesDir, { changeName: 'foo' });
      expect(discovered).toHaveLength(2); // active foo + archived 2026-01-01-foo
    });
  });

  // -----------------------------------------------------------------
  // runWorkMigration — the core flow
  // -----------------------------------------------------------------

  describe('runWorkMigration', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    it('moves old workDir reports to evidence for active changes', async () => {
      const changeName = 'active-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'review-report.md', '# Review\n');
      writeWorkFile(changeName, 'ship-log.md', '# Ship\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const change = result.report.changes.find((c) => c.change === changeName);
      expect(change).toBeDefined();
      const moved = change!.files.filter((f) => f.status === 'moved');
      expect(moved).toHaveLength(2);

      // Files landed in evidence.
      const evidencePath = path.join(changesDir, changeName, 'evidence');
      expect(fs.existsSync(path.join(evidencePath, 'review-report.md'))).toBe(true);
      expect(fs.existsSync(path.join(evidencePath, 'ship-log.md'))).toBe(true);
    });

    it('moves old workDir handoff to the terminal handoff directory', async () => {
      const changeName = 'handoff-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'handoff/implementer-1.md', '# Handoff\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const handoffPath = path.join(changesDir, changeName, 'handoff', 'implementer-1.md');
      expect(fs.existsSync(handoffPath)).toBe(true);
    });

    it('moves old workDir run-state to ephemera for active changes', async () => {
      const changeName = 'runstate-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'auto-run.json', '{"state":"done"}');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      // Run-state landed in the execution root's ephemera area.
      const ephemeraPath = path.join(
        projectRoot,
        '.rasen',
        'changes',
        changeName,
        'ephemera',
        'auto-run.json'
      );
      expect(fs.existsSync(ephemeraPath)).toBe(true);

      // The work directory no longer has it.
      expect(fs.existsSync(workDirFor(changeName) + '/auto-run.json')).toBe(false);
    });

    it('discards archived change run-state and lists it', async () => {
      const archivedName = '2026-01-01-old-feature';
      makeArchivedChange(archivedName);

      // Write run-state in the archived work directory.
      const archWorkDir = path.join(homeDir, 'changes', 'archive', archivedName, 'work');
      fs.mkdirSync(archWorkDir, { recursive: true });
      fs.writeFileSync(path.join(archWorkDir, 'auto-run.json'), '{}');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const change = result.report.changes.find((c) => c.change === archivedName);
      expect(change).toBeDefined();
      const discarded = change!.files.filter((f) => f.status === 'discarded');
      expect(discarded).toHaveLength(1);
      expect(discarded[0].relativePath).toBe('auto-run.json');
    });

    it('never overwrites on conflict — keeps both copies', async () => {
      const changeName = 'conflict-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'review-report.md', '# Legacy Review\n');

      // Pre-create the destination file.
      const evidenceDir = path.join(changesDir, changeName, 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'review-report.md'), '# Existing Review\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const change = result.report.changes.find((c) => c.change === changeName);
      const conflict = change!.files.find((f) => f.status === 'conflict');
      expect(conflict).toBeDefined();
      expect(conflict!.relativePath).toBe('review-report.md');

      // Both copies exist: the legacy source and the existing destination.
      expect(fs.existsSync(path.join(workDirFor(changeName), 'review-report.md'))).toBe(true);
      const existingContent = fs.readFileSync(
        path.join(evidenceDir, 'review-report.md'),
        'utf-8'
      );
      expect(existingContent).toBe('# Existing Review\n');
    });

    it('dry-run moves nothing', async () => {
      const changeName = 'dryrun-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'review-report.md', '# Review\n');
      writeWorkFile(changeName, 'auto-run.json', '{}');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });
      if (!result.ok) return;

      // All files are 'planned', nothing moved.
      const change = result.report.changes.find((c) => c.change === changeName);
      const planned = change!.files.filter((f) => f.status === 'planned');
      expect(planned).toHaveLength(2);

      // Files still in the work directory.
      expect(fs.existsSync(path.join(workDirFor(changeName), 'review-report.md'))).toBe(true);
      expect(fs.existsSync(path.join(workDirFor(changeName), 'auto-run.json'))).toBe(true);

      // No destination files created.
      expect(fs.existsSync(path.join(changesDir, changeName, 'evidence', 'review-report.md'))).toBe(false);
    });

    it('re-run is a no-op (idempotent)', async () => {
      const changeName = 'idempotent-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'review-report.md', '# Review\n');

      // First run: moves the file.
      await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      expect(fs.existsSync(path.join(changesDir, changeName, 'evidence', 'review-report.md'))).toBe(true);

      // Second run: nothing left to move.
      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;
      const change = result.report.changes.find((c) => c.change === changeName);
      expect(change!.files).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------
  // Probe directory reclassification (M4 — task 5.7 missing cases)
  // -----------------------------------------------------------------

  describe('probe directory reclassification', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    /** Creates a probe directory under the machine home. */
    function makeProbeDir(name: string): string {
      const probeBase = path.join(homeDir, 'probe');
      const dir = path.join(probeBase, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    it('classifies driver-harness probe dirs and moves them to the execution root', async () => {
      const driverDir = makeProbeDir('kc1-driver');
      fs.writeFileSync(path.join(driverDir, 'run-probe.sh'), '#!/bin/bash\n');
      fs.writeFileSync(path.join(driverDir, 'probe.js'), 'console.log("hi")\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const probe = result.report.probeDirs.find((p) => p.dirName === 'kc1-driver');
      expect(probe).toBeDefined();
      expect(probe!.classification).toBe('driver-harness');
      expect(probe!.status).toBe('moved');

      // Directory moved to execution root's .rasen/probes/
      const dest = path.join(projectRoot, '.rasen', 'probes', 'kc1-driver');
      expect(fs.existsSync(path.join(dest, 'run-probe.sh'))).toBe(true);
      expect(fs.existsSync(path.join(dest, 'probe.js'))).toBe(true);
      // Source is gone.
      expect(fs.existsSync(driverDir)).toBe(false);
    });

    it('classifies sampling-output probe dirs and moves them to ephemera', async () => {
      const dataDir = makeProbeDir('kc1-sampling');
      fs.writeFileSync(path.join(dataDir, 'results.json'), '{"data":1}');
      fs.writeFileSync(path.join(dataDir, 'trace.log'), 'trace\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const probe = result.report.probeDirs.find((p) => p.dirName === 'kc1-sampling');
      expect(probe).toBeDefined();
      expect(probe!.classification).toBe('sampling-output');
      expect(probe!.status).toBe('moved');
      expect(fs.existsSync(dataDir)).toBe(false);
    });

    it('PRESERVES conclusions directories by default (M3 fix — never deletes)', async () => {
      const conclDir = makeProbeDir('research-notes');
      fs.writeFileSync(path.join(conclDir, 'analysis.md'), '# Analysis\n');
      fs.writeFileSync(path.join(conclDir, 'summary.md'), '# Summary\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const probe = result.report.probeDirs.find((p) => p.dirName === 'research-notes');
      expect(probe).toBeDefined();
      expect(probe!.classification).toBe('conclusions');
      expect(probe!.action).toBe('leave');
      expect(probe!.status).toBe('planned'); // preserved, not moved/deleted

      // Directory is untouched on disk.
      expect(fs.existsSync(conclDir)).toBe(true);
      expect(fs.existsSync(path.join(conclDir, 'analysis.md'))).toBe(true);
    });

    it('--discard-absorbed-conclusions deletes conclusions only when the flag is set', async () => {
      const conclDir = makeProbeDir('old-conclusions');
      fs.writeFileSync(path.join(conclDir, 'notes.md'), '# Notes\n');

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: true,
        globalDataDir,
        discardAbsorbedConclusions: true,
      });
      if (!result.ok) return;

      const probe = result.report.probeDirs.find((p) => p.dirName === 'old-conclusions');
      expect(probe).toBeDefined();
      expect(probe!.classification).toBe('conclusions');
      expect(probe!.action).toBe('discard');
      expect(probe!.status).toBe('discarded');

      // Directory is deleted.
      expect(fs.existsSync(conclDir)).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // Design-docs migration (M4 — task 5.7 missing case)
  // -----------------------------------------------------------------

  describe('design-docs migration', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    it('moves design-docs from machine home to the planning root', async () => {
      const sourceDesignDocs = path.join(homeDir, 'design-docs');
      fs.mkdirSync(path.join(sourceDesignDocs, 'decisions'), { recursive: true });
      fs.writeFileSync(path.join(sourceDesignDocs, 'architecture.md'), '# Architecture\n');
      fs.writeFileSync(path.join(sourceDesignDocs, 'decisions', 'adr-001.md'), '# ADR 1\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const designDoc = result.report.designDocs.find((d) => d.source.endsWith('architecture.md'));
      expect(designDoc).toBeDefined();
      expect(designDoc!.status).toBe('moved');

      // Files landed in the planning root's rasen/design-docs/.
      const destDesignDocs = path.join(projectRoot, 'rasen', 'design-docs');
      expect(fs.existsSync(path.join(destDesignDocs, 'architecture.md'))).toBe(true);
      expect(fs.existsSync(path.join(destDesignDocs, 'decisions', 'adr-001.md'))).toBe(true);
    });

    it('keeps both copies on conflict (never-overwrite)', async () => {
      const sourceDesignDocs = path.join(homeDir, 'design-docs');
      fs.mkdirSync(sourceDesignDocs, { recursive: true });
      fs.writeFileSync(path.join(sourceDesignDocs, 'existing.md'), '# Legacy\n');

      // Pre-create the destination.
      const destDesignDocs = path.join(projectRoot, 'rasen', 'design-docs');
      fs.mkdirSync(destDesignDocs, { recursive: true });
      fs.writeFileSync(path.join(destDesignDocs, 'existing.md'), '# Terminal\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      if (!result.ok) return;

      const conflict = result.report.designDocs.find((d) => d.status === 'conflict');
      expect(conflict).toBeDefined();
      // Both copies exist.
      expect(fs.existsSync(path.join(sourceDesignDocs, 'existing.md'))).toBe(true);
      expect(fs.readFileSync(path.join(destDesignDocs, 'existing.md'), 'utf-8')).toBe('# Terminal\n');
    });
  });

  // -----------------------------------------------------------------
  // findProjectRegistryEntry fallback (M4 additional)
  // -----------------------------------------------------------------

  describe('findProjectRegistryEntry fallback (registered but not ensured)', () => {
    it('preview resolves the home via registry when config.yaml lacks projectId', async () => {
      // Register via registerProject (registry only, no config.yaml write).
      const { registerProject, getProjectHomeDir } = await import('../../src/core/project-registry.js');
      const { entry } = await registerProject(
        { projectRoot, projectId: 'test-uuid-fallback', mode: 'in-repo' },
        { globalDataDir }
      );
      const regHomeDir = getProjectHomeDir(entry.home, { globalDataDir });
      const workDir = path.join(regHomeDir, 'changes', 'preview-fallback', 'work');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');
      makeActiveChange('preview-fallback');

      // Preview (execute: false) — should resolve via registry fallback.
      const result = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });
      if (!result.ok) return;

      const change = result.report.changes.find((c) => c.change === 'preview-fallback');
      expect(change).toBeDefined();
      expect(change!.files.length).toBe(1);
      expect(change!.files[0].kind).toBe('run-state');
    });
  });

  // -----------------------------------------------------------------
  // countMigratableEphemera (doctor hint)
  // -----------------------------------------------------------------

  describe('countMigratableEphemera', () => {
    it('counts by file type across machine-home work directories', async () => {
      await mintIdentity();
      const changeName = 'count-feature';
      makeActiveChange(changeName);
      writeWorkFile(changeName, 'review-report.md', 'r');
      writeWorkFile(changeName, 'ship-log.md', 's');
      writeWorkFile(changeName, 'auto-run.json', '{}');
      writeWorkFile(changeName, 'handoff/implementer-1.md', 'h');

      const counts = await countMigratableEphemera(projectRoot, changesDir, { globalDataDir });
      expect(counts.unavailable).toBe(false);
      expect(counts.reports).toBe(2);
      expect(counts.handoff).toBe(1);
      expect(counts.runState).toBe(1);
      expect(counts.total).toBe(4);
    });

    it('returns unavailable=true for unregistered projects', async () => {
      const counts = await countMigratableEphemera(projectRoot, changesDir, { globalDataDir });
      expect(counts.unavailable).toBe(true);
      expect(counts.total).toBe(0);
    });
  });

  describe('immutable plan and scoped ownership', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    it('adds a frozen in-repo root context while preserving compatibility aliases', async () => {
      makeActiveChange('foo');
      const rootContext = freezeWorkMigrationRootContext({
        planningRoot: projectRoot,
        changesDir,
        executionRoot: projectRoot,
        legacyHomeOwnerRoot: projectRoot,
        pathIdentityFlavor: 'posix',
      });

      const plan = await planWorkMigration(rootContext, { globalDataDir });

      expect(Object.isFrozen(rootContext)).toBe(true);
      expect(plan.rootContext).toBe(rootContext);
      expect(plan.projectRoot).toBe(rootContext.planningRoot);
      expect(plan.changesDir).toBe(rootContext.changesDir);
      expect(plan.executionRoot).toBe(rootContext.executionRoot);
    });

    it('routes Store planning, exact execution, and legacy-home ownership independently', async () => {
      const planningRoot = path.join(projectRoot, 'store-planning');
      const planningChanges = path.join(planningRoot, 'rasen', 'changes');
      const changeDir = path.join(planningChanges, 'foo');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# proposal\n');

      const executionRoot = path.join(projectRoot, 'member-worktree');
      fs.mkdirSync(executionRoot, { recursive: true });
      const legacyHomeOwnerRoot = path.join(projectRoot, 'legacy-home-owner');
      fs.mkdirSync(path.join(legacyHomeOwnerRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(legacyHomeOwnerRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      const legacyHome = await resolveProjectHome(legacyHomeOwnerRoot, {
        ensure: true,
        globalDataDir,
      });
      expect(legacyHome).not.toBeNull();
      const source = path.join(legacyHome!.workDir('foo'), 'auto-run.json');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, '{}');

      const rootContext: WorkMigrationRootContext = {
        planningRoot,
        changesDir: planningChanges,
        executionRoot,
        legacyHomeOwnerRoot,
        pathIdentityFlavor: 'posix',
      };
      const plan = await planWorkMigration(rootContext, { globalDataDir });

      expect(plan.rootContext).toEqual(rootContext);
      expect(plan.discoveredChanges.map(change => change.changeDir)).toEqual([changeDir]);
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]).toMatchObject({
        source,
        destination: path.join(
          executionRoot,
          '.rasen',
          'changes',
          'foo',
          'ephemera',
          'auto-run.json'
        ),
      });
      expect(plan.actions[0].destination).not.toContain(planningRoot + path.sep + '.rasen');
    });

    it.each<WorkMigrationRootContext['pathIdentityFlavor']>(['win32', 'posix'])(
      'uses the explicit %s identity flavor from the root context',
      async pathIdentityFlavor => {
        makeActiveChange('Foo');
        writeWorkFile('Foo', 'review-report.md', 'report');
        const rootContext: WorkMigrationRootContext = {
          planningRoot: projectRoot,
          changesDir,
          executionRoot: projectRoot,
          legacyHomeOwnerRoot: projectRoot,
          pathIdentityFlavor,
        };

        const plan = await planWorkMigration(rootContext, {
          changeName: 'foo',
          globalDataDir,
        });

        expect(plan.discoveredChanges.map(change => change.name)).toEqual(
          pathIdentityFlavor === 'win32' ? ['Foo'] : []
        );
      }
    );

    it('uses byte-identical ordered actions for preview and apply', async () => {
      makeActiveChange('foo');
      writeWorkFile('foo', 'review-report.md', 'report');
      const driver = path.join(homeDir, 'probe', 'driver');
      fs.mkdirSync(driver, { recursive: true });
      fs.writeFileSync(path.join(driver, 'run.ts'), 'export {}');
      const conclusions = path.join(homeDir, 'probe', 'conclusions');
      fs.mkdirSync(conclusions, { recursive: true });
      fs.writeFileSync(path.join(conclusions, 'notes.md'), '# notes');

      const plan = await planWorkMigration(projectRoot, changesDir, {
        globalDataDir,
        discardAbsorbedConclusions: true,
      });
      const serialized = JSON.stringify(plan.actions);
      expect(plan.actions.map(action => action.action)).toEqual([
        'move-file',
        'discard-directory',
        'move-directory',
      ]);

      const applied = await applyWorkMigration(plan);
      expect(applied.applied).toBe(true);
      expect(JSON.stringify(plan.actions)).toBe(serialized);
      expect(applied.outcomes.map(record => record.status)).toEqual([
        'moved',
        'discarded',
        'moved',
      ]);
    });

    it('never rewrites a planned leave into a discard during apply', async () => {
      const conclusions = path.join(homeDir, 'probe', 'research-notes');
      fs.mkdirSync(conclusions, { recursive: true });
      fs.writeFileSync(path.join(conclusions, 'notes.md'), '# notes');

      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const leave = plan.actions.find(action => action.source === conclusions);
      expect(leave?.action).toBe('leave');

      const applied = await applyWorkMigration(plan);
      expect(applied.outcomes.find(record => record.actionId === leave?.id)?.status).toBe('left');
      expect(fs.readFileSync(path.join(conclusions, 'notes.md'), 'utf8')).toBe('# notes');
      expect(leave?.action).toBe('leave');
    });

    it('--change includes only exact active/archive ownership and omits all globals', async () => {
      makeActiveChange('foo');
      makeActiveChange('bar');
      makeArchivedChange('2026-04-05-foo');
      makeArchivedChange('2026-04-05-Foo');
      writeWorkFile('foo', 'review-report.md', 'foo');
      writeWorkFile('bar', 'review-report.md', 'bar');
      const archivedWork = path.join(
        homeDir,
        'changes',
        'archive',
        '2026-04-05-foo',
        'work'
      );
      fs.mkdirSync(archivedWork, { recursive: true });
      fs.writeFileSync(path.join(archivedWork, 'auto-run.json'), '{}');
      const probe = path.join(homeDir, 'probe', 'foo-looking-global');
      fs.mkdirSync(probe, { recursive: true });
      fs.writeFileSync(path.join(probe, 'run.ts'), 'global');
      const docs = path.join(homeDir, 'design-docs');
      fs.mkdirSync(docs, { recursive: true });
      fs.writeFileSync(path.join(docs, 'foo.md'), 'global-doc');

      const plan = await planWorkMigration(projectRoot, changesDir, {
        changeName: 'foo',
        globalDataDir,
        discardAbsorbedConclusions: true,
      });
      expect(plan.actions.every(action => action.phase === 'change-work')).toBe(true);
      expect(plan.actions.map(action => action.owner)).toEqual(['foo', '2026-04-05-foo']);

      await applyWorkMigration(plan);
      expect(fs.readFileSync(path.join(workDirFor('bar'), 'review-report.md'), 'utf8')).toBe('bar');
      expect(fs.readFileSync(path.join(probe, 'run.ts'), 'utf8')).toBe('global');
      expect(fs.readFileSync(path.join(docs, 'foo.md'), 'utf8')).toBe('global-doc');

      const unscoped = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      expect(unscoped.actions.some(action => action.phase === 'probe')).toBe(true);
      expect(unscoped.actions.some(action => action.phase === 'design-doc')).toBe(true);
    });

    it('prunes specs subtrees and preserves nested report-shaped files byte-for-byte', async () => {
      makeActiveChange('foo');
      writeWorkFile('foo', 'review-report.md', 'migrate-me');
      const specsRoot = path.join(workDirFor('foo'), 'specs');
      writeWorkFile('foo', 'specs/example/review-report.md', 'spec-review');
      writeWorkFile('foo', 'specs/example/nested/ship-log.md', 'spec-ship');
      const before = hashTree(specsRoot);

      const plan = await planWorkMigration(projectRoot, changesDir, {
        changeName: 'foo',
        globalDataDir,
      });
      expect(
        plan.actions.some(action => isPathWithin(specsRoot, action.source))
      ).toBe(false);
      expect(plan.changeNotes.foo).toContain('Review-material subtree left in place: specs/');

      const applied = await applyWorkMigration(plan);
      expect(applied.outcomes.map(outcome => outcome.status)).toEqual(['moved']);
      expect(hashTree(specsRoot)).toBe(before);
      expect(
        fs.readFileSync(path.join(specsRoot, 'example', 'review-report.md'), 'utf8')
      ).toBe('spec-review');
      expect(
        fs.readFileSync(path.join(specsRoot, 'example', 'nested', 'ship-log.md'), 'utf8')
      ).toBe('spec-ship');
    });

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'filters unrelated active ownership before injected %s lstat',
      async code => {
        makeActiveChange('foo');
        makeActiveChange('bar');
        const fooSource = writeWorkFile('foo', 'review-report.md', 'foo');
        const barSource = writeWorkFile('bar', 'review-report.md', 'bar');
        const unrelated = path.join(changesDir, 'bar');
        const injected = injectedFileSystem({
          lstat: target =>
            target === unrelated
              ? Promise.reject(fsError(code, `unrelated active ${code}`))
              : defaultWorkMigrationFileSystem.lstat(target),
        });

        const plan = await planWorkMigration(projectRoot, changesDir, {
          changeName: 'foo',
          globalDataDir,
          fileSystem: injected,
        });
        expect(plan.complete).toBe(true);
        expect(plan.blockers).toEqual([]);
        expect(plan.discoveredChanges.map(change => change.name)).toEqual(['foo']);
        expect((await applyWorkMigration(plan, { fileSystem: injected })).outcomes).toEqual([
          expect.objectContaining({ status: 'moved', source: fooSource }),
        ]);
        expect(fs.readFileSync(barSource, 'utf8')).toBe('bar');
      }
    );

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'filters unrelated date-prefixed archive ownership before injected %s lstat',
      async code => {
        const fooArchive = '2026-04-05-foo';
        const barArchive = '2026-04-05-bar';
        makeArchivedChange(fooArchive);
        makeArchivedChange(barArchive);
        const fooSource = path.join(
          homeDir,
          'changes',
          'archive',
          fooArchive,
          'work',
          'auto-run.json'
        );
        const barSource = path.join(
          homeDir,
          'changes',
          'archive',
          barArchive,
          'work',
          'auto-run.json'
        );
        fs.mkdirSync(path.dirname(fooSource), { recursive: true });
        fs.mkdirSync(path.dirname(barSource), { recursive: true });
        fs.writeFileSync(fooSource, '{"foo":true}');
        fs.writeFileSync(barSource, '{"bar":true}');
        const unrelated = path.join(changesDir, 'archive', barArchive);
        const injected = injectedFileSystem({
          lstat: target =>
            target === unrelated
              ? Promise.reject(fsError(code, `unrelated archive ${code}`))
              : defaultWorkMigrationFileSystem.lstat(target),
        });

        const plan = await planWorkMigration(projectRoot, changesDir, {
          changeName: 'foo',
          globalDataDir,
          fileSystem: injected,
        });
        expect(plan.complete).toBe(true);
        expect(plan.blockers).toEqual([]);
        expect(plan.discoveredChanges.map(change => change.name)).toEqual([fooArchive]);
        expect((await applyWorkMigration(plan, { fileSystem: injected })).outcomes).toEqual([
          expect.objectContaining({ status: 'discarded', source: fooSource }),
        ]);
        expect(fs.existsSync(fooSource)).toBe(false);
        expect(fs.readFileSync(barSource, 'utf8')).toBe('{"bar":true}');
      }
    );

    it.skipIf(process.platform !== 'win32')(
      'uses the production Windows default for differently cased scoped owners before lstat',
      async () => {
        const activeName = 'Foo';
        const archiveName = '2026-07-31-Foo';
        const activeDir = makeActiveChange(activeName);
        const archiveDir = makeArchivedChange(archiveName);
        writeWorkFile(activeName, 'review-report.md', 'active');
        const archiveSource = path.join(
          homeDir,
          'changes',
          'archive',
          archiveName,
          'work',
          'auto-run.json'
        );
        fs.mkdirSync(path.dirname(archiveSource), { recursive: true });
        fs.writeFileSync(archiveSource, '{"archived":true}');

        const posixLstatTargets: string[] = [];
        const posix = await discoverChangeDirs(changesDir, {
          changeName: 'foo',
          pathIdentityFlavor: 'posix',
          fileSystem: injectedFileSystem({
            lstat: target => {
              posixLstatTargets.push(target);
              return defaultWorkMigrationFileSystem.lstat(target);
            },
          }),
        });
        expect(posix).toEqual([]);
        expect(posixLstatTargets).not.toContain(activeDir);
        expect(posixLstatTargets).not.toContain(archiveDir);

        const defaultLstatTargets: string[] = [];
        const plan = await planWorkMigration(projectRoot, changesDir, {
          changeName: 'foo',
          globalDataDir,
          fileSystem: injectedFileSystem({
            lstat: target => {
              defaultLstatTargets.push(target);
              return defaultWorkMigrationFileSystem.lstat(target);
            },
          }),
        });
        expect(plan.complete).toBe(true);
        expect(plan.discoveredChanges.map(change => change.name)).toEqual([
          activeName,
          archiveName,
        ]);
        expect(plan.actions.map(action => action.owner)).toEqual([
          activeName,
          archiveName,
        ]);
        expect(defaultLstatTargets).toContain(activeDir);
        expect(defaultLstatTargets).toContain(archiveDir);
      }
    );
  });

  describe('truthful archived-state disposal', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    it('counts discard only after successful unlink and a second plan is empty', async () => {
      const archiveName = '2026-01-01-old';
      makeArchivedChange(archiveName);
      const source = path.join(homeDir, 'changes', 'archive', archiveName, 'work', 'auto-run.json');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, '{}');

      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0].action).toBe('discard-file');
      expect(fs.existsSync(source)).toBe(true);

      const injected = injectedFileSystem({
        unlink: target =>
          target === source
            ? Promise.reject(fsError('EIO', 'injected unlink failure'))
            : defaultWorkMigrationFileSystem.unlink(target),
      });
      const failedApply = await applyWorkMigration(plan, { fileSystem: injected });
      expect(failedApply.outcomes[0]).toMatchObject({ status: 'failed', code: 'EIO' });
      expect(fs.existsSync(source)).toBe(true);

      const applied = await applyWorkMigration(plan);
      expect(applied.outcomes[0].status).toBe('discarded');
      expect(fs.existsSync(source)).toBe(false);
      const second = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      expect(second.actions).toHaveLength(0);
    });

    it('compatibility discarded counter stays zero on unlink failure', async () => {
      const archiveName = '2026-01-02-old';
      makeArchivedChange(archiveName);
      const source = path.join(homeDir, 'changes', 'archive', archiveName, 'work', 'auto-run.json');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, '{}');
      const injected = injectedFileSystem({
        unlink: target =>
          target === source
            ? Promise.reject(fsError('EPERM', 'denied'))
            : defaultWorkMigrationFileSystem.unlink(target),
      });
      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: true,
        globalDataDir,
        fileSystem: injected,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.summary.discarded).toBe(0);
      expect(result.report.summary.failed).toBe(1);
      expect(fs.existsSync(source)).toBe(true);
    });
  });

  describe('guarded destructive apply', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    function archivedRunState(archiveName: string, content: string): string {
      makeArchivedChange(archiveName);
      const source = path.join(
        homeDir,
        'changes',
        'archive',
        archiveName,
        'work',
        'auto-run.json'
      );
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, content);
      return source;
    }

    it('preserves a same-byte replacement and never reports it discarded', async () => {
      const source = archivedRunState('2026-02-01-same-bytes', '{"same":true}');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const plannedFingerprint = plan.actions[0].sourceFingerprint;
      expect(plannedFingerprint?.kind).toBe('file');
      let replaced = false;
      const injected = injectedFileSystem({
        lstat: async target => {
          if (target === source && !replaced) {
            replaced = true;
            const replacement = `${source}.replacement`;
            fs.writeFileSync(replacement, '{"same":true}');
            fs.unlinkSync(source);
            fs.renameSync(replacement, source);
          }
          const stat = await defaultWorkMigrationFileSystem.lstat(target);
          if (target !== source || plannedFingerprint?.kind !== 'file') return stat;
          return new Proxy(stat, {
            get(current, property) {
              if (property === 'ino') return plannedFingerprint.identity.ino + 1;
              const value = Reflect.get(current, property, current);
              return typeof value === 'function' ? value.bind(current) : value;
            },
          });
        },
      });

      const applied = await applyWorkMigration(plan, { fileSystem: injected });
      expect(applied.outcomes[0]).toMatchObject({
        status: 'conflict',
        code: 'ESTALE',
      });
      expect(applied.outcomes[0].status).not.toBe('discarded');
      expect(fs.readFileSync(source, 'utf8')).toBe('{"same":true}');
    });

    it('preserves a changed-byte replacement and never reports it discarded', async () => {
      const source = archivedRunState('2026-02-02-changed-bytes', '{"before":true}');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      let replaced = false;
      const injected = injectedFileSystem({
        lstat: async target => {
          if (target === source && !replaced) {
            replaced = true;
            const replacement = `${source}.replacement`;
            fs.writeFileSync(replacement, '{"after":true}');
            fs.unlinkSync(source);
            fs.renameSync(replacement, source);
          }
          return defaultWorkMigrationFileSystem.lstat(target);
        },
      });

      const applied = await applyWorkMigration(plan, { fileSystem: injected });
      expect(applied.outcomes[0]).toMatchObject({
        status: 'conflict',
        code: 'ESTALE',
      });
      expect(applied.outcomes[0].status).not.toBe('discarded');
      expect(fs.readFileSync(source, 'utf8')).toBe('{"after":true}');
    });

    it('preserves a conclusion directory when a child appears after planning', async () => {
      const source = path.join(homeDir, 'probe', 'drifting-conclusions');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'notes.md'), '# planned\n');
      const plan = await planWorkMigration(projectRoot, changesDir, {
        globalDataDir,
        discardAbsorbedConclusions: true,
      });
      expect(plan.actions[0]).toMatchObject({
        action: 'discard-directory',
        sourceFingerprint: { kind: 'directory' },
      });
      let drifted = false;
      const injected = injectedFileSystem({
        readdir: target => {
          if (target === source && !drifted) {
            drifted = true;
            fs.writeFileSync(path.join(source, 'new-child.md'), '# concurrent\n');
          }
          return defaultWorkMigrationFileSystem.readdir(target);
        },
      });

      const applied = await applyWorkMigration(plan, { fileSystem: injected });
      expect(applied.outcomes[0]).toMatchObject({
        status: 'conflict',
        code: 'ESTALE',
      });
      expect(applied.outcomes[0].status).not.toBe('discarded');
      expect(fs.readFileSync(path.join(source, 'notes.md'), 'utf8')).toBe('# planned\n');
      expect(fs.readFileSync(path.join(source, 'new-child.md'), 'utf8')).toBe(
        '# concurrent\n'
      );
    });
  });

  describe('ENOENT-only discovery and plan blockers', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'blocks every apply action when work scan fails with %s',
      async code => {
        makeActiveChange('foo');
        const source = writeWorkFile('foo', 'review-report.md', 'source');
        const workDir = workDirFor('foo');
        const injected = injectedFileSystem({
          readdir: target =>
            target === workDir
              ? Promise.reject(fsError(code))
              : defaultWorkMigrationFileSystem.readdir(target),
        });
        const plan = await planWorkMigration(projectRoot, changesDir, {
          globalDataDir,
          fileSystem: injected,
        });
        expect(plan.complete).toBe(false);
        expect(plan.blockers).toContainEqual(
          expect.objectContaining({ phase: 'change-work', operation: 'readdir', code })
        );
        const applied = await applyWorkMigration(plan, { fileSystem: injected });
        expect(applied.applied).toBe(false);
        expect(applied.outcomes).toEqual([]);
        expect(fs.readFileSync(source, 'utf8')).toBe('source');
      }
    );

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'blocks every apply action when global probe scan fails with %s',
      async code => {
        makeActiveChange('foo');
        const source = writeWorkFile('foo', 'review-report.md', 'source');
        const probeRoot = path.join(homeDir, 'probe');
        fs.mkdirSync(probeRoot, { recursive: true });
        const injected = injectedFileSystem({
          readdir: target =>
            target === probeRoot
              ? Promise.reject(fsError(code))
              : defaultWorkMigrationFileSystem.readdir(target),
        });
        const plan = await planWorkMigration(projectRoot, changesDir, {
          globalDataDir,
          fileSystem: injected,
        });
        expect(plan.blockers).toContainEqual(
          expect.objectContaining({ phase: 'probe', code })
        );
        expect((await applyWorkMigration(plan, { fileSystem: injected })).applied).toBe(false);
        expect(fs.readFileSync(source, 'utf8')).toBe('source');
      }
    );

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'blocks every apply action when global design-doc scan fails with %s',
      async code => {
        makeActiveChange('foo');
        const source = writeWorkFile('foo', 'review-report.md', 'source');
        const docsRoot = path.join(homeDir, 'design-docs');
        fs.mkdirSync(docsRoot, { recursive: true });
        const injected = injectedFileSystem({
          readdir: target =>
            target === docsRoot
              ? Promise.reject(fsError(code))
              : defaultWorkMigrationFileSystem.readdir(target),
        });
        const plan = await planWorkMigration(projectRoot, changesDir, {
          globalDataDir,
          fileSystem: injected,
        });
        expect(plan.blockers).toContainEqual(
          expect.objectContaining({ phase: 'design-doc', code })
        );
        expect((await applyWorkMigration(plan, { fileSystem: injected })).applied).toBe(false);
        expect(fs.readFileSync(source, 'utf8')).toBe('source');
      }
    );

    it('treats absent work/probe/design-doc directories as empty, complete scans', async () => {
      makeActiveChange('foo');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      expect(plan.complete).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.actions).toEqual([]);
    });
  });

  describe('exclusive file publication', () => {
    beforeEach(async () => {
      await mintIdentity();
      makeActiveChange('foo');
    });

    it('reports conflict when destination appears between plan and apply', async () => {
      const source = writeWorkFile('foo', 'review-report.md', 'legacy-bytes');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, 'concurrent-bytes');

      const result = await applyWorkMigration(plan);
      expect(result.outcomes[0].status).toBe('conflict');
      expect(fs.readFileSync(source, 'utf8')).toBe('legacy-bytes');
      expect(fs.readFileSync(destination, 'utf8')).toBe('concurrent-bytes');
    });

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'does not use copy fallback for primary publication %s',
      async code => {
        const source = writeWorkFile('foo', 'review-report.md', 'legacy');
        const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
        let copyCalls = 0;
        const injected = injectedFileSystem({
          link: () => Promise.reject(fsError(code, `link ${code}`)),
          copyFile: async (...args) => {
            copyCalls++;
            await defaultWorkMigrationFileSystem.copyFile(...args);
          },
        });
        const result = await applyWorkMigration(plan, { fileSystem: injected });
        expect(result.outcomes[0]).toMatchObject({ status: 'failed', code });
        expect(copyCalls).toBe(0);
        expect(fs.readFileSync(source, 'utf8')).toBe('legacy');
      }
    );

    it('uses exclusive copy fallback only for EXDEV and removes source last', async () => {
      const source = writeWorkFile('foo', 'review-report.md', 'legacy');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      let copyCalls = 0;
      const injected = injectedFileSystem({
        link: () => Promise.reject(fsError('EXDEV')),
        copyFile: async (...args) => {
          copyCalls++;
          await defaultWorkMigrationFileSystem.copyFile(...args);
        },
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0].status).toBe('moved');
      expect(copyCalls).toBe(1);
      expect(fs.existsSync(source)).toBe(false);
      expect(fs.readFileSync(destination, 'utf8')).toBe('legacy');
    });

    it('reports copy failure and any migration-owned partial destination', async () => {
      const source = writeWorkFile('foo', 'review-report.md', 'legacy');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      const injected = injectedFileSystem({
        link: () => Promise.reject(fsError('EXDEV')),
        copyFile: async (_source, target) => {
          fs.writeFileSync(target, 'partial');
          throw fsError('EIO', 'copy failed');
        },
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0]).toMatchObject({
        status: 'failed',
        code: 'EIO',
        partialPaths: [destination],
      });
      expect(fs.readFileSync(source, 'utf8')).toBe('legacy');
      expect(fs.readFileSync(destination, 'utf8')).toBe('partial');
    });

    it('reports verification mismatch as incomplete and preserves both paths', async () => {
      const source = writeWorkFile('foo', 'review-report.md', 'legacy');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      const injected = injectedFileSystem({
        link: () => Promise.reject(fsError('EXDEV')),
        readFile: target =>
          target === destination
            ? Promise.resolve(Buffer.from('tampered-view'))
            : defaultWorkMigrationFileSystem.readFile(target),
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0]).toMatchObject({
        status: 'incomplete',
        partialPaths: [destination],
      });
      expect(fs.existsSync(source)).toBe(true);
      expect(fs.existsSync(destination)).toBe(true);
    });

    it('reports source-removal failure as incomplete without claiming moved', async () => {
      const source = writeWorkFile('foo', 'review-report.md', 'legacy');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      const injected = injectedFileSystem({
        unlink: target =>
          target === source
            ? Promise.reject(fsError('EPERM', 'source retained'))
            : defaultWorkMigrationFileSystem.unlink(target),
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0]).toMatchObject({
        status: 'incomplete',
        code: 'EPERM',
        survivingPaths: [source, destination],
      });
      expect(fs.existsSync(source)).toBe(true);
      expect(fs.existsSync(destination)).toBe(true);
    });
  });

  describe('exclusive directory publication', () => {
    beforeEach(async () => {
      await mintIdentity();
    });

    function makeDriver(name: string): string {
      const source = path.join(homeDir, 'probe', name);
      fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(source, 'run.ts'), 'driver');
      fs.writeFileSync(path.join(source, 'nested', 'fixture.txt'), 'fixture');
      return source;
    }

    it('does not merge when a destination directory appears after planning', async () => {
      const source = makeDriver('race-dir');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'concurrent.txt'), 'concurrent');

      const result = await applyWorkMigration(plan);
      expect(result.outcomes[0].status).toBe('conflict');
      expect(fs.readFileSync(path.join(source, 'run.ts'), 'utf8')).toBe('driver');
      expect(fs.readFileSync(path.join(destination, 'concurrent.txt'), 'utf8')).toBe(
        'concurrent'
      );
      expect(fs.existsSync(path.join(destination, 'run.ts'))).toBe(false);
    });

    it('does not overwrite a child created concurrently during recursive copy', async () => {
      const source = makeDriver('child-race');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      const racedChild = path.join(destination, 'run.ts');
      let raced = false;
      const injected = injectedFileSystem({
        copyFile: async (from, to, mode) => {
          if (to === racedChild && !raced) {
            raced = true;
            fs.writeFileSync(to, 'concurrent');
          }
          await defaultWorkMigrationFileSystem.copyFile(from, to, mode);
        },
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0].status).toBe('conflict');
      expect(result.outcomes[0].partialPaths).toEqual(
        expect.arrayContaining([destination, path.join(destination, 'nested')])
      );
      expect(result.outcomes[0].partialPaths).not.toContain(racedChild);
      expect(fs.readFileSync(racedChild, 'utf8')).toBe('concurrent');
      expect(fs.readFileSync(path.join(source, 'run.ts'), 'utf8')).toBe('driver');
      expect(fs.readFileSync(path.join(source, 'nested', 'fixture.txt'), 'utf8')).toBe(
        'fixture'
      );
    });

    it('keeps both complete trees when source removal fails after verification', async () => {
      const source = makeDriver('remove-failure');
      const plan = await planWorkMigration(projectRoot, changesDir, { globalDataDir });
      const destination = plan.actions[0].destination!;
      const injected = injectedFileSystem({
        rm: (target, options) =>
          target === source
            ? Promise.reject(fsError('EIO', 'remove failure'))
            : defaultWorkMigrationFileSystem.rm(target, options),
      });
      const result = await applyWorkMigration(plan, { fileSystem: injected });
      expect(result.outcomes[0]).toMatchObject({ status: 'incomplete', code: 'EIO' });
      expect(result.outcomes[0].partialPaths).toEqual(
        expect.arrayContaining([
          destination,
          path.join(destination, 'run.ts'),
          path.join(destination, 'nested', 'fixture.txt'),
        ])
      );
      expect(fs.readFileSync(path.join(source, 'nested', 'fixture.txt'), 'utf8')).toBe(
        'fixture'
      );
      expect(fs.readFileSync(path.join(destination, 'nested', 'fixture.txt'), 'utf8')).toBe(
        'fixture'
      );
    });
  });

  describe('cross-platform routing helpers', () => {
    it('uses Windows drive, separator, and case-insensitive identity semantics', () => {
      expect(
        isPathWithin(
          'C:\\Repo\\rasen\\changes',
          'c:\\repo\\rasen\\changes\\foo',
          path.win32
        )
      ).toBe(true);
      expect(pathsEqualForPlatform('C:\\Repo\\Foo', 'c:\\repo\\foo', 'win32')).toBe(
        true
      );
      expect(archiveNameMatches('2026-07-31-Foo', 'foo', 'win32')).toBe(true);
      expect(path.win32.join('C:\\Repo', 'rasen', 'changes', 'foo')).toBe(
        'C:\\Repo\\rasen\\changes\\foo'
      );
    });

    it('uses POSIX separators and case-sensitive archive/name semantics', () => {
      expect(isPathWithin('/repo/rasen/changes', '/repo/rasen/changes/foo', path.posix)).toBe(
        true
      );
      expect(pathsEqualForPlatform('/repo/Foo', '/repo/foo', 'posix')).toBe(false);
      expect(archiveNameMatches('2026-07-31-Foo', 'foo', 'posix')).toBe(false);
      expect(archiveNameMatches('2026-07-31-foo', 'foo', 'posix')).toBe(true);
      expect(path.posix.join('/repo', 'rasen', 'changes', 'foo')).toBe(
        '/repo/rasen/changes/foo'
      );
    });

    it('rejects sibling-prefix containment on both path implementations', () => {
      expect(isPathWithin('C:\\Repo\\foo', 'C:\\Repo\\foobar', path.win32)).toBe(false);
      expect(isPathWithin('/repo/foo', '/repo/foobar', path.posix)).toBe(false);
    });
  });
});
