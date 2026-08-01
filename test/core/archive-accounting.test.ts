import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { resolveArchiveAccounting, writeArchiveJson } from '../../src/core/archive-accounting.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

/**
 * archive.json accounting tests (task 2.3): verifies the disposition-
 * accounting file contains codeCommit (not the planning-root commit hash),
 * correct evidence hashes, and honest `missing` entries.
 */
describe('archive-accounting', () => {
  let planningRoot: string;
  let archivedDir: string;
  let gitExecEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-acct-planning-'));
    archivedDir = path.join(planningRoot, 'rasen', 'changes', 'archive', '2026-01-01-test-change');
    fs.mkdirSync(archivedDir, { recursive: true });
    gitExecEnv = { ...process.env, ...isolatedGitEnv(planningRoot) };
  });

  afterEach(() => {
    fs.rmSync(planningRoot, { recursive: true, force: true });
  });

  function initGitRepo(cwd: string): void {
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd, stdio: 'ignore' });
  }

  function commitAll(cwd: string, message = 'init'): string {
    execFileSync('git', ['add', '-A'], { cwd, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', message], { cwd, env: gitExecEnv, stdio: 'ignore' });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, env: gitExecEnv }).toString().trim();
  }

  function sha256(absPath: string): string {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  }

  it('contains codeCommit and NOT a planning-root commit field', async () => {
    initGitRepo(planningRoot);
    commitAll(planningRoot);

    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    expect(accounting.codeCommit).toBeTruthy();
    expect(accounting.codeCommit).toMatch(/^[0-9a-f]{40}$/);

    // The field name "planningCommit" or "planningRootCommit" MUST NOT exist.
    // The only git commit field is codeCommit. planningBranch and
    // planningTreeState carry branch + clean/dirty — NOT a commit hash.
    const written = JSON.parse(JSON.stringify(accounting));
    expect(written.codeCommit).toBeDefined();
    expect(written.planningCommit).toBeUndefined();
    expect(written.planningRootCommit).toBeUndefined();
    expect(written.planningBranch).toBeDefined();
    expect(written.planningTreeState).toBeDefined();
  });

  it('records correct sha256 hashes for evidence files', async () => {
    const evidenceDir = path.join(archivedDir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'review-report.md'), '# Review\nAll clean.');
    fs.writeFileSync(path.join(evidenceDir, 'ship-log.md'), '# Ship\nCommit: abc');

    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    const reviewEntry = accounting.evidence.find((e) => e.path === 'evidence/review-report.md');
    expect(reviewEntry).toBeDefined();
    expect(reviewEntry!.sha256).toBe(sha256(path.join(evidenceDir, 'review-report.md')));

    const shipEntry = accounting.evidence.find((e) => e.path === 'evidence/ship-log.md');
    expect(shipEntry).toBeDefined();
    expect(shipEntry!.sha256).toBe(sha256(path.join(evidenceDir, 'ship-log.md')));
  });

  it('lists missing items when ship-log and verification-report are absent', async () => {
    // No evidence directory at all.
    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    expect(accounting.missing).toContain('ship-log');
    expect(accounting.missing).toContain('verification-report');
  });

  it('does not list items as missing when they exist', async () => {
    const evidenceDir = path.join(archivedDir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'ship-log.md'), '# Ship\n');
    fs.writeFileSync(path.join(evidenceDir, 'verification-report.md'), '# Verify\n');

    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    expect(accounting.missing).not.toContain('ship-log');
    expect(accounting.missing).not.toContain('verification-report');
  });

  it('records null planningBranch and clean treeState for non-git roots', async () => {
    // No git init — planningRoot is just a plain directory.
    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    expect(accounting.codeCommit).toBeNull();
    expect(accounting.planningBranch).toBeNull();
    expect(accounting.planningTreeState).toBe('clean');
  });

  it('records dirty treeState when the working tree has uncommitted changes', async () => {
    initGitRepo(planningRoot);
    commitAll(planningRoot);
    // Create an uncommitted file.
    fs.writeFileSync(path.join(planningRoot, 'uncommitted.txt'), 'dirty');

    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: [],
      handoffAbsorbed: [],
      probes: [],
    });

    expect(accounting.planningTreeState).toBe('dirty');
  });

  it('writeArchiveJson writes a parseable file with all fields', async () => {
    initGitRepo(planningRoot);
    const headSha = commitAll(planningRoot);

    const accounting = await resolveArchiveAccounting({
      changeName: 'test-change',
      archivedDir,
      executionRoot: planningRoot,
      planningRoot,
      ephemeraDiscarded: ['auto-run.json'],
      handoffAbsorbed: [{ file: 'handoff/implementer-1.md', outcome: 'absorbed' }],
      probes: [{ path: 'experiments/probe1', codeCommit: headSha }],
    });

    await writeArchiveJson(archivedDir, accounting);

    const written = JSON.parse(
      fs.readFileSync(path.join(archivedDir, 'archive.json'), 'utf-8')
    );

    expect(written.change).toBe('test-change');
    expect(written.codeCommit).toBe(headSha);
    expect(written.ephemeraDiscarded).toEqual(['auto-run.json']);
    expect(written.handoffAbsorbed).toEqual([
      { file: 'handoff/implementer-1.md', outcome: 'absorbed' },
    ]);
    expect(written.probes).toEqual([{ path: 'experiments/probe1', codeCommit: headSha }]);
  });
});
