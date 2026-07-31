import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverChangeDirs,
  scanMachineHomeWorkDir,
  countMigratableEphemera,
  runWorkMigration,
  RUN_ARTIFACT_CAVEAT_NOTE,
} from '../../src/core/work-migration.js';
import { resolveProjectHome } from '../../src/core/project-home.js';

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
});
