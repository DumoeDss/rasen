/**
 * ECP-5 task 1.8 — the engine-ownership guard, WIRED (design D8, delta spec
 * `ecp-change-run-runtime` → "Run-state declares its engine and ownership
 * conflicts are refused from disk").
 *
 * `assertSingleEngineOwner` shipped with `ecp-run-spine` and had zero
 * production callers: the guard was dead code and "blocks mutation" was
 * aspirational. These are REAL fresh-process CLI runs against the built
 * `dist/`, because a kernel-level test of the pure classifier is exactly what
 * failed to notice that nothing called it.
 *
 * The discriminator is the run-state `engine` DECLARATION, not the presence of
 * `auto-run.json` — under design D3 a reconciler-engine run legitimately keeps
 * run-state bookkeeping beside its canonical Record, so a presence-only guard
 * would refuse every converged run.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runCLI } from '../../helpers/run-cli.js';

const BASE_CONFIG = 'schema: spec-driven\n';

/** Run-state with NO engine declaration — everything written before ECP-5. */
const UNDECLARED_RUN_STATE = {
  pipeline: 'bug-fix',
  classification: 'bug-fix',
  tier: 'A',
  stages: { propose: { status: 'done' } },
};

/** Run-state declaring the reconciler — D3 bookkeeping, NOT an owner. */
const DECLARED_RECONCILER_RUN_STATE = {
  pipeline: 'bug-fix',
  engine: { effective: 'reconciler', source: 'default' },
  stages: { propose: { status: 'done' } },
};

/** A derived projection. Never an ownership signal. */
const GOAL_RUN_PROJECTION = {
  variant: 'measure',
  round: 1,
  phase: 'work',
  projection: true,
};

