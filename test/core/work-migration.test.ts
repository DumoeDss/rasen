import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverChangeDirs,
  scanChangeDirEphemera,
  countMigratableEphemera,
  runWorkMigration,
  RUN_ARTIFACT_CAVEAT_NOTE,
} from '../../src/core/work-migration.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

/**
 * The migrate set + git boundary + destination + conflict/idempotency
 * matrix for `migrate-legacy-ephemera` (design D2/D3/D4/D5), plus the
 * review-round fixes: M1 (identity minted only at the point of an actual
 * write, never during preview) and M2 (a git query failure on a confirmed
 * repo fails closed, never masquerading as "untracked").
 */
describe('work-migration', () => {
  let projectRoot: string;
  let changesDir: string;
  let globalDataDir: string;
  let gitExecEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-migration-'));
    changesDir = path.join(projectRoot, 'rasen', 'changes');
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-migration-gdd-'));
    fs.mkdirSync(changesDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    gitExecEnv = { ...process.env, ...isolatedGitEnv(projectRoot) };
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  function initGitRepo(): void {
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  }

  function commitAll(message = 'init'): void {
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', message], { cwd: projectRoot, env: gitExecEnv, stdio: 'ignore' });
  }

  /** Pre-registers machine identity for tests focused on move mechanics, not on M1's mint-timing itself. */
  async function mintIdentity(): Promise<void> {
    await resolveProjectHome(projectRoot, { ensure: true, globalDataDir });
  }

  function makeActiveChange(name: string): string {
    const dir = path.join(changesDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    fs.writeFileSync(path.join(dir, 'design.md'), '# design\n');
    fs.writeFileSync(path.join(dir, 'tasks.md'), '# tasks\n');
    fs.mkdirSync(path.join(dir, 'specs', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'foo', 'spec.md'), '# spec\n');
    return dir;
  }

  function makeArchivedChange(dirName: string): string {
    const dir = path.join(changesDir, 'archive', dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  // ---------------------------------------------------------------------
  // Scanner classification (D2)
  // ---------------------------------------------------------------------

  describe('scanChangeDirEphemera', () => {
    it('classifies the full migrate set and skips hard-excluded review material', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      fs.writeFileSync(path.join(dir, 'portfolio-run.json'), '{}');
      fs.writeFileSync(path.join(dir, 'goal-run.json'), '{}');
      fs.writeFileSync(path.join(dir, 'verification-report.md'), '# v\n');
      fs.writeFileSync(path.join(dir, 'ship-log.md'), '# ship\n');
      fs.writeFileSync(path.join(dir, 'review-report.md'), '# review\n');
      fs.mkdirSync(path.join(dir, 'handoff'));
      fs.writeFileSync(path.join(dir, 'handoff', 'implementer-1.md'), '# handoff\n');
      fs.writeFileSync(path.join(dir, 'handoff', 'relay-prompt.txt'), 'relay\n');
      fs.writeFileSync(path.join(dir, 'retro.md'), '# retro\n');
      fs.writeFileSync(path.join(dir, '.openspec.yaml'), 'goal: x\n');
      fs.writeFileSync(path.join(dir, 'office-hours-design.md'), '# oh\n');

      const { candidates } = await scanChangeDirEphemera(dir);
      const byRelative = new Map(candidates.map((c) => [c.relativePath, c.kind]));

      expect(byRelative.get('auto-run.json')).toBe('run-state');
      expect(byRelative.get('portfolio-run.json')).toBe('run-state');
      expect(byRelative.get('goal-run.json')).toBe('run-state');
      expect(byRelative.get('verification-report.md')).toBe('verification-report');
      expect(byRelative.get('ship-log.md')).toBe('ship-log');
      expect(byRelative.get('review-report.md')).toBe('report');
      expect(byRelative.get('handoff/implementer-1.md')).toBe('handoff');
      expect(byRelative.get('handoff/relay-prompt.txt')).toBe('handoff');

      // Never candidates.
      for (const excluded of [
        'proposal.md',
        'design.md',
        'tasks.md',
        'retro.md',
        '.openspec.yaml',
        'office-hours-design.md',
      ]) {
        expect(byRelative.has(excluded)).toBe(false);
      }
      expect(candidates.some((c) => c.relativePath.startsWith('specs/'))).toBe(false);
      expect(candidates).toHaveLength(8);
    });

    it('reports report-like non-candidates instead of moving them', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'security-audit.md'), '# audit\n');
      fs.writeFileSync(path.join(dir, 'code-review.md'), '# review\n');

      const { candidates, notes } = await scanChangeDirEphemera(dir);

      expect(candidates).toHaveLength(0);
      expect(notes.some((n) => n.includes('security-audit.md'))).toBe(true);
      expect(notes.some((n) => n.includes('code-review.md'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Discovery + scoping
  // ---------------------------------------------------------------------

  describe('discoverChangeDirs', () => {
    it('enumerates active changes and archived dirs, skipping archive/dotdirs at the active level', async () => {
      makeActiveChange('foo');
      makeActiveChange('.hidden');
      makeArchivedChange('2026-01-01-bar');

      const dirs = await discoverChangeDirs(changesDir);
      const names = dirs.map((d) => `${d.archived ? 'archived:' : 'active:'}${d.name}`);

      expect(names).toContain('active:foo');
      expect(names).toContain('archived:2026-01-01-bar');
      expect(names).not.toContain('active:.hidden');
      expect(names).not.toContain('active:archive');
    });

    it('--change scoping matches an active change by exact name', async () => {
      makeActiveChange('foo');
      makeActiveChange('bar');

      const dirs = await discoverChangeDirs(changesDir, { changeName: 'foo' });

      expect(dirs).toHaveLength(1);
      expect(dirs[0]!.name).toBe('foo');
      expect(dirs[0]!.archived).toBe(false);
    });

    it('--change scoping matches archived dirs by date-prefixed suffix', async () => {
      makeArchivedChange('2026-01-01-foo');
      makeArchivedChange('2026-02-02-foo');
      makeArchivedChange('2026-01-01-other');

      const dirs = await discoverChangeDirs(changesDir, { changeName: 'foo' });

      expect(dirs.map((d) => d.name).sort()).toEqual(['2026-01-01-foo', '2026-02-02-foo']);
    });
  });

  // ---------------------------------------------------------------------
  // countMigratableEphemera (doctor's read-only hint; review m1: tracked/untracked split)
  // ---------------------------------------------------------------------

  describe('countMigratableEphemera', () => {
    it('counts candidates without resolving any home', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      fs.writeFileSync(path.join(dir, 'ship-log.md'), '# ship\n');
      makeArchivedChange('2026-01-01-bar');
      fs.writeFileSync(path.join(changesDir, 'archive', '2026-01-01-bar', 'portfolio-run.json'), '{}');

      const counts = await countMigratableEphemera(projectRoot, changesDir);

      expect(counts).toEqual({ total: 3, untracked: 3, tracked: 0, splitUnavailable: false });
      // No home was minted: no projects/ dir under the (unused) global data dir.
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
    });

    it('splits tracked from untracked candidates', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'review-report.md'), '# review\n');
      initGitRepo();
      commitAll();
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}'); // never committed

      const counts = await countMigratableEphemera(projectRoot, changesDir);

      expect(counts).toEqual({ total: 2, untracked: 1, tracked: 1, splitUnavailable: false });
    });

    it('reports splitUnavailable when the git query fails on a confirmed repo', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      initGitRepo();
      commitAll();
      fs.writeFileSync(path.join(projectRoot, '.git', 'index'), 'not a valid index file, corrupted');

      const counts = await countMigratableEphemera(projectRoot, changesDir);

      expect(counts).toEqual({ total: 1, untracked: 0, tracked: 0, splitUnavailable: true });
    });
  });

  // ---------------------------------------------------------------------
  // runWorkMigration: the untracked/tracked/conflict/idempotent/archived matrix
  // ---------------------------------------------------------------------

  describe('runWorkMigration', () => {
    it('moves untracked ephemera to the work directory (execute mode)', async () => {
      const dir = makeActiveChange('foo');
      initGitRepo();
      commitAll(); // commits proposal.md/design.md/tasks.md/specs/ only
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{"pipeline":"x"}'); // never committed: untracked

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: true,
        globalDataDir,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.summary.moved).toBe(1);
      expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(false);
      const change = result.report.changes.find((c) => c.change === 'foo')!;
      expect(change.workDir).not.toBeNull();
      const destination = path.join(change.workDir!, 'auto-run.json');
      expect(fs.existsSync(destination)).toBe(true);
    });

    it('preview mode (execute:false) moves nothing and reports real destinations once identity is already registered', async () => {
      await mintIdentity();
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: false,
        globalDataDir,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.identityPending).toBe(false);
      expect(result.report.summary.moved).toBe(0);
      expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
      const change = result.report.changes.find((c) => c.change === 'foo')!;
      const file = change.files.find((f) => f.relativePath === 'auto-run.json')!;
      expect(file.status).toBe('planned');
      expect(file.destination).toBe(path.join(change.workDir!, 'auto-run.json'));
    });

    it('skips tracked ephemera by default and leaves the working tree unchanged', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'review-report.md'), '# review\n');
      initGitRepo();
      commitAll();

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: true,
        globalDataDir,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.summary.skippedTracked).toBe(1);
      expect(result.report.summary.moved).toBe(0);
      expect(fs.existsSync(path.join(dir, 'review-report.md'))).toBe(true);
      const change = result.report.changes.find((c) => c.change === 'foo')!;
      const file = change.files.find((f) => f.relativePath === 'review-report.md')!;
      expect(file.status).toBe('skipped-tracked');
      expect(file.tracked).toBe(true);
    });

    it('moves tracked ephemera with includeTracked, leaving the deletion uncommitted', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'review-report.md'), '# review\n');
      initGitRepo();
      commitAll();

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: true,
        includeTracked: true,
        globalDataDir,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.summary.moved).toBe(1);
      expect(fs.existsSync(path.join(dir, 'review-report.md'))).toBe(false);

      const status = execFileSync('git', ['status', '--porcelain', '--', 'rasen/changes'], {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      expect(status).toContain('review-report.md');

      // Nothing committed by the command itself.
      const log = execFileSync('git', ['log', '--oneline'], { cwd: projectRoot, encoding: 'utf-8' });
      expect(log.trim().split('\n')).toHaveLength(1);
    });

    it('reports a conflict and never overwrites the destination', async () => {
      await mintIdentity();
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{"source":true}');

      // Pre-seed a probe to learn the real workDir, then place a conflicting file there.
      const probe = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });
      expect(probe.ok).toBe(true);
      if (!probe.ok) return;
      const destination = probe.report.changes[0]!.files[0]!.destination;
      expect(destination).not.toBeNull();
      fs.mkdirSync(path.dirname(destination!), { recursive: true });
      fs.writeFileSync(destination!, '{"destination":true}');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.summary.conflicts).toBe(1);
      expect(result.report.summary.moved).toBe(0);
      expect(fs.readFileSync(destination!, 'utf-8')).toContain('destination');
      expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
    });

    it('is idempotent: a second run finds nothing to migrate', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

      const first = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.report.summary.moved).toBe(1);

      const second = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.summary.totalCandidates).toBe(0);
      expect(second.report.summary.moved).toBe(0);
    });

    it('archived dir migrates to a date-keyed destination distinct from a live same-name change', async () => {
      const liveDir = makeActiveChange('shared-name');
      fs.writeFileSync(path.join(liveDir, 'auto-run.json'), '{"who":"live"}');
      const archivedDir = makeArchivedChange('2026-01-01-shared-name');
      fs.writeFileSync(path.join(archivedDir, 'ship-log.md'), '# archived ship log\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const liveChange = result.report.changes.find((c) => c.change === 'shared-name' && !c.archived)!;
      const archivedChange = result.report.changes.find((c) => c.archived)!;

      expect(liveChange.workDir).not.toBeNull();
      expect(archivedChange.workDir).not.toBeNull();
      expect(liveChange.workDir).not.toBe(archivedChange.workDir);
      expect(fs.existsSync(path.join(liveChange.workDir!, 'auto-run.json'))).toBe(true);
      expect(fs.existsSync(path.join(archivedChange.workDir!, 'ship-log.md'))).toBe(true);
      // The live change's work dir was unaffected by the archived migration.
      expect(fs.existsSync(path.join(liveChange.workDir!, 'ship-log.md'))).toBe(false);
    });

    it('merges the handoff directory per file, conflicting only on the colliding file', async () => {
      await mintIdentity();
      const dir = makeActiveChange('foo');
      fs.mkdirSync(path.join(dir, 'handoff'));
      fs.writeFileSync(path.join(dir, 'handoff', 'implementer-1.md'), '# new\n');
      fs.writeFileSync(path.join(dir, 'handoff', 'implementer-2.md'), '# also new\n');

      const probe = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });
      expect(probe.ok).toBe(true);
      if (!probe.ok) return;
      const workDir = probe.report.changes[0]!.workDir;
      expect(workDir).not.toBeNull();
      fs.mkdirSync(path.join(workDir!, 'handoff'), { recursive: true });
      fs.writeFileSync(path.join(workDir!, 'handoff', 'implementer-1.md'), '# already there\n');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const change = result.report.changes[0]!;
      const collided = change.files.find((f) => f.relativePath === 'handoff/implementer-1.md')!;
      const merged = change.files.find((f) => f.relativePath === 'handoff/implementer-2.md')!;
      expect(collided.status).toBe('conflict');
      expect(merged.status).toBe('moved');
      expect(fs.readFileSync(path.join(workDir!, 'handoff', 'implementer-1.md'), 'utf-8')).toContain('already');
      expect(fs.existsSync(path.join(workDir!, 'handoff', 'implementer-2.md'))).toBe(true);
    });

    it('treats a non-git root as all-untracked with an explicit note', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      // No git init: projectRoot stays a plain directory.

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gitRoot).toBe(false);
      expect(result.report.summary.moved).toBe(1);
      expect(result.report.notes.some((n) => n.includes('not a Git working tree'))).toBe(true);
    });

    it('always includes the run-artifact caveat note', async () => {
      makeActiveChange('foo');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.notes).toContain(RUN_ARTIFACT_CAVEAT_NOTE);
    });

    it('reports change_not_found when --change scoping matches nothing', async () => {
      makeActiveChange('foo');

      const result = await runWorkMigration(projectRoot, changesDir, {
        execute: false,
        changeName: 'does-not-exist',
        globalDataDir,
      });

      expect(result).toEqual({ ok: false, reason: 'change_not_found' });
    });

    it('reports home_unresolved when the config file cannot be written on an execute call (M1)', async () => {
      makeActiveChange('foo');
      const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
      fs.chmodSync(configPath, 0o444);

      try {
        const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
        expect(result).toEqual({ ok: false, reason: 'home_unresolved' });
      } finally {
        fs.chmodSync(configPath, 0o644);
      }
    });

    // -----------------------------------------------------------------
    // Review M1: identity is minted only at the point of an actual write.
    // -----------------------------------------------------------------

    it('M1: a preview on an unregistered project reports identityPending instead of minting', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      const configBefore = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.identityPending).toBe(true);
      const change = result.report.changes.find((c) => c.change === 'foo')!;
      expect(change.workDir).toBeNull();
      const file = change.files.find((f) => f.relativePath === 'auto-run.json')!;
      expect(file.destination).toBeNull();
      expect(file.status).toBe('planned');
      expect(result.report.notes.some((n) => n.includes('No machine identity is registered'))).toBe(true);

      // No mutation at all: config.yaml byte-identical, no registry created.
      const configAfter = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(configAfter).toBe(configBefore);
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
    });

    it('M1 invariant: a successful --dry-run-shaped preview (execute:false) leaves config.yaml and the global registry byte-untouched, even when configured for --include-tracked and repeated', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
      const configBefore = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

      await runWorkMigration(projectRoot, changesDir, { execute: false, includeTracked: true, globalDataDir });
      await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });

      const configAfter = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(configAfter).toBe(configBefore);
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
      expect(fs.readdirSync(globalDataDir)).toEqual([]);
    });

    it('M1: identity is minted only when the execute call actually runs, matching the preview -> confirm -> execute flow', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

      const preview = await runWorkMigration(projectRoot, changesDir, { execute: false, globalDataDir });
      expect(preview.ok).toBe(true);
      if (preview.ok) expect(preview.report.identityPending).toBe(true);
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);

      const executed = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });
      expect(executed.ok).toBe(true);
      if (!executed.ok) return;
      expect(executed.report.identityPending).toBe(false);
      expect(executed.report.summary.moved).toBe(1);
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(true);
    });

    // -----------------------------------------------------------------
    // Review M2: a git query failure on a confirmed repo fails closed.
    // -----------------------------------------------------------------

    it('M2: fails closed (never treats as untracked) when the tracked-files query fails on a confirmed repo', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'review-report.md'), '# review\n');
      initGitRepo();
      commitAll();
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}'); // untracked, would otherwise move

      // Corrupt the index: rev-parse --is-inside-work-tree still succeeds
      // (confirmed repo), but ls-files fails (query failure, not "no repo").
      fs.writeFileSync(path.join(projectRoot, '.git', 'index'), 'not a valid index file, corrupted');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result).toEqual({ ok: false, reason: 'git_query_failed' });
      // Nothing moved, nothing minted — the abort happens before any write.
      expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'review-report.md'))).toBe(true);
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
    });

    it('M2: a confirmed non-git root still proceeds as untracked (unaffected by the fail-closed path)', async () => {
      const dir = makeActiveChange('foo');
      fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

      const result = await runWorkMigration(projectRoot, changesDir, { execute: true, globalDataDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.gitRoot).toBe(false);
      expect(result.report.summary.moved).toBe(1);
    });
  });
});