describe('ECP-5: engine-ownership guard is wired (real CLI)', () => {
  const repoRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let env: NodeJS.ProcessEnv;

  const changeId = 'engine-ownership-change';
  const changeDir = () => path.join(testDir, 'rasen', 'changes', changeId);
  const runStatePath = () => path.join(changeDir(), 'auto-run.json');

  async function sha256Of(file: string): Promise<string> {
    return createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }

  /** Every canonical Run Record directory under the isolated data home. */
  async function runRecordDirs(): Promise<string[]> {
    const runsDir = path.join(dataDir, 'rasen', 'runs');
    try {
      return (await fs.readdir(runsDir)).sort();
    } catch {
      return [];
    }
  }

  async function startRun(): Promise<{ runId: string }> {
    const result = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    return { runId: JSON.parse(result.stdout.trim()).runId as string };
  }

  async function writeRunState(state: unknown): Promise<void> {
    await fs.writeFile(runStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  }

  async function statusView(): Promise<unknown> {
    const result = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim()).view;
  }

  beforeEach(async () => {
    testDir = path.join(repoRoot, 'test-engine-ownership-tmp');
    await fs.rm(testDir, { recursive: true, force: true });
    dataDir = path.join(testDir, 'global-data');
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), BASE_CONFIG);
    await fs.mkdir(changeDir(), { recursive: true });
    await fs.writeFile(
      path.join(changeDir(), 'proposal.md'),
      '## Why\n\nEngine-ownership wiring E2E.\n'
    );
    env = { XDG_DATA_HOME: dataDir };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // Spec scenario: "Declared bookkeeping beside the canonical Run is not a
  // conflict". This is the scenario a presence-only guard would have broken —
  // every D3-converged run keeps run-state beside its Record.
  it('lets canonical mutations proceed when run-state declares engine: reconciler', async () => {
    const { runId } = await startRun();
    await writeRunState(DECLARED_RECONCILER_RUN_STATE);

    const resume = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resume.exitCode, resume.stderr).toBe(0);
    expect(`${resume.stdout}${resume.stderr}`).not.toContain(
      'engine_owner_conflict'
    );
    expect(JSON.parse(resume.stdout.trim()).runId).toBe(runId);

    // Starting again (idempotent reuse) is equally unaffected.
    const restart = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(restart.exitCode, restart.stderr).toBe(0);
  }, 180_000);

  // Spec scenario: "Pre-existing run-state beside a canonical Run blocks
  // mutation" + the planner's byte-identical requirement.
  it('refuses every canonical mutation when engine-less run-state sits beside a Record', async () => {
    const { runId } = await startRun();
    await writeRunState(UNDECLARED_RUN_STATE);

    const runStateDigestBefore = await sha256Of(runStatePath());
    const recordDirsBefore = await runRecordDirs();
    const recordDigestsBefore = await Promise.all(
      recordDirsBefore.map(async (dir) => {
        const full = path.join(dataDir, 'rasen', 'runs', dir);
        const files = (await fs.readdir(full)).sort();
        return Promise.all(
          files.map(async (file) => `${file}:${await sha256Of(path.join(full, file))}`)
        );
      })
    );

    const mutations: Array<[string, string[]]> = [
      ['resume-run', ['pipeline', 'resume-run', changeId, 'bug-fix', '--json']],
      [
        'complete',
        ['pipeline', 'complete', changeId, '--run', runId, '--from', 'nonexistent.json', '--json'],
      ],
      [
        'control',
        ['pipeline', 'control', changeId, '--run', runId, '--from', 'nonexistent.json', '--json'],
      ],
    ];

    for (const [label, argv] of mutations) {
      const result = await runCLI(argv, { cwd: testDir, env, timeoutMs: 60_000 });
      expect(result.exitCode, `${label} should refuse`).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output, `${label} names the code`).toContain('engine_owner_conflict');
      // Actionable: names BOTH artifacts, so the operator can see what is
      // claiming the change from each side.
      expect(output, `${label} names the run-state artifact`).toContain(
        'auto-run.json'
      );
      expect(output, `${label} names the Run`).toContain(runId);
    }

    // `pipeline start` refuses too, and says so as a legacy-owner refusal.
    const start = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start.exitCode).not.toBe(0);
    expect(`${start.stdout}${start.stderr}`).toContain('engine_owner_conflict');

    // THE assertion that matters most: a refusal changes NOTHING on disk.
    // Rasen must never auto-adopt, rewrite, or delete either side — doing so
    // would destroy the evidence the operator needs to decide which to keep.
    expect(await sha256Of(runStatePath())).toBe(runStateDigestBefore);
    expect(await runRecordDirs()).toEqual(recordDirsBefore);
    const recordDigestsAfter = await Promise.all(
      recordDirsBefore.map(async (dir) => {
        const full = path.join(dataDir, 'rasen', 'runs', dir);
        const files = (await fs.readdir(full)).sort();
        return Promise.all(
          files.map(async (file) => `${file}:${await sha256Of(path.join(full, file))}`)
        );
      })
    );
    expect(recordDigestsAfter).toEqual(recordDigestsBefore);
  }, 300_000);

  // Migration case: engine-less run-state ALONE stays a legacy owner and the
  // legacy resume path is untouched — the policy never re-homes a run.
  it('leaves engine-less run-state alone on the legacy resume path', async () => {
    await writeRunState(UNDECLARED_RUN_STATE);
    const digestBefore = await sha256Of(runStatePath());

    const resume = await runCLI(['pipeline', 'resume', changeId, '--json'], {
      cwd: testDir,
      env,
      timeoutMs: 60_000,
    });
    expect(resume.exitCode, resume.stderr).toBe(0);
    const payload = JSON.parse(resume.stdout.trim());
    expect(payload.hasRunState).toBe(true);
    expect(payload.completed).toContain('propose');

    // And a canonical launch for that legacy-owned change is refused rather
    // than silently creating the ambiguity.
    const start = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start.exitCode).not.toBe(0);
    expect(`${start.stdout}${start.stderr}`).toContain('engine_owner_conflict');
    expect(await runRecordDirs()).toEqual([]);
    expect(await sha256Of(runStatePath())).toBe(digestBefore);
  }, 180_000);

  // Spec scenario: "Projections never create a conflict". Counting derived
  // projections would make every reconciler-engine goal Run instantly
  // ambiguous.
  it('never treats a derived goal-run.json as an ownership signal', async () => {
    const { runId } = await startRun();
    const beforeProjectionEdit = await statusView();
    await fs.writeFile(
      path.join(changeDir(), 'goal-run.json'),
      `${JSON.stringify(GOAL_RUN_PROJECTION, null, 2)}\n`
    );
    await fs.writeFile(
      path.join(changeDir(), 'review-report.md'),
      '# Review report\n\nA generated report, not an ownership signal.\n'
    );
    const afterProjectionWrite = await statusView();

    await fs.writeFile(
      path.join(changeDir(), 'goal-run.json'),
      `${JSON.stringify({
        ...GOAL_RUN_PROJECTION,
        round: 999,
        phase: 'satisfied',
        lifecycle: { state: 'completed', actionsUsed: 0 },
      }, null, 2)}\n`
    );
    await fs.writeFile(
      path.join(changeDir(), 'review-report.md'),
      '# Edited report\n\nClaims clean and complete; still non-authoritative.\n'
    );
    const afterProjectionEdit = await statusView();

    expect(afterProjectionWrite).toEqual(beforeProjectionEdit);
    expect(afterProjectionEdit).toEqual(beforeProjectionEdit);

    const resume = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resume.exitCode, resume.stderr).toBe(0);
    expect(`${resume.stdout}${resume.stderr}`).not.toContain(
      'engine_owner_conflict'
    );
    expect(JSON.parse(resume.stdout.trim()).runId).toBe(runId);
  }, 180_000);

  // Spec scenario: "Unreadable run-state fails closed". An artifact that
  // cannot be read is never PRESUMED to be harmless bookkeeping.
  it('fails closed when run-state cannot be parsed', async () => {
    await startRun();
    await fs.writeFile(runStatePath(), '{ this is not valid json\n');
    const digestBefore = await sha256Of(runStatePath());

    const resume = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resume.exitCode).not.toBe(0);
    expect(`${resume.stdout}${resume.stderr}`).toContain('engine_owner_conflict');

    // Fail-closed must not mean fix-it-for-them.
    expect(await sha256Of(runStatePath())).toBe(digestBefore);
  }, 180_000);

  // Spec scenario: "Ownership is bound to the change instance" — the Gap-E
  // regression shape. A guard that looked ownership up by NAME or alias let an
  // archived instance's artifacts block (or wrongly admit) a same-name
  // recreation. `canonicalPresent` is answered by a runId derived from the
  // association registry's ChangeInstanceId, so this holds by construction.
  it('binds ownership to the change instance across archive + same-name recreate', async () => {
    const { runId: firstRunId } = await startRun();

    const archived = await runCLI(['archive', changeId, '--json', '--yes'], {
      cwd: testDir,
      env,
      timeoutMs: 60_000,
    });
    expect(archived.exitCode, archived.stderr).toBe(0);

    // Recreate under the same NAME — a fresh directory, so a new inode and a
    // new ChangeInstanceId.
    await fs.mkdir(changeDir(), { recursive: true });
    await fs.writeFile(
      path.join(changeDir(), 'proposal.md'),
      '## Why\n\nRecreated instance.\n'
    );

    const restart = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(restart.exitCode, restart.stderr).toBe(0);
    const secondRunId = JSON.parse(restart.stdout.trim()).runId as string;
    // Distinct instance → distinct Run; the archived instance's Record is not
    // this instance's, so it creates no conflict for it.
    expect(secondRunId).not.toBe(firstRunId);

    const resume = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resume.exitCode, resume.stderr).toBe(0);
    expect(`${resume.stdout}${resume.stderr}`).not.toContain(
      'engine_owner_conflict'
    );
  }, 300_000);
});
